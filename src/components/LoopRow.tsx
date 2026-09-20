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
  /** Both worlds are on screen at once, so personal rows have to say so. */
  markScope?: boolean;
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

function LoopRowImpl({ loop, variant, markScope = false, now, pending, selected, actions }: Props) {
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

  const scopeTag = markScope && loop.scope === 'personal' && (
    <span className="row__scope" title="Personal">
      PERS
    </span>
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
      <TimerText ms={now - (loop.handedOffAt ?? now)} coarse />
    </span>
  );
  const deadline = countdown ? <Countdown loop={loop} now={now} className="row__dl" coarse /> : null;

  /**
   * A countdown row carries both clocks — your own time on the left, what you
   * owe on the right: `1MO · 1D · 5H | DUE 8D · 5H`. The deadline alone would
   * hide how long you have been carrying the thing.
   */
  // Out-of-hands loops show how long they have been out in place of your own time.
  const ownTime = out ? (
    outClock
  ) : running ? (
    <TimerText className="row__timer" ms={total} coarse />
  ) : (
    <span className="row__age">{fmtAge(age)}</span>
  );
  // Desk rows have room for the accumulated total beside a stopped loop's age.
  const activeTime = !running && !out && !countdown && (
    <span className="row__active" title="Active time">
      {loop.accumulatedMs > 0 ? fmtHM(loop.accumulatedMs) : '—'}
    </span>
  );
  const dueSeg = deadline && (
    <>
      <span className="row__div row__div--due" aria-hidden="true" />
      {deadline}
    </>
  );
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
          {!closed && (deadline ?? ownTime)}
          {closed && <span className="row__closedat">{fmtAge(now - (loop.closedAt ?? now))}</span>}
          {toggle('xs')}
        </div>
        {out ? (
          <div className="row__subline">
            {scopeTag}
            {ownerTag}
            {note && <Marquee className="row__note" text={note} />}
          </div>
        ) : (
          (scopeTag || (note && !closed)) && (
            <div className="row__subline">
              {scopeTag}
              {note && !closed && <Marquee className="row__note" text={note} />}
            </div>
          )
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
          {(note || out || scopeTag) && (
            <span className="row__note">
              {scopeTag}
              {ownerTag}
              {out && note ? ' · ' : ''}
              {note}
            </span>
          )}
        </div>
        {!closed && ownTime}
        {!closed && dueSeg}
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
        {scopeTag}
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
      {scopeTag}
      {note && <span className="row__div" aria-hidden="true" />}
      {note ? <Marquee className="row__note" text={note} /> : <span className="row__note" />}
      {ownerTag}
      <span className="row__div" aria-hidden="true" />
      {activeTime}
      {ownTime}
      {dueSeg}
      {toggle('md')}
    </li>
  );
}

/**
 * Rows read their timers to the hour, so they skip the per-second re-render
 * unless their minute bucket or their data changes.
 */
export const LoopRow = memo(LoopRowImpl, (a, b) => {
  if (
    a.loop !== b.loop ||
    a.variant !== b.variant ||
    a.markScope !== b.markScope ||
    a.pending !== b.pending ||
    a.selected !== b.selected ||
    a.actions !== b.actions
  ) {
    return false;
  }
  // Rows stop at the hour, so they only need to re-render once a minute.
  return Math.floor(a.now / 60_000) === Math.floor(b.now / 60_000);
});
