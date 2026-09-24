const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DAY_S = 86_400;

/**
 * Timer segments: [months] [days] clock. Seconds always tick.
 *   06:25 → 02:14:37 → 1D · 07:42:11 → 2MO · 16D · 03:12:45
 * Months are 30-day blocks. `noSec` drops seconds for summary text only.
 */
export function timerParts(ms: number, opts: { noSec?: boolean } = {}): string[] {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const totalDays = Math.floor(secs / 86400);
  const hh = Math.floor((secs % 86400) / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  const mo = Math.floor(totalDays / 30);
  const d = totalDays - mo * 30;
  const parts: string[] = [];
  if (mo > 0) parts.push(`${mo}MO`);
  if (mo > 0 || d > 0) parts.push(`${d}D`);
  if (parts.length || hh > 0) parts.push(opts.noSec ? `${p2(hh)}:${p2(mm)}` : `${p2(hh)}:${p2(mm)}:${p2(ss)}`);
  else parts.push(`${p2(mm)}:${p2(ss)}`);
  return parts;
}

/** Timer as text, segments separated by a middle dot. */
export function fmtTimer(ms: number, opts: { noSec?: boolean } = {}): string {
  return timerParts(ms, opts).join(' · ');
}

/**
 * Coarse duration for the list: at most two units, never seconds.
 *   <1M · 42M · 5H 42M · 3D · 5H · 1MO · 1D · 5H
 * A list is for scanning, so it stops at the hour; the detail panel keeps the
 * exact clock for when you actually want it.
 */
export function spanParts(ms: number): string[] {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const totalDays = Math.floor(secs / DAY_S);
  const hh = Math.floor((secs % DAY_S) / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const mo = Math.floor(totalDays / 30);
  if (totalDays > 0) {
    const parts: string[] = [];
    if (mo > 0) parts.push(`${mo}MO`);
    parts.push(`${totalDays - mo * 30}D`, `${hh}H`);
    return parts;
  }
  if (hh > 0) return [`${hh}H ${mm}M`];
  return [mm > 0 ? `${mm}M` : '<1M'];
}

/** Coarse duration as text, segments separated by a middle dot. */
export function fmtSpan(ms: number): string {
  return spanParts(ms).join(' · ');
}

/** Accumulated duration label: "02H 14M" or "48M". */
export function fmtHM(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${p2(h)}H ${p2(m)}M` : `${p2(m)}M`;
}

/** Session duration: "1H 22M", "48M", "<1M". */
export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / MIN);
  if (totalMin < 1) return '<1M';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}M`;
  return m === 0 ? `${h}H` : `${h}H ${m}M`;
}

/** Human age: "3 hours", "1 day", "2 months". */
export function fmtAge(ms: number): string {
  const d = Math.floor(ms / DAY);
  if (d >= 60) {
    const mo = Math.round(d / 30);
    return `${mo} ${mo === 1 ? 'month' : 'months'}`;
  }
  if (d >= 1) return `${d} ${d === 1 ? 'day' : 'days'}`;
  const h = Math.floor(ms / HOUR);
  if (h >= 1) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const m = Math.floor(ms / MIN);
  return m >= 1 ? `${m} min` : 'just now';
}

/** Five-step brightness ramp for how long a loop has been open. Not an alarm. */
export function ageLevel(ageMs: number): 0 | 1 | 2 | 3 | 4 {
  const days = ageMs / DAY;
  if (days >= 30) return 4;
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 3) return 1;
  return 0;
}

/**
 * Neglect marker for an elapsed loop: one step at two weeks, one more at a
 * month. Deliberately three steps and no colour of alarm — long-neglected
 * loops should be scannable, not shouted about.
 */
export function neglectMark(ageMs: number): 0 | 1 | 2 {
  const days = ageMs / DAY;
  if (days >= 30) return 2;
  if (days >= 14) return 1;
  return 0;
}

export const pad2 = (n: number) => p2(n);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Calendar label for a date input or status line: "THU OCT 2". */
export function fmtDateLabel(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Whole local days from `from` to `to` (negative once `to` is in the past). */
export function dayGap(from: number, to: number): number {
  const startOf = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((startOf(to) - startOf(from)) / DAY);
}

/** "TODAY", "YESTERDAY" or "SEP 14" in local time. */
export function fmtDay(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(n) - startOf(d)) / DAY);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'YESTERDAY';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Local "HH:MM". */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Header clock in local time: "Thu Sep 17 10:30PM". */
export function fmtHeaderClock(ts: number): { weekday: string; date: string; time: string } {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  return {
    weekday: WEEKDAY_ABBR[d.getDay()],
    date: `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`,
    time: `${h}:${p2(d.getMinutes())}${d.getHours() < 12 ? 'AM' : 'PM'}`,
  };
}

/** Minutes past local midnight: 17:00 → 1020. */
export function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes past midnight as a clock: 1020 → "17:00". */
export function fmtMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/** `ts`'s own local day, moved to `minutes` past midnight. */
export function atMinutes(ts: number, minutes: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes).getTime();
}

/**
 * Loose time entry → minutes past midnight, or null when it isn't a time.
 * Takes what people actually type: "17:00", "1700", "17.00", "5pm", "9",
 * "9:30am". The field it feeds keeps the last good value, so a half-typed
 * "17:" is simply not a time yet.
 */
export function parseClock(input: string): number | null {
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/.exec(input.trim().toLowerCase());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] == null ? 0 : Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23) return null;
  return h * 60 + min;
}
