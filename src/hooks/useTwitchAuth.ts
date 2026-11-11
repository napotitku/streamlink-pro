import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppSettings } from '@/types';
import {
    TwitchSession,
    callableErrorCode,
    clearTwitchRedirectFromUrl,
    exchangeTwitchCode,
    forgetTwitchLogin,
    readTwitchRedirect,
    refreshTwitchToken,
    startTwitchLogin,
    TwitchRedirectResult,
} from '@/src/twitchAuth';

/**
 * The login redirect is read once per page load, at module level: React's StrictMode
 * renders twice, and a second read would find the state already used and the URL cleared.
 */
let pageRedirect: TwitchRedirectResult | null = null;
const takeTwitchRedirect = (): TwitchRedirectResult => {
    if (pageRedirect === null) {
        pageRedirect = typeof window !== 'undefined' ? readTwitchRedirect() : { kind: 'none' };
        if (pageRedirect.kind !== 'none') clearTwitchRedirectFromUrl();
    }
    return pageRedirect;
};

/** Renew the access token this long before Twitch says it expires. */
const RENEW_BEFORE_MS = 10 * 60 * 1000;

interface Options {
    /** True on the dashboard once the Google user is signed in and allowlisted. */
    enabled: boolean;
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    authIssue?: 'expired' | 'scopes';
    tokenExpiresAt?: number;
}

/**
 * Keeps the dashboard logged in to Twitch:
 * - finishes a login when Twitch redirects back with `?code=…`
 * - after a browser restart, gets a new access token from the server without asking
 * - renews the token shortly before it expires, and once more if Twitch rejects it
 */
export function useTwitchAuth({ enabled, settings, setSettings, authIssue, tokenExpiresAt }: Options) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const token = settings.twitchAccessToken || '';

    const redirect = useRef<TwitchRedirectResult>(takeTwitchRedirect());

    const applySession = useCallback((session: TwitchSession, newLogin: boolean) => {
        setSettings(prev => ({
            ...prev,
            twitchAccessToken: session.accessToken,
            // A fresh login switches to that account's channel; a renewal keeps the chosen channel.
            twitchChannel: newLogin || !prev.twitchChannel ? session.login : prev.twitchChannel,
        }));
    }, [setSettings]);

    /** Ask the server for a new access token. Returns false if there's no usable saved login. */
    const renew = useCallback(async (): Promise<boolean> => {
        try {
            applySession(await refreshTwitchToken(), false);
            return true;
        } catch (err) {
            const code = callableErrorCode(err);
            if (code !== 'functions/not-found') console.warn('[TwitchAuth] Renewing the Twitch login failed:', err);
            return false;
        }
    }, [applySession]);

    // 1. Finish a login: Twitch redirected back with a one-time code.
    const handledRedirect = useRef(false);
    useEffect(() => {
        if (!enabled || handledRedirect.current) return;
        const result = redirect.current;
        if (result.kind === 'none') return;
        handledRedirect.current = true;

        if (result.kind === 'error') {
            setError(result.message);
            return;
        }
        setBusy(true);
        exchangeTwitchCode(result.code)
            .then(session => { applySession(session, true); setError(null); })
            .catch(err => {
                console.error('[TwitchAuth] Twitch login failed:', err);
                setError((err as Error).message || 'Twitch login failed. Try again.');
            })
            .finally(() => setBusy(false));
    }, [enabled, applySession]);

    // 2. No token in this tab (e.g. after a browser restart): restore it quietly.
    const triedRestore = useRef(false);
    useEffect(() => {
        if (!enabled || token || triedRestore.current) return;
        if (redirect.current.kind === 'code') return; // the exchange above provides the token
        triedRestore.current = true;
        void renew();
    }, [enabled, token, renew]);

    // 3. Renew shortly before the token expires.
    useEffect(() => {
        if (!enabled || !token || !tokenExpiresAt) return;
        const wait = Math.max(0, tokenExpiresAt - Date.now() - RENEW_BEFORE_MS);
        const timer = setTimeout(() => { void renew(); }, wait);
        return () => clearTimeout(timer);
    }, [enabled, token, tokenExpiresAt, renew]);

    // 4. Twitch rejected the token anyway: try one renewal before asking the user to log in.
    //    One attempt per episode; it resets once a working token clears `authIssue`.
    const triedRenewal = useRef(false);
    useEffect(() => {
        if (!enabled) return;
        if (authIssue !== 'expired') {
            triedRenewal.current = false;
            return;
        }
        if (triedRenewal.current) return;
        triedRenewal.current = true;
        void renew();
    }, [enabled, authIssue, renew]);

    const login = useCallback(() => {
        if (!startTwitchLogin(settings.twitchClientId)) {
            setError('Missing Twitch Client ID. Set VITE_TWITCH_CLIENT_ID in .env first.');
        }
    }, [settings.twitchClientId]);

    const logout = useCallback(async () => {
        const current = token;
        setSettings(prev => ({ ...prev, twitchAccessToken: '', twitchChannel: '' }));
        try {
            await forgetTwitchLogin(current || undefined);
        } catch (err) {
            console.warn('[TwitchAuth] Server logout failed:', err);
        }
    }, [token, setSettings]);

    return { busy, error, dismissError: () => setError(null), login, logout };
}
