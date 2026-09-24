import { describe, expect, it } from 'vitest';
import { dayStart, focusFree, isFocused, sortFocus } from '../../shared/focus';
import { FOCUS_MAX, type Loop } from '../../shared/types';

const NOON = new Date(2026, 8, 20, 12, 0).getTime();
const DAY = 86_400_000;

function loop(p: Partial<Loop> & { id: string }): Loop {
  return {
    title: p.id,
    note: '',
    notes: [],
    priority: false,
    state: 'running',
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
    focusedAt: null,
    ...p,
  };
}

describe('dayStart', () => {
  it('is the local midnight of the day in question', () => {
    const d = new Date(dayStart(NOON));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(new Date(NOON).getDate());
    expect(dayStart(NOON + 6 * 3_600_000)).toBe(dayStart(NOON));
  });
});

describe('isFocused', () => {
  it('holds for a loop picked earlier today', () => {
    expect(isFocused(loop({ id: 'a', focusedAt: NOON - 3_600_000 }), NOON)).toBe(true);
    expect(isFocused(loop({ id: 'b', focusedAt: dayStart(NOON) }), NOON)).toBe(true);
  });

  it('lapses at the end of the day it was taken', () => {
    expect(isFocused(loop({ id: 'a', focusedAt: NOON - DAY }), NOON)).toBe(false);
    expect(isFocused(loop({ id: 'b', focusedAt: dayStart(NOON) - 1 }), NOON)).toBe(false);
  });

  it('is never true for a loop that was never picked, or one that is closed', () => {
    expect(isFocused(loop({ id: 'a' }), NOON)).toBe(false);
    expect(isFocused(loop({ id: 'b', focusedAt: NOON, state: 'closed' }), NOON)).toBe(false);
  });
});

describe('sortFocus', () => {
  it('keeps the order they were picked in, so a new pick never reshuffles the list', () => {
    const list = [
      loop({ id: 'third', focusedAt: NOON }),
      loop({ id: 'first', focusedAt: NOON - 2 * 3_600_000 }),
      loop({ id: 'second', focusedAt: NOON - 3_600_000 }),
    ];
    expect(sortFocus(list).map((l) => l.id)).toEqual(['first', 'second', 'third']);
    // The input is left alone.
    expect(list[0].id).toBe('third');
  });
});

describe('focusFree', () => {
  it('counts down the slots and never goes below zero', () => {
    expect(focusFree(0)).toBe(FOCUS_MAX);
    expect(focusFree(FOCUS_MAX)).toBe(0);
    expect(focusFree(FOCUS_MAX + 2)).toBe(0);
  });
});
