# StreamLink Pro

A dashboard for streamers that merges Twitch and YouTube chat into one feed. Pick a message and it appears on stream through an OBS browser-source overlay. It also shows Twitch subs, gift bombs, raids and the Hype Train.

## Run locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. Create `.env` with your Firebase web config (`VITE_FIREBASE_*`), `VITE_TWITCH_CLIENT_ID` and `VITE_YOUTUBE_API_KEY`.
   The Twitch app's OAuth redirect URL must match the origin you run on, for example `http://localhost:3000`.
3. Run the app: `npm run dev`
4. Sign in with Google (your UID must be in `allowedUsers` in the Realtime Database), then log in to Twitch from the dashboard.

## OBS

Click **Overlay link** in the dashboard and add it to OBS as a 1920×1080 browser source.
