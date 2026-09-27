// The job row (user decision 2026-09-27): line 1 the title, right after it the portal's tile,
// the date at the end; line 2 a building and the company, a map pin and the place (without
// the work mode a portal appends). No facts, no badges, no tools, no middle dot. The ring stays
// hollow on the open row; an excluded job shows the ban in the ring's place. The icons are
// the ones of lib/icons.ts, read from the table, not typed again.

import type { Locator, Page } from '@playwright/test';
import { ICONS } from '../../../ui/src/lib/icons';
import { placeOf } from '../../../ui/src/lib/place';
import { animationsDone, expect, NOW, open, test } from './fixtures';
import { list, row, stubList, T, unfoldExcluded, WIN } from './helpers';

/** The classes of each svg in `scope` (a Lucide glyph carries `lucide-<name>`). */
const glyphs = (scope: Locator): Promise<string[][]> =>
  scope.locator('svg').evaluateAll((svgs) => svgs.map((svg) => [...svg.classList]));

/** The row's wrapper (the row button and its dot). */
const job = (page: Page, key: string): Locator =>
  list(page).locator('.job', { has: page.getByTestId(`job-row-${key}`) });

test('line 1: the title, the portal tile right after it, the date at the end', async ({ page }) => {
  await open(page, WIN);
  const target = row(page, 'freelancermap-2801');
  const box = async (selector: string) => (await target.locator(selector).boundingBox())!;
  const title = await box('.title');
  const tile = await box('.portal');
  const date = await box('.date');
  const content = await box('.content');
  // The tile follows the title directly; the date ends the line.
  expect(tile.x - (title.x + title.width)).toBeGreaterThan(0);
  expect(tile.x - (title.x + title.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(date.x + date.width - (content.x + content.width))).toBeLessThan(1);
  for (const part of [tile, date]) {
    expect(Math.abs(part.y + part.height / 2 - (title.y + title.height / 2))).toBeLessThan(2);
  }
  // Also on another portal: "+1", and the tooltip names the portals, joined by a comma.
  await expect(target.locator('.portal')).toHaveText('fm+1');
  await target.locator('.portal').hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    `${T.portal.freelancermap}, ${T.portal.linkedin}`,
  );
  await page.mouse.move(0, 0);
  // A job of one portal: its letters only.
  await expect(row(page, 'linkedin-4100200301').locator('.portal')).toHaveText('in');
});

test('line 2: the company and the place, each with its icon, no middle dot', async ({ page }) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  // A place with the work mode a portal appends: the row leaves it out.
  const moded = jobs.find((each) => /\((vor ort|hybrid|remote)\)$/i.test(each.location));
  expect(moded).toBeDefined();
  const key = `${moded!.key.portal}-${moded!.key.id}`;
  const target = row(page, key);
  await expect(target.getByTestId('row-company')).toHaveText(moded!.company);
  await expect(target.getByTestId('row-place')).toHaveText(placeOf(moded!.location));
  expect(placeOf(moded!.location)).not.toContain('(');
  const meta = await glyphs(target.locator('.meta'));
  expect(meta).toHaveLength(2);
  expect(meta[0]).toContain(`lucide-${ICONS.company}`);
  expect(meta[1]).toContain(`lucide-${ICONS.place}`);
  // No dot anywhere in the list's rows, no facts, no badges.
  for (const text of await list(page).locator('.row').allTextContents()) {
    expect(text).not.toContain('·');
  }
  await expect(list(page).locator('.facts, .foot, .badge, [data-testid="row-facts"]')).toHaveCount(
    0,
  );
});

test('no tools on hover: the date stays, the row keeps its two lines', async ({ page }) => {
  await open(page, WIN);
  const target = job(page, 'linkedin-4100200301');
  await target.hover();
  await animationsDone(page);
  await expect(target.locator('.tools, .tool')).toHaveCount(0);
  await expect(target.locator('.date')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('archive-linkedin-4100200301')).toHaveCount(0);
  // Dates move on while the app stays open.
  const date = row(page, 'linkedin-4100200301').locator('.date');
  const before = await date.textContent();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 5 * 3_600_000));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(date).not.toHaveText(before ?? '');
});

test('an excluded row shows the ban in the ring place, muted, without a dot', async ({ page }) => {
  await open(page, WIN);
  const { excluded } = await stubList(page);
  expect(excluded.length).toBeGreaterThan(0);
  await unfoldExcluded(page);
  for (const key of excluded) {
    const target = row(page, key);
    const ban = target.getByTestId('row-excluded');
    await expect(ban).toBeVisible();
    const [glyph] = await glyphs(ban);
    expect(glyph).toContain(`lucide-${ICONS.excluded}`);
    await expect(ban).toHaveAttribute('aria-label', T.score.excluded);
    await expect(target.locator('.ring')).toHaveCount(0);
    await expect(target).toHaveClass(/muted/);
    await expect(job(page, key).locator('.dot')).toHaveCount(0);
  }
  // A scored row keeps its ring.
  await expect(row(page, 'linkedin-4100200301').locator('.ring')).toHaveCount(1);
});

test('the open row keeps its ring hollow: the track takes no tint', async ({ page }) => {
  await open(page, WIN);
  const track = (key: string): Promise<string> =>
    row(page, key)
      .locator('.ring .track')
      .evaluate((node) => getComputedStyle(node).stroke);
  const rest = await track('linkedin-4100200302');
  await row(page, 'linkedin-4100200302').click();
  await expect(row(page, 'linkedin-4100200302')).toHaveAttribute('aria-current', 'true');
  expect(await track('linkedin-4100200302')).toBe(rest);
  await page.evaluate(() => (document.documentElement.dataset['window'] = 'inactive'));
  expect(await track('linkedin-4100200302')).toBe(rest);
});
