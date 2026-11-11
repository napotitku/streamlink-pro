import * as tmi from 'tmi.js';
import { ChatMessage, HypeTrainData, StreamStats, SubscriptionData } from '../types';

/**
 * TwitchChatClient
 *
 * Chat is handled by tmi.js (anonymous, read-only IRC). Viewer stats and the
 * Hype Train come from the Helix REST API, which needs the user's token. The
 * two halves are independent: chat keeps working when the token has expired,
 * so token problems are reported separately via `onStatsUpdate({ authExpired })`.
 */

const HOUR = 60 * 60 * 1000;
const STATS_INTERVAL = 15_000;
/** How long to keep swallowing individual `subgift` notices after a gift bomb. */
const GIFT_BOMB_WINDOW = 30_000;

export interface TwitchTokenInfo {
    login: string;
    user_id: string;
    scopes: string[];
    /** Seconds until the token expires; 0 when Twitch doesn't report an expiry. */
    expires_in: number;
}

/**
 * Checks a user token against Twitch's /validate endpoint.
 * Twitch requires apps to do this on startup and hourly afterwards.
 * Returns null when the token is expired, revoked or malformed.
 * Throws on network errors so callers can tell "offline" from "invalid".
 */
export async function validateTwitchToken(token: string): Promise<TwitchTokenInfo | null> {
    const resp = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${token.trim().replace(/^oauth:/i, '')}` },
    });
    if (resp.status === 401) return null;
    if (!resp.ok) throw new Error(`Token validation failed: ${resp.status}`);
    return resp.json();
}

/** Twitch sub plan code → short label. */
const planLabel = (plan?: string): string => {
    switch (plan) {
        case 'Prime': return 'Prime';
        case '2000': return 'Tier 2';
        case '3000': return 'Tier 3';
        default: return 'Tier 1';
    }
};

const randomId = () => Math.random().toString(36).slice(2, 11);
const avatarFor = (author: string) => `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(author)}`;

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
    private validateTimer: ReturnType<typeof setTimeout> | null = null;
    private isDisconnecting = false;
    private logDebug?: (category: string, message: string) => void;
    private lastLogMessage: string | null = null;
    /** Broadcaster user ID, known only when the token belongs to the channel owner. */
    private broadcasterId: string | null = null;
    /** Gifter login → individual `subgift` notices still expected from a gift bomb. */
    private pendingBombs = new Map<string, { remaining: number; until: number }>();

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
        this.accessToken = accessToken?.trim().replace(/^oauth:/i, '') || undefined;
        this.clientId = clientId?.trim() || undefined;
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

        this.registerChatHandlers(this.client);

        // ── Connection lifecycle ─────────────────────────────────────────────
        // Helix polling is started by startApi(), not here: tmi.js fires
        // `connected` again on every reconnect, which used to stack extra poll loops.
        this.client.on('connected', () => this.onStatusChange?.('online'));

        this.client.on('disconnected', (reason) => {
            if (!this.isDisconnecting) {
                // tmi.js handles reconnection automatically (reconnect: true)
                this.onStatusChange?.('error', reason || 'Disconnected. Reconnecting...');
            }
        });

        this.client.connect().catch((err: Error) => {
            this.onStatusChange?.('error', err.message);
        });

        void this.startApi();
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
        if (this.validateTimer) clearTimeout(this.validateTimer);
        this.statsTimer = this.hypeTrainTimer = this.validateTimer = null;
    }

    // ── Chat events ───────────────────────────────────────────────────────────

    private registerChatHandlers(client: tmi.Client) {
        // Chat messages. tmi.js emits `cheer` instead of `message` for bits.
        client.on('message', (_channel, userstate, message, self) => {
            if (self) return;
            const author = userstate['display-name'] || userstate.username || 'Unknown';
            this.onMessage({
                id: userstate.id || randomId(),
                author,
                text: message.trim(),
                platform: 'twitch',
                eventType: 'chat',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                isFirstMessage: userstate['first-msg'] === true,
                avatarUrl: avatarFor(author),
                authorColor: userstate.color || '#9146FF',
            });
        });

        client.on('cheer', (_channel, userstate, message) => {
            const author = userstate['display-name'] || userstate.username || 'Unknown';
            this.onMessage({
                id: userstate.id || randomId(),
                author,
                text: message.trim(),
                platform: 'twitch',
                eventType: 'donation',
                timestamp: new Date(),
                isRead: false,
                isFeatured: false,
                avatarUrl: avatarFor(author),
                authorColor: userstate.color || '#9146FF',
                donationAmount: `${userstate.bits} Bits`,
            });
        });

        client.on('subscription', (_channel, username, methods, messageText, userstate) => {
            const author = userstate?.['display-name'] || username;
            this.emitSub(author, userstate, messageText?.trim() || `${author} just subscribed with ${planLabel(methods?.plan)}!`, {
                plan: methods?.plan,
                months: 1,
                isGift: false,
            });
        });

        client.on('resub', (_channel, username, _streakMonths, messageText, userstate, methods) => {
            const author = userstate?.['display-name'] || username;
            // The 3rd argument is *streak* months (0 when the viewer hides it); use the cumulative count.
            const months = Number(userstate?.['msg-param-cumulative-months']) || 1;
            this.emitSub(author, userstate, messageText?.trim() || `${author} resubscribed for ${months} months!`, {
                plan: methods?.plan ?? userstate?.['msg-param-sub-plan'],
                months,
                isGift: false,
            });
        });

        // Community gift ("X is gifting 20 subs"): Twitch sends this once, followed by
        // 20 individual `subgift` notices. Show one card and swallow the followers.
        client.on('submysterygift', (_channel, username, count, methods, userstate) => {
            this.trackBomb(userstate?.login || username, count);
            this.emitGift(username, count, methods?.plan, userstate);
        });

        client.on('anonsubmysterygift', (_channel, count, methods, userstate) => {
            this.trackBomb(userstate?.login || 'ananonymousgifter', count);
            this.emitGift('Anonymous', count, methods?.plan, userstate);
        });

        client.on('subgift', (_channel, username, _streakMonths, recipient, methods, userstate) => {
            if (this.consumeBomb(userstate?.login || username)) return;
            this.emitGift(username, 1, methods?.plan, userstate, recipient);
        });

        client.on('anonsubgift', (_channel, _streakMonths, recipient, methods, userstate) => {
            if (this.consumeBomb(userstate?.login || 'ananonymousgifter')) return;
            this.emitGift('Anonymous', 1, methods?.plan, userstate, recipient);
        });

        client.on('giftpaidupgrade', (_channel, username, sender, userstate) => {
            const author = userstate?.['display-name'] || username;
            this.emitSub(author, userstate, `${author} is continuing the gift sub they got from ${sender}!`, {
                months: 1,
                isGift: false,
            });
        });

        client.on('primepaidupgrade', (_channel, username, methods, userstate) => {
            const author = userstate?.['display-name'] || username;
            this.emitSub(author, userstate, `${author} upgraded from Prime to ${planLabel(methods?.plan)}!`, {
                plan: methods?.plan,
                months: 1,
                isGift: false,
            });
        });
    }

    private trackBomb(gifterLogin: string, count: number) {
        const key = gifterLogin.toLowerCase();
        const existing = this.pendingBombs.get(key);
        const remaining = (existing && existing.until > Date.now() ? existing.remaining : 0) + (count || 0);
        this.pendingBombs.set(key, { remaining, until: Date.now() + GIFT_BOMB_WINDOW });
    }

    /** Returns true when this `subgift` belongs to a gift bomb that was already shown. */
    private consumeBomb(gifterLogin: string): boolean {
        const key = gifterLogin.toLowerCase();
        const bomb = this.pendingBombs.get(key);
        if (!bomb) return false;
        if (bomb.remaining <= 0 || bomb.until < Date.now()) {
            this.pendingBombs.delete(key);
            return false;
        }
        bomb.remaining -= 1;
        if (bomb.remaining === 0) this.pendingBombs.delete(key);
        return true;
    }

    private emitGift(gifter: string, count: number, plan: string | undefined, userstate: any, recipient?: string) {
        const text = count > 1
            ? `${gifter} gifted ${count} ${planLabel(plan)} subs to the community!`
            : `${gifter} gifted a ${planLabel(plan)} sub to ${recipient ?? 'someone'}!`;
        this.emitSub(gifter, userstate, text, {
            plan,
            months: 1,
            isGift: true,
            gifter,
            giftCount: count,
            recipient,
        }, '#9146FF');
    }

    private emitSub(author: string, userstate: any, text: string, subscription: SubscriptionData, color?: string) {
        this.onMessage({
            id: userstate?.id || randomId(),
            author,
            text,
            platform: 'twitch',
            eventType: 'subscription',
            timestamp: new Date(),
            isRead: false,
            isFeatured: false,
            avatarUrl: avatarFor(author),
            authorColor: color || userstate?.color || '#9146FF',
            subscription,
        });
    }

    // ── Helix API ─────────────────────────────────────────────────────────────

    private helixHeaders() {
        return { 'Client-ID': this.clientId!, Authorization: `Bearer ${this.accessToken}` };
    }

    /** Called when Twitch rejects the token: stop all API polling and tell the UI. */
    private markAuthExpired(where: string) {
        this.logDebug?.('Auth', `Token rejected by ${where}.`);
        this.clearTimers();
        this.onStatsUpdate?.({ authExpired: true, isLive: false });
    }

    private async startApi() {
        if (!this.accessToken || !this.clientId) return;

        let info: TwitchTokenInfo | null;
        try {
            info = await validateTwitchToken(this.accessToken);
        } catch {
            // Network trouble — try validation again shortly, don't call the token invalid.
            if (!this.isDisconnecting) this.validateTimer = setTimeout(() => this.startApi(), 30_000);
            return;
        }
        if (this.isDisconnecting) return;

        if (!info) {
            this.markAuthExpired('/validate');
            return;
        }

        this.onStatsUpdate?.({
            authExpired: false,
            tokenExpiresAt: info.expires_in > 0 ? Date.now() + info.expires_in * 1000 : undefined,
        });
        this.validateTimer = setTimeout(() => this.revalidate(), HOUR);

        this.pollStats();

        if (this.onHypeTrainUpdate) {
            // Twitch only returns Hype Train data to the broadcaster's own token.
            if (info.login.toLowerCase() !== this.channel) {
                this.logDebug?.('HypeTrain', `Disabled: token belongs to "${info.login}", not the channel "${this.channel}".`);
            } else if (!info.scopes.includes('channel:read:hype_train')) {
                this.logDebug?.('HypeTrain', "Disabled: token is missing the 'channel:read:hype_train' scope.");
            } else {
                this.broadcasterId = info.user_id;
                this.pollHypeTrain();
            }
        }
    }

    private async revalidate() {
        if (!this.accessToken || this.isDisconnecting) return;
        try {
            const info = await validateTwitchToken(this.accessToken);
            if (this.isDisconnecting) return;
            if (!info) {
                this.markAuthExpired('hourly /validate');
                return;
            }
            this.onStatsUpdate?.({
                tokenExpiresAt: info.expires_in > 0 ? Date.now() + info.expires_in * 1000 : undefined,
            });
        } catch { /* network error — keep the current state and retry next hour */ }
        if (!this.isDisconnecting) this.validateTimer = setTimeout(() => this.revalidate(), HOUR);
    }

    private async pollStats() {
        if (!this.accessToken || !this.clientId || this.isDisconnecting) return;

        try {
            const resp = await fetch(
                `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(this.channel)}`,
                { cache: 'no-store', headers: this.helixHeaders() }
            );
            if (resp.status === 401) {
                this.markAuthExpired('/helix/streams');
                return;
            }
            if (resp.ok) {
                const data = await resp.json();
                const streamData = data.data?.[0];
                this.onStatsUpdate?.({ viewers: streamData?.viewer_count ?? 0, isLive: !!streamData });
            }
            // Other errors (429, 5xx): keep the last value and retry below.
        } catch { /* network error — retry below */ }

        if (!this.isDisconnecting) {
            this.statsTimer = setTimeout(() => this.pollStats(), STATS_INTERVAL);
        }
    }

    private scheduleHypeTrain(ms: number) {
        if (!this.isDisconnecting) this.hypeTrainTimer = setTimeout(() => this.pollHypeTrain(), ms);
    }

    private async pollHypeTrain() {
        if (!this.accessToken || !this.clientId || !this.onHypeTrainUpdate || !this.broadcasterId) return;

        try {
            const resp = await fetch(
                `https://api.twitch.tv/helix/hypetrain/status?broadcaster_id=${this.broadcasterId}`,
                { cache: 'no-store', headers: this.helixHeaders() }
            );

            if (resp.status === 401) {
                this.markAuthExpired('/helix/hypetrain/status');
                return;
            }
            if (!resp.ok) {
                this.logDebug?.('HypeTrain', `API Error: ${resp.status} ${resp.statusText}`);
                this.scheduleHypeTrain(30_000);
                return;
            }

            const data = await resp.json();
            // Response shape: { data: [{ current, all_time_high, shared_all_time_high }] }.
            // `current` is null when no train is running.
            const train = data.data?.[0]?.current;

            if (!train || new Date(train.expires_at).getTime() <= Date.now()) {
                this.logDebug?.('HypeTrain', 'No active Hype Train.');
                this.onHypeTrainUpdate(null);
                this.scheduleHypeTrain(60_000);
                return;
            }

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
            this.scheduleHypeTrain(10_000);
        } catch (e: any) {
            this.logDebug?.('HypeTrain', `Exception: ${e.message}`);
            this.scheduleHypeTrain(30_000);
        }
    }
}
