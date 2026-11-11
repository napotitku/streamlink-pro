import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exchangeCode, refreshAccess, forgetLogin, TwitchAuthError } from './twitchTokens.js';

const memoryStore = (initial = null) => {
    let value = initial;
    return { load: async () => value, save: async (v) => { value = v; }, clear: async () => { value = null; }, peek: () => value };
};

/** Fake fetch: routes by URL, records request bodies. */
const fakeFetch = (routes) => {
    const calls = [];
    const fn = async (url, init = {}) => {
        calls.push({ url, body: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null });
        const key = Object.keys(routes).find(k => url.includes(k));
        const [status, body] = key ? routes[key](calls.at(-1)) : [404, {}];
        return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
    };
    fn.calls = calls;
    return fn;
};

const validateOk = () => [200, { login: 'mychannel', user_id: '42', scopes: ['user:read:chat'], expires_in: 14000 }];

test('exchangeCode stores the refresh token and returns only the access token', async () => {
    const store = memoryStore();
    const fetchFn = fakeFetch({
        '/oauth2/token': () => [200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 14000, scope: ['user:read:chat'] }],
        '/oauth2/validate': validateOk,
    });
    const result = await exchangeCode({ code: 'c0de', redirectUri: 'https://streamlink-pro.web.app', clientId: 'cid', clientSecret: 'sec', store, fetchFn });

    assert.deepEqual(result, { accessToken: 'AT1', expiresIn: 14000, login: 'mychannel' });
    assert.equal(store.peek().refreshToken, 'RT1');
    assert.equal(store.peek().userId, '42');
    const tokenCall = fetchFn.calls[0].body;
    assert.equal(tokenCall.grant_type, 'authorization_code');
    assert.equal(tokenCall.client_secret, 'sec');
    assert.equal(tokenCall.redirect_uri, 'https://streamlink-pro.web.app');
});

test('exchangeCode rejects a missing code without calling Twitch', async () => {
    const fetchFn = fakeFetch({});
    await assert.rejects(
        exchangeCode({ code: '', redirectUri: 'x', clientId: 'cid', clientSecret: 'sec', store: memoryStore(), fetchFn }),
        (e) => e instanceof TwitchAuthError && e.code === 'invalid-argument'
    );
    assert.equal(fetchFn.calls.length, 0);
});

test('exchangeCode reports a Twitch rejection (e.g. redirect mismatch)', async () => {
    const fetchFn = fakeFetch({ '/oauth2/token': () => [400, { message: 'Parameter redirect_uri does not match registered URI' }] });
    await assert.rejects(
        exchangeCode({ code: 'c', redirectUri: 'x', clientId: 'cid', clientSecret: 'sec', store: memoryStore(), fetchFn }),
        (e) => e.code === 'failed-precondition' && /redirect_uri/.test(e.message)
    );
});

test('refreshAccess returns a new access token and saves a rotated refresh token', async () => {
    const store = memoryStore({ refreshToken: 'RT1', login: 'mychannel', userId: '42', scopes: [], updatedAt: 0 });
    const fetchFn = fakeFetch({ '/oauth2/token': () => [200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 14000 }] });
    const result = await refreshAccess({ clientId: 'cid', clientSecret: 'sec', store, fetchFn });

    assert.deepEqual(result, { accessToken: 'AT2', expiresIn: 14000, login: 'mychannel' });
    assert.equal(store.peek().refreshToken, 'RT2');
    assert.equal(fetchFn.calls[0].body.grant_type, 'refresh_token');
    assert.equal(fetchFn.calls[0].body.refresh_token, 'RT1');
});

test('refreshAccess without a saved login → not-found', async () => {
    await assert.rejects(
        refreshAccess({ clientId: 'cid', clientSecret: 'sec', store: memoryStore(), fetchFn: fakeFetch({}) }),
        (e) => e.code === 'not-found'
    );
});

test('refreshAccess with a revoked refresh token clears it and asks to log in again', async () => {
    const store = memoryStore({ refreshToken: 'RT1', login: 'mychannel', userId: '42', scopes: [], updatedAt: 0 });
    const fetchFn = fakeFetch({ '/oauth2/token': () => [400, { message: 'Invalid refresh token' }] });
    await assert.rejects(refreshAccess({ clientId: 'cid', clientSecret: 'sec', store, fetchFn }), (e) => e.code === 'failed-precondition');
    assert.equal(store.peek(), null);
});

test('refreshAccess keeps the saved login when Twitch has an outage', async () => {
    const store = memoryStore({ refreshToken: 'RT1', login: 'mychannel', userId: '42', scopes: [], updatedAt: 0 });
    const fetchFn = fakeFetch({ '/oauth2/token': () => [503, {}] });
    await assert.rejects(refreshAccess({ clientId: 'cid', clientSecret: 'sec', store, fetchFn }), (e) => e.code === 'unavailable');
    assert.equal(store.peek().refreshToken, 'RT1');
});

test('forgetLogin clears the saved login and revokes the access token', async () => {
    const store = memoryStore({ refreshToken: 'RT1', login: 'm', userId: '42', scopes: [], updatedAt: 0 });
    const fetchFn = fakeFetch({ '/oauth2/revoke': () => [200, {}] });
    await forgetLogin({ clientId: 'cid', accessToken: 'AT1', store, fetchFn });
    assert.equal(store.peek(), null);
    assert.deepEqual(fetchFn.calls[0].body, { client_id: 'cid', token: 'AT1' });
});
