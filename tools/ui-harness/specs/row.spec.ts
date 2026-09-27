// The job row (user decision 2026-09-27): line 1 the title and at its end the stamp of a mail
// list (the time today, "Gestern", "Vorgestern", then the weekday with the date; "Beendet"
// for an ad that takes no applications); line 2 a building and the company, a map pin and
// the place (without the work mode a portal appends), and the pay the ad states with the
// euro. No portal, no facts, no badges, no middle dot. Under the pointer the
// moves of the row's place fade in as its tools over the date (the same table as its menu),
// in a slot that never moves the title. The ring stays hollow on the open row; an excluded
// job shows the ban in the ring's place. The icons are the ones of lib/icons.ts, read from
// the table, not typed again.

import type { Locator, Page } from '@playwright/test';
import { ICONS, type IconMeaning } from '../../../ui/src/lib/icons';
import { placeOf } from '../../../ui/src/lib/place';
import { animationsDone, calls, expect, NOW, open, test } from './fixtures';
import {
  list,
  listed,
  openJob,
  openPlace,
  row,
  rowMenu,
  settleMoves,
  stage,
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

test('line 1: the title and the stamp at its end, no portal', async ({ page }) => {
  await open(page, WIN);
  const target = row(page, 'freelancermap-2801');
  const box = async (selector: string) => (await target.locator(selector).boundingBox())!;
  const title = await box('.title');
  const date = await box('.date');
  const content = await box('.content');
  // The stamp ends the line, on the title's middle.
  expect(Math.abs(date.x + date.width - (content.x + content.width))).toBeLessThan(1);
  expect(Math.abs(date.y + date.height / 2 - (title.y + title.height / 2))).toBeLessThan(2);
  // No portal anywhere in the rows (the reader names it).
  await expect(list(page).locator('.portal')).toHaveCount(0);
  for (const text of await list(page).locator('.row').allTextContents()) {
    for (const portal of Object.values(T.portal)) expect(text).not.toContain(portal);
  }
});

test('the stamp of a mail list: the time today, Gestern, Vorgestern, then weekday and date', async ({
  page,
}) => {
  await open(page, WIN);
  const stamp = (key: string): Locator => row(page, key).getByTestId('row-date');
  // Today (the fixed clock stands at 24.09., 09:30 in Berlin): the time of the alert mail.
  await expect(stamp('freelancermap-2801')).toHaveText('07:30');
  await expect(stamp('freelancermap-2803')).toHaveText('00:30');
  // The two days before in words, capitalised like the start of a line.
  await expect(stamp('linkedin-4100200302')).toHaveText('Gestern');
  await expect(stamp('freelance-900413')).toHaveText('Vorgestern');
  // Earlier days: the weekday with the date.
  await expect(stamp('freelancermap-2805')).toHaveText('Mo 21.09.');
});

test('an ad that takes no applications says Beendet at the end of its title line', async ({
  page,
}) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  const closed = jobs.filter((each) => each.closed);
  expect(closed.length).toBeGreaterThan(0);
  const muted = await tokenColour(page, '--text-muted');
  for (const each of closed) {
    const target = row(page, `${each.key.portal}-${each.key.id}`);
    await expect(target.getByTestId('row-date')).toHaveText(T.job.closed);
    await expect(target.locator('.title')).toHaveCSS('color', muted);
  }
  // An open ad keeps its stamp and its ink.
  const open_ = row(page, 'freelancermap-2801');
  await expect(open_.getByTestId('row-date')).not.toHaveText(T.job.closed);
  await expect(open_.locator('.title')).not.toHaveCSS('color', muted);
});

test('the stamp says when the job came in, never its deadline', async ({ page }) => {
  await open(page, WIN);
  // 2802 closes applications on 28.09. (four days after the fixed clock): the row still says
  // when its alert mail came, in the stamp's colour (the reader's Jobdetails name the day).
  const soon = row(page, 'freelancermap-2802').getByTestId('row-date');
  await expect(soon).toHaveText('03:30');
  await expect(soon).toHaveCSS('color', await tokenColour(page, '--text-subtle'));
  await expect(list(page)).not.toContainText('Frist');
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

test('line 2 ends with the pay the ad states: the day rate or the salary, with the euro', async ({
  page,
}) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  const facts = (key: string) =>
    jobs.find((each) => `${each.key.portal}-${each.key.id}` === key)!.match!.facts;
  // A day rate (interim, freelance).
  const rated = facts('freelancermap-2801');
  const day = row(page, 'freelancermap-2801').getByTestId('row-pay');
  await expect(day).toHaveText(T.facts.pay(rated.rate!, 'day', null));
  expect((await glyphs(day))[0]).toContain(`lucide-${ICONS.money}`);
  // A salary (a permanent job).
  const salaried = facts('linkedin-4100200303');
  await expect(row(page, 'linkedin-4100200303').getByTestId('row-pay')).toHaveText(
    T.facts.pay(salaried.salary!, 'year', null),
  );
  // An ad without a pay: company and place only.
  expect(facts('freelance-900411').rate).toBeNull();
  await expect(row(page, 'freelance-900411').getByTestId('row-pay')).toHaveCount(0);
  expect(await glyphs(row(page, 'freelance-900411').locator('.meta'))).toHaveLength(2);
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
  purge: 'trash',
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

  test('the tools fade in over the date: the title, the date and line 2 keep their boxes', async ({
    page,
  }) => {
    await open(page, WIN);
    // A long title, cut by its line: the slot never takes more of it on hover.
    const key = 'freelancermap-2801';
    const target = row(page, key);
    const boxes = async (): Promise<string> =>
      JSON.stringify(
        await Promise.all(
          ['.title', '.date', '.meta'].map((part) => target.locator(part).boundingBox()),
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

  test('a tool that deletes is red, on a red wash under the pointer; the others stay quiet', async ({
    page,
  }) => {
    await open(page, WIN);
    const danger = await tokenColour(page, '--danger-strong');
    const wash = await tokenColour(page, '--danger-soft');
    const key = 'linkedin-4100200301';
    await pointAt(page, key);
    const trash = job(page, key).getByTestId('tool-trash');
    const archive = job(page, key).getByTestId('tool-archive');
    await expect(trash).toHaveCSS('color', danger);
    await trash.hover();
    await expect(trash).toHaveCSS('color', danger);
    await expect(trash).toHaveCSS('background-color', wash);
    await archive.hover();
    await expect(archive).not.toHaveCSS('color', danger);
    await expect(trash).not.toHaveCSS('background-color', wash);
    // In the Papierkorb Endgültig löschen looks the same.
    await viaMenu(page, 'trash', key);
    await settleMoves(page);
    await openPlace(page, 'trash');
    await pointAt(page, key);
    const purge = job(page, key).getByTestId('tool-purge');
    await expect(purge).toHaveCSS('color', danger);
    await purge.hover();
    await expect(purge).toHaveCSS('background-color', wash);
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
    // Every toast is as wide as the others (--toast-width), a one-word one too.
    const toast = (await page.getByTestId('toast').last().boundingBox())!;
    expect(Math.round(toast.width)).toBe(440);
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

  test("a double click on a tool is the tool's: it opens no ad", async ({ page }) => {
    await open(page, WIN);
    const key = 'linkedin-4100200301';
    await pointAt(page, key);
    await job(page, key).getByTestId('tool-archive').dblclick();
    await expect(row(page, key)).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.archived);
    // The second click is no second move either (the list ignores it for a moment).
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
    expect(await calls(page, 'open_target')).toHaveLength(0);
    // A tool whose row stays (Endgültig löschen waits for a run) takes the double click too.
    await settleMoves(page);
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await settleMoves(page);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await openPlace(page, 'trash');
    // (The run's line moves on: no waiting for every animation to end.)
    await row(page, 'freelancermap-2802').hover();
    const purge = job(page, 'freelancermap-2802').getByTestId('tool-purge');
    await expect(purge).toHaveAttribute('aria-disabled', 'true');
    // (It says why it waits: Playwright takes it for a disabled control.)
    await purge.dblclick({ force: true });
    await expect(row(page, 'freelancermap-2802')).toBeVisible();
    expect(await calls(page, 'open_target')).toHaveLength(0);
    // A double click on the row itself still opens its ad.
    await row(page, 'freelancermap-2802').dblclick();
    await expect.poll(async () => (await calls(page, 'open_target')).length).toBe(1);
    await page.evaluate(() => (window.__harness.holdAfter = null));
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

test('the row menu and the reader offer the same: no alert mail, no ad text, an ad gone offline', async ({
  page,
}) => {
  // A wide window: the reader's buttons show their words.
  await page.setViewportSize({ width: 1800, height: 900 });
  await open(page, WIN);
  // freelancermap-2805: its ad never came, and here its alert mail cannot be opened;
  // linkedin-4100200304: its ad takes no applications any more. The list loads them again.
  await page.evaluate(() => window.__harness.noMail({ portal: 'freelancermap', id: '2805' }));
  await openPlace(page, 'archive');
  await openPlace(page, 'inbox');
  const SHOWN = [
    ['mail', 'reader-mail'],
    ['open-ad', 'open-ad'],
    ['prompt', 'reader-prompt'],
  ] as const;
  /** Each entry's words and whether it is off: in the row's menu, then in the reader. */
  const offered = async (key: string): Promise<{ menu: string[]; reader: string[] }> => {
    await rowMenu(page, key);
    const state = async (target: Locator): Promise<string> =>
      `${await target.locator('.label').innerText()} ${(await target.getAttribute('aria-disabled')) ?? 'on'}`;
    const menu: string[] = [];
    for (const [id] of SHOWN) menu.push(await state(page.getByTestId(`menu-item-${id}`)));
    await page.keyboard.press('Escape');
    await openJob(page, key);
    const reader: string[] = [];
    for (const [, testid] of SHOWN) reader.push(await state(stage(page).getByTestId(testid)));
    return { menu, reader };
  };
  const failed = await offered('freelancermap-2805');
  expect(failed.menu).toEqual([
    `${T.actions.mail} true`,
    `${T.actions.openAd} on`,
    `${T.actions.prompt} true`,
  ]);
  expect(failed.reader).toEqual(failed.menu);
  // Both say why the prompt waits, in the reader's words.
  const prompt = stage(page).getByTestId('reader-prompt');
  await prompt.hover();
  await expect(page.getByRole('tooltip')).toHaveText(T.reader.promptNoText);
  await page.mouse.move(0, 0);
  await rowMenu(page, 'freelancermap-2805');
  await page.getByTestId('menu-item-prompt').hover();
  await expect(page.getByRole('tooltip')).toHaveText(T.reader.promptNoText);
  await page.keyboard.press('Escape');
  const closed = await offered('linkedin-4100200304');
  expect(closed.menu).toEqual([
    `${T.actions.mail} on`,
    `${T.reader.openOffline} on`,
    `${T.actions.prompt} on`,
  ]);
  expect(closed.reader).toEqual(closed.menu);
});

test('stamps move on while the app stays open', async ({ page }) => {
  await open(page, WIN);
  const date = row(page, 'linkedin-4100200301').locator('.date');
  const before = await date.textContent();
  // The next day: the time of today becomes "Gestern".
  await page.clock.setFixedTime(new Date(NOW.getTime() + 24 * 3_600_000));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(date).not.toHaveText(before ?? '');
});

test('an excluded row shows the empty ring with the ban in it, muted, without a dot', async ({
  page,
}) => {
  await open(page, WIN);
  const { excluded } = await stubList(page);
  expect(excluded.length).toBeGreaterThan(0);
  await unfoldExcluded(page);
  for (const key of excluded) {
    const target = row(page, key);
    const ban = target.getByTestId('row-excluded');
    await expect(ban).toBeVisible();
    // As large as every other row's ring: its empty track, the ban in the middle, no number.
    await expect(ban.locator(`svg.lucide-${ICONS.excluded}`)).toHaveCount(1);
    await expect(ban).toHaveAttribute('aria-label', T.score.excluded);
    await expect(ban.locator('.value')).toHaveCount(0);
    const size = (await ban.boundingBox())!.width;
    const other = (await list(page).locator('.ring').first().boundingBox())!.width;
    expect(Math.round(size)).toBe(Math.round(other));
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
