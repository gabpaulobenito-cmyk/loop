import { useMemo, useState } from 'react';
import { fmtAge, fmtClock, fmtDay, fmtTimer, pad2 } from '../../shared/format';
import type { Loop, Session } from '../../shared/types';

interface Props {
  loop: Loop;
  sessions: Session[] | null;
  now: number;
  onSave: (at: number) => void;
  onCancel: () => void;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MIN = 60_000;
const HOUR = 60 * MIN;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const toTime = (t: number) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const combine = (day: Date, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).getTime();
};

/**
 * Calendar + time picker for when a loop really started.
 * Running loops move their current session start; others move when they were opened.
 */
export function StartEditor({ loop, sessions, now, onSave, onCancel }: Props) {
  const running = loop.state === 'running';
  const initial = running ? loop.runningSince! : loop.createdAt;
  const [day, setDay] = useState(() => new Date(initial));
  const [time, setTime] = useState(() => toTime(initial));
  const [view, setView] = useState(() => new Date(new Date(initial).getFullYear(), new Date(initial).getMonth(), 1));

  // Limits from the loop's own history, checked locally before saving.
  const { floor, ceiling } = useMemo(() => {
    const list = sessions ?? [];
    if (running) {
      const ended = list.filter((s) => s.endedAt != null).map((s) => s.endedAt!);
      return { floor: ended.length ? Math.max(...ended) : null, ceiling: null as number | null };
    }
    const firstStart = list.length ? Math.min(...list.map((s) => s.startedAt)) : null;
    const limits = [firstStart, loop.closedAt].filter((x): x is number => x != null);
    return { floor: null as number | null, ceiling: limits.length ? Math.min(...limits) : null };
  }, [sessions, running, loop.closedAt]);

  const value = combine(day, time);
  const error =
    value > now + MIN
      ? 'Can’t be in the future'
      : floor != null && value < floor
        ? `Must be after the previous session ended (${fmtDay(floor, now)} ${fmtClock(floor)})`
        : ceiling != null && value > ceiling
          ? `Must be before its first session (${fmtDay(ceiling, now)} ${fmtClock(ceiling)})`
          : null;

  const preview = running
    ? `TIMER → ${fmtTimer(loop.accumulatedMs + Math.max(0, now - value))}`
    : `OPEN FOR → ${fmtAge(Math.max(0, now - value))}`;

  const save = () => {
    if (!error) onSave(Math.min(value, now));
  };

  const setFrom = (t: number) => {
    const d = new Date(t);
    setDay(d);
    setTime(toTime(t));
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  // Month grid, padded to whole weeks.
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view]);
  const today = new Date(now);
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const nextMonth = new Date(view.getFullYear(), view.getMonth() + 1, 1);

  const presets: [string, number][] = [
    ['15M AGO', now - 15 * MIN],
    ['1H AGO', now - HOUR],
    ['3H AGO', now - 3 * HOUR],
    ['YESTERDAY', now - 24 * HOUR],
  ];

  return (
    <div
      className="start-edit"
      role="group"
      aria-label={running ? 'Edit when this session started' : 'Edit when this loop was opened'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="start-edit__head">
        <span className="start-edit__label">// {running ? 'SESSION STARTED' : 'OPENED'}</span>
        <span className="start-edit__value">
          {fmtDay(value, now)} {fmtClock(value)}
        </span>
      </div>

      <div className="start-edit__presets">
        {presets.map(([label, t]) => (
          <button key={label} type="button" className="start-edit__chip" onClick={() => setFrom(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="cal">
        <div className="cal__nav">
          <button
            type="button"
            className="cal__step"
            aria-label="Previous month"
            onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <span className="cal__month" aria-live="polite">
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <button
            type="button"
            className="cal__step"
            aria-label="Next month"
            disabled={nextMonth.getTime() >= endOfToday}
            onClick={() => setView(nextMonth)}
          >
            ›
          </button>
        </div>
        <div className="cal__grid" role="grid" aria-label="Choose a date">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="cal__dow" aria-hidden="true">
              {w}
            </span>
          ))}
          {cells.map((d) => {
            const outside = d.getMonth() !== view.getMonth();
            const future = d.getTime() >= endOfToday;
            const selected = dayKey(d) === dayKey(day);
            const isToday = dayKey(d) === dayKey(today);
            return (
              <button
                key={d.getTime()}
                type="button"
                role="gridcell"
                className={`cal__day${outside ? ' is-outside' : ''}${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                disabled={future}
                aria-selected={selected}
                aria-label={d.toDateString()}
                onClick={() => {
                  setDay(d);
                  if (outside) setView(new Date(d.getFullYear(), d.getMonth(), 1));
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="start-edit__time">
        <label className="start-edit__label" htmlFor="start-time">
          // TIME
        </label>
        <input
          id="start-time"
          type="time"
          step={60}
          value={time}
          onChange={(e) => e.target.value && setTime(e.target.value)}
        />
        <span className={`start-edit__preview${error ? ' is-error' : ''}`} role={error ? 'alert' : undefined}>
          {error ?? preview}
        </span>
      </div>

      <div className="start-edit__foot">
        <button type="button" className="start-edit__cancel" onClick={onCancel}>
          [ESC] CANCEL
        </button>
        <button type="button" className="start-edit__save" onClick={save} disabled={!!error}>
          [⏎] SAVE START
        </button>
      </div>
    </div>
  );
}
