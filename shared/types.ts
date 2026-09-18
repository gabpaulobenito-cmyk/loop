export type LoopState = 'running' | 'open' | 'closed';

/**
 * How a loop's clock reads.
 *   elapsed    counts up from when the loop was opened — visibility into neglect
 *   countdown  counts down to a real external deadline — urgency with a consequence
 */
export type TimerType = 'elapsed' | 'countdown';

/** Ball in court: who is moving the loop forward. */
export type Owner = 'mine' | 'delegated' | 'waiting';

/** Wire format for a loop. All timestamps are epoch milliseconds (server clock). */
export interface Loop {
  id: string;
  title: string;
  note: string;
  priority: boolean;
  state: LoopState;
  createdAt: number;
  closedAt: number | null;
  /** Start of the current running session, or null when not running. */
  runningSince: number | null;
  /** Sum of all finished session durations. Excludes the current running session. */
  accumulatedMs: number;
  sessionCount: number;
  updatedAt: number;
  owner: Owner;
  /** Who it's with (delegated to / waiting on). Empty for `mine`. */
  ownerWith: string;
  /** When it left your hands; null for `mine`. */
  handedOffAt: number | null;
  /** When to check back; null when not set. */
  followUpAt: number | null;
  /** Which clock this loop reads. Every loop has exactly one. */
  timerType: TimerType;
  /** The hard external deadline; set exactly when `timerType` is `countdown`. */
  deadlineAt: number | null;
}

export interface Session {
  id: string;
  loopId: string;
  startedAt: number;
  endedAt: number | null;
}

export type RunSort = 'longest' | 'shortest' | 'alpha';
export type OpenSort = 'oldest' | 'newest' | 'alpha';
export type ThemePref = 'dark' | 'light' | 'system';
export type ArchiveRange = '7d' | 'all';
export type OwnerFilter = 'all' | 'mine' | 'out';
export type TimerFilter = 'all' | 'deadline' | 'aging';

export interface Settings {
  runSort: RunSort;
  openSort: OpenSort;
  archiveOpen: boolean;
  archiveRange: ArchiveRange;
  theme: ThemePref;
  ownerFilter: OwnerFilter;
  timerFilter: TimerFilter;
}

export const DEFAULT_SETTINGS: Settings = {
  runSort: 'longest',
  openSort: 'oldest',
  archiveOpen: false,
  archiveRange: '7d',
  theme: 'dark',
  ownerFilter: 'all',
  timerFilter: 'all',
};

export interface UndoTop {
  id: number;
  label: string;
  createdAt: number;
}

export interface StateResponse {
  serverNow: number;
  loops: Loop[];
  settings: Settings;
  undo: UndoTop | null;
}

export interface LoopMutationResponse {
  serverNow: number;
  loop: Loop | null;
  deletedId?: string;
  undo: UndoTop | null;
}

export const TITLE_MAX = 140;
export const NOTE_MAX = 280;
export const WITH_MAX = 60;
/** How far ahead or behind a deadline or follow-up date may be set. */
export const DATE_RANGE_MS = 10 * 365 * 86_400_000;
/** Actions older than this can no longer be undone. */
export const UNDO_WINDOW_MS = 30 * 60 * 1000;
