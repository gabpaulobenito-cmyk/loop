import { Fragment } from 'react';
import { fmtSpan, fmtTimer, spanParts, timerParts } from '../../shared/format';

/**
 * Timer with small dots between months, days and the clock. `coarse` stops at
 * the hour for list rows; without it the clock ticks down to the second.
 */
export function TimerText({ ms, className, coarse }: { ms: number; className?: string; coarse?: boolean }) {
  const parts = coarse ? spanParts(ms) : timerParts(ms);
  return (
    <span className={className} aria-label={coarse ? fmtSpan(ms) : fmtTimer(ms)}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className="tdot" aria-hidden="true">
              ·
            </span>
          )}
          {p}
        </Fragment>
      ))}
    </span>
  );
}
