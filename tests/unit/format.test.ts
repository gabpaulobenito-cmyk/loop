import { describe, expect, it } from 'vitest';
import { ageLevel, fmtAge, fmtDuration, fmtHM, fmtTimer } from '../../shared/format';

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe('fmtTimer', () => {
  it('matches the V2 timer progression', () => {
    expect(fmtTimer(6 * M + 25 * S)).toBe('06:25');
    expect(fmtTimer(2 * H + 14 * M + 37 * S)).toBe('02:14:37');
    expect(fmtTimer(2 * H + 14 * M + 37 * S, { noSec: true })).toBe('02:14');
    expect(fmtTimer(31 * H + 42 * M + 11 * S)).toBe('1D 07:42:11');
    expect(fmtTimer(8 * D + 3 * H + 4 * M)).toBe('8D 03:04');
    expect(fmtTimer(64 * D)).toBe('2MO 04D');
    expect(fmtTimer(-5)).toBe('00:00');
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
