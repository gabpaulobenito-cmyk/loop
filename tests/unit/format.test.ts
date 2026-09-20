import { describe, expect, it } from 'vitest';
import {
  ageLevel,
  dayGap,
  fmtAge,
  fmtDateLabel,
  fmtDuration,
  fmtHeaderClock,
  fmtHM,
  fmtSpan,
  fmtTimer,
  neglectMark,
  spanParts,
  timerParts,
} from '../../shared/format';

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('fmtTimer', () => {
  it('always shows seconds, with months and days split by a middle dot', () => {
    expect(fmtTimer(6 * M + 25 * S)).toBe('06:25');
    expect(fmtTimer(2 * H + 14 * M + 37 * S)).toBe('02:14:37');
    expect(fmtTimer(31 * H + 42 * M + 11 * S)).toBe('1D · 07:42:11');
    expect(fmtTimer(8 * D + 3 * H + 4 * M + 5 * S)).toBe('8D · 03:04:05');
    expect(fmtTimer(76 * D + 3 * H + 12 * M + 45 * S)).toBe('2MO · 16D · 03:12:45');
    expect(fmtTimer(60 * D)).toBe('2MO · 0D · 00:00:00');
    expect(fmtTimer(-5)).toBe('00:00');
  });

  it('can drop seconds for summary text', () => {
    expect(fmtTimer(2 * H + 14 * M + 37 * S, { noSec: true })).toBe('02:14');
    expect(fmtTimer(31 * H + 42 * M, { noSec: true })).toBe('1D · 07:42');
  });

  it('exposes segments for rendering', () => {
    expect(timerParts(35 * D + 5 * S)).toEqual(['1MO', '5D', '00:00:05']);
  });
});

describe('labels', () => {
  it('formats accumulated and session durations', () => {
    expect(fmtHM(4 * H + 42 * M)).toBe('04H 42M');
    expect(fmtHM(45 * M)).toBe('45M');
    expect(fmtDuration(82 * M)).toBe('1H 22M');
    expect(fmtDuration(20 * S)).toBe('<1M');
  });

  it('formats ages', () => {
    expect(fmtAge(3 * H)).toBe('3 hours');
    expect(fmtAge(1 * D)).toBe('1 day');
    expect(fmtAge(64 * D)).toBe('2 months');
    expect(fmtAge(10 * S)).toBe('just now');
  });

  it('ramps age brightness at 3 / 7 / 14 / 30 days', () => {
    expect([1, 3, 7, 14, 30].map((d) => ageLevel(d * D))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('fmtHeaderClock', () => {
  it('formats local time as "Thu Sep 17 10:30PM"', () => {
    expect(fmtHeaderClock(new Date(2026, 8, 17, 22, 30).getTime())).toEqual({ weekday: 'Thu', date: 'Sep 17', time: '10:30PM' });
    expect(fmtHeaderClock(new Date(2026, 8, 18, 0, 5).getTime())).toEqual({ weekday: 'Fri', date: 'Sep 18', time: '12:05AM' });
    expect(fmtHeaderClock(new Date(2026, 8, 18, 9, 7).getTime())).toEqual({ weekday: 'Fri', date: 'Sep 18', time: '9:07AM' });
    expect(fmtHeaderClock(new Date(2026, 8, 18, 12, 0).getTime())).toEqual({ weekday: 'Fri', date: 'Sep 18', time: '12:00PM' });
  });
});

describe('neglect marker', () => {
  it('shifts once at two weeks and once at a month, and never again', () => {
    expect(neglectMark(0)).toBe(0);
    expect(neglectMark(13 * D)).toBe(0);
    expect(neglectMark(14 * D)).toBe(1);
    expect(neglectMark(29 * D)).toBe(1);
    expect(neglectMark(30 * D)).toBe(2);
    expect(neglectMark(400 * D)).toBe(2);
  });
});

describe('dates', () => {
  it('labels a calendar day', () => {
    expect(fmtDateLabel(new Date(2026, 8, 18, 17, 0).getTime())).toBe('FRI SEP 18');
  });

  it('counts whole local days between two moments', () => {
    const noon = new Date(2026, 8, 18, 12, 0).getTime();
    expect(dayGap(noon, new Date(2026, 8, 18, 23, 0).getTime())).toBe(0);
    expect(dayGap(noon, new Date(2026, 8, 19, 1, 0).getTime())).toBe(1);
    expect(dayGap(noon, new Date(2026, 8, 15, 9, 0).getTime())).toBe(-3);
  });
});

describe('fmtSpan', () => {
  it('stops at the hour so a list can be scanned, not read', () => {
    expect(fmtSpan(31 * D + 5 * H + 42 * M + 59 * S)).toBe('1MO · 1D · 5H');
    expect(fmtSpan(8 * D + 5 * H)).toBe('8D · 5H');
    expect(fmtSpan(3 * D)).toBe('3D · 0H');
    expect(fmtSpan(5 * H + 42 * M + 59 * S)).toBe('5H 42M');
    expect(fmtSpan(42 * M + 59 * S)).toBe('42M');
  });

  it('never reads zero for something that has only just started', () => {
    expect(fmtSpan(0)).toBe('<1M');
    expect(fmtSpan(59 * S)).toBe('<1M');
    expect(fmtSpan(60 * S)).toBe('1M');
    expect(fmtSpan(-5)).toBe('<1M');
  });

  it('counts months in 30-day blocks, like the full timer', () => {
    expect(fmtSpan(60 * D + 3 * H)).toBe('2MO · 0D · 3H');
    expect(spanParts(31 * D + 5 * H)).toEqual(['1MO', '1D', '5H']);
    expect(spanParts(4 * H)).toEqual(['4H 0M']);
  });
});
