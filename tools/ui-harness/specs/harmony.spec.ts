// Harmony (owner, 2026-10-24: "alles soll harmonisch und gut aussehen, auch für das Auge"): every
// state of the Vorschau menu keeps the round 10 scale. Text uses only the type ladder and the four
// weights, controls only the control heights, line icons only the one stroke, corners only the
// radius ladder, and nothing is light blue. A new value is a token first, then a line here. And
// on no state does a field hold the caret by itself or a button end in an ellipsis (owner,
// 2026-10-30).

import { PREVIEW_MENU } from '../preview';
import { expect, open, test } from './fixtures';
import { WIN } from './helpers';

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
