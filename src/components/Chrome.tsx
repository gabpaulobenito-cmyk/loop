import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { fmtDateLabel, fmtHeaderClock, pad2 } from '../../shared/format';
import type { Mode } from '../hooks/useViewport';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'CTRL+';

// ── Search field ─────────────────────────────────────────────────────────────

interface SearchProps {
  value: string;
  onChange: (v: string) => void;
  onEscape?: () => void;
  autoFocus?: boolean;
}

export const SearchField = forwardRef<HTMLInputElement, SearchProps>(function SearchField(
  { value, onChange, onEscape, autoFocus },
  ref,
) {
  return (
    <div className="search" role="search">
      <span className="search__icon" aria-hidden="true">⌕</span>
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search loops"
        placeholder="SEARCH LOOPS"
        value={value}
        autoFocus={autoFocus}
        maxLength={140}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (value) onChange('');
            else (e.target as HTMLInputElement).blur();
            onEscape?.();
          }
        }}
      />
      {value ? (
        <button type="button" className="search__clear hit" aria-label="Clear search" onClick={() => onChange('')}>
          ✕
        </button>
      ) : (
        <span className="search__kbd" aria-hidden="true">{MOD}K</span>
      )}
    </div>
  );
});

// ── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  mode: Mode;
  runCount: number;
  openCount: number;
  anyRunning: boolean;
  search: ReactNode;
  onNew: () => void;
  menuOpen: boolean;
  onMenu: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  now: number;
  onSearch: () => void;
}

/** Live local date and time: "Thu Sep 17 10:30PM". */
function HeaderClock({ now }: { now: number }) {
  const { weekday, date, time } = fmtHeaderClock(now);
  return (
    <time className="hdr__clock" dateTime={new Date(now).toISOString()} aria-label={`${weekday} ${date} ${time}`}>
      <span className="hdr__clock-day">{weekday} </span>
      {date} <span className="hdr__clock-time">{time}</span>
    </time>
  );
}

export function Header({ mode, runCount, openCount, anyRunning, search, onNew, menuOpen, onMenu, menuButtonRef, now, onSearch }: HeaderProps) {
  const brand = (
    <span className="hdr__brand">
      <span className={`marker ${anyRunning ? 'marker--running' : 'marker--open'}`} aria-hidden="true" />
      <h1 className="hdr__word" style={{ margin: 0 }}>LOOP</h1>
    </span>
  );
  const more = (
    <button
      ref={menuButtonRef}
      type="button"
      className="btn-more hit"
      aria-label="Menu"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onMenu}
    >
      ⋯
    </button>
  );
  const total = runCount + openCount;

  if (mode === 'rail') {
    return (
      <header className="hdr hdr--rail">
        {brand}
        <span className="hdr__spacer" />
        <span className="hdr__total" title={`${runCount} running · ${openCount} open`}>
          <span className="sr-only">{runCount} running, {openCount} open, total </span>
          {pad2(total)}
        </span>
        <button type="button" className="btn-new hit" title={`NEW LOOP — ${MOD}N`} aria-label="New loop" onClick={onNew}>
          <span className="btn-new__plus" aria-hidden="true">+</span>
          <span className="btn-new__label">NEW</span>
        </button>
        {more}
      </header>
    );
  }

  if (mode === 'mobile') {
    return (
      <header className="hdr hdr--mobile">
        {brand}
        <span className="hdr__total" aria-label={`${runCount} running of ${total}`}>
          {pad2(runCount)}/{pad2(total)}
        </span>
        <span className="hdr__spacer" />
        <HeaderClock now={now} />
        <button type="button" className="btn-more btn-search" aria-label="Search loops" onClick={onSearch}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="6.75" cy="6.75" r="4.75" />
            <path d="M10.4 10.4L14.5 14.5" />
          </svg>
        </button>
        <button type="button" className="btn-new" aria-label="New loop" onClick={onNew}>
          <span className="btn-new__plus" aria-hidden="true">+</span>
        </button>
        {more}
      </header>
    );
  }

  return (
    <header className="hdr">
      {brand}
      <div className="hdr__counts">
        <span className="c-run">RUNNING {pad2(runCount)}</span>
        <span className="c-open">OPEN {pad2(openCount)}</span>
      </div>
      <span className="hdr__spacer" />
      <HeaderClock now={now} />
      {search}
      <button type="button" className="btn-new" onClick={onNew} title={`New loop (${MOD}N or N)`}>
        <span className="btn-new__plus" aria-hidden="true">+</span>
        <span className="btn-new__label">NEW LOOP</span>
        <span className="btn-new__kbd" aria-hidden="true">{MOD}N</span>
      </button>
      {more}
    </header>
  );
}

// ── Inline capture bar (desk) ────────────────────────────────────────────────

interface CaptureBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onCreate: (text: string, start: boolean) => Promise<unknown>;
}

export function CaptureBar({ inputRef, onCreate }: CaptureBarProps) {
  const [text, setText] = useState('');
  const has = text.trim().length > 0;
  const submit = (start: boolean) => {
    if (!has) return;
    const value = text;
    setText('');
    void onCreate(value, start);
    inputRef.current?.focus();
  };
  return (
    <div className="capbar" onClick={() => inputRef.current?.focus()}>
      <span className="capbar__prompt" aria-hidden="true">&gt;</span>
      <input
        ref={inputRef}
        type="text"
        aria-label="New loop title. Enter creates open, Shift+Enter creates and starts. Use // to add a note."
        placeholder="What are you starting?"
        autoComplete="off"
        enterKeyHint="done"
        maxLength={420}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit(e.shiftKey);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setText('');
            inputRef.current?.blur();
          }
        }}
      />
      <span className="capbar__hint">
        <button type="button" className="capbar__act" disabled={!has} onClick={(e) => { e.stopPropagation(); submit(false); }}>
          <kbd style={{ font: 'inherit' }}>⏎</kbd> OPEN
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className="capbar__act capbar__act--start" disabled={!has} onClick={(e) => { e.stopPropagation(); submit(true); }}>
          <kbd style={{ font: 'inherit' }}>⇧⏎</kbd> START
        </button>
      </span>
    </div>
  );
}

// ── New loop pop-up ──────────────────────────────────────────────────────────

interface CaptureDialogProps {
  onClose: () => void;
  onCreate: (title: string, note: string, start: boolean, deadlineAt: number | null) => Promise<unknown>;
}

/** 17:00 local, `days` days from today — end of the working day the work is due. */
function eveningIn(days: number, now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 17, 0).getTime();
}
const toDateInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Grow a textarea to fit its content. */
function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Centered pop-up for starting a loop: large title, optional note, and a start
 * button. Enter creates the loop and starts its timer; ⇧⏎ adds it without starting.
 */
export function CaptureDialog({ onClose, onCreate }: CaptureDialogProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  // A deadline is opt-in: most loops age, only some are owed to someone by a date.
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const submitted = useRef(false);
  const needsDate = hasDeadline && deadlineAt == null;
  const has = title.trim().length > 0 && !needsDate;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useLayoutEffect(() => autosize(titleRef.current), [title]);
  useLayoutEffect(() => autosize(noteRef.current), [note]);

  const submit = (start: boolean) => {
    if (!has) {
      if (!title.trim()) titleRef.current?.focus();
      return;
    }
    if (submitted.current) return;
    submitted.current = true;
    void onCreate(title, note, start, hasDeadline ? deadlineAt : null);
    onClose();
  };

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(!e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <div className="scrim scrim--capture" onClick={onClose} />
      <div className="capture" role="dialog" aria-modal="true" aria-label="New loop">
        <div className="term-bar">
          <span className="marker marker--running" aria-hidden="true" />
          <h2 id="capture-heading" className="term-bar__path">LOOP // NEW</h2>
          <span className="hdr__spacer" />
          <button type="button" className="term-bar__esc" onClick={onClose} aria-label="Cancel">
            ESC ✕
          </button>
        </div>

        <div className="capture__field capture__field--title">
          <label className="capture__label" htmlFor="capture-title">// WHAT ARE YOU STARTING?</label>
          <div className="capture__line">
          <span className="capture__prompt" aria-hidden="true">&gt;</span>
          <textarea
            id="capture-title"
            ref={titleRef}
            className="capture__title"
            rows={1}
            maxLength={140}
            placeholder="title"
            autoComplete="off"
            enterKeyHint="go"
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={onKey}
          />
          </div>
        </div>

        <div className="capture__field capture__field--note">
          <label className="capture__label" htmlFor="capture-note">// NOTE</label>
          <div className="capture__line">
          <span className="capture__prompt capture__prompt--note" aria-hidden="true">#</span>
          <textarea
            id="capture-note"
            ref={noteRef}
            className="capture__note"
            rows={2}
            maxLength={280}
            placeholder="where you left off, what’s next (optional)"
            autoComplete="off"
            enterKeyHint="go"
            value={note}
            onChange={(e) => setNote(e.target.value.replace(/\n/g, ' '))}
            onKeyDown={onKey}
          />
          </div>
        </div>

        <div className="capture__field capture__field--deadline">
          <span className="capture__label" id="capture-deadline-label">// DOES THIS HAVE A HARD EXTERNAL DEADLINE?</span>
          <div className="capture__deadline">
            <div className="capture__seg" role="radiogroup" aria-labelledby="capture-deadline-label">
              <button
                type="button"
                role="radio"
                aria-checked={!hasDeadline}
                className="capture__opt"
                onClick={() => {
                  setHasDeadline(false);
                  setDeadlineAt(null);
                }}
              >
                NO · IT AGES
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={hasDeadline}
                className="capture__opt"
                data-yes="true"
                onClick={() => setHasDeadline(true)}
              >
                YES · COUNT DOWN
              </button>
            </div>
            {hasDeadline && (
              <div className="capture__chips">
                {(
                  [
                    ['TODAY', 0],
                    ['TOMORROW', 1],
                    ['3 DAYS', 3],
                    ['NEXT WEEK', 7],
                  ] as const
                ).map(([label, days]) => (
                  <button key={label} type="button" className="capture__chip" onClick={() => setDeadlineAt(eveningIn(days))}>
                    {label}
                  </button>
                ))}
                <input
                  type="date"
                  className="capture__chip capture__date"
                  aria-label="Deadline date"
                  value={deadlineAt != null ? toDateInput(deadlineAt) : ''}
                  onChange={(e) => {
                    if (!e.target.value) return setDeadlineAt(null);
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    setDeadlineAt(new Date(y, m - 1, d, 17, 0).getTime());
                  }}
                />
              </div>
            )}
            {hasDeadline && (
              <span className={`capture__due${needsDate ? ' is-missing' : ''}`} role="status">
                {deadlineAt != null ? `DUE ${fmtDateLabel(deadlineAt)} 17:00` : 'PICK A DATE TO COUNT DOWN TO'}
              </span>
            )}
          </div>
        </div>

        <div className="capture__foot">
          <button type="button" className="capture__secondary" disabled={!has} onClick={() => submit(false)}>
            <kbd>[⇧⏎]</kbd> ADD WITHOUT STARTING
          </button>
          <button type="button" className="capture__start" disabled={!has} onClick={() => submit(true)}>
            <kbd>[⏎]</kbd> START
          </button>
        </div>
      </div>
    </>
  );
}

// ── Menu ─────────────────────────────────────────────────────────────────────

export function MenuPopover({
  anchor,
  onClose,
  children,
  label = 'Menu',
  compact = false,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Anchor under the trigger, flipping above it when there isn't room below.
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return setPos({ top: 40, right: 8 });
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 0;
      const below = r.bottom + 4;
      const top = below + h > window.innerHeight - 8 && r.top - h - 4 > 8 ? r.top - h - 4 : below;
      setPos({ top, right: Math.max(6, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  return (
    <>
      <div className="scrim" style={{ background: 'transparent' }} onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        ref={ref}
        className={`menu${compact ? ' menu--compact' : ''}`}
        role="menu"
        aria-label={label}
        style={{
          top: pos?.top ?? 0,
          right: pos?.right ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          maxHeight: `calc(100dvh - ${(pos?.top ?? 0) + 8}px)`,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
            anchor?.focus();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button') ?? []);
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            next?.focus();
          }
        }}
      >
        {children}
      </div>
    </>
  );
}

// ── Sort buttons ─────────────────────────────────────────────────────────────

export function SortButtons<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span role="group" aria-label={label} style={{ display: 'contents' }}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className="sortbtn"
          aria-pressed={value === v}
          onClick={(e) => {
            e.stopPropagation();
            onChange(v);
          }}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

export const RUN_SORTS = [
  ['longest', 'LONGEST'],
  ['shortest', 'SHORTEST'],
  ['alpha', 'A–Z'],
] as const;
export const TIMER_FILTERS = [
  ['all', 'ALL'],
  ['deadline', 'DEADLINES'],
  ['aging', 'AGING'],
] as const;
export const OPEN_SORTS = [
  ['oldest', 'OLDEST'],
  ['newest', 'NEWEST'],
  ['alpha', 'A–Z'],
] as const;
