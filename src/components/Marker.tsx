import type { Loop } from '../../shared/types';

/** 6×6 circular status marker. Priority (red) overrides running (lime) and open (ring). */
export function Marker({ loop }: { loop: Pick<Loop, 'priority' | 'state'> }) {
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
  return <span className={`marker marker--${kind}`} aria-hidden="true" data-marker={kind} />;
}
