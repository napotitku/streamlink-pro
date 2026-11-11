import { ChatMessage, StreamStats } from "../types";

type Status = 'online' | 'error' | 'connecting' | 'offline';

type ErrorKind = 'quota' | 'retry' | 'ended' | 'fatal';

/**
 * Turns a YouTube Data API error into something the streamer can act on.
 * Many different problems come back as HTTP 403; `errors[0].reason` tells them apart.
 */
export const describeYouTubeError = (error: any): { kind: ErrorKind; message: string } => {
  const reason: string | undefined = error?.errors?.[0]?.reason;
  switch (reason) {
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
      return { kind: 'quota', message: 'API Quota Exceeded' };
    case 'rateLimitExceeded':
    case 'userRateLimitExceeded':
      return { kind: 'retry', message: 'YouTube asked us to slow down. Retrying…' };
    case 'liveChatEnded':
      return { kind: 'ended', message: 'Stream ended' };
    case 'liveChatDisabled':
      return { kind: 'fatal', message: 'Live chat is turned off for this stream.' };
    case 'liveChatNotFound':
      return { kind: 'fatal', message: 'Live chat not found. Check the stream link.' };
    case 'keyInvalid':
      return { kind: 'fatal', message: 'The YouTube API key is invalid.' };
    case 'ipRefererBlocked':
    case 'refererNotAllowedMapError':
      return { kind: 'fatal', message: "The YouTube API key doesn't allow this website. Check its restrictions in Google Cloud." };
    case 'accessNotConfigured':
      return { kind: 'fatal', message: 'YouTube Data API v3 is not enabled for this API key.' };
    case 'forbidden':
      return { kind: 'fatal', message: 'YouTube refused access to this live chat.' };
  }
  return { kind: 'retry', message: error?.message || 'YouTube API error. Retrying…' };
};

const WAIT_FOR_START_MS = 60_000;
const STATS_INTERVAL_MS = 60_000;
const ERROR_BACKOFF_MS = 20_000;

export class YouTubeChatClient {
  private apiKey: string;
  private videoId: string;
  private onMessage: (msg: ChatMessage) => void;
  private onStatusChange: (status: Status, error?: string) => void;
  private onQuotaUpdate: (units: number) => void;
  private onStatsUpdate?: (stats: Partial<StreamStats>) => void;
  private liveChatId: string | null = null;
  private nextPollToken: string | null = null;
  private pollInterval = 10_000; // minimum 10 s between chat polls, to save quota
  private timer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;
  private isPaused = false;
  /** Set when polling must not continue: quota gone, stream over, or a permanent error. */
  private stopped = false;

  constructor(
    apiKey: string,
    videoId: string,
    onMessage: (msg: ChatMessage) => void,
    onStatusChange: (status: Status, error?: string) => void,
    onQuotaUpdate: (units: number) => void,
    onStatsUpdate?: (stats: Partial<StreamStats>) => void
  ) {
    this.apiKey = apiKey;
    this.videoId = this.extractVideoId(videoId);
    this.onMessage = onMessage;
    this.onStatusChange = onStatusChange;
    this.onQuotaUpdate = onQuotaUpdate;
    this.onStatsUpdate = onStatsUpdate;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.isPaused = true;
      this.clearTimers();
    } else {
      this.isPaused = false;
      if (this.liveChatId && !this.stopped) {
        this.poll();
        this.pollStats();
      }
    }
  };

  private extractVideoId(input: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    try {
      if (trimmed.includes('studio.youtube.com/video/')) {
        const match = trimmed.match(/\/video\/([^\/]+)/);
        if (match) return match[1];
      }
      if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
        const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
        if (trimmed.includes('youtu.be')) return url.pathname.slice(1);
        if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2] || trimmed;
        return url.searchParams.get('v') || trimmed;
      }
    } catch { /* not a URL — treat as a plain video ID */ }
    return trimmed;
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.statsTimer) clearTimeout(this.statsTimer);
    this.timer = this.statsTimer = null;
  }

  /** Stops all polling for good (until connect() is called again). */
  private stop(status: Status, message: string) {
    this.stopped = true;
    this.clearTimers();
    this.onStatusChange(status, message);
  }

  /** The broadcast is over: stop spending quota on it. */
  private markEnded() {
    this.onStatsUpdate?.({ viewers: 0, isLive: false });
    this.stop('offline', 'Stream ended');
  }

  private async getVideo(parts: string) {
    // videos.list = 1 unit
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(this.videoId)}&part=${parts}&key=${this.apiKey}`);
    this.onQuotaUpdate(1);
    return resp.json();
  }

  async connect() {
    this.stopped = false;
    this.clearTimers();
    if (!this.apiKey || !this.videoId) {
      this.onStatusChange('error', 'Missing API Key or Video ID');
      return;
    }

    try {
      const videoData = await this.getVideo('liveStreamingDetails,snippet');
      if (this.stopped) return;

      if (videoData.error) {
        const { kind, message } = describeYouTubeError(videoData.error);
        if (kind === 'retry') {
          this.onStatusChange('error', message);
          this.timer = setTimeout(() => this.connect(), ERROR_BACKOFF_MS);
        } else {
          this.stop('error', message);
        }
        return;
      }

      const item = videoData.items?.[0];
      if (!item) return this.stop('error', 'Video not found. Check the stream link.');

      const details = item.liveStreamingDetails;
      if (!details) return this.stop('error', 'This video is not a live stream.');
      if (details.actualEndTime) return this.markEnded();

      this.liveChatId = details.activeLiveChatId ?? null;
      if (!this.liveChatId) {
        // Scheduled but not started yet: check again in a minute (1 quota unit per check).
        this.onStatusChange('connecting', "Waiting for the stream to start…");
        this.timer = setTimeout(() => this.connect(), WAIT_FOR_START_MS);
        return;
      }

      this.onStatusChange('online');
      this.poll();
      this.pollStats();
    } catch (e: any) {
      // Network error
      this.onStatusChange('error', e.message);
      this.timer = setTimeout(() => this.connect(), ERROR_BACKOFF_MS);
    }
  }

  private async pollStats() {
    if (this.isPaused || this.stopped) return;

    try {
      // Every 60 s to save quota
      const videoData = await this.getVideo('liveStreamingDetails');
      if (this.stopped) return;
      const details = videoData.items?.[0]?.liveStreamingDetails;
      if (details?.actualEndTime) return this.markEnded();
      if (details) {
        this.onStatsUpdate?.({ viewers: parseInt(details.concurrentViewers || '0', 10), isLive: true });
      }
    } catch (e) {
      console.error('[YouTube Stats] Error polling:', e);
    }
    if (!this.stopped && !this.isPaused) this.statsTimer = setTimeout(() => this.pollStats(), STATS_INTERVAL_MS);
  }

  private async poll() {
    if (!this.liveChatId || this.isPaused || this.stopped) return;

    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/liveChat/messages');
      url.searchParams.append('liveChatId', this.liveChatId);
      url.searchParams.append('part', 'snippet,authorDetails');
      url.searchParams.append('key', this.apiKey);
      if (this.nextPollToken) url.searchParams.append('pageToken', this.nextPollToken);

      const resp = await fetch(url.toString());
      this.onQuotaUpdate(1);
      const data = await resp.json();
      if (this.stopped) return;

      if (data.error) {
        const { kind, message } = describeYouTubeError(data.error);
        if (kind === 'ended') return this.markEnded();
        if (kind !== 'retry') return this.stop('error', message);
        this.onStatusChange('error', message);
        this.timer = setTimeout(() => this.poll(), ERROR_BACKOFF_MS);
        return;
      }

      this.nextPollToken = data.nextPageToken;
      this.pollInterval = Math.max(data.pollingIntervalMillis || 10_000, 10_000);

      for (const item of data.items ?? []) {
        const snippet = item.snippet;
        let donationAmount: string | undefined;
        if (snippet.type === 'superChatEvent') donationAmount = snippet.superChatDetails?.amountDisplayString;
        else if (snippet.type === 'superStickerEvent') donationAmount = snippet.superStickerDetails?.amountDisplayString;

        this.onMessage({
          id: item.id,
          author: item.authorDetails.displayName,
          authorId: item.authorDetails.channelId,
          text: snippet.displayMessage,
          platform: 'youtube',
          timestamp: new Date(snippet.publishedAt),
          isRead: false,
          isFeatured: false,
          avatarUrl: item.authorDetails.profileImageUrl,
          authorColor: '#FF0000',
          donationAmount,
        });
      }

      // `offlineAt` appears once the broadcast has gone offline; nothing more will arrive.
      if (data.offlineAt) return this.markEnded();

      this.onStatusChange('online');
      if (!this.isPaused) this.timer = setTimeout(() => this.poll(), this.pollInterval);
    } catch (e: any) {
      this.onStatusChange('error', e.message);
      this.timer = setTimeout(() => this.poll(), ERROR_BACKOFF_MS);
    }
  }

  disconnect() {
    this.stopped = true;
    this.clearTimers();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
