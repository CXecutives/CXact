// The job list of the final round: its widths, its sections (Ausgeschlossen, Noch ohne
// Passung, Seit dem letzten Abruf), the search's keys and its hits elsewhere, the choice of
// several jobs, the run card, the states of the list and the trash's days.

import type { Page } from '@playwright/test';
import { expect, open, settle, test } from './fixtures';

const WIN = '?platform=windows';

/** The width of the list column as the handle says it (the column ends at the handle). */
async function listWidth(page: Page): Promise<number> {
  await settle(page);
  return Number(await page.getByTestId('list-splitter').getAttribute('aria-valuenow'));
}

test.describe('widths', () => {
  test('the first width is at least 520 px where the reader keeps its room', async ({ page }) => {
    for (const width of [1360, 1600, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, WIN);
      expect(await listWidth(page), `${width} px`).toBeGreaterThanOrEqual(520);
    }
  });

  test('the list never gets narrower while the window grows, across the rail too', async ({
    page,
  }) => {
    await open(page, WIN);
    let last = 0;
    for (const width of [920, 1000, 1060, 1099, 1100, 1130, 1160, 1250, 1360, 1600, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => listWidth(page)).toBeGreaterThanOrEqual(last);
      last = await listWidth(page);
    }
    expect(last).toBeGreaterThanOrEqual(520);
  });

  test('the handle catches the pointer beside the list, never over its scrollbar', async ({
    page,
  }) => {
    await open(page, WIN);
    const hit = (await page.getByTestId('list-splitter').locator('.hit').boundingBox())!;
    const scroll = (await page.getByTestId('list-scroll').boundingBox())!;
    // The list's scroll area (its scrollbar at its right end) ends where the strip begins.
    expect(hit.x).toBeGreaterThanOrEqual(scroll.x + scroll.width);
    // The grip stays centred on the border.
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    const grip = (await page.getByTestId('list-splitter').locator('.grip').boundingBox())!;
    expect(Math.abs(grip.x + grip.width / 2 - hit.x)).toBeLessThanOrEqual(1);
  });
});

test('Neu, Alle and Favoriten keep their widths when a count goes', async ({ page }) => {
  await open(page, WIN);
  const neu = page.getByTestId('facet').getByRole('radio', { name: /Neu/ });
  const before = (await neu.boundingBox())!.width;
  await page.getByTestId('mark-all-read').click();
  await expect(neu.locator('.spare')).toHaveCount(1);
  expect((await neu.boundingBox())!.width).toBe(before);
});
