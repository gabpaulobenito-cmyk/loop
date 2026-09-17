import type { Loop, OpenSort, RunSort } from './types';

type TimerFields = Pick<Loop, 'accumulatedMs' | 'runningSince'>;

/**
 * Total active time of a loop at `now`.
 * Authoritative formula: accumulated duration + (now − running session start).
 * Never derived from a ticking counter, so it survives refreshes, sleep and devices.
 */
export function elapsedMs(loop: TimerFields, now: number): number {
  const live = loop.runningSince == null ? 0 : Math.max(0, now - loop.runningSince);
  return loop.accumulatedMs + live;
}

/** Duration of the current running session at `now` (0 when not running). */
export function currentSessionMs(loop: TimerFields, now: number): number {
  return loop.runningSince == null ? 0 : Math.max(0, now - loop.runningSince);
}

/** Result of finalizing a running session at `now`. */
export function finalizeSession(loop: TimerFields, now: number): { accumulatedMs: number; durationMs: number } {
  const durationMs = currentSessionMs(loop, now);
  return { accumulatedMs: loop.accumulatedMs + durationMs, durationMs };
}

const byTitle = (a: Loop, b: Loop) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });

/** Priority loops first, then the chosen comparator; ties fall back to id for stability. */
function withPriority(cmp: (a: Loop, b: Loop) => number) {
  return (a: Loop, b: Loop) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return cmp(a, b) || a.id.localeCompare(b.id);
  };
}

export function sortRunning(loops: Loop[], mode: RunSort, now: number): Loop[] {
  const cmp =
    mode === 'alpha'
      ? byTitle
      : mode === 'shortest'
        ? (a: Loop, b: Loop) => elapsedMs(a, now) - elapsedMs(b, now)
        : (a: Loop, b: Loop) => elapsedMs(b, now) - elapsedMs(a, now);
  return loops.slice().sort(withPriority(cmp));
}

export function sortOpen(loops: Loop[], mode: OpenSort): Loop[] {
  const cmp =
    mode === 'alpha'
      ? byTitle
      : mode === 'newest'
        ? (a: Loop, b: Loop) => b.createdAt - a.createdAt
        : (a: Loop, b: Loop) => a.createdAt - b.createdAt;
  return loops.slice().sort(withPriority(cmp));
}

export function sortClosed(loops: Loop[]): Loop[] {
  return loops.slice().sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}
