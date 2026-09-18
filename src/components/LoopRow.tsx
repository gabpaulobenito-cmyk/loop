import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { ageLevel, fmtAge, fmtHM, neglectMark } from '../../shared/format';
import { TimerText } from './TimerText';
import { deadlineTier, elapsedMs } from '../../shared/timer';
import type { Loop } from '../../shared/types';
import { Countdown } from './Countdown';
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

  // Ball in court: delegated / waiting loops are out of your hands.
  const out = loop.owner !== 'mine' && !closed;
  const due = out && loop.followUpAt != null && loop.followUpAt <= now;
  // A countdown loop reads its deadline instead of its own age, whoever holds it.
  const tier = deadlineTier(loop, now);
  const countdown = tier !== 'none';

  const cls = [
    'row',
    `row--${variant}`,
    `row--${state}`,
    selected ? 'is-selected' : '',
    due ? 'is-due' : '',
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

  const ownerTag = out && (
    <span
      className="row__owner"
      data-owner={loop.owner}
      title={`${loop.owner === 'delegated' ? 'Delegated to' : 'Waiting on'} ${loop.ownerWith || '—'}${due ? ' · follow-up due' : ''}`}
    >
      <span aria-hidden="true">{loop.owner === 'delegated' ? '→' : '⧗'}</span>{' '}
      {loop.ownerWith || (loop.owner === 'delegated' ? 'DELEGATED' : 'WAITING')}
      {due && <span className="row__due"> · DUE</span>}
    </span>
  );
  // Out-of-hands loops show how long they've been out instead of your own time.
  const outClock = out && (
    <span className="row__out" data-owner={loop.owner} title="Time since handed off">
      <span className="row__outlabel">OUT</span>
      <TimerText ms={now - (loop.handedOffAt ?? now)} />
    </span>
  );
  const deadline = countdown ? <Countdown loop={loop} now={now} className="row__dl" /> : null;
  const timer = () => deadline ?? (out ? outClock : <TimerText className="row__timer" ms={total} />);
  const ageLabel = deadline ?? (out ? outClock : <span className="row__age">{fmtAge(age)}</span>);
  const toggle = (size: 'xs' | 'sm' | 'md' | 'lg') => (
    <ToggleButton loop={loop} size={size} onToggle={() => actions.toggle(id)} onReopen={() => actions.reopen(id)} />
  );
  const marker = <Marker loop={loop} tier={tier} mark={neglectMark(age)} />;
  const common = {
    className: cls,
    'data-row': id,
    'data-state': state,
    'data-priority': priority ? 'true' : 'false',
    'data-age': state === 'open' && !countdown ? ageLevel(age) : undefined,
    'data-tier': countdown ? tier : undefined,
    'data-owner': loop.owner,
    'aria-busy': pending || undefined,
    onClick: onRowClick,
    onKeyDown: onRowKeyDown,
  } as const;

  if (variant === 'rail') {
    return (
      <li {...common}>
        <div className="row__line">
          {marker}
          {titleBtn}
          {running && timer()}
          {state === 'open' && ageLabel}
          {closed && <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))}</span>}
          {toggle('xs')}
        </div>
        {out ? (
          <div className="row__subline">
            {ownerTag}
            {note && <Marquee className="row__note" text={note} />}
          </div>
        ) : (
          note && !closed && <Marquee className="row__note" text={note} />
        )}
      </li>
    );
  }

  if (variant === 'mobile') {
    return (
      <li {...common}>
        {marker}
        <div className="row__body">
          {titleBtn}
          {(note || out) && (
            <span className="row__note">
              {ownerTag}
              {out && note ? ' · ' : ''}
              {note}
            </span>
          )}
        </div>
        {running && timer()}
        {state === 'open' && ageLabel}
        {closed && <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))} ago</span>}
        {toggle('lg')}
      </li>
    );
  }

  if (closed) {
    return (
      <li {...common}>
        {marker}
        {titleBtn}
        <span className="row__active">{loop.accumulatedMs > 0 ? fmtHM(loop.accumulatedMs) : '—'}</span>
        <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))} ago</span>
        {toggle('md')}
      </li>
    );
  }

  return (
    <li {...common}>
      {marker}
      {titleBtn}
      {note && <span className="row__div" aria-hidden="true" />}
      {note ? <Marquee className="row__note" text={note} /> : <span className="row__note" />}
      {ownerTag}
      <span className="row__div" aria-hidden="true" />
      {running && !deadline ? (
        timer()
      ) : (
        <>
          <span className="row__active" title="Active time">
            {running ? fmtHM(total) : loop.accumulatedMs > 0 ? fmtHM(loop.accumulatedMs) : '—'}
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
  // Running timers, countdowns and OUT clocks tick every second; the rest change once a minute.
  if (
    a.loop.state === 'running' ||
    (a.loop.timerType === 'countdown' && a.loop.state !== 'closed') ||
    (a.loop.owner !== 'mine' && a.loop.state !== 'closed')
  ) {
    return a.now === b.now;
  }
  return Math.floor(a.now / 60_000) === Math.floor(b.now / 60_000);
});
