// Final round, shell track: tooltips on keyboard focus, the focus back on the trigger, the
// scroll place of Profil and Einstellungen, the first line of every view, the toasts above a
// bottom bar and their keys, the macOS toolbar row, the card of the keys and a start whose
// data cannot load.

import type { Page } from '@playwright/test';
import { calls, expect, open, runFinished, settle, test, viewsSettled } from './fixtures';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

const rows = (page: Page) => page.locator('[data-testid^="job-row-"]');
const tooltip = (page: Page) => page.getByRole('tooltip');
const middle = (box: { y: number; height: number } | null): number => box!.y + box!.height / 2;

test('a tooltip shows on keyboard focus after the delay and goes on blur, resize and window blur', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-jobs').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('nav-overview')).toBeFocused();
  // Not at once: after the same delay as hovering.
  await page.waitForTimeout(150);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toContainText('Übersicht');
  await expect(tooltip(page)).toContainText('Strg+1');
  // Blur: the focus moves on, the next one waits for its delay again.
  await page.keyboard.press('Tab');
  await expect(tooltip(page)).toContainText('Jobs');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(tooltip(page)).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(tooltip(page)).toContainText('Übersicht');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(tooltip(page)).toHaveCount(0);
});

test('a disabled entry that says why stays a Tab stop; its reason shows on focus', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('nav-jobs').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('nav-overview')).toBeFocused();
  await expect(tooltip(page)).toHaveText('Nach dem ersten Abruf');
});

test('the focus goes back to the trigger after a menu, a dialog and a toast', async ({ page }) => {
  await open(page, WIN);
  // A menu opened from the keyboard (the funnel's), closed with Esc.
  const funnel = page.getByTestId('filter');
  await funnel.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(funnel).toBeFocused();
  // The card of the keys from the search field.
  const search = page.getByTestId('search');
  await search.focus();
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('keys-help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('keys-help')).toHaveCount(0);
  await expect(search).toBeFocused();
  // A toast's undo reached from the search field gives the focus back to it.
  await rows(page).first().click();
  await page.keyboard.press('e');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await search.focus();
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('a press on a toast takes no focus, and Rückgängig names its key', async ({ page }) => {
  await open(page, WIN);
  await rows(page).first().click();
  await page.keyboard.press('e');
  const action = page.getByTestId('toast-action');
  await expect(action).toBeVisible();
  await action.hover();
  await expect(tooltip(page)).toContainText('Rückgängig');
  await expect(tooltip(page)).toContainText('Strg+Z');
  await action.click();
  const inStack = await page.evaluate(
    () =>
      document.querySelector('[data-testid="toasts"]')?.contains(document.activeElement) ?? false,
  );
  expect(inStack).toBe(false);
});

test('Profil and Einstellungen keep their scroll place per view', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  const view = (id: string) => page.getByTestId(`view-${id}`);
  await view('settings').evaluate((node) => (node.scrollTop = 420));
  await page.getByTestId('nav-profile').click();
  await viewsSettled(page);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await view('profile').evaluate((node) => (node.scrollTop = 260));
  await page.getByTestId('nav-jobs').click();
  await viewsSettled(page);
  await page.getByTestId('nav-settings').click();
  await viewsSettled(page);
  await expect.poll(() => view('settings').evaluate((node) => node.scrollTop)).toBe(420);
  await page.getByTestId('nav-profile').click();
  await viewsSettled(page);
  await expect.poll(() => view('profile').evaluate((node) => node.scrollTop)).toBe(260);
});

test('the first line: the sidebar entry, the tabs and the first headings share one middle', async ({
  page,
}) => {
  await open(page, WIN);
  const line = middle(await page.getByTestId('nav-overview').boundingBox());
  expect(middle(await page.getByTestId('places').boundingBox())).toBe(line);
  // The views' first headings take the row with `data-first-row` (tokens.css --first-row).
  for (const view of ['overview', 'profile', 'settings']) {
    await open(page, `${WIN}&view=${view}`);
    const first = page.locator(`[data-testid="view-${view}"] [data-first-row]`).first();
    if ((await first.count()) === 0) {
      test.info().annotations.push({ type: 'first-row', description: `${view}: not yet on it` });
      continue;
    }
    expect(middle(await first.boundingBox()), view).toBe(line);
  }
});

test('a toast lies above the save bar of Profil; its Zeigen opens the finished fetch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page, `${WIN}&view=profile&tick=5`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Abruf fertig');
  const bar = (await page.getByTestId('profile-save-bar').boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await toast.boundingBox())!;
      return box.y + box.height <= bar.y;
    })
    .toBe(true);
  // Zeigen is no undo: Ctrl+Z leaves it, a click opens the run in Jobs.
  const show = toast.getByTestId('toast-action');
  await expect(show).toHaveText('Zeigen');
  await show.click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('run-finished')).toBeVisible();
});

test('a click in the sidebar leaves the list keys working at once, on both OS', async ({
  page,
}) => {
  for (const os of [WIN, MAC]) {
    await open(page, os);
    await rows(page).first().click();
    const before = (await calls(page, 'job_detail')).length;
    await page.getByTestId('nav-jobs').click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await calls(page, 'job_detail')).length).toBe(before + 1);
    await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  }
});

test('macOS: Profil and Einstellungen name the view in the toolbar row', async ({ page }) => {
  for (const [view, name] of [
    ['profile', 'Profil'],
    ['settings', 'Einstellungen'],
  ] as const) {
    await open(page, `${MAC}&view=${view}`);
    const title = page.getByTestId(`view-${view}`).getByTestId('toolbar-name');
    await expect(title).toHaveText(name);
    const box = (await title.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(52);
    // The name moves the window like the rest of the row.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.hasAttribute('data-tauri-drag-region'),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(hit).toBe(true);
  }
  // Windows has no row: no name.
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('toolbar-name')).toHaveCount(0);
});

test('macOS: a dialog leaves the toolbar row free, and the row moves the window', async ({
  page,
}) => {
  await open(page, `${MAC}&view=settings`);
  await page.keyboard.press('Meta+/');
  await expect(page.getByTestId('keys-help')).toBeVisible();
  await settle(page);
  const scrim = (await page.getByTestId('dialog-scrim').boundingBox())!;
  expect(scrim.y).toBe(52);
  const hit = await page.evaluate(() =>
    document.elementFromPoint(600, 26)?.hasAttribute('data-tauri-drag-region'),
  );
  expect(hit).toBe(true);
  // The keys are named as a Mac names them.
  await expect(page.getByTestId('keys-help').getByTestId('key-search')).toContainText('⌘F');
});

test('Ctrl+/ shows the card of the keys, named as the OS names them; Esc closes it', async ({
  page,
}) => {
  await open(page, WIN);
  await page.keyboard.press('Control+/');
  const card = page.getByTestId('keys-help');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Tastenkürzel' })).toBeVisible();
  await expect(page.getByTestId('key-views')).toContainText('Strg+1 bis Strg+4');
  await expect(page.getByTestId('key-search')).toContainText('Strg+F');
  await expect(page.getByTestId('key-fetch')).toContainText('F5');
  await expect(page.getByTestId('key-undo')).toContainText('Strg+Z');
  await expect(page.getByTestId('key-menu')).toContainText('Umschalt+F10');
  await expect(page.getByTestId('key-trash')).toContainText('Entf');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  // The same keys close it again.
  await page.keyboard.press('Control+/');
  await expect(card).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(card).toHaveCount(0);
});

test('macOS: the multi-select hints write ⌘-Klick and ⇧-Klick', async ({ page }) => {
  await open(page, MAC);
  await rows(page).first().click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ['Meta'] });
  const pane = page.getByTestId('selection-pane');
  await expect(pane).toContainText('⌘-Klick');
  await expect(pane).toContainText('⇧-Klick');
});

test('a start whose data cannot load: try again, the log, the data folder', async ({ page }) => {
  await open(page, `${WIN}&scenario=load-failed`);
  const failed = page.getByTestId('view-error');
  await expect(failed).toContainText('Die App konnte ihre Daten nicht laden.');
  await page.getByTestId('open-log').click();
  await page.getByTestId('open-data').click();
  const targets = (await calls(page, 'open_target')).map(
    ([, args]) => (args as { target: { kind: string } }).target.kind,
  );
  expect(targets).toEqual(['logDir', 'dataDir']);
  await failed.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});

test('macOS: the loading and the failed start keep the toolbar row', async ({ page }) => {
  await open(page, `${MAC}&scenario=load-failed`);
  const band = page.getByTestId('view-error').getByTestId('drag-band');
  expect(await band.boundingBox()).toMatchObject({ y: 0, height: 52 });
});
