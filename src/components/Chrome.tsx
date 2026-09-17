import { forwardRef, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { pad2 } from '../../shared/format';
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
}

export function Header({ mode, runCount, openCount, anyRunning, search, onNew, menuOpen, onMenu, menuButtonRef }: HeaderProps) {
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
        <button type="button" className="btn-new hit" title={`NEW LOOP — ${MOD}N`} onClick={onNew}>
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

// ── Quick capture dialog (rail / mobile) ─────────────────────────────────────

interface CaptureDialogProps {
  onClose: () => void;
  onCreate: (title: string, note: string, start: boolean) => Promise<unknown>;
}

export function CaptureDialog({ onClose, onCreate }: CaptureDialogProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const has = title.trim().length > 0;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const submit = (start: boolean) => {
    if (!has) {
      titleRef.current?.focus();
      return;
    }
    void onCreate(title, note, start);
    onClose();
  };
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="capture" role="dialog" aria-modal="true" aria-label="New loop">
        <div className="capture__row">
          <span className="capture__prompt" aria-hidden="true">&gt;</span>
          <input
            ref={titleRef}
            type="text"
            aria-label="Loop title"
            placeholder="What are you starting?"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKey}
          />
          <button type="button" className="capture__esc" onClick={onClose} aria-label="Cancel">ESC</button>
        </div>
        <div className="capture__noterow">
          <span className="capture__noteprompt" aria-hidden="true">·</span>
          <input
            type="text"
            aria-label="Context note (optional)"
            placeholder="Context note (optional)"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="capture__acts">
          <button type="button" className="capture__act" disabled={!has} onClick={() => submit(false)}>
            CREATE OPEN<kbd>⏎</kbd>
          </button>
          <button type="button" className="capture__act capture__act--start" disabled={!has} onClick={() => submit(true)}>
            CREATE + START<kbd>⇧⏎</kbd>
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
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 40, right: 8 });

  useEffect(() => {
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(6, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener('resize', place);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  return (
    <>
      <div className="scrim" style={{ background: 'transparent' }} onClick={onClose} />
      <div
        ref={ref}
        className="menu"
        role="menu"
        style={{ top: pos.top, right: pos.right, maxHeight: `calc(100dvh - ${pos.top + 8}px)`, overflowY: 'auto' }}
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
export const OPEN_SORTS = [
  ['oldest', 'OLDEST'],
  ['newest', 'NEWEST'],
  ['alpha', 'A–Z'],
] as const;
