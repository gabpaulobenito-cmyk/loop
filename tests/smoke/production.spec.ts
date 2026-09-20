import { expect, test } from '@playwright/test';
import { modeFor } from '../../src/hooks/useViewport';

/**
 * Post-deploy smoke test against the LIVE workspace.
 * It is strictly read-only: it never creates, edits, starts/stops or undoes
 * anything, so it can't interfere with real loops or the undo history.
 * Mutations are covered by the local e2e suite (`npm run test:e2e`).
 */

const WIDTHS = [180, 220, 260, 375, 393, 720, 1440];
const secsOf = (t: string) =>
  t
    .replace(/\s/g, '')
    .split('·')
    .reduce((total, part) => {
      if (part.endsWith('MO')) return total + Number(part.slice(0, -2)) * 30 * 86400;
      if (part.endsWith('D')) return total + Number(part.slice(0, -1)) * 86400;
      if (part === '<1M') return total;
      // "5H", "42M" or "5H42M" once whitespace is gone.
      const coarse = part.match(/^(?:(\d+)H)?(?:(\d+)M)?$/);
      if (coarse && (coarse[1] || coarse[2])) return total + Number(coarse[1] ?? 0) * 3600 + Number(coarse[2] ?? 0) * 60;
      return total + part.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
    }, 0);

test.skip(!process.env.SMOKE_URL, 'SMOKE_URL is required');

test('live workspace loads, timers tick in sync, layouts hold (read-only)', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // Any write from this test would be a bug: fail loudly if one is attempted.
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });

  expect((await request.get('/api/health')).status()).toBe(200);

  await page.setViewportSize({ width: 1024, height: 860 });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Loops' })).toBeVisible();

  type L = { id: string; state: string; owner?: string; runningSince: number; accumulatedMs: number; handedOffAt: number | null };
  const state = await (await request.get('/api/state')).json();
  const filter = state.settings.ownerFilter ?? 'all';
  const visible = (l: L) => filter === 'all' || (filter === 'mine' ? (l.owner ?? 'mine') === 'mine' : (l.owner ?? 'mine') !== 'mine');
  const running = (state.loops as L[]).filter((l) => l.state === 'running' && (l.owner ?? 'mine') === 'mine' && visible(l));
  const out = (state.loops as L[]).filter((l) => l.state !== 'closed' && (l.owner ?? 'mine') !== 'mine' && visible(l));
  console.log(`loops: ${state.loops.length}, running (mine): ${running.length}, out: ${out.length}, filter: ${filter}`);

  if (out.length) {
    // OUT clocks read to the hour, counting from the handoff.
    const clock = page.locator(`[data-row="${out[0].id}"] .row__out`);
    await expect(clock).toBeVisible();
    const shown = secsOf((await clock.innerText()).replace('OUT', ''));
    const expected = Date.now() - out[0].handedOffAt!;
    // Within an hour of the real figure: the row rounds down to whole hours.
    expect(Math.abs(shown - Math.floor(expected / 1000))).toBeLessThanOrEqual(3600);
  }

  if (running.length) {
    const loop = running[0];
    const timer = page.locator(`[data-row="${loop.id}"] .row__timer`);
    await expect(timer).toBeVisible();

    const fresh = await (await request.get('/api/state')).json();
    const l = fresh.loops.find((x: { id: string }) => x.id === loop.id);
    const serverElapsed = Math.floor((fresh.serverNow - l.runningSince + l.accumulatedMs) / 1000);
    const ui = secsOf(await timer.innerText());
    console.log(`timer ui=${await timer.innerText()} server=${serverElapsed}s`);
    // The row rounds down to whole hours; it must still agree with the server.
    expect(serverElapsed - ui).toBeGreaterThanOrEqual(0);
    expect(serverElapsed - ui).toBeLessThanOrEqual(3600);

    // Details open without changing anything. Wide windows dock them as a column;
    // narrower ones pop them up, so follow whatever this width does.
    await page.locator(`[data-row="${loop.id}"] .row__title`).click();
    const docked = modeFor(1024) === 'wide';
    const details = docked ? page.locator(`[data-inspector="${loop.id}"]`) : page.getByRole('dialog', { name: 'Loop details' });
    await expect(details).toBeVisible();
    await expect(details.getByRole('list', { name: 'Session history' })).toBeVisible();

    // Seconds live in the detail panel, and they tick.
    const live = details.locator('.insp-head__timer');
    const t0 = secsOf(await live.innerText());
    await expect.poll(async () => secsOf(await live.innerText()), { timeout: 5000 }).toBeGreaterThanOrEqual(t0 + 2);
    expect(Math.abs(secsOf(await live.innerText()) - serverElapsed)).toBeLessThanOrEqual(6);
    if (!docked) {
      await page.keyboard.press('Escape');
      await expect(details).toHaveCount(0);
    }
  }

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 860 });
    await page.reload();
    await expect(page.getByRole('main', { name: 'Loops' })).toBeVisible();
    const layout = await page.evaluate(() => ({
      mode: document.querySelector('.app')?.getAttribute('data-mode'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      listOverflow: (() => {
        const l = document.querySelector('.list') as HTMLElement;
        return l.scrollWidth - l.clientWidth;
      })(),
      badMarkers: Array.from(document.querySelectorAll<HTMLElement>('.marker:not(.marker--closed)'))
        .map((m) => m.getBoundingClientRect())
        .filter((r) => r.width !== 6 || r.height !== 6).length,
    }));
    console.log(`${width}px → ${JSON.stringify(layout)}`);
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.listOverflow).toBeLessThanOrEqual(0);
    expect(layout.badMarkers).toBe(0);
    await page.screenshot({ path: `test-results/smoke-${width}.png` });
  }

  expect(writes).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
