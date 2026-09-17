import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fmtAge, fmtClock, fmtDay, fmtDuration, fmtHM, fmtTimer, pad2 } from '../../shared/format';
import { currentSessionMs, elapsedMs } from '../../shared/timer';
import type { Loop, Session } from '../../shared/types';
import { api } from '../lib/api';
import { Marker } from './Marker';
import { StartEditor } from './StartEditor';


export interface InspectorActions {
  toggle: (id: string) => void;
  reopen: (id: string) => void;
  close: (id: string) => void;
  priority: (id: string) => void;
  edit: (id: string, patch: { title?: string; note?: string }) => Promise<boolean>;
  remove: (id: string) => void;
  retime: (id: string, startedAt: number) => void;
}

interface Props {
  loop: Loop | null;
  now: number;
  pending: boolean;
  keysEnabled: boolean;
  onDismiss: () => void;
  actions: InspectorActions;
}

const WEEK = 7 * 86_400_000;

type SessionState = { loopId: string; sessions: Session[]; error: string | null; loading: boolean };

function useSessions(loop: Loop | null) {
  const [state, setState] = useState<SessionState | null>(null);
  const id = loop?.id;
  // Refetch whenever the loop's timer state changes on the server.
  const key = loop ? `${loop.id}:${loop.updatedAt}:${loop.sessionCount}:${loop.state}` : '';

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    setState((s) => (s && s.loopId === id ? { ...s, loading: true } : { loopId: id, sessions: [], error: null, loading: true }));
    const t = setTimeout(() => {
      api<{ sessions: Session[] }>(`/loops/${id}/sessions`, { signal: ctrl.signal })
        .then((r) => setState({ loopId: id, sessions: r.sessions, error: null, loading: false }))
        .catch((err: Error) => {
          if (err.name === 'AbortError') return;
          setState((s) => ({ loopId: id, sessions: s?.loopId === id ? s.sessions : [], error: err.message, loading: false }));
        });
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, id]);

  return state && state.loopId === id ? state : null;
}

export function Inspector({ loop, now, pending, keysEnabled, onDismiss, actions }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<'title' | 'note' | null>(null);
  const [draft, setDraft] = useState('');
  // Source of truth for the active edit, so blur-after-Escape cannot save.
  const editingRef = useRef<'title' | 'note' | null>(null);
  const sessions = useSessions(loop);
  // Deleting takes a second click so a stray tap can't remove a loop.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  useEffect(() => {
    setConfirmDelete(false);
    setEditingStart(false);
  }, [loop?.id]);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const setEdit = (field: 'title' | 'note' | null) => {
    editingRef.current = field;
    setEditing(field);
  };

  useEffect(() => setEdit(null), [loop?.id]);

  // Move focus into the pop-up so keyboard users land in the detail.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => prev?.focus?.();
  }, []);

  const beginEdit = (field: 'title' | 'note') => {
    if (!loop) return;
    setDraft(field === 'title' ? loop.title : loop.note);
    setEdit(field);
  };

  const commit = async () => {
    const field = editingRef.current;
    if (!loop || !field) return;
    const value = draft.replace(/\s+/g, ' ').trim();
    setEdit(null);
    if (field === 'title' && (!value || value === loop.title)) return;
    if (field === 'note' && value === loop.note) return;
    await actions.edit(loop.id, { [field]: value });
  };

  // Inspector shortcuts: S start/stop, P priority, E rename, N note, ⌫ close.
  useEffect(() => {
    if (!keysEnabled || !loop || editingStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        if (loop.state === 'closed') actions.reopen(loop.id);
        else actions.toggle(loop.id);
      } else if (k === 'p' && loop.state !== 'closed') {
        e.preventDefault();
        actions.priority(loop.id);
      } else if (k === 'e') {
        e.preventDefault();
        beginEdit('title');
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && loop.state !== 'closed') {
        e.preventDefault();
        actions.close(loop.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dismiss = (
    <button type="button" className="term-bar__esc" aria-label="Close details" onClick={onDismiss} data-autofocus={loop ? undefined : true}>
      ESC ✕
    </button>
  );

  if (!loop) {
    return (
      <section ref={rootRef} className="inspector" aria-label="Session detail">
        <div className="term-bar">
          <span className="term-bar__path">LOOP // DETAILS</span>
          <span className="hdr__spacer" />
          {dismiss}
        </div>
        <div className="insp-empty">
          NO LOOP SELECTED
          <br />
          CLICK A TIMER OR AGE TO INSPECT ITS SESSIONS
        </div>
      </section>
    );
  }

  const running = loop.state === 'running';
  const closed = loop.state === 'closed';
  const total = elapsedMs(loop, now);

  const list = (sessions?.sessions ?? []).map((s) => {
    const live = s.endedAt == null;
    const end = live ? now : s.endedAt!;
    return { ...s, live, dur: Math.max(0, end - s.startedAt), end };
  });
  const maxDur = Math.max(1, ...list.map((s) => s.dur));
  const thisWeek = list.filter((s) => s.startedAt > now - WEEK).length;
  const count = sessions ? list.length : loop.sessionCount;

  const stats = [
    { label: 'ACTIVE TIME', value: fmtHM(total), cls: '' },
    closed
      ? { label: 'CLOSED', value: `${fmtAge(now - (loop.closedAt ?? now))} ago`, cls: '' }
      : { label: 'OPEN FOR', value: fmtAge(now - loop.createdAt), cls: '' },
    { label: 'CURRENT SESSION', value: running ? fmtTimer(currentSessionMs(loop, now)) : '—', cls: running ? 'is-live' : 'is-dim' },
    { label: 'SESSIONS', value: pad2(count), cls: '' },
  ];

  // Actions shown under the title. Add entries here to extend the detail view.
  const loopActions: { key: string; label: string; run: () => void; main?: boolean; pressed?: boolean; confirming?: boolean; title?: string }[] = [
    closed
      ? { key: 'reopen', label: 'REOPEN ↺', main: true, run: () => actions.reopen(loop.id) }
      : {
          key: 'close',
          label: 'CLOSE LOOP',
          main: true,
          title: running ? 'Stops the running session, then closes (⌫)' : 'Close this loop (⌫)',
          run: () => actions.close(loop.id),
        },
    ...(!closed ? [{ key: 'priority', label: 'PRIORITY', pressed: loop.priority, run: () => actions.priority(loop.id) }] : []),
    { key: 'rename', label: 'RENAME', title: 'Rename (E)', run: () => beginEdit('title') },
    { key: 'note', label: loop.note ? 'NOTE' : 'ADD NOTE', run: () => beginEdit('note') },
    {
      key: 'start',
      label: 'EDIT START',
      pressed: editingStart,
      title: running ? 'Change when this session really started' : 'Change when this loop was opened',
      run: () => setEditingStart((v) => !v),
    },
    {
      key: 'delete',
      label: confirmDelete ? 'CONFIRM' : 'DELETE',
      confirming: confirmDelete,
      title: confirmDelete ? 'Click again to delete this loop' : 'Delete this loop',
      run: () => {
        if (!confirmDelete) return setConfirmDelete(true);
        setConfirmDelete(false);
        actions.remove(loop.id);
      },
    },
  ];

  const editKeys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEdit(null);
    }
  };

  return (
    <section ref={rootRef} className="inspector" aria-label={`Details: ${loop.title}`} aria-busy={pending || undefined} data-inspector={loop.id}>
      <div className="term-bar">
        <Marker loop={loop} />
        <span className="term-bar__path">
          <span className="term-bar__prefix">LOOP // </span>
          <span className={`term-bar__state term-bar__state--${loop.state}`}>{loop.state.toUpperCase()}</span>
          {loop.priority && <span className="term-bar__prio"> · PRIORITY</span>}
        </span>
        <span className="hdr__spacer" />
        {dismiss}
      </div>
      <div className="insp-head">
        <div className="insp-head__text">
          {editing === 'title' ? (
            <input
              className="insp-edit"
              aria-label="Loop title"
              autoFocus
              maxLength={140}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={editKeys}
              onBlur={() => void commit()}
            />
          ) : (
            <span className="insp-head__title" title={loop.title}>
              {loop.title}
            </span>
          )}
          {editing === 'note' ? (
            <input
              className="insp-edit insp-edit--note"
              aria-label="Context note"
              autoFocus
              maxLength={280}
              placeholder="Short context note"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={editKeys}
              onBlur={() => void commit()}
            />
          ) : (
            <span className={`insp-head__note${loop.note ? '' : ' is-empty'}`} title={loop.note}>
              {loop.note || 'No context note'}
            </span>
          )}
        </div>
        <span className={`insp-head__timer${running ? ' is-running' : ''}`} aria-label={`Active time ${fmtHM(total)}`}>
          {fmtTimer(total)}
        </span>
        {closed ? (
          <button type="button" className="insp-btn" onClick={() => actions.reopen(loop.id)} data-autofocus>
            ↺ REOPEN
          </button>
        ) : (
          <button
            type="button"
            className="insp-btn"
           
            onClick={() => actions.toggle(loop.id)}
            aria-label={running ? `Stop ${loop.title}` : `Start ${loop.title}`}
            data-autofocus
          >
            {running ? '■ STOP' : '▶ START'}
          </button>
        )}
      </div>

      <div className="insp-actions" role="group" aria-label="Loop actions">
        {loopActions.map((act) => (
          <button
            key={act.key}
            type="button"
            className={`insp-act${act.main ? ' insp-act--main' : ''}${act.confirming ? ' is-confirming' : ''}`}
            aria-pressed={act.pressed}
            data-key={act.key}
            title={act.title}
            onClick={act.run}
          >
            {act.label}
          </button>
        ))}
      </div>

      {editingStart ? (
        <div className="inspector__scroll">
          <StartEditor
            loop={loop}
            sessions={sessions?.sessions ?? null}
            now={now}
            onCancel={() => setEditingStart(false)}
            onSave={(at) => {
              setEditingStart(false);
              actions.retime(loop.id, at);
            }}
          />
        </div>
      ) : (
        <>
      <div className="insp-stats">
        {stats.map((s) => (
          <div key={s.label} className="insp-stat">
            <div className="insp-stat__label">{s.label}</div>
            <div className={`insp-stat__value ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="insp-sect">
        <span className="insp-sect__label">SESSIONS</span>
        <span className="insp-sect__count">{pad2(count)}</span>
        <span className="sect__rule" />
        <span className="insp-sect__meta">
          CREATED {fmtDay(loop.createdAt, now)} {fmtClock(loop.createdAt)}
          {thisWeek > 0 ? ` · ${thisWeek}× THIS WEEK` : ''}
        </span>
      </div>

      <div className="inspector__scroll">
        {sessions?.error && !list.length ? (
          <div className="empty">COULDN’T LOAD SESSIONS — {sessions.error}</div>
        ) : !sessions && loop.sessionCount > 0 ? (
          <div className="empty">LOADING SESSIONS…</div>
        ) : list.length === 0 ? (
          <div className="empty">NO SESSIONS YET — START THIS LOOP TO TRACK TIME</div>
        ) : (
          <ul aria-label="Session history">
            {list.map((s) => (
              <li key={s.id} className="sess">
                <span className="sess__day">{fmtDay(s.startedAt, now)}</span>
                <span className="sess__range">
                  {fmtClock(s.startedAt)} → {s.live ? 'NOW' : fmtClock(s.end)}
                </span>
                <span className="sess__bar" aria-hidden="true">
                  <span className={`sess__fill${s.live ? ' is-live' : ''}`} style={{ width: `${Math.max(2, (s.dur / maxDur) * 100)}%` }} />
                </span>
                <span className={`sess__dur${s.live ? ' is-live' : ''}`}>{s.live ? fmtTimer(s.dur) : fmtDuration(s.dur)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
        </>
      )}
    </section>
  );
}
