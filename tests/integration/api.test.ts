import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import type { Pool } from '../../server/db';
import { createPool } from '../../server/db';
import { TEST_DATABASE_URL, fakeClock, freshDatabase } from '../helpers/db';
import type { Loop, Session } from '../../shared/types';

const KEY = 'integration-test-access-key';
const M = 60_000;
const H = 60 * M;

let pool: Pool;
const clock = fakeClock();
let agent: ReturnType<typeof request.agent>;

function makeAgent(p: Pool) {
  return request.agent(createApp({ pool: p, accessKey: KEY, clock: clock.now }));
}

async function login(a: ReturnType<typeof request.agent>) {
  await a.post('/api/auth/login').set('x-loop-client', '1').send({ key: KEY }).expect(200);
}

const post = (path: string, body?: object) => agent.post(path).set('x-loop-client', '1').send(body ?? {});
const patch = (path: string, body: object) => agent.patch(path).set('x-loop-client', '1').send(body);

async function create(title: string, opts: { start?: boolean; note?: string } = {}): Promise<Loop> {
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
  await pool.query('TRUNCATE loops, loop_sessions, action_history, settings, auth_sessions CASCADE');
  agent = makeAgent(pool);
  await login(agent);
});

describe('access control', () => {
  it('rejects private endpoints without a session', async () => {
    const anon = makeAgent(pool);
    await anon.get('/api/state').expect(401);
    await anon.post('/api/loops').set('x-loop-client', '1').send({ id: randomUUID(), title: 'x' }).expect(401);
    await anon.get(`/api/loops/${randomUUID()}/sessions`).expect(401);
  });

  it('keeps the health check public and data-free', async () => {
    const res = await makeAgent(pool).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects a wrong access key', async () => {
    const anon = makeAgent(pool);
    await anon.post('/api/auth/login').set('x-loop-client', '1').send({ key: 'nope' }).expect(401);
    await anon.get('/api/state').expect(401);
  });

  it('requires the client header on state-changing requests', async () => {
    await agent.post('/api/loops').send({ id: randomUUID(), title: 'x' }).expect(403);
  });

  it('sets an HttpOnly session cookie and logs out', async () => {
    const anon = makeAgent(pool);
    const res = await anon.post('/api/auth/login').set('x-loop-client', '1').send({ key: KEY }).expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    await anon.get('/api/state').expect(200);
    await anon.post('/api/auth/logout').set('x-loop-client', '1').expect(200);
    await anon.get('/api/state').expect(401);
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
      await login(agent2);
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
