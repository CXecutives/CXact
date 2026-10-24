// The motion layer's own rules (lib/motion): the caps of a stagger and the pace of browsing,
// checked on their pure functions with the values of tokens.css (no page needed), the motion
// tokens that reduced motion zeroes, and where motion plays in the page: never on a view
// switch or a job swap (no replay, no empty frame), on another place, a menu and a setup
// step (from the side it was reached from).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as pure, type Page } from '@playwright/test';
import { staggerDelay } from '../../../ui/src/lib/motion/enter';
import { createPace } from '../../../ui/src/lib/motion/pace';
import { expect, motionSettled, nav, open, test } from './fixtures';
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

pure('a stagger steps through 10 rows and ends within its span', () => {
  const piece = value('--dur-slow');
  const span = value('--stagger-span');
  const max = value('--stagger-max');
  expect(span).toBeLessThanOrEqual(400);
  const delays = (step: number): number[] =>
    Array.from({ length: 30 }, (_, index) => staggerDelay(index, step, piece, span, max));
  const step = value('--stagger-row');
  const all = delays(step);
  expect(all.slice(0, 2)).toEqual([0, step]);
  expect(new Set(all).size).toBe(10);
  // The later rows come with the last one that steps; the whole stagger ends in time.
  expect(new Set(all.slice(9)).size).toBe(1);
  expect(Math.max(...all) + piece).toBeLessThanOrEqual(span);
  // Reduced motion zeroes the steps: everything at once.
  expect(new Set(delays(0))).toEqual(new Set([0]));
});

pure('an open soon after the last one, or with a key held, does not animate', () => {
  let now = 0;
  const frames: (() => void)[] = [];
  const pace = createPace({
    now: () => now,
    gap: () => value('--delay-browse'),
    nextFrame: (callback) => frames.push(callback),
  });
  const at = (ms: number): void => {
    for (const callback of frames.splice(0)) callback();
    now = ms;
  };
  expect(pace.animateOpen()).toBe(true);
  // The list and the job view ask for the same open in one frame: one answer.
  expect(pace.animateOpen()).toBe(true);
  expect(pace.browsingFast()).toBe(false);
  at(100);
  expect(pace.browsingFast()).toBe(true);
  expect(pace.animateOpen()).toBe(false);
  expect(pace.animateOpen()).toBe(false);
  at(400);
  expect(pace.browsingFast()).toBe(false);
  expect(pace.animateOpen()).toBe(true);
  // A held arrow key repeats its keydown: every open while it repeats is fast.
  at(1000);
  pace.noteKey(true);
  at(1100);
  expect(pace.animateOpen()).toBe(false);
  // Let go: no repeat for longer than the gap.
  at(1500);
  expect(pace.animateOpen()).toBe(true);
  // Pressed anew (no repeat): not held.
  at(2000);
  pace.noteKey(true);
  pace.noteKey(false);
  expect(pace.animateOpen()).toBe(true);
});

test('reduced motion zeroes the steps, the fades and the travel of the motion tokens', async ({
  page,
}) => {
  const MOTION = [
    '--stagger-row',
    '--stagger-span',
    '--dur-fade',
    '--dur-reveal',
    '--move-sm',
    '--move-lg',
    '--move-nudge',
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

/** The animations that start within `ms` after `act`, as `target: properties`. */
async function started(page: Page, act: () => Promise<void>, ms = 400): Promise<string[]> {
  await page.evaluate(() => {
    const seen = new Set(document.getAnimations());
    const found: string[] = [];
    (window as unknown as { __started: string[] }).__started = found;
    const tick = (): void => {
      for (const animation of document.getAnimations()) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        const effect = animation.effect as KeyframeEffect | null;
        const target = effect?.target as HTMLElement | null;
        const keys = effect?.getKeyframes().flatMap((frame) => Object.keys(frame)) ?? [];
        const props = [...new Set(keys)].filter((key) => key === 'opacity' || key === 'transform');
        found.push(`${target?.dataset.testid ?? target?.className ?? '?'}: ${props.join(',')}`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() => (window as unknown as { __started: string[] }).__started);
}

/** Entries that hide content for a while: an opacity animation (a fade or a rise). */
const fades = (list: string[]): string[] => list.filter((entry) => entry.includes('opacity'));

test('a view switch shows the view at once: no group, row or card replays its entry', async ({
  page,
}) => {
  await open(page, WIN);
  await page.locator('[data-testid="job-rows"] [data-testid^="job-row-"]').first().click();
  await motionSettled(page);
  for (const id of ['nav-profile', 'nav-settings', 'nav-jobs'] as const) {
    expect(fades(await started(page, () => nav(page, id))), id).toEqual([]);
  }
});

test('another job is there at once: the job view never stands empty for a frame', async ({
  page,
}) => {
  await open(page, WIN);
  const rows = page.locator('[data-testid="job-rows"] [data-testid^="job-row-"]');
  await rows.nth(0).click();
  await motionSettled(page);
  const found = await started(page, () => rows.nth(1).click());
  expect(fades(found).filter((entry) => !entry.startsWith('row-tools'))).toEqual([]);
});

test('another place lets its rows rise', async ({ page }) => {
  await open(page, WIN);
  await expect(page.getByTestId('places')).toBeVisible();
  const rises = await started(page, () => page.getByTestId('place-archive').click());
  expect(fades(rises).length).toBeGreaterThan(0);
});

// A menu leaves at once (a fading one beside the next would stand twice for a moment).
test('a menu drops in when it opens', async ({ page }) => {
  await open(page, WIN);
  const opened = await started(page, () => page.getByTestId('filter').click());
  expect(opened).toContain('menu: opacity,transform');
});

test('a setup step slides in from the side it was reached from, its card stays', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  const offset = (): Promise<number> =>
    page.evaluate(() => {
      const content = document.querySelector('[data-testid="first-step"] .content');
      const frames = content?.getAnimations()[0]?.effect as KeyframeEffect | undefined;
      const from = String(frames?.getKeyframes()[0]?.transform ?? '');
      return Number(/translateX\((-?[\d.]+)px\)/.exec(from)?.[1] ?? 0);
    });
  await page.getByTestId('first-next').click();
  expect(await offset()).toBeGreaterThan(0);
  await motionSettled(page);
  await page.getByTestId('first-back').click();
  expect(await offset()).toBeLessThan(0);
});
