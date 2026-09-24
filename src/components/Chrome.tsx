import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { atMinutes, fmtDateLabel, fmtHeaderClock, fmtMinutes, minutesOfDay, pad2 } from '../../shared/format';
import type { Scope, ScopeView } from '../../shared/types';
import { FITS } from '../lib/greeting';
import { useGreeting } from '../hooks/useGreeting';
import { useMedia } from '../hooks/useMedia';
import type { Mode } from '../hooks/useViewport';
import { DatePopup } from './DatePopup';

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

// ── Scope switch ─────────────────────────────────────────────────────────────

export interface ScopeCounts {
  work: number;
  personal: number;
  /** Deadlines in their last day, or already past, per scope. */
  fire: { work: number; personal: number };
}

export const SCOPE_ORDER: readonly ScopeView[] = ['work', 'personal', 'all'] as const;
// `BOTH`, not `ALL`: the view bar's own filters already offer two ALLs, and this
// one is not "every loop" — it is the deliberate look across both worlds at once.
const SCOPE_LABEL: Record<ScopeView, string> = { work: 'WORK', personal: 'PERSONAL', all: 'BOTH' };
const SCOPE_SHORT: Record<ScopeView, string> = { work: 'WORK', personal: 'PERS', all: 'BOTH' };
export const SCOPE_OPTIONS = [
  ['work', 'WORK'],
  ['personal', 'PERSONAL'],
  ['all', 'BOTH'],
] as const;

const scopeCount = (c: ScopeCounts, v: ScopeView) => (v === 'all' ? c.work + c.personal : c[v]);
/** Fire-tier loops you would not see from `v` — the reason to look away from it. */
const unseenFire = (c: ScopeCounts, v: ScopeView) =>
  v === 'work' ? c.fire.personal : v === 'personal' ? c.fire.work : 0;

interface ScopeSwitchProps {
  value: ScopeView;
  counts: ScopeCounts;
  onChange: (v: ScopeView) => void;
  /** `full` is the three-segment control; `mini` is the one-button cycle for narrow bars. */
  variant?: 'full' | 'mini';
}

/**
 * Which world the workspace is in. Not a filter: it also decides what a new loop
 * is born into, so it stays visible at every width. Whichever scope you are not
 * looking at still reports its own fire-tier count, so a personal deadline can
 * never go red unseen behind the work list.
 */
export function ScopeSwitch({ value, counts, onChange, variant = 'full' }: ScopeSwitchProps) {
  if (variant === 'mini') {
    const next = SCOPE_ORDER[(SCOPE_ORDER.indexOf(value) + 1) % SCOPE_ORDER.length];
    const fire = unseenFire(counts, value);
    return (
      <button
        type="button"
        className="scope scope--mini"
        data-scope={value}
        title={`Showing ${SCOPE_LABEL[value]} — switch to ${SCOPE_LABEL[next]} (W)`}
        aria-label={`Scope ${SCOPE_LABEL[value]}. Switch to ${SCOPE_LABEL[next]}`}
        onClick={() => onChange(next)}
      >
        {SCOPE_SHORT[value]}
        <span className="scope__n">{pad2(scopeCount(counts, value))}</span>
        {fire > 0 && (
          <span className="scope__fire" title={`${fire} due in the other scope`}>
            {fire}
          </span>
        )}
      </button>
    );
  }
  return (
    <span className="scope" role="group" aria-label="Work or personal">
      {SCOPE_ORDER.map((v) => {
        // The badge means "you cannot see this from where you are", so it is
        // silent on the scope you are in — and on every scope while in BOTH.
        const fire = value === 'all' || v === value || v === 'all' ? 0 : counts.fire[v];
        return (
          <button
            key={v}
            type="button"
            className="scope__opt"
            data-scope={v}
            aria-pressed={value === v}
            title={v === 'all' ? 'Both worlds at once — new loops land in work (W)' : `Show ${SCOPE_LABEL[v]} — new loops land here (W)`}
            onClick={() => onChange(v)}
          >
            {SCOPE_LABEL[v]}
            <span className="scope__n">{pad2(scopeCount(counts, v))}</span>
            {fire > 0 && (
              <span className="scope__fire" title={`${fire} due here`}>
                {fire}
              </span>
            )}
          </button>
        );
      })}
    </span>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

interface HeaderProps {
  mode: Mode;
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

export function Header({ mode, anyRunning, search, onNew, menuOpen, onMenu, menuButtonRef, now, onSearch }: HeaderProps) {
  // The greeting takes whatever the clock, search and buttons leave: the whole
  // line where there is room, the name dropped where there isn't, and only the
  // shortest lines on the rail. Phones get the whole line too — they show no
  // clock here, because iOS and Android are already showing one just above.
  const rail = mode === 'rail';
  const phone = mode === 'mobile';
  const roomy = useMedia('(min-width: 900px)') && !rail && !phone;
  const greeting = useGreeting(now, rail ? FITS.rail : roomy ? FITS.full : FITS.phone);
  const line = rail ? greeting.short : roomy || phone ? greeting.full : greeting.short;
  // The workspace belongs to one person, so it says hello instead of stating its
  // own name. The dot still carries the only status the header needs: is anything running.
  const brand = (
    <span className="hdr__brand">
      <span className={`marker ${anyRunning ? 'marker--running' : 'marker--open'}`} aria-hidden="true" />
      <h1 className="hdr__greet" style={{ margin: 0 }} title={greeting.full}>
        {line}
      </h1>
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
  if (mode === 'rail') {
    return (
      <header className="hdr hdr--rail">
        {brand}
        <span className="hdr__spacer" />
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
        <span className="hdr__spacer" />
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

// ── New loop pop-up ──────────────────────────────────────────────────────────

interface CaptureDialogProps {
  onClose: () => void;
  /** The world the workspace is in; `all` has no side to pick, so capture defaults to work. */
  scope: ScopeView;
  onCreate: (title: string, note: string, start: boolean, deadlineAt: number | null, scope: Scope) => Promise<unknown>;
}

/** A deadline with no hour named lands at 17:00 — end of the working day it is due. */
const DUE_MINUTES = 17 * 60;
/** `days` days from today, at `minutes` past midnight. */
function dueIn(days: number, minutes: number, now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, minutes).getTime();
}

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
export function CaptureDialog({ onClose, scope, onCreate }: CaptureDialogProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  // Pre-set from the scope you are in, so the common case needs no decision.
  const [into, setInto] = useState<Scope>(scope === 'personal' ? 'personal' : 'work');
  // A deadline is opt-in: most loops age, only some are owed to someone by a date.
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  // Moving the day keeps the hour already chosen; 17:00 until one is.
  const dueMinutes = deadlineAt != null ? minutesOfDay(deadlineAt) : DUE_MINUTES;
  const [calOpen, setCalOpen] = useState(false);
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
    void onCreate(title, note, start, hasDeadline ? deadlineAt : null, into);
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
          <span className="capture__scope" role="group" aria-label="Work or personal">
            {(['work', 'personal'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="capture__scopeopt"
                data-scope={v}
                aria-pressed={into === v}
                onClick={() => setInto(v)}
              >
                {v === 'work' ? 'WORK' : 'PERSONAL'}
              </button>
            ))}
          </span>
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
                  setCalOpen(false);
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
                onClick={() => {
                  setHasDeadline(true);
                  // Saying yes means picking the date, so the calendar is already there.
                  if (deadlineAt == null) setCalOpen(true);
                }}
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
                  <button
                    key={label}
                    type="button"
                    className="capture__chip"
                    onClick={() => {
                      setDeadlineAt(dueIn(days, dueMinutes));
                      setCalOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="capture__chip capture__datebtn"
                  aria-expanded={calOpen}
                  aria-label={
                    deadlineAt != null
                      ? `Deadline ${fmtDateLabel(deadlineAt)} ${fmtMinutes(dueMinutes)} — pick another date or time`
                      : 'Pick a deadline date and time'
                  }
                  onClick={() => setCalOpen((v) => !v)}
                >
                  {deadlineAt != null ? `${fmtDateLabel(deadlineAt)} · ${fmtMinutes(dueMinutes)}` : 'PICK A DATE'}
                  <span className="capture__caret" aria-hidden="true">{calOpen ? '▴' : '▾'}</span>
                </button>
              </div>
            )}
            {hasDeadline && calOpen && (
              <DatePopup
                title="LOOP // DEADLINE"
                value={deadlineAt}
                now={Date.now()}
                withTime
                defaultMinutes={DUE_MINUTES}
                onPick={(day, minutes) => {
                  setDeadlineAt(atMinutes(day, minutes));
                  setCalOpen(false);
                }}
                onTimeChange={(minutes) => setDeadlineAt((at) => (at == null ? at : atMinutes(at, minutes)))}
                onClose={() => setCalOpen(false)}
              />
            )}
            {hasDeadline && (
              <span className={`capture__due${needsDate ? ' is-missing' : ''}`} role="status">
                {deadlineAt != null
                  ? `DUE ${fmtDateLabel(deadlineAt)} ${fmtMinutes(dueMinutes)}`
                  : 'PICK A DATE TO COUNT DOWN TO'}
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
