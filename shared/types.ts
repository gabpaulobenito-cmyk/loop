export type LoopState = 'running' | 'open' | 'closed';

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

export interface Settings {
  runSort: RunSort;
  openSort: OpenSort;
  archiveOpen: boolean;
  archiveRange: ArchiveRange;
  theme: ThemePref;
}

export const DEFAULT_SETTINGS: Settings = {
  runSort: 'longest',
  openSort: 'oldest',
  archiveOpen: false,
  archiveRange: '7d',
  theme: 'dark',
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
/** Actions older than this can no longer be undone. */
export const UNDO_WINDOW_MS = 30 * 60 * 1000;
