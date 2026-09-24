import { useEffect, useState } from 'react';
import { atMinutes, dayGap, fmtDateLabel, fmtMinutes, minutesOfDay } from '../../shared/format';
import { deadlineTier, remainingMs } from '../../shared/timer';
import type { Loop } from '../../shared/types';
import { Countdown } from './Countdown';
import { DatePopup } from './DatePopup';

interface Props {
  loop: Loop;
  now: number;
  onSet: (deadlineAt: number) => void;
  onDrop: () => void;
}

/** A deadline with no hour named lands at 17:00 local — the end of the working day. */
const DUE_MINUTES = 17 * 60;
/** `days` days from today, at `minutes` past midnight. */
function dueIn(days: number, minutes: number, now: number) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, minutes).getTime();
}

function deadlineStatus(at: number, now: number): string {
  const days = dayGap(now, at);
  const when = `${fmtDateLabel(at)} · ${fmtMinutes(minutesOfDay(at))}`;
  if (at <= now) {
    if (days === 0) return `OVERDUE SINCE TODAY · ${when}`;
    return `OVERDUE · ${-days} DAY${days === -1 ? '' : 'S'} PAST · ${when}`;
  }
  if (days === 0) return `TODAY · ${when}`;
  if (days === 1) return `TOMORROW · ${when}`;
  return `${when} · IN ${days} DAYS`;
}

/**
 * Which clock this loop reads. Handing an ageing loop a date is one click —
 * soft work acquires real dates all the time. Letting a deadline go is not:
 * it takes a second, deliberate click saying the date no longer applies, so
 * the only way to lose a real commitment is to mean it.
 */
export function DeadlinePanel({ loop, now, onSet, onDrop }: Props) {
  const countdown = loop.timerType === 'countdown';
  const [picking, setPicking] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);

  useEffect(() => {
    setPicking(false);
    setCalOpen(false);
    setConfirmDrop(false);
  }, [loop.id]);
  useEffect(() => {
    if (countdown) setPicking(false);
    else {
      setConfirmDrop(false);
      setCalOpen(false);
    }
  }, [countdown]);
  useEffect(() => {
    if (!confirmDrop) return;
    const t = setTimeout(() => setConfirmDrop(false), 8000);
    return () => clearTimeout(t);
  }, [confirmDrop]);

  const tier = deadlineTier(loop, now);
  // Moving the day keeps the hour this loop is already owed by.
  const dueMinutes = loop.deadlineAt != null ? minutesOfDay(loop.deadlineAt) : DUE_MINUTES;
  const left = remainingMs(loop, now);
  const showChips = countdown || picking;

  const pick = (at: number) => {
    setCalOpen(false);
    onSet(at);
  };

  return (
    <div className="dlp" role="group" aria-label="Timer" data-tier={tier}>
      <div className="dlp__head">
        <span className="dlp__label">// TIMER</span>
        {countdown && loop.state !== 'closed' && left != null && <Countdown loop={loop} now={now} />}
      </div>

      <div className="dlp__seg" role="radiogroup" aria-label="Timer type">
        <button
          type="button"
          role="radio"
          aria-checked={!countdown}
          className="dlp__opt"
          data-type="elapsed"
          title="Counts up from when this loop was opened"
          onClick={() => {
            if (!countdown) {
              setPicking(false);
              setCalOpen(false);
              return;
            }
            setConfirmDrop(true);
          }}
        >
          AGING
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={countdown}
          className="dlp__opt"
          data-type="countdown"
          title="Counts down to a hard external deadline"
          onClick={() => {
            setConfirmDrop(false);
            if (countdown) return;
            // Asking for a deadline means asking which date: open the calendar with it.
            setPicking(true);
            setCalOpen(true);
          }}
        >
          DEADLINE
        </button>
      </div>

      {confirmDrop && (
        <div className="dlp__confirm" role="alert">
          <span className="dlp__confirmtext">THIS DEADLINE NO LONGER APPLIES?</span>
          <button
            type="button"
            className="dlp__chip dlp__chip--danger"
            onClick={() => {
              setConfirmDrop(false);
              onDrop();
            }}
          >
            DROP IT
          </button>
          <button type="button" className="dlp__chip" onClick={() => setConfirmDrop(false)}>
            KEEP
          </button>
        </div>
      )}

      <div className="dlp__row">
        <span className="dlp__label dlp__label--inline">{countdown || picking ? 'DUE' : 'AGE'}</span>
        <span className={`dlp__status${tier === 'urgent' || tier === 'overdue' ? ' is-hot' : ''}`} role="status">
          {countdown && loop.deadlineAt != null
            ? deadlineStatus(loop.deadlineAt, now)
            : picking
              ? 'PICK THE DATE AND TIME IT IS DUE'
              : 'NO DEADLINE — COUNTS UP FROM WHEN IT OPENED'}
        </span>
      </div>

      {showChips && (
        <>
          <div className="dlp__chips">
            {(
              [
                ['TODAY', 0],
                ['TOMORROW', 1],
                ['3 DAYS', 3],
                ['NEXT WEEK', 7],
              ] as const
            ).map(([label, days]) => (
              <button key={label} type="button" className="dlp__chip" onClick={() => pick(dueIn(days, dueMinutes, now))}>
                {label}
              </button>
            ))}
            <button
              type="button"
              className="dlp__chip dlp__datebtn"
              aria-expanded={calOpen}
              aria-label={
                loop.deadlineAt != null
                  ? `Deadline ${fmtDateLabel(loop.deadlineAt)} ${fmtMinutes(dueMinutes)} — pick another date or time`
                  : 'Pick a deadline date and time'
              }
              onClick={() => setCalOpen((v) => !v)}
            >
              {loop.deadlineAt != null ? `${fmtDateLabel(loop.deadlineAt)} · ${fmtMinutes(dueMinutes)}` : 'PICK A DATE'}
              <span className="dlp__caret" aria-hidden="true">{calOpen ? '▴' : '▾'}</span>
            </button>
          </div>
          {calOpen && (
            <DatePopup
              title="LOOP // DEADLINE"
              value={loop.deadlineAt}
              now={now}
              withTime
              defaultMinutes={DUE_MINUTES}
              onPick={(day, minutes) => pick(atMinutes(day, minutes))}
              onTimeChange={(minutes) => {
                if (loop.deadlineAt != null) onSet(atMinutes(loop.deadlineAt, minutes));
              }}
              onClose={() => setCalOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
