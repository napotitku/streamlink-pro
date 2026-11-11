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

    // Bumped to force a fresh Twitch client (new login, logout, or a token the
    // running client can't take over in place).
    const [twitchGeneration, setTwitchGeneration] = useState(0);
    /** The token the current Twitch client is using. */
    const activeTwitchToken = useRef<string>('');
    const tokenRef = useRef(settings.twitchAccessToken);
    tokenRef.current = settings.twitchAccessToken;

    // ── Twitch (EventSub — needs the user's own Twitch login) ────────────────
    useEffect(() => {
        // The overlay (OBS) only reads `currentComment` and `hypeTrain` from Firebase.
        // It has no login and must not open chat connections of its own.
        if (readOnly) return;

        updateStats('twitch', settings.twitchChannel
            ? { status: 'connecting', errorMessage: undefined, authIssue: undefined, tokenExpiresAt: undefined }
            : { viewers: 0, status: 'offline', title: 'Not connected', isLive: false, errorMessage: undefined, authIssue: undefined, tokenExpiresAt: undefined });
        if (!settings.twitchChannel) return;

        const token = tokenRef.current || '';
        activeTwitchToken.current = token;
        const client = new TwitchChatClient({
            channel: settings.twitchChannel,
            accessToken: token,
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
        twitchClient.current = client;
        client.connect();

        return () => {
            client.disconnect();
            if (twitchClient.current === client) twitchClient.current = null;
        };
    }, [settings.twitchChannel, settings.twitchClientId, twitchGeneration, readOnly, addMessage, updateStats]);

    // A new token: hand it to the running client if it's the same Twitch account
    // (a routine refresh — no reconnect, no missed events); otherwise start over.
    useEffect(() => {
        if (readOnly) return;
        const token = settings.twitchAccessToken || '';
        if (token === activeTwitchToken.current) return;
        const client = twitchClient.current;
        if (!client || !token) {
            setTwitchGeneration(g => g + 1);
            return;
        }
        let cancelled = false;
        client.updateToken(token).then(swapped => {
            if (cancelled) return;
            if (swapped) activeTwitchToken.current = token;
            else setTwitchGeneration(g => g + 1);
        });
        return () => { cancelled = true; };
    }, [settings.twitchAccessToken, readOnly]);

    // ── YouTube ──────────────────────────────────────────────────────────────
    useEffect(() => {
        if (readOnly) return;
        const configured = !!(settings.youtubeApiKey && settings.youtubeVideoId);
        updateStats('youtube', configured
            ? { status: 'connecting', errorMessage: undefined, isLive: undefined }
            : { viewers: 0, status: 'offline', title: 'Not connected', errorMessage: undefined, isLive: undefined });
        if (!configured) return;

        const client = new YouTubeChatClient(
            settings.youtubeApiKey,
            settings.youtubeVideoId,
            (msg) => addMessage(msg),
            (status, error) => updateStats('youtube', { status, errorMessage: error }),
            incrementQuota,
            (stats) => updateStats('youtube', stats)
        );
        youtubeClient.current = client;
        client.connect();

        return () => {
            client.disconnect();
            if (youtubeClient.current === client) youtubeClient.current = null;
        };
    }, [settings.youtubeApiKey, settings.youtubeVideoId, readOnly, addMessage, updateStats, incrementQuota]);

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
