import { useRef, useEffect, useState } from 'react';
import { AppSettings, ChatMessage, StreamStats, HypeTrainData } from '@/types';
import { TwitchChatClient, ModerationEvent } from '@/services/twitchService';
import { YouTubeChatClient } from '@/services/youtubeService';
import { syncService } from '@/services/syncService';

interface UseChatConnectionProps {
    settings: AppSettings;
    addMessage: (msg: ChatMessage) => void;
    updateStats: (platform: 'twitch' | 'youtube', stats: Partial<StreamStats>) => void;
    incrementQuota: (units: number) => void;
    readOnly?: boolean;
    authReady?: boolean;
    /** A Twitch moderator deleted a message or cleared a user's messages. */
    onModeration?: (event: ModerationEvent) => void;
    /** Real Twitch profile pictures, keyed by user ID. */
    onAvatars?: (avatars: Record<string, string>) => void;
}

export const useChatConnection = ({ settings, addMessage, updateStats, incrementQuota, readOnly = false, authReady = false, onModeration, onAvatars }: UseChatConnectionProps) => {
    const twitchClient = useRef<TwitchChatClient | null>(null);
    const youtubeClient = useRef<YouTubeChatClient | null>(null);
    const [hypeTrain, setHypeTrain] = useState<HypeTrainData | null>(null);
    const hypeTrainRef = useRef<HypeTrainData | null>(null);

    // Keep ref in sync for callbacks
    useEffect(() => {
        hypeTrainRef.current = hypeTrain;
    }, [hypeTrain]);

    // The callbacks below live as long as the connection, so they must read these
    // flags through a ref. Capturing them directly froze `authReady` at its first
    // value (false), which meant the dashboard never wrote the Hype Train to Firebase.
    const live = useRef({ authReady, readOnly, showHypeTrain: settings.showHypeTrain, showSubscriptions: settings.showSubscriptions });
    live.current = { authReady, readOnly, showHypeTrain: settings.showHypeTrain, showSubscriptions: settings.showSubscriptions };
    const onModerationRef = useRef(onModeration);
    onModerationRef.current = onModeration;
    const onAvatarsRef = useRef(onAvatars);
    onAvatarsRef.current = onAvatars;

    useEffect(() => {
        // Cleanup previous connections
        if (twitchClient.current) twitchClient.current.disconnect();
        if (youtubeClient.current) youtubeClient.current.disconnect();

        // The overlay (OBS) only reads `currentComment` and `hypeTrain` from Firebase.
        // It has no login and must not open chat connections of its own.
        if (readOnly) return;

        // Reset stats
        updateStats('twitch', settings.twitchChannel
            ? { status: 'connecting', errorMessage: undefined, authIssue: undefined, tokenExpiresAt: undefined }
            : { viewers: 0, status: 'offline', title: 'Not connected', isLive: false, errorMessage: undefined, authIssue: undefined, tokenExpiresAt: undefined });
        updateStats('youtube', (settings.youtubeApiKey && settings.youtubeVideoId)
            ? { status: 'connecting', errorMessage: undefined, isLive: undefined }
            : { viewers: 0, status: 'offline', title: 'Not connected', errorMessage: undefined, isLive: undefined });

        // Twitch Connection (EventSub — needs the user's own Twitch login)
        if (settings.twitchChannel) {
            twitchClient.current = new TwitchChatClient({
                channel: settings.twitchChannel,
                accessToken: settings.twitchAccessToken,
                clientId: settings.twitchClientId,
                onMessage: (msg) => {
                    if (msg.eventType === 'subscription' && !live.current.showSubscriptions) return;
                    addMessage(msg);
                },
                onStatsUpdate: (stats) => updateStats('twitch', stats),
                onHypeTrainUpdate: (hypeTrainData) => {
                    if (!live.current.showHypeTrain) return;
                    // While a simulation runs, only a real active train may replace it.
                    if (hypeTrainRef.current?.isTest && hypeTrainRef.current?.isActive && !hypeTrainData) return;
                    if (live.current.authReady) syncService.setHypeTrain(hypeTrainData);
                },
                onStatusChange: (status, error) => updateStats('twitch', { status, errorMessage: error }),
                onModeration: (event) => onModerationRef.current?.(event),
                onAvatars: (avatars) => onAvatarsRef.current?.(avatars),
                logDebug: (category, message) => {
                    if (!live.current.authReady) return;
                    syncService.logHypeTrainEvent(category, message, false);
                },
            });
            twitchClient.current.connect();
        }

        // YouTube Connection
        if (settings.youtubeApiKey && settings.youtubeVideoId) {
            youtubeClient.current = new YouTubeChatClient(
                settings.youtubeApiKey,
                settings.youtubeVideoId,
                (msg) => addMessage(msg),
                (status, error) => {
                    updateStats('youtube', {
                        status: status,
                        errorMessage: error
                    });
                },
                incrementQuota,
                (stats) => updateStats('youtube', stats)
            );
            youtubeClient.current.connect();
        }

        return () => {
            twitchClient.current?.disconnect();
            youtubeClient.current?.disconnect();
        };
    }, [
        settings.twitchChannel,
        settings.youtubeApiKey,
        settings.youtubeVideoId,
        addMessage,
        updateStats,
        incrementQuota,
        settings.twitchAccessToken,
        settings.twitchClientId,
        readOnly
    ]);

    const simulateHypeTrain = (data: HypeTrainData | null) => {
        if (!authReady) return;
        syncService.setHypeTrain(data ? { ...data, isTest: true } : null);
    };

    useEffect(() => {
        const unsubscribe = syncService.listenToHypeTrain(setHypeTrain);

        if (!readOnly && authReady) {
            syncService.clearSimulatedHypeTrain();
        }

        return unsubscribe;
    }, [readOnly, authReady]);

    return {
        twitchClient,
        youtubeClient,
        hypeTrain,
        simulateHypeTrain
    };
};
