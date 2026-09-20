import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { pad2 } from '../../shared/format';
import { openNotes } from '../../shared/notes';
import { NOTES_MAX, NOTE_MAX, type Loop } from '../../shared/types';

export interface NotesActions {
  add: (text: string) => void;
  edit: (noteId: string, text: string) => void;
  toggle: (noteId: string) => void;
  move: (noteId: string, to: number) => void;
  remove: (noteId: string) => void;
}

interface Props {
  loop: Loop;
  actions: NotesActions;
  /** Bumped by the N shortcut to put the cursor in the add field. */
  focusAddSeq?: number;
}

interface Drag {
  id: string;
  from: number;
  to: number;
  /** Pointer travel since the grab, in pixels. */
  dy: number;
  /** Row height, so travel converts to positions. */
  h: number;
}

/**
 * A loop's checklist.
 *
 * The order is the user's: the first unchecked line is the one the row marquee
 * reads, so dragging a line to the top is how you change what the ticker says.
 * Checking a line off never moves it — the list you arranged is the list you
 * get back, with the done ones struck through in place.
 */
export function NotesPanel({ loop, actions, focusAddSeq = 0 }: Props) {
  const notes = loop.notes;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [entry, setEntry] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // Source of truth for the open edit, so a blur after Escape cannot save.
  const editingRef = useRef<string | null>(null);

  const setEdit = (id: string | null) => {
    editingRef.current = id;
    setEditing(id);
  };

  useEffect(() => {
    setEdit(null);
    setEntry('');
  }, [loop.id]);

  useEffect(() => {
    if (focusAddSeq) addRef.current?.focus();
  }, [focusAddSeq]);

  const activeId = notes.find((n) => !n.done)?.id ?? null;
  const left = openNotes(notes);
  const full = notes.length >= NOTES_MAX;

  // ── Editing one line ───────────────────────────────────────────────────
  const beginEdit = (id: string, text: string) => {
    setDraft(text);
    setEdit(id);
  };

  const commit = () => {
    const id = editingRef.current;
    if (!id) return;
    setEdit(null);
    const value = draft.trim();
    const before = notes.find((n) => n.id === id);
    if (!before || value === before.text) return;
    actions.edit(id, value);
  };

  const editKeys = (e: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const id = editingRef.current;
      commit();
      if (id) actions.move(id, index + (e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEdit(null);
    }
  };

  // ── Reordering ─────────────────────────────────────────────────────────
  // Alt + ↑/↓ moves the focused line; the grip drags it. Both land in the same
  // place: a new index, sent as the whole rearranged list.
  const rowKeys = (e: ReactKeyboardEvent<HTMLLIElement>, id: string, index: number) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if ((e.target as HTMLElement).closest('input')) return;
    e.preventDefault();
    actions.move(id, index + (e.key === 'ArrowDown' ? 1 : -1));
  };

  const grab = (e: ReactPointerEvent<HTMLButtonElement>, id: string, from: number) => {
    if (e.button !== 0) return;
    const row = (e.currentTarget.closest('li') as HTMLElement | null) ?? null;
    const h = row?.getBoundingClientRect().height ?? 24;
    const y0 = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setDrag({ id, from, to: from, dy: 0, h });

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      const to = Math.max(0, Math.min(notes.length - 1, from + Math.round(dy / h)));
      setDrag((d) => (d ? { ...d, dy, to } : d));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const dy = ev.clientY - y0;
      const to = Math.max(0, Math.min(notes.length - 1, from + Math.round(dy / h)));
      setDrag(null);
      if (to !== from) actions.move(id, to);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Where a row sits while a drag is in flight. */
  const shift = (i: number): string | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) return `translateY(${drag.dy}px)`;
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return `translateY(${-drag.h}px)`;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return `translateY(${drag.h}px)`;
    return undefined;
  };

  const submitEntry = () => {
    const text = entry.trim();
    if (!text) return;
    actions.add(text);
    // Cleared, focus kept: a checklist is usually written a few lines at a time.
    setEntry('');
  };

  return (
    <section className="notes" aria-label="Notes">
      <div className="insp-sect">
        <span className="insp-sect__label">NOTES</span>
        <span className="insp-sect__count">{pad2(notes.length)}</span>
        <span className="sect__rule" />
        <span className="insp-sect__meta">
          {notes.length === 0 ? 'THE FIRST UNCHECKED ONE RUNS IN THE ROW' : left === 0 ? 'ALL CHECKED OFF' : `${pad2(left)} OPEN · TOP ONE RUNS IN THE ROW`}
        </span>
      </div>

      {notes.length > 0 && (
        <ul ref={listRef} className={`notes__list${drag ? ' is-dragging' : ''}`} aria-label="Checklist">
          {notes.map((n, i) => {
            const onRow = n.id === activeId;
            return (
              <li
                key={n.id}
                className={`note${n.done ? ' is-done' : ''}${onRow ? ' is-active' : ''}${drag?.id === n.id ? ' is-held' : ''}`}
                data-note={n.id}
                style={{ transform: shift(i) }}
                onKeyDown={(e) => rowKeys(e, n.id, i)}
              >
                <button
                  type="button"
                  className="note__grip"
                  aria-label={`Move “${n.text}” — drag, or alt with the arrow keys`}
                  title="Drag to rearrange (alt ↑/↓)"
                  onPointerDown={(e) => grab(e, n.id, i)}
                >
                  ⣿
                </button>
                <button
                  type="button"
                  className="note__check"
                  role="checkbox"
                  aria-checked={n.done}
                  aria-label={n.text}
                  title={n.done ? 'Bring this one back' : 'Check this one off'}
                  onClick={() => actions.toggle(n.id)}
                >
                  {n.done ? '[×]' : '[ ]'}
                </button>
                {editing === n.id ? (
                  <input
                    className="note__edit"
                    aria-label={`Edit note: ${n.text}`}
                    autoFocus
                    maxLength={NOTE_MAX}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => editKeys(e, i)}
                    onBlur={commit}
                  />
                ) : (
                  <button type="button" className="note__text" title={n.text} onClick={() => beginEdit(n.id, n.text)}>
                    {n.text}
                  </button>
                )}
                {onRow && (
                  <span className="note__tag" title="This is the line the row marquees">
                    ON ROW
                  </span>
                )}
                <button type="button" className="note__del" aria-label={`Delete note: ${n.text}`} title="Delete this note" onClick={() => actions.remove(n.id)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="notes__add">
        <span className="notes__plus" aria-hidden="true">
          +
        </span>
        <input
          ref={addRef}
          className="notes__input"
          aria-label="Add a note"
          placeholder={full ? `FULL — ${NOTES_MAX} NOTES` : 'ADD A NOTE'}
          maxLength={NOTE_MAX}
          disabled={full}
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submitEntry();
            } else if (e.key === 'Escape' && entry) {
              e.preventDefault();
              e.stopPropagation();
              setEntry('');
            }
          }}
        />
        <button type="button" className="notes__addbtn" onClick={submitEntry} disabled={full || !entry.trim()}>
          ADD ↵
        </button>
      </div>
    </section>
  );
}
