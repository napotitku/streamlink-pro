import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AppSettings } from '@/types';

interface AppSettingsContextType {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    quotaUsage: number;
    setQuotaUsage: React.Dispatch<React.SetStateAction<number>>;
    incrementQuota: (units: number) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
    twitchChannel: '',
    twitchClientId: import.meta.env.VITE_TWITCH_CLIENT_ID || '',
    twitchAccessToken: import.meta.env.VITE_TWITCH_ACCESS_TOKEN || '',
    youtubeVideoId: '',
    youtubeApiKey: import.meta.env.VITE_YOUTUBE_API_KEY || '',
    showAvatars: true,
    fontSize: 14,
    autoDismissEnabled: true,
    autoDismissSeconds: 15,
    showHypeTrain: true,
    showSubscriptions: true,
};

const getPTDateString = () => {
    return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};

export const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

export const AppSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(() => {
        try {
            const saved = localStorage.getItem('streamlink_settings');
            const parsed = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;

            // Enforce environment variables if they exist
            const envClientId = import.meta.env.VITE_TWITCH_CLIENT_ID;
            const envAccessToken = import.meta.env.VITE_TWITCH_ACCESS_TOKEN;
            const envChannel = import.meta.env.VITE_TWITCH_CHANNEL;

            return {
                ...DEFAULT_SETTINGS,
                ...parsed,
                twitchClientId: envClientId || parsed.twitchClientId || '',
                // Prioritize user-provided token (from OAuth) -> Env Token -> Persisted Token (fallback)
                twitchAccessToken: parsed.twitchAccessToken || envAccessToken || '',
                // Prioritize user-provided channel (from OAuth) -> Env Channel -> Persisted Channel (fallback)
                twitchChannel: parsed.twitchChannel || envChannel || '',
                youtubeVideoId: '' // Always reset video ID on load
            };
        } catch (e) {
            return DEFAULT_SETTINGS;
        }
    });

    const [quotaUsage, setQuotaUsage] = useState<number>(() => {
        try {
            const savedUsage = localStorage.getItem('youtube_quota_usage');
            const lastReset = localStorage.getItem('youtube_quota_last_reset');
            const todayPT = getPTDateString();

            if (lastReset !== todayPT) {
                localStorage.setItem('youtube_quota_last_reset', todayPT);
                localStorage.setItem('youtube_quota_usage', '0');
                return 0;
            }
            return savedUsage ? parseInt(savedUsage, 10) : 0;
        } catch (e) {
            return 0;
        }
    });

    useEffect(() => {
        // Strip all sensitive credentials from localStorage — they are sourced from
        // import.meta.env on every load, so omitting them here has no functional impact.
        const {
            youtubeVideoId,       // always reset on load
            twitchAccessToken,    // OAuth token — must never be persisted
            twitchClientId,       // API credential
            youtubeApiKey,        // API credential
            ...persistentSettings
        } = settings;
        localStorage.setItem('streamlink_settings', JSON.stringify(persistentSettings));
    }, [settings]);

    useEffect(() => {
        localStorage.setItem('youtube_quota_usage', quotaUsage.toString());
    }, [quotaUsage]);

    const incrementQuota = useCallback((units: number) => {
        setQuotaUsage(prev => prev + units);
    }, []);

    return (
        <AppSettingsContext.Provider value={{
            settings,
            setSettings,
            quotaUsage,
            setQuotaUsage,
            incrementQuota
        }}>
            {children}
        </AppSettingsContext.Provider>
    );
};
