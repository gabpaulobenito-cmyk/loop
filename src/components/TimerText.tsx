import { Fragment } from 'react';
import { fmtTimer, timerParts } from '../../shared/format';

/** Ticking timer with small dots between months, days and the clock. */
export function TimerText({ ms, className }: { ms: number; className?: string }) {
  const parts = timerParts(ms);
  return (
    <span className={className} aria-label={fmtTimer(ms)}>
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
