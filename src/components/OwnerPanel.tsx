import { useEffect, useRef, useState } from 'react';
import { WITH_MAX, type Loop, type Owner } from '../../shared/types';
import { pad2 } from '../../shared/format';
import { TimerText } from './TimerText';

export interface HandoffPatch {
  owner?: Owner;
  ownerWith?: string;
  followUpAt?: number | null;
}

interface Props {
  loop: Loop;
  now: number;
  onChange: (patch: HandoffPatch) => void;
}

const DAY = 86_400_000;
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 09:00 local time, `days` days from today. */
function morningIn(days: number, now: number) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 9, 0).getTime();
}
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const toDateInput = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function followUpStatus(at: number | null, now: number): { text: string; due: boolean } {
  if (at == null) return { text: 'NOT SET', due: false };
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY);
  const d = new Date(at);
  const date = `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (at <= now) {
    if (days === 0) return { text: `DUE TODAY · ${date}`, due: true };
    return { text: `DUE · ${-days} DAY${days === -1 ? '' : 'S'} OVERDUE`, due: true };
  }
  if (days === 0) return { text: `TODAY · ${date}`, due: false };
  if (days === 1) return { text: `TOMORROW · ${date}`, due: false };
  return { text: `${date} · IN ${days} DAYS`, due: false };
}

const OPTIONS: [Owner, string, string][] = [
  ['mine', 'MINE', ''],
  ['delegated', 'DELEGATED', '→'],
  ['waiting', 'WAITING', '⧗'],
];

/** Who is moving this loop: you, someone you delegated to, or someone you're waiting on. */
export function OwnerPanel({ loop, now, onChange }: Props) {
  const out = loop.owner !== 'mine';
  const [draft, setDraft] = useState(loop.ownerWith);
  const withRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(loop.ownerWith);
  }, [loop.id, loop.ownerWith]);

  const cancelWith = useRef(false);
  const saveWith = () => {
    if (cancelWith.current) {
      cancelWith.current = false;
      return;
    }
    const v = draft.replace(/\s+/g, ' ').trim();
    if (v !== loop.ownerWith) onChange({ ownerWith: v });
  };

  // Ask who it's with right away when it leaves your hands (after the field renders).
  const focusWith = useRef(false);
  useEffect(() => {
    if (focusWith.current && loop.owner !== 'mine') {
      focusWith.current = false;
      withRef.current?.focus();
    }
  }, [loop.owner]);

  const pick = (owner: Owner) => {
    if (owner === loop.owner) return;
    focusWith.current = owner !== 'mine' && !loop.ownerWith;
    onChange({ owner });
  };

  const status = followUpStatus(loop.followUpAt, now);

  return (
    <div className="own" role="group" aria-label="Ball in court" data-owner={loop.owner}>
      <div className="own__head">
        <span className="own__label">// BALL IN COURT</span>
        {out && loop.handedOffAt != null && (
          <span className="own__out" title="Time since handed off">
            OUT <TimerText ms={now - loop.handedOffAt} />
          </span>
        )}
      </div>

      <div className="own__seg" role="radiogroup" aria-label="Who is moving it">
        {OPTIONS.map(([value, label, glyph]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={loop.owner === value}
            className="own__opt"
            data-owner={value}
            onClick={() => pick(value)}
          >
            {glyph && <span aria-hidden="true">{glyph} </span>}
            {label}
          </button>
        ))}
      </div>

      {out && (
        <>
          <div className="own__row">
            <label className="own__label own__label--inline" htmlFor="own-with">
              {loop.owner === 'delegated' ? 'TO' : 'ON'}
            </label>
            <input
              id="own-with"
              ref={withRef}
              className="own__input"
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              maxLength={WITH_MAX}
              placeholder={loop.owner === 'delegated' ? 'who has it? e.g. JG' : 'waiting on? e.g. Mike Bell'}
              value={draft}
              onFocus={() => (focused.current = true)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                focused.current = false;
                saveWith();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  cancelWith.current = true;
                  setDraft(loop.ownerWith);
                  focused.current = false;
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </div>

          <div className="own__row own__row--follow">
            <span className="own__label own__label--inline">FOLLOW UP</span>
            <span className={`own__status${status.due ? ' is-due' : ''}`} role="status">
              {status.text}
            </span>
          </div>
          <div className="own__chips">
            {(
              [
                ['TOMORROW', 1],
                ['3 DAYS', 3],
                ['NEXT WEEK', 7],
              ] as const
            ).map(([label, days]) => (
              <button key={label} type="button" className="own__chip" onClick={() => onChange({ followUpAt: morningIn(days, now) })}>
                {label}
              </button>
            ))}
            <input
              type="date"
              className="own__chip own__date"
              aria-label="Follow-up date"
              value={loop.followUpAt != null ? toDateInput(loop.followUpAt) : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split('-').map(Number);
                onChange({ followUpAt: new Date(y, m - 1, d, 9, 0).getTime() });
              }}
            />
            {loop.followUpAt != null && (
              <button type="button" className="own__chip" onClick={() => onChange({ followUpAt: null })}>
                CLEAR
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
