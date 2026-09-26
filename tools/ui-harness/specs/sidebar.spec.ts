// The sidebar: four views (Übersicht, Jobs, Profil, Einstellungen), the app starts in the
// Übersicht, Ctrl/Cmd+1 to 4 choose them, no counts, the rail at small widths, that the
// sidebar folds only by the window width, and the order of a click when an unsaved profile
// asks first. The places of the jobs are tabs above the list.

import type { Page } from '@playwright/test';
import { calls, expect, open, settle, test } from './fixtures';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

const sidebarWidth = async (page: Page): Promise<number> =>
  Math.round((await page.getByTestId('sidebar').boundingBox())!.width);

/** The one pill lies exactly on the entry (full or rail, a main entry or a smaller sub). */
async function pillOn(page: Page, id: string): Promise<void> {
  const nav = page.getByTestId('sidebar').locator('nav');
  await expect
    .poll(async () => {
      const pill = await nav.locator('.indicator').boundingBox();
      const entry = await page.getByTestId(id).boundingBox();
      // The pill is drawn anew when the entries below the places move: no box for a moment.
      if (pill === null || entry === null) return null;
      return [
        pill.x - entry.x,
        pill.y - entry.y,
        pill.width - entry.width,
        pill.height - entry.height,
      ].map((value) => Math.round(value));
    }, id)
    .toEqual([0, 0, 0, 0]);
}

test('the sidebar shows no counts and no dots: the list says how many jobs are new', async ({
  page,
}) => {
  for (const width of [1360, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, WIN);
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.getByTestId('nav-jobs')).toBeVisible();
    await expect(sidebar.locator('nav .count, nav .dot')).toHaveCount(0);
    await expect(sidebar.getByTestId('nav-jobs')).not.toContainText(/\d/);
  }
});

test('the app starts in the Übersicht; Ctrl+1 to 4 choose the views, the keys in the tooltips', async ({
  page,
}) => {
  await open(page, `${WIN}&view=start`);
  await expect(page.getByTestId('view-overview')).toBeVisible();
  await expect(page.getByTestId('nav-overview')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('sidebar').locator('nav button')).toHaveText([
    'Übersicht',
    'Jobs',
    'Profil',
    'Einstellungen',
  ]);
  await page.keyboard.press('Control+2');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await page.keyboard.press('Control+4');
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.keyboard.press('Control+3');
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(page.getByTestId('view-overview')).toBeVisible();
  // Ctrl+, opens the settings on Windows too (macOS has it in its menu).
  await page.keyboard.press('Control+,');
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-jobs').hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Jobs');
  await expect(tip).toContainText('Strg+2');
});

test('before the first fetch the Übersicht waits and says why; Jobs is the setup page', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&view=start`);
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  const overview = page.getByTestId('nav-overview');
  await expect(overview).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await overview.click({ force: true });
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await page.mouse.move(600, 600);
  await overview.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Nach dem ersten Abruf');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
});

for (const os of [WIN, MAC]) {
  test(`the rail: four squares in a column, the names in tooltips on the right ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, os);
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const ids = ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings'];
    const boxes = await Promise.all(ids.map(box));
    for (const b of boxes) expect([b.width, b.height]).toEqual([40, 40]);
    const centre = (b: { x: number; width: number }): number => b.x + b.width / 2;
    for (const b of boxes) expect(centre(b)).toBe(centre(boxes[0]!));
    await page.getByTestId('nav-profile').hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('Profil');
    await expect(tip.locator('div')).toHaveCSS('opacity', '1');
    const anchor = await box('nav-profile');
    expect((await tip.locator('div').boundingBox())!.x).toBeGreaterThan(anchor.x + anchor.width);
    for (const id of ['nav-settings', 'nav-overview', 'nav-jobs']) {
      await page.getByTestId(id).click();
      await pillOn(page, id);
    }
  });

  test(`at 480 x 360 the rail keeps every entry and the status in the window ${os}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 360 });
    await open(page, os);
    const ids = ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings', 'run-status'];
    const boxes = await Promise.all(
      ids.map(async (id) => (await page.getByTestId(id).boundingBox())!),
    );
    for (const [at, b] of boxes.entries()) {
      expect(b.y, ids[at]).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, ids[at]).toBeLessThanOrEqual(360);
      const next = boxes[at + 1];
      if (next)
        expect(next.y, `${ids[at + 1]} below ${ids[at]}`).toBeGreaterThanOrEqual(b.y + b.height);
    }
    await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
  });
}

test('the sidebar folds only by the window width: no edge, Ctrl+B and Cmd+B change nothing', async ({
  page,
}) => {
  await open(page, WIN);
  await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
  expect(await sidebarWidth(page)).toBe(196);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Meta+b');
  expect(await sidebarWidth(page)).toBe(196);
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => sidebarWidth(page)).toBe(64);
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect.poll(() => sidebarWidth(page)).toBe(196);
});

test('an unsaved profile keeps the view until the question is answered', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('place-archive').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Archiv durchsuchen');
  await page.getByTestId('place-inbox').click();
  await page.getByTestId('nav-profile').click();
  const field = page.getByTestId('view-profile').getByRole('textbox').first();
  await field.fill('Erika Muster');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  // Still the Profil, and the Jobs view is where it was (the inbox, not the archive).
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(page.getByTestId('nav-profile')).toHaveAttribute('aria-current', 'page');
  await expect(field).toHaveValue('Erika Muster');
  // Asked again and left without saving: the Jobs view it was asked for, on its inbox.
  await page.getByTestId('nav-jobs').click();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Jobs durchsuchen');
});

test('a click on the tab that is open reloads nothing, like Jobs', async ({ page }) => {
  await open(page, WIN);
  const loads = async (place?: string): Promise<number> =>
    (await calls(page, 'list_jobs')).filter(
      ([, args]) =>
        place === undefined || (args as { query: { place: string } }).query.place === place,
    ).length;
  await page.getByTestId('place-archive').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Archiv durchsuchen');
  await settle(page);
  const archive = await loads('archive');
  await page.getByTestId('place-archive').click();
  await settle(page);
  expect(await loads('archive')).toBe(archive);
  await page.getByTestId('place-inbox').click();
  await expect(page.getByTestId('search')).toHaveAttribute('placeholder', 'Jobs durchsuchen');
  await settle(page);
  const all = await loads();
  await page.getByTestId('nav-jobs').click();
  await settle(page);
  expect(await loads()).toBe(all);
});
