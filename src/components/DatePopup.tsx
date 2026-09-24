import { useEffect, useRef, useState } from 'react';
import { fmtDateLabel, fmtMinutes, minutesOfDay, parseClock } from '../../shared/format';
import { Calendar } from './Calendar';

interface Props {
  title: string;
  value: number | null;
  now: number;
  max?: number | null;
  min?: number | null;
  /** Show the time row — the day this returns carries the time chosen there. */
  withTime?: boolean;
  /** Time of day to start from, in minutes past midnight, when nothing is set. */
  defaultMinutes?: number;
  /** Receives local midnight of the chosen day and the time of day in minutes. */
  onPick: (dayStart: number, minutes: number) => void;
  /** The time moved while a day is already set; the calendar stays open. */
  onTimeChange?: (minutes: number) => void;
  onClose: () => void;
}

/** The hours work is actually owed by — morning, midday, end of day, midnight. */
const PRESETS: [string, number][] = [
  ['09:00', 9 * 60],
  ['12:00', 12 * 60],
  ['17:00', 17 * 60],
  ['23:59', 23 * 60 + 59],
];

/**
 * The time of day the date carries. A date alone says "some time that day",
 * which is fine for a follow-up and wrong for a deadline that lands at 09:00 —
 * so the clock is editable here, next to the day it belongs to.
 */
function TimeRow({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const [draft, setDraft] = useState(() => fmtMinutes(minutes));

  // Follow the value when it moves from outside (a preset, another day).
  useEffect(() => setDraft(fmtMinutes(minutes)), [minutes]);

  const commit = () => {
    const m = parseClock(draft);
    if (m == null || m === minutes) setDraft(fmtMinutes(minutes));
    else onChange(m);
  };

  const bad = parseClock(draft) == null;

  return (
    <div className="datepop__time">
      <label className="datepop__timelabel" htmlFor="datepop-time">
        TIME
      </label>
      <input
        id="datepop-time"
        className={`datepop__timein${bad ? ' is-bad' : ''}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        maxLength={7}
        aria-label="Time of day"
        aria-invalid={bad}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // The calendar owns Escape; inside the field it only takes the edit back.
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(fmtMinutes(minutes));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="datepop__presets">
        {PRESETS.map(([label, m]) => (
          <button
            key={label}
            type="button"
            className="datepop__preset"
            aria-pressed={m === minutes}
            onClick={() => onChange(m)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The calendar, centered over the workspace the way every other LOOP pop-up
 * sits. Inline it would be clipped in a short window or a docked column; here
 * it always fits, and picking a day closes it.
 */
export function DatePopup({
  title,
  value,
  now,
  max = null,
  min = null,
  withTime = false,
  defaultMinutes = 0,
  onPick,
  onTimeChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [minutes, setMinutes] = useState(() => (value != null ? minutesOfDay(value) : defaultMinutes));

  useEffect(() => {
    if (value != null) setMinutes(minutesOfDay(value));
  }, [value]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.cal__day.is-selected, .cal__day.is-today, .cal__day')?.focus();
    return () => prev?.focus?.();
  }, []);

  // A day already set takes the new time right away; otherwise it is held for
  // the day that gets picked next.
  const changeTime = (m: number) => {
    setMinutes(m);
    if (value != null) onTimeChange?.(m);
  };

  return (
    <>
      <div className="scrim scrim--date" onClick={onClose} />
      <div
        ref={ref}
        className="datepop"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // The details pop-up and the workspace both listen for keys; while this is
        // open it owns them, so Escape closes the calendar and nothing behind it.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="term-bar">
          <span className="term-bar__path">{title}</span>
          <span className="hdr__spacer" />
          <span className="datepop__value">
            {value != null ? `${fmtDateLabel(value)}${withTime ? ` · ${fmtMinutes(minutes)}` : ''}` : 'NOT SET'}
          </span>
          <button type="button" className="term-bar__esc" aria-label="Close calendar" onClick={onClose}>
            ESC ✕
          </button>
        </div>
        <Calendar value={value} now={now} max={max} min={min} onPick={(day) => onPick(day, minutes)} />
        {withTime && <TimeRow minutes={minutes} onChange={changeTime} />}
      </div>
    </>
  );
}
