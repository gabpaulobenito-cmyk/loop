import { fmtClock, fmtDateLabel } from '../../shared/format';
import { deadlineTier, remainingMs } from '../../shared/timer';
import type { Loop } from '../../shared/types';
import { TimerText } from './TimerText';

/**
 * A countdown loop's clock: time left before its deadline, or — once that date
 * has passed — how long it has been missed, counting up. The tier drives the
 * colour, from neutral a week out to red inside a day.
 */
export function Countdown({ loop, now, className }: { loop: Loop; now: number; className?: string }) {
  const left = remainingMs(loop, now);
  if (left == null) return null;
  const over = left <= 0;
  const when = `${fmtDateLabel(loop.deadlineAt!)} ${fmtClock(loop.deadlineAt!)}`;
  return (
    <span
      className={`dl${className ? ` ${className}` : ''}`}
      data-tier={deadlineTier(loop, now)}
      title={over ? `Deadline passed — was due ${when}` : `Due ${when}`}
    >
      <span className="dl__label">{over ? 'OVER' : 'DUE'}</span>
      <TimerText ms={Math.abs(left)} />
    </span>
  );
}
