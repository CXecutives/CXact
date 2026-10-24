// The motion layer's own rules (lib/motion): the caps of a stagger, checked on its pure
// function with the values of tokens.css (no page needed), and the motion tokens that reduced
// motion zeroes, in the page.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as pure } from '@playwright/test';
import { staggerDelay } from '../../../ui/src/lib/motion/enter';
import { expect, open, test } from './fixtures';
import { WIN } from './helpers';

const tokens = readFileSync(
  fileURLToPath(new URL('../../../ui/src/styles/tokens.css', import.meta.url)),
  'utf8',
);

/** A token's value in :root (its first declaration; the reduced-motion block comes later). */
function value(name: string): number {
  const found = new RegExp(`^\\s*${name}:\\s*([\\d.]+)`, 'm').exec(tokens)?.[1];
  if (found === undefined) throw new Error(`${name} missing in tokens.css`);
  return Number(found);
}

pure('a stagger steps through 10 rows, 4 cards or 8 groups and ends within its span', () => {
  const piece = value('--dur-slow');
  const span = value('--stagger-span');
  const max = value('--stagger-max');
  expect(span).toBeLessThanOrEqual(400);
  const delays = (step: number): number[] =>
    Array.from({ length: 30 }, (_, index) => staggerDelay(index, step, piece, span, max));
  for (const [name, items] of [
    ['--stagger-row', 10],
    ['--stagger-card', 4],
    ['--stagger-group', 8],
  ] as const) {
    const step = value(name);
    const all = delays(step);
    expect(all.slice(0, 2), name).toEqual([0, step]);
    expect(new Set(all).size, name).toBe(items);
    // The later items come with the last one that steps; the whole stagger ends in time.
    expect(new Set(all.slice(items - 1)).size, name).toBe(1);
    expect(Math.max(...all) + piece, name).toBeLessThanOrEqual(span);
  }
  // Reduced motion zeroes the steps: everything at once.
  expect(new Set(delays(0))).toEqual(new Set([0]));
});

test('reduced motion zeroes the steps, the fades and the travel of the motion tokens', async ({
  page,
}) => {
  const MOTION = [
    '--stagger-row',
    '--stagger-card',
    '--stagger-group',
    '--stagger-span',
    '--dur-fade',
    '--dur-reveal',
    '--move-chip',
  ];
  const read = (): Promise<number[]> =>
    page.evaluate((names) => {
      const style = getComputedStyle(document.documentElement);
      return names.map((name) => parseFloat(style.getPropertyValue(name)));
    }, MOTION);
  await open(page, WIN);
  expect((await read()).every((ms) => ms > 0)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(read).toEqual(MOTION.map(() => 0));
});
