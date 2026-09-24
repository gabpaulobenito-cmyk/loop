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
  test.use({ viewport: { width: 700, height: 800 } });

  test('create, start, stop, resume, prioritize, inspect, close, reopen, persist', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    await page.reload();

    const title = `E2E Alpha ${Date.now()}`;
    await page.getByRole('button', { name: 'New loop' }).first().click();
    const newLoop = page.getByRole('dialog', { name: 'NEW LOOP' });
    await newLoop.locator('#capture-title').fill(title);
    await newLoop.locator('#capture-note').fill('context from e2e');
    await newLoop.getByRole('button', { name: /^\[⏎\] START$/ }).click();
    await expect(newLoop).toHaveCount(0);

    const running = page.getByRole('list', { name: 'Running loops' });
    const row = running.locator('[data-row]', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('context from e2e');
    await expect(row.locator('[data-marker="running"]')).toBeVisible();

    // Rows read to the hour; the exact clock lives in the details pop-up.
    await expect(row.locator('.row__timer')).toHaveText('<1M');
    const detailTimer = page.getByRole('dialog', { name: 'Loop details' }).locator('.insp-head__timer');
    const readDetail = async () => {
      await row.locator('.row__title').click();
      const value = await expect
        .poll(async () => secs(await detailTimer.innerText()), { timeout: 6000 })
        .toBeGreaterThanOrEqual(1)
        .then(async () => secs(await detailTimer.innerText()));
      await page.keyboard.press('Escape');
      await expect(detailTimer).toHaveCount(0);
      return value;
    };
    const t1 = await readDetail();
    expect(t1).toBeGreaterThanOrEqual(1);

    // Timer survives a reload (timestamp based, not a client counter).
    await page.reload();
    await expect(row).toBeVisible();
    const t2 = await readDetail();
    expect(t2).toBeGreaterThanOrEqual(t1);

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
    expect(await readDetail()).toBeGreaterThanOrEqual(t2);

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
  for (const width of [700, 393, 220]) {
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

      // Add a note — the checklist's first unchecked line is what the row reads.
      await actions.getByRole('button', { name: 'ADD NOTE' }).click();
      const addNote = dialog.getByRole('textbox', { name: 'Add a note' });
      await addNote.fill('note from pop-up');
      await addNote.press('Enter');
      await expect(dialog.locator('.note__text')).toHaveText('note from pop-up');
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

test.describe('focus', () => {
  const make = async (page: import('@playwright/test').Page, title: string) => {
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
  };

  test.describe('on a wide window', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('holds three loops, takes them out of the other sections, and lets them go', async ({ page }) => {
      await login(page);
      await resetData(page.request);
      const stamp = Date.now();
      const titles = [0, 1, 2, 3].map((i) => `Focus ${i} ${stamp}`);
      for (const t of titles) await make(page, t);
      await page.reload();

      const focusSection = page.getByRole('region', { name: 'Focused loops' });
      const openSection = page.getByRole('region', { name: 'Open loops' });
      const pane = page.locator('.insp-pane');
      await expect(focusSection).toContainText('NOTHING IN FOCUS');
      await expect(focusSection.locator('.sect__count')).toHaveText('00/03');

      const pick = async (title: string) => {
        await page.locator('[data-row]', { hasText: title }).click({ position: { x: 4, y: 4 } });
        await pane.getByRole('group', { name: 'Loop actions' }).getByRole('button', { name: 'FOCUS', exact: true }).click();
      };

      // Picking one starts its clock and moves it out of OPEN.
      await pick(titles[0]);
      const first = focusSection.locator('[data-row]', { hasText: titles[0] });
      await expect(first).toHaveAttribute('data-state', 'running');
      await expect(first).toHaveAttribute('data-focus', 'true');
      await expect(openSection.locator('[data-row]', { hasText: titles[0] })).toHaveCount(0);
      await expect(focusSection.locator('.sect__count')).toHaveText('01/03');
      await expect(pane.locator('.term-bar__focus')).toHaveText(/FOCUS/);

      // Three is the limit; the fourth is refused and stays where it was.
      await pick(titles[1]);
      await pick(titles[2]);
      await expect(focusSection.locator('.sect__count')).toHaveText('03/03');
      await expect(focusSection).toContainText('ALL SLOTS TAKEN');
      await pick(titles[3]);
      await expect(page.locator('.status__note')).toContainText('Focus holds 3 loops');
      await expect(openSection.locator('[data-row]', { hasText: titles[3] })).toBeVisible();
      await expect(focusSection.locator('[data-row]')).toHaveCount(3);

      // The stop button in FOCUS says RELEASE, and hands the loop back to OPEN.
      await first.getByRole('button', { name: `Release ${titles[0]}` }).click();
      await expect(focusSection.locator('[data-row]', { hasText: titles[0] })).toHaveCount(0);
      await expect(openSection.locator('[data-row]', { hasText: titles[0] })).toHaveAttribute('data-state', 'open');
      await expect(focusSection.locator('.sect__count')).toHaveText('02/03');

      // It survives a reload, and closing a focused loop lets it go too.
      await page.reload();
      await expect(focusSection.locator('[data-row]')).toHaveCount(2);
      await focusSection.locator('[data-row]', { hasText: titles[1] }).click({ position: { x: 4, y: 4 } });
      await pane.getByRole('group', { name: 'Loop actions' }).getByRole('button', { name: 'CLOSE LOOP' }).click();
      await expect(focusSection.locator('[data-row]', { hasText: titles[1] })).toHaveCount(0);
      await expect(focusSection.locator('.sect__count')).toHaveText('01/03');

      // Undo puts it back in focus, still on the clock.
      await page.getByRole('button', { name: /^Undo: Closed/ }).click();
      const back = focusSection.locator('[data-row]', { hasText: titles[1] });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute('data-state', 'running');
    });
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 393, height: 800 } });

    test('has its own tab, and F picks a loop up from the pop-up', async ({ page }) => {
      await login(page);
      await resetData(page.request);
      const title = `Phone focus ${Date.now()}`;
      await make(page, title);
      await page.reload();

      const tabs = page.getByRole('tablist', { name: 'Filter loops' });
      await expect(tabs.getByRole('tab', { name: /^FOCUS/ })).toHaveText('FOCUS 00');

      await page.locator('[data-row]', { hasText: title }).click({ position: { x: 4, y: 4 } });
      const dialog = page.getByRole('dialog', { name: 'Loop details' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('f');
      await expect(dialog.getByRole('button', { name: 'RELEASE', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      await expect(tabs.getByRole('tab', { name: /^FOCUS/ })).toHaveText('FOCUS 01');
      await tabs.getByRole('tab', { name: /^FOCUS/ }).click();
      const row = page.locator('[data-row]', { hasText: title });
      await expect(row).toHaveAttribute('data-focus', 'true');
      await expect(row).toHaveAttribute('data-state', 'running');
      // The phone list never scrolls sideways, focus rows included.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
    });
  });
});

test.describe('the notes checklist', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('holds several notes, and the top unchecked one is the line the row reads', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const title = `Checklist ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();

    const row = page.locator('[data-row]', { hasText: title });
    await row.click({ position: { x: 4, y: 4 } });
    const pane = page.locator('.insp-pane');
    await expect(pane.locator('.insp-head__title')).toHaveText(title);

    // Several notes, written one after another without leaving the field.
    const add = pane.getByRole('textbox', { name: 'Add a note' });
    for (const line of ['pull the numbers', 'write the summary', 'send it']) {
      await add.fill(line);
      await add.press('Enter');
    }
    const notes = pane.locator('.note');
    await expect(notes).toHaveCount(3);
    await expect(notes.locator('.note__text')).toHaveText(['pull the numbers', 'write the summary', 'send it']);

    // The first one is on the row, and it marquees there.
    await expect(notes.nth(0)).toHaveClass(/is-active/);
    await expect(notes.nth(0).locator('.note__tag')).toHaveText('ON ROW');
    await expect(row.locator('.row__note')).toHaveText('pull the numbers');

    // Checking it off hands the row to the next unchecked line, in place.
    await notes.nth(0).getByRole('checkbox').click();
    await expect(notes.nth(0)).toHaveClass(/is-done/);
    await expect(notes.locator('.note__text')).toHaveText(['pull the numbers', 'write the summary', 'send it']);
    await expect(row.locator('.row__note')).toHaveText('write the summary');
    await expect(notes.nth(1).locator('.note__tag')).toHaveText('ON ROW');

    // Rearranging is how the row's line is chosen: alt + ↑ lifts 'send it' over it.
    await notes.nth(2).getByRole('checkbox').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(notes.locator('.note__text')).toHaveText(['pull the numbers', 'send it', 'write the summary']);
    await expect(row.locator('.row__note')).toHaveText('send it');

    // Editing a line in place, and the whole list surviving a reload.
    await notes.nth(1).locator('.note__text').click();
    const edit = pane.getByRole('textbox', { name: /^Edit note/ });
    await edit.fill('send it today');
    await edit.press('Enter');
    await expect(row.locator('.row__note')).toHaveText('send it today');

    await page.reload();
    await expect(page.locator('.insp-pane .note__text')).toHaveText(['pull the numbers', 'send it today', 'write the summary']);
    await expect(page.locator('[data-row]', { hasText: title }).locator('.row__note')).toHaveText('send it today');

    // Deleting a line leaves the rest alone.
    await page.locator('.insp-pane .note').nth(1).getByRole('button', { name: /^Delete note/ }).click();
    await expect(page.locator('.insp-pane .note__text')).toHaveText(['pull the numbers', 'write the summary']);
    await expect(page.locator('[data-row]', { hasText: title }).locator('.row__note')).toHaveText('write the summary');

    // With everything checked off the row goes quiet.
    await page.locator('.insp-pane .note').nth(1).getByRole('checkbox').click();
    await expect(page.locator('[data-row]', { hasText: title }).locator('.row__note')).toHaveText('');
  });
});

test.describe('wide windows dock the details', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('details live in a second column, and pop up again once the window narrows', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const stamp = Date.now();
    const running = `Docked running ${stamp}`;
    const open = `Docked open ${stamp}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: running, start: true } });
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: open } });
    await page.reload();

    await expect(page.locator('.app')).toHaveAttribute('data-mode', 'wide');
    const pane = page.locator('.insp-pane');
    await expect(pane).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Loop details' })).toHaveCount(0);

    // The running loop is selected for us, so the column is never empty.
    await expect(pane.locator('.insp-head__title')).toHaveText(running);
    const runningRow = page.locator('[data-row]', { hasText: running });
    await expect(runningRow).toHaveClass(/is-selected/);

    // The pane sits beside the list, not over it, and keeps square corners.
    const listBox = (await page.locator('.list').boundingBox())!;
    const paneBox = (await pane.boundingBox())!;
    expect(paneBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
    expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(1440.5);
    expect(await pane.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');

    // Clicking another row swaps the column's contents without touching its state.
    const openRow = page.locator('[data-row]', { hasText: open });
    await openRow.click({ position: { x: 4, y: 4 } });
    await expect(pane.locator('.insp-head__title')).toHaveText(open);
    await expect(openRow).toHaveClass(/is-selected/);
    await expect(page.getByRole('dialog', { name: 'Loop details' })).toHaveCount(0);
    await page.waitForTimeout(200);
    await expect(openRow).toHaveAttribute('data-state', 'open');

    // Editing still works in the column.
    await pane.getByRole('group', { name: 'Loop actions' }).getByRole('button', { name: 'RENAME' }).click();
    const renamed = `${open} renamed`;
    await pane.getByRole('textbox', { name: 'Loop title' }).fill(renamed);
    await pane.getByRole('textbox', { name: 'Loop title' }).press('Enter');
    await expect(pane.locator('.insp-head__title')).toHaveText(renamed);

    // Narrower windows go back to the centered pop-up.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(page.locator('.app')).toHaveAttribute('data-mode', 'desk');
    await expect(pane).toHaveCount(0);
    await page.locator('[data-row]', { hasText: renamed }).click({ position: { x: 4, y: 4 } });
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.insp-head__title')).toHaveText(renamed);
  });
});

test.describe('edit start time', () => {
  for (const width of [700, 393, 220]) {
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
      await expect(row.locator('.row__timer')).toHaveText(/^3H 0M/);
      await expect
        .poll(async () => {
          const st = await (await page.request.get('/api/state', { headers: H })).json();
          const l = st.loops.find((x: { title: string }) => x.title === title);
          return Math.round((st.serverNow - l.runningSince) / 60_000);
        })
        .toBeGreaterThanOrEqual(179);
      await page.keyboard.press('Escape');
      await page.reload();
      await expect(row.locator('.row__timer')).toHaveText(/^3H 0M/);

      await page.getByRole('button', { name: /^Undo: Moved start of/ }).click();
      await expect(row.locator('.row__timer')).toHaveText(/^<1M|^\d+M$/);
    });
  }

  test('backdating a running loop past earlier sessions merges them instead of blocking', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
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
    await expect(row.locator('.row__timer')).toHaveText(/^1D\s*·\s*0H/);
  });

  test('pick a date and time for when an open loop was opened', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
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
    // Midnight exactly, so the age reads the same whatever time the suite runs.
    await editor.getByLabel('// TIME').fill('00:00');
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
    expect([opened.getDate(), opened.getHours(), opened.getMinutes()]).toEqual([target.getDate(), 0, 0]);
  });
});

test.describe('ball in court', () => {
  for (const width of [700, 393, 220]) {
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
    await expect(page.locator('.viewbar').first()).toContainText('1 DUE');
  });
});

test.describe('header', () => {
  test('desktop header shows local date and time', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await login(page);

    const clock = page.locator('header .hdr__clock');
    await expect(clock).toBeVisible();
    const d = new Date();
    const expected = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
    await expect(clock).toContainText(expected);
    await expect(clock).toHaveText(/^\w{3} \w{3} \d{1,2} \d{1,2}:\d{2}(AM|PM)$/);
  });

  test('the header greets you by name, and phones keep the space for it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await login(page);
    const greet = page.locator('.hdr__greet');
    await expect(greet).toContainText(/Gabriel/i);
    await expect(page.getByRole('heading', { name: 'LOOP', exact: true })).toHaveCount(0);

    // The phone drops the clock — iOS and Android already show one just above.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.locator('header .hdr__clock')).toHaveCount(0);
    await expect(greet).toBeVisible();
    expect(await greet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test('mobile search icon opens the search pop-up', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page);
    await resetData(page.request);
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Findable Hikari task' } });
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Something else' } });
    await page.reload();

    await page.getByRole('button', { name: 'Search loops' }).click();
    const dialog = page.getByRole('dialog', { name: 'Search loops' });
    const box = dialog.getByRole('combobox', { name: 'Search loops' });
    await expect(box).toBeFocused();
    await box.fill('hikari');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await expect(dialog.getByRole('option')).toContainText('Findable Hikari task');
    // ⇧⏎ keeps the query on the list itself.
    await box.press('Shift+Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-row]', { hasText: 'Findable Hikari task' })).toBeVisible();
    await expect(page.locator('[data-row]', { hasText: 'Something else' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });

  test('⌘K opens a centred search pop-up; Enter opens the loop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await resetData(page.request);
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Findable Hikari task' } });
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: 'Something else' } });
    await page.reload();

    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Search loops' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('hikari');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.inspector').first()).toContainText('Findable Hikari task');
    // The list itself is left unfiltered.
    await expect(page.locator('[data-row]', { hasText: 'Something else' })).toBeVisible();
  });
});

test.describe('slow network', () => {
  test.use({ viewport: { width: 700, height: 800 } });

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
  { width: 700, mode: 'desk' },
  { width: 720, mode: 'wide' },
  { width: 1024, mode: 'wide' },
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
      // The header greets by name instead of naming itself, and never overflows.
      const greet = page.locator('.hdr__greet');
      await expect(greet).toBeVisible();
      expect(await greet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

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

test.describe('dual timers', () => {
  test.use({ viewport: { width: 700, height: 800 } });
  const DAY = 86_400_000;

  test('a deadline counts down, escalates and floats to the top', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const calm = `Calm ${Date.now()}`;
    const hot = `Hot ${Date.now()}`;
    const aging = `Aging ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: aging } });
    await page.request.post('/api/loops', {
      headers: H,
      data: { id: crypto.randomUUID(), title: calm, deadlineAt: Date.now() + 9 * DAY },
    });
    await page.request.post('/api/loops', {
      headers: H,
      data: { id: crypto.randomUUID(), title: hot, deadlineAt: Date.now() + 5 * 3_600_000 },
    });
    await page.reload();

    const open = page.getByRole('list', { name: 'Open loops' });
    await expect(open.locator('[data-row]').first()).toContainText(hot);
    await expect(open.locator('[data-row]', { hasText: hot })).toHaveAttribute('data-tier', 'urgent');
    await expect(open.locator('[data-row]', { hasText: calm })).toHaveAttribute('data-tier', 'calm');
    await expect(open.locator('[data-row]', { hasText: aging })).not.toHaveAttribute('data-tier', /./);
    // The countdown reads the deadline, not the loop's own age.
    await expect(open.locator('[data-row]', { hasText: hot }).locator('.dl')).toContainText('DUE');

    // Sub-filters split the two kinds of loop.
    const timers = page.getByRole('group', { name: 'Filter by timer' });
    await timers.getByRole('button', { name: /^DEADLINES/ }).click();
    await expect(open.locator('[data-row]', { hasText: aging })).toHaveCount(0);
    await expect(open.locator('[data-row]', { hasText: hot })).toBeVisible();
    await timers.getByRole('button', { name: /^AGING/ }).click();
    await expect(open.locator('[data-row]', { hasText: hot })).toHaveCount(0);
    await expect(open.locator('[data-row]', { hasText: aging })).toBeVisible();
    await timers.getByRole('button', { name: /^ALL/ }).click();
  });

  test('an ageing loop takes a date in one click; losing one takes two', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    const title = `Converted ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();

    const row = page.locator('[data-row]', { hasText: title });
    await row.click({ position: { x: 4, y: 4 } });
    const dialog = page.getByRole('dialog', { name: 'Loop details' });
    const timer = dialog.getByRole('group', { name: 'Timer' });
    await expect(timer.getByRole('radio', { name: 'AGING' })).toHaveAttribute('aria-checked', 'true');

    // Asking for a deadline opens the calendar straight away — no native date field anywhere.
    await timer.getByRole('radio', { name: 'DEADLINE' }).click();
    const calendar = page.getByRole('dialog', { name: 'LOOP // DEADLINE' });
    await expect(calendar).toBeVisible();
    expect(await page.locator('input[type="date"]').count()).toBe(0);
    const target = new Date(Date.now() + 10 * DAY);
    await calendar.getByRole('gridcell', { name: target.toDateString() }).click();
    await expect(calendar).toHaveCount(0);
    await expect(timer.getByRole('radio', { name: 'DEADLINE' })).toHaveAttribute('aria-checked', 'true');
    await expect(timer).toContainText('IN 10 DAYS');

    // A deadline lands at 17:00 unless it is told otherwise, and the hour is
    // editable next to the day — by hand or from a preset.
    await expect(timer).toContainText('17:00');
    await timer.getByRole('button', { name: /pick another date/i }).click();
    await expect(calendar).toBeVisible();
    const time = calendar.getByRole('textbox', { name: 'Time of day' });
    await time.fill('930');
    await time.press('Enter');
    await expect(timer).toContainText('09:30');
    await calendar.getByRole('button', { name: '12:00' }).click();
    await expect(time).toHaveValue('12:00');
    await expect(timer).toContainText('12:00');
    // The day it lands on is untouched by the hour.
    await expect(timer).toContainText('IN 10 DAYS');
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await expect
      .poll(async () => {
        const st = await (await page.request.get('/api/state', { headers: H })).json();
        const at = new Date(st.loops.find((x: { title: string }) => x.title === title).deadlineAt);
        return [at.getHours(), at.getMinutes()];
      })
      .toEqual([12, 0]);

    // The field reopens it, and Escape leaves the deadline alone.
    await timer.getByRole('button', { name: /pick another date/i }).click();
    await expect(calendar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calendar).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Loop details' })).toBeVisible();
    await expect(timer).toContainText('IN 10 DAYS');

    await timer.getByRole('button', { name: 'NEXT WEEK' }).click();
    await expect(timer).toContainText('IN 7 DAYS');
    // Moving the day keeps the hour the loop is owed by.
    await expect(timer).toContainText('12:00');

    // Asking for the ageing timer only raises the question; the deadline survives it.
    await timer.getByRole('radio', { name: 'AGING' }).click();
    await expect(timer).toContainText('THIS DEADLINE NO LONGER APPLIES?');
    await timer.getByRole('button', { name: 'KEEP' }).click();
    await expect(timer.getByRole('radio', { name: 'DEADLINE' })).toHaveAttribute('aria-checked', 'true');

    await timer.getByRole('radio', { name: 'AGING' }).click();
    await timer.getByRole('button', { name: 'DROP IT' }).click();
    await expect(timer.getByRole('radio', { name: 'AGING' })).toHaveAttribute('aria-checked', 'true');
    await expect(timer).toContainText('NO DEADLINE');
    await expect
      .poll(async () => {
        const st = await (await page.request.get('/api/state', { headers: H })).json();
        const l = st.loops.find((x: { title: string }) => x.title === title);
        return [l.timerType, l.deadlineAt];
      })
      .toEqual(['elapsed', null]);
  });

  test('the server refuses to clear a deadline without switching the timer', async ({ page }) => {
    await login(page);
    const id = crypto.randomUUID();
    await page.request.post('/api/loops', {
      headers: H,
      data: { id, title: `Guarded ${Date.now()}`, deadlineAt: Date.now() + 2 * DAY },
    });
    const res = await page.request.patch(`/api/loops/${id}`, { headers: H, data: { deadlineAt: null } });
    expect(res.status()).toBe(409);
    await page.request.delete(`/api/loops/${id}`, { headers: H });
  });
});

test.describe('work / personal scope', () => {
  // Desk width: the details open as a pop-up, as in the other suites.
  test.use({ viewport: { width: 700, height: 900 } });

  test('separates the two worlds, captures into the one you are in, and warns about the other', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    // Every device starts in work, whatever the last test left behind.
    await page.evaluate(() => localStorage.removeItem('loop.scope'));
    await page.reload();

    const work = `Work item ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title: work } });
    await page.reload();

    const scope = page.getByRole('group', { name: 'Work or personal' }).first();
    const list = page.getByRole('main', { name: 'Loops' });
    await expect(scope.getByRole('button', { name: /^WORK/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(list.locator('[data-row]', { hasText: work })).toBeVisible();

    // A loop captured in personal is born there and leaves the work list alone.
    await scope.getByRole('button', { name: /^PERSONAL/ }).click();
    await expect(list.locator('[data-row]', { hasText: work })).toHaveCount(0);

    const personal = `Personal item ${Date.now()}`;
    await page.getByRole('button', { name: 'New loop' }).first().click();
    const newLoop = page.getByRole('dialog', { name: 'NEW LOOP' });
    await expect(newLoop.getByRole('button', { name: 'PERSONAL' })).toHaveAttribute('aria-pressed', 'true');
    await newLoop.locator('#capture-title').fill(personal);
    await newLoop.getByRole('button', { name: /ADD WITHOUT STARTING$/ }).click();
    await expect(list.locator('[data-row]', { hasText: personal })).toBeVisible();

    await scope.getByRole('button', { name: /^WORK/ }).click();
    await expect(list.locator('[data-row]', { hasText: personal })).toHaveCount(0);
    await expect(list.locator('[data-row]', { hasText: work })).toBeVisible();

    // BOTH shows everything, and says which rows are the personal ones.
    await scope.getByRole('button', { name: /^BOTH/ }).click();
    await expect(list.locator('[data-row]', { hasText: work })).toBeVisible();
    await expect(list.locator('[data-row]', { hasText: personal }).locator('.row__scope')).toHaveText('PERS');
    await expect(list.locator('[data-row]', { hasText: work }).locator('.row__scope')).toHaveCount(0);

    // A personal deadline in its last day reports itself from the work list.
    await page.request.post('/api/loops', {
      headers: H,
      data: { id: crypto.randomUUID(), title: `Due soon ${Date.now()}`, scope: 'personal', deadlineAt: Date.now() + 4 * 3_600_000 },
    });
    // Created outside the app, so the client has to pick it up.
    await page.reload();
    await scope.getByRole('button', { name: /^WORK/ }).click();
    await expect(scope.getByRole('button', { name: /^PERSONAL/ }).locator('.scope__fire')).toHaveText('1');
    // Looking at both worlds, nothing is unseen, so nothing is flagged.
    await scope.getByRole('button', { name: /^BOTH/ }).click();
    await expect(scope.locator('.scope__fire')).toHaveCount(0);
  });

  test('W cycles the scope and the choice survives a reload', async ({ page }) => {
    await login(page);
    await page.evaluate(() => localStorage.removeItem('loop.scope'));
    await page.reload();
    const scope = page.getByRole('group', { name: 'Work or personal' }).first();

    await page.keyboard.press('w');
    await expect(scope.getByRole('button', { name: /^PERSONAL/ })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(scope.getByRole('button', { name: /^PERSONAL/ })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('w');
    await expect(scope.getByRole('button', { name: /^BOTH/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('w');
    await expect(scope.getByRole('button', { name: /^WORK/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a loop moves between worlds from its details, and undo puts it back', async ({ page }) => {
    await login(page);
    await resetData(page.request);
    await page.evaluate(() => localStorage.removeItem('loop.scope'));
    const title = `Movable ${Date.now()}`;
    await page.request.post('/api/loops', { headers: H, data: { id: crypto.randomUUID(), title } });
    await page.reload();

    const list = page.getByRole('main', { name: 'Loops' });
    await list.locator('[data-row]', { hasText: title }).click({ position: { x: 4, y: 4 } });
    const details = page.getByRole('dialog', { name: 'Loop details' });
    await details.getByRole('button', { name: 'MOVE TO PERSONAL' }).click();

    // It leaves the work list immediately and says so in its own title bar.
    await expect(list.locator('[data-row]', { hasText: title })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(list.locator('[data-row]', { hasText: title })).toBeVisible();
  });
});
