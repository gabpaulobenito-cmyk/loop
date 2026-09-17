import { randomUUID } from 'node:crypto';
import type { Client, Pool } from './db';
import { withTx } from './db';
import { HttpError, notFound } from './errors';
import { finalizeSession } from '../shared/timer';
import {
  DEFAULT_SETTINGS,
  UNDO_WINDOW_MS,
  type Loop,
  type LoopState,
  type Session,
  type Settings,
  type UndoTop,
} from '../shared/types';

type ActionKind = 'create' | 'start' | 'stop' | 'close' | 'reopen' | 'priority' | 'edit' | 'delete' | 'retime';

interface LoopRow {
  id: string;
  title: string;
  note: string;
  priority: boolean;
  state: LoopState;
  created_at: Date;
  closed_at: Date | null;
  running_since: Date | null;
  accumulated_ms: number;
  version: number;
  updated_at: Date;
  deleted_at: Date | null;
  session_count?: number;
}

/** Snapshot stored in action_history.before — enough to restore the row exactly. */
interface Snapshot {
  title: string;
  note: string;
  priority: boolean;
  state: LoopState;
  closedAt: number | null;
  runningSince: number | null;
  accumulatedMs: number;
  version: number;
  /** Present on snapshots taken after created time became editable. */
  createdAt?: number;
  /** Original start of a session moved by a retime action. */
  sessionStart?: { id: string; startedAt: number };
  /** Earlier sessions a backdated running session absorbed (restored on undo). */
  absorbed?: { deleted: { id: string; startedAt: number; endedAt: number }[]; truncated: { id: string; endedAt: number }[] };
}

const ms = (d: Date | null) => (d ? d.getTime() : null);
const at = (n: number | null) => (n == null ? null : new Date(n));

const LOOP_SELECT = `
  SELECT l.*, (SELECT count(*)::int FROM loop_sessions s WHERE s.loop_id = l.id) AS session_count
  FROM loops l`;

function toLoop(r: LoopRow): Loop {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    priority: r.priority,
    state: r.state,
    createdAt: r.created_at.getTime(),
    closedAt: ms(r.closed_at),
    runningSince: ms(r.running_since),
    accumulatedMs: Number(r.accumulated_ms),
    sessionCount: r.session_count ?? 0,
    updatedAt: r.updated_at.getTime(),
  };
}

function snapshot(r: LoopRow): Snapshot {
  return {
    title: r.title,
    note: r.note,
    priority: r.priority,
    state: r.state,
    closedAt: ms(r.closed_at),
    runningSince: ms(r.running_since),
    accumulatedMs: Number(r.accumulated_ms),
    version: r.version,
    createdAt: r.created_at.getTime(),
  };
}

const quote = (title: string) => (title.length > 48 ? `${title.slice(0, 47)}…` : title);

// ── Reads ────────────────────────────────────────────────────────────────

const CLOSED_LIMIT = 500;

export async function listLoops(db: Pool | Client): Promise<Loop[]> {
  const { rows } = await db.query<LoopRow>(
    `(${LOOP_SELECT} WHERE l.deleted_at IS NULL AND l.state <> 'closed')
     UNION ALL
     (${LOOP_SELECT} WHERE l.deleted_at IS NULL AND l.state = 'closed' ORDER BY l.closed_at DESC LIMIT ${CLOSED_LIMIT})`,
  );
  return rows.map(toLoop);
}

export async function getLoop(db: Pool | Client, id: string): Promise<Loop | null> {
  const { rows } = await db.query<LoopRow>(`${LOOP_SELECT} WHERE l.id = $1 AND l.deleted_at IS NULL`, [id]);
  return rows[0] ? toLoop(rows[0]) : null;
}

export async function listSessions(db: Pool, loopId: string): Promise<Session[]> {
  const exists = await db.query('SELECT 1 FROM loops WHERE id = $1 AND deleted_at IS NULL', [loopId]);
  if (!exists.rowCount) throw notFound();
  const { rows } = await db.query<{ id: string; loop_id: string; started_at: Date; ended_at: Date | null }>(
    `SELECT id, loop_id, started_at, ended_at FROM loop_sessions WHERE loop_id = $1 ORDER BY started_at DESC LIMIT 500`,
    [loopId],
  );
  return rows.map((r) => ({ id: r.id, loopId: r.loop_id, startedAt: r.started_at.getTime(), endedAt: ms(r.ended_at) }));
}

export async function getUndoTop(db: Pool | Client, now: number): Promise<UndoTop | null> {
  const { rows } = await db.query<{ id: number; label: string; created_at: Date }>(
    `SELECT id, label, created_at FROM action_history
     WHERE undone_at IS NULL AND created_at > $1
     ORDER BY id DESC LIMIT 1`,
    [new Date(now - UNDO_WINDOW_MS)],
  );
  const r = rows[0];
  return r ? { id: Number(r.id), label: r.label, createdAt: r.created_at.getTime() } : null;
}

// ── Writes ───────────────────────────────────────────────────────────────

export interface MutationResult {
  loop: Loop | null;
  deletedId?: string;
  undo: UndoTop | null;
  changed: boolean;
}

interface Action {
  kind: ActionKind;
  label: string;
  sessionStartedId?: string;
  sessionEndedId?: string;
  sessionStart?: { id: string; startedAt: number };
  absorbed?: Snapshot['absorbed'];
}

async function lockLoop(c: Client, id: string, includeDeleted = false): Promise<LoopRow> {
  const { rows } = await c.query<LoopRow>('SELECT * FROM loops WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0] || (rows[0].deleted_at && !includeDeleted)) throw notFound();
  return rows[0];
}

async function recordAction(c: Client, loopId: string, before: Snapshot | null, action: Action, now: number) {
  if (before && action.sessionStart) before = { ...before, sessionStart: action.sessionStart };
  if (before && action.absorbed) before = { ...before, absorbed: action.absorbed };
  const { rows } = await c.query<{ version: number }>('SELECT version FROM loops WHERE id = $1', [loopId]);
  await c.query(
    `INSERT INTO action_history (loop_id, kind, label, before, session_started_id, session_ended_id, loop_version_after, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      loopId,
      action.kind,
      action.label,
      before ? JSON.stringify(before) : null,
      action.sessionStartedId ?? null,
      action.sessionEndedId ?? null,
      rows[0].version,
      new Date(now),
    ],
  );
  // Keep the log bounded.
  await c.query(`DELETE FROM action_history WHERE id < (SELECT max(id) - 200 FROM action_history)`);
}

/**
 * Lock the loop row, apply `fn`, and record a reversible action when something changed.
 * Row locks serialize simultaneous start/stop requests for the same loop.
 */
async function mutate(
  pool: Pool,
  id: string,
  now: number,
  fn: (c: Client, row: LoopRow) => Promise<Action | null>,
): Promise<MutationResult> {
  return withTx(pool, async (c) => {
    const row = await lockLoop(c, id);
    const action = await fn(c, row);
    if (action) await recordAction(c, id, snapshot(row), action, now);
    return { loop: await getLoop(c, id), undo: await getUndoTop(c, now), changed: !!action };
  });
}

/** Finish the running session of `row` at `now`, returning the ended session id. */
async function finishSession(c: Client, row: LoopRow, now: number): Promise<{ sessionId: string; accumulatedMs: number }> {
  const since = row.running_since!.getTime();
  const end = Math.max(now, since);
  const { accumulatedMs } = finalizeSession({ accumulatedMs: Number(row.accumulated_ms), runningSince: since }, end);
  const { rows } = await c.query<{ id: string }>(
    `UPDATE loop_sessions SET ended_at = $2 WHERE loop_id = $1 AND ended_at IS NULL RETURNING id`,
    [row.id, new Date(end)],
  );
  if (!rows[0]) throw new HttpError(500, 'session_missing', 'Running session record is missing');
  return { sessionId: rows[0].id, accumulatedMs };
}

async function openSession(c: Client, loopId: string, now: number): Promise<string> {
  const sessionId = randomUUID();
  await c.query('INSERT INTO loop_sessions (id, loop_id, started_at) VALUES ($1, $2, $3)', [sessionId, loopId, new Date(now)]);
  return sessionId;
}

export async function createLoop(
  pool: Pool,
  input: { id: string; title: string; note: string; start: boolean },
  now: number,
): Promise<MutationResult> {
  return withTx(pool, async (c) => {
    const state: LoopState = input.start ? 'running' : 'open';
    const inserted = await c.query(
      `INSERT INTO loops (id, title, note, state, created_at, running_since, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $5)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.title, input.note, state, new Date(now), input.start ? new Date(now) : null],
    );
    // Same client id submitted twice: return the existing loop, no duplicate.
    if (!inserted.rowCount) {
      const existing = await getLoop(c, input.id);
      if (!existing) throw new HttpError(409, 'conflict', 'Loop id already used');
      return { loop: existing, undo: await getUndoTop(c, now), changed: false };
    }
    const sessionStartedId = input.start ? await openSession(c, input.id, now) : undefined;
    await recordAction(c, input.id, null, {
      kind: 'create',
      label: `Created ${quote(input.title)}`,
      sessionStartedId,
    }, now);
    return { loop: await getLoop(c, input.id), undo: await getUndoTop(c, now), changed: true };
  });
}

export function startLoop(pool: Pool, id: string, now: number) {
  return mutate(pool, id, now, async (c, row) => {
    if (row.state === 'running') return null;
    if (row.state === 'closed') throw new HttpError(409, 'loop_closed', 'Reopen this loop before starting it');
    const sessionId = await openSession(c, id, now);
    await c.query(
      `UPDATE loops SET state = 'running', running_since = $2, version = version + 1, updated_at = $2 WHERE id = $1`,
      [id, new Date(now)],
    );
    return { kind: 'start', label: `${row.accumulated_ms > 0 ? 'Resumed' : 'Started'} ${quote(row.title)}`, sessionStartedId: sessionId };
  });
}

export function stopLoop(pool: Pool, id: string, now: number) {
  return mutate(pool, id, now, async (c, row) => {
    if (row.state !== 'running') return null;
    const { sessionId, accumulatedMs } = await finishSession(c, row, now);
    await c.query(
      `UPDATE loops SET state = 'open', running_since = NULL, accumulated_ms = $2, version = version + 1, updated_at = $3 WHERE id = $1`,
      [id, accumulatedMs, new Date(now)],
    );
    return { kind: 'stop', label: `Stopped ${quote(row.title)}`, sessionEndedId: sessionId };
  });
}

export function closeLoop(pool: Pool, id: string, now: number) {
  return mutate(pool, id, now, async (c, row) => {
    if (row.state === 'closed') return null;
    let accumulatedMs = Number(row.accumulated_ms);
    let sessionEndedId: string | undefined;
    // A running loop's active session is finalized before it closes.
    if (row.state === 'running') {
      const done = await finishSession(c, row, now);
      accumulatedMs = done.accumulatedMs;
      sessionEndedId = done.sessionId;
    }
    await c.query(
      `UPDATE loops SET state = 'closed', closed_at = $2, running_since = NULL, accumulated_ms = $3,
         version = version + 1, updated_at = $2 WHERE id = $1`,
      [id, new Date(now), accumulatedMs],
    );
    return { kind: 'close', label: `Closed ${quote(row.title)}`, sessionEndedId };
  });
}

export function reopenLoop(pool: Pool, id: string, now: number) {
  return mutate(pool, id, now, async (c, row) => {
    if (row.state !== 'closed') return null;
    await c.query(
      `UPDATE loops SET state = 'open', closed_at = NULL, version = version + 1, updated_at = $2 WHERE id = $1`,
      [id, new Date(now)],
    );
    return { kind: 'reopen', label: `Reopened ${quote(row.title)}` };
  });
}

export function updateLoop(
  pool: Pool,
  id: string,
  patch: { title?: string; note?: string; priority?: boolean },
  now: number,
) {
  return mutate(pool, id, now, async (c, row) => {
    const title = patch.title ?? row.title;
    const note = patch.note ?? row.note;
    const priority = patch.priority ?? row.priority;
    const priorityChanged = priority !== row.priority;
    const textChanged = title !== row.title || note !== row.note;
    if (!priorityChanged && !textChanged) return null;
    await c.query(
      `UPDATE loops SET title = $2, note = $3, priority = $4, version = version + 1, updated_at = $5 WHERE id = $1`,
      [id, title, note, priority, new Date(now)],
    );
    if (priorityChanged && !textChanged) {
      return { kind: 'priority', label: `${priority ? 'Flagged' : 'Cleared priority on'} ${quote(title)}` };
    }
    const what = title !== row.title && note !== row.note ? 'Edited' : title !== row.title ? 'Renamed' : 'Edited note on';
    return { kind: 'edit', label: `${what} ${quote(title)}` };
  });
}

const DAY = 86_400_000;
const fmtWhen = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/**
 * Move when a loop started.
 * - Running: moves the current session's start (and the loop's created time
 *   back with it if needed), so the timer reflects when work really began.
 * - Open / closed: moves when the loop was first opened.
 */
export function retimeLoop(pool: Pool, id: string, startAt: number, now: number) {
  return mutate(pool, id, now, async (c, row) => {
    if (!Number.isFinite(startAt)) throw new HttpError(400, 'invalid_request', 'Invalid start time');
    if (startAt > now + 60_000) throw new HttpError(400, 'start_in_future', 'Start time can’t be in the future');
    if (startAt < now - 10 * 365 * DAY) throw new HttpError(400, 'start_too_old', 'Start time is too far in the past');
    const target = Math.min(startAt, now);
    const createdAt = row.created_at.getTime();

    if (row.state === 'running') {
      const since = row.running_since!.getTime();
      if (target === since) return null;
      // Backdating past earlier sessions absorbs them: sessions entirely after the new
      // start merge into the running one, and one straddling it is cut at that point.
      // Total time never double-counts, and undo restores them exactly.
      const { rows: overlapping } = await c.query<{ id: string; started_at: Date; ended_at: Date }>(
        `SELECT id, started_at, ended_at FROM loop_sessions
         WHERE loop_id = $1 AND ended_at IS NOT NULL AND ended_at > $2
         ORDER BY started_at`,
        [id, new Date(target)],
      );
      const absorbed: NonNullable<Snapshot['absorbed']> = { deleted: [], truncated: [] };
      for (const o of overlapping) {
        if (o.started_at.getTime() >= target) {
          absorbed.deleted.push({ id: o.id, startedAt: o.started_at.getTime(), endedAt: o.ended_at.getTime() });
          await c.query('DELETE FROM loop_sessions WHERE id = $1', [o.id]);
        } else {
          absorbed.truncated.push({ id: o.id, endedAt: o.ended_at.getTime() });
          await c.query('UPDATE loop_sessions SET ended_at = $2 WHERE id = $1', [o.id, new Date(target)]);
        }
      }
      const { rows: open } = await c.query<{ id: string }>(
        `UPDATE loop_sessions SET started_at = $2 WHERE loop_id = $1 AND ended_at IS NULL RETURNING id`,
        [id, new Date(target)],
      );
      if (!open[0]) throw new HttpError(500, 'session_missing', 'Running session record is missing');
      const { rows: sum } = await c.query<{ total: number }>(
        `SELECT COALESCE(SUM(ROUND(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)), 0)::bigint AS total
         FROM loop_sessions WHERE loop_id = $1 AND ended_at IS NOT NULL`,
        [id],
      );
      await c.query(
        `UPDATE loops SET running_since = $2, created_at = LEAST(created_at, $2), accumulated_ms = $4,
           version = version + 1, updated_at = $3 WHERE id = $1`,
        [id, new Date(target), new Date(now), Number(sum[0].total)],
      );
      const merged = absorbed.deleted.length + absorbed.truncated.length;
      return {
        kind: 'retime',
        label: `Moved start of ${quote(row.title)}${merged ? ` (merged ${merged} session${merged === 1 ? '' : 's'})` : ''}`,
        sessionStart: { id: open[0].id, startedAt: since },
        absorbed: merged ? absorbed : undefined,
      };
    }

    if (target === createdAt) return null;
    const { rows: first } = await c.query<{ started: Date | null }>(
      `SELECT min(started_at) AS started FROM loop_sessions WHERE loop_id = $1`,
      [id],
    );
    const firstStart = first[0]?.started?.getTime();
    if (firstStart != null && target > firstStart) {
      throw new HttpError(400, 'after_first_session', `Can’t be later than its first session (${fmtWhen(firstStart)})`);
    }
    if (row.closed_at && target > row.closed_at.getTime()) {
      throw new HttpError(400, 'after_close', 'Can’t be later than when it was closed');
    }
    await c.query(`UPDATE loops SET created_at = $2, version = version + 1, updated_at = $3 WHERE id = $1`, [
      id,
      new Date(target),
      new Date(now),
    ]);
    return { kind: 'retime', label: `Moved start of ${quote(row.title)}` };
  });
}

/**
 * Delete a loop. It disappears everywhere at once, but the row is kept for a
 * while so the action can be undone. A running session is finalized first.
 */
export async function deleteLoop(pool: Pool, id: string, now: number): Promise<MutationResult> {
  return withTx(pool, async (c) => {
    const row = await lockLoop(c, id);
    let accumulatedMs = Number(row.accumulated_ms);
    let sessionEndedId: string | undefined;
    let state = row.state;
    if (row.state === 'running') {
      const done = await finishSession(c, row, now);
      accumulatedMs = done.accumulatedMs;
      sessionEndedId = done.sessionId;
      state = 'open';
    }
    await c.query(
      `UPDATE loops SET deleted_at = $2, state = $3, running_since = NULL, accumulated_ms = $4,
         version = version + 1, updated_at = $2 WHERE id = $1`,
      [id, new Date(now), state, accumulatedMs],
    );
    await recordAction(c, id, snapshot(row), { kind: 'delete', label: `Deleted ${quote(row.title)}`, sessionEndedId }, now);
    await c.query(`DELETE FROM loops WHERE deleted_at < $1`, [new Date(now - 7 * 86_400_000)]);
    return { loop: null, deletedId: id, undo: await getUndoTop(c, now), changed: true };
  });
}

/** Revert the most recent action (within the undo window). */
export async function undoLast(pool: Pool, now: number): Promise<MutationResult> {
  return withTx(pool, async (c) => {
    const { rows } = await c.query<{
      id: number;
      loop_id: string;
      kind: ActionKind;
      before: Snapshot | null;
      session_started_id: string | null;
      session_ended_id: string | null;
      loop_version_after: number;
      created_at: Date;
    }>(
      `SELECT * FROM action_history WHERE undone_at IS NULL AND created_at > $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [new Date(now - UNDO_WINDOW_MS)],
    );
    const h = rows[0];
    if (!h) throw new HttpError(409, 'nothing_to_undo', 'Nothing to undo');

    const row = await lockLoop(c, h.loop_id, true);
    if (h.kind === 'create') {
      await c.query('DELETE FROM loops WHERE id = $1', [h.loop_id]);
      return { loop: null, deletedId: h.loop_id, undo: await getUndoTop(c, now), changed: true };
    }
    if (row.version !== h.loop_version_after || !h.before) {
      await c.query('UPDATE action_history SET undone_at = $2 WHERE id = $1', [h.id, new Date(now)]);
      throw new HttpError(409, 'undo_conflict', 'This loop changed since that action; it can no longer be undone');
    }
    const b = h.before;
    if (b.sessionStart) {
      await c.query('UPDATE loop_sessions SET started_at = $2 WHERE id = $1', [b.sessionStart.id, new Date(b.sessionStart.startedAt)]);
    }
    if (b.absorbed) {
      for (const d of b.absorbed.deleted) {
        await c.query('INSERT INTO loop_sessions (id, loop_id, started_at, ended_at) VALUES ($1, $2, $3, $4)', [
          d.id,
          h.loop_id,
          new Date(d.startedAt),
          new Date(d.endedAt),
        ]);
      }
      for (const t of b.absorbed.truncated) {
        await c.query('UPDATE loop_sessions SET ended_at = $2 WHERE id = $1', [t.id, new Date(t.endedAt)]);
      }
    }
    if (b.createdAt != null) {
      await c.query('UPDATE loops SET created_at = $2 WHERE id = $1', [h.loop_id, new Date(b.createdAt)]);
    }
    if (h.session_started_id) {
      await c.query('DELETE FROM loop_sessions WHERE id = $1', [h.session_started_id]);
    }
    if (h.session_ended_id) {
      await c.query('UPDATE loop_sessions SET ended_at = NULL WHERE id = $1', [h.session_ended_id]);
    }
    await c.query(
      `UPDATE loops SET title = $2, note = $3, priority = $4, state = $5, closed_at = $6, running_since = $7,
         accumulated_ms = $8, version = $10, updated_at = $9, deleted_at = NULL WHERE id = $1`,
      // Restoring the prior version lets the next-older action be undone too.
      [h.loop_id, b.title, b.note, b.priority, b.state, at(b.closedAt), at(b.runningSince), b.accumulatedMs, new Date(now), b.version],
    );
    await c.query('UPDATE action_history SET undone_at = $2 WHERE id = $1', [h.id, new Date(now)]);
    return { loop: await getLoop(c, h.loop_id), undo: await getUndoTop(c, now), changed: true };
  });
}

// ── Settings ─────────────────────────────────────────────────────────────

export async function getSettings(db: Pool | Client): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function saveSettings(pool: Pool, patch: Partial<Settings>): Promise<Settings> {
  return withTx(pool, async (c) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await c.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    }
    return getSettings(c);
  });
}
