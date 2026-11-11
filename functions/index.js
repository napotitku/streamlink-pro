/**
 * Cloud Functions for StreamLink Pro.
 *
 * Twitch login uses the Authorization Code flow so the dashboard can renew its
 * Twitch access token without the streamer logging in again. The client secret
 * and each user's refresh token stay on the server.
 *
 * Callable from the dashboard (signed-in, allowlisted Google users only):
 *   twitchExchangeCode({ code, redirectUri }) → { accessToken, expiresIn, login }
 *   twitchRefreshToken()                     → { accessToken, expiresIn, login }
 *   twitchLogout({ accessToken })            → { ok }
 *
 * Config: TWITCH_CLIENT_ID (functions/.env.<project>), TWITCH_CLIENT_SECRET (Secret Manager:
 * `firebase functions:secrets:set TWITCH_CLIENT_SECRET`).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { TwitchAuthError, exchangeCode, refreshAccess, forgetLogin } from './twitchTokens.js';

// Same region as the Realtime Database. Runs as a dedicated service account with only
// Realtime Database Admin + log writing (the Compute Engine default account has no
// database access in this organization). Firebase grants it the secret on deploy.
setGlobalOptions({
    region: 'europe-west1',
    maxInstances: 3,
    timeoutSeconds: 30,
    serviceAccount: 'streamlink-functions@streamlink-pro.iam.gserviceaccount.com',
});
initializeApp();

const TWITCH_CLIENT_ID = defineString('TWITCH_CLIENT_ID');
const TWITCH_CLIENT_SECRET = defineSecret('TWITCH_CLIENT_SECRET');

/**
 * The Admin SDK retries forever when it can't reach the database (e.g. missing IAM
 * permission), which used to hang the dashboard for a minute. Fail fast instead.
 */
const DB_TIMEOUT_MS = 8000;
const withTimeout = (promise, what) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
        () => reject(new HttpsError('unavailable', `The server couldn't reach the database (${what}). Check the functions' service account permissions.`)),
        DB_TIMEOUT_MS
    )),
]);

/** Only Google accounts in `allowedUsers` may use these functions (same rule as the dashboard). */
async function requireAllowedUser(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to the dashboard first.');
    const allowed = await withTimeout(getDatabase().ref(`allowedUsers/${uid}`).get(), 'allowlist');
    if (allowed.val() !== true) throw new HttpsError('permission-denied', 'This Google account is not allowed to use the dashboard.');
    return uid;
}

/** Refresh tokens live at twitchAuth/{uid}. The database rules deny all client access to it. */
const storeFor = (uid) => {
    const ref = getDatabase().ref(`twitchAuth/${uid}`);
    return {
        load: async () => (await withTimeout(ref.get(), 'read login')).val(),
        save: (value) => withTimeout(ref.set(value), 'save login'),
        clear: () => withTimeout(ref.remove(), 'clear login'),
    };
};

const handle = (fn) => async (request) => {
    const uid = await requireAllowedUser(request);
    try {
        return await fn(request.data ?? {}, uid);
    } catch (err) {
        if (err instanceof TwitchAuthError) throw new HttpsError(err.code, err.message);
        if (err instanceof HttpsError) throw err;
        logger.error('Twitch auth failed', err);
        throw new HttpsError('internal', 'Twitch login failed. Try again.');
    }
};

// `invoker: 'public'` lets browsers reach the endpoints at all (callable functions must be
// publicly invocable); who may actually use them is checked in requireAllowedUser().
const options = { invoker: 'public', secrets: [TWITCH_CLIENT_SECRET] };

export const twitchExchangeCode = onCall(options, handle((data, uid) => exchangeCode({
    code: data.code,
    redirectUri: data.redirectUri,
    clientId: TWITCH_CLIENT_ID.value(),
    clientSecret: TWITCH_CLIENT_SECRET.value(),
    store: storeFor(uid),
})));

export const twitchRefreshToken = onCall(options, handle((_data, uid) => refreshAccess({
    clientId: TWITCH_CLIENT_ID.value(),
    clientSecret: TWITCH_CLIENT_SECRET.value(),
    store: storeFor(uid),
})));

export const twitchLogout = onCall({ invoker: 'public' }, handle((data, uid) => forgetLogin({
    clientId: TWITCH_CLIENT_ID.value(),
    accessToken: data.accessToken,
    store: storeFor(uid),
})));
