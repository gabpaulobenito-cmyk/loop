import { useSyncExternalStore } from 'react';
import { getNow, subscribeNow } from '../lib/clock';

/** Server-aligned "now", re-rendering once per second. */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, getNow);
}
