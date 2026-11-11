import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, ChatMessage, StreamStats, Platform } from '@/types';
import { syncService, FeaturedMessagePayload } from '@/services/syncService';
import type { ModerationEvent } from '@/services/twitchService';

const MAX_MESSAGES = 200;
const syncChannel = new BroadcastChannel('streamlink_sync');

type StoreState = Omit<AppState, 'settings' | 'quotaUsage'>;

const unfeature = (m: ChatMessage): ChatMessage => (m.isFeatured || m.featuredAt ? { ...m, isFeatured: false, featuredAt: undefined } : m);

/**
 * Messages, the on-air ("featured") message and the "Up next" queue.
 *
 * Firebase writes happen in the action functions, never inside setState updaters
 * (React may run updaters twice, which used to double every write).
 */
export const useMessageStore = (
    settings: { autoDismissEnabled: boolean; autoDismissSeconds: number },
    options: { restoreFeatured?: boolean } = {}
) => {
    const [state, setState] = useState<StoreState>({
        messages: [],
        featuredMessage: null,
        queue: [],
        stats: {
            twitch: { viewers: 0, status: 'offline', title: 'Not connected' },
            youtube: { viewers: 0, status: 'offline', title: 'Not connected' },
        },
    });
    // Synchronous view of the latest state for the action functions.
    const stateRef = useRef(state);
    stateRef.current = state;

    const broadcastFeatured = useCallback((msg: ChatMessage | null) => {
        const featuredAt = msg ? (msg.featuredAt ?? Date.now()) : null;
        const payload: FeaturedMessagePayload = {
            type: msg ? 'SET_FEATURED' : 'CLEAR_FEATURED',
            payload: msg ? { ...msg, featuredAt: featuredAt as number } : null,
            timestamp: Date.now(),
            autoDismissEnabled: settings.autoDismissEnabled,
            autoDismissSeconds: settings.autoDismissSeconds,
            featuredAt,
        };
        syncService.setFeaturedMessage(payload).catch(err => console.warn('[sync] featured write failed', err));
        syncChannel.postMessage(payload);
    }, [settings.autoDismissEnabled, settings.autoDismissSeconds]);

    const addMessage = useCallback((msg: ChatMessage) => {
        setState(prev => {
            if (prev.messages.some(m => m.id === msg.id)) return prev;
            const finalMsg = { ...msg };
            // Donations stay pinned in the side panel for 60 s unless the source says otherwise.
            if (finalMsg.donationAmount && !finalMsg.pinnedDuration) {
                finalMsg.pinnedDuration = 60;
                finalMsg.pinnedAt = Date.now();
            }
            const messages = [finalMsg, ...prev.messages].slice(0, MAX_MESSAGES);
            const kept = new Set(messages.map(m => m.id));
            return { ...prev, messages, queue: prev.queue.filter(id => kept.has(id)) };
        });
    }, []);

    /** Puts a message on air. Whatever was on air before counts as read. */
    const featureMessage = useCallback((id: string) => {
        const msg = stateRef.current.messages.find(m => m.id === id);
        if (!msg) {
            setState(prev => ({ ...prev, queue: prev.queue.filter(q => q !== id) }));
            return;
        }
        const featuredAt = Date.now();
        const onAir: ChatMessage = { ...msg, isFeatured: true, isRead: false, isTrashed: false, featuredAt };
        broadcastFeatured(onAir);

        setState(prev => {
            const prevId = prev.featuredMessage?.id;
            return {
                ...prev,
                featuredMessage: onAir,
                queue: prev.queue.filter(q => q !== id),
                messages: prev.messages.map(m => {
                    if (m.id === id) return onAir;
                    if (m.id === prevId) return { ...unfeature(m), isRead: true };
                    return unfeature(m);
                }),
            };
        });
    }, [broadcastFeatured]);

    /** Takes a message off air (if it is on air) and marks it read. */
    const markAsRead = useCallback((id: string) => {
        if (stateRef.current.featuredMessage?.id === id) broadcastFeatured(null);
        setState(prev => ({
            ...prev,
            featuredMessage: prev.featuredMessage?.id === id ? null : prev.featuredMessage,
            messages: prev.messages.map(m => m.id === id ? { ...unfeature(m), isRead: true, isTrashed: false } : m),
        }));
    }, [broadcastFeatured]);

    const clearFeatured = useCallback(() => {
        const current = stateRef.current.featuredMessage;
        if (current) markAsRead(current.id);
        else broadcastFeatured(null);
    }, [markAsRead, broadcastFeatured]);

    const markAsTrashed = useCallback((id: string) => {
        if (stateRef.current.featuredMessage?.id === id) broadcastFeatured(null);
        setState(prev => ({
            ...prev,
            featuredMessage: prev.featuredMessage?.id === id ? null : prev.featuredMessage,
            queue: prev.queue.filter(q => q !== id),
            messages: prev.messages.map(m => m.id === id ? { ...unfeature(m), isRead: true, isTrashed: true } : m),
        }));
    }, [broadcastFeatured]);

    /** A Twitch mod deleted a message or banned/timed out a user: trash it, and take it off air. */
    const applyModeration = useCallback((event: ModerationEvent) => {
        const hit = (m: ChatMessage) => event.type === 'delete' ? m.id === event.messageId : (!!m.authorId && m.authorId === event.userId);
        const featured = stateRef.current.featuredMessage;
        const featuredHit = !!featured && hit(featured);
        if (featuredHit) broadcastFeatured(null);
        setState(prev => {
            const removed = new Set(prev.messages.filter(hit).map(m => m.id));
            return {
                ...prev,
                featuredMessage: prev.featuredMessage && hit(prev.featuredMessage) ? null : prev.featuredMessage,
                queue: prev.queue.filter(id => !removed.has(id)),
                messages: prev.messages.map(m => removed.has(m.id) ? { ...unfeature(m), isRead: true, isTrashed: true } : m),
            };
        });
    }, [broadcastFeatured]);

    const toggleInteresting = useCallback((id: string) => {
        setState(prev => ({
            ...prev,
            messages: prev.messages.map(m => m.id === id ? { ...m, isInteresting: !m.isInteresting } : m),
        }));
    }, []);

    /** Adds a message to the "Up next" queue, or removes it if already queued. */
    const toggleQueued = useCallback((id: string) => {
        setState(prev => {
            if (prev.featuredMessage?.id === id) return prev;
            const queued = prev.queue.includes(id);
            return {
                ...prev,
                queue: queued ? prev.queue.filter(q => q !== id) : [...prev.queue, id],
                messages: queued ? prev.messages : prev.messages.map(m => m.id === id ? { ...m, isRead: false, isTrashed: false } : m),
            };
        });
    }, []);

    const updateStats = useCallback((platform: Platform, newStats: Partial<StreamStats>) => {
        setState(prev => ({
            ...prev,
            stats: { ...prev.stats, [platform]: { ...prev.stats[platform], ...newStats } },
        }));
    }, []);

    // Another dashboard tab featured or cleared a message.
    useEffect(() => {
        const handleSync = (event: MessageEvent<FeaturedMessagePayload>) => {
            const data = event.data;
            if (data.type === 'SET_FEATURED' && data.payload) {
                const incoming = { ...data.payload, timestamp: new Date(data.payload.timestamp) } as ChatMessage;
                setState(prev => ({
                    ...prev,
                    featuredMessage: incoming,
                    queue: prev.queue.filter(q => q !== incoming.id),
                    messages: prev.messages.map(m => m.id === incoming.id ? { ...m, isFeatured: true, featuredAt: incoming.featuredAt } : unfeature(m)),
                }));
            } else if (data.type === 'CLEAR_FEATURED') {
                setState(prev => ({
                    ...prev,
                    featuredMessage: null,
                    messages: prev.messages.map(m => prev.featuredMessage?.id === m.id ? { ...unfeature(m), isRead: true } : unfeature(m)),
                }));
            }
        };
        syncChannel.addEventListener('message', handleSync);
        return () => syncChannel.removeEventListener('message', handleSync);
    }, []);

    // After a dashboard reload, pick up whatever is still on the overlay instead of wiping it.
    useEffect(() => {
        if (!options.restoreFeatured) return;
        let cancelled = false;
        syncService.getFeaturedMessage().then(data => {
            if (cancelled || !data || data.type !== 'SET_FEATURED' || !data.payload) return;
            const featuredAt = data.featuredAt ?? data.payload.featuredAt;
            const expired = data.autoDismissEnabled && featuredAt && Date.now() > featuredAt + data.autoDismissSeconds * 1000;
            if (expired) {
                // The dashboard that featured it closed before the timer fired: clean up now.
                syncService.setFeaturedMessage(null).catch(() => {});
                return;
            }
            const restored = { ...data.payload, timestamp: new Date(data.payload.timestamp), isFeatured: true } as ChatMessage;
            setState(prev => prev.featuredMessage ? prev : ({
                ...prev,
                featuredMessage: restored,
                messages: prev.messages.some(m => m.id === restored.id) ? prev.messages : [restored, ...prev.messages],
            }));
        }).catch(() => { /* not signed in yet or offline — nothing to restore */ });
        return () => { cancelled = true; };
    }, [options.restoreFeatured]);

    return {
        state,
        addMessage,
        markAsRead,
        clearFeatured,
        featureMessage,
        markAsTrashed,
        toggleInteresting,
        toggleQueued,
        updateStats,
        applyModeration,
        broadcastFeatured,
    };
};
