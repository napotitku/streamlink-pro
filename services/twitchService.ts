import * as tmi from 'tmi.js';
import { ChatMessage, HypeTrainData, StreamStats } from '../types';

/**
 * TwitchChatClient
 *
 * Chat is now handled by tmi.js, which owns IRC parsing, PING/PONG,
 * reconnection, and all tag extraction. Stats and Hype Train polling
 * continue to hit the Helix REST API directly — they are independent
 * of the IRC connection.
 */
export class TwitchChatClient {
    private client: tmi.Client | null = null;
    private channel: string;
    private accessToken?: string;
    private clientId?: string;
    private onMessage: (msg: ChatMessage) => void;
    private onStatsUpdate?: (stats: Partial<StreamStats>) => void;
    private onHypeTrainUpdate?: (hypeTrain: HypeTrainData | null) => void;
    private onStatusChange?: (status: 'online' | 'error' | 'connecting', error?: string) => void;
    private statsTimer: ReturnType<typeof setTimeout> | null = null;
    private hypeTrainTimer: ReturnType<typeof setTimeout> | null = null;
    private isDisconnecting = false;
    private logDebug?: (category: string, message: string) => void;
    private lastLogMessage: string | null = null;

    constructor(
        channel: string,
        onMessage: (msg: ChatMessage) => void,
        onStatsUpdate?: (stats: Partial<StreamStats>) => void,
        onHypeTrainUpdate?: (hypeTrain: HypeTrainData | null) => void,
        accessToken?: string,
        clientId?: string,
        onStatusChange?: (status: 'online' | 'error' | 'connecting', error?: string) => void,
        logDebug?: (category: string, message: string) => void
    ) {
        this.channel = channel.toLowerCase();
        this.onMessage = onMessage;
        this.onStatsUpdate = onStatsUpdate;
        this.onHypeTrainUpdate = onHypeTrainUpdate;
        this.accessToken = accessToken;
        this.clientId = clientId;
        this.onStatusChange = onStatusChange;
        // Deduplicate log calls to avoid Firebase write spam
        this.logDebug = logDebug ? (category, message) => {
            const key = `${category}:${message}`;
            if (this.lastLogMessage !== key) {
                this.lastLogMessage = key;
                logDebug(category, message);
            }
        } : undefined;
    }

    connect() {
        this.isDisconnecting = false;
        this.onStatusChange?.('connecting');

        this.client = new tmi.Client({
            // Anonymous read-only connection — no identity needed to receive chat.
            // This keeps chat working even when the user hasn't passed an OAuth token.
            channels: [this.channel],
            options: { debug: false },
            connection: { secure: true, reconnect: true },
        });

        // ── Chat messages (PRIVMSG) ──────────────────────────────────────────
        this.client.on('message', (_channel, userstate, message, self) => {
            if (self) return;

            const author = userstate['display-name'] || userstate.username || 'Unknown';
            const isBits = !!userstate.bits;

            const msg: ChatMessage = {
                id: userstate.id || Math.random().toString(36).slice(2, 11),
                author,
                text: message.trim(),
                platform: 'twitch',
                eventType: isBits ? 'donation' : 'chat',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                isFirstMessage: userstate['first-msg'] === true,
                avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
                authorColor: userstate.color || '#9146FF',
                donationAmount: isBits ? `${userstate.bits} Bits` : undefined,
            };
            this.onMessage(msg);
        });

        // ── Bits (cheer) — explicit event for clarity ────────────────────────
        this.client.on('cheer', (_channel, userstate, message) => {
            const author = userstate['display-name'] || userstate.username || 'Unknown';
            const msg: ChatMessage = {
                id: userstate.id || Math.random().toString(36).slice(2, 11),
                author,
                text: message.trim(),
                platform: 'twitch',
                eventType: 'donation',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
                authorColor: userstate.color || '#9146FF',
                donationAmount: `${userstate.bits} Bits`,
            };
            this.onMessage(msg);
        });

        // ── New subscription ─────────────────────────────────────────────────
        this.client.on('subscription', (_channel, username, method, messageText, userstate) => {
            const author = userstate?.['display-name'] || username;
            const msg: ChatMessage = {
                id: userstate?.id || Math.random().toString(36).slice(2, 11),
                author,
                text: messageText?.trim() || `${author} just subscribed!`,
                platform: 'twitch',
                eventType: 'subscription',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
                authorColor: userstate?.color || '#9146FF',
                subscription: {
                    plan: method?.plan ?? 'Prime',
                    months: 1,
                    isGift: false,
                    gifter: null,
                },
            };
            this.onMessage(msg);
        });

        // ── Resub ────────────────────────────────────────────────────────────
        this.client.on('resub', (_channel, username, months, messageText, userstate) => {
            const author = userstate?.['display-name'] || username;
            const msg: ChatMessage = {
                id: userstate?.id || Math.random().toString(36).slice(2, 11),
                author,
                text: messageText?.trim() || `${author} resubscribed for ${months} months!`,
                platform: 'twitch',
                eventType: 'subscription',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
                authorColor: userstate?.color || '#9146FF',
                subscription: {
                    plan: userstate?.['msg-param-sub-plan'] ?? '1000',
                    months,
                    isGift: false,
                    gifter: null,
                },
            };
            this.onMessage(msg);
        });

        // ── Gift sub ─────────────────────────────────────────────────────────
        this.client.on('subgift', (_channel, gifter, _streakMonths, recipient, methods, userstate) => {
            const author = gifter;
            const msg: ChatMessage = {
                id: userstate?.id || Math.random().toString(36).slice(2, 11),
                author,
                text: `${gifter} gifted a sub to ${recipient}!`,
                platform: 'twitch',
                eventType: 'subscription',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${author}`,
                authorColor: '#9146FF',
                subscription: {
                    plan: methods?.plan ?? '1000',
                    months: 1,
                    isGift: true,
                    gifter,
                },
            };
            this.onMessage(msg);
        });

        // ── Connection lifecycle ─────────────────────────────────────────────
        this.client.on('connected', () => {
            this.onStatusChange?.('online');
            if (this.accessToken && this.clientId) {
                this.pollStats();
                if (this.onHypeTrainUpdate) this.pollHypeTrain();
            }
        });

        this.client.on('disconnected', (reason) => {
            if (!this.isDisconnecting) {
                // tmi.js handles reconnection automatically (reconnect: true)
                this.onStatusChange?.('error', reason || 'Disconnected. Reconnecting...');
            }
        });

        this.client.connect().catch((err: Error) => {
            this.onStatusChange?.('error', err.message);
        });
    }

    disconnect() {
        this.isDisconnecting = true;
        this.clearTimers();
        this.client?.disconnect().catch(() => { /* silent — already disconnecting */ });
        this.client = null;
    }

    private clearTimers() {
        if (this.statsTimer) clearTimeout(this.statsTimer);
        if (this.hypeTrainTimer) clearTimeout(this.hypeTrainTimer);
    }

    // ── Helix API polling ─────────────────────────────────────────────────────
    // These are independent of the IRC connection and remain as-is.

    private async pollStats() {
        if (!this.accessToken || !this.clientId) return;

        const token = this.accessToken.trim().replace(/^oauth:/i, '');
        const clientId = this.clientId.trim();

        try {
            const resp = await fetch(
                `https://api.twitch.tv/helix/streams?user_login=${this.channel}&t=${Date.now()}`,
                {
                    cache: 'no-store',
                    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
                }
            );
            if (resp.ok) {
                const data = await resp.json();
                const streamData = data.data?.[0];
                const isLive = !!streamData;
                const viewers = streamData?.viewer_count ?? 0;
                this.onStatsUpdate?.({ viewers, isLive });
            }
        } catch { /* network error — will retry */ }

        if (!this.isDisconnecting) {
            this.statsTimer = setTimeout(() => this.pollStats(), 10_000);
        }
    }

    private async pollHypeTrain() {
        if (!this.accessToken || !this.clientId || !this.onHypeTrainUpdate) return;

        const token = this.accessToken.trim().replace(/^oauth:/i, '');
        const clientId = this.clientId.trim();

        try {
            // Resolve broadcaster ID
            const userResp = await fetch(`https://api.twitch.tv/helix/users?login=${this.channel}`, {
                headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
            });
            const broadcasterId: string = userResp.ok
                ? (await userResp.json()).data?.[0]?.id ?? ''
                : '';

            if (!broadcasterId) {
                this.logDebug?.('HypeTrain', 'Could not resolve broadcaster ID.');
                this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 60_000);
                return;
            }

            const resp = await fetch(
                `https://api.twitch.tv/helix/hypetrain/status?broadcaster_id=${broadcasterId}`,
                {
                    cache: 'no-store',
                    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` },
                }
            );

            if (!resp.ok) {
                this.logDebug?.('HypeTrain', `API Error: ${resp.status} ${resp.statusText}`);
                if (resp.status === 401 || resp.status === 403) {
                    this.onStatusChange?.('error', "Hype Train: Missing 'channel:read:hype_train' scope.");
                    this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 120_000);
                    return;
                }
                this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 30_000);
                return;
            }

            const data = await resp.json();

            if (!data.data || data.data.length === 0) {
                this.logDebug?.('HypeTrain', 'No active Hype Train.');
                this.onHypeTrainUpdate(null);
                this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 60_000);
                return;
            }

            const train = data.data[0];
            const expiresAt = new Date(train.expires_at).getTime();

            if (expiresAt > Date.now()) {
                this.logDebug?.('HypeTrain', `Active: Level ${train.level}, ${Math.floor((train.progress / train.goal) * 100)}%`);
                this.onHypeTrainUpdate({
                    id: train.id,
                    level: train.level,
                    progress: train.progress,
                    goal: train.goal,
                    total: train.total,
                    isActive: true,
                    expiryDate: new Date(train.expires_at),
                });
                this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 10_000);
            } else {
                this.logDebug?.('HypeTrain', 'Train expired.');
                this.onHypeTrainUpdate(null);
                this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 60_000);
            }
        } catch (e: any) {
            this.logDebug?.('HypeTrain', `Exception: ${e.message}`);
            this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), 30_000);
        }
    }
}
