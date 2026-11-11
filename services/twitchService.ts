import { ChatMessage, HypeTrainData, StreamStats, SubscriptionData } from '../types';

/**
 * TwitchChatClient — Twitch EventSub over WebSocket.
 *
 * Everything arrives as typed JSON events on one socket:
 *   channel.chat.message           → chat + cheers
 *   channel.chat.notification      → subs, resubs, gifts, gift bombs, upgrades, raids
 *   channel.chat.message_delete    → a mod deleted a message
 *   channel.chat.clear_user_messages → a user was timed out / banned
 *   channel.hype_train.* (v2)      → Hype Train (broadcaster's own token only)
 * The viewer count has no EventSub event, so /helix/streams is still polled.
 *
 * Requires a user token with `user:read:chat` (and `channel:read:hype_train`
 * for the Hype Train). Docs: https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
 */

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HOUR = 60 * 60 * 1000;
const STATS_INTERVAL = 15_000;
const MAX_RECONNECT_DELAY = 30_000;

export interface TwitchTokenInfo {
    login: string;
    user_id: string;
    scopes: string[];
    /** Seconds until the token expires; 0 when Twitch doesn't report an expiry. */
    expires_in: number;
}

export type ModerationEvent =
    | { type: 'delete'; messageId: string }
    | { type: 'clear_user'; userId: string };

type Status = 'online' | 'error' | 'connecting' | 'offline';

export interface TwitchClientOptions {
    channel: string;
    accessToken?: string;
    clientId?: string;
    onMessage: (msg: ChatMessage) => void;
    onStatsUpdate?: (stats: Partial<StreamStats>) => void;
    onHypeTrainUpdate?: (hypeTrain: HypeTrainData | null) => void;
    onStatusChange?: (status: Status, error?: string) => void;
    onModeration?: (event: ModerationEvent) => void;
    logDebug?: (category: string, message: string) => void;
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

/** Twitch sub tier code → short label. */
export const planLabel = (plan?: string | null): string => {
    switch (plan) {
        case 'Prime': return 'Prime';
        case '2000': return 'Tier 2';
        case '3000': return 'Tier 3';
        default: return 'Tier 1';
    }
};

const randomId = () => Math.random().toString(36).slice(2, 11);
const avatarFor = (author: string) => `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(author)}`;

/** Text of a chat message without the "Cheer100" tokens. */
const messageText = (message: any): string => {
    const fragments: any[] | undefined = message?.fragments;
    if (Array.isArray(fragments) && fragments.length) {
        return fragments.filter(f => f.type !== 'cheermote').map(f => f.text ?? '').join('').replace(/\s+/g, ' ').trim();
    }
    return (message?.text ?? '').trim();
};

export class TwitchChatClient {
    private opts: TwitchClientOptions;
    private channel: string;
    private token?: string;
    private clientId?: string;

    private ws: WebSocket | null = null;
    /** Socket opened from a session_reconnect URL, waiting for its welcome. */
    private pendingWs: WebSocket | null = null;
    private keepaliveMs = 15_000;
    private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;

    private statsTimer: ReturnType<typeof setTimeout> | null = null;
    private validateTimer: ReturnType<typeof setTimeout> | null = null;
    private hypeCheckTimer: ReturnType<typeof setTimeout> | null = null;

    private isDisconnecting = false;
    private lastLogMessage: string | null = null;
    private tokenUserId: string | null = null;
    private broadcasterId: string | null = null;
    private hypeTrainAllowed = false;

    constructor(opts: TwitchClientOptions) {
        this.opts = opts;
        this.channel = opts.channel.trim().toLowerCase();
        this.token = opts.accessToken?.trim().replace(/^oauth:/i, '') || undefined;
        this.clientId = opts.clientId?.trim() || undefined;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    connect() {
        this.isDisconnecting = false;
        if (!this.token || !this.clientId) {
            this.status('error', 'Log in with Twitch to read chat.');
            return;
        }
        this.status('connecting');
        void this.start();
    }

    disconnect() {
        this.isDisconnecting = true;
        for (const t of [this.keepaliveTimer, this.reconnectTimer, this.statsTimer, this.validateTimer, this.hypeCheckTimer]) {
            if (t) clearTimeout(t);
        }
        this.ws?.close();
        this.pendingWs?.close();
        this.ws = this.pendingWs = null;
    }

    private status(status: Status, error?: string) {
        if (!this.isDisconnecting) this.opts.onStatusChange?.(status, error);
    }

    private log(category: string, message: string) {
        const key = `${category}:${message}`;
        if (this.lastLogMessage === key) return; // avoid Firebase write spam
        this.lastLogMessage = key;
        this.opts.logDebug?.(category, message);
    }

    private async start() {
        let info: TwitchTokenInfo | null;
        try {
            info = await validateTwitchToken(this.token!);
        } catch {
            if (this.isDisconnecting) return;
            this.status('error', 'Could not reach Twitch. Retrying…');
            this.reconnectTimer = setTimeout(() => this.start(), 15_000);
            return;
        }
        if (this.isDisconnecting) return;
        if (!info) return this.markAuthIssue('expired', '/validate');

        if (!info.scopes.includes('user:read:chat')) {
            // Tokens from before the EventSub switch only have the old IRC scopes.
            return this.markAuthIssue('scopes', 'missing user:read:chat');
        }

        this.tokenUserId = info.user_id;
        this.reportTokenExpiry(info);
        this.validateTimer = setTimeout(() => this.revalidate(), HOUR);

        if (info.login.toLowerCase() === this.channel) {
            this.broadcasterId = info.user_id;
        } else {
            this.broadcasterId = await this.lookupUserId(this.channel);
            if (this.isDisconnecting) return;
            if (!this.broadcasterId) {
                this.status('error', `Twitch channel "${this.channel}" not found.`);
                return;
            }
        }

        // Hype Train data is only available to the broadcaster's own token.
        this.hypeTrainAllowed = false;
        if (this.opts.onHypeTrainUpdate) {
            if (info.login.toLowerCase() !== this.channel) {
                this.log('HypeTrain', `Disabled: token belongs to "${info.login}", not the channel "${this.channel}".`);
            } else if (!info.scopes.includes('channel:read:hype_train')) {
                this.log('HypeTrain', "Disabled: token is missing the 'channel:read:hype_train' scope.");
            } else {
                this.hypeTrainAllowed = true;
                void this.fetchHypeTrainStatus();
            }
        }

        this.pollStats();
        this.openSocket(EVENTSUB_URL);
    }

    private reportTokenExpiry(info: TwitchTokenInfo) {
        this.opts.onStatsUpdate?.({
            authIssue: undefined,
            tokenExpiresAt: info.expires_in > 0 ? Date.now() + info.expires_in * 1000 : undefined,
        });
    }

    private async revalidate() {
        if (this.isDisconnecting || !this.token) return;
        try {
            const info = await validateTwitchToken(this.token);
            if (this.isDisconnecting) return;
            if (!info) return this.markAuthIssue('expired', 'hourly /validate');
            this.reportTokenExpiry(info);
        } catch { /* network error — keep going, retry next hour */ }
        if (!this.isDisconnecting) this.validateTimer = setTimeout(() => this.revalidate(), HOUR);
    }

    /** Twitch rejected the token: stop everything and ask the user to log in again. */
    private markAuthIssue(issue: 'expired' | 'scopes', where: string) {
        this.log('Auth', `Token problem (${issue}) at ${where}.`);
        this.opts.onStatsUpdate?.({ authIssue: issue, isLive: false });
        this.status('error', issue === 'expired' ? 'Twitch login expired.' : 'Twitch needs a new login for chat access.');
        this.disconnect();
    }

    // ── Helix helpers ─────────────────────────────────────────────────────────

    private helixHeaders(json = false): Record<string, string> {
        return {
            'Client-ID': this.clientId!,
            Authorization: `Bearer ${this.token}`,
            ...(json ? { 'Content-Type': 'application/json' } : {}),
        };
    }

    private async lookupUserId(login: string): Promise<string | null> {
        try {
            const resp = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers: this.helixHeaders() });
            if (resp.status === 401) {
                this.markAuthIssue('expired', '/helix/users');
                return null;
            }
            if (!resp.ok) return null;
            return (await resp.json()).data?.[0]?.id ?? null;
        } catch {
            return null;
        }
    }

    private async pollStats() {
        if (this.isDisconnecting) return;
        try {
            const resp = await fetch(
                `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(this.channel)}`,
                { cache: 'no-store', headers: this.helixHeaders() }
            );
            if (resp.status === 401) return this.markAuthIssue('expired', '/helix/streams');
            if (resp.ok) {
                const stream = (await resp.json()).data?.[0];
                this.opts.onStatsUpdate?.({ viewers: stream?.viewer_count ?? 0, isLive: !!stream, title: stream?.title ?? '' });
            }
            // 429 / 5xx: keep the last value and retry below.
        } catch { /* network error — retry below */ }
        if (!this.isDisconnecting) this.statsTimer = setTimeout(() => this.pollStats(), STATS_INTERVAL);
    }

    /** One-off read of the current train (EventSub only reports changes). */
    private async fetchHypeTrainStatus() {
        if (!this.hypeTrainAllowed || this.isDisconnecting) return;
        try {
            const resp = await fetch(
                `https://api.twitch.tv/helix/hypetrain/status?broadcaster_id=${this.broadcasterId}`,
                { cache: 'no-store', headers: this.helixHeaders() }
            );
            if (resp.status === 401) return this.markAuthIssue('expired', '/helix/hypetrain/status');
            if (!resp.ok) {
                this.log('HypeTrain', `Status API error: ${resp.status}`);
                return;
            }
            // Shape: { data: [{ current, all_time_high, shared_all_time_high }] }; current is null when idle.
            const train = (await resp.json()).data?.[0]?.current;
            this.applyHypeTrain(train && new Date(train.expires_at).getTime() > Date.now() ? train : null);
        } catch (e: any) {
            this.log('HypeTrain', `Status fetch failed: ${e.message}`);
        }
    }

    private applyHypeTrain(train: any | null) {
        if (this.hypeCheckTimer) clearTimeout(this.hypeCheckTimer);
        if (!train) {
            this.log('HypeTrain', 'No active Hype Train.');
            this.opts.onHypeTrainUpdate?.(null);
            return;
        }
        const expiry = new Date(train.expires_at);
        this.log('HypeTrain', `Active: Level ${train.level}, ${Math.floor((train.progress / train.goal) * 100)}%`);
        this.opts.onHypeTrainUpdate?.({
            id: train.id,
            level: train.level,
            progress: train.progress,
            goal: train.goal,
            total: train.total,
            isActive: true,
            expiryDate: expiry,
        });
        // Safety net in case the `end` event is missed: re-check shortly after expiry.
        const wait = Math.max(5_000, expiry.getTime() - Date.now() + 10_000);
        this.hypeCheckTimer = setTimeout(() => this.fetchHypeTrainStatus(), wait);
    }

    // ── EventSub WebSocket ────────────────────────────────────────────────────

    private openSocket(url: string, isReconnect = false) {
        if (this.isDisconnecting) return;
        const ws = new WebSocket(url);
        if (isReconnect) this.pendingWs = ws;
        else this.ws = ws;

        ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data); } catch { return; }
            void this.handleFrame(ws, msg);
        };
        ws.onclose = (ev) => {
            if (ws === this.pendingWs) this.pendingWs = null;
            // The old socket closing after a successful reconnect handoff is expected.
            if (ws !== this.ws || this.isDisconnecting) return;
            this.ws = null;
            if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
            this.log('EventSub', `Socket closed (${ev.code}${ev.reason ? ` ${ev.reason}` : ''}).`);
            this.status('error', 'Twitch chat disconnected. Reconnecting…');
            this.scheduleReconnect();
        };
        // onerror is always followed by onclose, which handles reconnection.
    }

    private scheduleReconnect() {
        if (this.isDisconnecting) return;
        const delay = Math.min(MAX_RECONNECT_DELAY, 1000 * 2 ** this.reconnectAttempts);
        this.reconnectAttempts++;
        // A fresh session starts with no subscriptions; they're recreated on welcome.
        this.reconnectTimer = setTimeout(() => this.openSocket(EVENTSUB_URL), delay);
    }

    private resetKeepalive() {
        if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer);
        // No message for keepalive_timeout_seconds means the connection is dead.
        this.keepaliveTimer = setTimeout(() => {
            this.log('EventSub', 'Keepalive timeout.');
            this.ws?.close();
        }, this.keepaliveMs + 5_000);
    }

    private async handleFrame(ws: WebSocket, msg: any) {
        const type: string | undefined = msg?.metadata?.message_type;
        switch (type) {
            case 'session_welcome': {
                const session = msg.payload.session;
                this.keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
                if (ws === this.pendingWs) {
                    // Reconnect handoff: subscriptions carried over; now drop the old socket.
                    const old = this.ws;
                    this.ws = ws;
                    this.pendingWs = null;
                    old?.close();
                    this.resetKeepalive();
                    return;
                }
                this.resetKeepalive();
                // Must subscribe within 10 seconds of the welcome.
                const ok = await this.subscribeAll(session.id);
                if (ok) {
                    this.reconnectAttempts = 0;
                    this.status('online');
                }
                return;
            }
            case 'session_keepalive':
                this.resetKeepalive();
                return;
            case 'notification':
                this.resetKeepalive();
                this.handleEvent(msg.payload.subscription?.type, msg.payload.event);
                return;
            case 'session_reconnect':
                this.log('EventSub', 'Server asked to reconnect.');
                this.openSocket(msg.payload.session.reconnect_url, true);
                return;
            case 'revocation': {
                const reason = msg.payload.subscription?.status;
                this.log('EventSub', `Subscription ${msg.payload.subscription?.type} revoked: ${reason}`);
                if (reason === 'authorization_revoked') this.markAuthIssue('expired', 'revocation');
                return;
            }
        }
    }

    /** Creates all subscriptions for a session. Returns false if chat itself couldn't be subscribed. */
    private async subscribeAll(sessionId: string): Promise<boolean> {
        const chatCondition = { broadcaster_user_id: this.broadcasterId, user_id: this.tokenUserId };
        const subs = [
            { type: 'channel.chat.message', version: '1', condition: chatCondition, critical: true },
            { type: 'channel.chat.notification', version: '1', condition: chatCondition, critical: true },
            { type: 'channel.chat.message_delete', version: '1', condition: chatCondition, critical: false },
            { type: 'channel.chat.clear_user_messages', version: '1', condition: chatCondition, critical: false },
            ...(this.hypeTrainAllowed
                ? ['begin', 'progress', 'end'].map(k => ({
                    type: `channel.hype_train.${k}`, version: '2',
                    condition: { broadcaster_user_id: this.broadcasterId }, critical: false,
                }))
                : []),
        ];

        const results = await Promise.all(subs.map(s => this.createSubscription(sessionId, s)));
        if (this.isDisconnecting) return false;
        const failedCritical = subs.find((s, i) => s.critical && results[i] !== 'ok');
        if (failedCritical) {
            const why = results[subs.indexOf(failedCritical)];
            if (why === 'auth') return false; // markAuthIssue already reported it
            this.status('error', why === 'limit'
                ? 'Too many Twitch connections. Close other dashboard tabs and reload.'
                : 'Could not subscribe to Twitch chat.');
            return false;
        }
        return true;
    }

    private async createSubscription(
        sessionId: string,
        sub: { type: string; version: string; condition: Record<string, unknown> }
    ): Promise<'ok' | 'auth' | 'forbidden' | 'limit' | 'error'> {
        try {
            const resp = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
                method: 'POST',
                headers: this.helixHeaders(true),
                body: JSON.stringify({
                    type: sub.type,
                    version: sub.version,
                    condition: sub.condition,
                    transport: { method: 'websocket', session_id: sessionId },
                }),
            });
            if (resp.status === 202 || resp.status === 409) return 'ok'; // 409 = already subscribed
            const detail = await resp.text().catch(() => '');
            this.log('EventSub', `Subscribe ${sub.type} failed: ${resp.status} ${detail.slice(0, 200)}`);
            if (resp.status === 401) {
                this.markAuthIssue('expired', `subscribe ${sub.type}`);
                return 'auth';
            }
            if (resp.status === 403) return 'forbidden';
            if (resp.status === 429) return 'limit';
            return 'error';
        } catch {
            return 'error';
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    private handleEvent(type: string | undefined, e: any) {
        if (!type || !e) return;
        switch (type) {
            case 'channel.chat.message': return this.onChatMessage(e);
            case 'channel.chat.notification': return this.onNotification(e);
            case 'channel.chat.message_delete':
                return this.opts.onModeration?.({ type: 'delete', messageId: e.message_id });
            case 'channel.chat.clear_user_messages':
                return this.opts.onModeration?.({ type: 'clear_user', userId: e.target_user_id });
            case 'channel.hype_train.begin':
            case 'channel.hype_train.progress':
                return this.applyHypeTrain(e);
            case 'channel.hype_train.end':
                return this.applyHypeTrain(null);
        }
    }

    private onChatMessage(e: any) {
        const author = e.chatter_user_name || e.chatter_user_login || 'Unknown';
        const bits: number | undefined = e.cheer?.bits;
        this.opts.onMessage({
            id: e.message_id || randomId(),
            author,
            authorId: e.chatter_user_id,
            text: messageText(e.message),
            platform: 'twitch',
            eventType: bits ? 'donation' : 'chat',
            timestamp: new Date(),
            isRead: false,
            isFeatured: false,
            // EventSub has no "first message ever" flag; `user_intro` is the first-time-chatter intro.
            isFirstMessage: e.message_type === 'user_intro',
            avatarUrl: avatarFor(author),
            authorColor: e.color || '#9146FF',
            donationAmount: bits ? `${bits} Bits` : undefined,
        });
    }

    private onNotification(e: any) {
        const notice: string = e.notice_type ?? '';
        const kind = notice.replace(/^shared_chat_/, '');
        // Shared-chat notices carry their data in e.g. `shared_chat_sub` instead of `sub`.
        const data = e[notice] ?? e[kind] ?? {};
        const author = e.chatter_is_anonymous ? 'Anonymous' : (e.chatter_user_name || e.chatter_user_login || 'Unknown');
        const userText = messageText(e.message);
        const systemText = (e.system_message ?? '').trim();
        const base = { id: e.message_id || randomId(), author, authorId: e.chatter_user_id, color: e.color };
        const tierOf = (d: any) => (d.is_prime ? 'Prime' : (d.sub_tier ?? d.sub_plan));

        switch (kind) {
            case 'sub':
                return this.emitSub(base, userText || systemText || `${author} subscribed with ${planLabel(tierOf(data))}!`, {
                    plan: tierOf(data), months: 1, isGift: false,
                });
            case 'resub': {
                const months = Number(data.cumulative_months) || 1;
                return this.emitSub(base, userText || systemText || `${author} resubscribed for ${months} months!`, {
                    plan: tierOf(data), months, isGift: false,
                });
            }
            case 'sub_gift':
                // Part of a community gift bomb: already shown by the community_sub_gift card.
                if (data.community_gift_id) return;
                return this.emitSub(base, systemText || `${author} gifted a ${planLabel(data.sub_tier)} sub to ${data.recipient_user_name}!`, {
                    plan: data.sub_tier, months: Number(data.duration_months) || 1, isGift: true,
                    gifter: author, giftCount: 1, recipient: data.recipient_user_name,
                });
            case 'community_sub_gift': {
                const count = Number(data.total) || 1;
                return this.emitSub(base, systemText || `${author} gifted ${count} ${planLabel(data.sub_tier)} subs to the community!`, {
                    plan: data.sub_tier, months: 1, isGift: true, gifter: author, giftCount: count,
                });
            }
            case 'gift_paid_upgrade':
            case 'prime_paid_upgrade':
                return this.emitSub(base, systemText || `${author} upgraded their sub!`, {
                    plan: data.sub_tier, months: 1, isGift: false,
                });
            case 'raid': {
                const raider = data.user_name || author;
                const viewers = Number(data.viewer_count) || 0;
                return this.opts.onMessage({
                    id: base.id,
                    author: raider,
                    authorId: data.user_id ?? base.authorId,
                    text: systemText || `${raider} is raiding with ${viewers} viewers!`,
                    platform: 'twitch',
                    eventType: 'raid',
                    raidViewers: viewers,
                    timestamp: new Date(),
                    isRead: false,
                    isFeatured: false,
                    avatarUrl: data.profile_image_url || avatarFor(raider),
                    authorColor: '#9146FF',
                });
            }
            // announcements, pay-it-forward, watch streaks, etc. are ignored.
        }
    }

    private emitSub(
        base: { id: string; author: string; authorId?: string; color?: string },
        text: string,
        subscription: SubscriptionData
    ) {
        this.opts.onMessage({
            id: base.id,
            author: base.author,
            authorId: base.authorId,
            text,
            platform: 'twitch',
            eventType: 'subscription',
            timestamp: new Date(),
            isRead: false,
            isFeatured: false,
            avatarUrl: avatarFor(base.author),
            authorColor: base.color || '#9146FF',
            subscription,
        });
    }
}
