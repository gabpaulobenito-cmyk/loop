import { describe, expect, it } from 'vitest';
import { currentSessionMs, elapsedMs, finalizeSession, sortClosed, sortOpen, sortRunning } from '../../shared/timer';
import type { Loop } from '../../shared/types';

const H = 3_600_000;
const M = 60_000;

function loop(p: Partial<Loop> & { id: string }): Loop {
  return {
    title: p.id,
    note: '',
    priority: false,
    state: 'open',
    createdAt: 0,
    closedAt: null,
    runningSince: null,
    accumulatedMs: 0,
    sessionCount: 0,
    updatedAt: 0,
    ...p,
  };
}

describe('elapsedMs', () => {
  it('is the accumulated duration when stopped', () => {
    expect(elapsedMs({ accumulatedMs: 5 * M, runningSince: null }, 10 * H)).toBe(5 * M);
  });

  it('adds now − running session start while running', () => {
    expect(elapsedMs({ accumulatedMs: 5 * M, runningSince: 1000 }, 1000 + 90_000)).toBe(5 * M + 90_000);
  });

  it('is derived from timestamps, so any later "now" (refresh, sleep, other device) gives the right value', () => {
    const l = { accumulatedMs: 2 * H, runningSince: 1_000_000 };
    expect(elapsedMs(l, 1_000_000 + 8 * H)).toBe(10 * H);
  });

  it('never goes negative when the client clock is behind the session start', () => {
    expect(elapsedMs({ accumulatedMs: 0, runningSince: 5000 }, 4000)).toBe(0);
    expect(currentSessionMs({ accumulatedMs: 0, runningSince: 5000 }, 4000)).toBe(0);
  });
});

describe('finalizeSession', () => {
  it('accumulates the running session into the total', () => {
    const r = finalizeSession({ accumulatedMs: 10 * M, runningSince: 0 }, 25 * M);
    expect(r).toEqual({ accumulatedMs: 35 * M, durationMs: 25 * M });
  });

  it('start → stop → resume → stop sums both sessions', () => {
    let l = { accumulatedMs: 0, runningSince: 0 as number | null };
    l = { accumulatedMs: finalizeSession(l, 10 * M).accumulatedMs, runningSince: null };
    l = { ...l, runningSince: 60 * M };
    expect(elapsedMs(l, 65 * M)).toBe(15 * M);
    l = { accumulatedMs: finalizeSession(l, 80 * M).accumulatedMs, runningSince: null };
    expect(l.accumulatedMs).toBe(30 * M);
  });
});

describe('sorting', () => {
  const now = 10 * H;
  const a = loop({ id: 'a', title: 'Bravo', state: 'running', runningSince: now - 1 * H, createdAt: 3 });
  const b = loop({ id: 'b', title: 'alpha', state: 'running', runningSince: now - 3 * H, createdAt: 1 });
  const c = loop({ id: 'c', title: 'Charlie', state: 'running', runningSince: now - 2 * H, createdAt: 2, accumulatedMs: 2 * H });

  it('sorts running loops longest / shortest / alphabetical', () => {
    expect(sortRunning([a, b, c], 'longest', now).map((l) => l.id)).toEqual(['c', 'b', 'a']);
    expect(sortRunning([a, b, c], 'shortest', now).map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(sortRunning([a, b, c], 'alpha', now).map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts open loops oldest / newest / alphabetical', () => {
    expect(sortOpen([a, b, c], 'oldest').map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(sortOpen([a, b, c], 'newest').map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(sortOpen([a, b, c], 'alpha').map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps priority loops on top regardless of sort', () => {
    const pa = { ...a, priority: true };
    expect(sortRunning([pa, b, c], 'longest', now)[0].id).toBe('a');
    expect(sortOpen([pa, b, c], 'oldest')[0].id).toBe('a');
  });

  it('orders closed loops by most recently closed', () => {
    const x = loop({ id: 'x', state: 'closed', closedAt: 5 });
    const y = loop({ id: 'y', state: 'closed', closedAt: 9 });
    expect(sortClosed([x, y]).map((l) => l.id)).toEqual(['y', 'x']);
  });
});
