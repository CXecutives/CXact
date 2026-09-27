// The job row (user decision 2026-09-27): line 1 the title, right after it the portal's tile,
// the date at the end; line 2 a building and the company, a map pin and the place (without
// the work mode a portal appends). No facts, no badges, no middle dot. Under the pointer the
// moves of the row's place fade in as its tools over the date (the same table as its menu),
// in a slot that never moves the title. The ring stays hollow on the open row; an excluded
// job shows the ban in the ring's place. The icons are the ones of lib/icons.ts, read from
// the table, not typed again.

import type { Locator, Page } from '@playwright/test';
import { ICONS, type IconMeaning } from '../../../ui/src/lib/icons';
import { placeOf } from '../../../ui/src/lib/place';
import { animationsDone, expect, NOW, open, test } from './fixtures';
import {
  list,
  listed,
  openPlace,
  row,
  rowMenu,
  settleMoves,
  stubList,
  T,
  tokenColour,
  unfoldExcluded,
  viaMenu,
  WIN,
} from './helpers';

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

/** The tools a row shows now (their ids, in their order). */
const toolIds = (page: Page, key: string): Promise<string[]> =>
  job(page, key)
    .locator('[data-testid^="tool-"]')
    .evaluateAll((all) => all.map((tool) => (tool.getAttribute('data-testid') ?? '').slice(5)));

/** The moves of the row's menu (its entries after the line, without the include or the
 *  exclude of an excluded job). */
async function menuMoves(page: Page, key: string): Promise<string[]> {
  const menu = await rowMenu(page, key);
  const ids = await menu
    .locator('[data-testid^="menu-item-"]')
    .evaluateAll((all) => all.map((item) => (item.getAttribute('data-testid') ?? '').slice(10)));
  await page.keyboard.press('Escape');
  const shows = ['open', 'mail', 'open-ad', 'prompt', 'include', 'exclude'];
  return ids.filter((id) => !shows.includes(id));
}

/** The pointer onto a row (its middle, away from its tools' slot). */
async function pointAt(page: Page, key: string): Promise<void> {
  await row(page, key).hover();
  await animationsDone(page);
}

/** The glyph of each move (lib/icons.ts meanings). */
const MOVE_ICONS: Record<string, IconMeaning> = {
  archive: 'archive',
  unarchive: 'unarchive',
  trash: 'trash',
  restore: 'undo',
  purge: 'purge',
};

test.describe('tools', () => {
  test('each place shows its moves as icons, in the order and with the words of the menu', async ({
    page,
  }) => {
    await open(page, WIN);
    const places = [
      { place: 'inbox', key: 'linkedin-4100200301', tools: ['archive', 'trash'] },
      { place: 'archive', key: 'linkedin-4100200306', tools: ['unarchive', 'trash'] },
      { place: 'trash', key: 'freelancermap-2802', tools: ['restore', 'purge'] },
    ] as const;
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await settleMoves(page);
    for (const { place, key, tools } of places) {
      await openPlace(page, place);
      // None at rest: only the row under the pointer has them.
      await page.mouse.move(0, 0);
      await expect(list(page).getByTestId('row-tools')).toHaveCount(0);
      await pointAt(page, key);
      await expect(job(page, key).getByTestId('row-tools')).toBeVisible();
      expect(await toolIds(page, key), place).toEqual([...tools]);
      expect(await menuMoves(page, key), place).toEqual([...tools]);
      await pointAt(page, key);
      for (const id of tools) {
        const tool = job(page, key).getByTestId(`tool-${id}`);
        await expect(tool).toHaveAccessibleName(T.actions[id]);
        await expect(tool).toHaveClass(/icon-only/);
        await expect(tool).toHaveAttribute('tabindex', '-1');
        expect((await glyphs(tool))[0], id).toContain(`lucide-${ICONS[MOVE_ICONS[id]!]}`);
        await tool.hover();
        await expect(page.getByRole('tooltip')).toHaveText(T.actions[id]);
      }
      // The pointer leaves: the tools go, the date is back.
      await page.mouse.move(0, 0);
      await expect(job(page, key).getByTestId('row-tools')).toHaveCount(0);
      await expect(job(page, key).locator('.date')).toHaveCSS('opacity', '1');
    }
  });

  test('the tools fade in over the date: the title, the tile and the date keep their boxes', async ({
    page,
  }) => {
    await open(page, WIN);
    // A long title, cut by its line: the slot never takes more of it on hover.
    const key = 'freelancermap-2801';
    const target = row(page, key);
    const boxes = async (): Promise<string> =>
      JSON.stringify(
        await Promise.all(
          ['.title', '.portal', '.date', '.meta'].map((part) => target.locator(part).boundingBox()),
        ),
      );
    const rest = await boxes();
    await pointAt(page, key);
    await expect(job(page, key).getByTestId('row-tools')).toBeVisible();
    expect(await boxes()).toBe(rest);
    await expect(target.locator('.date')).toHaveCSS('opacity', '0');
    await expect(job(page, key).locator('.tool').first()).toHaveCSS('opacity', '1');
    // The tools stand in the date's slot, their right edge on the date's, on the title line.
    const date = (await target.locator('.date').boundingBox())!;
    const tools = (await job(page, key).getByTestId('row-tools').boundingBox())!;
    const title = (await target.locator('.title').boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(date.x - 0.5);
    expect(Math.abs(tools.x + tools.width - (date.x + date.width))).toBeLessThan(1);
    expect(Math.abs(tools.y + tools.height / 2 - (title.y + title.height / 2))).toBeLessThan(1);
    // The pointer leaves: everything stands where it stood.
    await page.mouse.move(0, 0);
    await expect(job(page, key).getByTestId('row-tools')).toHaveCount(0);
    expect(await boxes()).toBe(rest);
  });

  test('a tool that deletes turns red under the pointer, the others stay quiet', async ({
    page,
  }) => {
    await open(page, WIN);
    const danger = await tokenColour(page, '--danger-strong');
    const key = 'linkedin-4100200301';
    await pointAt(page, key);
    const trash = job(page, key).getByTestId('tool-trash');
    const archive = job(page, key).getByTestId('tool-archive');
    await expect(trash).not.toHaveCSS('color', danger);
    await trash.hover();
    await expect(trash).toHaveCSS('color', danger);
    await expect(trash).toHaveCSS('background-color', await tokenColour(page, '--danger-soft'));
    await archive.hover();
    await expect(archive).not.toHaveCSS('color', danger);
    await expect(trash).not.toHaveCSS('color', danger);
    // In the Papierkorb Endgültig löschen turns red the same way.
    await viaMenu(page, 'trash', key);
    await settleMoves(page);
    await openPlace(page, 'trash');
    await pointAt(page, key);
    const purge = job(page, key).getByTestId('tool-purge');
    await expect(purge).not.toHaveCSS('color', danger);
    await purge.hover();
    await expect(purge).toHaveCSS('color', danger);
    const restore = job(page, key).getByTestId('tool-restore');
    await restore.hover();
    await expect(restore).not.toHaveCSS('color', danger);
  });

  test('a click moves the job; the row that slides under the pointer waits for it to move', async ({
    page,
  }) => {
    await open(page, WIN);
    const [first, second] = await listed(page);
    await pointAt(page, first!);
    await job(page, first!).getByTestId('tool-archive').click();
    await expect(row(page, first!)).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.archived);
    // The next row stands under the pointer now, its tools' slot under the tool: none until
    // the pointer moves.
    await animationsDone(page);
    await page.waitForTimeout(200);
    await expect(job(page, second!).getByTestId('row-tools')).toHaveCount(0);
    await expect(row(page, second!).locator('.date')).toHaveCSS('opacity', '1');
    // It moves (still on the row): the tools come.
    const box = (await row(page, second!).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(job(page, second!).getByTestId('row-tools')).toBeVisible();
    expect(await toolIds(page, second!)).toEqual(['archive', 'trash']);
  });

  test("the tools stay while the row's menu is open", async ({ page }) => {
    await open(page, WIN);
    const key = 'linkedin-4100200302';
    const menu = await rowMenu(page, key);
    await expect(job(page, key).getByTestId('row-tools')).toBeVisible();
    await menu.getByTestId('menu-item-mail').hover();
    await expect(job(page, key).getByTestId('row-tools')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await expect(job(page, key).getByTestId('row-tools')).toHaveCount(0);
  });
});

test('dates move on while the app stays open', async ({ page }) => {
  await open(page, WIN);
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
