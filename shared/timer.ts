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

// ── Deadlines ────────────────────────────────────────────────────────────

const DAY = 86_400_000;

type DeadlineFields = Pick<Loop, 'timerType' | 'deadlineAt' | 'state'>;

/**
 * How close a countdown loop is to its deadline.
 *   calm     more than a week out — no pressure yet
 *   soon     3–7 days
 *   near     under 3 days
 *   urgent   under 24 hours — floats to the top of its list
 *   overdue  past the deadline — counts up instead, pinned above everything
 * `none` covers every elapsed loop, and closed loops: a closed loop has no
 * deadline left to miss.
 */
export type DeadlineTier = 'none' | 'calm' | 'soon' | 'near' | 'urgent' | 'overdue';

/** Time left before the deadline (negative once past it), or null for an elapsed loop. */
export function remainingMs(loop: DeadlineFields, now: number): number | null {
  if (loop.timerType !== 'countdown' || loop.deadlineAt == null) return null;
  return loop.deadlineAt - now;
}

export function deadlineTier(loop: DeadlineFields, now: number): DeadlineTier {
  if (loop.state === 'closed') return 'none';
  const left = remainingMs(loop, now);
  if (left == null) return 'none';
  if (left <= 0) return 'overdue';
  if (left <= DAY) return 'urgent';
  if (left <= 3 * DAY) return 'near';
  if (left <= 7 * DAY) return 'soon';
  return 'calm';
}

/**
 * The fire tier: due within a day, or already missed. These override the
 * chosen sort and sit at the top of their list. Nothing else does — an
 * elapsed loop stays where the user's sort puts it, however old it gets.
 */
export function isFireTier(loop: DeadlineFields, now: number): boolean {
  const tier = deadlineTier(loop, now);
  return tier === 'urgent' || tier === 'overdue';
}

/**
 * Stable partition putting fire-tier loops first, soonest deadline at the top.
 * Used where two already-sorted lists are shown as one.
 */
export function hoistFireTier(loops: Loop[], now: number): Loop[] {
  const fire = loops.filter((l) => isFireTier(l, now));
  if (!fire.length || fire.length === loops.length) return loops;
  fire.sort((a, b) => (a.deadlineAt ?? 0) - (b.deadlineAt ?? 0) || a.id.localeCompare(b.id));
  return [...fire, ...loops.filter((l) => !isFireTier(l, now))];
}

const byTitle = (a: Loop, b: Loop) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });

/**
 * Fire-tier deadlines first (soonest, then most overdue), then priority loops,
 * then the chosen comparator; ties fall back to id for stability.
 */
function withPriority(cmp: (a: Loop, b: Loop) => number, now: number) {
  return (a: Loop, b: Loop) => {
    const aFire = isFireTier(a, now);
    const bFire = isFireTier(b, now);
    if (aFire !== bFire) return aFire ? -1 : 1;
    if (aFire && bFire) return (a.deadlineAt ?? 0) - (b.deadlineAt ?? 0) || a.id.localeCompare(b.id);
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
  return loops.slice().sort(withPriority(cmp, now));
}

export function sortOpen(loops: Loop[], mode: OpenSort, now: number): Loop[] {
  const cmp =
    mode === 'alpha'
      ? byTitle
      : mode === 'newest'
        ? (a: Loop, b: Loop) => b.createdAt - a.createdAt
        : (a: Loop, b: Loop) => a.createdAt - b.createdAt;
  return loops.slice().sort(withPriority(cmp, now));
}

export function sortClosed(loops: Loop[]): Loop[] {
  return loops.slice().sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
}
