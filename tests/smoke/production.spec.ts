import { expect, test } from '@playwright/test';

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
    // OUT clocks tick from the handoff time.
    const clock = page.locator(`[data-row="${out[0].id}"] .row__out`);
    await expect(clock).toBeVisible();
    const t0 = secsOf((await clock.innerText()).replace('OUT', ''));
    await expect.poll(async () => secsOf((await clock.innerText()).replace('OUT', '')), { timeout: 5000 }).toBeGreaterThanOrEqual(t0 + 2);
  }

  if (running.length) {
    const loop = running[0];
    const timer = page.locator(`[data-row="${loop.id}"] .row__timer`);
    await expect(timer).toBeVisible();
    const first = secsOf(await timer.innerText());
    await expect.poll(async () => secsOf(await timer.innerText()), { timeout: 5000 }).toBeGreaterThanOrEqual(first + 2);

    const fresh = await (await request.get('/api/state')).json();
    const l = fresh.loops.find((x: { id: string }) => x.id === loop.id);
    const serverElapsed = Math.floor((fresh.serverNow - l.runningSince + l.accumulatedMs) / 1000);
    const ui = secsOf(await timer.innerText());
    console.log(`timer ui=${await timer.innerText()} server=${serverElapsed}s`);
    expect(Math.abs(ui - serverElapsed)).toBeLessThanOrEqual(2);

    // Details open and close without changing anything.
    await page.locator(`[data-row="${loop.id}"] .row__title`).click();
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Session history' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
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
