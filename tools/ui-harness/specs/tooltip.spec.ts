// The one tooltip handed from anchor to anchor: moving the pointer straight from one trigger
// to the next (a title bar tool, the window's Schließen, the info symbol, a cut row title)
// shows the next tooltip at once, and its very first painted frame already sits where a
// fresh hover of that trigger places it, never at a place measured from the previous text.

import type { Locator, Page } from '@playwright/test';
import { expect, open, test } from './fixtures';
import { list, openJob, rows } from './helpers';

interface Frame {
  text: string;
  x: number;
  y: number;
}

/** Records the tooltip layer's box on every frame its text changes (read in
 *  requestAnimationFrame, so it is the box that frame paints). */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Frame[] = [];
    (window as unknown as { tipFrames: Frame[] }).tipFrames = seen;
    const tick = (): void => {
      const layer = document.querySelector<HTMLElement>('[role="tooltip"]');
      const text = layer?.textContent ?? '';
      if (seen.at(-1)?.text !== text) {
        const box = layer?.getBoundingClientRect();
        seen.push({ text, x: box?.x ?? 0, y: box?.y ?? 0 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The first painted frame of the tooltip once it shows `text`. */
async function firstFrame(page: Page, text: string): Promise<Frame> {
  await expect
    .poll(() =>
      page.evaluate(
        (want) =>
          (window as unknown as { tipFrames: Frame[] }).tipFrames.some((f) => f.text === want),
        text,
      ),
    )
    .toBe(true);
  return page.evaluate(
    (want) => (window as unknown as { tipFrames: Frame[] }).tipFrames.find((f) => f.text === want)!,
    text,
  );
}

/** Where a fresh hover places the tooltip (the pointer away long enough to cool down). */
async function fresh(page: Page, trigger: Locator): Promise<{ x: number; y: number }> {
  await page.mouse.move(600, 500);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.waitForTimeout(500);
  await trigger.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await page.waitForTimeout(250);
  const box = (await tip.boundingBox())!;
  return { x: box.x, y: box.y };
}

test('moving from one tooltip to the next shows it at its own anchor at once', async ({ page }) => {
  await open(page, '?platform=windows');
  const key = (await rows(page).first().getAttribute('data-testid'))!.replace('job-row-', '');
  await openJob(page, key);
  // A narrow list cuts the row titles.
  await page.setViewportSize({ width: 1180, height: 760 });
  const titles = await list(page).locator('.title').all();
  let truncated: Locator | null = null;
  for (const title of titles) {
    if (await title.evaluate((n) => n.scrollWidth > n.clientWidth + 1)) {
      truncated = title;
      break;
    }
  }
  const triggers: Locator[] = [
    page.getByTestId('toggle-sidebar'),
    page.getByTestId('window-close'),
    page.getByTestId('toggle-reader'),
  ];
  const info = page.getByTestId('band-info');
  if ((await info.count()) > 0 && (await info.isVisible())) triggers.splice(2, 0, info);
  if (truncated !== null) triggers.push(truncated);

  // The handover: straight from one trigger to the next, the first frame of each recorded.
  await page.mouse.move(600, 500);
  await page.waitForTimeout(500);
  await watch(page);
  await triggers[0]!.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const handed: { text: string; frame: Frame }[] = [];
  for (const trigger of triggers.slice(1)) {
    await trigger.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    const text = (await tip.textContent()) ?? '';
    handed.push({ text, frame: await firstFrame(page, text) });
  }

  // Each against a fresh hover of the same trigger.
  for (const [at, trigger] of triggers.slice(1).entries()) {
    const want = await fresh(page, trigger);
    const got = handed[at]!.frame;
    expect(Math.abs(got.x - want.x), handed[at]!.text).toBeLessThanOrEqual(1.5);
    expect(Math.abs(got.y - want.y), handed[at]!.text).toBeLessThanOrEqual(1.5);
  }
});
