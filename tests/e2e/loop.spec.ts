import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const H = { 'x-loop-client': '1' };

async function login(page: Page) {
  await page.goto('/');
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

test('opens straight into the workspace with no sign-in', async ({ page, request }) => {
  expect((await request.get('/api/state')).status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Loops' })).toBeVisible();
  await expect(page.getByLabel('ACCESS KEY')).toHaveCount(0);
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

    // Clicking the row only opens details — it must not start the loop.
    await openRow.locator('.row__title').click();
    const inspector = page.getByRole('dialog', { name: 'Loop details' });
    await expect(inspector).toBeVisible();
    await page.waitForTimeout(400);
    await expect(openRow).toHaveAttribute('data-state', 'open');
    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);

    // Resume with the ▶ button. Pause past the double-tap guard.
    await page.getByRole('button', { name: `Resume ${title}` }).click();
    await expect(row).toBeVisible();
    // Accumulated time carries over into the resumed session.
    await expect.poll(async () => secs(await timer.innerText()), { timeout: 6000 }).toBeGreaterThanOrEqual(t2 + 1);

    // Priority lives in the details pop-up; toggling it doesn't touch the timer.
    await row.click();
    await expect(inspector).toBeVisible();
    await inspector.getByRole('button', { name: 'PRIORITY', exact: true }).click();
    await expect(row.locator('[data-marker="priority"]')).toBeVisible();
    await expect(row).toHaveAttribute('data-state', 'running');

    // Details show real session history.
    await expect(inspector.getByRole('list', { name: 'Session history' }).locator('li')).toHaveCount(2);
    await expect(inspector.getByText('→ NOW')).toBeVisible();

    // Closing a running loop finalizes its session.
    await inspector.getByRole('button', { name: /CLOSE LOOP/ }).click();
    await expect(inspector.getByRole('button', { name: /REOPEN/ }).first()).toBeVisible();
    await expect(inspector.getByText('→ NOW')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator(`[data-row]`, { hasText: title })).toHaveCount(0);

    // Undo restores it to running.
    await page.getByRole('button', { name: new RegExp(`^Undo: Closed ${title}`) }).click();
    await expect(row).toBeVisible();

    // Close again, then reopen from the archive.
    await row.click();
    await inspector.getByRole('button', { name: /CLOSE LOOP/ }).click();
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

test.describe('new loop pop-up', () => {
  for (const width of [1280, 393, 220]) {
    test(`+ opens a centered pop-up; Enter starts the loop at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await login(page);
      await resetData(page.request);
      await page.reload();

      await page.getByRole('button', { name: /^(NEW LOOP|New loop|\+ ?NEW)/i }).first().click();
      const dialog = page.getByRole('dialog', { name: 'NEW LOOP' });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);

      const title = dialog.getByRole('textbox', { name: 'WHAT ARE YOU STARTING?' });
      await expect(title).toBeFocused();
      const name = `Popup ${width} ${Date.now()}`;
      await title.fill(name);
      const note = dialog.locator('#capture-note');
      await note.fill('context from the pop-up');
      await expect(dialog.getByRole('button', { name: /START/ }).last()).toBeEnabled();
      await note.press('Enter');

      await expect(dialog).toHaveCount(0);
      const row = page.locator('[data-row]', { hasText: name });
      await expect(row).toHaveAttribute('data-state', 'running');
      await expect(row).toContainText('context from the pop-up');
    });
  }

  test('add without starting and cancel', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await login(page);
    await resetData(page.request);
    await page.reload();

    await page.keyboard.press('n');
    const dialog = page.getByRole('dialog', { name: 'NEW LOOP' });
    await expect(dialog.getByRole('button', { name: /START/ }).last()).toBeDisabled();
    const name = `Open only ${Date.now()}`;
    await dialog.locator('#capture-title').fill(name);
    await dialog.getByRole('button', { name: /ADD WITHOUT STARTING/ }).click();
    await expect(page.locator('[data-row]', { hasText: name })).toHaveAttribute('data-state', 'open');

    await page.getByRole('button', { name: /NEW LOOP/ }).click();
    await dialog.locator('#capture-title').fill('should not be created');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-row]', { hasText: 'should not be created' })).toHaveCount(0);
  });
});

test.describe('row opens the details pop-up', () => {
  for (const width of [1280, 393, 220]) {
    test(`rename, note, delete and undo from the pop-up at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await login(page);
      await resetData(page.request);
      const title = `Details ${width} ${Date.now()}`;
      await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title, start: true } });
      await page.reload();

      // No ⋮ button any more; the row itself opens details and never toggles state.
      await expect(page.locator('[data-ctl="more"]')).toHaveCount(0);
      const row = page.locator('[data-row]', { hasText: title });
      await row.click({ position: { x: 4, y: 4 } });
      const dialog = page.getByRole('dialog', { name: 'Loop details' });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(200);
      await expect(row).toHaveAttribute('data-state', 'running');

      // Centered pop-up inside the viewport with square corners.
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      expect(await dialog.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
      if (width >= 600) expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(2);

      const actions = dialog.getByRole('group', { name: 'Loop actions' });
      expect((await actions.boundingBox())!.y).toBeLessThan((await dialog.locator('.insp-stats').boundingBox())!.y);
      for (const name of ['CLOSE LOOP', 'PRIORITY', 'RENAME', 'ADD NOTE', 'DELETE']) {
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
      }

      // Rename
      await actions.getByRole('button', { name: 'RENAME' }).click();
      const renamed = `${title} renamed`;
      await dialog.getByRole('textbox', { name: 'Loop title' }).fill(renamed);
      await dialog.getByRole('textbox', { name: 'Loop title' }).press('Enter');
      await expect(dialog.locator('.insp-head__title')).toHaveText(renamed);

      // Add a note
      await actions.getByRole('button', { name: 'ADD NOTE' }).click();
      await dialog.getByRole('textbox', { name: 'Context note' }).fill('note from pop-up');
      await dialog.getByRole('textbox', { name: 'Context note' }).press('Enter');
      await expect(dialog.locator('.insp-head__note')).toHaveText('note from pop-up');

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      const renamedRow = page.locator('[data-row]', { hasText: renamed });
      await page.reload();
      await expect(renamedRow).toContainText('note from pop-up');

      // Delete needs a confirming second click, then closes the pop-up.
      await renamedRow.click({ position: { x: 4, y: 4 } });
      await actions.getByRole('button', { name: 'DELETE' }).click();
      await expect(renamedRow).toBeVisible();
      await actions.getByRole('button', { name: 'CONFIRM' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(renamedRow).toHaveCount(0);
      await page.reload();
      await expect(renamedRow).toHaveCount(0);

      // Undo brings it back, still running.
      await page.getByRole('button', { name: /^Undo: Deleted/ }).click();
      await expect(renamedRow).toBeVisible();
      await expect(renamedRow).toHaveAttribute('data-state', 'running');
    });
  }
});

test.describe('edit start time', () => {
  for (const width of [1280, 393, 220]) {
    test(`backdate a running loop with the calendar at ${width}px, then undo`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await resetData(page.request);
      const title = `Backdate ${width} ${Date.now()}`;
      await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title, start: true } });
      await page.reload();

      const row = page.locator('[data-row]', { hasText: title });
      await row.click({ position: { x: 4, y: 4 } });
      const dialog = page.getByRole('dialog', { name: 'Loop details' });
      await dialog.getByRole('button', { name: 'EDIT START' }).click();
      const editor = dialog.getByRole('group', { name: 'Edit when this session started' });
      await expect(editor).toBeVisible();
      await expect(editor.getByRole('grid', { name: 'Choose a date' })).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);

      // Future days can't be picked.
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowCell = editor.getByRole('gridcell', { name: tomorrow.toDateString() });
      if (await tomorrowCell.count()) await expect(tomorrowCell).toBeDisabled();

      await editor.getByRole('button', { name: '3H AGO' }).click();
      await expect(editor).toContainText('TIMER → 03:00');
      await editor.getByRole('button', { name: /SAVE START/ }).click();
      await expect(editor).toHaveCount(0);

      // The row timer now counts from three hours ago, and it persists.
      await expect(row.locator('.row__timer')).toHaveText(/^03:00/);
      await expect
        .poll(async () => {
          const st = await (await page.request.get('/api/state', { headers: H })).json();
          const l = st.loops.find((x: { title: string }) => x.title === title);
          return Math.round((st.serverNow - l.runningSince) / 60_000);
        })
        .toBeGreaterThanOrEqual(179);
      await page.keyboard.press('Escape');
      await page.reload();
      await expect(row.locator('.row__timer')).toHaveText(/^03:00/);

      await page.getByRole('button', { name: /^Undo: Moved start of/ }).click();
      await expect(row.locator('.row__timer')).toHaveText(/^00:/);
    });
  }

  test('backdating a running loop past earlier sessions merges them instead of blocking', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await login(page);
    await resetData(page.request);
    const title = `Merge ${Date.now()}`;
    const id = crypto.randomUUID();
    await page.request.post('/api/loops', { headers: H, data: { id, title, start: true } });
    await page.request.post(`/api/loops/${id}/stop`, { headers: H });
    await page.request.post(`/api/loops/${id}/start`, { headers: H });
    await page.request.post(`/api/loops/${id}/stop`, { headers: H });
    await page.request.post(`/api/loops/${id}/start`, { headers: H });
    await page.reload();

    const row = page.locator('[data-row]', { hasText: title });
    await row.click({ position: { x: 4, y: 4 } });
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    await expect(dialog.getByRole('list', { name: 'Session history' }).locator('li')).toHaveCount(3);
    await dialog.getByRole('button', { name: 'EDIT START' }).click();
    const editor = dialog.getByRole('group', { name: 'Edit when this session started' });
    await editor.getByRole('button', { name: 'YESTERDAY' }).click();
    await expect(editor.getByRole('status')).toHaveText('↳ Merges 2 earlier sessions into this one');
    const save = editor.getByRole('button', { name: /SAVE START/ });
    await expect(save).toBeEnabled();
    await save.click();

    await expect(dialog.getByRole('list', { name: 'Session history' }).locator('li')).toHaveCount(1);
    await expect
      .poll(async () => {
        const st = await (await page.request.get('/api/state', { headers: H })).json();
        const l = st.loops.find((x: { id: string }) => x.id === id);
        return [l.sessionCount, Math.round((st.serverNow - l.runningSince) / 3_600_000)];
      })
      .toEqual([1, 24]);
    await expect(row.locator('.row__timer')).toHaveText(/^1D\s*·\s*00:0/);
  });

  test('pick a date and time for when an open loop was opened', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await login(page);
    await resetData(page.request);
    const title = `Opened earlier ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();

    const row = page.locator('[data-row]', { hasText: title });
    await row.click({ position: { x: 4, y: 4 } });
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    await dialog.getByRole('button', { name: 'EDIT START' }).click();
    const editor = dialog.getByRole('group', { name: 'Edit when this loop was opened' });

    const target = new Date();
    target.setDate(target.getDate() - 3);
    if (target.getMonth() !== new Date().getMonth()) await editor.getByRole('button', { name: 'Previous month' }).click();
    await editor.getByRole('gridcell', { name: target.toDateString() }).click();
    await editor.getByLabel('// TIME').fill('09:30');
    await expect(editor).toContainText('OPEN FOR → 3 days');
    await editor.getByLabel('// TIME').press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(dialog.locator('.insp-stats')).toContainText('3 days');
    await expect
      .poll(async () => {
        const st = await (await page.request.get('/api/state', { headers: H })).json();
        return st.undo?.label ?? '';
      })
      .toMatch(/^Moved start of/);
    await page.keyboard.press('Escape');
    await expect(row.locator('.row__age')).toHaveText('3 days');

    const s = await (await page.request.get('/api/state', { headers: H })).json();
    const l = s.loops.find((x: { title: string }) => x.title === title);
    const opened = new Date(l.createdAt);
    expect([opened.getDate(), opened.getHours(), opened.getMinutes()]).toEqual([target.getDate(), 9, 30]);
  });
});

test.describe('ball in court', () => {
  for (const width of [1280, 393, 220]) {
    test(`delegate, follow up, filter and take back at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await resetData(page.request);
      const mine = `Mine ${width} ${Date.now()}`;
      const title = `Delegate ${width} ${Date.now()}`;
      await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: mine } });
      await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title, start: true } });
      await page.request.put('/api/settings', { headers: H, data: { ownerFilter: 'all' } });
      await page.reload();

      const row = page.locator('[data-row]', { hasText: title });
      await expect(row).toHaveAttribute('data-owner', 'mine');
      await row.click({ position: { x: 4, y: 4 } });
      const dialog = page.getByRole('dialog', { name: 'Loop details' });
      const panel = dialog.getByRole('group', { name: 'Ball in court' });
      await expect(panel.getByRole('radio', { name: 'MINE' })).toHaveAttribute('aria-checked', 'true');

      // Delegate: the name field is focused right away.
      await panel.getByRole('radio', { name: /DELEGATED/ }).click();
      const withInput = panel.locator('#own-with');
      await expect(withInput).toBeFocused();
      await withInput.fill('JG');
      await withInput.press('Enter');
      // Escape cancels an edit instead of saving it.
      await withInput.fill('Someone else');
      await withInput.press('Escape');
      await expect(withInput).toHaveValue('JG');
      await panel.getByRole('button', { name: 'TOMORROW' }).click();
      await expect(panel.getByRole('status')).toContainText('TOMORROW');
      await expect(panel).toContainText('OUT');

      await page.keyboard.press('Escape');
      await expect(row).toHaveAttribute('data-owner', 'delegated');
      await expect(row.locator('.row__owner')).toContainText('JG');
      await expect(row.locator('.row__out')).toBeVisible();
      // Timer state is untouched by handing off.
      await expect(row).toHaveAttribute('data-state', 'running');

      // Persisted
      await expect
        .poll(async () => {
          const st = await (await page.request.get('/api/state', { headers: H })).json();
          const l = st.loops.find((x: { title: string }) => x.title === title);
          return [l.owner, l.ownerWith, l.followUpAt != null];
        })
        .toEqual(['delegated', 'JG', true]);
      await page.reload();
      await expect(row).toHaveAttribute('data-owner', 'delegated');

      // OUT filter shows only out-of-hands loops; MINE hides them.
      const view = page.getByRole('group', { name: 'Filter by who is moving it' });
      await view.getByRole('button', { name: /^OUT/ }).click();
      await expect(row).toBeVisible();
      await expect(page.locator('[data-row]', { hasText: mine })).toHaveCount(0);
      await view.getByRole('button', { name: /^MINE/ }).click();
      await expect(row).toHaveCount(0);
      await expect(page.locator('[data-row]', { hasText: mine })).toBeVisible();
      await view.getByRole('button', { name: /^ALL/ }).click();

      // Take it back.
      await row.click({ position: { x: 4, y: 4 } });
      await panel.getByRole('radio', { name: 'MINE' }).click();
      await page.keyboard.press('Escape');
      await expect(row).toHaveAttribute('data-owner', 'mine');
      await expect(row.locator('.row__owner')).toHaveCount(0);
    });
  }

  test('overdue follow-ups brighten the row and show DUE', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await login(page);
    await resetData(page.request);
    const title = `Overdue ${Date.now()}`;
    const id = crypto.randomUUID();
    await page.request.post('/api/loops', { headers: H, data: { id, title } });
    await page.request.patch(`/api/loops/${id}`, {
      headers: H,
      data: { owner: 'waiting', ownerWith: 'Mike Bell', followUpAt: Date.now() - 86_400_000 },
    });
    await page.reload();
    const row = page.locator('[data-row]', { hasText: title });
    await expect(row).toHaveClass(/is-due/);
    await expect(row.locator('.row__owner')).toContainText('DUE');
    await expect(page.getByRole('group', { name: 'Filter by who is moving it' })).toContainText('1 DUE');
  });
});

test.describe('header', () => {
  test('mobile search icon opens search; header shows local date and time', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page);
    await resetData(page.request);
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Findable Hikari task' } });
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Something else' } });
    await page.reload();

    const clock = page.locator('header .hdr__clock');
    await expect(clock).toBeVisible();
    const d = new Date();
    const expected = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
    await expect(clock).toContainText(expected);
    await expect(clock).toHaveText(/^\w{3} \w{3} \d{1,2} \d{1,2}:\d{2}(AM|PM)$/);

    await page.getByRole('button', { name: 'Search loops' }).click();
    const box = page.getByRole('searchbox', { name: 'Search loops' });
    await expect(box).toBeFocused();
    await box.fill('hikari');
    await expect(page.locator('[data-row]', { hasText: 'Findable Hikari task' })).toBeVisible();
    await expect(page.locator('[data-row]', { hasText: 'Something else' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
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
      if (route.request().method() !== 'GET') await new Promise((r) => setTimeout(r, 400));
      await route.continue().catch(() => {});
    });

    const row = page.locator('[data-row]', { hasText: title });
    await row.click();
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    await dialog.getByRole('button', { name: `Start ${title}` }).click();
    await dialog.getByRole('button', { name: 'PRIORITY', exact: true }).click();
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

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Stop, then resume while the stop request is still in flight.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/loops/**', async (route) => {
      if (route.request().method() !== 'GET') await new Promise((r) => setTimeout(r, 1200));
      await route.continue().catch(() => {});
    });
    await row.getByRole('button', { name: `Stop ${title}` }).click();
    await expect(row).toHaveAttribute('data-state', 'open');
    await page.waitForTimeout(500);
    await row.getByRole('button', { name: `Resume ${title}` }).click();
    await expect(row).toHaveAttribute('data-state', 'running');
    await expect
      .poll(async () => {
        const s = await (await page.request.get('/api/state', { headers: H })).json();
        const l = s.loops.find((x: { title: string }) => x.title === title);
        return `${l.state}:${l.sessionCount}`;
      }, { timeout: 8000 })
      .toBe('running:2');
  });

  test('a double tap on start/stop only toggles once', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const title = `DoubleTap ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();
    const row = page.locator('[data-row]', { hasText: title });
    await row.getByRole('button', { name: `Start ${title}` }).dblclick();
    await expect
      .poll(async () => {
        const s = await (await page.request.get('/api/state', { headers: H })).json();
        const l = s.loops.find((x: { title: string }) => x.title === title);
        return `${l.state}:${l.sessionCount}`;
      })
      .toBe('running:1');
    await page.waitForTimeout(500);
    await expect(row).toHaveAttribute('data-state', 'running');
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

      // Stop / start through the dedicated control works at every width.
      await page.getByRole('button', { name: 'Stop Yuna Research' }).click();
      await expect(page.getByRole('button', { name: 'Resume Yuna Research' })).toBeVisible();
      await page.waitForTimeout(400); // past the double-tap guard
      await page.getByRole('button', { name: 'Resume Yuna Research' }).click();
      await expect(page.getByRole('button', { name: 'Stop Yuna Research' })).toBeVisible();

      await page.screenshot({ path: `test-results/responsive-${width}.png` });
    });
  }
});
