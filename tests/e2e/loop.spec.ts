import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E_KEY } from '../../playwright.config';

const H = { 'x-loop-client': '1' };

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('ACCESS KEY').fill(E2E_KEY);
  await page.getByRole('button', { name: /UNLOCK/ }).click();
  await expect(page.getByRole('main', { name: 'Loops' })).toBeVisible();
}

async function resetData(request: APIRequestContext) {
  // Undo everything reachable is not enough for isolation; close out via API instead.
  const state = await (await request.get('/api/state', { headers: H })).json();
  for (const l of state.loops) {
    if (l.state !== 'closed') await request.post(`/api/loops/${l.id}/close`, { headers: H });
  }
}

/** mm:ss or hh:mm:ss → seconds */
function secs(text: string) {
  const parts = text.trim().split(':').map(Number);
  return parts.reduce((a, n) => a * 60 + n, 0);
}

test.describe('access control', () => {
  test('private data requires the access key', async ({ page, request }) => {
    expect((await request.get('/api/state')).status()).toBe(401);
    await page.goto('/');
    await page.getByLabel('ACCESS KEY').fill('wrong-key');
    await page.getByRole('button', { name: /UNLOCK/ }).click();
    await expect(page.getByRole('alert')).toContainText(/not valid/i);
    await expect(page.getByRole('main', { name: 'Loops' })).toHaveCount(0);
  });
});

test.describe('core loop lifecycle (desktop)', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('create, start, stop, resume, prioritize, inspect, close, reopen, persist', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    await page.reload();

    const title = `E2E Alpha ${Date.now()}`;
    const capture = page.getByRole('textbox', { name: /New loop title/ });
    await capture.fill(`${title} // context from e2e`);
    await capture.press('Shift+Enter');

    const running = page.getByRole('list', { name: 'Running loops' });
    const row = running.locator('[data-row]', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('context from e2e');
    await expect(row.locator('[data-marker="running"]')).toBeVisible();

    const timer = row.locator('.row__timer');
    await expect.poll(async () => secs(await timer.innerText()), { timeout: 6000 }).toBeGreaterThanOrEqual(2);
    const t1 = secs(await timer.innerText());

    // Timer survives a reload (timestamp based, not a client counter).
    await page.reload();
    await expect(row).toBeVisible();
    expect(secs(await timer.innerText())).toBeGreaterThanOrEqual(t1);
    await expect.poll(async () => secs(await timer.innerText()), { timeout: 6000 }).toBeGreaterThanOrEqual(t1 + 1);
    const t2 = secs(await timer.innerText());

    // Stop moves it to OPEN with accumulated time.
    await page.getByRole('button', { name: `Stop ${title}` }).click();
    const openRow = page.getByRole('list', { name: 'Open loops' }).locator('[data-row]', { hasText: title });
    await expect(openRow).toBeVisible();
    await expect(openRow.locator('[data-marker="open"]')).toBeVisible();

    // Resume via row click (V2: ROW ⇄ START/STOP).
    await openRow.locator('.row__note').click();
    await expect(row).toBeVisible();
    // Accumulated time carries over into the resumed session.
    await expect.poll(async () => secs(await timer.innerText()), { timeout: 6000 }).toBeGreaterThanOrEqual(t2 + 1);

    // Title toggles priority without toggling the timer.
    await row.getByRole('button', { name: /Toggle priority/ }).click();
    await expect(row.locator('[data-marker="priority"]')).toBeVisible();
    await expect(row).toHaveAttribute('data-state', 'running');

    // Inspector shows real session history.
    await row.getByRole('button', { name: `Session detail for ${title}` }).click();
    const inspector = page.getByRole('dialog', { name: 'Session detail' });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('list', { name: 'Session history' }).locator('li')).toHaveCount(2);
    await expect(inspector.getByText('→ NOW')).toBeVisible();

    // Closing a running loop finalizes its session.
    await inspector.getByRole('button', { name: /CLOSE LOOP/ }).click();
    await expect(inspector.getByRole('button', { name: /REOPEN LOOP/ })).toBeVisible();
    await expect(inspector.getByText('→ NOW')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator(`[data-row]`, { hasText: title })).toHaveCount(0);

    // Undo restores it to running.
    await page.getByRole('button', { name: new RegExp(`^Undo: Closed ${title}`) }).click();
    await expect(row).toBeVisible();

    // Close again, then reopen from the archive.
    await row.getByRole('button', { name: `Session detail for ${title}` }).click();
    await page.getByRole('dialog', { name: 'Session detail' }).getByRole('button', { name: /CLOSE LOOP/ }).click();
    await page.keyboard.press('Escape');
    const archiveToggle = page.getByRole('button', { name: /CLOSED/ });
    if ((await archiveToggle.getAttribute('aria-expanded')) !== 'true') await archiveToggle.click();
    await page.getByRole('button', { name: `Reopen ${title}` }).click();
    await expect(openRow).toBeVisible();

    // Persistence across reload.
    await page.reload();
    await expect(openRow).toBeVisible();
    await expect(openRow.locator('[data-marker="priority"]')).toBeVisible();
  });

  test('search filters loops and sort buttons persist', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    for (const t of ['Zeta search target', 'Alpha other']) {
      await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: t } });
    }
    await page.reload();
    await page.getByRole('button', { name: 'A–Z' }).nth(1).click();
    await expect(page.getByRole('list', { name: 'Open loops' }).locator('[data-row]').first()).toContainText('Alpha other');
    await page.reload();
    await expect(page.getByRole('list', { name: 'Open loops' }).locator('[data-row]').first()).toContainText('Alpha other');

    await page.getByRole('searchbox', { name: 'Search loops' }).fill('zeta');
    await expect(page.locator('[data-row]', { hasText: 'Zeta search target' })).toBeVisible();
    await expect(page.locator('[data-row]', { hasText: 'Alpha other' })).toHaveCount(0);
  });
});

test.describe('slow network', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('rapid actions on one loop are queued, not dropped', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const title = `Latency ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();
    // Every mutation takes 400 ms to reach the server.
    await page.route('**/api/loops/**', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });

    const row = page.locator('[data-row]', { hasText: title });
    await row.getByRole('button', { name: `Start ${title}` }).click();
    await row.getByRole('button', { name: /Toggle priority/ }).click();
    // Optimistic UI shows both immediately…
    await expect(row).toHaveAttribute('data-state', 'running');
    await expect(row).toHaveAttribute('data-priority', 'true');
    // …and the server ends up with both.
    await expect
      .poll(async () => {
        const s = await (await page.request.get('/api/state', { headers: H })).json();
        const l = s.loops.find((x: { title: string }) => x.title === title);
        return `${l.state}:${l.priority}`;
      }, { timeout: 5000 })
      .toBe('running:true');
    await expect(row).toHaveAttribute('data-priority', 'true');
  });
});

const WIDTHS: { width: number; mode: string }[] = [
  { width: 180, mode: 'rail' },
  { width: 220, mode: 'rail' },
  { width: 260, mode: 'rail' },
  { width: 375, mode: 'mobile' },
  { width: 393, mode: 'mobile' },
  { width: 450, mode: 'mobile' },
  { width: 720, mode: 'desk' },
  { width: 1024, mode: 'desk' },
  { width: 1440, mode: 'wide' },
];

test.describe('responsive smoke', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    await resetData(page.request);
    const make = async (title: string, note: string, start: boolean) => {
      const id = crypto.randomUUID();
      await page.request.post('/api/loops', { headers: H, data: { id, title, note, start } });
      return id;
    };
    const prio = await make('Hikari Business Model with a deliberately long title that must truncate', 'Financial model — three-year projection, unit economics tab still rough', true);
    await page.request.patch(`/api/loops/${prio}`, { headers: H, data: { priority: true } });
    await make('Yuna Research', 'Competitor teardown', true);
    await make('Investor Update', 'September metrics', false);
    await make('Trademark Filing', '', false);
    await page.close();
  });

  for (const { width, mode } of WIDTHS) {
    test(`${width}px renders ${mode} without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await login(page);
      await expect(page.locator('.app')).toHaveAttribute('data-mode', mode);
      await expect(page.locator('[data-row]').first()).toBeVisible();

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const list = document.querySelector('.list') as HTMLElement;
        const overflowing = Array.from(document.querySelectorAll<HTMLElement>('.app *'))
          .filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > window.innerWidth + 0.5)
          .filter((el) => !el.closest('.marquee'))
          .filter((el) => getComputedStyle(el).position !== 'fixed')
          .map((el) => el.className);
        const markers = Array.from(document.querySelectorAll<HTMLElement>('.marker:not(.marker--closed)')).map((m) => {
          const r = m.getBoundingClientRect();
          return { w: r.width, h: r.height, radius: getComputedStyle(m).borderRadius };
        });
        return { docOverflow: doc.scrollWidth - window.innerWidth, listOverflow: list.scrollWidth - list.clientWidth, overflowing, markers };
      });
      expect(layout.overflowing).toEqual([]);
      expect(layout.docOverflow).toBeLessThanOrEqual(0);
      expect(layout.listOverflow).toBeLessThanOrEqual(0);
      expect(layout.markers.length).toBeGreaterThan(0);
      for (const m of layout.markers) {
        expect(m).toEqual({ w: 6, h: 6, radius: '50%' });
      }

      // Primary controls are present and usable.
      await expect(page.getByRole('button', { name: /New loop|NEW/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop Yuna Research' })).toBeVisible();
      await expect(page.locator('[data-row][data-state="running"] .row__timer').first()).toBeVisible();
      if (mode === 'mobile') await expect(page.getByRole('tablist', { name: 'Filter loops' })).toBeVisible();
      if (mode === 'desk' || mode === 'wide') await expect(page.getByRole('textbox', { name: /New loop title/ })).toBeVisible();
      if (mode === 'wide') await expect(page.locator('.insp-pane .inspector')).toBeVisible();

      // Stop / start through the dedicated control works at every width.
      await page.getByRole('button', { name: 'Stop Yuna Research' }).click();
      await expect(page.getByRole('button', { name: 'Resume Yuna Research' })).toBeVisible();
      await page.getByRole('button', { name: 'Resume Yuna Research' }).click();
      await expect(page.getByRole('button', { name: 'Stop Yuna Research' })).toBeVisible();

      await page.screenshot({ path: `test-results/responsive-${width}.png` });
    });
  }
});
