# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

StreamLink Pro is a client-only React 18 + Vite + TypeScript SPA for streamers. It merges Twitch and YouTube live chat into one moderation dashboard, and the streamer can "feature" a message to show it on stream through an OBS browser-source overlay. Firebase provides Google auth, Realtime Database sync between dashboard and overlay, and Hosting. The project started as a Google AI Studio template, which explains the stale README.

## Commands

```bash
npm install
npm run dev          # Vite dev server on http://0.0.0.0:3000
npm run build        # production build to dist/
npm run preview      # serve the built dist/
npx tsc --noEmit     # typecheck (tsconfig has noEmit; there is no separate lint script)
```

There is no test suite. To verify changes, typecheck, then run the app and use the simulators in the Settings modal: test messages, donation, subscription and Hype Train.

Deploys run from `.github/workflows/deploy.yml` on push to `main`: `npm ci`, typecheck, `npm run build` with `VITE_*` secrets, then a pinned `firebase-tools` deploys hosting and, as a separate step, `database.rules.json`.

## Environment

All config comes from `VITE_*` variables in `.env` (gitignored): `VITE_FIREBASE_*`, `VITE_TWITCH_CLIENT_ID`, `VITE_YOUTUBE_API_KEY`, and optionally `VITE_TWITCH_CHANNEL`. Every value is bundled into the public client, so never add a user token as a `VITE_` variable. There is no backend.

The Twitch token comes only from the user's own login (`src/twitchAuth.ts`: implicit grant with a `state` check). It is kept in sessionStorage, so it survives reloads but not closing the browser. Scopes: `user:read:chat` and `channel:read:hype_train`. Logins from before the EventSub switch lack `user:read:chat`; the client reports `authIssue: 'scopes'` and the UI asks for a reconnect.

## Architecture

**Two modes in one bundle.** `index.tsx` mounts `HashRouter` → `AppSettingsProvider` → `App`. `App.tsx` routes:
- `/`: the `Dashboard`. It is gated by Firebase Google sign-in plus an allowlist check (`allowedUsers/{uid} === true` in RTDB, see `src/hooks/useFirebaseAuth.ts`).
- `/overlay`: the OBS overlay. It needs **no auth**, runs in `readOnly` mode, and only reads Firebase (`currentComment`, `hypeTrain`). It opens no chat connections. It must keep a transparent background (`index.html` forces `background: transparent`).
- `*`: `AuthHandler` catches the Twitch implicit-grant OAuth redirect. HashRouter reads `#access_token=...` as a route path, so this wildcard route extracts the token.

`App` calls every hook unconditionally. Auth gating happens only in the JSX return, so don't add early returns before the hooks.

**State layers:**
- `src/contexts/AppSettingsContext.tsx` holds user settings and the daily YouTube API quota counter. The counter resets at midnight Pacific time, which is when YouTube resets quota. Settings persist to `localStorage` (`streamlink_settings`), but credentials (`twitchAccessToken`, `twitchClientId`, `youtubeApiKey`) and `youtubeVideoId` are deliberately removed before saving. Env vars fill the credentials back in on every load.
- `src/hooks/useMessageStore.ts` keeps the in-memory message list (capped at 200, newest first), the on-air (`featuredMessage`) message and the "Up next" `queue` of message IDs. Actions read current state through `stateRef` and call `broadcastFeatured` **outside** `setState` updaters (updaters must stay side-effect free). `broadcastFeatured` writes Firebase `currentComment` and posts to `BroadcastChannel('streamlink_sync')` for other dashboard tabs. On dashboard load, the store restores whatever is still on air from Firebase instead of clearing it. `App.tsx` auto-advances the queue when nothing is on air.
- `src/hooks/useChatConnection.ts` creates and recreates `TwitchChatClient` and `YouTubeChatClient` when connection settings change (never in `readOnly` mode). The clients' callbacks outlive renders, so they read `authReady`, `readOnly` and the toggles through the `live` ref; don't capture those values directly. It also owns Hype Train state, which it subscribes to from Firebase `hypeTrain`.

**Services (`services/`):**
- `syncService.ts` is the **only** module that should touch Firebase Realtime Database for app data (`currentComment`, `hypeTrain`, `debug_logs/hype_train`). Don't import `firebase/database` in components or hooks. The one exception is the allowlist read in `useFirebaseAuth`. `sanitize()` exists because RTDB rejects `undefined`. It also turns `Date` into an ISO string, so readers have to rebuild `Date` objects (the Overlay does this).
- `twitchService.ts` is a Twitch **EventSub WebSocket** client. On connect it validates the token (`/oauth2/validate`, then hourly), resolves the broadcaster ID, opens `wss://eventsub.wss.twitch.tv/ws`, and subscribes within 10 s of `session_welcome` to `channel.chat.message`, `channel.chat.notification`, `channel.chat.message_delete`, `channel.chat.clear_user_messages`, and `channel.hype_train.*` **v2** (only when the token is the broadcaster's own). It handles `session_reconnect` handoff, keepalive timeouts and backoff. Gift bombs arrive as one `community_sub_gift` plus N `sub_gift` notices carrying `community_gift_id`; the individual ones are dropped. Shared-chat notices use `shared_chat_*` objects. The viewer count has no EventSub event, so `/helix/streams` is polled every 15 s. Any 401 sets `authIssue` and stops the client.
- `youtubeService.ts` polls the YouTube Data API v3 `liveChatMessages` endpoint and reports quota cost through `onQuotaUpdate`. It pauses while the tab is hidden and stops once quota runs out. Poll intervals are tuned for quota, so keep them in mind before changing them.

**Dashboard → overlay data flow:** the dashboard writes `currentComment` and `hypeTrain` to RTDB. The overlay subscribes through `syncService.listenToFeaturedMessage` and `listenToHypeTrain`, and never writes.

**On-stream graphics:** `components/OverlayScene.tsx` draws the lower-third and Hype Train chip on a fixed 1920×1080 stage. `ScaledStage` scales it: the overlay fits it to the OBS source, and the dashboard's "On air" panel shows the same scene scaled down, so the preview matches the stream exactly. Change the look there, not in two places.

**Dashboard keyboard shortcuts** (in `Dashboard.tsx`): J/K or arrows move, Enter puts on air, Q queues, S stars, D marks done, Esc takes off air. They are disabled while a modal is open (`shortcutsEnabled`).

**Hype Train simulation:** simulated trains are written with `isTest: true`. A real `null` update doesn't overwrite an active test train. `clearSimulatedHypeTrain()` removes stale test data when the dashboard mounts.

## Firebase security model

`database.rules.json` denies everything by default. `currentComment` and `hypeTrain` are publicly readable, because the overlay has no auth. Writes to any node require `allowedUsers/{auth.uid} === true`. `currentComment` writes must include `type` and `timestamp`. To grant someone access, add `allowedUsers/<uid> = true` in the Firebase console. No code change is needed. If you add a new RTDB path, add a matching rule, because otherwise the default deny blocks it.

## Conventions

- Path alias `@/` maps to the repo root (for example `@/services/syncService`, `@/src/hooks/...`, `@/types`). Source lives in both the root (`App.tsx`, `components/`, `services/`, `types.ts`) and `src/` (`contexts/`, `hooks/`, `firebase.ts`, `index.css`).
- Styling uses Tailwind CSS v4 through `@tailwindcss/postcss` and `@import "tailwindcss"` in `src/index.css`.
- Official platform icons, such as the YouTube SVG in `App.tsx` and `components/icons/PlatformIcons.tsx`, must stay unmodified to follow brand guidelines.
