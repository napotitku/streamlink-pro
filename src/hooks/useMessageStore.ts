import { useState, useCallback, useEffect } from 'react';
import { AppState, ChatMessage, StreamStats, Platform } from '@/types';
import { syncService } from '@/services/syncService';
import type { ModerationEvent } from '@/services/twitchService';

const syncChannel = new BroadcastChannel('streamlink_sync');

export const useMessageStore = (settings: { autoDismissEnabled: boolean; autoDismissSeconds: number }) => {
    const [state, setState] = useState<AppState>({
        messages: [],
        featuredMessage: null,
        stats: {
            twitch: { viewers: 0, status: 'offline', title: 'Not connected' },
            youtube: { viewers: 0, status: 'offline', title: 'Not connected' },
        },
        // Settings and quota are managed by useAppSettings but passed partly into state for potential unified access if needed.
        // However, in this refactor, we might want to keep them separate. 
        // For now, to minimize disruption, we will initialize them empty or update them via props if needed,
        // but the original AppState included them. We will need to sync them or modify AppState type usage.
        // Since AppState is used in DashboardProps, let's keep it syncable or create a derived state in App.tsx
        settings: { ...settings, twitchChannel: '', youtubeVideoId: '', youtubeApiKey: '', showAvatars: true, fontSize: 14 } as any,
        quotaUsage: 0
    });

    const broadcastFeatured = useCallback((msg: ChatMessage | null) => {
        const featuredAt = msg ? Date.now() : null;
        const payload = {
            type: msg ? 'SET_FEATURED' as const : 'CLEAR_FEATURED' as const,
            payload: msg ? { ...msg, featuredAt: featuredAt as number } : null,
            timestamp: Date.now(),
            autoDismissEnabled: settings.autoDismissEnabled,
            autoDismissSeconds: settings.autoDismissSeconds,
            featuredAt,
        };

        syncService.setFeaturedMessage(payload);

        syncChannel.postMessage(payload);
        localStorage.setItem('streamlink_sync_event', JSON.stringify(payload));
    }, [settings.autoDismissEnabled, settings.autoDismissSeconds]);

    const addMessage = useCallback((msg: ChatMessage) => {
        setState(prev => {
            if (prev.messages.some(m => m.id === msg.id)) return prev;

            // Donation Logic: If message has donationAmount, ensure pinnedDuration is set if not already
            // This logic can be expanded for real defaults based on amount
            let finalMsg = { ...msg };
            if (finalMsg.donationAmount && !finalMsg.pinnedDuration) {
                // Default durations based on amount could go here.
                // For now, let's say any donation gets 60s if not specified.
                finalMsg.pinnedDuration = 60;
                finalMsg.pinnedAt = Date.now();
            }

            return {
                ...prev,
                messages: [finalMsg, ...prev.messages].slice(0, 200)
            };
        });
    }, []);

    const markAsRead = useCallback((id: string) => {
        setState(prev => {
            const isCurrentlyFeatured = prev.featuredMessage?.id === id;
            if (isCurrentlyFeatured) {
                broadcastFeatured(null);
            }
            return {
                ...prev,
                featuredMessage: isCurrentlyFeatured ? null : prev.featuredMessage,
                messages: prev.messages.map(m => m.id === id ? { ...m, isRead: true, isFeatured: false, isTrashed: false, featuredAt: undefined } : m)
            };
        });
    }, [broadcastFeatured]);

    const clearFeatured = useCallback(() => {
        broadcastFeatured(null);
        setState(prev => ({
            ...prev,
            featuredMessage: null,
            messages: prev.messages.map(m => ({ ...m, isFeatured: false, featuredAt: undefined }))
        }));
    }, [broadcastFeatured]);

    const featureMessage = useCallback((id: string) => {
        setState(prev => {
            const msg = prev.messages.find(m => m.id === id) || null;
            const prevFeaturedId = prev.featuredMessage?.id;
            const featuredAt = Date.now();

            const updatedMsg = msg ? { ...msg, isFeatured: true, featuredAt } : null;
            broadcastFeatured(updatedMsg);

            return {
                ...prev,
                featuredMessage: updatedMsg,
                messages: prev.messages.map(m => {
                    if (m.id === id) {
                        return { ...m, isFeatured: true, isRead: false, isTrashed: false, featuredAt };
                    }
                    if (prevFeaturedId && m.id === prevFeaturedId && m.id !== id) {
                        return { ...m, isFeatured: false, isRead: true, isTrashed: false, featuredAt: undefined };
                    }
                    return { ...m, isFeatured: false, featuredAt: undefined };
                })
            };
        });
    }, [broadcastFeatured]);

    const markAsTrashed = useCallback((id: string) => {
        setState(prev => {
            const isCurrentlyFeatured = prev.featuredMessage?.id === id;
            if (isCurrentlyFeatured) {
                broadcastFeatured(null);
            }
            return {
                ...prev,
                featuredMessage: isCurrentlyFeatured ? null : prev.featuredMessage,
                messages: prev.messages.map(m => m.id === id ? { ...m, isRead: true, isTrashed: true, isFeatured: false, featuredAt: undefined } : m)
            };
        });
    }, [broadcastFeatured]);

    /** A Twitch mod deleted a message or banned/timed out a user: trash it, and take it off air. */
    const applyModeration = useCallback((event: ModerationEvent) => {
        const hit = (m: ChatMessage) => event.type === 'delete' ? m.id === event.messageId : (!!m.authorId && m.authorId === event.userId);
        setState(prev => {
            const featuredHit = !!prev.featuredMessage && hit(prev.featuredMessage);
            if (featuredHit) broadcastFeatured(null);
            return {
                ...prev,
                featuredMessage: featuredHit ? null : prev.featuredMessage,
                messages: prev.messages.map(m => hit(m) ? { ...m, isRead: true, isTrashed: true, isFeatured: false, featuredAt: undefined } : m)
            };
        });
    }, [broadcastFeatured]);

    const toggleInteresting = useCallback((id: string) => {
        setState(prev => ({
            ...prev,
            messages: prev.messages.map(m =>
                m.id === id ? { ...m, isInteresting: !m.isInteresting } : m
            )
        }));
    }, []);

    const updateStats = useCallback((platform: Platform, newStats: Partial<StreamStats>) => {
        setState(prev => ({
            ...prev,
            stats: {
                ...prev.stats,
                [platform]: { ...prev.stats[platform], ...newStats }
            }
        }));
    }, []);

    useEffect(() => {
        const handleSync = (event: MessageEvent) => {
            if (event.data.type === 'SET_FEATURED') {
                setState(prev => ({
                    ...prev,
                    featuredMessage: event.data.payload,
                    messages: prev.messages.map(m => ({
                        ...m,
                        isFeatured: m.id === event.data.payload?.id,
                        featuredAt: m.id === event.data.payload?.id ? event.data.payload?.featuredAt : m.featuredAt
                    }))
                }));
            } else if (event.data.type === 'CLEAR_FEATURED') {
                setState(prev => ({
                    ...prev,
                    featuredMessage: null,
                    messages: prev.messages.map(m => {
                        // When clearing featured, mark the one that WAS featured as read
                        if (prev.featuredMessage?.id === m.id) {
                            return { ...m, isFeatured: false, isRead: true, featuredAt: undefined };
                        }
                        return { ...m, isFeatured: false, featuredAt: undefined };
                    })
                }));
            }
        };

        syncChannel.addEventListener('message', handleSync);
        return () => syncChannel.removeEventListener('message', handleSync);
    }, []);

    return {
        state,
        setState,
        addMessage,
        markAsRead,
        clearFeatured,
        featureMessage,
        markAsTrashed,
        toggleInteresting,
        updateStats,
        applyModeration,
        broadcastFeatured // Exported for auto-dismiss logic
    };
};
