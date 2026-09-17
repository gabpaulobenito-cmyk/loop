import { expect, test, type Page } from '@playwright/test';

const TAG = `SMOKE-${Date.now().toString(36).toUpperCase()}`;
const H = { 'x-loop-client': '1' };
const WIDTHS = [180, 220, 260, 375, 393, 720, 1440];

const secs = (t: string) => t.trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0);

test.skip(!process.env.SMOKE_URL, 'SMOKE_URL is required');

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Loops' })).toBeVisible();
}

test('production lifecycle, persistence, timers and layouts', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await page.setViewportSize({ width: 1024, height: 860 });
  await login(page);

  try {
    const title = `${TAG} Alpha`;
    const capture = page.getByRole('textbox', { name: /New loop title/ });
    await capture.fill(`${title} // smoke note`);
    await capture.press('Shift+Enter');

    // Create + start
    const row = page.getByRole('list', { name: 'Running loops' }).locator('[data-row]', { hasText: title });
    const timer = row.locator('.row__timer');
    await expect(row).toBeVisible();
    await expect.poll(async () => secs(await timer.innerText()), { timeout: 8000 }).toBeGreaterThanOrEqual(3);

    // Refresh: timer continues and agrees with server timestamps.
    const before = secs(await timer.innerText());
    await page.reload();
    await expect(row).toBeVisible();
    expect(secs(await timer.innerText())).toBeGreaterThanOrEqual(before);
    const state = await (await page.request.get('/api/state', { headers: H })).json();
    const loop = state.loops.find((l: { title: string }) => l.title === title);
    const serverElapsed = Math.floor((state.serverNow - loop.runningSince + loop.accumulatedMs) / 1000);
    expect(Math.abs(secs(await timer.innerText()) - serverElapsed)).toBeLessThanOrEqual(2);
    console.log(`timer after refresh: ui=${await timer.innerText()} server=${serverElapsed}s`);

    // Stop
    await row.getByRole('button', { name: `Stop ${title}` }).click();
    const openRow = page.getByRole('list', { name: 'Open loops' }).locator('[data-row]', { hasText: title });
    await expect(openRow).toBeVisible();

    // Resume keeps accumulated time (pause past the double-tap guard)
    await page.waitForTimeout(400);
    await openRow.getByRole('button', { name: `Resume ${title}` }).click();
    await expect(row).toBeVisible();
    expect(secs(await timer.innerText())).toBeGreaterThanOrEqual(before);

    // Priority
    await row.getByRole('button', { name: /Toggle priority/ }).click();
    await expect(row.locator('[data-marker="priority"]')).toBeVisible();

    // Inspector + close running loop
    await row.getByRole('button', { name: `Session detail for ${title}` }).click();
    const inspector = page.getByRole('dialog', { name: 'Session detail' });
    await expect(inspector.getByRole('list', { name: 'Session history' }).locator('li')).toHaveCount(2);
    await inspector.getByRole('button', { name: /CLOSE LOOP/ }).click();
    await expect(inspector.getByRole('button', { name: /REOPEN/ }).first()).toBeVisible();
    await expect(inspector.getByText('→ NOW')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Reopen from archive
    const archive = page.getByRole('button', { name: /CLOSED/ });
    if ((await archive.getAttribute('aria-expanded')) !== 'true') await archive.click();
    await page.getByRole('list', { name: 'Closed loops' }).getByRole('button', { name: `Reopen ${title}` }).click();
    await expect(openRow).toBeVisible();

    // Persistence
    await page.reload();
    await expect(openRow).toBeVisible();
    await expect(openRow.locator('[data-marker="priority"]')).toBeVisible();

    // A second running loop for the layout checks.
    await capture.fill(`${TAG} Beta`);
    await capture.press('Shift+Enter');
    await expect(page.locator('[data-row]', { hasText: `${TAG} Beta` }).getByRole('button', { name: `Stop ${TAG} Beta` })).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await page.reload();
      await expect(page.locator('[data-row]').first()).toBeVisible();
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
      await expect(page.locator('[data-row]', { hasText: `${TAG} Beta` }).getByRole('button', { name: `Stop ${TAG} Beta` })).toBeVisible();
      await page.screenshot({ path: `test-results/smoke-${width}.png` });
    }

    expect(consoleErrors).toEqual([]);
  } finally {
    // Clean up: undo only this run's actions, then sign out.
    for (let i = 0; i < 40; i++) {
      const s = await (await page.request.get('/api/state', { headers: H })).json();
      if (!s.undo || !String(s.undo.label).includes(TAG)) break;
      await page.request.post('/api/undo', { headers: H });
    }
    const s = await (await page.request.get('/api/state', { headers: H })).json();
    console.log(`leftover smoke loops: ${s.loops.filter((l: { title: string }) => l.title.includes(TAG)).length}`);
  }
});
