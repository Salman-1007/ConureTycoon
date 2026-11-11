# Hosting Green Cheek Conure Tycoon on Vercel + Render + Neon

Your codebase now natively supports **Neon PostgreSQL**, **Render Web Service**, and **Vercel** (either via same-origin `/api/*` rewrites or `CORS_ORIGIN` + `VITE_API_BASE_URL`).

---

## 1. Architecture Overview

- **Neon (`DATABASE_URL`):** Managed Serverless PostgreSQL (`migrations/schema_migrations_pg.sql`), connected via [`server/db.ts`](file:///E:/conureTycoon/server/db.ts) using `pg` Pool. When `DATABASE_URL` is not set (such as `:memory:` in Vitest tests or offline local mode), the backend falls back cleanly to SQLite.
- **Render (Backend API + Hourly Market Worker):** Node + Express 5 server compiled to `dist-server/server/index.js` via `tsconfig.server.json`.
- **Vercel (Frontend):** React 19 + Vite static bundle compiled to `dist-client` (configured in [`vite.config.ts`](file:///E:/conureTycoon/vite.config.ts)).

---

## 2. Step 1 — Neon Database Setup & Sync

Your `.env` (git-ignored) holds `DATABASE_URL` pointing to Neon (`neondb`). Keep credentials out of GitHub commits.

To push the PostgreSQL schema (`migrations/schema_migrations_pg.sql`) and migrate any local SQLite data (`data/gcct.sqlite`) to Neon anytime:

```bash
npm run db:push-neon
```

This runs [`scripts/push-to-neon.mjs`](file:///E:/conureTycoon/scripts/push-to-neon.mjs), creating all PostgreSQL tables idempotently (`CREATE TABLE IF NOT EXISTS`) and safely syncing rows in foreign-key order without overwriting existing records (`ON CONFLICT DO NOTHING`).

> Note: Even without local SQLite rows, booting the backend once against a fresh Neon database automatically runs `initializeAppData(db)` (`seedWorldData`, `ensureMutationConfigsSynced`, `ensureHourlyMarketBatch`).

---

## 3. Step 2 — Deploy Backend on Render

1. Push your repository to **GitHub** (verify `.env` and `data/` are excluded via `.gitignore`).
2. In [Render Dashboard](https://dashboard.render.com), click **New + -> Web Service** and select your repo.
3. Configure service settings:
   - **Runtime:** `Node`
   - **Branch:** `main`
   - **Build Command:**
     ```bash
     npm install && npx tsc -p tsconfig.server.json
     ```
     *(Or `npm install && npm run build` to compile both server and client.)*
   - **Start Command:**
     ```bash
     npm start
     ```
     *(Runs `NODE_ENV=production node dist-server/server/index.js`.)*
   - **Health Check Path:** `/api/health`

4. Set **Environment Variables** on Render:
   | Variable | Value | Purpose |
   | --- | --- | --- |
   | `NODE_ENV` | `production` | Enables production runtime |
   | `NODE_VERSION` | `22.14.0` | Recommended modern Node LTS |
   | `DATABASE_URL` | `postgresql://neondb_owner:...@.../neondb?sslmode=require&channel_binding=require` | Connects Render backend to Neon PostgreSQL |
   | `COOKIE_SECURE` | `true` | Marks session cookie `Secure` over HTTPS |
   | `COOKIE_SAME_SITE` | `lax` *(or `none` if calling Render directly without Vercel rewrites)* | Controls cross-domain cookie policy |
   | `CORS_ORIGIN` | `https://YOUR-APP.vercel.app` *(only needed if NOT using Vercel rewrites)* | Allows cross-origin browser API calls |
   | `GCCT_ENABLE_DEV_TOOLS` | `false` | Disables Test Lab in production (`salman`-only even if enabled) |

   > Do **not** set `PORT` manually — Render injects `PORT` automatically and [`server/index.ts`](file:///E:/conureTycoon/server/index.ts) reads `process.env.PORT ?? 3001`.

5. After Render deploys, open:
   ```text
   https://YOUR-RENDER-BACKEND.onrender.com/api/health
   ```
   Expected JSON: `{"ok":true,"devToolsEnabled":false,"dbDialect":"postgres"}`.

---

## 4. Step 3 — Deploy Frontend on Vercel

### Option A — Recommended: Same-Origin Proxy via `vercel.json`
Proxying `/api/*` through Vercel keeps session cookies on a single origin (`https://your-app.vercel.app`), avoiding third-party cookie restrictions on iOS Safari / Chrome!

1. Create `vercel.json` at the repo root (replace `YOUR-RENDER-BACKEND.onrender.com`):
   ```json
   {
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "https://YOUR-RENDER-BACKEND.onrender.com/api/$1"
       },
       {
         "source": "/((?!api/|assets/|favicon).*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
2. On [Vercel](https://vercel.com/new), import the GitHub repo and configure:
   - **Framework Preset:** `Vite`
   - **Build Command:** `npx vite build`
   - **Output Directory:** `dist-client` *(must match `vite.config.ts`!)*
3. Leave `VITE_API_BASE_URL` unset so [`client/src/api/client.ts`](file:///E:/conureTycoon/client/src/api/client.ts) sends requests to `/api/...`.

### Option B — Direct Cross-Origin Calls (No Vercel Proxy)
If you prefer the browser calling Render directly:
1. Set `VITE_API_BASE_URL=https://YOUR-RENDER-BACKEND.onrender.com` in **Vercel Environment Variables**.
2. Set `CORS_ORIGIN=https://YOUR-APP.vercel.app` and `COOKIE_SAME_SITE=none` in **Render Environment Variables**.

---

## 5. Local Testing with Neon Right Now

You already have `.env` configured locally with Neon:
1. Build or run backend against Neon:
   ```bash
   npm run dev
   ```
   Verify startup log shows `(db: postgres)` and test:
   - Logging in / Admin account `salman`
   - Marketplace / Breeding cages / Choice bird claims
2. Keep Vite dev server on `http://localhost:5173` (proxies `/api/*` to `http://127.0.0.1:3001`).
