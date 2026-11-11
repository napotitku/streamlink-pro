/**
 * Twitch OAuth token handling (Authorization Code flow), kept free of Firebase
 * imports so it can be tested with a fake `fetch` and a fake store.
 *
 * The refresh token never leaves the server: the dashboard only ever receives
 * short-lived access tokens (about 4 hours), and asks for a new one when needed.
 */

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';

/** Errors the dashboard should see, with a Firebase HttpsError code. */
export class TwitchAuthError extends Error {
    /**
     * @param {'invalid-argument'|'failed-precondition'|'not-found'|'unavailable'} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * @typedef {{ refreshToken: string, login: string, userId: string, scopes: string[], updatedAt: number }} StoredLogin
 * @typedef {{ load(): Promise<StoredLogin|null>, save(v: StoredLogin): Promise<void>, clear(): Promise<void> }} LoginStore
 */

const postForm = (fetchFn, url, params) =>
    fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
    });

const readText = async (resp) => {
    try { return (await resp.text()).slice(0, 200); } catch { return ''; }
};

async function validate(fetchFn, accessToken) {
    const resp = await fetchFn(VALIDATE_URL, { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!resp.ok) return null;
    return resp.json();
}

/**
 * Trades the one-time `code` from Twitch's redirect for tokens, saves the refresh
 * token for this dashboard user, and returns the access token.
 */
export async function exchangeCode({ code, redirectUri, clientId, clientSecret, store, fetchFn = fetch }) {
    if (typeof code !== 'string' || !code || typeof redirectUri !== 'string' || !redirectUri) {
        throw new TwitchAuthError('invalid-argument', 'The Twitch login response was incomplete. Please log in again.');
    }
    const resp = await postForm(fetchFn, TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });
    if (!resp.ok) {
        throw new TwitchAuthError('failed-precondition', `Twitch rejected the login (${resp.status}). ${await readText(resp)}`.trim());
    }
    const tokens = await resp.json();
    const info = await validate(fetchFn, tokens.access_token);
    if (!info) throw new TwitchAuthError('failed-precondition', 'Twitch did not accept the new login.');

    await store.save({
        refreshToken: tokens.refresh_token,
        login: info.login,
        userId: info.user_id,
        scopes: info.scopes ?? [],
        updatedAt: Date.now(),
    });
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, login: info.login };
}

/** Returns a fresh access token from the saved refresh token. */
export async function refreshAccess({ clientId, clientSecret, store, fetchFn = fetch }) {
    const saved = await store.load();
    if (!saved?.refreshToken) throw new TwitchAuthError('not-found', 'No saved Twitch login. Log in to Twitch.');

    const resp = await postForm(fetchFn, TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: saved.refreshToken,
    });
    if (resp.status === 400 || resp.status === 401) {
        // Revoked, password changed, or app disconnected on Twitch: the user must log in again.
        await store.clear();
        throw new TwitchAuthError('failed-precondition', 'The saved Twitch login is no longer valid. Log in to Twitch again.');
    }
    if (!resp.ok) throw new TwitchAuthError('unavailable', `Twitch's login service returned ${resp.status}. Try again shortly.`);

    const tokens = await resp.json();
    if (tokens.refresh_token && tokens.refresh_token !== saved.refreshToken) {
        await store.save({ ...saved, refreshToken: tokens.refresh_token, updatedAt: Date.now() });
    }
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in, login: saved.login };
}

/** Forgets the saved login and revokes the given access token on Twitch. */
export async function forgetLogin({ clientId, accessToken, store, fetchFn = fetch }) {
    await store.clear();
    if (typeof accessToken === 'string' && accessToken) {
        await postForm(fetchFn, REVOKE_URL, { client_id: clientId, token: accessToken }).catch(() => {});
    }
    return { ok: true };
}
