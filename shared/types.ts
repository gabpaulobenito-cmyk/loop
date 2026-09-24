export type LoopState = 'running' | 'open' | 'closed';

/**
 * How a loop's clock reads.
 *   elapsed    counts up from when the loop was opened — visibility into neglect
 *   countdown  counts down to a real external deadline — urgency with a consequence
 */
export type TimerType = 'elapsed' | 'countdown';

/** Ball in court: who is moving the loop forward. */
export type Owner = 'mine' | 'delegated' | 'waiting';

/**
 * Which world a loop belongs to. Not a label you attach afterwards: the
 * workspace is always in one scope, and a loop captured there is born into it.
 */
export type Scope = 'work' | 'personal';

/**
 * One line of a loop's checklist. The order of the list is the user's own:
 * the first unchecked item is the one the row marquee reads.
 */
export interface NoteItem {
  id: string;
  text: string;
  done: boolean;
}

/** Wire format for a loop. All timestamps are epoch milliseconds (server clock). */
export interface Loop {
  id: string;
  title: string;
  /**
   * The line the row marquee reads: the first unchecked item of `notes`, or ''
   * when everything is checked off. Derived — patch `notes`, never this.
   */
  note: string;
  /** The loop's checklist, in the order the user arranged it. */
  notes: NoteItem[];
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
  /** Work or personal. Every loop has exactly one. */
  scope: Scope;
  /**
   * When this loop was put in focus, or null. Focus is for today only: a pick
   * from an earlier day no longer counts (see `shared/focus.ts`).
   */
  focusedAt: number | null;
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
/**
 * What the workspace is currently showing. `all` is the deliberate look across
 * both worlds; it is never the default, and it is not a value a loop can hold.
 */
export type ScopeView = Scope | 'all';
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
/** Items one loop's checklist may hold. Longer than this is a project, not a note. */
export const NOTES_MAX = 20;
/** Loops that may be in focus at once. The limit is what makes focus mean anything. */
export const FOCUS_MAX = 3;
export const WITH_MAX = 60;
/** How far ahead or behind a deadline or follow-up date may be set. */
export const DATE_RANGE_MS = 10 * 365 * 86_400_000;
/** Actions older than this can no longer be undone. */
export const UNDO_WINDOW_MS = 30 * 60 * 1000;
