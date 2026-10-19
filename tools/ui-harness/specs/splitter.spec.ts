// The handle between the list and the reader: it resizes the list within limits (the list
// keeps room, the reader keeps room) that follow the window and the sidebar and never shrink
// while the window grows; the first width and the kept width stay inside them; a kept width
// that does not fit shows at the limit and comes back when there is room; a double click sets
// the first width back. The limits are read from the handle itself (aria-valuemin and -max),
// not computed from the tokens: their sizes are not pinned here.

import type { Page } from '@playwright/test';
import { expect, open, settle, test } from './fixtures';

const WIN = '?platform=windows';

interface Handle {
  width: number;
  min: number;
  max: number;
}

/** The list column's width as the handle reports it and its live limits; the column is laid
 *  out as wide as the handle says. */
async function handle(page: Page): Promise<Handle> {
  await settle(page);
  const splitter = page.getByTestId('list-splitter');
  const value = async (name: string): Promise<number> => Number(await splitter.getAttribute(name));
  const width = await value('aria-valuenow');
  const column = (await page.getByTestId('list-scroll').boundingBox())!;
  expect(Math.abs(column.width - width), 'laid out = aria-valuenow').toBeLessThanOrEqual(2);
  return { width, min: await value('aria-valuemin'), max: await value('aria-valuemax') };
}

async function drag(page: Page, dx: number): Promise<void> {
  const box = (await page.getByTestId('list-splitter').locator('.hit').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  await page.mouse.up();
}

for (const width of [1100, 1360, 1920]) {
  test(`the list's first width stays inside its limits, and the handle reaches both at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, WIN);
    const first = await handle(page);
    expect(first.min).toBeLessThanOrEqual(first.width);
    expect(first.width).toBeLessThanOrEqual(first.max);
    expect(first.min).toBeLessThanOrEqual(first.max);
    await drag(page, 2000);
    await expect.poll(async () => (await handle(page)).width).toBe(first.max);
    await drag(page, -2000);
    await expect.poll(async () => (await handle(page)).width).toBe(first.min);
  });
}

test('the list never gets narrower as the window grows', async ({ page }) => {
  // The limit follows the window and the sidebar, also where the sidebar folds by itself.
  await open(page, WIN);
  let before = 0;
  for (const width of [1000, 1099, 1100, 1200, 1360, 1600, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await settle(page);
    const { max } = await handle(page);
    expect(max, `at ${width} px`).toBeGreaterThanOrEqual(before);
    before = max;
  }
});

test('the limits follow the window; a kept width waits for its room', async ({ page }) => {
  await open(page, WIN);
  const at1360 = (await handle(page)).max;
  await drag(page, 2000);
  await expect.poll(async () => (await handle(page)).width).toBe(at1360);
  // A wider window gives the list more room; dragged to its end there.
  await page.setViewportSize({ width: 1920, height: 800 });
  await expect.poll(async () => (await handle(page)).max).toBeGreaterThan(at1360);
  await drag(page, 2000);
  const wide = (await handle(page)).max;
  await expect.poll(async () => (await handle(page)).width).toBe(wide);
  // Narrower: shown at the limit, the choice stays and comes back.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => (await handle(page)).max).toBeLessThan(wide);
  const narrow = await handle(page);
  expect(narrow.width).toBe(narrow.max);
  await page.setViewportSize({ width: 1920, height: 800 });
  await expect.poll(async () => (await handle(page)).width).toBe(wide);
  await page.reload();
  expect((await handle(page)).width).toBe(wide);
});

test('a kept width that is too wide shows at the limit', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobs-list-width', '900'));
  await open(page, WIN);
  const narrow = await handle(page);
  expect(narrow.max).toBeLessThan(900);
  expect(narrow.width).toBe(narrow.max);
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect
    .poll(async () => {
      const { width, max } = await handle(page);
      return width === Math.min(900, max);
    })
    .toBe(true);
  expect((await handle(page)).width).toBeGreaterThan(narrow.width);
});

test('the handle has no tooltip; a double click sets the first width back', async ({ page }) => {
  await open(page, WIN);
  const hit = page.getByTestId('list-splitter').locator('.hit');
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // No tooltip (hidden for now, user 2026-09-29): the cursor says it.
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  const first = (await handle(page)).width;
  await drag(page, -100);
  await expect.poll(async () => (await handle(page)).width).toBe(first - 100);
  await page.reload();
  expect((await handle(page)).width).toBe(first - 100);
  await page.getByTestId('list-splitter').locator('.hit').dblclick();
  await expect.poll(async () => (await handle(page)).width).toBe(first);
  await page.reload();
  expect((await handle(page)).width).toBe(first);
});

test('at its narrowest the list header still shows every control in the column', async ({
  page,
}) => {
  await open(page, WIN);
  await drag(page, -2000);
  const { min } = await handle(page);
  await expect.poll(async () => (await handle(page)).width).toBe(min);
  const problems = await page.getByTestId('list-header').evaluate((header) => {
    const out: string[] = [];
    const column = header.getBoundingClientRect();
    if (header.scrollWidth > header.clientWidth) out.push('the header scrolls sideways');
    for (const control of header.querySelectorAll('button, input')) {
      const box = control.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.left < column.left - 0.5 || box.right > column.right + 0.5) {
        out.push(`clipped: ${control.getAttribute('aria-label') ?? control.textContent}`);
      }
    }
    return out;
  });
  expect(problems).toEqual([]);
});
