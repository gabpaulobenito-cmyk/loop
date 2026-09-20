import { useEffect, useMemo, useState } from 'react';

interface Props {
  /** The selected day, or null when nothing is picked yet. */
  value: number | null;
  now: number;
  /** Receives local midnight of the chosen day; the caller decides the time of day. */
  onPick: (dayStart: number) => void;
  /** Latest selectable day (any time within it), or null for no limit. */
  max?: number | null;
  /** Earliest selectable day (any time within it), or null for no limit. */
  min?: number | null;
  label?: string;
  className?: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const startOfMonth = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/**
 * Month grid in LOOP's own style — square cells, mono digits, lime selection.
 * The browser's native date picker is a light system panel that breaks the
 * terminal look wherever it opens, so every date in the app comes through here.
 */
export function Calendar({ value, now, onPick, max = null, min = null, label = 'Choose a date', className }: Props) {
  const [view, setView] = useState(() => startOfMonth(value ?? now));

  // Follow the selection when it moves from outside (a chip, another loop).
  useEffect(() => {
    if (value != null) setView(startOfMonth(value));
  }, [value]);

  const cells = useMemo(() => {
    const first = new Date(view);
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view]);

  const viewMonth = new Date(view).getMonth();
  const selectedDay = value == null ? null : startOfDay(value);
  const today = startOfDay(now);
  const maxDay = max == null ? null : startOfDay(max);
  const minDay = min == null ? null : startOfDay(min);

  const prevMonth = new Date(new Date(view).getFullYear(), viewMonth - 1, 1).getTime();
  const nextMonth = new Date(new Date(view).getFullYear(), viewMonth + 1, 1).getTime();
  // The step is dead when every day it would reach is out of bounds.
  const prevBlocked = minDay != null && new Date(new Date(view).getFullYear(), viewMonth, 0).getTime() < minDay;
  const nextBlocked = maxDay != null && nextMonth > maxDay;

  return (
    <div className={`cal${className ? ` ${className}` : ''}`}>
      <div className="cal__nav">
        <button
          type="button"
          className="cal__step"
          aria-label="Previous month"
          disabled={prevBlocked}
          onClick={() => setView(prevMonth)}
        >
          ‹
        </button>
        <span className="cal__month" aria-live="polite">
          {MONTHS[viewMonth]} {new Date(view).getFullYear()}
        </span>
        <button
          type="button"
          className="cal__step"
          aria-label="Next month"
          disabled={nextBlocked}
          onClick={() => setView(nextMonth)}
        >
          ›
        </button>
      </div>
      <div className="cal__grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="cal__dow" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const day = d.getTime();
          const outside = d.getMonth() !== viewMonth;
          const blocked = (maxDay != null && day > maxDay) || (minDay != null && day < minDay);
          const selected = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              className={`cal__day${outside ? ' is-outside' : ''}${selected ? ' is-selected' : ''}${day === today ? ' is-today' : ''}`}
              disabled={blocked}
              aria-selected={selected}
              aria-label={d.toDateString()}
              onClick={() => {
                onPick(day);
                if (outside) setView(startOfMonth(day));
              }}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
