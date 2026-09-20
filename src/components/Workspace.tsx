import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtHM, fmtTimer, pad2 } from '../../shared/format';
import { elapsedMs, hoistFireTier, isFireTier, sortClosed, sortOpen, sortRunning } from '../../shared/timer';
import type { Loop, OpenSort, RunSort, ScopeView, ThemePref } from '../../shared/types';
import { useNow } from '../hooks/useNow';
import { useStore } from '../hooks/useStore';
import { useMode, type Mode } from '../hooks/useViewport';
import { store } from '../lib/store';
import {
  CaptureDialog,
  Header,
  MOD,
  MenuPopover,
  OPEN_SORTS,
  RUN_SORTS,
  SCOPE_OPTIONS,
  SCOPE_ORDER,
  ScopeSwitch,
  SearchField,
  SortButtons,
  TIMER_FILTERS,
  type ScopeCounts,
} from './Chrome';
import { Inspector, type InspectorActions } from './Inspector';
import { LoopRow, type RowActions, type RowVariant } from './LoopRow';

type Tab = 'all' | 'running' | 'open' | 'closed';
const TAB_KEY = 'loop.tab';
const SCOPE_KEY = 'loop.scope';
const WEEK = 7 * 86_400_000;

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'all' || t === 'running' || t === 'open' || t === 'closed') return t;
  } catch {
    // ignore
  }
  return 'all';
}

/**
 * Which world this device is in. Deliberately per-device rather than synced with
 * the other filters: the phone can sit in PERSONAL for good while the work
 * machine stays in WORK. Work is the default — that is what LOOP started as.
 */
function readScope(): ScopeView {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    if (v === 'work' || v === 'personal' || v === 'all') return v;
  } catch {
    // ignore
  }
  return 'work';
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable="true"]');

export function Workspace() {
  const s = useStore();
  const now = useNow();
  const mode = useMode();
  const rowVariant: RowVariant = mode === 'rail' ? 'rail' : mode === 'mobile' ? 'mobile' : 'desk';
  const compact = mode === 'rail' || mode === 'mobile';
  // Wide windows dock the details as a second column instead of popping it up.
  const wide = mode === 'wide';

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [scope, setScopeState] = useState<ScopeView>(readScope);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };

  const setScope = useCallback((v: ScopeView) => {
    setScopeState(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      // ignore
    }
  }, []);

  // ── Derived lists ────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const { settings } = s;
  const ownerFilter = settings.ownerFilter;
  const timerFilter = settings.timerFilter;
  const matches = useCallback(
    (l: Loop) =>
      (scope === 'all' || l.scope === scope) &&
      (ownerFilter === 'all' || (ownerFilter === 'mine' ? l.owner === 'mine' : l.owner !== 'mine')) &&
      (timerFilter === 'all' || (timerFilter === 'deadline' ? l.timerType === 'countdown' : l.timerType === 'elapsed')) &&
      (!q ||
        l.title.toLowerCase().includes(q) ||
        l.notes.some((n) => n.text.toLowerCase().includes(q)) ||
        l.ownerWith.toLowerCase().includes(q)),
    [q, scope, ownerFilter, timerFilter],
  );

  // Everything below the switch is already inside the current scope, so the
  // tabs, totals and section counts all speak about the world you are looking at.
  const inScope = useCallback((l: Loop) => scope === 'all' || l.scope === scope, [scope]);
  const allRunning = s.loops.filter((l) => l.state === 'running' && inScope(l));
  const allOpen = s.loops.filter((l) => l.state === 'open' && inScope(l));
  const running = sortRunning(allRunning.filter(matches), settings.runSort, now);
  const open = sortOpen(allOpen.filter(matches), settings.openSort, now);
  const closedAll = sortClosed(s.loops.filter((l) => l.state === 'closed' && matches(l)));
  // The switch itself counts across both worlds — including the fire tier of the
  // one you are not in, so a personal deadline can't go red behind the work list.
  const liveAll = s.loops.filter((l) => l.state === 'running' || l.state === 'open');
  const scopeCounts: ScopeCounts = {
    work: liveAll.filter((l) => l.scope === 'work').length,
    personal: liveAll.filter((l) => l.scope === 'personal').length,
    fire: {
      work: liveAll.filter((l) => l.scope === 'work' && isFireTier(l, now)).length,
      personal: liveAll.filter((l) => l.scope === 'personal' && isFireTier(l, now)).length,
    },
  };
  const closed = q || settings.archiveRange === 'all' ? closedAll : closedAll.filter((l) => (l.closedAt ?? 0) > now - WEEK);
  const prioCount = [...allRunning, ...allOpen].filter((l) => l.priority).length;
  const totalActive = [...allRunning, ...allOpen].reduce((a, l) => a + elapsedMs(l, now), 0);
  const longest = allRunning.reduce((a, l) => Math.max(a, elapsedMs(l, now)), 0);

  // Ball-in-court and timer counts across live (not closed) loops.
  const live = [...allRunning, ...allOpen];
  const timerCounts = {
    all: live.length,
    deadline: live.filter((l) => l.timerType === 'countdown').length,
    aging: live.filter((l) => l.timerType === 'elapsed').length,
    fire: live.filter((l) => isFireTier(l, now)).length,
  };
  const outLoops = live.filter((l) => l.owner !== 'mine');
  const ownerCounts = {
    all: live.length,
    mine: live.length - outLoops.length,
    out: outLoops.length,
    delegated: outLoops.filter((l) => l.owner === 'delegated').length,
    waiting: outLoops.filter((l) => l.owner === 'waiting').length,
    due: outLoops.filter((l) => l.followUpAt != null && l.followUpAt <= now).length,
  };

  const selected = s.loops.find((l) => l.id === selectedId) ?? null;
  const inspectorVisible = (wide || overlay) && !!selected;

  // The docked column always shows something useful.
  useEffect(() => {
    if (!wide || s.load !== 'ready') return;
    if (selectedId && s.loops.some((l) => l.id === selectedId && inScope(l))) return;
    const first = sortRunning(allRunning, settings.runSort, now)[0] ?? sortOpen(allOpen, settings.openSort, now)[0];
    setSelectedId(first?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, s.load, s.loops, selectedId, scope]);

  // Close the pop-up if its loop disappears, or once the window is wide enough to dock.
  useEffect(() => {
    if (overlay && (!selected || wide || !inScope(selected))) setOverlay(false);
  }, [overlay, selected, wide, inScope]);

  // ── Actions (stable references keep memoized rows cheap) ────────────────
  const rowActions = useMemo<RowActions>(
    () => ({
      toggle: (id) => void store.toggle(id),
      reopen: (id) => void store.reopen(id),
      inspect: (id) => {
        setSelectedId(id);
        if (!wide) setOverlay(true);
      },
    }),
    [wide],
  );


  const inspectorActions = useMemo<InspectorActions>(
    () => ({
      toggle: (id) => void store.toggle(id),
      reopen: (id) => void store.reopen(id),
      close: (id) => void store.close(id),
      priority: (id) => void store.togglePriority(id),
      edit: (id, patch) => store.edit(id, patch),
      notes: (id) => ({
        add: (text) => void store.addNote(id, text),
        edit: (noteId, text) => void store.editNote(id, noteId, text),
        toggle: (noteId) => void store.toggleNote(id, noteId),
        move: (noteId, to) => void store.moveNote(id, noteId, to),
        remove: (noteId) => void store.removeNote(id, noteId),
      }),
      retime: (id, at, kept) => void store.retime(id, at, kept),
      handoff: (id, patch) => void store.handoff(id, patch),
      setDeadline: (id, at) => void store.setDeadline(id, at),
      dropDeadline: (id) => void store.dropDeadline(id),
      setScope: (id, v) => void store.setScope(id, v),
      remove: (id) => {
        setOverlay(false);
        void store.remove(id);
      },
    }),
    [],
  );

  const openNew = useCallback(() => {
    setMenuOpen(false);
    setOverlay(false);
    setCaptureOpen(true);
  }, []);

  const openSearch = useCallback(() => {
    setMenuOpen(false);
    if (compact) setSearchOpen(true);
    // Focus after the row mounts.
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, [compact]);

  // ── Global keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (menuOpen) return setMenuOpen(false);
        if (captureOpen) return setCaptureOpen(false);
        if (overlay) return setOverlay(false);
        if (compact && searchOpen && !query) return setSearchOpen(false);
        return;
      }
      if (e.defaultPrevented || e.altKey) return;
      if (mod && k === 'k') {
        e.preventDefault();
        return openSearch();
      }
      if (isTyping(e.target) || captureOpen || menuOpen) return;
      if ((mod && k === 'n') || (!mod && !e.shiftKey && k === 'n')) {
        e.preventDefault();
        return openNew();
      }
      if (!mod && !e.shiftKey && k === 'w') {
        e.preventDefault();
        return setScope(SCOPE_ORDER[(SCOPE_ORDER.indexOf(scope) + 1) % SCOPE_ORDER.length]);
      }
      if (!mod && e.key === '/') {
        e.preventDefault();
        return openSearch();
      }
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        void store.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, captureOpen, overlay, mode, compact, searchOpen, query, openNew, openSearch, scope, setScope]);

  // ── Rendering helpers ───────────────────────────────────────────────────
  const rows = (list: Loop[], label: string) => (
    <ul aria-label={label}>
      {list.map((l) => (
        <LoopRow
          key={l.id}
          loop={l}
          variant={rowVariant}
          markScope={scope === 'all'}
          now={now}
          pending={!!s.pending[l.id]}
          selected={inspectorVisible && l.id === selectedId}
          actions={rowActions}
        />
      ))}
    </ul>
  );

  const emptyRow = (text: string, action?: { label: string; onClick: () => void }) => (
    <div className={`empty${mode === 'rail' ? ' empty--rail' : ''}`}>
      <span>{text}</span>
      {action && (
        <button type="button" className="empty__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );

  const setRunSort = (v: RunSort) => void store.updateSettings({ runSort: v });
  const setOpenSort = (v: OpenSort) => void store.updateSettings({ openSort: v });
  const setTheme = (v: ThemePref) => void store.updateSettings({ theme: v });

  const railOrDesk = mode === 'rail' ? 'sect--rail' : '';
  const loading = (s.load === 'loading' || s.load === 'idle') && s.loops.length === 0;

  const runningSection = (
    <section aria-label="Running loops">
      <div className={`sect ${railOrDesk}`}>
        <h2 className="sect__label sect__label--run" style={{ margin: 0 }}>RUNNING</h2>
        <span className="sect__count sect__count--run">{pad2(running.length)}</span>
        <span className="sect__rule" />
        {mode !== 'rail' && (
          <>
            <span className="sect__sortlabel">SORT</span>
            <SortButtons label="Sort running loops" options={RUN_SORTS} value={settings.runSort} onChange={setRunSort} />
          </>
        )}
      </div>
      {running.length
        ? rows(running, 'Running loops')
        : emptyRow(q ? 'NO RUNNING MATCHES' : mode === 'rail' ? 'NOTHING RUNNING' : 'NOTHING RUNNING — PRESS ▶ ON AN OPEN LOOP')}
    </section>
  );

  const openSection = (
    <section aria-label="Open loops">
      <div className={`sect sect--gap ${railOrDesk}`}>
        <h2 className="sect__label" style={{ margin: 0 }}>OPEN</h2>
        <span className="sect__count">{pad2(open.length)}</span>
        <span className="sect__rule" />
        {mode !== 'rail' && (
          <>
            <span className="sect__sortlabel">SORT</span>
            <SortButtons label="Sort open loops" options={OPEN_SORTS} value={settings.openSort} onChange={setOpenSort} />
            <span className="sect__prio" title="Priority loops">
              <span className="marker marker--priority" aria-hidden="true" />
              PRIORITY {pad2(prioCount)}
            </span>
          </>
        )}
      </div>
      {open.length
        ? rows(open, 'Open loops')
        : emptyRow(
            q ? 'NO OPEN MATCHES' : 'NO OPEN LOOPS',
            q || mode === 'rail' ? undefined : { label: 'START ONE', onClick: openNew },
          )}
    </section>
  );

  const archiveOpen = settings.archiveOpen || !!q;
  const closedSection = (
    <section aria-label="Closed loops">
      <div className="closed-head" style={{ marginTop: mode === 'rail' ? 4 : 6 }}>
        <button
          type="button"
          className={`sect sect--closed ${railOrDesk}`}
          style={{ marginTop: 0 }}
          aria-expanded={archiveOpen}
          onClick={() => void store.updateSettings({ archiveOpen: !settings.archiveOpen })}
        >
          <span className="sect__glyph" aria-hidden="true">{archiveOpen ? '▾' : '▸'}</span>
          <span className="sect__label sect__label--closed">CLOSED</span>
          <span className="sect__count">{pad2(closed.length)}</span>
          <span className="sect__rule" />
          {mode === 'rail' && <span className="sect__range">{q ? 'ALL' : settings.archiveRange === 'all' ? 'ALL' : '7D'}</span>}
        </button>
        {mode !== 'rail' && (
          <span className="closed-head__ranges" style={{ marginTop: 0 }}>
            <SortButtons
              label="Closed loops range"
              options={[['7d', 'LAST 7D'], ['all', 'ALL']] as const}
              value={q ? 'all' : settings.archiveRange}
              onChange={(v) => void store.updateSettings({ archiveRange: v, archiveOpen: true })}
            />
          </span>
        )}
      </div>
      {archiveOpen &&
        (closed.length
          ? rows(closed, 'Closed loops')
          : emptyRow(q ? 'NO CLOSED MATCHES' : settings.archiveRange === '7d' ? 'NOTHING CLOSED IN THE LAST 7 DAYS' : 'NOTHING CLOSED YET'))}
    </section>
  );

  let listContent;
  if (loading) {
    listContent = (
      <div aria-busy="true" aria-label="Loading loops">
        {[0.55, 0.4, 0.62, 0.35].map((w, i) => (
          <div key={i} className="skel">
            <span className="marker marker--open" />
            <span className="skel__bar" style={{ width: `${w * 60}%` }} />
          </div>
        ))}
        <div className="empty">LOADING LOOPS…</div>
      </div>
    );
  } else if (s.load === 'error') {
    listContent = (
      <div className={`blank${mode === 'rail' ? ' blank--rail' : ''}`} role="alert">
        <div className="blank__title">COULDN’T LOAD LOOPS</div>
        <div className="blank__text">{s.loadError}</div>
        <button type="button" className="btn-new" onClick={() => void store.load()}>
          <span className="btn-new__label">RETRY</span>
        </button>
      </div>
    );
  } else if (mode === 'mobile') {
    // On the combined tab a deadline in its last day outranks everything, running or not.
    const list =
      tab === 'running'
        ? running
        : tab === 'open'
          ? open
          : tab === 'closed'
            ? closedAll
            : hoistFireTier([...running, ...open], now);
    const nothingAtAll = !q && allRunning.length + allOpen.length === 0;
    listContent =
      list.length > 0 ? (
        rows(list, `${tab} loops`)
      ) : tab === 'all' && nothingAtAll ? (
        <div className="blank">
          <div className="blank__title">NO OPEN LOOPS</div>
          <div className="blank__text">What have you started but not closed?</div>
          <button type="button" className="btn-new" style={{ height: 30 }} onClick={openNew}>
            <span className="btn-new__plus">+</span>
            <span className="btn-new__label">NEW LOOP</span>
          </button>
        </div>
      ) : (
        emptyRow(
          q
            ? `NO MATCHES FOR “${query.trim()}”`
            : tab === 'running'
              ? 'NOTHING RUNNING'
              : tab === 'open'
                ? 'NO OPEN LOOPS'
                : 'NOTHING CLOSED YET',
        )
      );
  } else {
    listContent = (
      <>
        {runningSection}
        {openSection}
        {closedSection}
      </>
    );
  }

  // ── Status bar ──────────────────────────────────────────────────────────
  const systemNote = !s.online
    ? 'OFFLINE — TIMERS KEEP COUNTING · CHANGES PAUSED'
    : allRunning.length
      ? `${allRunning.length} RUNNING · LONGEST ${fmtTimer(longest)}`
      : 'NOTHING RUNNING';
  const noteNode = s.notice ? (
    <span className="status__note status__note--alert" role="alert">
      {s.notice.text}
    </span>
  ) : (
    <span className={`status__note${!s.online ? ' status__note--offline' : ''}`} role="status">
      {systemNote}
    </span>
  );
  const dismissNotice = s.notice && (
    <button type="button" className="notice-x hit" aria-label="Dismiss message" onClick={() => store.dismissNotice()}>
      ✕
    </button>
  );
  const undoBtn = (variant: 'desk' | 'rail' | 'mobile') =>
    s.undo && (
      <button
        type="button"
        className="undo"
        disabled={s.undoPending}
        title={`UNDO: ${s.undo.label} — ${MOD}Z`}
        aria-label={`Undo: ${s.undo.label}`}
        onClick={() => void store.undo()}
      >
        <span className="undo__glyph" aria-hidden="true">↶</span>
        {variant !== 'rail' && 'UNDO'}
        {variant === 'desk' && (
          <>
            <span className="undo__label">{s.undo.label.toUpperCase()}</span>
            <span className="undo__kbd">{MOD}Z</span>
          </>
        )}
      </button>
    );

  let statusBar;
  if (mode === 'rail') {
    statusBar = (
      <footer className="status status--rail">
        {undoBtn('rail')}
        {s.notice ? noteNode : !s.online ? <span className="status__note status__note--offline">OFFLINE</span> : <span>ACTIVE</span>}
        {dismissNotice}
        <span className="status__spacer" />
        {!s.notice && <span className="status__total">{fmtHM(totalActive)}</span>}
      </footer>
    );
  } else if (mode === 'mobile') {
    statusBar = (
      <footer className="status status--mobile">
        {undoBtn('mobile')}
        {noteNode}
        {dismissNotice}
        <span className="status__spacer" />
        {!s.notice && <span className="num">{fmtHM(totalActive)}</span>}
      </footer>
    );
  } else {
    statusBar = (
      <footer className="status">
        {noteNode}
        {dismissNotice}
        <span className="status__spacer" />
        {undoBtn('desk')}
        <span className="status__hint">ROW → DETAILS · ▶ ■ → START/STOP</span>
      </footer>
    );
  }

  // ── Menu ────────────────────────────────────────────────────────────────
  const menu = menuOpen && (
    <MenuPopover anchor={menuBtnRef.current} onClose={() => setMenuOpen(false)}>
      {compact && (
        <button type="button" role="menuitem" className="menu__item" onClick={openSearch}>
          <span>SEARCH</span>
          <span>{MOD}K</span>
        </button>
      )}
      {compact && (
        <>
          <div className="menu__group">SCOPE</div>
          <div className="menu__opts">
            <SortButtons label="Work or personal" options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
          </div>
          <div className="menu__group">TIMER</div>
          <div className="menu__opts">
            <SortButtons
              label="Filter by timer"
              options={TIMER_FILTERS}
              value={settings.timerFilter}
              onChange={(v) => void store.updateSettings({ timerFilter: v })}
            />
          </div>
          <div className="menu__group">SORT RUNNING</div>
          <div className="menu__opts">
            <SortButtons label="Sort running loops" options={RUN_SORTS} value={settings.runSort} onChange={setRunSort} />
          </div>
          <div className="menu__group">SORT OPEN</div>
          <div className="menu__opts">
            <SortButtons label="Sort open loops" options={OPEN_SORTS} value={settings.openSort} onChange={setOpenSort} />
          </div>
        </>
      )}
      {mode === 'rail' && (
        <>
          <div className="menu__group">CLOSED ARCHIVE</div>
          <div className="menu__opts">
            <SortButtons
              label="Closed loops range"
              options={[['7d', 'LAST 7D'], ['all', 'ALL']] as const}
              value={settings.archiveRange}
              onChange={(v) => void store.updateSettings({ archiveRange: v, archiveOpen: true })}
            />
          </div>
        </>
      )}
      <div className="menu__group">THEME</div>
      <div className="menu__opts">
        <SortButtons
          label="Theme"
          options={[['dark', 'DARK'], ['light', 'LIGHT'], ['system', 'SYSTEM']] as const}
          value={settings.theme}
          onChange={setTheme}
        />
      </div>
      {!compact && (
        <>
          <div className="menu__sep" />
          <div className="menu__group">SHORTCUTS</div>
          <div className="menu__keys">
            <kbd>N</kbd><span>NEW LOOP</span>
            <kbd>⇧⏎</kbd><span>CREATE + START</span>
            <kbd>W</kbd><span>WORK / PERSONAL / BOTH</span>
            <kbd>/ {MOD}K</kbd><span>SEARCH</span>
            <kbd>{MOD}Z</kbd><span>UNDO</span>
            <kbd>↑ ↓</kbd><span>MOVE BETWEEN ROWS</span>
            <kbd>S</kbd><span>START / STOP (DETAIL)</span>
            <kbd>P</kbd><span>PRIORITY (DETAIL)</span>
            <kbd>E</kbd><span>RENAME (DETAIL)</span>
            <kbd>⌫</kbd><span>CLOSE LOOP (DETAIL)</span>
            <kbd>ESC</kbd><span>DISMISS</span>
            <kbd>//</kbd><span>TITLE // NOTE</span>
          </div>
        </>
      )}
      <div className="menu__sep" />
      <button
        type="button"
        role="menuitem"
        className="menu__item"
        onClick={() => {
          setMenuOpen(false);
          void store.refresh();
        }}
      >
        <span>SYNC NOW</span>
        <span />
      </button>
    </MenuPopover>
  );

  const scopeSwitch = (
    <ScopeSwitch value={scope} counts={scopeCounts} onChange={setScope} variant={compact ? 'mini' : 'full'} />
  );

  const searchField = (
    <SearchField
      ref={searchRef}
      value={query}
      onChange={setQuery}
      onEscape={() => {
        if (compact && !query) setSearchOpen(false);
      }}
    />
  );

  const viewBar = (
    <div className={`viewbar viewbar--${mode}`} aria-label="Filters">
      {scopeSwitch}
      <span className="viewbar__div viewbar__div--scope" aria-hidden="true" />
      <span className="viewbar__group" role="group" aria-label="Filter by who is moving it">
        {mode !== 'rail' && <span className="viewbar__label">VIEW</span>}
        {(
          [
            ['all', 'ALL', ownerCounts.all],
            ['mine', 'MINE', ownerCounts.mine],
            ['out', 'OUT', ownerCounts.out],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className="viewbar__opt"
            aria-pressed={ownerFilter === value}
            onClick={() => void store.updateSettings({ ownerFilter: value })}
          >
            {label} <span className="viewbar__count">{pad2(count)}</span>
          </button>
        ))}
      </span>
      {/* Narrow layouts have no room for a second filter row; it moves into the menu. */}
      {!compact && (
        <>
          <span className="viewbar__div" aria-hidden="true" />
          <span className="viewbar__group" role="group" aria-label="Filter by timer">
            {(
              [
                ['all', 'ALL', timerCounts.all],
                ['deadline', 'DEADLINES', timerCounts.deadline],
                ['aging', 'AGING', timerCounts.aging],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={`t-${value}`}
                type="button"
                className="viewbar__opt viewbar__opt--timer"
                aria-pressed={timerFilter === value}
                onClick={() => void store.updateSettings({ timerFilter: value })}
              >
                {label} <span className="viewbar__count">{pad2(count)}</span>
              </button>
            ))}
          </span>
        </>
      )}
      <span className="viewbar__spacer" />
      {timerCounts.fire > 0 && (
        <span className="viewbar__stat viewbar__stat--fire" title="Due within a day, or overdue">
          {timerCounts.fire} DUE
        </span>
      )}
      {ownerCounts.delegated > 0 && (
        <span className="viewbar__stat" data-owner="delegated" title="Delegated">
          → {ownerCounts.delegated}
        </span>
      )}
      {ownerCounts.waiting > 0 && (
        <span className="viewbar__stat" data-owner="waiting" title="Waiting">
          ⧗ {ownerCounts.waiting}
        </span>
      )}
      {ownerCounts.due > 0 && (
        <span className="viewbar__stat viewbar__stat--due" title="Follow-ups due">
          {ownerCounts.due} DUE
        </span>
      )}
    </div>
  );

  const inspectorFor = (onDismiss: () => void, docked = false) => (
    <Inspector
      loop={selected}
      now={now}
      docked={docked}
      pending={selected ? !!s.pending[selected.id] : false}
      keysEnabled={!captureOpen && !menuOpen}
      onDismiss={onDismiss}
      actions={inspectorActions}
    />
  );

  return (
    <div className="app" data-mode={mode}>
      <Header
        mode={mode}
        anyRunning={allRunning.length > 0}
        search={searchField}
        onNew={openNew}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
        menuButtonRef={menuBtnRef}
        now={now}
        onSearch={() => (searchOpen && !query ? setSearchOpen(false) : openSearch())}
      />
      {(mode === 'desk' || mode === 'wide' || mode === 'rail') && viewBar}
      {compact && (searchOpen || q) && (
        <div className={`searchrow${mode === 'rail' ? ' searchrow--rail' : ''}`}>{searchField}</div>
      )}
      {mode === 'mobile' && (
        <div className="tabs" role="tablist" aria-label="Filter loops">
          {(
            [
              ['all', `ALL ${pad2(allRunning.length + allOpen.length)}`],
              ['running', `RUNNING ${pad2(allRunning.length)}`],
              ['open', `OPEN ${pad2(allOpen.length)}`],
              ['closed', 'CLOSED'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === 'mobile' && viewBar}
      <div className="app__body">
        <main className="list" aria-label="Loops">
          {listContent}
        </main>
        {wide && <aside className="insp-pane">{inspectorFor(() => setSelectedId(null), true)}</aside>}
      </div>
      {statusBar}

      {!wide && overlay && selected && (
        <>
          <div className="scrim scrim--modal" onClick={() => setOverlay(false)} />
          <div className="insp-modal" role="dialog" aria-modal="true" aria-label="Loop details">
            {inspectorFor(() => setOverlay(false))}
          </div>
        </>
      )}
      {captureOpen && (
        <CaptureDialog
          onClose={() => setCaptureOpen(false)}
          scope={scope}
          onCreate={async (title, note, start, deadlineAt, into) => {
            // Capturing into the world you are not looking at would file the loop
            // out of sight, so the workspace follows the choice you just made.
            if (scope !== 'all' && into !== scope) setScope(into);
            const id = await store.create(title, start, note, deadlineAt, into);
            if (id && mode === 'mobile' && tab !== 'all' && tab !== (start ? 'running' : 'open')) setTab('all');
          }}
        />
      )}
      {menu}
    </div>
  );
}

export type { Mode };
