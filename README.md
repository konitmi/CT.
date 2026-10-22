# CT — Temporary Real-Time Chat

A minimal, dark, mobile-friendly real-time chat website. Users can create rooms, share a six-character room code, and chat live.

## What this version does

- Multiple rooms can exist at once.
- Users join with a username; no account required.
- Messages are stored **only in server memory**, never written to a chat database or file by this app.
- Each room keeps at most the newest 100 messages.
- Messages expire after 60 minutes by default.
- Empty rooms are removed after 30 minutes.
- Restarting/redeploying the server clears all rooms and messages.
- Basic per-user message rate limiting.
- Text is rendered as text in the browser, not HTML.

## Important privacy limitation

This application does not persist chat messages. That is not the same as guaranteeing that no data exists anywhere: the hosting provider may keep request/operational logs, and participants can screenshot or copy messages. Review the hosting provider's policies and settings before making privacy promises. Do not send passwords or highly sensitive information through public chat.

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser windows to test real-time chat.

## Change message expiry

Default: 60 minutes. Set `MESSAGE_TTL_MINUTES` in the hosting environment to another number, for example `30`. The server enforces a minimum of one minute.

## Deploy to Render

1. Create a GitHub repository and upload the contents of this project (not the parent folder).
2. Sign in to Render and choose **New + → Web Service**.
3. Connect the repository.
4. Set:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
5. Add environment variable `MESSAGE_TTL_MINUTES` with value `60` (optional; 60 is the default).
6. Deploy. Open the Render URL it provides.

This is a single Node service that serves both the website and the Socket.IO connection, so no separate frontend/backend URL is needed.

### Hosting notes

- In-memory state is local to one server process. Use one running instance for this version; multiple instances would have separate rooms and message histories.
- A restart, deploy, crash, or sleeping free instance can disconnect users and clear messages. Free hosting terms and availability can change.
- For a public launch, add moderation/reporting, stricter abuse controls, and review privacy/security settings before inviting a large audience.

## Files

- `server.js` — Express + Socket.IO server, in-memory rooms, message limits and expiry.
- `public/index.html` — UI structure.
- `public/styles.css` — responsive dark design.
- `public/app.js` — live chat client.
- `render.yaml` — optional Render blueprint.
