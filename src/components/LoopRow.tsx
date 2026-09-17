import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { ageLevel, fmtAge, fmtHM, fmtTimer } from '../../shared/format';
import { elapsedMs } from '../../shared/timer';
import type { Loop } from '../../shared/types';
import { Marker } from './Marker';
import { Marquee } from './Marquee';
import { ToggleButton } from './Glyphs';

export type RowVariant = 'desk' | 'rail' | 'mobile';

export interface RowActions {
  toggle: (id: string) => void;
  reopen: (id: string) => void;
  inspect: (id: string) => void;
}

interface Props {
  loop: Loop;
  variant: RowVariant;
  now: number;
  pending: boolean;
  selected: boolean;
  actions: RowActions;
}

const hasSelection = () => {
  const s = window.getSelection();
  return !!s && s.type === 'Range' && s.toString().length > 0;
};

/** Arrow-key movement between rows: keeps focus on the same kind of control. */
function onRowKeyDown(e: KeyboardEvent<HTMLLIElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const active = document.activeElement as HTMLElement | null;
  const role = active?.dataset.ctl;
  if (!role) return;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-row]'));
  const idx = rows.indexOf(e.currentTarget);
  const next = rows[idx + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  const target = next.querySelector<HTMLElement>(`[data-ctl="${role}"]`) ?? next.querySelector<HTMLElement>('[data-ctl]');
  target?.focus();
}

function LoopRowImpl({ loop, variant, now, pending, selected, actions }: Props) {
  const { id, state, title, note, priority } = loop;
  const running = state === 'running';
  const closed = state === 'closed';
  const age = now - loop.createdAt;
  const total = elapsedMs(loop, now);

  // Clicking anywhere on a row opens its details. Only ▶ / ■ change its state.
  const onRowClick = (e: MouseEvent) => {
    if (hasSelection() || e.defaultPrevented) return;
    actions.inspect(id);
  };

  const cls = [
    'row',
    `row--${variant}`,
    `row--${state}`,
    selected ? 'is-selected' : '',
  ].join(' ');

  const titleBtn = (
    <button
      type="button"
      className="row__title"
      data-ctl="title"
      title={title}
      aria-label={`${title}${priority ? ', priority' : ''}. Open details`}
      aria-haspopup="dialog"
      onClick={(e) => {
        e.stopPropagation();
        actions.inspect(id);
      }}
    >
      {title}
    </button>
  );

  const timer = (compact: boolean) => <span className="row__timer">{fmtTimer(total, { noSec: compact })}</span>;
  const ageLabel = <span className="row__age">{fmtAge(age)}</span>;
  const toggle = (size: 'xs' | 'sm' | 'md' | 'lg') => (
    <ToggleButton loop={loop} size={size} onToggle={() => actions.toggle(id)} onReopen={() => actions.reopen(id)} />
  );
  const common = {
    className: cls,
    'data-row': id,
    'data-state': state,
    'data-priority': priority ? 'true' : 'false',
    'data-age': state === 'open' ? ageLevel(age) : undefined,
    'aria-busy': pending || undefined,
    onClick: onRowClick,
    onKeyDown: onRowKeyDown,
  } as const;

  if (variant === 'rail') {
    return (
      <li {...common}>
        <div className="row__line">
          <Marker loop={loop} />
          {titleBtn}
          {running && timer(true)}
          {state === 'open' && ageLabel}
          {closed && <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))}</span>}
          {toggle('xs')}
        </div>
        {note && !closed && <Marquee className="row__note" text={note} />}
      </li>
    );
  }

  if (variant === 'mobile') {
    return (
      <li {...common}>
        <Marker loop={loop} />
        <div className="row__body">
          {titleBtn}
          {note && <span className="row__note">{note}</span>}
        </div>
        {running && timer(true)}
        {state === 'open' && ageLabel}
        {closed && <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))} ago</span>}
        {toggle('lg')}
      </li>
    );
  }

  if (closed) {
    return (
      <li {...common}>
        <Marker loop={loop} />
        {titleBtn}
        <span className="row__active">{loop.accumulatedMs > 0 ? fmtHM(loop.accumulatedMs) : '—'}</span>
        <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))} ago</span>
        {toggle('md')}
      </li>
    );
  }

  return (
    <li {...common}>
      <Marker loop={loop} />
      {titleBtn}
      {note && <span className="row__div" aria-hidden="true" />}
      {note ? <Marquee className="row__note" text={note} /> : <span className="row__note" />}
      <span className="row__div" aria-hidden="true" />
      {running ? (
        timer(false)
      ) : (
        <>
          <span className="row__active" title="Active time">
            {loop.accumulatedMs > 0 ? fmtHM(loop.accumulatedMs) : '—'}
          </span>
          {ageLabel}
        </>
      )}
      {toggle('md')}
    </li>
  );
}

/**
 * Open and closed rows only change once a minute, so they skip the per-second
 * re-render unless their minute bucket or data changes.
 */
export const LoopRow = memo(LoopRowImpl, (a, b) => {
  if (
    a.loop !== b.loop ||
    a.variant !== b.variant ||
    a.pending !== b.pending ||
    a.selected !== b.selected ||
    a.actions !== b.actions
  ) {
    return false;
  }
  if (a.loop.state === 'running') return a.now === b.now;
  return Math.floor(a.now / 60_000) === Math.floor(b.now / 60_000);
});
