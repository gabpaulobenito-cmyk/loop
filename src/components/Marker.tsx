import type { DeadlineTier } from '../../shared/timer';
import type { Loop } from '../../shared/types';

interface Props {
  loop: Pick<Loop, 'priority' | 'state'>;
  /** Countdown tier, when the loop has a deadline. */
  tier?: DeadlineTier;
  /** Neglect step for an ageing loop: 0 under two weeks, 1 to a month, 2 beyond. */
  mark?: 0 | 1 | 2;
}

/**
 * 6×6 circular status marker. Priority (red) overrides running (lime) and open
 * (ring). An open loop's ring shifts once at two weeks and again at a month, and
 * an open countdown loop's ring takes its deadline tier — a glance, not an alarm.
 */
export function Marker({ loop, tier = 'none', mark = 0 }: Props) {
  if (loop.state === 'closed') {
    return (
      <span className="marker marker--closed" aria-hidden="true">
        ✕
      </span>
    );
  }
  const kind = loop.priority ? 'priority' : loop.state;
  if (kind === 'priority') {
    return <span className="marker marker--priority" role="img" aria-label="Priority" title="Priority" data-marker={kind} />;
  }
  return (
    <span
      className={`marker marker--${kind}`}
      aria-hidden="true"
      data-marker={kind}
      data-tier={tier !== 'none' ? tier : undefined}
      data-mark={kind === 'open' && tier === 'none' ? mark : undefined}
    />
  );
}
