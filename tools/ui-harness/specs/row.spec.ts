// The job row (user decision 2026-09-27): line 1 the title and at its end the stamp of a mail
// list (the time today, "Gestern", "Vorgestern", then the weekday with the date; "Beendet"
// for an ad that takes no applications); line 2 the company, the place (without the work mode
// a portal appends) and the pay the ad states. No portal, no facts, no badges, no middle dot.
// Under the pointer the moves of the row's place show as its tools over the date (the same
// table as its menu). An excluded job shows the ban in the ring's place. What the row looks
// like (sizes, colours, glyphs) is not pinned here.

import type { Locator, Page } from '@playwright/test';
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
  unfoldExcluded,
  viaMenu,
  WIN,
} from './helpers';

/** The row's wrapper (the row button and its dot). */
const job = (page: Page, key: string): Locator =>
  list(page).locator('.job', { has: page.getByTestId(`job-row-${key}`) });

test('no portal anywhere in the rows', async ({ page }) => {
  await open(page, WIN);
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
  // Today (the fixed clock stands at 24.09., 09:30 in Berlin): the time the job came into
  // CXact (not its alert mail's).
  await expect(stamp('freelancermap-2801')).toHaveText('08:24');
  await expect(stamp('freelancermap-2803')).toHaveText('00:30');
  // The two days before in words, capitalised like the start of a line.
  await expect(stamp('linkedin-4100200302')).toHaveText('Gestern');
  await expect(stamp('freelance-900413')).toHaveText('Vorgestern');
  // Earlier days: the weekday with the date.
  await expect(stamp('freelancermap-2805')).toHaveText('Mo 21.09.');
});

test('an ad that takes no applications says Beendet in its stamp', async ({ page }) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  const closed = jobs.filter((each) => each.closed);
  expect(closed.length).toBeGreaterThan(0);
  for (const each of closed) {
    const target = row(page, `${each.key.portal}-${each.key.id}`);
    await expect(target.getByTestId('row-date')).toHaveText(T.job.closed);
  }
  // An open ad keeps its stamp.
  await expect(row(page, 'freelancermap-2801').getByTestId('row-date')).not.toHaveText(
    T.job.closed,
  );
});

test('the stamp says when the job came in, never its deadline', async ({ page }) => {
  await open(page, WIN);
  // 2802 closes applications on 28.09. (four days after the fixed clock): the row still says
  // when its alert mail came (the reader's Jobdetails name the day).
  await expect(row(page, 'freelancermap-2802').getByTestId('row-date')).toHaveText('03:30');
  await expect(list(page)).not.toContainText('Frist');
});

test('line 2: the company and the place, no middle dot', async ({ page }) => {
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
  // No dot anywhere in the list's rows, no facts, no badges.
  for (const text of await list(page).locator('.row').allTextContents()) {
    expect(text).not.toContain('·');
  }
  await expect(list(page).locator('.facts, .foot, .badge, [data-testid="row-facts"]')).toHaveCount(
    0,
  );
});

test('line 2 ends with the pay the ad states: the day rate or the salary', async ({ page }) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  const facts = (key: string) =>
    jobs.find((each) => `${each.key.portal}-${each.key.id}` === key)!.match!.facts;
  // A day rate (interim, freelance).
  const rated = facts('freelancermap-2801');
  const day = row(page, 'freelancermap-2801').getByTestId('row-pay');
  await expect(day).toHaveText(T.facts.pay(rated.rate!, 'day', null));
  // A salary (a permanent job).
  const salaried = facts('linkedin-4100200303');
  await expect(row(page, 'linkedin-4100200303').getByTestId('row-pay')).toHaveText(
    T.facts.pay(salaried.salary!, 'year', null),
  );
  // An ad without a pay: company and place only.
  expect(facts('freelance-900411').rate).toBeNull();
  await expect(row(page, 'freelance-900411').getByTestId('row-pay')).toHaveCount(0);
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
  const shows = ['open', 'mail', 'open-ad', 'prompt', 'include'];
  return ids.filter((id) => !shows.includes(id));
}

/** The pointer onto a row (its middle, away from its tools' slot). */
async function pointAt(page: Page, key: string): Promise<void> {
  await row(page, key).hover();
  await animationsDone(page);
}

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
        await expect(tool).toHaveAttribute('tabindex', '-1');
        await tool.hover();
        await expect(page.getByRole('tooltip')).toHaveText(T.actions[id]);
      }
      // The pointer leaves: the tools go.
      await page.mouse.move(0, 0);
      await expect(job(page, key).getByTestId('row-tools')).toHaveCount(0);
    }
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
  /** Each entry's words and whether it is off, or `none` where it is not there: in the
   *  row's menu, then in the reader. */
  const offered = async (key: string): Promise<{ menu: string[]; reader: string[] }> => {
    await rowMenu(page, key);
    const state = async (target: Locator): Promise<string> =>
      (await target.count()) === 0
        ? 'none'
        : `${await target.locator('.label').innerText()} ${(await target.getAttribute('aria-disabled')) ?? 'on'}`;
    const menu: string[] = [];
    for (const [id] of SHOWN) menu.push(await state(page.getByTestId(`menu-item-${id}`)));
    await page.keyboard.press('Escape');
    await openJob(page, key);
    const reader: string[] = [];
    for (const [, testid] of SHOWN) reader.push(await state(stage(page).getByTestId(testid)));
    return { menu, reader };
  };
  // A job without an alert mail offers none (user, 2026-10-01: no button at all), and one
  // without a score no prompt; the reader of a job not scored yet shows only its state box
  // (design round 7), its menu still opens the ad.
  const failed = await offered('freelancermap-2805');
  expect(failed.menu).toEqual(['none', `${T.actions.openAd} on`, 'none']);
  expect(failed.reader).toEqual(['none', 'none', 'none']);
  await expect(stage(page).getByTestId('detail-note')).toBeVisible();
  const closed = await offered('linkedin-4100200304');
  expect(closed.menu).toEqual([
    `${T.actions.mail} on`,
    `${T.actions.openAd} on`,
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

test('an excluded row shows the ban in the ring place, without a number, no dot', async ({
  page,
}) => {
  await open(page, WIN);
  const { excluded } = await stubList(page);
  expect(excluded.length).toBeGreaterThan(0);
  await unfoldExcluded(page);
  for (const key of excluded) {
    const ban = row(page, key).getByTestId('row-excluded');
    await expect(ban).toBeVisible();
    await expect(ban).toHaveAttribute('aria-label', T.score.excluded);
    await expect(ban.locator('.value')).toHaveCount(0);
    await expect(job(page, key).locator('.dot')).toHaveCount(0);
  }
  // A scored row keeps its ring.
  await expect(row(page, 'linkedin-4100200301').locator('.ring')).toHaveCount(1);
});
