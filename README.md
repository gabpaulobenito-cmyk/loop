# LOOP

A lightweight personal **open-loops** tracker. It answers one question:

> What have I started but not closed?

Every loop is **RUNNING** (a session is accumulating time), **OPEN** (unresolved, timer stopped) or **CLOSED** (done, out of the workspace). There are no projects, boards, subtasks or due dates.

The interface is a production translation of the *Loop V2* design studies: a dark command-center UI with Geist / Geist Mono / Saira Condensed, acid-lime running states, neon-red priority markers, and tight technical rows that adapt from a 180 px persistent rail up to a full desktop. Pop-ups use a terminal style with square corners.

---

## Stack

| Layer    | Choice |
| -------- | ------ |
| Client   | React 19 + TypeScript, built with Vite. Plain CSS with design tokens and container queries. Self-hosted fonts via Fontsource. |
| API      | Node 22 + Express 5, validated with Zod, bundled with esbuild. |
| Database | PostgreSQL with plain-SQL, versioned migrations (`server/migrations`). |
| Tests    | Vitest (unit + API integration against a real Postgres) and Playwright (end-to-end + responsive smoke tests). |
| Hosting  | Railway (one web service + Railway PostgreSQL). |

One process serves both the API (`/api/*`) and the built client, so there is no CORS surface.

```
server/            Express app, domain logic, auth, migration runner
  migrations/      NNN_name.sql files, applied in order
shared/            Types and timer / format / sort logic used by client, server and tests
src/               React client
  components/      Workspace, LoopRow, Inspector, Chrome (header, capture, menu), Login
  lib/             API client, server-clock sync, state store
tests/
  unit/            Timer accumulation, formatting, sorting
  integration/     HTTP API against Postgres (auth, lifecycle, concurrency, undo, persistence)
  e2e/             Playwright: full lifecycle + 180 → 1440 px responsive smoke tests
```

## How timers work

Timers are never incremented and saved every second. Each loop stores:

- `accumulated_ms`: the sum of all *finished* sessions
- `running_since`: the start of the current session, or `NULL`

Every session is also a row in `loop_sessions` with real `started_at` / `ended_at` timestamps. Elapsed time is always computed as:

```
accumulated_ms + (now − running_since)
```

That formula lives in `shared/timer.ts` and is used by the server, the client and the tests. Timers stay correct after refreshes, sleep, closing the browser, or opening the app on another device. The client estimates its offset from the server clock using `serverNow` in every API response, so all devices tick against the same clock.

Invariants enforced in the database:

- `state = 'running'` ⇔ `running_since IS NOT NULL`, and `state = 'closed'` ⇔ `closed_at IS NOT NULL` (CHECK constraints)
- at most one open session per loop (partial unique index)

Every state change runs in a transaction holding a row lock (`SELECT … FOR UPDATE`), so simultaneous start/stop requests from double taps or multiple devices serialize safely. Start and stop are idempotent. Loop creation uses a client-generated UUID, so a duplicate submission returns the existing loop instead of creating a second one. Closing a running loop finalizes its session first.

## Undo

Reversible actions (create, start/resume, stop, close, reopen, priority, rename, note edits) go into `action_history` with a snapshot of the loop and the session they created or finished. `POST /api/undo` reverts the most recent action from the last 30 minutes, including reopening a finished session or deleting a just-started one. The undo stack is server-side, so it is consistent across devices.

## Interaction model

| Where | Action |
| ----- | ------ |
| Row | Opens the loop's details pop-up. Never changes its state. |
| ▶ / ■ / ↺ button | Start, stop, or reopen. This is the only way a row changes state. |
| + / NEW LOOP / `N` | New-loop pop-up: large title and note. `⏎` creates and starts, `⇧⏎` adds without starting. |
| Details pop-up | Start/stop, **CLOSE LOOP**, PRIORITY, RENAME, NOTE, **EDIT START**, DELETE (two clicks), full session history |
| EDIT START | Calendar + time picker. On a running loop it moves the current session's start (the timer counts from then). On an open or closed loop it moves when the loop was opened. Moving a running start back past earlier sessions merges them into the running one, cutting any session that straddles the new start, so time is never double-counted. It can't be set in the future, and it can be undone, which restores the original sessions. |

Closing and deleting only happen inside the details pop-up, so a stray tap on a row can't trigger them. Both can be undone.

Keyboard: `N` / `⌘N` new loop · `/` or `⌘K` search · `⌘Z` undo · `↑ ↓` move between rows · `Esc` dismiss. In details: `S` start/stop, `P` priority, `E` rename, `⌫` close.

### Layout modes

| Width | Mode |
| ----- | ---- |
| < 300 px | **Rail**: compressed header, RUNNING / OPEN sections, compact timers, notes under titles |
| 300–599 px | **Mobile**: ALL / RUNNING / OPEN / CLOSED tabs, 30 px touch controls, safe-area insets |
| ≥ 600 px | **Desk**: V2 half-screen rows (44 px running / 38 px open) plus an inline capture bar |

Overflowing notes pan slowly as in V2, pause on hover or focus, and fall back to an ellipsis under `prefers-reduced-motion` (which also stops the running-marker pulse).

---

## Local setup

Requirements: **Node 22+** and **PostgreSQL 14+**.

```bash
git clone https://github.com/gabpaulobenito-cmyk/loop.git
cd loop
npm install
cp .env.example .env          # then edit values
createdb loop
createdb loop_test            # for tests
npm run migrate:dev           # apply migrations to DATABASE_URL
npm run dev                   # API on :3000, Vite on :5173 (proxied /api)
```

Open http://localhost:5173.

To run the production build locally:

```bash
npm run build
node --env-file=.env dist/server/index.js    # http://localhost:3000
```

> Don't set `NODE_ENV=development` in `.env` when building: Vite reads it and produces an unminified React build.

## Environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `DATABASE_URL` | yes | PostgreSQL connection string. On Railway: `${{Postgres.DATABASE_URL}}`. |
| `PORT` | no | HTTP port (Railway injects this). Default `3000`. |
| `NODE_ENV` | no | Set to `production` in production. |
| `DATABASE_SSL` | no | `true` to connect with TLS (needed for public Postgres proxies, not Railway's private network). |
| `TEST_DATABASE_URL` | tests | Database the integration and e2e suites **drop and recreate**. Never point it at real data. |

## Database migrations

Migrations are plain SQL files in `server/migrations`, named `NNN_description.sql`. The runner applies pending files in order, each in its own transaction, records them in `schema_migrations`, and takes a Postgres advisory lock so concurrent deploys can't race.

```bash
npm run migrate:dev    # development (TypeScript source, reads .env)
npm run migrate        # production bundle (dist/server/migrate.js)
```

To change the schema, add a new file (e.g. `002_add_x.sql`). Never edit a migration that has already been applied.

## Tests

```bash
npm run typecheck
npm test               # unit + API integration (needs TEST_DATABASE_URL)
npm run test:e2e       # builds, starts the prod server on :3210, runs Playwright
```

First-time Playwright setup: `npx playwright install chromium`.

Coverage includes timer accumulation across start → stop → resume, idempotent and concurrent start/stop, closing a running loop, reopen, priority, sorting, validation, CSRF protection, undo (including session restoration and expiry), persistence across a simulated server restart, and responsive smoke tests at 180, 220, 260, 375, 393, 450, 720, 1024 and 1440 px (no horizontal overflow, 6×6 circular markers, working controls).

## Access

There is no sign-in: anyone who has the URL can open the workspace and change loops. Pages and API responses send `noindex` so the site stays out of search engines, but the URL itself is the only thing keeping it private. Don't share it.

Other protections:

- State-changing requests require an `x-loop-client` header, which a cross-site form can't send.
- Helmet sets a strict Content-Security-Policy. All scripts, styles and fonts are self-hosted.

## Railway deployment

Infrastructure is defined in code in **`.railway/railway.ts`** (Railway's config-as-code SDK, `railway/iac`):

- **Postgres** service with a persistent volume, reachable only on the private network
- **loop** web service built from this GitHub repo's `main` branch
  - Build: `npm run build` (Railpack, Node 22 from `engines` / `.node-version`)
  - Pre-deploy: `npm run migrate`. A failed migration stops the release, and the previous deployment keeps serving.
  - Start: `npm start`
  - Health check: `GET /api/health` (checks the database connection)
  - Restart policy: on failure, up to 10 retries
  - Variables: `DATABASE_URL` references `Postgres.DATABASE_URL`, and `NODE_ENV=production`

```bash
railway link --project <project-id> --environment production
railway config plan      # preview changes (read-only)
railway config apply     # apply infrastructure changes
```

Setting up a new environment:

1. `railway config apply` creates Postgres and the service.
2. Give the Railway GitHub App access to this repository (GitHub → Settings → Applications → Railway → *Repository access*). Pushes to `main` then deploy automatically. Until then, `railway up --service loop` deploys the local checkout.
3. Generate a domain: `railway domain --service loop`. HTTPS is automatic.

Data lives in the Railway PostgreSQL volume and survives deploys and restarts. The app service itself is stateless.

### Post-deploy smoke test

`tests/smoke` checks a live deployment **read-only**. It never creates, edits or undoes anything, so it can't disturb real loops or the undo history, and it fails if it ever tries to write. It checks that the workspace loads, running timers tick and agree with server timestamps, details open, layouts hold at 180 / 220 / 260 / 375 / 393 / 720 / 1440 px, and there are no console errors. Writes are covered by `npm run test:e2e` against the local test database.

```bash
SMOKE_URL=https://<your-domain> npm run test:smoke
```
