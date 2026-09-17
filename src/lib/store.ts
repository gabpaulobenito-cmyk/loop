import { ApiError, api } from './api';
import { serverNow } from './clock';
import { finalizeSession } from '../../shared/timer';
import {
  DEFAULT_SETTINGS,
  NOTE_MAX,
  TITLE_MAX,
  type Loop,
  type LoopMutationResponse,
  type Settings,
  type StateResponse,
  type UndoTop,
} from '../../shared/types';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Notice {
  id: number;
  text: string;
}

export interface StoreState {
  load: LoadStatus;
  loadError: string | null;
  loops: Loop[];
  settings: Settings;
  undo: UndoTop | null;
  online: boolean;
  pending: Record<string, true>;
  undoPending: boolean;
  notice: Notice | null;
}

const THEME_KEY = 'loop.theme';

function cachedTheme(): Settings['theme'] {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch {
    // storage unavailable
  }
  return DEFAULT_SETTINGS.theme;
}

const POLL_MS = 20_000;
const DOUBLE_TAP_MS = 350;

export class LoopStore {
  private state: StoreState = {
    load: 'idle',
    loadError: null,
    loops: [],
    settings: { ...DEFAULT_SETTINGS, theme: cachedTheme() },
    undo: null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: {},
    undoPending: false,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private mutationSeq = 0;
  private noticeSeq = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.load();
    return () => {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.stopPolling();
    };
  }

  private onOnline = () => {
    this.set({ online: true });
    void this.refresh();
  };

  private onOffline = () => this.set({ online: false });

  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.refresh();
  };

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async load() {
    this.set({ load: 'loading', loadError: null });
    try {
      const s = await api<StateResponse>('/state');
      this.applyState(s);
      this.set({ load: 'ready', online: true });
      this.startPolling();
    } catch (err) {
      this.set({ load: 'error', loadError: (err as Error).message });
    }
  }

  async refresh() {
    if (this.state.load === 'idle' || this.state.load === 'loading' || this.refreshing) return;
    if (this.state.load === 'error') return this.load();
    this.refreshing = true;
    const seq = this.mutationSeq;
    try {
      const s = await api<StateResponse>('/state');
      // A mutation started meanwhile: its response is fresher than this snapshot.
      if (seq !== this.mutationSeq || Object.keys(this.state.pending).length) return;
      this.applyState(s);
      if (!this.state.online) this.set({ online: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) this.set({ online: false });
    } finally {
      this.refreshing = false;
    }
  }

  private applyState(s: StateResponse) {
    this.set({ loops: s.loops, settings: s.settings, undo: s.undo });
    this.cacheTheme(s.settings.theme);
  }

  private cacheTheme(theme: Settings['theme']) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }

  // ── Notices ───────────────────────────────────────────────────────────────

  notify(text: string) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice: { id: ++this.noticeSeq, text } });
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), 6000);
  }

  dismissNotice() {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice: null });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  private replaceLoop(loop: Loop) {
    const exists = this.state.loops.some((l) => l.id === loop.id);
    this.set({
      loops: exists ? this.state.loops.map((l) => (l.id === loop.id ? loop : l)) : [loop, ...this.state.loops],
    });
  }

  private canMutate(): boolean {
    if (!this.state.online) {
      this.notify('Offline — changes are paused until you reconnect');
      return false;
    }
    return true;
  }

  // Per-loop mutation queues. Actions on the same loop run in order; while
  // earlier ones are in flight, later optimistic changes are re-applied on top
  // of each server response so the UI never flickers back.
  private queues = new Map<string, { base: Loop | null; ops: Array<(l: Loop) => Loop>; tail: Promise<void>; count: number }>();
  private lastToggleAt = Number.NEGATIVE_INFINITY;

  private queueFor(id: string) {
    let q = this.queues.get(id);
    if (!q) {
      q = { base: this.state.loops.find((l) => l.id === id) ?? null, ops: [], tail: Promise.resolve(), count: 0 };
      this.queues.set(id, q);
    }
    return q;
  }

  private render(id: string) {
    const q = this.queues.get(id);
    if (!q || !q.base) return;
    const view = q.ops.reduce((l, op) => op(l), q.base);
    this.replaceLoop(view);
  }

  private setPending(id: string, on: boolean) {
    if (on) this.set({ pending: { ...this.state.pending, [id]: true } });
    else {
      const { [id]: _, ...rest } = this.state.pending;
      this.set({ pending: rest });
    }
  }

  /**
   * Optimistically apply `local`, send `call` once earlier actions on this loop
   * have settled, then reconcile with the server's copy.
   */
  private mutate(
    id: string,
    local: (l: Loop) => Loop,
    call: () => Promise<LoopMutationResponse>,
    failVerb: string,
  ): Promise<boolean> {
    if (!this.canMutate()) return Promise.resolve(false);
    const q = this.queueFor(id);
    if (!q.count) q.base = this.state.loops.find((l) => l.id === id) ?? q.base;
    q.ops.push(local);
    q.count++;
    this.mutationSeq++;
    this.setPending(id, true);
    this.render(id);

    const run = q.tail.then(async () => {
      try {
        const r = await call();
        q.ops.shift();
        if (r.loop) q.base = r.loop;
        this.set({ undo: r.undo });
        this.render(id);
        return true;
      } catch (err) {
        q.ops.shift();
        this.render(id);
        if (err instanceof ApiError && err.status === 0) this.set({ online: false });
        this.notify(`Couldn’t ${failVerb} — ${(err as Error).message}`);
        return false;
      } finally {
        q.count--;
        if (!q.count) {
          this.queues.delete(id);
          this.setPending(id, false);
          if (this.state.notice) void this.refresh();
        }
      }
    });
    q.tail = run.then(() => undefined);
    return run;
  }

  isPending(id: string) {
    return !!this.state.pending[id];
  }

  /** Create a loop. `text` may contain "Title // context note". */
  async create(text: string, start: boolean, note = ''): Promise<string | null> {
    let title = text;
    let ctx = note;
    const split = text.indexOf('//');
    if (!note && split > 0) {
      title = text.slice(0, split);
      ctx = text.slice(split + 2);
    }
    title = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    ctx = ctx.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    if (!title || !this.canMutate()) return null;

    const id = crypto.randomUUID();
    const now = serverNow();
    const optimistic: Loop = {
      id,
      title,
      note: ctx,
      priority: false,
      state: start ? 'running' : 'open',
      createdAt: now,
      closedAt: null,
      runningSince: start ? now : null,
      accumulatedMs: 0,
      sessionCount: start ? 1 : 0,
      updatedAt: now,
    };
    this.set({ loops: [optimistic, ...this.state.loops] });
    const q = this.queueFor(id);
    q.base = optimistic;
    const ok = await this.mutate(
      id,
      (l) => l,
      () => api<LoopMutationResponse>('/loops', { method: 'POST', body: { id, title, note: ctx, start } }),
      'create loop',
    );
    if (!ok && !this.state.pending[id]) {
      // Nothing reached the server: drop the optimistic row.
      const exists = await api<StateResponse>('/state').then((s) => s.loops.some((l) => l.id === id)).catch(() => false);
      if (!exists) this.set({ loops: this.state.loops.filter((l) => l.id !== id) });
    }
    return ok ? id : null;
  }

  start(id: string) {
    const now = serverNow();
    return this.mutate(
      id,
      (l) => (l.state === 'open' ? { ...l, state: 'running', runningSince: now, sessionCount: l.sessionCount + 1 } : l),
      () => api<LoopMutationResponse>(`/loops/${id}/start`, { method: 'POST' }),
      'start',
    );
  }

  stop(id: string) {
    const now = serverNow();
    return this.mutate(
      id,
      (l) =>
        l.state === 'running'
          ? { ...l, state: 'open', runningSince: null, accumulatedMs: finalizeSession(l, now).accumulatedMs }
          : l,
      () => api<LoopMutationResponse>(`/loops/${id}/stop`, { method: 'POST' }),
      'stop',
    );
  }

  /**
   * Start/stop from a row or button. A second toggle within the double-tap window is
   * ignored: rows move between RUNNING and OPEN, so a stray second tap could otherwise
   * undo the first or hit a different loop. Deliberate follow-ups are queued.
   */
  toggle(id: string) {
    const l = this.state.loops.find((x) => x.id === id);
    const t = performance.now();
    if (!l || l.state === 'closed' || t - this.lastToggleAt < DOUBLE_TAP_MS) return Promise.resolve(false);
    this.lastToggleAt = t;
    return l.state === 'running' ? this.stop(id) : this.start(id);
  }

  close(id: string) {
    const now = serverNow();
    return this.mutate(
      id,
      (l) =>
        l.state === 'closed'
          ? l
          : {
              ...l,
              state: 'closed',
              closedAt: now,
              runningSince: null,
              accumulatedMs: l.state === 'running' ? finalizeSession(l, now).accumulatedMs : l.accumulatedMs,
            },
      () => api<LoopMutationResponse>(`/loops/${id}/close`, { method: 'POST' }),
      'close',
    );
  }

  reopen(id: string) {
    return this.mutate(
      id,
      (l) => (l.state === 'closed' ? { ...l, state: 'open', closedAt: null } : l),
      () => api<LoopMutationResponse>(`/loops/${id}/reopen`, { method: 'POST' }),
      'reopen',
    );
  }

  togglePriority(id: string) {
    const l = this.state.loops.find((x) => x.id === id);
    if (!l) return Promise.resolve(false);
    const priority = !l.priority;
    return this.mutate(
      id,
      (x) => ({ ...x, priority }),
      () => api<LoopMutationResponse>(`/loops/${id}`, { method: 'PATCH', body: { priority } }),
      'update priority',
    );
  }

  edit(id: string, patch: { title?: string; note?: string }) {
    const body: { title?: string; note?: string } = {};
    if (patch.title !== undefined) {
      const t = patch.title.replace(/\s+/g, ' ').trim();
      if (!t) {
        this.notify('A loop needs a title');
        return Promise.resolve(false);
      }
      body.title = t.slice(0, TITLE_MAX);
    }
    if (patch.note !== undefined) body.note = patch.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    return this.mutate(
      id,
      (x) => ({ ...x, ...body }),
      () => api<LoopMutationResponse>(`/loops/${id}`, { method: 'PATCH', body }),
      'save',
    );
  }

  async undo() {
    if (!this.state.undo || this.state.undoPending || !this.canMutate()) return;
    this.mutationSeq++;
    this.set({ undoPending: true });
    try {
      const r = await api<LoopMutationResponse>('/undo', { method: 'POST' });
      if (r.deletedId) this.set({ loops: this.state.loops.filter((l) => l.id !== r.deletedId) });
      if (r.loop) this.replaceLoop(r.loop);
      this.set({ undo: r.undo });
    } catch (err) {
      this.notify((err as Error).message);
      void this.refresh();
    } finally {
      this.set({ undoPending: false });
    }
  }

  async updateSettings(patch: Partial<Settings>) {
    const prev = this.state.settings;
    this.set({ settings: { ...prev, ...patch } });
    if (patch.theme) this.cacheTheme(patch.theme);
    try {
      const r = await api<{ settings: Settings }>('/settings', { method: 'PUT', body: patch });
      this.set({ settings: r.settings });
    } catch (err) {
      // Keep the local choice for this session; it simply won't sync.
      if (err instanceof ApiError && err.status !== 0) {
        this.set({ settings: prev });
        this.notify(`Couldn’t save setting — ${err.message}`);
      }
    }
  }
}

export const store = new LoopStore();
