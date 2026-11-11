/**
 * Twitch OAuth (implicit grant) helpers.
 *
 * The token is never baked into the build. It comes only from the user's own
 * login and lives in sessionStorage: it survives reloads of the dashboard tab
 * but not closing the browser. Logging in again is one click, because Twitch
 * skips the consent screen for an app the user has already authorized.
 */

/** Scopes needed by the EventSub client: reading chat, and the Hype Train (broadcaster only). */
export const TWITCH_SCOPES = ['user:read:chat', 'channel:read:hype_train'] as const;

const STATE_KEY = 'streamlink_twitch_oauth_state';
const TOKEN_KEY = 'streamlink_twitch_token';

export const getTwitchClientId = (override?: string): string =>
    (override || import.meta.env.VITE_TWITCH_CLIENT_ID || '').trim();

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
        redirect_uri: window.location.origin,
        response_type: 'token',
        scope: TWITCH_SCOPES.join(' '),
        state,
    });
    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params}`;
    return true;
}

export type TwitchRedirectResult =
    | { kind: 'token'; token: string }
    | { kind: 'error'; message: string }
    | { kind: 'none' };

/**
 * Reads the OAuth result from the current URL. Twitch returns
 * `/#access_token=…&scope=…&state=…&token_type=bearer` on success and
 * `?error=…&error_description=…&state=…` on failure. The `state` must match the
 * one we stored before redirecting, so a crafted link can't log the dashboard
 * into somebody else's Twitch account.
 */
export function readTwitchRedirect(href: string = window.location.href): TwitchRedirectResult {
    const url = new URL(href);
    const fragment = new URLSearchParams(url.hash.replace(/^#\/?/, ''));
    const query = url.searchParams;

    const token = fragment.get('access_token');
    const error = query.get('error') || fragment.get('error');
    if (!token && !error) return { kind: 'none' };

    const expected = safeSession.get(STATE_KEY);
    const returned = fragment.get('state') || query.get('state');
    safeSession.set(STATE_KEY, null);

    if (!expected || !returned || expected !== returned) {
        return { kind: 'error', message: 'Twitch login was rejected because it did not start from this dashboard. Please log in again.' };
    }
    if (error) {
        return { kind: 'error', message: query.get('error_description') || fragment.get('error_description') || error };
    }
    return { kind: 'token', token: token! };
}
