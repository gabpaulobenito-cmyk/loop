/**
 * Server-aligned clock. Timers are computed from server timestamps, so the client
 * estimates the offset between its own clock and the server's from API responses.
 */
let offset = 0;
let synced = false;

export function syncClock(serverNow: number, requestStart: number, requestEnd: number) {
  const rtt = requestEnd - requestStart;
  if (rtt > 3000) return; // too noisy to trust
  // serverNow was stamped just before the response left; assume symmetric latency.
  const sample = serverNow + rtt / 2 - requestEnd;
  if (!synced || Math.abs(sample - offset) > 2000) offset = sample;
  else offset += (sample - offset) * 0.3;
  synced = true;
}

export const serverNow = () => Date.now() + offset;

// ── Shared one-second ticker ────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let current = serverNow();
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  current = serverNow();
  for (const l of listeners) {
    // One failing subscriber must never stop every timer on the page.
    try {
      l();
    } catch (err) {
      console.error('[loop] timer listener failed', err);
    }
  }
}

/**
 * Polls a few times a second and emits whenever the server-aligned second
 * changes. Unlike a chain of timeouts it cannot stall, and it re-syncs on its
 * own after sleep or clock adjustments.
 */
function check() {
  if (Math.floor(serverNow() / 1000) !== Math.floor(current / 1000)) emit();
}

function onVisible() {
  if (document.visibilityState === 'visible') emit();
}

export function subscribeNow(l: Listener) {
  listeners.add(l);
  if (listeners.size === 1) {
    current = serverNow();
    timer = setInterval(check, 200);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', emit);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', emit);
    }
  };
}

export const getNow = () => current;
