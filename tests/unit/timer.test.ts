import { describe, expect, it } from 'vitest';
import {
  currentSessionMs,
  deadlineTier,
  elapsedMs,
  finalizeSession,
  hoistFireTier,
  isFireTier,
  remainingMs,
  sortClosed,
  sortOpen,
  sortRunning,
} from '../../shared/timer';
import type { Loop } from '../../shared/types';

const H = 3_600_000;
const M = 60_000;

function loop(p: Partial<Loop> & { id: string }): Loop {
  return {
    title: p.id,
    note: '',
    notes: [],
    focusedAt: null,
    priority: false,
    state: 'open',
    createdAt: 0,
    closedAt: null,
    runningSince: null,
    accumulatedMs: 0,
    sessionCount: 0,
    updatedAt: 0,
    scope: 'work',
    owner: 'mine',
    ownerWith: '',
    handedOffAt: null,
    followUpAt: null,
    timerType: 'elapsed',
    deadlineAt: null,
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
    expect(sortOpen([a, b, c], 'oldest', now).map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(sortOpen([a, b, c], 'newest', now).map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect(sortOpen([a, b, c], 'alpha', now).map((l) => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps priority loops on top regardless of sort', () => {
    const pa = { ...a, priority: true };
    expect(sortRunning([pa, b, c], 'longest', now)[0].id).toBe('a');
    expect(sortOpen([pa, b, c], 'oldest', now)[0].id).toBe('a');
  });

  it('floats deadlines in their last day above everything, soonest first', () => {
    const soon = { ...a, id: 'soon', deadlineAt: now + 20 * H, timerType: 'countdown' as const };
    const late = { ...b, id: 'late', deadlineAt: now - 2 * H, timerType: 'countdown' as const };
    const flagged = { ...c, priority: true };
    expect(sortRunning([flagged, soon, late], 'longest', now).map((l) => l.id)).toEqual(['late', 'soon', 'c']);
    expect(sortOpen([flagged, soon, late], 'oldest', now).map((l) => l.id)).toEqual(['late', 'soon', 'c']);
  });

  it('leaves calmer deadlines to the ordinary sort', () => {
    const later = { ...a, id: 'later', deadlineAt: now + 9 * 24 * H, timerType: 'countdown' as const };
    expect(sortRunning([later, b, c], 'longest', now).map((l) => l.id)).toEqual(['c', 'b', 'later']);
  });

  it('never reorders ageing loops by how long they have been open', () => {
    const ancient = loop({ id: 'ancient', createdAt: -400 * 24 * H, title: 'Zulu' });
    expect(sortOpen([ancient, b, c], 'newest', now).map((l) => l.id)).toEqual(['c', 'b', 'ancient']);
  });

  it('hoists fire-tier loops when two lists are shown as one', () => {
    const hot = { ...c, id: 'hot', deadlineAt: now + 3 * H, timerType: 'countdown' as const };
    expect(hoistFireTier([a, b, hot], now).map((l) => l.id)).toEqual(['hot', 'a', 'b']);
    expect(hoistFireTier([a, b], now).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('orders closed loops by most recently closed', () => {
    const x = loop({ id: 'x', state: 'closed', closedAt: 5 });
    const y = loop({ id: 'y', state: 'closed', closedAt: 9 });
    expect(sortClosed([x, y]).map((l) => l.id)).toEqual(['y', 'x']);
  });
});

describe('deadlines', () => {
  const now = 100 * 24 * H;
  const due = (inMs: number, extra: Partial<Loop> = {}) =>
    loop({ id: 'd', timerType: 'countdown', deadlineAt: now + inMs, ...extra });

  it('has no tier without a deadline', () => {
    expect(deadlineTier(loop({ id: 'x' }), now)).toBe('none');
    expect(remainingMs(loop({ id: 'x' }), now)).toBeNull();
  });

  it('escalates as the deadline approaches', () => {
    expect(deadlineTier(due(8 * 24 * H), now)).toBe('calm');
    expect(deadlineTier(due(7 * 24 * H), now)).toBe('soon');
    expect(deadlineTier(due(4 * 24 * H), now)).toBe('soon');
    expect(deadlineTier(due(3 * 24 * H), now)).toBe('near');
    expect(deadlineTier(due(25 * H), now)).toBe('near');
    expect(deadlineTier(due(24 * H), now)).toBe('urgent');
    expect(deadlineTier(due(1), now)).toBe('urgent');
    expect(deadlineTier(due(0), now)).toBe('overdue');
    expect(deadlineTier(due(-5 * 24 * H), now)).toBe('overdue');
  });

  it('counts down, then counts up once the date has passed', () => {
    expect(remainingMs(due(13 * 24 * H), now)).toBe(13 * 24 * H);
    expect(remainingMs(due(-2 * H), now)).toBe(-2 * H);
  });

  it('lets a closed loop off the hook', () => {
    expect(deadlineTier(due(-9 * 24 * H, { state: 'closed', closedAt: now }), now)).toBe('none');
    expect(isFireTier(due(-9 * 24 * H, { state: 'closed', closedAt: now }), now)).toBe(false);
  });

  it('puts only the last day and beyond in the fire tier', () => {
    expect(isFireTier(due(2 * 24 * H), now)).toBe(false);
    expect(isFireTier(due(6 * H), now)).toBe(true);
    expect(isFireTier(due(-1), now)).toBe(true);
  });
});
