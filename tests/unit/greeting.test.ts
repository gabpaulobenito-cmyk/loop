import { describe, expect, it } from 'vitest';
import { FITS, NAME, allGreetings, bandFor, pickGreeting } from '../../src/lib/greeting';

const at = (hour: number) => new Date(2026, 8, 19, hour, 30).getTime();
const BANDS = [0, 8, 14, 20]; // one hour inside each band

describe('bandFor', () => {
  it('splits the day into night, morning, afternoon and evening', () => {
    expect(bandFor(0)).toBe('night');
    expect(bandFor(4)).toBe('night');
    expect(bandFor(5)).toBe('morning');
    expect(bandFor(11)).toBe('morning');
    expect(bandFor(12)).toBe('afternoon');
    expect(bandFor(17)).toBe('afternoon');
    expect(bandFor(18)).toBe('evening');
    expect(bandFor(22)).toBe('evening');
    expect(bandFor(23)).toBe('night');
  });
});

describe('pickGreeting', () => {
  it('greets by name, and drops it for the short form', () => {
    const g = pickGreeting(at(8), 0);
    expect(g.full).toContain(NAME);
    expect(g.short).not.toContain(NAME);
    expect(g.short.length).toBeLessThan(g.full.length);
  });

  it('is stable for a seed, so the line never changes while you are reading it', () => {
    expect(pickGreeting(at(14), 42)).toEqual(pickGreeting(at(14), 42));
  });

  it('opens with the time of day', () => {
    const morning = Array.from({ length: 40 }, (_, i) => pickGreeting(at(8), i).full);
    const night = Array.from({ length: 40 }, (_, i) => pickGreeting(at(2), i).full);
    expect(morning.some((g) => /morning/i.test(g))).toBe(true);
    expect(night.some((g) => /late|midnight|night|awake/i.test(g))).toBe(true);
    // Morning lines belong to the morning only.
    expect(night.some((g) => /good morning/i.test(g))).toBe(false);
  });

  it('offers many different lines, not the same one twice', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickGreeting(at(8), i).full));
    expect(seen.size).toBeGreaterThan(20);
    expect(allGreetings().length).toBeGreaterThan(50);
  });

  it('never draws a line too long for the space it has', () => {
    for (const hour of BANDS) {
      for (const max of [FITS.phone, FITS.rail]) {
        const drawn = Array.from({ length: 80 }, (_, i) => pickGreeting(at(hour), i, max));
        expect(drawn.every((g) => g.short.length <= max)).toBe(true);
        // …and there is still a choice at every width.
        expect(new Set(drawn.map((g) => g.short)).size).toBeGreaterThan(3);
      }
    }
  });

  it('survives a seed of any size or sign', () => {
    for (const seed of [0, -1, 1e9, -7.5, Number.MAX_SAFE_INTEGER]) {
      expect(pickGreeting(at(20), seed).full).toBeTruthy();
    }
  });
});
