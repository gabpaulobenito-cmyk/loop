import { useEffect, useState } from 'react';
import { dayGap, fmtDateLabel } from '../../shared/format';
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

/** Deadlines land at 17:00 local — the end of the working day the work is owed. */
const DUE_HOUR = 17;
/** 17:00 local, `days` days from today. */
function eveningIn(days: number, now: number) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, DUE_HOUR, 0).getTime();
}
const eveningOn = (dayStart: number) => {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DUE_HOUR, 0).getTime();
};

function deadlineStatus(at: number, now: number): string {
  const days = dayGap(now, at);
  const date = fmtDateLabel(at);
  if (at <= now) {
    if (days === 0) return `OVERDUE SINCE TODAY · ${date}`;
    return `OVERDUE · ${-days} DAY${days === -1 ? '' : 'S'} PAST`;
  }
  if (days === 0) return `TODAY · ${date}`;
  if (days === 1) return `TOMORROW · ${date}`;
  return `${date} · IN ${days} DAYS`;
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
              ? 'PICK THE DATE IT IS DUE'
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
              <button key={label} type="button" className="dlp__chip" onClick={() => pick(eveningIn(days, now))}>
                {label}
              </button>
            ))}
            <button
              type="button"
              className="dlp__chip dlp__datebtn"
              aria-expanded={calOpen}
              aria-label={loop.deadlineAt != null ? `Deadline ${fmtDateLabel(loop.deadlineAt)} — pick another date` : 'Pick a deadline date'}
              onClick={() => setCalOpen((v) => !v)}
            >
              {loop.deadlineAt != null ? fmtDateLabel(loop.deadlineAt) : 'PICK A DATE'}
              <span className="dlp__caret" aria-hidden="true">{calOpen ? '▴' : '▾'}</span>
            </button>
          </div>
          {calOpen && (
            <DatePopup
              title="LOOP // DEADLINE"
              value={loop.deadlineAt}
              now={now}
              onPick={(day) => pick(eveningOn(day))}
              onClose={() => setCalOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
