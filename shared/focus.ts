import { FOCUS_MAX, type Loop } from './types';

/**
 * Focus: the two or three loops you are actually working on right now.
 *
 * Taking focus starts the loop's timer, releasing it stops it, and a focused
 * loop lives in the FOCUS section instead of RUNNING or OPEN. Focus is for
 * today only — a pick made yesterday is not focus today, so the section is
 * empty every morning and has to be re-chosen rather than inherited.
 */

/** Local midnight for `now`. Focus is picked, and expires, by the user's day. */
export function dayStart(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Is this loop in focus as of `now`? Yesterday's picks and closed loops are not. */
export function isFocused(l: Loop, now: number): boolean {
  return l.focusedAt != null && l.state !== 'closed' && l.focusedAt >= dayStart(now);
}

/** Oldest pick first, so taking a new one never reshuffles the list under you. */
export const sortFocus = (loops: Loop[]): Loop[] => [...loops].sort((a, b) => (a.focusedAt ?? 0) - (b.focusedAt ?? 0));

/** How many slots are left. */
export const focusFree = (taken: number): number => Math.max(0, FOCUS_MAX - taken);
