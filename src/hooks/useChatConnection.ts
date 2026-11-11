import { useRef, useEffect, useState } from 'react';
import { AppSettings, ChatMessage, StreamStats, HypeTrainData } from '@/types';
import { TwitchChatClient } from '@/services/twitchService';
import { YouTubeChatClient } from '@/services/youtubeService';
import { syncService } from '@/services/syncService';

interface UseChatConnectionProps {
    settings: AppSettings;
    addMessage: (msg: ChatMessage) => void;
    updateStats: (platform: 'twitch' | 'youtube', stats: Partial<StreamStats>) => void;
    incrementQuota: (units: number) => void;
    readOnly?: boolean;
    authReady?: boolean;
}

export const useChatConnection = ({ settings, addMessage, updateStats, incrementQuota, readOnly = false, authReady = false }: UseChatConnectionProps) => {
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

    useEffect(() => {
        // Cleanup previous connections
        if (twitchClient.current) twitchClient.current.disconnect();
        if (youtubeClient.current) youtubeClient.current.disconnect();

        // Reset stats
        updateStats('twitch', settings.twitchChannel
            ? { status: 'connecting', authExpired: false, tokenExpiresAt: undefined }
            : { viewers: 0, status: 'offline', title: 'Not connected', isLive: false, authExpired: false, tokenExpiresAt: undefined });
        updateStats('youtube', (settings.youtubeApiKey && settings.youtubeVideoId) ? { status: 'connecting' } : { viewers: 0, status: 'offline', title: 'Not connected' });

        // Twitch Connection
        if (settings.twitchChannel) {
            twitchClient.current = new TwitchChatClient(
                settings.twitchChannel,
                (msg) => {
                    // Check settings for subscriptions
                    if (msg.eventType === 'subscription' && !live.current.showSubscriptions) {
                        return;
                    }
                    addMessage(msg);
                },
                (stats) => updateStats('twitch', stats),
                (hypeTrainData) => {
                    // Check if Hype Train is enabled
                    if (!live.current.showHypeTrain) return;

                    // Check if we are currently running a simulation
                    if (hypeTrainRef.current?.isTest && hypeTrainRef.current?.isActive) {
                        // If simulation is active, only allow OVERWRITE if the new data is ALSO active (real train started)
                        // If new data is null (no train), ignore it to prevent clearing the simulation
                        if (!hypeTrainData) return;
                    }

                    // Write to Firebase — only when authenticated AND not in read-only mode
                    const { readOnly: isReadOnly, authReady: canWrite } = live.current;
                    if (!isReadOnly && canWrite) {
                        syncService.setHypeTrain(hypeTrainData);
                    } else if (isReadOnly) {
                        setHypeTrain(hypeTrainData);
                    }
                },
                settings.twitchAccessToken,
                settings.twitchClientId,
                (status, error) => {
                    updateStats('twitch', {
                        status: status as any,
                        errorMessage: error
                    });
                },
                (category, message) => {
                    // The overlay has no signed-in user, so the database rules reject its writes.
                    if (!live.current.authReady || live.current.readOnly) return;
                    syncService.logHypeTrainEvent(category, message, false);
                }
            );
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
        settings.twitchClientId
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
