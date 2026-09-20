# LOOP

A lightweight personal **open-loops** tracker. It answers one question:

> What have I started but not closed?

Every loop is **RUNNING** (a session is accumulating time), **OPEN** (unresolved, timer stopped) or **CLOSED** (done, out of the workspace). There are no projects, boards or subtasks. A loop that someone is actually owed by a date carries one deadline and counts down to it; everything else simply ages.

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
- `timer_type = 'countdown'` ⇔ `deadline_at IS NOT NULL` (CHECK constraint)
- at most one open session per loop (partial unique index)

Every state change runs in a transaction holding a row lock (`SELECT … FOR UPDATE`), so simultaneous start/stop requests from double taps or multiple devices serialize safely. Start and stop are idempotent. Loop creation uses a client-generated UUID, so a duplicate submission returns the existing loop instead of creating a second one. Closing a running loop finalizes its session first.

## Two timers: aging and countdown

Every loop reads exactly one clock, chosen when it is created and editable later (`timer_type`, `deadline_at`).

**Aging** is the default. It counts up from when the loop was opened — `1MO · 1D · 5H` — and stays visually muted however long it runs. Its job is visibility into neglect, not pressure, so it never turns red and it never reorders itself: an aging loop stays exactly where your sort puts it. The only concession to scanning is the status dot, which shifts once at two weeks and once at a month.

**Countdown** is opt-in and needs a real external deadline. It counts down — `DUE 8D · 5H` — and escalates as the date approaches:

| Time left | Look |
| --------- | ---- |
| More than 7 days | Neutral |
| 3–7 days | Amber |
| Under 3 days | Orange |
| Under 24 hours | Red, and floats to the top of its list regardless of sort |
| Past the deadline | Counts *up* since the deadline in red, pinned above everything (`OVER 2D · 03:11:09`) |

Those last two — the **fire tier** — are the only thing in LOOP that overrides the sort you chose. On mobile's combined tab they outrank running loops too.

A countdown row carries **both** clocks — your own time on the left, what you owe on the right:

```
1MO · 1D · 5H │ DUE 8D · 5H
```

Rows stop at the hour (`<1M`, `42M`, `5H 42M`, `3D · 5H`), including OUT clocks. A list is for scanning: at month scale the seconds were noise, and the shorter figures leave room for two timers where one used to sit. The exact ticking clock lives in the details pop-up, which is where you look when you actually want it — so rows re-render once a minute instead of once a second.

Conversion is deliberately asymmetric. Giving an aging loop a date converts it in one click, because soft work really does acquire real dates. Letting a deadline go does not: the details pop-up asks *THIS DEADLINE NO LONGER APPLIES?* and the API refuses `deadlineAt: null` outright (`409 deadline_locked`) — the only way to drop one is to ask for the aging timer by name. Every conversion is appended to `loop_timer_changes`, so the question *how often do soft loops quietly turn into deadline loops?* is answerable later. Undoing a conversion removes its log row too.

The **VIEW** bar filters ALL / DEADLINES / AGING alongside the ball-in-court filter (in the ⋯ menu on narrow layouts), and shows a red count of everything in the fire tier.

Dates are picked in LOOP's own calendar (`src/components/Calendar.tsx`), never the browser's — the native picker is a light system panel that breaks the terminal look wherever it opens. Clicking a date field pops the calendar up centered, like every other LOOP pop-up; asking for a deadline opens it in the same click, since choosing the timer *is* choosing the date. The same module serves EDIT START (inline, where it has room to scroll), deadlines, follow-ups and the new-loop pop-up.

## Work and personal

Every loop belongs to exactly one world — `work` (the default) or `personal` — and the workspace is always in one of them. The **scope switch** at the head of the view bar is the first control on the page:

```
WORK 12 | PERSONAL 03 | BOTH 15
```

It is not a filter. It also decides what a loop captured right now is born into, which is the whole point: flip to PERSONAL and everything you catch from then on is personal, with nothing to remember and nothing to tag afterwards. The new-loop pop-up shows the choice in its own title bar, pre-set from the scope you are in, so capturing across worlds takes one click and does not change where you are.

Everything downstream of the switch lives inside the current scope: the RUNNING / OPEN / CLOSED sections, the mobile tabs, the ball-in-court and timer filters, the totals in the status bar, and the docked details column — switching worlds deselects a loop belonging to the other one.

Two decisions worth knowing about:

- **The choice is per device, not synced.** It lives in `localStorage` under `loop.scope`, alongside the mobile tab, so a phone can sit in PERSONAL for good while the work machine stays in WORK. The other filters do sync; this one deliberately does not.
- **The scope you are not looking at still reports its fire tier.** A deadline in its last day, or past, shows as a flat red count on the *other* segment (`PERSONAL 03 1`). Separating the lists must not let a personal deadline go red unseen behind the work list. In BOTH, where nothing is hidden, nothing is flagged.

`BOTH` is the deliberate look across both worlds — never the default — and there personal rows carry a `PERS` tag. Work rows carry nothing: an untagged row reads as work, the way an untagged row already reads as yours.

`W` cycles WORK → PERSONAL → BOTH. A loop moves between worlds from **MOVE TO PERSONAL** / **MOVE TO WORK** in its details, which is an ordinary undoable action. Narrow layouts (rail and mobile) have no room for three segments, so the switch becomes one chip that cycles, with the full three-way choice under **SCOPE** in the ⋯ menu. The 180 px rail drops the ball-in-court counts to make room; they are still in the menu.

## Undo

Reversible actions (create, start/resume, stop, close, reopen, priority, rename, note edits (the whole checklist), deadline changes, work/personal moves) go into `action_history` with a snapshot of the loop and the session they created or finished. `POST /api/undo` reverts the most recent action from the last 30 minutes, including reopening a finished session or deleting a just-started one. The undo stack is server-side, so it is consistent across devices.

## Interaction model

The header greets you rather than naming the app — sixty-odd lines, drawn once per
load and again when the day moves on, never while you're looking at it (`src/lib/greeting.ts`).
Morning lines only appear in the morning. Where the header is tight the name comes
off (`Where were we?`), and on the rail only the shortest lines are drawn at all;
phones drop the clock instead, since the OS is already showing one just above.
One name constant at the top of that file owns who it greets.

| Where | Action |
| ----- | ------ |
| Row | Opens the loop's details pop-up. Never changes its state. |
| ▶ / ■ / ↺ button | Start, stop, or reopen. This is the only way a row changes state. |
| Scope switch / `W` | WORK → PERSONAL → BOTH. Sets what new loops are born into, not just what is shown. |
| + / NEW LOOP / `N` | New-loop pop-up: large title, note, and *does this have a hard external deadline?* `⏎` creates and starts, `⇧⏎` adds without starting. |
| Details pop-up | Start/stop, **CLOSE LOOP**, PRIORITY, RENAME, **ADD NOTE** (`N`), **EDIT START**, DELETE (two clicks), the **NOTES** checklist, the **TIMER** panel, full session history |
| EDIT START | The same calendar, inline, plus a time field. On a running loop it moves the current session's start (the timer counts from then). On an open or closed loop it moves when the loop was opened. Moving a running start back past earlier sessions merges them into the running one, cutting any session that straddles the new start, so time is never double-counted. It can't be set in the future, and it can be undone, which restores the original sessions. |

### Ball in court: Mine · Delegated · Waiting

Separate from the timer state, every loop records **who is moving it**:

| Owner | Meaning | Look |
| ----- | ------- | ---- |
| **MINE** | You act on it (default) | Unchanged |
| **DELEGATED** | Handed to someone on your team; you monitor until done | Cyan left edge, `→ NAME` tag |
| **WAITING** | Stuck on someone outside your control | Amber left edge, `⧗ NAME` tag |

Set it in the details pop-up: pick the owner, type who it's with, and set a follow-up date (TOMORROW / 3 DAYS / NEXT WEEK or any date; follow-ups land at 09:00 local time). Out-of-hands loops show an `OUT` clock, ticking since they were handed off, instead of your own active time. When a follow-up date passes, the row brightens and shows `DUE`. The **VIEW** bar filters ALL / MINE / OUT with counts, and shows totals for delegated, waiting and due. Switching Delegated ↔ Waiting keeps the original handoff time; switching back to Mine clears the name and follow-up. Every change can be undone.

Closing and deleting only happen inside the details pop-up, so a stray tap on a row can't trigger them. Both can be undone.

Keyboard: `N` / `⌘N` new loop · `/` or `⌘K` search · `⌘Z` undo · `↑ ↓` move between rows · `Esc` dismiss. In details: `S` start/stop, `P` priority, `E` rename, `⌫` close.

### Layout modes

| Width | Mode |
| ----- | ---- |
| < 300 px | **Rail**: compressed header, RUNNING / OPEN sections, compact timers, notes under titles |
| 300–599 px | **Mobile**: ALL / RUNNING / OPEN / CLOSED tabs, 30 px touch controls, safe-area insets |
| ≥ 600 px | **Desk**: V2 half-screen rows (44 px running / 38 px open) |

Overflowing notes pan slowly as in V2, pause on hover or focus, and fall back to an ellipsis under `prefers-reduced-motion` (which also stops the running-marker pulse).

### Notes: a checklist, not a caption

A loop's note is a list you arrange by hand, in the **NOTES** panel of its details. Each line has a checkbox; the **first unchecked line is the one its row marquees**, so dragging a line to the top — by its grip, or with `alt` + `↑`/`↓` — is how you choose what the row says. Checking a line off never moves it: it stays where you put it, struck through, and the row falls through to the next unchecked line. With everything checked off the row goes quiet. `N` puts the cursor in the add field, `⏎` adds and keeps it there, clicking a line edits it in place, and emptying one removes it. A loop holds up to 20 lines.

The whole list is one field on the loop (`notes`, a JSON array), so a change to it is one `PATCH /api/loops/:id` and one undoable action — undo puts the arrangement back exactly.

---

## App icon

`public/icon.png` is the 1024px master — the brand mark, full-bleed on `#181818`, with no rounded corners or transparency, because every platform applies its own corner mask. The served sizes (32, 48, 180, 192, 512 and a maskable 512 padded into Android's 80% safe zone) are derived from it, and `public/manifest.webmanifest` wires them up for install-to-home-screen. To change the icon, replace the master and regenerate the rest from it.

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
