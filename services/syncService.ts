/**
 * syncService.ts
 *
 * Single-responsibility abstraction over all Firebase Realtime Database
 * reads and writes. No Firebase SDK methods should be imported directly
 * in presentation components or hooks — route everything through here.
 */

import { ref, set, get, onValue, push } from 'firebase/database';
import { db } from '@/src/firebase';
import { ChatMessage, HypeTrainData } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeaturedMessagePayload {
    type: 'SET_FEATURED' | 'CLEAR_FEATURED';
    payload: (ChatMessage & { featuredAt: number }) | null;
    timestamp: number;
    autoDismissEnabled: boolean;
    autoDismissSeconds: number;
    featuredAt: number | null;
}

type Unsubscribe = () => void;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Recursively strips `undefined` values — Firebase rejects them. */
const sanitize = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(sanitize);
    return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, sanitize(v)])
    );
};

// ─── Featured message (currentComment) ───────────────────────────────────────

export const syncService = {
    /**
     * Subscribes to the `currentComment` node.
     * Fires immediately with the current value, then on every change.
     * Returns an unsubscribe function.
     */
    listenToFeaturedMessage(callback: (payload: FeaturedMessagePayload | null) => void): Unsubscribe {
        const dbRef = ref(db, 'currentComment');
        return onValue(dbRef, (snapshot) => {
            const data = snapshot.val() as FeaturedMessagePayload | null;
            callback(data);
        });
    },

    /** One-off read of `currentComment`, used to restore the on-air message after a dashboard reload. */
    async getFeaturedMessage(): Promise<FeaturedMessagePayload | null> {
        const snapshot = await get(ref(db, 'currentComment'));
        return snapshot.val() as FeaturedMessagePayload | null;
    },

    /**
     * Writes a featured-message payload to `currentComment`.
     * Pass `null` to clear.
     */
    setFeaturedMessage(payload: FeaturedMessagePayload | null): Promise<void> {
        return set(ref(db, 'currentComment'), sanitize(payload));
    },

    // ─── Hype Train (hypeTrain) ───────────────────────────────────────────────

    /** Subscribes to the `hypeTrain` node. */
    listenToHypeTrain(callback: (data: HypeTrainData | null) => void): Unsubscribe {
        const dbRef = ref(db, 'hypeTrain');
        return onValue(dbRef, (snapshot) => {
            callback(snapshot.val() as HypeTrainData | null);
        });
    },

    /** Writes a HypeTrain state update. Pass `null` to clear. */
    setHypeTrain(data: HypeTrainData | null): Promise<void> {
        return set(ref(db, 'hypeTrain'), data);
    },

    /**
     * Clears a stale test/simulation HypeTrain on Dashboard mount.
     * No-op if the current value is not a test entry.
     */
    async clearSimulatedHypeTrain(): Promise<void> {
        const dbRef = ref(db, 'hypeTrain');
        const snapshot = await get(dbRef);
        const data = snapshot.val() as HypeTrainData | null;
        if (data?.isTest) {
            await set(dbRef, null);
        }
    },

    // ─── Debug logging ────────────────────────────────────────────────────────

    /** Writes a structured log entry to `debug_logs/hype_train`. */
    logHypeTrainEvent(category: string, message: string, readOnly: boolean): Promise<void> {
        const logRef = push(ref(db, 'debug_logs/hype_train'));
        return set(logRef, sanitize({
            timestamp: new Date().toISOString(),
            category,
            message,
            readOnly,
        }));
    },
};
