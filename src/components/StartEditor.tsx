import { useMemo, useState } from 'react';
import { fmtAge, fmtClock, fmtDay, fmtTimer, pad2 } from '../../shared/format';
import type { Loop, Session } from '../../shared/types';
import { Calendar } from './Calendar';

interface Props {
  loop: Loop;
  sessions: Session[] | null;
  now: number;
  onSave: (at: number, predictedAccumulatedMs?: number) => void;
  onCancel: () => void;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

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

  // Open/closed loops can't start after their first session or their close.
  const ceiling = useMemo(() => {
    if (running) return null;
    const list = sessions ?? [];
    const firstStart = list.length ? Math.min(...list.map((s) => s.startedAt)) : null;
    const limits = [firstStart, loop.closedAt].filter((x): x is number => x != null);
    return limits.length ? Math.min(...limits) : null;
  }, [sessions, running, loop.closedAt]);

  const value = combine(day, time);

  // Running loops: earlier sessions after the new start merge into the running one.
  const merge = useMemo(() => {
    if (!running || !sessions) return { count: 0, kept: loop.accumulatedMs };
    let count = 0;
    let kept = 0;
    for (const s of sessions) {
      if (s.endedAt == null) continue;
      if (s.endedAt > value) count++;
      kept += Math.max(0, Math.min(s.endedAt, value) - s.startedAt);
    }
    return { count, kept };
  }, [running, sessions, value, loop.accumulatedMs]);

  const error =
    value > now + MIN
      ? 'Can’t be in the future'
      : ceiling != null && value > ceiling
        ? `Must be on or before its first session (${fmtDay(ceiling, now)} ${fmtClock(ceiling)})`
        : null;

  const preview = running
    ? `TIMER → ${fmtTimer(merge.kept + Math.max(0, now - value))}`
    : `OPEN FOR → ${fmtAge(Math.max(0, now - value))}`;
  const mergeNote =
    running && merge.count > 0 ? `Merges ${merge.count} earlier session${merge.count === 1 ? '' : 's'} into this one` : null;

  const save = () => {
    if (!error) onSave(Math.min(value, now), running ? merge.kept : undefined);
  };

  const setFrom = (t: number) => {
    setDay(new Date(t));
    setTime(toTime(t));
  };

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

      <Calendar
        value={day.getTime()}
        now={now}
        max={now}
        onPick={(d) => setDay(new Date(d))}
      />

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
        <span className="start-edit__preview">{preview}</span>
      </div>
      {(error || mergeNote) && (
        <div className={`start-edit__notice${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
          {error ? `! ${error}` : `↳ ${mergeNote}`}
        </div>
      )}

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
