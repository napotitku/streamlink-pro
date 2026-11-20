import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import type { DocumentData, Firestore, QueryDocumentSnapshot, Unsubscribe } from 'firebase/firestore';
import { ChatMessage, StreamStats } from '@/types';
import type { ModerationEvent } from '@/services/twitchService';

/**
 * Kocouří díra (kocouridira.cz, the repo `kocouri-dira`): the podcast's community chat. A live
 * stream there is a YouTube video above a thread; this client reads that thread's replies so they
 * show in the dashboard beside Twitch and YouTube chat.
 *
 * The chat lives in Firestore of the Firebase project `kocouri-web`, so this is a second Firebase
 * app with its own sign-in. The rules there let only signed-in chat members read rooms and threads,
 * and only the chat's staff (owner, moderators) read staff rooms, where streams go while they're in
 * test. Read-only: this never writes to Kocouří díra.
 *
 * Paths and shapes are kocouri-dira's `src/app/chat/chat-model.ts` (`chatPaths`, `ChatMessage`,
 * `ChatChannel.live`) and `live-model.ts`; keep them in step.
 */

/** kocouri-dira's `src/app/firebase/firebase.config.ts`. Public by design; the rules guard the data. */
const KOCOURI_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDZKYLH2yzZeFv-yQPv4qLTcDTkzsq0xVM',
    // Google's sign-in popup runs on kocouridira.cz (it proxies Firebase's /__/auth/ pages).
    authDomain: 'kocouridira.cz',
    projectId: 'kocouri-web',
    storageBucket: 'kocouri-web.firebasestorage.app',
    messagingSenderId: '897912112124',
    appId: '1:897912112124:web:70476e3d724355ec93a879',
};

const APP_NAME = 'kocouri';
/** `CHAT_SERVER_ID` in chat-model.ts. */
const SERVER = 'servers/kocouri';
/** The rules allow pages of at most 50 messages and 100 rooms. */
const PAGE = 50;
const ROOMS = 100;
/** Authors that are the chat's own bots (`isChatBot`). */
const BOTS = new Set(['quiz', 'fanfic', 'advent', 'live']);

export const KOCOURI_SITE = 'https://kocouridira.cz';

let app: FirebaseApp | null = null;

/** The second Firebase app, made on first use so the overlay never starts it. */
const kocouriApp = (): FirebaseApp => {
    app ??= getApps().find(a => a.name === APP_NAME) ?? initializeApp(KOCOURI_FIREBASE_CONFIG, APP_NAME);
    return app;
};

/** Sign-in to Kocouří díra, separate from the dashboard's own (it persists across reloads). */
export const kocouriAuth = (): Auth => getAuth(kocouriApp());

/** `SPOILER` in capitals hides a message in the chat (`isSpoiler` in chat-model.ts). */
export const isSpoiler = (text: string): boolean => /(?<![\p{L}\p{N}])SPOILER\p{Lu}*(?![\p{L}\p{N}])/u.test(text);

/** A thread's address: `…/mistnosti/<room>/vlakno/<thread>` (the room by its slug or id). */
export const parseThreadLink = (link: string): { room: string; threadId: string } | null => {
    const match = /\/mistnosti\/([^/?#]+)\/vlakno\/([^/?#]+)/.exec(link.trim());
    return match ? { room: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) } : null;
};

const identicon = (author: string) => `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(author)}`;

/** Firestore Timestamp, or whatever a pending write holds. */
const millis = (value: unknown): number | null =>
    value && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : null;

type Status = StreamStats['status'];

interface Target {
    channelId: string;
    threadId: string;
    title: string;
    /** ms; the stream's start when it is one, so the dashboard can say whether it's on yet. */
    startsAt?: number;
}

interface KocouriChatClientOptions {
    /** A thread's link to follow; empty follows the room whose live stream is planned or on. */
    threadLink: string;
    onMessage: (msg: ChatMessage) => void;
    /** A message was deleted or removed by a moderator. */
    onModeration: (event: ModerationEvent) => void;
    onStatsUpdate: (stats: Partial<StreamStats>) => void;
    onStatusChange: (status: Status, error?: string) => void;
}

export class KocouriChatClient {
    private unsubRooms: Unsubscribe | null = null;
    private unsubThread: Unsubscribe | null = null;
    private target: Target | null = null;
    private stopped = false;

    constructor(private readonly options: KocouriChatClientOptions) {}

    async connect(): Promise<void> {
        const { onStatusChange } = this.options;
        const user = kocouriAuth().currentUser;
        if (!user) {
            onStatusChange('offline', 'Not signed in');
            return;
        }
        onStatusChange('connecting');
        const fs = await import('firebase/firestore');
        if (this.stopped) return;
        const db = fs.getFirestore(kocouriApp());

        // Only members may read the members, so a non-member is refused rather than told "missing".
        const notMember = `${user.email ?? 'This account'} isn't a member of Kocouří díra`;
        try {
            const member = await fs.getDoc(fs.doc(db, `${SERVER}/members/${user.uid}`));
            if (this.stopped) return;
            if (!member.exists()) {
                onStatusChange('error', notMember);
                return;
            }
        } catch (err) {
            if (!this.stopped) onStatusChange('error', (err as { code?: string })?.code === 'permission-denied' ? notMember : this.describe(err));
            return;
        }

        // Every client of the chat listens to the rooms, and a room carries its live stream
        // (`ChatChannel.live`) while it's upcoming or on, so this finds it at no extra cost there.
        this.unsubRooms = fs.onSnapshot(
            fs.query(fs.collection(db, `${SERVER}/channels`), fs.limit(ROOMS)),
            rooms => this.follow(fs, db, this.pick(rooms.docs)),
            err => this.fail(err),
        );
    }

    disconnect(): void {
        this.stopped = true;
        this.unsubRooms?.();
        this.unsubThread?.();
        this.unsubRooms = this.unsubThread = null;
    }

    /** The thread to follow: the pasted link's, or the live stream's nearest to now. */
    private pick(rooms: QueryDocumentSnapshot<DocumentData>[]): Target | null | 'not-found' {
        const link = this.options.threadLink.trim();
        if (link) {
            const parsed = parseThreadLink(link);
            if (!parsed) return 'not-found';
            const room = rooms.find(r => r.id === parsed.room || r.get('slug') === parsed.room || (r.get('formerSlugs') ?? []).includes(parsed.room));
            return room ? { channelId: room.id, threadId: parsed.threadId, title: '' } : 'not-found';
        }
        const now = Date.now();
        let best: Target | null = null;
        for (const room of rooms) {
            const live = room.get('live') as { threadId?: string; title?: string; startsAt?: number } | undefined;
            if (!live?.threadId || typeof live.startsAt !== 'number') continue;
            if (!best || Math.abs(live.startsAt - now) < Math.abs(best.startsAt! - now)) {
                best = { channelId: room.id, threadId: live.threadId, title: live.title ?? '', startsAt: live.startsAt };
            }
        }
        return best;
    }

    private follow(fs: typeof import('firebase/firestore'), db: Firestore, next: Target | null | 'not-found'): void {
        if (this.stopped) return;
        const { onStatusChange, onStatsUpdate } = this.options;
        if (next === 'not-found') {
            this.stopThread();
            onStatsUpdate({ title: 'Thread not found', isLive: false });
            onStatusChange('error', 'Thread link not found');
            return;
        }
        if (!next) {
            this.stopThread();
            onStatsUpdate({ title: 'No live stream planned', isLive: false });
            onStatusChange('offline', 'No live stream planned');
            return;
        }
        const current = this.target;
        if (current && current.channelId === next.channelId && current.threadId === next.threadId) {
            // The same thread: only its title or start may have changed.
            current.title = next.title || current.title;
            current.startsAt = next.startsAt;
            this.reportStats();
            return;
        }

        this.stopThread();
        this.target = { ...next };
        this.reportStats();
        const path = `${SERVER}/channels/${next.channelId}/threads/${next.threadId}`;
        if (!next.title) {
            fs.getDoc(fs.doc(db, path)).then(thread => {
                const target = this.target;
                if (this.stopped || !target || target.threadId !== next.threadId) return;
                target.title = (thread.get('live.title') as string | undefined) ?? (thread.get('name') as string | undefined) ?? '';
                this.reportStats();
            }).catch(() => { /* the replies' listener reports access problems */ });
        }

        let previousFloor: number | null = null;
        this.unsubThread = fs.onSnapshot(
            fs.query(fs.collection(db, `${path}/messages`), fs.orderBy('createdAt', 'desc'), fs.limit(PAGE)),
            snap => {
                if (this.stopped) return;
                onStatusChange('online');
                // The newest page only. A message leaving it because a newer one came isn't deleted,
                // and one coming back in from below (after a deletion) isn't new.
                const oldestKept = snap.size >= PAGE ? millis(snap.docs[snap.size - 1].get('createdAt')) : null;
                const floor = previousFloor;
                previousFloor = oldestKept;
                const added: ChatMessage[] = [];
                for (const change of snap.docChanges()) {
                    const data = change.doc.data();
                    const gone = data.deleted === true;
                    if (change.type === 'removed') {
                        const at = millis(data.createdAt);
                        if (oldestKept === null || (at !== null && at >= oldestKept)) this.options.onModeration({ type: 'delete', messageId: `kd-${change.doc.id}` });
                    } else if (gone) {
                        if (change.type === 'modified') this.options.onModeration({ type: 'delete', messageId: `kd-${change.doc.id}` });
                    } else if (change.type === 'added') {
                        const msg = this.toMessage(change.doc.id, data);
                        if (msg && (floor === null || msg.timestamp.getTime() >= floor)) added.push(msg);
                    }
                }
                // The store puts the newest first, so add the oldest first.
                added.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).forEach(this.options.onMessage);
            },
            err => this.fail(err),
        );
    }

    private toMessage(id: string, data: DocumentData): ChatMessage | null {
        const at = millis(data.createdAt);
        if (at === null || BOTS.has(data.authorId)) return null;
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        const files = Array.isArray(data.attachments) ? data.attachments.length : 0;
        if (!text && !files) return null;
        const author = typeof data.authorName === 'string' && data.authorName ? data.authorName : 'Člen';
        return {
            id: `kd-${id}`,
            author,
            authorId: `kd-${data.authorId}`,
            text: text || (files > 1 ? `📎 ${files} attachments` : '📎 Attachment'),
            platform: 'kocouri',
            timestamp: new Date(at),
            isRead: false,
            isFeatured: false,
            avatarUrl: typeof data.authorAvatar === 'string' && data.authorAvatar ? data.authorAvatar : identicon(author),
            isSpoiler: isSpoiler(text) || undefined,
        };
    }

    private reportStats(): void {
        const target = this.target;
        if (!target) return;
        this.options.onStatsUpdate({
            title: target.title || 'Thread',
            isLive: target.startsAt === undefined ? true : Date.now() >= target.startsAt,
        });
    }

    private stopThread(): void {
        this.unsubThread?.();
        this.unsubThread = null;
        this.target = null;
    }

    private fail(err: unknown): void {
        if (this.stopped) return;
        this.options.onStatusChange('error', this.describe(err));
    }

    private describe(err: unknown): string {
        const code = (err as { code?: string })?.code;
        if (code === 'permission-denied') {
            // Streams go into a staff room while in test, which only the owner and moderators may read.
            return 'No access: a staff room needs a moderator account';
        }
        if (code === 'unavailable') return 'Offline, retrying…';
        return (err as Error)?.message || 'Connection failed';
    }
}
