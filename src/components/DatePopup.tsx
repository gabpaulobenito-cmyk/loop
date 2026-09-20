import { useEffect, useRef } from 'react';
import { fmtDateLabel } from '../../shared/format';
import { Calendar } from './Calendar';

interface Props {
  title: string;
  value: number | null;
  now: number;
  max?: number | null;
  min?: number | null;
  /** Receives local midnight of the chosen day; the caller sets the time of day. */
  onPick: (dayStart: number) => void;
  onClose: () => void;
}

/**
 * The calendar, centered over the workspace the way every other LOOP pop-up
 * sits. Inline it would be clipped in a short window or a docked column; here
 * it always fits, and picking a day closes it.
 */
export function DatePopup({ title, value, now, max = null, min = null, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.cal__day.is-selected, .cal__day.is-today, .cal__day')?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <>
      <div className="scrim scrim--date" onClick={onClose} />
      <div
        ref={ref}
        className="datepop"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // The details pop-up and the workspace both listen for keys; while this is
        // open it owns them, so Escape closes the calendar and nothing behind it.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="term-bar">
          <span className="term-bar__path">{title}</span>
          <span className="hdr__spacer" />
          <span className="datepop__value">{value != null ? fmtDateLabel(value) : 'NOT SET'}</span>
          <button type="button" className="term-bar__esc" aria-label="Close calendar" onClick={onClose}>
            ESC ✕
          </button>
        </div>
        <Calendar value={value} now={now} max={max} min={min} onPick={onPick} />
      </div>
    </>
  );
}
