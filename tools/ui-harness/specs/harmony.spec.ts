// Harmony (owner, 2026-10-24: "alles soll harmonisch und gut aussehen, auch für das Auge"): every
// state of the Vorschau menu keeps the round 10 scale. Text uses only the type ladder and the four
// weights, controls only the control heights, line icons only the one stroke, corners only the
// radius ladder, and nothing is light blue. A new value is a token first, then a line here. And
// on no state does a field hold the caret by itself or a button end in an ellipsis (owner,
// 2026-10-30). And one way to draw a hairline, the same answer of a control to the pointer on
// every ground, one family of glyphs.

import type { Locator, Page } from '@playwright/test';
import { PREVIEW_MENU } from '../preview';
import { animationsDone, expect, open, test } from './fixtures';
import { openPlace, row, WIN } from './helpers';

/** The type ladder (tokens.css) and the digits of the two rings. */
const SIZES = [12, 13, 14, 15, 16, 20, 26, 17];
const WEIGHTS = [450, 500, 540, 650];
/** In a field 24, inline 26, quiet icon 28, control 30, menu row and sidebar entry 32, a caption
 *  button of Windows 36. */
const HEIGHTS = [24, 26, 28, 30, 32, 36];
/** The radius ladder; a pill or a circle (radius at least half the shorter side) is always fine,
 *  and the selection bar is 3. */
const RADII = [0, 3, 4, 6, 8, 10, 14, 20];
/** The line of an icon in px, whatever its size: tokens.css sets it per size for the eye. */
const LINE = { min: 1.2, max: 3.2 };

interface Rules {
  sizes: number[];
  weights: number[];
  heights: number[];
  radii: number[];
  line: { min: number; max: number };
}

/** What breaks the scale on the page as it is now, one line per element and rule. */
function audit(rules: Rules): string[] {
  const out = new Set<string>();
  const shown = (el: Element): boolean => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0.05
    );
  };
  const id = (el: Element): string =>
    el.getAttribute('data-testid') ??
    `${el.tagName.toLowerCase()}${[...el.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('')}`;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (el && node.textContent?.trim() && shown(el)) texts.add(el);
  }
  for (const el of texts) {
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize) * 10) / 10;
    const weight = Number(style.fontWeight);
    if (!rules.sizes.includes(size)) out.add(`${id(el)}: font-size ${size}`);
    if (!rules.weights.includes(weight)) out.add(`${id(el)}: font-weight ${weight}`);
  }

  // Buttons (components/Button), selects and the options of a radio list; rows and dividers are
  // not controls and keep their own rhythm.
  for (const el of document.querySelectorAll('button.btn, button.select, [role="radio"]')) {
    if (!shown(el) || el.closest('[aria-hidden="true"]')) continue;
    const height = Math.round(el.getBoundingClientRect().height);
    if (!rules.heights.includes(height)) out.add(`${id(el)}: height ${height}`);
  }

  const caret = document.activeElement;
  if (caret?.matches('input, textarea')) out.add(`${id(caret)}: took the caret`);
  for (const el of document.querySelectorAll('button')) {
    if (!shown(el)) continue;
    if (/(…|\.\.\.)$/.test(el.textContent?.trim() ?? '')) out.add(`${id(el)}: ellipsis`);
  }

  for (const svg of document.querySelectorAll('svg.lucide')) {
    if (!shown(svg)) continue;
    const line =
      (parseFloat(getComputedStyle(svg).strokeWidth) * svg.getBoundingClientRect().width) / 24;
    if (line < rules.line.min || line > rules.line.max) out.add(`${id(svg)}: line ${line}`);
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el)) continue;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const radius = parseFloat(style.borderTopLeftRadius);
    if (radius > 0 && radius < Math.min(box.width, box.height) / 2 - 0.5) {
      if (!rules.radii.includes(Math.round(radius))) out.add(`${id(el)}: radius ${radius}`);
    }
    const rgb = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(style.backgroundColor);
    if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0.2)) {
      const r = Number(rgb[1]) / 255;
      const g = Number(rgb[2]) / 255;
      const b = Number(rgb[3]) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const light = (max + min) / 2;
      const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
        else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
        else hue = 60 * ((r - g) / (max - min) + 4);
      }
      if (hue < 0) hue += 360;
      if (hue > 190 && hue < 235 && sat > 0.25 && light > 0.8) {
        out.add(`${id(el)}: light blue fill`);
      }
    }
  }
  return [...out].sort();
}

for (const { label, query } of PREVIEW_MENU.flatMap((group) => group.entries)) {
  test(`harmony: ${label}`, async ({ page }) => {
    await open(page, `${WIN}&${query}`);
    const problems = await page.evaluate(audit, {
      sizes: SIZES,
      weights: WEIGHTS,
      heights: HEIGHTS,
      radii: RADII,
      line: LINE,
    });
    expect(problems, 'off the round 10 rules').toEqual([]);
  });
}

/* ------------------------------------------------------- one weight of a hairline */

test('beside a real scrollbar a column has as much room on both sides', async ({
  playwright,
  baseURL,
  browserName,
}) => {
  // Windows only (WebView2): macOS's overlay scrollbars take no room.
  test.skip(browserName !== 'chromium', 'classic scrollbars are Chromium on Windows');
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const page = await browser.newPage({
      ...(baseURL ? { baseURL } : {}),
      viewport: { width: 1360, height: 860 },
      locale: 'de-DE',
    });
    const edges = async (node: Locator): Promise<{ left: number; right: number }> => {
      const box = (await node.boundingBox())!;
      return { left: box.x, right: box.x + box.width };
    };
    await open(page, `${WIN}&open=freelancermap:2801`);
    const list = await edges(page.getByTestId('list-header'));
    const room = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('.stage')!;
      return view.offsetWidth - view.clientWidth;
    });
    expect(room).toBeGreaterThan(0);
    // The list: its head, and its rows with their highlight.
    const seam = list.right + room;
    const search = await edges(page.getByTestId('list-header').locator('.row').first());
    expect(search.left - list.left).toBe(seam - search.right);
    const rowBox = await edges(row(page, 'freelancermap-2801'));
    expect(rowBox.left - list.left).toBe(seam - rowBox.right);
    // The job view's card, in its pane.
    const card = await edges(page.getByTestId('reader-head'));
    const pane = await edges(page.locator('.stage'));
    expect(card.left - pane.left).toBe(pane.right - card.right);
    // A page, in the middle of its view.
    await open(page, `${WIN}&view=profile`);
    const form = await edges(page.getByTestId('profile-form'));
    const view = await edges(page.getByTestId('view-profile'));
    expect(form.left - view.left).toBe(view.right - form.right);
  } finally {
    await browser.close();
  }
});

test('one hairline: the lines between rows are drawn like the edges of the boxes', async ({
  page,
}) => {
  // A box of 1 px comes out at 2 device pixels at 150 %, a border at 1: one way to draw a line.
  const line = (node: Locator, pseudo = '::before') =>
    node
      .first()
      .evaluate(
        (element, which) => getComputedStyle(element, which || undefined).borderTopWidth,
        pseudo,
      );
  await open(page, `${WIN}&view=settings`);
  const drawn = await line(page.locator('.box'), '');
  expect(drawn).toBe('1px');
  expect(await line(page.locator('[data-setting-row] + [data-setting-row]'))).toBe(drawn);
  await page.getByTestId('mailbox-change').click();
  expect(await line(page.getByTestId('mailbox-form').locator('.cell'))).toBe(drawn);
  expect(await line(page.getByTestId('mailbox-buttons').locator('..'))).toBe(drawn);
  await open(page, WIN);
  expect(await line(page.locator('.day .item + .item'))).toBe(drawn);
  await row(page, 'linkedin-4100200301').click({ button: 'right' });
  expect(await line(page.getByTestId('menu').locator('.separator'), '')).toBe(drawn);
  await open(page, `${WIN}&view=profile`);
  expect(await line(page.locator('.cell + .cell'), '::after')).toBe(drawn);
  expect(await line(page.locator('.items .item + .item'), '::after')).toBe(drawn);
  expect(await line(page.locator('.items .add'), '::after')).toBe(drawn);
});

/* ------------------------------------------- one answer of a control to the pointer */

/** What a control shows at rest, under the pointer and pressed (the left button is let go
 *  beside it, so nothing is pressed for real). */
async function steps(
  page: Page,
  control: Locator,
  read: 'backgroundColor' | 'color',
): Promise<{ rest: string; hover: string; press: string }> {
  const now = async (): Promise<string> => {
    await animationsDone(page);
    return control.evaluate((node, key) => getComputedStyle(node)[key], read);
  };
  await page.mouse.move(0, 0);
  const rest = await now();
  await control.hover();
  const hover = await now();
  await page.mouse.down();
  const press = await now();
  await page.mouse.move(0, 0);
  await page.mouse.up();
  return { rest, hover, press };
}

test('a secondary button answers the pointer alike on every ground: no ground shows through', async ({
  page,
}) => {
  await open(page, `${WIN}&open=freelance:900411`);
  const inStateBox = await steps(page, page.getByTestId('reader-sign-in'), 'backgroundColor');
  const onCard = await steps(page, page.getByTestId('open-ad'), 'backgroundColor');
  await open(page, `${WIN}&view=profile`);
  const onPage = await steps(page, page.getByTestId('profile-from-cv'), 'backgroundColor');
  expect(onCard).toEqual(inStateBox);
  expect(onPage).toEqual(inStateBox);
  // Opaque, and three steps.
  for (const value of [inStateBox.rest, inStateBox.hover, inStateBox.press]) {
    expect(value).toMatch(/^rgb\(/);
  }
  expect(new Set(Object.values(inStateBox)).size).toBe(3);
});

test('the small tools have their three steps too: a row tool, the x of a chip, the info', async ({
  page,
}) => {
  await open(page, WIN);
  const key = 'linkedin-4100200301';
  await row(page, key).hover();
  const tool = row(page, key).locator('..').getByTestId('tool-archive');
  await expect(tool).toBeVisible();
  // The pointer goes from the row to its tool: the row keeps its wash meanwhile.
  await tool.hover();
  await animationsDone(page);
  const hovered = await tool.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.mouse.down();
  await animationsDone(page);
  const pressed = await tool.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  expect(pressed).not.toBe(hovered);
  await open(page, `${WIN}&view=profile`);
  const x = await steps(page, page.locator('[data-remove]').first(), 'backgroundColor');
  expect(new Set(Object.values(x)).size, JSON.stringify(x)).toBe(3);
  // The info answers like the x of a chip: from its grey to the ink.
  const info = page.getByTestId('info-tip').first();
  const { rest, hover } = await steps(page, info, 'color');
  const ink = await page
    .getByTestId('profile-heading')
    .evaluate((node) => getComputedStyle(node).color);
  expect(rest).not.toBe(ink);
  expect(hover).toBe(ink);
});

/* --------------------------------------------------------- the lines of a glyph */

/** How far a glyph's top edge lies from a pixel's edge: on the seam (0) its line draws as two
 *  grey rows, in a pixel's middle (.5) as one dark row. */
const offSeam = (control: Locator): Promise<number> =>
  control.first().evaluate((node) => {
    const svg = node.querySelector('svg')!;
    const top = Math.min(...[...svg.children].map((shape) => shape.getBoundingClientRect().top));
    return Math.abs(top - Math.floor(top));
  });

/** How far a glyph's drawing lies from where its box puts it. */
const shifted = (control: Locator): Promise<number> =>
  control.first().evaluate((node) => {
    const icon = node.querySelector('.icon')!.getBoundingClientRect();
    return Math.abs(node.querySelector('svg')!.getBoundingClientRect().left - icon.left);
  });

test('the glyphs on the pixel seam at 16 draw one dark row, so one family stands in the bar', async ({
  page,
}) => {
  await open(page, `${WIN}&open=freelance:900411`);
  for (const id of [
    'toggle-sidebar',
    'toggle-reader',
    'open-ad',
    'reader-sign-in',
    'reader-archive',
  ]) {
    expect(await offSeam(page.getByTestId(id)), id).toBeCloseTo(0.5, 1);
  }
  // Abbrechen's square, beside the list's filter.
  await open(page, `${WIN}&scenario=running`);
  expect(await offSeam(page.getByTestId('cancel-run'))).toBeCloseTo(0.5, 1);
});

test('the half pixel goes by the size: not at 14, and not for what stands low already', async ({
  page,
}) => {
  // A provider's page beside the password: 14, where the shift would soften it.
  await open(page, `${WIN}&view=settings`);
  await page.getByTestId('mailbox-change').click();
  expect(await shifted(page.getByTestId('create-password'))).toBe(0);
  // Anmelden in a run's strip: 14 as well.
  await open(page, `${WIN}&scenario=sign-in-waiting`);
  expect(await shifted(page.getByTestId('run-sign-in'))).toBe(0);
  // Anzeige laden at 16: its glyph keeps its place.
  await open(page, `${WIN}&open=linkedin:4100200302`);
  expect(await shifted(page.getByTestId('load-ad'))).toBe(0);
});

test('Wiederherstellen is as large as the Löschen beside it', async ({ page }) => {
  await open(page, WIN);
  await openPlace(page, 'trash');
  await page.locator('[data-testid^="job-row-"]').first().click();
  const width = (control: Locator): Promise<number> =>
    control.evaluate((node) => {
      const shapes = [...node.querySelector('svg')!.children].map((shape) =>
        shape.getBoundingClientRect(),
      );
      return (
        Math.max(...shapes.map((shape) => shape.right)) -
        Math.min(...shapes.map((shape) => shape.left))
      );
    });
  const undo = await width(page.getByTestId('reader-restore'));
  const trash = await width(page.getByTestId('reader-purge'));
  expect(Math.abs(undo - trash)).toBeLessThanOrEqual(0.5);
});
