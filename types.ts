
export type Platform = 'twitch' | 'youtube';

export interface ChatMessage {
  id: string;
  author: string;
  /** Platform user ID of the author (Twitch), used to remove a banned user's messages. */
  authorId?: string;
  text: string;
  platform: Platform;
  timestamp: Date;
  isRead: boolean;
  isFeatured: boolean;
  featuredAt?: number; // Absolute timestamp when the message was featured
  isTrashed?: boolean;
  isInteresting?: boolean;
  isFirstMessage?: boolean;
  avatarUrl?: string;
  authorColor?: string;
  donationAmount?: string;
  pinnedDuration?: number; // Duration in seconds
  pinnedAt?: number; // Absolute timestamp when the message was pinned (usually donation time)
  eventType?: EventType;
  subscription?: SubscriptionData;
  /** Viewer count for `eventType: 'raid'`. */
  raidViewers?: number;
}

export interface StreamStats {
  viewers: number;
  status: 'online' | 'offline' | 'connecting' | 'error';
  title: string;
  errorMessage?: string;
  /** True when the Helix streams endpoint confirms an active broadcast. Distinct from `status === 'online'` which only means the IRC/API connection is up. */
  isLive?: boolean;
  /** Set when the Twitch login needs renewing: 'expired' (rejected/expired) or 'scopes' (old login without chat access). */
  authIssue?: 'expired' | 'scopes';
  /** Epoch ms when the current token expires, from Twitch's /validate endpoint. */
  tokenExpiresAt?: number;
}

export interface AppSettings {
  twitchChannel: string;
  youtubeVideoId: string;
  youtubeApiKey: string;
  showAvatars: boolean;
  fontSize: number;
  autoDismissEnabled: boolean;
  autoDismissSeconds: number;
  twitchAccessToken?: string;
  twitchClientId?: string;
  showHypeTrain: boolean;
  showSubscriptions: boolean;
}

export interface AppState {
  messages: ChatMessage[];
  featuredMessage: ChatMessage | null;
  stats: Record<Platform, StreamStats>;
  settings: AppSettings;
  quotaUsage: number;
}

export type EventType = 'chat' | 'donation' | 'subscription' | 'follow' | 'raid';

export interface SubscriptionData {
  plan?: string;
  months?: number;
  isGift?: boolean;
  gifter?: string | null;
  streak?: number;
  /** Number of subs in a gift; > 1 for a community gift bomb. */
  giftCount?: number;
  recipient?: string;
}

export interface HypeTrainData {
  id: string;
  level: number;
  progress: number;
  goal: number;
  total: number;
  isActive: boolean;
  expiryDate?: Date;
  isTest?: boolean;
}

