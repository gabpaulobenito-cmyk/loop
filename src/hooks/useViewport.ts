import { useSyncExternalStore } from 'react';

/**
 * Layout modes, chosen by viewport width:
 *  rail   < 300   ultra-narrow persistent rail
 *  mobile < 600   compact / phone with filter tabs
 *  desk   < 1180  half-screen desktop rows; inspector as a drawer
 *  wide   ≥ 1180  full desktop; inspector docked beside the list
 */
export type Mode = 'rail' | 'mobile' | 'desk' | 'wide';

export function modeFor(width: number): Mode {
  if (width < 300) return 'rail';
  if (width < 600) return 'mobile';
  if (width < 1180) return 'desk';
  return 'wide';
}

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

const getMode = () => modeFor(document.documentElement.clientWidth || window.innerWidth);

export function useMode(): Mode {
  return useSyncExternalStore(subscribe, getMode, () => 'desk' as Mode);
}
