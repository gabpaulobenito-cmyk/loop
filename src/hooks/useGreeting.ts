import { useEffect, useRef, useState } from 'react';
import { bandFor, pickGreeting, type Greeting } from '../lib/greeting';

const roll = () => Math.floor(Math.random() * 1_000_000);

/**
 * The line the workspace opens with. It is drawn once when the app loads and
 * again when the day moves on — morning shouldn't still be saying morning at
 * six in the evening — but never while you are sitting there looking at it.
 */
export function useGreeting(now: number, maxLength: number): Greeting {
  const [seed, setSeed] = useState(roll);
  const band = bandFor(new Date(now).getHours());
  const last = useRef(band);

  useEffect(() => {
    if (last.current === band) return;
    last.current = band;
    setSeed(roll());
  }, [band]);

  return pickGreeting(now, seed, maxLength);
}
