const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

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

export const pad2 = (n: number) => p2(n);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
