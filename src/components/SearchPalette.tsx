import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { fmtHM } from '../../shared/format';
import { isFocused } from '../../shared/focus';
import { elapsedMs } from '../../shared/timer';
import type { Loop } from '../../shared/types';
import { MOD } from './Chrome';
import { Marker } from './Marker';

const LIMIT = 50;
type Kind = 'focus' | 'running' | 'open' | 'closed';
const KIND_RANK: Record<Kind, number> = { focus: 0, running: 1, open: 2, closed: 3 };
const KIND_LABEL: Record<Kind, string> = { focus: 'FOCUS', running: 'RUNNING', open: 'OPEN', closed: 'CLOSED' };

interface Hit {
  loop: Loop;
  kind: Kind;
  /** Where the match was found when it was not the title: a note or the person it sits with. */
  via: string | null;
}

/** Wrap every occurrence of `q` in `text` so the eye lands on why this row matched. */
function mark(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  out.push(text.slice(i));
  return out;
}

/** A window of a long note centred on the match, so the matched words are visible. */
function around(text: string, q: string, span = 64) {
  const at = text.toLowerCase().indexOf(q);
  if (text.length <= span || at === -1) return text;
  const from = Math.max(0, Math.min(at - 20, text.length - span));
  return `${from > 0 ? '…' : ''}${text.slice(from, from + span)}${from + span < text.length ? '…' : ''}`;
}

interface Props {
  /** Every loop in the scope being looked at, in any state. */
  loops: Loop[];
  now: number;
  markScope: boolean;
  initialQuery: string;
  onPick: (id: string) => void;
  /** Keep the query on the list itself instead of jumping to one loop. */
  onFilter: (query: string) => void;
  onClose: () => void;
}

/**
 * Centred terminal pop-up for ⌘K: a big prompt, live results across every state,
 * ↑↓ to move, ⏎ to open a loop's details, ⇧⏎ to filter the list by the query.
 */
export function SearchPalette({ loops, now, markScope, initialQuery, onPick, onFilter, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => prev?.focus?.();
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const out: (Hit & { rank: number })[] = [];
    for (const loop of loops) {
      const kind: Kind = loop.state === 'closed' ? 'closed' : isFocused(loop, now) ? 'focus' : loop.state;
      let via: string | null = null;
      let rank = 0;
      if (q) {
        const title = loop.title.toLowerCase();
        if (title.startsWith(q)) rank = 0;
        else if (title.includes(q)) rank = 1;
        else {
          const note = loop.notes.find((n) => n.text.toLowerCase().includes(q));
          if (note) via = `# ${around(note.text, q)}`;
          else if (loop.ownerWith.toLowerCase().includes(q)) via = `→ ${loop.ownerWith}`;
          else continue;
          rank = 2;
        }
      }
      out.push({ loop, kind, via, rank });
    }
    // Title hits first, then live work before closed, then the loop that has run longest.
    out.sort(
      (a, b) =>
        a.rank - b.rank ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        elapsedMs(b.loop, now) - elapsedMs(a.loop, now),
    );
    return out;
    // `now` ticks every second; results only need to re-rank when the query or loops change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, q]);

  const shown = hits.slice(0, LIMIT);
  const idx = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return onClose();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'n' || e.key === 'p'))) {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' || e.key === 'n' ? 1 : -1;
      return setActive((idx + step + shown.length) % shown.length);
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.shiftKey) return onFilter(query.trim());
      const hit = shown[idx];
      if (hit) onPick(hit.loop.id);
    }
  };

  const count = q ? `${hits.length} MATCH${hits.length === 1 ? '' : 'ES'}` : `${hits.length} LOOPS`;

  return (
    <>
      <div className="scrim scrim--capture" onClick={onClose} />
      <div className="capture palette" role="dialog" aria-modal="true" aria-label="Search loops">
        <div className="term-bar">
          <span className="marker marker--running" aria-hidden="true" />
          <h2 className="term-bar__path">LOOP // SEARCH</h2>
          <span className="palette__count" role="status">{count}</span>
          <span className="hdr__spacer" />
          <button type="button" className="term-bar__esc" onClick={onClose} aria-label="Close search">
            ESC ✕
          </button>
        </div>

        <div className="palette__field">
          <span className="capture__prompt" aria-hidden="true">&gt;</span>
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={shown[idx] ? `palette-${shown[idx].loop.id}` : undefined}
            aria-label="Search loops"
            placeholder="search titles, notes, people"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={140}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
          {query && (
            <button type="button" className="palette__clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              ✕
            </button>
          )}
        </div>

        <ul id="palette-results" ref={listRef} className="palette__list" role="listbox" aria-label="Results">
          {shown.map((h, i) => (
            <li
              key={h.loop.id}
              id={`palette-${h.loop.id}`}
              data-i={i}
              role="option"
              aria-selected={i === idx}
              className="palette__item"
              data-kind={h.kind}
              onMouseMove={() => i !== idx && setActive(i)}
              onClick={() => onPick(h.loop.id)}
            >
              <span className="palette__caret" aria-hidden="true">{i === idx ? '▸' : ''}</span>
              <Marker loop={h.loop} />
              <span className="palette__main">
                <span className="palette__title">{mark(h.loop.title, q)}</span>
                {h.via && <span className="palette__via">{mark(h.via, q)}</span>}
              </span>
              {markScope && <span className="palette__scope">{h.loop.scope === 'work' ? 'WORK' : 'PERS'}</span>}
              <span className="palette__kind">{KIND_LABEL[h.kind]}</span>
              <span className="palette__time">{fmtHM(elapsedMs(h.loop, now))}</span>
            </li>
          ))}
          {!shown.length && (
            <li className="palette__empty" role="presentation">
              {q ? `NO LOOPS MATCH “${query.trim()}”` : 'NO LOOPS YET'}
            </li>
          )}
          {hits.length > LIMIT && (
            <li className="palette__more" role="presentation">
              + {hits.length - LIMIT} MORE — KEEP TYPING TO NARROW
            </li>
          )}
        </ul>

        <div className="palette__foot" aria-hidden="true">
          <span><kbd>↑↓</kbd> MOVE</span>
          <span><kbd>⏎</kbd> OPEN</span>
          <span><kbd>⇧⏎</kbd> FILTER LIST</span>
          <span className="hdr__spacer" />
          <span><kbd>{MOD}K</kbd> TOGGLE</span>
        </div>
      </div>
    </>
  );
}
