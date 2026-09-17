import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtHM, fmtTimer, pad2 } from '../../shared/format';
import { elapsedMs, sortClosed, sortOpen, sortRunning } from '../../shared/timer';
import type { Loop, OpenSort, RunSort, ThemePref } from '../../shared/types';
import { useNow } from '../hooks/useNow';
import { useStore } from '../hooks/useStore';
import { useMode, type Mode } from '../hooks/useViewport';
import { store } from '../lib/store';
import {
  CaptureBar,
  CaptureDialog,
  Header,
  MOD,
  MenuPopover,
  OPEN_SORTS,
  RUN_SORTS,
  SearchField,
  SortButtons,
} from './Chrome';
import { Inspector, type InspectorActions } from './Inspector';
import { LoopRow, type RowActions, type RowVariant } from './LoopRow';

type Tab = 'all' | 'running' | 'open' | 'closed';
const TAB_KEY = 'loop.tab';
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

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable="true"]');

export function Workspace() {
  const s = useStore();
  const now = useNow();
  const mode = useMode();
  const rowVariant: RowVariant = mode === 'rail' ? 'rail' : mode === 'mobile' ? 'mobile' : 'desk';
  const compact = mode === 'rail' || mode === 'mobile';

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };

  // ── Derived lists ────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const { settings } = s;
  const ownerFilter = settings.ownerFilter;
  const matches = useCallback(
    (l: Loop) =>
      (ownerFilter === 'all' || (ownerFilter === 'mine' ? l.owner === 'mine' : l.owner !== 'mine')) &&
      (!q ||
        l.title.toLowerCase().includes(q) ||
        l.note.toLowerCase().includes(q) ||
        l.ownerWith.toLowerCase().includes(q)),
    [q, ownerFilter],
  );

  const allRunning = s.loops.filter((l) => l.state === 'running');
  const allOpen = s.loops.filter((l) => l.state === 'open');
  const running = sortRunning(allRunning.filter(matches), settings.runSort, now);
  const open = sortOpen(allOpen.filter(matches), settings.openSort);
  const closedAll = sortClosed(s.loops.filter((l) => l.state === 'closed' && matches(l)));
  const closed = q || settings.archiveRange === 'all' ? closedAll : closedAll.filter((l) => (l.closedAt ?? 0) > now - WEEK);
  const prioCount = [...allRunning, ...allOpen].filter((l) => l.priority).length;
  const totalActive = [...allRunning, ...allOpen].reduce((a, l) => a + elapsedMs(l, now), 0);
  const longest = allRunning.reduce((a, l) => Math.max(a, elapsedMs(l, now)), 0);

  // Ball-in-court counts across live (not closed) loops.
  const live = [...allRunning, ...allOpen];
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
  const inspectorVisible = overlay && !!selected;

  // Close the overlay if its loop disappears (e.g. undoing its creation).
  useEffect(() => {
    if (overlay && !selected) setOverlay(false);
  }, [overlay, selected]);

  // ── Actions (stable references keep memoized rows cheap) ────────────────
  const rowActions = useMemo<RowActions>(
    () => ({
      toggle: (id) => void store.toggle(id),
      reopen: (id) => void store.reopen(id),
      inspect: (id) => {
        setSelectedId(id);
        setOverlay(true);
      },
    }),
    [],
  );


  const inspectorActions = useMemo<InspectorActions>(
    () => ({
      toggle: (id) => void store.toggle(id),
      reopen: (id) => void store.reopen(id),
      close: (id) => void store.close(id),
      priority: (id) => void store.togglePriority(id),
      edit: (id, patch) => store.edit(id, patch),
      retime: (id, at, kept) => void store.retime(id, at, kept),
      handoff: (id, patch) => void store.handoff(id, patch),
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

  const createFromBar = useCallback(async (text: string, start: boolean) => {
    const id = await store.create(text, start);
    if (id && start && mode === 'mobile' && tab === 'open') setTab('running');
    return id;
  }, [mode, tab]);

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
  }, [menuOpen, captureOpen, overlay, mode, compact, searchOpen, query, openNew, openSearch]);

  // ── Rendering helpers ───────────────────────────────────────────────────
  const rows = (list: Loop[], label: string) => (
    <ul aria-label={label}>
      {list.map((l) => (
        <LoopRow
          key={l.id}
          loop={l}
          variant={rowVariant}
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
    const list =
      tab === 'running' ? running : tab === 'open' ? open : tab === 'closed' ? closedAll : [...running, ...open];
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
    <div className={`viewbar viewbar--${mode}`} role="group" aria-label="Filter by who is moving it">
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
      <span className="viewbar__spacer" />
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

  const inspectorFor = (onDismiss: () => void) => (
    <Inspector
      loop={selected}
      now={now}
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
        runCount={allRunning.length}
        openCount={allOpen.length}
        anyRunning={allRunning.length > 0}
        search={searchField}
        onNew={openNew}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
        menuButtonRef={menuBtnRef}
        now={now}
        onSearch={() => (searchOpen && !query ? setSearchOpen(false) : openSearch())}
      />
      {(mode === 'desk' || mode === 'wide') && <CaptureBar inputRef={captureRef} onCreate={createFromBar} />}
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
      </div>
      {statusBar}

      {overlay && selected && (
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
          onCreate={async (title, note, start) => {
            const id = await store.create(title, start, note);
            if (id && mode === 'mobile' && tab !== 'all' && tab !== (start ? 'running' : 'open')) setTab('all');
          }}
        />
      )}
      {menu}
    </div>
  );
}

export type { Mode };
