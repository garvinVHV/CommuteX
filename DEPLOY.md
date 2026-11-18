# Running CommuteX 24/7

A laptop that sleeps, or a tunnel that changes address, is not 24/7. You need (1) a machine that is always on,
(2) a permanent HTTPS address (phones only allow GPS, push and mic on HTTPS), and (3) a disk that survives restarts.

## What the server needs
| Setting | Why |
|---|---|
| `GEMINI_API_KEY` or `OPENAI_API_KEY` (+ `OPENAI_MODEL`) | Required, or the server exits at start. |
| `TOMTOM_KEY` | Optional, live traffic. |
| `NODE_ENV=production` | Locks the advisory endpoints unless `ADMIN_TOKEN` is set. |
| `ADMIN_TOKEN` | Long random string. Needed to post fake metro delays on a public server. |
| `DB_PATH` | Must be on a **persistent volume** (Docker image uses `/data/commutex.db`). Losing it loses alarms and push subscriptions. |
| `PORT` | Most hosts set this for you. |

Health check URL: `/healthz` (returns `ok`). Needs Node 22.13+ (SQLite is built in). Set the secrets as environment
variables on the host. Do not upload your `.env` file.

## Option A: a small cloud host with Docker (recommended)
Any host that runs a Dockerfile, gives you a persistent volume and an https URL works (Fly.io, Railway, Render and a plain VPS all do).
1. Put the project in a Git repo (`.gitignore` already keeps `.env`, `node_modules` and the database out).
2. Create the app from the repo / Dockerfile.
3. **Attach a persistent volume mounted at `/data`.** Without it, every redeploy wipes the database.
4. Set the environment variables above on the host.
5. Set the health check path to `/healthz` and the restart policy to "always".
6. Keep it to **one instance** (SQLite is a single-file database).
7. Open the https URL it gives you. Check pricing yourself: free tiers commonly sleep when idle or have no persistent disk, and both break 24/7 alarms.

## Option B: your own always-on machine (PC, mini PC, Raspberry Pi)
1. `npm install`, copy `.env.example` to `.env`, fill it in, set `NODE_ENV=production` and `ADMIN_TOKEN`.
2. Keep it running and restart it on crash/reboot: `npm i -g pm2`, `pm2 start server.js --name commutex`, `pm2 save`
   (Linux/Mac: `pm2 startup`; Windows: use Task Scheduler or the `pm2-installer` project).
3. Turn off sleep in the OS power settings.
4. For a **permanent** https address use a Cloudflare *named* tunnel on a domain you own. The quick
   `cloudflared tunnel --url ...` link from the README changes every time it restarts, so push subscriptions and the installed
   app break.

## After it is live
- Open the site on your phone, open Alarms once and allow notifications, so alarms ring with the tab closed.
- Alarms and push subscriptions are now **private per browser** (an id is stored in the browser). Clearing site data
  means that browser starts with an empty alarm list.
- Fake a metro delay on a public server: `curl -X POST https://YOUR-URL/api/advisory -H "Content-Type: application/json" -H "x-admin-token: YOUR_TOKEN" -d '{"line":"Blue","delay_min":15,"note":"Signal fault"}'`
- Backups: copy the `DB_PATH` file now and then.
- The server limits chat to 30 requests/minute and timetable photos to 5/minute per visitor, to protect your AI credits.
