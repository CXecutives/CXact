// Harmony (owner, 2026-10-24: "alles soll harmonisch und gut aussehen, auch für das Auge"): every
// state of the Vorschau menu keeps the round 10 scale. Text uses only the type ladder and the four
// weights, controls only the control heights, line icons only the one stroke, corners only the
// radius ladder, and nothing is light blue. A new value is a token first, then a line here. And
// on no state does a field hold the caret by itself or a button end in an ellipsis (owner,
// 2026-10-30). And the margins count the scrollbar's room, one way to draw a hairline, the same
// answer of a control to the pointer on every ground, one family of glyphs.

import type { Locator, Page } from '@playwright/test';
import { PREVIEW_MENU } from '../preview';
import { animationsDone, expect, open, test } from './fixtures';
import { chooseSort, menuFrame, openFilter, openPlace, row, WIN } from './helpers';

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

/* ------------------------------------------- the scrollbar's room in the margins */

/** A test on a page whose scrollbars take their room, as on Windows: the harness hides Chromium's,
 *  so it gets a browser of its own; WebKit shows them on the Windows path. */
function testWithRoom(
  title: string,
  viewport: { width: number; height: number },
  check: (page: Page) => Promise<void>,
): void {
  test(title, async ({ page, playwright, baseURL, browserName }) => {
    if (browserName !== 'chromium') {
      await page.setViewportSize(viewport);
      await check(page);
      return;
    }
    const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      await check(
        await browser.newPage({ ...(baseURL ? { baseURL } : {}), viewport, locale: 'de-DE' }),
      );
    } finally {
      await browser.close();
    }
  });
}

const edges = async (node: Locator): Promise<{ left: number; right: number }> => {
  const box = (await node.boundingBox())!;
  return { left: box.x, right: box.x + box.width };
};

testWithRoom(
  'beside a real scrollbar a column has as much room on both sides',
  { width: 1360, height: 860 },
  async (page) => {
    await open(page, `${WIN}&open=freelancermap:2801`);
    const list = await edges(page.getByTestId('list-header'));
    const room = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('.stage')!;
      return view.offsetWidth - view.clientWidth;
    });
    expect(room).toBeGreaterThan(0);
    // The list: its head, and its rows with their highlight, which is the open row's own box.
    const seam = list.right + room;
    const search = await edges(page.getByTestId('list-header').locator('.row').first());
    expect(search.left - list.left).toBe(seam - search.right);
    const rowBox = await edges(row(page, 'freelancermap-2801'));
    expect(rowBox.left - list.left).toBe(seam - rowBox.right);
    expect(await edges(page.getByTestId('row-bar'))).toEqual(rowBox);
    // The job view's card, in its pane.
    const card = await edges(page.getByTestId('reader-head'));
    const pane = await edges(page.locator('.stage'));
    expect(card.left - pane.left).toBe(pane.right - card.right);
    // A page, in the middle of its view.
    await open(page, `${WIN}&view=profile`);
    const form = await edges(page.getByTestId('profile-form'));
    const view = await edges(page.getByTestId('view-profile'));
    expect(form.left - view.left).toBe(view.right - form.right);
  },
);

for (const width of [1360, 792, 700, 480]) {
  testWithRoom(
    `at ${width} wide a page counts the scrollbar's room in its margins`,
    { width, height: 700 },
    async (page) => {
      /** A length of the design, whatever the scrollbar takes. */
      const token = (name: string): Promise<number> =>
        page.evaluate(
          (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)),
          name,
        );
      await open(page, `${WIN}&view=profile`);
      const side = await token(width < 560 ? '--page-side-narrow' : '--page-side');
      const most = (await token('--page-max')) - 2 * (await token('--page-side'));
      /** Where the column stands in a view: in its middle, with the design's sides. */
      const column = (view: { left: number; right: number }) => {
        const wide = Math.min(most, view.right - view.left - 2 * side);
        const middle = (view.left + view.right) / 2;
        return { left: middle - wide / 2, right: middle + wide / 2 };
      };
      // Profil and Einstellungen stand alike, the title 2 in like the sections' titles.
      const form = column(await edges(page.getByTestId('view-profile')));
      expect(await edges(page.getByTestId('profile-form'))).toEqual(form);
      const title = await edges(page.getByTestId('profile-heading'));
      expect(title.left).toBe(form.left + (await token('--section-inset')));
      await open(page, `${WIN}&view=settings`);
      const box = column(await edges(page.getByTestId('view-settings')));
      expect(await edges(page.locator('.box').first())).toEqual(box);
      // The setup's page with its bar, across the whole window: Zurück's glyph and Weiter on the
      // page's edges.
      await open(page, `${WIN}&scenario=first-run&step=profile`);
      await animationsDone(page);
      const setup = column({ left: 0, right: width });
      expect(await edges(page.getByTestId('profile-form'))).toEqual(setup);
      const back = await edges(page.getByTestId('first-back').locator('.icon'));
      const next = await edges(page.getByTestId('first-next'));
      expect([back.left, next.right]).toEqual([setup.left, setup.right]);
    },
  );
}

testWithRoom(
  "narrow, a page, the list's head, a job and its placeholder share one column",
  { width: 480, height: 700 },
  async (page) => {
    await open(page, `${WIN}&view=profile`);
    const form = await edges(page.getByTestId('profile-form'));
    await open(page, WIN);
    expect(await edges(page.getByTestId('list-header').locator('.row').first())).toEqual(form);
    // A slow job: nothing moves when it replaces its placeholder.
    await page.evaluate(() => (window.__harness.detailDelay = 900));
    await row(page, 'freelancermap-2801').click();
    const skeleton = page.getByTestId('reader-skeleton');
    await expect(skeleton).toBeVisible();
    expect(await edges(skeleton)).toEqual(form);
    const job = page.getByTestId('reader-head');
    await expect(job).toBeVisible();
    expect(await edges(job)).toEqual(form);
  },
);

testWithRoom(
  'no hit: the tile, its words, the button under them and the head have one middle',
  { width: 1360, height: 860 },
  async (page) => {
    const middle = async (node: Locator): Promise<number> => {
      const { left, right } = await edges(node);
      return (left + right) / 2;
    };
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const none = page.getByTestId('empty-search');
    await expect(none.getByTestId('also-archive')).toBeVisible();
    const head = await middle(page.getByTestId('list-header').locator('.row').first());
    // (A line of text is as wide as its words, so its middle may lie a little off the pixel.)
    expect(await middle(none.locator('.tile'))).toBeCloseTo(head, 0);
    expect(await middle(none.locator('h3'))).toBeCloseTo(head, 0);
    expect(await middle(none.locator('p'))).toBeCloseTo(head, 0);
    expect(await middle(none.getByTestId('also-archive'))).toBeCloseTo(head, 0);
    // An empty place under its head (a kept filter), across the whole width: the view's middle.
    await page.addInitScript(() =>
      localStorage.setItem('jobs-filter', JSON.stringify({ portals: ['linkedin'] })),
    );
    await open(page, `${WIN}&scenario=concept`);
    await openPlace(page, 'archive');
    const place = page.getByTestId('empty-place-archive');
    await expect(place).toBeVisible();
    const view = await middle(page.getByTestId('view-jobs'));
    expect(await middle(page.getByTestId('list-header').locator('.row').first())).toBeCloseTo(
      view,
      0,
    );
    expect(await middle(place.locator('.tile'))).toBeCloseTo(view, 0);
  },
);

testWithRoom(
  "the list's hairline runs across the column, past the scrollbar's room",
  { width: 1360, height: 600 },
  async (page) => {
    await open(page, WIN);
    await chooseSort(page, 'match');
    const scroller = page.getByTestId('list-scroll');
    const head = page.getByTestId('list-header').locator('xpath=..');
    const line = (): Promise<string> =>
      head.evaluate((node) => getComputedStyle(node).borderBottomColor);
    const seam = await scroller
      .locator('xpath=..')
      .evaluate((node) => getComputedStyle(node).borderRightColor);
    const top = (await scroller.boundingBox())!.y;
    expect(await line()).not.toBe(seam);
    await scroller.evaluate((node) => node.scrollTo({ top: 60 }));
    await expect.poll(line).toBe(seam);
    // Its box is as wide as the list's own, the track included, up to the column's border; it
    // takes its height at rest too, so the rows stay.
    expect(await edges(head)).toEqual(await edges(scroller));
    expect((await scroller.boundingBox())!.y).toBe(top);
  },
);

/* --------------------------------------------- the thumb, and a menu's list and its track */

/** A test that reads pixels, with scrollbars that take their room: on a page of its own, because
 *  in WebKit a screenshot's own style breaks the page's policy (fixtures.ts). */
function testPixels(
  title: string,
  viewport: { width: number; height: number; scale?: number },
  check: (page: Page) => Promise<void>,
): void {
  test(title, async ({ playwright, baseURL, browserName }) => {
    const browser = await playwright[browserName].launch(
      browserName === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {},
    );
    try {
      const context = await browser.newContext({
        ...(baseURL ? { baseURL } : {}),
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale ?? 1,
        locale: 'de-DE',
      });
      await check(await context.newPage());
    } finally {
      await browser.close();
    }
  });
}

/** The colours of a part of the page, pixel by pixel, read in a blank page of their own. */
async function colours(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number[][]> {
  const shot = (await page.screenshot({ clip })).toString('base64');
  const context = await page.context().browser()!.newContext();
  try {
    const reader = await context.newPage();
    return await reader.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const paint = canvas.getContext('2d')!;
      paint.drawImage(image, 0, 0);
      const { data: all } = paint.getImageData(0, 0, image.width, image.height);
      const pixels: number[][] = [];
      for (let at = 0; at < all.length; at += 4) {
        pixels.push([all[at]!, all[at + 1]!, all[at + 2]!]);
      }
      return pixels;
    }, shot);
  } finally {
    await context.close();
  }
}

/** Two colours an eye tells apart. */
const apart = (one: number[], other: number[]): boolean =>
  one.some((value, at) => Math.abs(value - other[at]!) > 8);

/** How many pixels of a scroller's track a thumb covers (not its ends: in a menu they see the
 *  frame's round corners). */
async function thumbOn(page: Page, scroller: Locator): Promise<number> {
  const box = (await scroller.boundingBox())!;
  const end = 5;
  const room = await scroller.evaluate(
    (node) => (node as HTMLElement).offsetWidth - node.clientWidth,
  );
  const track = await colours(page, {
    x: Math.round(box.x + box.width) - room,
    y: Math.round(box.y) + end,
    width: room,
    height: Math.round(box.height) - 2 * end,
  });
  return track.filter((pixel) => apart(pixel, track[0]!)).length;
}

testPixels(
  'the thumb shows while the pointer is over its scroller and only then, and nothing moves',
  { width: 1360, height: 640 },
  async (page) => {
    const away = (): Promise<void> => page.mouse.move(60, 400);
    const check = async (scroller: Locator): Promise<void> => {
      await away();
      await expect.poll(() => thumbOn(page, scroller)).toBe(0);
      const width = await scroller.evaluate((node) => node.clientWidth);
      const box = (await scroller.boundingBox())!;
      await page.mouse.move(box.x + 40, box.y + 120);
      await expect.poll(() => thumbOn(page, scroller)).toBeGreaterThan(0);
      // The wheel moves the list under it and the thumb stays; the pointer gone, it goes.
      await page.mouse.wheel(0, 60);
      await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      expect(await thumbOn(page, scroller)).toBeGreaterThan(0);
      await away();
      await expect.poll(() => thumbOn(page, scroller)).toBe(0);
      expect(await scroller.evaluate((node) => node.clientWidth)).toBe(width);
    };
    await open(page, `${WIN}&open=freelancermap:2801`);
    await check(page.getByTestId('list-scroll'));
    await check(page.locator('.stage'));
    await open(page, `${WIN}&view=profile`);
    await check(page.getByTestId('view-profile'));
    await open(page, WIN);
    await openFilter(page);
    await animationsDone(page);
    await check(page.getByTestId('menu'));
  },
);

/** Where a list (a menu's, a field's) stands in its frame. */
async function listMeasure(list: Locator): Promise<{
  frame: { left: number; right: number };
  left: number;
  right: number;
  words: number;
  scrolls: boolean;
}> {
  const frame = await edges(list.locator('xpath=..'));
  const row = list.locator('button').first();
  const { left, right } = await edges(row);
  const words = await row.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('.label') ?? node);
    return range.getBoundingClientRect().left;
  });
  const scrolls = await list.evaluate((node) => node.scrollHeight > node.clientHeight);
  return { frame, left, right, words, scrolls };
}

testWithRoom(
  'a menu that scrolls stands like one that does not: the frame, its words, its rows even',
  { width: 1360, height: 860 },
  async (page) => {
    const at = async (height: number) => {
      await page.setViewportSize({ width: 1360, height });
      await open(page, WIN);
      const button = await edges(page.getByTestId('filter'));
      await openFilter(page);
      await animationsDone(page);
      const measure = await listMeasure(page.getByTestId('menu'));
      // Its right edge on the button's end (a menu stands on whole pixels, the button may not).
      expect(Math.abs(measure.frame.right - button.right), `at ${height}`).toBeLessThan(1);
      expect(measure.left - measure.frame.left, `at ${height}`).toBe(
        measure.frame.right - measure.right,
      );
      return measure;
    };
    const tall = await at(860);
    expect(tall.scrolls).toBe(false);
    for (const height of [810, 640]) {
      const short = await at(height);
      expect(short.scrolls, `at ${height}`).toBe(true);
      expect({ ...short, scrolls: false }, `at ${height}`).toEqual(tall);
    }
  },
);

testWithRoom(
  "a field's list that scrolls stands like one that does not, in the smallest window",
  { width: 480, height: 360 },
  async (page) => {
    const at = async (block: 'center' | 'end') => {
      await open(page, `${WIN}&view=profile`);
      const input = page.getByTestId('profile-countries').locator('input');
      await input.evaluate((node, where) => node.scrollIntoView({ block: where }), block);
      await input.click();
      await page.keyboard.type('S');
      const list = page.getByTestId('profile-countries-options');
      await expect(list).toBeVisible();
      await animationsDone(page);
      const measure = await listMeasure(list);
      expect(measure.left - measure.frame.left, block).toBe(measure.frame.right - measure.right);
      return measure;
    };
    const whole = await at('end');
    expect(whole.scrolls).toBe(false);
    const cut = await at('center');
    expect(cut.scrolls).toBe(true);
    expect({ ...cut, scrolls: false }).toEqual(whole);
  },
);

for (const height of [860, 640]) {
  testPixels(
    `at ${height} high a menu's list leaves the corners and the edge of its frame alone`,
    { width: 1360, height, scale: 3 },
    async (page) => {
      await open(page, WIN);
      await openFilter(page);
      await animationsDone(page);
      const list = page.getByTestId('menu');
      const box = (await list.locator('xpath=..').boundingBox())!;
      const [x, y] = [Math.floor(box.x), Math.floor(box.y)];
      const [end, foot] = [Math.ceil(box.x + box.width), Math.ceil(box.y + box.height)];
      const size = 12;
      /** The four corners and the right edge between them. */
      const ring = async (): Promise<string[]> => {
        await page.mouse.move(1, 1);
        const shots = [
          { x, y, width: size, height: size },
          { x: end - size, y, width: size, height: size },
          { x, y: foot - size, width: size, height: size },
          { x: end - size, y: foot - size, width: size, height: size },
          { x: end - 7, y: y + size, width: 8, height: foot - y - 2 * size },
        ];
        const parts: string[] = [];
        for (const clip of shots) parts.push((await page.screenshot({ clip })).toString('base64'));
        return parts;
      };
      /** The ring with the list in it, against the bare frame. */
      const same = async (): Promise<void> => {
        const shown = await ring();
        await list.evaluate((node) => (node.style.visibility = 'hidden'));
        expect(await ring()).toEqual(shown);
        await list.evaluate((node) => (node.style.visibility = ''));
      };
      await same();
      await list.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
      await same();
    },
  );
}

testPixels(
  "a menu's words draw as crisply as the list's, scrolled or not, at any height",
  { width: 1360, height: 860 },
  async (page) => {
    /** The colours of a word: LCD antialiasing leaves coloured fringes. */
    const fringed = async (word: Locator): Promise<boolean> => {
      const box = (await word.boundingBox())!;
      const pixels = await colours(page, {
        x: Math.floor(box.x),
        y: Math.floor(box.y),
        width: Math.ceil(box.width),
        height: Math.ceil(box.height),
      });
      return pixels.some(([r, g, b]) => Math.abs(r! - g!) > 12 || Math.abs(g! - b!) > 12);
    };
    for (const height of [860, 640]) {
      await page.setViewportSize({ width: 1360, height });
      await open(page, WIN);
      const crisp = await fringed(row(page, 'linkedin-4100200301').locator('.title'));
      const words = page.getByTestId('menu').locator('.item .label');
      await openFilter(page);
      await animationsDone(page);
      expect(await fringed(words.nth(3)), `at ${height}`).toBe(crisp);
      await page.getByTestId('menu').evaluate((node) => node.scrollTo({ top: 60 }));
      expect(await fringed(words.nth(5)), `scrolled at ${height}`).toBe(crisp);
    }
  },
);

test("a select's list of seven rows stands whole, with nothing to scroll", async ({ page }) => {
  await open(page, `${WIN}&view=profile`);
  await page.getByTestId('language-level').first().click();
  const list = page.getByTestId('menu');
  await expect(list.getByRole('option')).toHaveCount(7);
  await animationsDone(page);
  expect(await list.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.wheel(0, 100);
  await animationsDone(page);
  expect(await list.evaluate((node) => node.scrollTop)).toBe(0);
  const frame = await edges(menuFrame(page));
  const rowBox = await edges(list.getByRole('option').first());
  expect(rowBox.left - frame.left).toBe(frame.right - rowBox.right);
});

/* ------------------------------------------------- the dashed edge of a file over a page */

/** A file over the page and gone again: how much of each side of a frame in the view it changes,
 *  each as a share of that side. */
async function dashedEdge(page: Page): Promise<{ [side: string]: number }> {
  const view = (await page.locator('main').boundingBox())!;
  const inset = await page.getByTestId('profile').evaluate((node) => {
    node.classList.add('over');
    const top = parseFloat(getComputedStyle(node, '::after').top);
    node.classList.remove('over');
    return top;
  });
  const [left, top] = [Math.round(view.x), Math.round(view.y)];
  const [width, height] = [Math.round(view.width), Math.round(view.height)];
  const sides = {
    top: { x: left, y: top + inset - 1, width, height: 3 },
    bottom: { x: left, y: top + height - inset - 2, width, height: 3 },
    left: { x: left + inset, y: top, width: 3, height },
    right: { x: left + width - inset - 2, y: top, width: 3, height },
  };
  const read = async () => {
    const shots: number[][][] = [];
    for (const clip of Object.values(sides)) shots.push(await colours(page, clip));
    return shots;
  };
  const without = await read();
  await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
  await expect(page.getByTestId('profile')).toHaveClass(/\bover\b/);
  const over = await read();
  await page.evaluate(() => window.__harness.fire('tauri://drag-leave', null));
  await expect(page.getByTestId('profile')).not.toHaveClass(/\bover\b/);
  const shares: { [side: string]: number } = {};
  Object.entries(sides).forEach(([side, clip], index) => {
    const changed = over[index]!.filter((pixel, at) => apart(pixel, without[index]![at]!)).length;
    // A side three pixels thick holds one line of dashes.
    shares[side] = changed / Math.max(clip.width, clip.height);
  });
  return shares;
}

const wholeFrame = async (page: Page, where: string): Promise<void> => {
  const shares = await dashedEdge(page);
  for (const [side, share] of Object.entries(shares)) {
    expect(share, `${side} ${where}`).toBeGreaterThan(0.25);
  }
};

testPixels(
  'a file over the Profil: one whole frame around the view, at every scroll, clear of its head',
  { width: 1360, height: 860 },
  async (page) => {
    await open(page, `${WIN}&view=profile`);
    const view = page.getByTestId('view-profile');
    await wholeFrame(page, 'at the top');
    await view.evaluate((node) => node.scrollTo({ top: 700 }));
    await wholeFrame(page, 'in the middle');
    await view.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    await wholeFrame(page, 'at the end');
    // At the top it stands as far from the head's button as from the bar.
    await view.evaluate((node) => node.scrollTo({ top: 0 }));
    await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
    const main = (await page.locator('main').boundingBox())!;
    const inset = await page
      .getByTestId('profile')
      .evaluate((node) => parseFloat(getComputedStyle(node, '::after').top));
    const button = (await page.getByTestId('profile-from-cv').boundingBox())!;
    expect(button.y - (main.y + inset)).toBeGreaterThanOrEqual(inset);
    await page.evaluate(() => window.__harness.fire('tauri://drag-leave', null));
    // Without a profile too.
    await open(page, `${WIN}&scenario=no-profile&view=profile`);
    await wholeFrame(page, 'without a profile');
  },
);

/* ------------------------------------------------------- one weight of a hairline */

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

/** How dark a colour is (0 white, 255 black). */
const darkness = (colour: string): number => {
  const [r, g, b] = colour.match(/[\d.]+/g)!.map(Number);
  return 255 - (r! + g! + b!) / 3;
};

test('under the pointer a white button fills on every ground, a state box and a card alike', async ({
  page,
}) => {
  /** The colour of what the control stands on. */
  const ground = (control: Locator): Promise<string> =>
    control.evaluate((node) => {
      for (let at = node.parentElement; at !== null; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)') return colour;
      }
      return '';
    });
  const check = async (control: Locator, where: string): Promise<void> => {
    const under = await ground(control);
    const { hover, press } = await steps(page, control, 'backgroundColor');
    expect(darkness(hover), where).toBeGreaterThan(darkness(under));
    expect(darkness(press), where).toBeGreaterThan(darkness(hover));
  };
  await open(page, `${WIN}&open=freelance:900411`);
  await check(page.getByTestId('reader-sign-in'), 'in a state box');
  await check(page.getByTestId('open-ad'), 'on a card');
  await open(page, `${WIN}&view=profile`);
  await check(page.getByTestId('profile-from-cv'), 'on the page');
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
