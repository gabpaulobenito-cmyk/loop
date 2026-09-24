import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { Pool } from '../../server/db';
import { createPool } from '../../server/db';
import { TEST_DATABASE_URL, fakeClock, freshDatabase } from '../helpers/db';
import type { Loop, Session } from '../../shared/types';

const M = 60_000;
const H = 60 * M;

let pool: Pool;
const clock = fakeClock();
let agent: ReturnType<typeof request.agent>;

function makeAgent(p: Pool) {
  return request.agent(createApp({ pool: p, clock: clock.now }));
}

const post = (path: string, body?: object) => agent.post(path).set('x-loop-client', '1').send(body ?? {});
const patch = (path: string, body: object) => agent.patch(path).set('x-loop-client', '1').send(body);

async function create(title: string, opts: { start?: boolean; note?: string; scope?: 'work' | 'personal' } = {}): Promise<Loop> {
  const res = await post('/api/loops', { id: randomUUID(), title, ...opts }).expect(201);
  return res.body.loop;
}

async function sessions(id: string): Promise<Session[]> {
  return (await agent.get(`/api/loops/${id}/sessions`).expect(200)).body.sessions;
}

beforeAll(async () => {
  pool = await freshDatabase();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE loops, loop_sessions, action_history, settings CASCADE');
  agent = makeAgent(pool);
});

describe('request protection', () => {
  it('keeps the health check data-free', async () => {
    const res = await makeAgent(pool).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('requires the client header on state-changing requests', async () => {
    await agent.post('/api/loops').send({ id: randomUUID(), title: 'x' }).expect(403);
  });

  it('marks responses noindex', async () => {
    const res = await agent.get('/api/state').expect(200);
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
  });

  it('has no auth endpoints', async () => {
    await agent.post('/api/auth/login').set('x-loop-client', '1').send({ key: 'x' }).expect(404);
  });
});

describe('validation', () => {
  it('rejects empty and oversized titles', async () => {
    await post('/api/loops', { id: randomUUID(), title: '   ' }).expect(400);
    await post('/api/loops', { id: randomUUID(), title: 'x'.repeat(141) }).expect(400);
    await post('/api/loops', { id: 'not-a-uuid', title: 'ok' }).expect(400);
  });

  it('normalizes whitespace in titles and notes', async () => {
    const l = await create('  Hello \n  world ', { note: ' a\tb ' });
    expect(l.title).toBe('Hello world');
    expect(l.note).toBe('a b');
  });

  it('returns 404 for unknown loops', async () => {
    await post(`/api/loops/${randomUUID()}/start`).expect(404);
  });
});

describe('create', () => {
  it('creates an open loop', async () => {
    const l = await create('Investor Update', { note: 'September metrics' });
    expect(l).toMatchObject({ state: 'open', title: 'Investor Update', note: 'September metrics', accumulatedMs: 0, runningSince: null });
  });

  it('creates and immediately starts a loop', async () => {
    const l = await create('Yuna Research', { start: true });
    expect(l.state).toBe('running');
    expect(l.runningSince).toBe(clock.now());
    expect(await sessions(l.id)).toHaveLength(1);
  });

  it('is idempotent for duplicate submissions with the same id', async () => {
    const id = randomUUID();
    await post('/api/loops', { id, title: 'Once', start: true }).expect(201);
    const again = await post('/api/loops', { id, title: 'Once', start: true }).expect(200);
    expect(again.body.loop.id).toBe(id);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM loops');
    expect(rows[0].n).toBe(1);
    expect(await sessions(id)).toHaveLength(1);
  });
});

describe('timer accumulation', () => {
  it('start → stop → resume accumulates every session', async () => {
    const l = await create('Hikari Business Model');
    await post(`/api/loops/${l.id}/start`).expect(200);
    clock.advance(25 * M);
    let r = await post(`/api/loops/${l.id}/stop`).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'open', accumulatedMs: 25 * M, runningSince: null });

    clock.advance(3 * H); // idle time must not count
    r = await post(`/api/loops/${l.id}/start`).expect(200);
    expect(r.body.loop.state).toBe('running');
    expect(r.body.undo.label).toMatch(/^Resumed/);
    clock.advance(10 * M);
    r = await post(`/api/loops/${l.id}/stop`).expect(200);
    expect(r.body.loop.accumulatedMs).toBe(35 * M);

    const s = await sessions(l.id);
    expect(s).toHaveLength(2);
    const sum = s.reduce((a, x) => a + (x.endedAt! - x.startedAt), 0);
    expect(sum).toBe(r.body.loop.accumulatedMs);
    expect(r.body.loop.sessionCount).toBe(2);
  });

  it('start and stop are idempotent', async () => {
    const l = await create('Idempotent');
    await post(`/api/loops/${l.id}/start`).expect(200);
    clock.advance(M);
    await post(`/api/loops/${l.id}/start`).expect(200);
    expect(await sessions(l.id)).toHaveLength(1);
    await post(`/api/loops/${l.id}/stop`).expect(200);
    const r = await post(`/api/loops/${l.id}/stop`).expect(200);
    expect(r.body.loop.accumulatedMs).toBe(M);
  });

  it('handles simultaneous start requests safely (one session)', async () => {
    const l = await create('Race');
    const results = await Promise.all(Array.from({ length: 8 }, () => post(`/api/loops/${l.id}/start`)));
    for (const r of results) expect(r.status).toBe(200);
    expect(await sessions(l.id)).toHaveLength(1);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM action_history WHERE kind = $1', ['start']);
    expect(rows[0].n).toBe(1);
  });

  it('handles simultaneous start/stop toggles without corrupting state', async () => {
    const l = await create('Toggle storm', { start: true });
    clock.advance(5 * M);
    await Promise.all([
      post(`/api/loops/${l.id}/stop`),
      post(`/api/loops/${l.id}/start`),
      post(`/api/loops/${l.id}/stop`),
      post(`/api/loops/${l.id}/start`),
    ]);
    const state = (await agent.get('/api/state').expect(200)).body.loops.find((x: Loop) => x.id === l.id) as Loop;
    const s = await sessions(l.id);
    const open = s.filter((x) => x.endedAt == null);
    expect(open.length).toBe(state.state === 'running' ? 1 : 0);
    const finished = s.filter((x) => x.endedAt != null).reduce((a, x) => a + (x.endedAt! - x.startedAt), 0);
    expect(finished).toBe(state.accumulatedMs);
  });

  it('refuses to start a closed loop', async () => {
    const l = await create('Closed');
    await post(`/api/loops/${l.id}/close`).expect(200);
    await post(`/api/loops/${l.id}/start`).expect(409);
  });
});

describe('close and reopen', () => {
  it('closing a running loop finalizes its active session first', async () => {
    const l = await create('InCircle Partnership', { start: true });
    clock.advance(42 * M);
    const r = await post(`/api/loops/${l.id}/close`).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'closed', runningSince: null, accumulatedMs: 42 * M, closedAt: clock.now() });
    const s = await sessions(l.id);
    expect(s).toHaveLength(1);
    expect(s[0].endedAt).toBe(clock.now());
  });

  it('reopens a closed loop as open with its time intact', async () => {
    const l = await create('Trademark Filing', { start: true });
    clock.advance(H);
    await post(`/api/loops/${l.id}/close`).expect(200);
    clock.advance(2 * H);
    const r = await post(`/api/loops/${l.id}/reopen`).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'open', closedAt: null, accumulatedMs: H });
  });
});

describe('priority and edits', () => {
  it('toggles priority', async () => {
    const l = await create('Investor Update');
    let r = await patch(`/api/loops/${l.id}`, { priority: true }).expect(200);
    expect(r.body.loop.priority).toBe(true);
    expect(r.body.undo.label).toMatch(/^Flagged/);
    r = await patch(`/api/loops/${l.id}`, { priority: false }).expect(200);
    expect(r.body.loop.priority).toBe(false);
  });

  it('edits title and note', async () => {
    const l = await create('Draft');
    const r = await patch(`/api/loops/${l.id}`, { title: 'Final', note: 'Ready for review' }).expect(200);
    expect(r.body.loop).toMatchObject({ title: 'Final', note: 'Ready for review' });
    await patch(`/api/loops/${l.id}`, { title: '' }).expect(400);
    await patch(`/api/loops/${l.id}`, {}).expect(400);
  });
});

describe('focus', () => {
  const startOfDay = () => {
    const d = new Date(clock.now());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const focus = (id: string, dayStart = startOfDay()) => post(`/api/loops/${id}/focus`, { dayStart });
  const release = (id: string) => post(`/api/loops/${id}/release`);

  it('taking focus starts the clock, releasing stops it', async () => {
    const l = await create('Investor Update');
    expect(l.focusedAt).toBeNull();

    let r = await focus(l.id).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running' });
    expect(r.body.loop.focusedAt).toBe(clock.now());
    expect(r.body.undo.label).toMatch(/^Focused/);
    expect(await sessions(l.id)).toHaveLength(1);

    clock.advance(30 * M);
    r = await release(l.id).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'open', focusedAt: null, runningSince: null, accumulatedMs: 30 * M });
    expect(r.body.undo.label).toMatch(/^Released/);
  });

  it('focusing a loop that is already running keeps its session', async () => {
    const l = await create('Investor Update', { start: true });
    clock.advance(10 * M);
    const r = await focus(l.id).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running', runningSince: l.runningSince });
    expect(await sessions(l.id)).toHaveLength(1);
    // Focusing twice changes nothing.
    const again = await focus(l.id).expect(200);
    expect(again.body.loop.focusedAt).toBe(r.body.loop.focusedAt);
  });

  it('holds three loops and refuses a fourth until one is released', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await create(`Focus ${i}`)).id);
    for (const id of ids.slice(0, 3)) await focus(id).expect(200);
    const refused = await focus(ids[3]).expect(409);
    expect(refused.body.error.code).toBe('focus_full');
    expect(refused.body.error.message).toMatch(/release one first/);
    await release(ids[0]).expect(200);
    await focus(ids[3]).expect(200);
  });

  it('a pick from an earlier day does not count, and is cleared', async () => {
    const yesterday = await create('Yesterday');
    await focus(yesterday.id).expect(200);
    // Next day: the old pick is stale, so the slot is free again.
    clock.advance(26 * H);
    const today = await create('Today');
    const r = await focus(today.id).expect(200);
    expect(r.body.loop.focusedAt).toBe(clock.now());
    const state = await agent.get('/api/state').expect(200);
    expect(state.body.loops.find((l: Loop) => l.id === yesterday.id).focusedAt).toBeNull();
  });

  it('stopping or closing a focused loop lets it go', async () => {
    const a = await create('Stopped');
    await focus(a.id).expect(200);
    clock.advance(M);
    const stopped = await post(`/api/loops/${a.id}/stop`).expect(200);
    expect(stopped.body.loop.focusedAt).toBeNull();
    expect(stopped.body.undo.label).toMatch(/^Released/);

    const b = await create('Closed');
    await focus(b.id).expect(200);
    const closed = await post(`/api/loops/${b.id}/close`).expect(200);
    expect(closed.body.loop).toMatchObject({ state: 'closed', focusedAt: null });
    await focus(b.id).expect(409);
  });

  it('undo takes back a focus and a release', async () => {
    const l = await create('Investor Update');
    await focus(l.id).expect(200);
    let r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ state: 'open', focusedAt: null });
    expect(await sessions(l.id)).toHaveLength(0);

    await focus(l.id).expect(200);
    clock.advance(5 * M);
    await release(l.id).expect(200);
    r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running' });
    expect(r.body.loop.focusedAt).not.toBeNull();
  });

  it('refuses a day start that is not a plausible today', async () => {
    const l = await create('Investor Update');
    await post(`/api/loops/${l.id}/focus`, { dayStart: Date.now() + 2 * 86_400_000 }).expect(400);
    await post(`/api/loops/${l.id}/focus`, { dayStart: Date.now() - 5 * 86_400_000 }).expect(400);
  });
});

describe('notes checklist', () => {
  const note = (text: string, done = false) => ({ id: randomUUID(), text, done });
  const texts = (l: Loop) => l.notes.map((n) => n.text);

  it('captures the first note as the first line of the checklist', async () => {
    const l = await create('Investor Update', { note: 'September metrics' });
    expect(l.notes).toMatchObject([{ text: 'September metrics', done: false }]);
    expect(l.note).toBe('September metrics');
  });

  it('reads the first unchecked line, and moves on when it is checked off', async () => {
    const l = await create('Investor Update');
    const a = note('pull the numbers');
    const b = note('write the summary');
    let r = await patch(`/api/loops/${l.id}`, { notes: [a, b] }).expect(200);
    expect(r.body.loop.note).toBe('pull the numbers');

    r = await patch(`/api/loops/${l.id}`, { notes: [{ ...a, done: true }, b] }).expect(200);
    expect(r.body.loop.note).toBe('write the summary');
    // Checked lines stay where they were put.
    expect(texts(r.body.loop)).toEqual(['pull the numbers', 'write the summary']);

    r = await patch(`/api/loops/${l.id}`, { notes: [{ ...a, done: true }, { ...b, done: true }] }).expect(200);
    expect(r.body.loop.note).toBe('');
  });

  it('rearranging the list is what chooses the line the row reads', async () => {
    const l = await create('Investor Update');
    const a = note('pull the numbers');
    const b = note('write the summary');
    await patch(`/api/loops/${l.id}`, { notes: [a, b] }).expect(200);
    const r = await patch(`/api/loops/${l.id}`, { notes: [b, a] }).expect(200);
    expect(texts(r.body.loop)).toEqual(['write the summary', 'pull the numbers']);
    expect(r.body.loop.note).toBe('write the summary');
    expect(r.body.undo.label).toMatch(/^Edited notes on/);
  });

  it('cleans each line, drops blanks and refuses an oversized list', async () => {
    const l = await create('Investor Update');
    const r = await patch(`/api/loops/${l.id}`, {
      notes: [note('  pull \n the numbers '), note('   '), note('write the summary')],
    }).expect(200);
    expect(texts(r.body.loop)).toEqual(['pull the numbers', 'write the summary']);
    const many = Array.from({ length: 21 }, (_, i) => note(`line ${i}`));
    await patch(`/api/loops/${l.id}`, { notes: many }).expect(400);
  });

  it('a legacy note patch rewrites the active line and leaves the rest alone', async () => {
    const l = await create('Investor Update');
    const a = note('pull the numbers', true);
    const b = note('write the summary');
    await patch(`/api/loops/${l.id}`, { notes: [a, b] }).expect(200);
    const r = await patch(`/api/loops/${l.id}`, { note: 'write the summary today' }).expect(200);
    expect(texts(r.body.loop)).toEqual(['pull the numbers', 'write the summary today']);
  });

  it('undo puts the whole checklist back', async () => {
    const l = await create('Investor Update');
    const a = note('pull the numbers');
    const b = note('write the summary');
    await patch(`/api/loops/${l.id}`, { notes: [a, b] }).expect(200);
    await patch(`/api/loops/${l.id}`, { notes: [{ ...b, done: true }] }).expect(200);
    const r = await post('/api/undo').expect(200);
    expect(texts(r.body.loop)).toEqual(['pull the numbers', 'write the summary']);
    expect(r.body.loop.note).toBe('pull the numbers');
  });
});

describe('ball in court (delegated / waiting)', () => {
  it('new loops are mine', async () => {
    const l = await create('Mine by default');
    expect(l).toMatchObject({ owner: 'mine', ownerWith: '', handedOffAt: null, followUpAt: null });
  });

  it('delegates with a name and follow-up, keeps the handoff time when switching to waiting, and takes it back', async () => {
    const l = await create('BD Hire', { start: true });
    clock.advance(M);
    const followUp = clock.now() + 3 * 24 * H;
    let r = await patch(`/api/loops/${l.id}`, { owner: 'delegated', ownerWith: '  JG  ', followUpAt: followUp }).expect(200);
    expect(r.body.loop).toMatchObject({ owner: 'delegated', ownerWith: 'JG', handedOffAt: clock.now(), followUpAt: followUp, state: 'running' });
    expect(r.body.undo.label).toBe('Delegated BD Hire to JG');
    const handedOff = clock.now();

    clock.advance(2 * H);
    r = await patch(`/api/loops/${l.id}`, { owner: 'waiting', ownerWith: 'Recruiter' }).expect(200);
    expect(r.body.loop).toMatchObject({ owner: 'waiting', ownerWith: 'Recruiter', handedOffAt: handedOff, followUpAt: followUp });
    expect(r.body.undo.label).toBe('Waiting on Recruiter for BD Hire');

    r = await patch(`/api/loops/${l.id}`, { followUpAt: null }).expect(200);
    expect(r.body.loop.followUpAt).toBeNull();
    expect(r.body.undo.label).toBe('Cleared follow-up on BD Hire');

    r = await patch(`/api/loops/${l.id}`, { owner: 'mine' }).expect(200);
    expect(r.body.loop).toMatchObject({ owner: 'mine', ownerWith: '', handedOffAt: null, followUpAt: null });
    expect(r.body.undo.label).toBe('Took back BD Hire');
  });

  it('undo restores ownership exactly', async () => {
    const l = await create('Contract w/ Mike Bell');
    const followUp = clock.now() + 24 * H;
    await patch(`/api/loops/${l.id}`, { owner: 'waiting', ownerWith: 'Mike', followUpAt: followUp }).expect(200);
    clock.advance(M);
    await patch(`/api/loops/${l.id}`, { owner: 'mine' }).expect(200);
    let u = await post('/api/undo').expect(200);
    expect(u.body.loop).toMatchObject({ owner: 'waiting', ownerWith: 'Mike', followUpAt: followUp });
    u = await post('/api/undo').expect(200);
    expect(u.body.loop).toMatchObject({ owner: 'mine', ownerWith: '', handedOffAt: null, followUpAt: null });
  });

  it('validates owner, name length and follow-up date', async () => {
    const l = await create('Validate owner');
    await patch(`/api/loops/${l.id}`, { owner: 'boss' }).expect(400);
    await patch(`/api/loops/${l.id}`, { owner: 'delegated', ownerWith: 'x'.repeat(61) }).expect(400);
    await patch(`/api/loops/${l.id}`, { followUpAt: 'friday' }).expect(400);
    await patch(`/api/loops/${l.id}`, { followUpAt: Date.now() + 20 * 365 * 24 * H }).expect(400);
  });

  it('persists the owner filter setting', async () => {
    await agent.put('/api/settings').set('x-loop-client', '1').send({ ownerFilter: 'out' }).expect(200);
    const s = await agent.get('/api/state').expect(200);
    expect(s.body.settings.ownerFilter).toBe('out');
    await agent.put('/api/settings').set('x-loop-client', '1').send({ ownerFilter: 'team' }).expect(400);
  });
});

describe('edit start time', () => {
  const retime = (id: string, startedAt: number) => post(`/api/loops/${id}/retime`, { startedAt });

  it('moves a running session back so the timer reflects when work really began', async () => {
    const l = await create('Remembered late', { start: true });
    clock.advance(2 * M);
    const r = await retime(l.id, clock.now() - 3 * H).expect(200);
    expect(r.body.loop.runningSince).toBe(clock.now() - 3 * H);
    // Created time follows the start back.
    expect(r.body.loop.createdAt).toBe(clock.now() - 3 * H);
    expect(r.body.undo.label).toBe('Moved start of Remembered late');
    const s = await sessions(l.id);
    expect(s[0].startedAt).toBe(clock.now() - 3 * H);

    // Stopping accumulates the full backdated session.
    clock.advance(M);
    const stopped = await post(`/api/loops/${l.id}/stop`).expect(200);
    expect(stopped.body.loop.accumulatedMs).toBe(3 * H + M);
  });

  it('backdating a running loop past earlier sessions absorbs them (the Nexplay Web Dev case)', async () => {
    // Several short sessions today, then a running one.
    const l = await create('Nexplay Web Dev', { start: true });
    const day = clock.now();
    clock.advance(4_000);
    await post(`/api/loops/${l.id}/stop`).expect(200);
    for (const [gap, run] of [[2_000, 108 * M], [13_000, 20_000], [20_000, 3_000]] as const) {
      clock.advance(gap);
      await post(`/api/loops/${l.id}/start`).expect(200);
      clock.advance(run);
      await post(`/api/loops/${l.id}/stop`).expect(200);
    }
    clock.advance(45_000);
    await post(`/api/loops/${l.id}/start`).expect(200);
    clock.advance(81_000);
    const before = await sessions(l.id);
    expect(before).toHaveLength(5);

    // Really started 8 days ago.
    const target = day - 8 * 24 * H;
    const r = await retime(l.id, target).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running', runningSince: target, createdAt: target, accumulatedMs: 0 });
    expect(r.body.undo.label).toBe('Moved start of Nexplay Web Dev (merged 4 sessions)');
    const after = await sessions(l.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ startedAt: target, endedAt: null });

    // Undo puts every session back exactly.
    const u = await post('/api/undo').expect(200);
    expect(u.body.loop.accumulatedMs).toBe(before.filter((x) => x.endedAt).reduce((a, x) => a + x.endedAt! - x.startedAt, 0));
    const restored = await sessions(l.id);
    expect(restored.map((x) => [x.startedAt, x.endedAt])).toEqual(before.map((x) => [x.startedAt, x.endedAt]));
  });

  it('cuts a session that straddles the new start and keeps its earlier part', async () => {
    const l = await create('Straddle', { start: true });
    const s1 = clock.now();
    clock.advance(60 * M);
    await post(`/api/loops/${l.id}/stop`).expect(200); // 60m session
    clock.advance(30 * M);
    await post(`/api/loops/${l.id}/start`).expect(200);
    clock.advance(10 * M);

    const target = s1 + 40 * M; // inside the first session
    const r = await retime(l.id, target).expect(200);
    expect(r.body.loop.accumulatedMs).toBe(40 * M);
    expect(r.body.loop.runningSince).toBe(target);
    const list = await sessions(l.id);
    expect(list.map((x) => [x.startedAt - s1, x.endedAt == null ? null : x.endedAt - s1])).toEqual([
      [40 * M, null],
      [0, 40 * M],
    ]);
    // Total active time is unchanged by the overlap: 40m kept + running since the cut.
    expect(r.body.loop.accumulatedMs + (clock.now() - r.body.loop.runningSince)).toBe(100 * M);
  });

  it('moving a running start later needs no merging', async () => {
    const l = await create('Later', { start: true });
    clock.advance(30 * M);
    const r = await retime(l.id, clock.now() - 10 * M).expect(200);
    expect(r.body.loop.runningSince).toBe(clock.now() - 10 * M);
    expect(r.body.undo.label).toBe('Moved start of Later');
  });

  it('backdates when an open loop was opened', async () => {
    const l = await create('On my mind');
    const r = await retime(l.id, clock.now() - 5 * 24 * H).expect(200);
    expect(r.body.loop).toMatchObject({ state: 'open', createdAt: clock.now() - 5 * 24 * H, runningSince: null });
  });

  it('refuses an open-loop start after its first session', async () => {
    const l = await create('Has history', { start: true });
    const firstStart = clock.now();
    clock.advance(20 * M);
    await post(`/api/loops/${l.id}/stop`).expect(200);
    const r = await retime(l.id, firstStart + M).expect(400);
    expect(r.body.error.code).toBe('after_first_session');
  });

  it('rejects future and malformed times', async () => {
    const l = await create('Validation');
    expect((await retime(l.id, clock.now() + H).expect(400)).body.error.code).toBe('start_in_future');
    await post(`/api/loops/${l.id}/retime`, { startedAt: 'yesterday' }).expect(400);
    await post(`/api/loops/${l.id}/retime`, {}).expect(400);
  });

  it('undo restores the original session start and created time', async () => {
    const l = await create('Undo retime', { start: true });
    const originalStart = clock.now();
    clock.advance(5 * M);
    await retime(l.id, clock.now() - 2 * H).expect(200);
    const r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ runningSince: originalStart, createdAt: originalStart, state: 'running' });
    const s = await sessions(l.id);
    expect(s[0].startedAt).toBe(originalStart);
  });
});

describe('delete', () => {
  const del = (id: string) => agent.delete(`/api/loops/${id}`).set('x-loop-client', '1');

  it('removes a loop from state and blocks further actions', async () => {
    const l = await create('Delete me', { note: 'bye' });
    const r = await del(l.id).expect(200);
    expect(r.body).toMatchObject({ loop: null, deletedId: l.id });
    expect(r.body.undo.label).toBe('Deleted Delete me');
    const state = await agent.get('/api/state').expect(200);
    expect(state.body.loops.find((x: Loop) => x.id === l.id)).toBeUndefined();
    await post(`/api/loops/${l.id}/start`).expect(404);
    await patch(`/api/loops/${l.id}`, { title: 'nope' }).expect(404);
    await agent.get(`/api/loops/${l.id}/sessions`).expect(404);
    await del(l.id).expect(404);
  });

  it('requires the client header', async () => {
    const l = await create('Guarded');
    await agent.delete(`/api/loops/${l.id}`).expect(403);
  });

  it('finalizes a running session, and undo restores it running with its session', async () => {
    const l = await create('Running delete', { start: true });
    clock.advance(12 * M);
    await del(l.id).expect(200);
    const { rows } = await pool.query('SELECT ended_at FROM loop_sessions WHERE loop_id = $1', [l.id]);
    expect(rows[0].ended_at).not.toBeNull();

    clock.advance(M);
    const r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ id: l.id, state: 'running', accumulatedMs: 0, title: 'Running delete' });
    expect(r.body.loop.runningSince).toBe(clock.now() - 13 * M);
    const s = await sessions(l.id);
    expect(s).toHaveLength(1);
    expect(s[0].endedAt).toBeNull();
  });

  it('purges loops deleted more than 7 days ago', async () => {
    const old = await create('Old deleted');
    await del(old.id).expect(200);
    clock.advance(8 * 24 * H);
    const other = await create('Trigger purge');
    await del(other.id).expect(200);
    const { rows } = await pool.query('SELECT id FROM loops WHERE id = $1', [old.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('undo', () => {
  it('undoes a stop by resuming the same session', async () => {
    const l = await create('Undo stop', { start: true });
    clock.advance(10 * M);
    await post(`/api/loops/${l.id}/stop`).expect(200);
    clock.advance(M);
    const r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running', accumulatedMs: 0 });
    expect(r.body.loop.runningSince).toBe(clock.now() - 11 * M);
    const s = await sessions(l.id);
    expect(s).toHaveLength(1);
    expect(s[0].endedAt).toBeNull();
  });

  it('undoes a start by removing the session', async () => {
    const l = await create('Undo start');
    await post(`/api/loops/${l.id}/start`).expect(200);
    const r = await post('/api/undo').expect(200);
    expect(r.body.loop.state).toBe('open');
    expect(await sessions(l.id)).toHaveLength(0);
  });

  it('undoes closing a running loop back to running', async () => {
    const l = await create('Undo close', { start: true });
    clock.advance(5 * M);
    await post(`/api/loops/${l.id}/close`).expect(200);
    const r = await post('/api/undo').expect(200);
    expect(r.body.loop).toMatchObject({ state: 'running', closedAt: null, accumulatedMs: 0 });
  });

  it('undoes a create by removing the loop', async () => {
    const l = await create('Oops');
    const r = await post('/api/undo').expect(200);
    expect(r.body.deletedId).toBe(l.id);
    expect(r.body.loop).toBeNull();
    await post(`/api/loops/${l.id}/start`).expect(404);
  });

  it('walks back through multiple actions, then reports nothing to undo', async () => {
    const l = await create('Stack');
    await patch(`/api/loops/${l.id}`, { priority: true }).expect(200);
    await patch(`/api/loops/${l.id}`, { title: 'Stack renamed' }).expect(200);
    let r = await post('/api/undo').expect(200);
    expect(r.body.loop.title).toBe('Stack');
    r = await post('/api/undo').expect(200);
    expect(r.body.loop.priority).toBe(false);
    await post('/api/undo').expect(200); // create
    await post('/api/undo').expect(409);
  });

  it('expires undo after the window', async () => {
    const l = await create('Old');
    await post(`/api/loops/${l.id}/start`).expect(200);
    clock.advance(31 * M);
    const state = await agent.get('/api/state').expect(200);
    expect(state.body.undo).toBeNull();
    await post('/api/undo').expect(409);
  });
});

describe('state, settings and persistence', () => {
  it('persists loops, running timers and settings across app restarts', async () => {
    const l = await create('Persistent', { start: true, note: 'survives restarts' });
    clock.advance(7 * M);
    await agent.put('/api/settings').set('x-loop-client', '1').send({ runSort: 'alpha', archiveOpen: true }).expect(200);

    // Simulate a server restart: brand-new pool and app instance.
    const pool2 = createPool(TEST_DATABASE_URL);
    try {
      const agent2 = makeAgent(pool2);
      clock.advance(3 * M);
      const res = await agent2.get('/api/state').expect(200);
      const found = res.body.loops.find((x: Loop) => x.id === l.id) as Loop;
      expect(found).toMatchObject({ state: 'running', note: 'survives restarts' });
      expect(res.body.serverNow - found.runningSince! + found.accumulatedMs).toBe(10 * M);
      expect(res.body.settings).toMatchObject({ runSort: 'alpha', archiveOpen: true, openSort: 'oldest' });
    } finally {
      await pool2.end();
    }
  });

  it('rejects unknown settings', async () => {
    await agent.put('/api/settings').set('x-loop-client', '1').send({ runSort: 'random' }).expect(400);
    await agent.put('/api/settings').set('x-loop-client', '1').send({ evil: true }).expect(400);
  });

  it('returns serverNow for client clock alignment', async () => {
    const res = await agent.get('/api/state').expect(200);
    expect(res.body.serverNow).toBe(clock.now());
  });
});

describe('deadlines', () => {
  const D = 24 * H;
  const conversions = async (id: string) =>
    (await pool.query('SELECT from_type, to_type FROM loop_timer_changes WHERE loop_id = $1 ORDER BY id', [id])).rows;

  it('ages by default and counts down when given a date', async () => {
    const soft = await create('Soft work');
    expect(soft).toMatchObject({ timerType: 'elapsed', deadlineAt: null });

    const due = clock.now() + 13 * D;
    const res = await post('/api/loops', { id: randomUUID(), title: 'Board deck', deadlineAt: due }).expect(201);
    expect(res.body.loop).toMatchObject({ timerType: 'countdown', deadlineAt: due });
  });

  it('rejects a deadline that is out of range', async () => {
    await post('/api/loops', { id: randomUUID(), title: 'Someday', deadlineAt: clock.now() + 20 * 365 * D }).expect(400);
    await post('/api/loops', { id: randomUUID(), title: 'Someday', deadlineAt: 'friday' }).expect(400);
  });

  it('converts an ageing loop the moment it gets a real date', async () => {
    const l = await create('Vendor contract');
    const due = clock.now() + 5 * D;
    const res = await patch(`/api/loops/${l.id}`, { deadlineAt: due }).expect(200);
    expect(res.body.loop).toMatchObject({ timerType: 'countdown', deadlineAt: due });
    expect(res.body.undo.label).toMatch(/Set a deadline/);
    expect(await conversions(l.id)).toEqual([{ from_type: 'elapsed', to_type: 'countdown' }]);
  });

  it('moves a deadline without logging a conversion', async () => {
    const l = await create('Filing');
    await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + 2 * D }).expect(200);
    const res = await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + 9 * D }).expect(200);
    expect(res.body.loop.deadlineAt).toBe(clock.now() + 9 * D);
    expect(res.body.undo.label).toMatch(/Moved the deadline/);
    expect(await conversions(l.id)).toHaveLength(1);
  });

  it('refuses to drop a deadline by clearing the date', async () => {
    const l = await create('Audit response');
    await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + D }).expect(200);
    const res = await patch(`/api/loops/${l.id}`, { deadlineAt: null }).expect(409);
    expect(res.body.error.code).toBe('deadline_locked');
    expect((await agent.get(`/api/state`)).body.loops.find((x: Loop) => x.id === l.id).deadlineAt).toBe(clock.now() + D);
  });

  it('drops a deadline only when the timer is switched back on purpose', async () => {
    const l = await create('Audit response');
    await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + D }).expect(200);
    const res = await patch(`/api/loops/${l.id}`, { timerType: 'elapsed' }).expect(200);
    expect(res.body.loop).toMatchObject({ timerType: 'elapsed', deadlineAt: null });
    expect(res.body.undo.label).toMatch(/Dropped the deadline/);
    expect(await conversions(l.id)).toEqual([
      { from_type: 'elapsed', to_type: 'countdown' },
      { from_type: 'countdown', to_type: 'elapsed' },
    ]);
  });

  it('rejects a countdown with no date, and a date with no countdown', async () => {
    const l = await create('Nothing due');
    expect((await patch(`/api/loops/${l.id}`, { timerType: 'countdown' }).expect(400)).body.error.code).toBe('deadline_required');
    await patch(`/api/loops/${l.id}`, { timerType: 'elapsed', deadlineAt: clock.now() + D }).expect(400);
  });

  it('undoes a conversion completely, log and all', async () => {
    const l = await create('Grant application');
    await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + 4 * D }).expect(200);
    const res = await post('/api/undo').expect(200);
    expect(res.body.loop).toMatchObject({ timerType: 'elapsed', deadlineAt: null });
    expect(await conversions(l.id)).toEqual([]);
  });

  it('keeps the deadline on a loop that is closed and reopened', async () => {
    const l = await create('Tax filing');
    const due = clock.now() + 3 * D;
    await patch(`/api/loops/${l.id}`, { deadlineAt: due }).expect(200);
    await post(`/api/loops/${l.id}/close`).expect(200);
    const res = await post(`/api/loops/${l.id}/reopen`).expect(200);
    expect(res.body.loop).toMatchObject({ timerType: 'countdown', deadlineAt: due });
  });

  it('stores the timer filter with the other view settings', async () => {
    const res = await agent.put('/api/settings').set('x-loop-client', '1').send({ timerFilter: 'deadline' }).expect(200);
    expect(res.body.settings.timerFilter).toBe('deadline');
    await agent.put('/api/settings').set('x-loop-client', '1').send({ timerFilter: 'someday' }).expect(400);
  });
});


describe('work / personal scope', () => {
  it('is born into work unless the client says otherwise', async () => {
    const l = await create('quarterly review');
    expect(l.scope).toBe('work');
  });

  it('captures into personal when that is the scope', async () => {
    const l = await create('book the dentist', { scope: 'personal' });
    expect(l.scope).toBe('personal');
    const state = await agent.get('/api/state').expect(200);
    expect(state.body.loops.find((x: Loop) => x.id === l.id).scope).toBe('personal');
  });

  it('rejects a scope that is neither', async () => {
    await post('/api/loops', { id: randomUUID(), title: 'x', scope: 'side-project' }).expect(400);
    const l = await create('x');
    await patch(`/api/loops/${l.id}`, { scope: 'errands' }).expect(400);
  });

  it('moves a loop between worlds and back', async () => {
    const l = await create('pay the tax bill');
    const moved = await patch(`/api/loops/${l.id}`, { scope: 'personal' }).expect(200);
    expect(moved.body.loop.scope).toBe('personal');
    expect(moved.body.undo.label).toMatch(/personal/i);

    const back = await patch(`/api/loops/${l.id}`, { scope: 'work' }).expect(200);
    expect(back.body.loop.scope).toBe('work');
  });

  it('undoes a move, putting the loop back where it was', async () => {
    const l = await create('book the dentist', { scope: 'personal' });
    await patch(`/api/loops/${l.id}`, { scope: 'work' }).expect(200);
    const undone = await post('/api/undo').expect(200);
    expect(undone.body.loop.scope).toBe('personal');
  });

  it('keeps the scope through the rest of a loop\u2019s life', async () => {
    const l = await create('renew the passport', { scope: 'personal', start: true });
    clock.advance(30 * M);
    await post(`/api/loops/${l.id}/stop`).expect(200);
    const closed = await post(`/api/loops/${l.id}/close`).expect(200);
    expect(closed.body.loop.scope).toBe('personal');
    const reopened = await post(`/api/loops/${l.id}/reopen`).expect(200);
    expect(reopened.body.loop.scope).toBe('personal');
  });

  it('reports no change when the scope is already that', async () => {
    const l = await create('x');
    const res = await patch(`/api/loops/${l.id}`, { scope: 'work' }).expect(200);
    expect(res.body.loop.scope).toBe('work');
    expect(res.body.undo?.label).not.toMatch(/moved/i);
  });

  it('moves a loop without disturbing its timer, owner or deadline', async () => {
    const l = await create('ship the deck', { start: true });
    clock.advance(2 * H);
    await patch(`/api/loops/${l.id}`, { owner: 'delegated', ownerWith: 'Sam' }).expect(200);
    await patch(`/api/loops/${l.id}`, { deadlineAt: clock.now() + 3 * 24 * H }).expect(200);
    const moved = await patch(`/api/loops/${l.id}`, { scope: 'personal' }).expect(200);
    expect(moved.body.loop.scope).toBe('personal');
    expect(moved.body.loop.state).toBe('running');
    expect(moved.body.loop.owner).toBe('delegated');
    expect(moved.body.loop.ownerWith).toBe('Sam');
    expect(moved.body.loop.timerType).toBe('countdown');
  });
});
