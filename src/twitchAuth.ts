/**
 * Twitch login (OAuth Authorization Code flow).
 *
 * 1. startTwitchLogin() sends the streamer to Twitch with a random `state`.
 * 2. Twitch redirects back to `/?code=…&state=…`; readTwitchRedirect() checks the state.
 * 3. exchangeTwitchCode() hands the code to the `twitchExchangeCode` Cloud Function, which
 *    keeps the refresh token server-side and returns a short-lived access token.
 * 4. refreshTwitchToken() gets a new access token whenever the current one is missing or
 *    about to expire, so the streamer doesn't have to log in again.
 *
 * The access token is kept in sessionStorage (survives a reload, not closing the browser);
 * after a browser restart the dashboard silently fetches a new one from the function.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/src/firebase';

/** Scopes needed by the EventSub client: reading chat, and the Hype Train (broadcaster only). */
export const TWITCH_SCOPES = ['user:read:chat', 'channel:read:hype_train'] as const;

const STATE_KEY = 'streamlink_twitch_oauth_state';
const TOKEN_KEY = 'streamlink_twitch_token';

export const getTwitchClientId = (override?: string): string =>
    (override || import.meta.env.VITE_TWITCH_CLIENT_ID || '').trim();

/** Must exactly match an "OAuth Redirect URL" of the Twitch app (no trailing slash). */
export const twitchRedirectUri = (): string => window.location.origin;

const safeSession = {
    get(key: string): string | null {
        try { return sessionStorage.getItem(key); } catch { return null; }
    },
    set(key: string, value: string | null) {
        try {
            if (value) sessionStorage.setItem(key, value);
            else sessionStorage.removeItem(key);
        } catch { /* storage blocked — token stays in memory only */ }
    },
};

export const loadTwitchToken = (): string => safeSession.get(TOKEN_KEY) || '';
export const saveTwitchToken = (token: string | undefined) => safeSession.set(TOKEN_KEY, token || null);

/** Redirects to Twitch's consent page. Returns false when no client ID is configured. */
export function startTwitchLogin(clientIdOverride?: string): boolean {
    const clientId = getTwitchClientId(clientIdOverride);
    if (!clientId) return false;

    const state = crypto.randomUUID();
    safeSession.set(STATE_KEY, state);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: twitchRedirectUri(),
        response_type: 'code',
        scope: TWITCH_SCOPES.join(' '),
        state,
    });
    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params}`;
    return true;
}

export type TwitchRedirectResult =
    | { kind: 'code'; code: string }
    | { kind: 'error'; message: string }
    | { kind: 'none' };

/**
 * Reads the OAuth result from the URL: `?code=…&state=…` on success, `?error=…` otherwise.
 * The `state` must match the one stored before redirecting, so a crafted link
 * can't log the dashboard into somebody else's Twitch account.
 */
export function readTwitchRedirect(href: string = window.location.href): TwitchRedirectResult {
    const query = new URL(href).searchParams;
    const code = query.get('code');
    const error = query.get('error');
    if (!code && !error) return { kind: 'none' };

    const expected = safeSession.get(STATE_KEY);
    const returned = query.get('state');
    safeSession.set(STATE_KEY, null);

    if (!expected || !returned || expected !== returned) {
        return { kind: 'error', message: "Twitch login was rejected because it didn't start from this dashboard. Please log in again." };
    }
    if (error) {
        const description = query.get('error_description') || error;
        return { kind: 'error', message: error === 'redirect_mismatch'
            ? `Twitch doesn't allow redirects to ${twitchRedirectUri()}. Add it as an OAuth Redirect URL of your Twitch app.`
            : description };
    }
    return { kind: 'code', code: code! };
}

/** Removes `?code=…&state=…` from the address bar after handling it. */
export function clearTwitchRedirectFromUrl() {
    const url = new URL(window.location.href);
    for (const key of ['code', 'scope', 'state', 'error', 'error_description']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

// ── Cloud Functions (functions/index.js) ─────────────────────────────────────

export interface TwitchSession {
    accessToken: string;
    expiresIn: number;
    login: string;
}

const callExchange = httpsCallable<{ code: string; redirectUri: string }, TwitchSession>(functions, 'twitchExchangeCode');
const callRefresh = httpsCallable<void, TwitchSession>(functions, 'twitchRefreshToken');
const callLogout = httpsCallable<{ accessToken?: string }, { ok: boolean }>(functions, 'twitchLogout');

export const exchangeTwitchCode = async (code: string): Promise<TwitchSession> =>
    (await callExchange({ code, redirectUri: twitchRedirectUri() })).data;

export const refreshTwitchToken = async (): Promise<TwitchSession> => (await callRefresh()).data;

export const forgetTwitchLogin = async (accessToken?: string): Promise<void> => {
    await callLogout({ accessToken });
};

/** Firebase callable error code, e.g. 'functions/not-found'. */
export const callableErrorCode = (err: unknown): string => (err as { code?: string })?.code ?? '';
