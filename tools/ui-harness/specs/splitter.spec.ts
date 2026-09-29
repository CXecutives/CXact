// The handle between the list and the reader: the list keeps 320 px, the reader 440 px, and
// the list takes at most 60 % of the content; the limits and the first width (40 % of the
// content, at least 520 px where the reader keeps its room, at most 600 px) follow the window
// and the sidebar and never shrink while the window grows; a kept width that does not fit
// shows at the limit and comes back when there is room; a tooltip names what it does, over
// what a double click does.

import type { Page } from '@playwright/test';
import { expect, open, settle, test } from './fixtures';
import { tokenPx } from './helpers';

const WIN = '?platform=windows';

interface Handle {
  width: number;
  min: number;
  max: number;
}

/** The list column's width as laid out, and the handle's live limits. */
async function handle(page: Page): Promise<Handle> {
  await settle(page);
  const splitter = page.getByTestId('list-splitter');
  const sheet = (await page.locator('main.views').boundingBox())!;
  const at = (await splitter.boundingBox())!;
  const value = async (name: string): Promise<number> => Number(await splitter.getAttribute(name));
  // The content starts after the sheet's hairline; the column ends where the handle lies.
  const width = Math.round(at.x - (sheet.x + 1));
  expect(width, 'laid out = aria-valuenow').toBe(await value('aria-valuenow'));
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

/** The limits of the list at a window `width`, from the tokens like Splitter's splitLimits:
 *  the content beside the sidebar and its hairline; the list keeps --list-min, the reader
 *  --reader-min, the list takes at most 60 %, first 40 % between --list-first-min and -max. */
async function limitsAt(page: Page, width: number): Promise<Handle> {
  const token = (name: string): Promise<number> => tokenPx(page, name);
  const content = width - (await token('--sidebar-width')) - 1;
  const min = await token('--list-min');
  const max = Math.max(
    min,
    Math.min(content - (await token('--reader-min')), Math.round(content * 0.6)),
  );
  const first = Math.min(
    Math.max(Math.round(content * 0.4), await token('--list-first-min')),
    await token('--list-first-max'),
  );
  return { width: Math.max(min, Math.min(max, first)), min, max };
}

for (const width of [1100, 1360, 1920]) {
  test(`the list's first width and limits at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, WIN);
    const expected = await limitsAt(page, width);
    expect(await handle(page)).toEqual(expected);
    await drag(page, 2000);
    await expect.poll(async () => (await handle(page)).width).toBe(expected.max);
    await drag(page, -2000);
    await expect.poll(async () => (await handle(page)).width).toBe(expected.min);
  });
}

test('the limits follow the window; a kept width waits for its room', async ({ page }) => {
  await open(page, WIN);
  const [at1360, at1100] = [await limitsAt(page, 1360), await limitsAt(page, 1100)];
  await drag(page, 2000);
  await expect.poll(async () => (await handle(page)).width).toBe(at1360.max);
  // A wider window gives the list more room; dragged to its end there.
  await page.setViewportSize({ width: 1920, height: 800 });
  await expect.poll(async () => (await handle(page)).max).toBeGreaterThan(at1360.max);
  await drag(page, 2000);
  const wide = (await handle(page)).max;
  await expect.poll(async () => (await handle(page)).width).toBe(wide);
  // Narrower: shown at the limit, the choice stays and comes back.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect.poll(async () => (await handle(page)).max).toBe(at1100.max);
  expect((await handle(page)).width).toBe(at1100.max);
  await page.setViewportSize({ width: 1920, height: 800 });
  await expect.poll(async () => (await handle(page)).width).toBe(wide);
  await page.reload();
  expect((await handle(page)).width).toBe(wide);
});

test('a kept width that is too wide shows at the limit', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobs-list-width', '900'));
  await open(page, WIN);
  const at1360 = await limitsAt(page, 1360);
  expect(await handle(page)).toEqual({ width: at1360.max, min: at1360.min, max: at1360.max });
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect.poll(async () => (await handle(page)).width).toBe(900);
});

test('the handle shows its grip, no tooltip; a double click sets the first width back', async ({
  page,
}) => {
  await open(page, WIN);
  const hit = page.getByTestId('list-splitter').locator('.hit');
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Only the grip shows (no line along the border), 44 px long.
  await expect(hit.locator('.line')).toHaveCount(0);
  expect((await hit.locator('.grip').boundingBox())!.height).toBe(44);
  await expect(hit.locator('.grip')).toHaveCSS('opacity', '1');
  // No tooltip (hidden for now, user 2026-09-29): the cursor says it.
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(hit).toHaveCSS('cursor', 'col-resize');

  await drag(page, -100);
  await expect.poll(async () => (await handle(page)).width).toBe(420);
  await page.reload();
  expect((await handle(page)).width).toBe(420);
  await page.getByTestId('list-splitter').locator('.hit').dblclick();
  await expect.poll(async () => (await handle(page)).width).toBe(520);
  await page.reload();
  expect((await handle(page)).width).toBe(520);
});

test('at its narrowest the list header still shows every control in the column', async ({
  page,
}) => {
  await open(page, WIN);
  await drag(page, -2000);
  await expect.poll(async () => (await handle(page)).width).toBe(320);
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
