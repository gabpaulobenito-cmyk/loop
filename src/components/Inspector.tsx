import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { fmtAge, fmtClock, fmtDay, fmtDuration, fmtHM, pad2 } from '../../shared/format';
import { currentSessionMs, deadlineTier, elapsedMs } from '../../shared/timer';
import { openNotes } from '../../shared/notes';
import type { Loop, Scope, Session } from '../../shared/types';
import { api } from '../lib/api';
import { Countdown } from './Countdown';
import { DeadlinePanel } from './DeadlinePanel';
import { Marker } from './Marker';
import { NotesPanel, type NotesActions } from './NotesPanel';
import { StartEditor } from './StartEditor';
import { OwnerPanel, type HandoffPatch } from './OwnerPanel';
import { TimerText } from './TimerText';


export interface InspectorActions {
  toggle: (id: string) => void;
  reopen: (id: string) => void;
  close: (id: string) => void;
  priority: (id: string) => void;
  edit: (id: string, patch: { title?: string }) => Promise<boolean>;
  /** The checklist under the title; its first unchecked line is what the row marquees. */
  notes: (id: string) => NotesActions;
  remove: (id: string) => void;
  retime: (id: string, startedAt: number, predictedAccumulatedMs?: number) => void;
  handoff: (id: string, patch: HandoffPatch) => void;
  setDeadline: (id: string, deadlineAt: number) => void;
  dropDeadline: (id: string) => void;
  setScope: (id: string, scope: Scope) => void;
}

interface Props {
  loop: Loop | null;
  now: number;
  /** Docked as the second column on wide windows (no dismiss, no focus grab). */
  docked?: boolean;
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

export function Inspector({ loop, now, docked = false, pending, keysEnabled, onDismiss, actions }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<'title' | null>(null);
  const [draft, setDraft] = useState('');
  // Source of truth for the active edit, so blur-after-Escape cannot save.
  const editingRef = useRef<'title' | null>(null);
  // Bumped to send the cursor into the checklist's add field (the NOTES action, N).
  const [focusNotes, setFocusNotes] = useState(0);
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

  const setEdit = (field: 'title' | null) => {
    editingRef.current = field;
    setEditing(field);
  };

  useEffect(() => setEdit(null), [loop?.id]);

  // Move focus into the pop-up so keyboard users land in the detail.
  // The docked column is always on screen, so it never steals focus.
  useEffect(() => {
    if (docked) return;
    const prev = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => prev?.focus?.();
  }, [docked]);

  const beginEdit = (field: 'title') => {
    if (!loop) return;
    setDraft(loop.title);
    setEdit(field);
  };

  const addNote = () => setFocusNotes((n) => n + 1);

  const commit = async () => {
    const field = editingRef.current;
    if (!loop || !field) return;
    const value = draft.replace(/\s+/g, ' ').trim();
    setEdit(null);
    if (!value || value === loop.title) return;
    await actions.edit(loop.id, { [field]: value });
  };

  // Inspector shortcuts: S start/stop, P priority, E rename, N add a note, ⌫ close.
  useEffect(() => {
    if (!keysEnabled || !loop || editingStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return;
      // Docked, the panel shares the screen with the list — only act when focus is inside it.
      const within = !docked || !!rootRef.current?.contains(document.activeElement);
      if (!within) return;
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
      } else if (k === 'n') {
        e.preventDefault();
        addNote();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && loop.state !== 'closed') {
        e.preventDefault();
        actions.close(loop.id);
      }
    };
    // Captured, so an open detail gets first refusal on these letters — otherwise
    // the workspace's own N would open a new loop instead of adding a note here.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const dismiss = docked ? null : (
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
          CLICK A ROW TO SEE ITS SESSIONS
        </div>
      </section>
    );
  }

  const running = loop.state === 'running';
  const closed = loop.state === 'closed';
  // How much of the checklist is waiting behind the line on the row.
  const notesLeft = openNotes(loop.notes);
  const noteTail = notesLeft > 1 ? ` +${notesLeft - 1} MORE` : '';
  const total = elapsedMs(loop, now);
  const tier = deadlineTier(loop, now);

  const list = (sessions?.sessions ?? []).map((s) => {
    const live = s.endedAt == null;
    const end = live ? now : s.endedAt!;
    return { ...s, live, dur: Math.max(0, end - s.startedAt), end };
  });
  const maxDur = Math.max(1, ...list.map((s) => s.dur));
  const thisWeek = list.filter((s) => s.startedAt > now - WEEK).length;
  const count = sessions ? list.length : loop.sessionCount;

  // A loop reads one clock: a countdown shows what's left, an ageing loop its age.
  const stats = [
    { label: 'ACTIVE TIME', value: fmtHM(total), cls: '' },
    closed
      ? { label: 'CLOSED', value: `${fmtAge(now - (loop.closedAt ?? now))} ago`, cls: '' }
      : tier !== 'none'
        ? { label: 'DEADLINE', value: <Countdown loop={loop} now={now} />, cls: '' }
        : { label: 'OPEN FOR', value: fmtAge(now - loop.createdAt), cls: '' },
    {
      label: 'CURRENT SESSION',
      value: running ? <TimerText ms={currentSessionMs(loop, now)} /> : '—',
      cls: running ? 'is-live' : 'is-dim',
    },
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
    { key: 'note', label: 'ADD NOTE', title: 'Add a line to the checklist (N)', run: addNote },
    {
      key: 'start',
      label: 'EDIT START',
      pressed: editingStart,
      title: running ? 'Change when this session really started' : 'Change when this loop was opened',
      run: () => setEditingStart((v) => !v),
    },
    {
      key: 'scope',
      label: loop.scope === 'personal' ? 'MOVE TO WORK' : 'MOVE TO PERSONAL',
      title: `This loop lives in ${loop.scope}. Move it to the other side.`,
      run: () => actions.setScope(loop.id, loop.scope === 'personal' ? 'work' : 'personal'),
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
        <Marker loop={loop} tier={tier} />
        <span className="term-bar__path">
          <span className="term-bar__prefix">LOOP // </span>
          <span className={`term-bar__state term-bar__state--${loop.state}`}>{loop.state.toUpperCase()}</span>
          {loop.scope === 'personal' && <span className="term-bar__scope"> · PERSONAL</span>}
          {loop.priority && <span className="term-bar__prio"> · PRIORITY</span>}
          {tier !== 'none' && (
            <span className="term-bar__dl" data-tier={tier}>
              {' · '}
              {tier === 'overdue' ? 'OVERDUE' : 'DEADLINE'}
            </span>
          )}
          {loop.owner !== 'mine' && (
            <span className="term-bar__owner" data-owner={loop.owner}>
              {' · '}
              {loop.owner === 'delegated' ? '→ ' : '⧗ '}
              {loop.ownerWith || loop.owner.toUpperCase()}
            </span>
          )}
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
          {/* The line the row marquees — the first unchecked one in the checklist below. */}
          <button
            type="button"
            className={`insp-head__note${loop.note ? '' : ' is-empty'}`}
            title={loop.note ? `${loop.note} — the line this loop's row marquees` : 'Add the first line of this loop’s checklist (N)'}
            onClick={addNote}
          >
            {loop.note || (loop.notes.length ? 'ALL NOTES CHECKED OFF' : 'No notes yet')}
            {noteTail && <span className="insp-head__notecount">{noteTail}</span>}
          </button>
        </div>
        <span className={`insp-head__timer${running ? ' is-running' : ''}`} aria-label={`Active time ${fmtHM(total)}`}>
          <TimerText ms={total} />
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
            onSave={(at, kept) => {
              setEditingStart(false);
              actions.retime(loop.id, at, kept);
            }}
          />
        </div>
      ) : (
        <div className="inspector__scroll">
          <NotesPanel loop={loop} actions={actions.notes(loop.id)} focusAddSeq={focusNotes} />

          <DeadlinePanel
            loop={loop}
            now={now}
            onSet={(at) => actions.setDeadline(loop.id, at)}
            onDrop={() => actions.dropDeadline(loop.id)}
          />

          <OwnerPanel loop={loop} now={now} onChange={(patch) => actions.handoff(loop.id, patch)} />

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

      <div className="insp-sessions">
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
                <span className={`sess__dur${s.live ? ' is-live' : ''}`}>{s.live ? <TimerText ms={s.dur} /> : fmtDuration(s.dur)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
        </div>
      )}
    </section>
  );
}
