// The job row (round 10, user decision 2026-10-24): one line, the ring and the title; no
// company, place, pay, date or dot (the reader and the day's heading have them). A new job's
// title in 650 with a hidden "Neu"; a job in the Papierkorb and a closed ad muted in 450, an
// excluded one not (its ban marks it). Under the pointer the moves of the row's place fade in
// as its tools over the row's end (the same table as its menu), no room kept for them. One
// highlight marks the open row (RowBar). Sizes are pinned only where the design names them.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, motionSettled, open, settle, test } from './fixtures';
import {
  chooseSort,
  failNext,
  list,
  listed,
  openFilter,
  openJob,
  openPlace,
  row,
  rowMenu,
  rows,
  setToken,
  stage,
  stubList,
  T,
  unfoldExcluded,
  viaMenu,
  wholeInList,
  WIN,
} from './helpers';
import { WINDOW, css, px } from './scale';

/** The row's wrapper (the row button and its tools). */
const job = (page: Page, key: string): Locator =>
  list(page).locator('.job', { has: page.getByTestId(`job-row-${key}`) });

/** A computed style of a row's title. */
const titleStyle = (page: Page, key: string, name: 'color' | 'fontWeight'): Promise<string> =>
  row(page, key)
    .locator('.title')
    .evaluate((node, prop) => getComputedStyle(node)[prop], name);

test('no portal anywhere in the rows', async ({ page }) => {
  await open(page, WIN);
  await expect(list(page).locator('.portal')).toHaveCount(0);
  for (const text of await list(page).locator('.row').allTextContents()) {
    for (const portal of Object.values(T.portal)) expect(text).not.toContain(portal);
  }
});

test('one line: the ring and the title, nothing else', async ({ page }) => {
  await open(page, WIN);
  for (const id of ['row-company', 'row-place', 'row-pay', 'row-date', 'row-facts']) {
    await expect(list(page).getByTestId(id), id).toHaveCount(0);
  }
  await expect(list(page).locator('.dot, .stamp, .badge')).toHaveCount(0);
  const first = rows(page).first();
  await expect(first.locator('.ring')).toHaveCount(1);
  const heights = await rows(page).evaluateAll((items) =>
    items.slice(0, 6).map((item) => Math.round(item.getBoundingClientRect().height)),
  );
  expect(new Set(heights)).toEqual(new Set([px('--ring-sm') + 2 * px('--list-row-pad')]));
  // The ring and the title in their tokens (a new one 650).
  const ring = (await first.locator('.ring').boundingBox())!;
  expect(Math.round(ring.width)).toBe(px('--ring-sm'));
  await expect(first.locator('.title')).toHaveCSS('font-size', css('--font-title'));
});

test('a new title in 650; the Papierkorb and a closed ad muted in 450, an excluded job not', async ({
  page,
}) => {
  await open(page, WIN);
  const { jobs } = await stubList(page);
  const key = (j: (typeof jobs)[number]): string => `${j.key.portal}-${j.key.id}`;
  const fresh = jobs.find((j) => j.unread && j.match?.status === 'scored' && !j.closed)!;
  const read = jobs.find((j) => !j.unread && j.match?.status === 'scored' && !j.closed)!;
  const closed = jobs.find((j) => j.closed)!;
  expect(await titleStyle(page, key(fresh), 'fontWeight')).toBe('650');
  expect(await titleStyle(page, key(read), 'fontWeight')).toBe('540');
  const ink = await titleStyle(page, key(read), 'color');
  // Closed: muted, in the text's weight.
  expect(await titleStyle(page, key(closed), 'color')).not.toBe(ink);
  expect(await titleStyle(page, key(closed), 'fontWeight')).toBe('450');
  // Excluded: the ban marks it, the title stays ink.
  await unfoldExcluded(page);
  const out = jobs.find((j) => j.match?.status === 'excluded' && !j.closed)!;
  expect(await titleStyle(page, key(out), 'color')).toBe(ink);
  // The Papierkorb: every title muted in 450.
  await openPlace(page, 'trash');
  const trashed = await listed(page);
  expect(trashed.length).toBeGreaterThan(0);
  for (const each of trashed) {
    expect(await titleStyle(page, each, 'fontWeight')).toBe('450');
    expect(await titleStyle(page, each, 'color')).not.toBe(ink);
  }
});

test('the hairline above a row starts at the title; none next to the open row', async ({
  page,
}) => {
  await open(page, WIN);
  const [first, second, third] = await listed(page);
  const rule = (key: string): Promise<{ left: string; opacity: string; shown: boolean }> =>
    page.locator(`[data-key="${key!.replace('-', ':')}"]`).evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return { left: style.left, opacity: style.opacity, shown: style.content !== 'none' };
    });
  // The first row of a day has none; the next one from 56 on.
  expect((await rule(first!)).shown).toBe(false);
  const next = await rule(second!);
  expect(next).toMatchObject({ left: css('--row-rule-start'), opacity: '1', shown: true });
  // Opened: no line at its top or under it (the highlight stands there).
  await openJob(page, second!);
  await page.mouse.move(0, 0);
  expect((await rule(second!)).opacity).toBe('0');
  expect((await rule(third!)).opacity).toBe('0');
});

test('the open row: one highlight, the soft coral tint and its bar', async ({ page }) => {
  await open(page, WIN);
  const highlight = page.getByTestId('row-bar');
  await expect(highlight).toHaveCSS('opacity', '0');
  const [first, second] = await listed(page);
  await openJob(page, first!);
  await expect(highlight).toHaveCSS('opacity', '1');
  const box = async (): Promise<{ y: number; height: number }> => {
    const of = (await highlight.boundingBox())!;
    return { y: Math.round(of.y), height: Math.round(of.height) };
  };
  const rowBox = async (key: string): Promise<{ y: number; height: number }> => {
    const of = (await row(page, key).boundingBox())!;
    return { y: Math.round(of.y), height: Math.round(of.height) };
  };
  expect(await box()).toEqual(await rowBox(first!));
  // The row itself has no fill of its own.
  await expect(row(page, first!)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // It goes with the next job (gliding, then standing on its row).
  await openJob(page, second!);
  await animationsDone(page);
  expect(await box()).toEqual(await rowBox(second!));
  // Grey while the window is in the back.
  const tint = await highlight.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.evaluate(() => (document.documentElement.dataset['window'] = 'inactive'));
  await expect(highlight).not.toHaveCSS('background-color', tint);
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

/** The pointer onto a row (its middle, away from its tools). */
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
    for (const { place, key, tools } of places) {
      await openPlace(page, place);
      // None at rest: only the row under the pointer has them.
      await page.mouse.move(0, 0);
      await expect(list(page).getByTestId('row-tools')).toHaveCount(0);
      await animationsDone(page);
      const title = (await row(page, key).locator('.title').boundingBox())!;
      // No room kept for them: the title's line runs to the row's end (10 in), whole.
      const line = (await row(page, key).locator('.line').boundingBox())!;
      const whole = (await row(page, key).boundingBox())!;
      expect(Math.round(whole.x + whole.width - (line.x + line.width))).toBe(10);
      await expect(row(page, key).locator('.line')).toHaveCSS('mask-image', 'none');
      await pointAt(page, key);
      await expect(job(page, key).getByTestId('row-tools')).toBeVisible();
      // They lie over the line: the title does not move or shrink, its end fades out under
      // them.
      expect((await row(page, key).locator('.title').boundingBox())!).toEqual(title);
      await expect(row(page, key).locator('.line')).not.toHaveCSS('mask-image', 'none');
      expect(await toolIds(page, key), place).toEqual([...tools]);
      expect(await menuMoves(page, key), place).toEqual([...tools]);
      await pointAt(page, key);
      for (const id of tools) {
        const tool = job(page, key).getByTestId(`tool-${id}`);
        await expect(tool).toHaveAccessibleName(T.actions[id]);
        await expect(tool).toHaveAttribute('tabindex', '-1');
        // Quiet 28 px icon buttons.
        const box = (await tool.boundingBox())!;
        expect(Math.round(box.height)).toBe(28);
        await tool.hover();
        await expect(page.getByRole('tooltip')).toHaveText(T.actions[id]);
      }
      // The last one's glyph ends 10 from the row's end, where the hairline between the rows
      // ends; the room around the glyph hangs over it.
      const last = (await job(page, key)
        .getByTestId(`tool-${tools[1]}`)
        .locator('svg')
        .boundingBox())!;
      const end = (await row(page, key).boundingBox())!;
      expect(Math.round(end.x + end.width - (last.x + last.width))).toBe(10);
      // The pointer leaves: the tools go.
      await page.mouse.move(0, 0);
      await expect(job(page, key).getByTestId('row-tools')).toHaveCount(0);
    }
  });

  test('Endgültig löschen is a plain tool like the others (its dialog carries the danger)', async ({
    page,
  }) => {
    await open(page, WIN);
    await openPlace(page, 'trash');
    const [key] = await listed(page);
    await pointAt(page, key!);
    const colour = (id: string): Promise<string> =>
      job(page, key!)
        .getByTestId(`tool-${id}`)
        .evaluate((node) => getComputedStyle(node).color);
    expect(await colour('purge')).toBe(await colour('restore'));
    await rowMenu(page, key!);
    await expect(page.getByTestId('menu-item-purge')).not.toHaveClass(/danger/);
    await page.keyboard.press('Escape');
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
    // The next row stands under the pointer now, its tools' place under the tool: none until
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
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await openPlace(page, 'trash');
    // (The run's strip moves on: no waiting for every animation to end.)
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

  test("the row of an open menu keeps its wash, so the menu's job stays marked", async ({
    page,
  }) => {
    await open(page, WIN);
    const key = 'linkedin-4100200302';
    const ground = (): Promise<string> =>
      row(page, key).evaluate((node) => getComputedStyle(node).backgroundColor);
    const NONE = 'rgba(0, 0, 0, 0)';
    await page.mouse.move(0, 0);
    await expect.poll(ground).toBe(NONE);
    await pointAt(page, key);
    await expect.poll(ground).not.toBe(NONE);
    await animationsDone(page);
    const wash = await ground();
    const menu = await rowMenu(page, key);
    // The menu's corner opens under the pointer: the pointer has left the row.
    await menu.getByTestId('menu-item-open-ad').hover();
    await page.waitForTimeout(250);
    expect(await ground()).toBe(wash);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await expect.poll(ground).toBe(NONE);
    // The open row has its highlight and takes no wash, with its menu open too.
    await row(page, key).click();
    await rowMenu(page, key);
    await menu.getByTestId('menu-item-open-ad').hover();
    await expect.poll(ground).toBe(NONE);
  });

  for (const [opens, name] of [
    ["the row's", (page: Page, key: string) => rowMenu(page, key)],
    ["the funnel's", (page: Page) => openFilter(page)],
  ] as const) {
    test(`behind ${opens} menu another row takes neither wash nor tools; the menu closed, it wakes without a move`, async ({
      page,
    }) => {
      await open(page, WIN);
      const keys = (await stubList(page)).active;
      const own = keys[0]!;
      const other = keys[8]!;
      await expect(row(page, other)).toBeVisible();
      const NONE = 'rgba(0, 0, 0, 0)';
      /** The pointer onto a row, beside the menu that opened on the row or the funnel over it
       *  (the mouse itself: Playwright's hover may scroll, and a scroll closes the menu). */
      const over = async (key: string): Promise<void> => {
        const box = (await row(page, key).boundingBox())!;
        const x = key === own ? box.x + 100 : box.x + box.width - 120;
        await page.mouse.move(x, box.y + box.height / 2);
        await animationsDone(page);
      };
      const ground = (key: string): Promise<string> =>
        row(page, key).evaluate((node) => getComputedStyle(node).backgroundColor);
      const tools = (key: string): Promise<string> =>
        job(page, key).evaluate((node) => {
          const tool = node.querySelector('.tool');
          return tool === null ? 'none' : getComputedStyle(tool).opacity;
        });
      await name(page, own);
      await over(other);
      await page.waitForTimeout(250);
      expect(await ground(other)).toBe(NONE);
      expect(['none', '0']).toContain(await tools(other));
      await expect
        .poll(() =>
          list(page)
            .locator(`[data-key="${other.replace('-', ':')}"]`)
            .getAttribute('data-still'),
        )
        .toBe('');
      if (opens === "the row's") {
        // The menu's own row stays marked, whether the pointer is away or back on it.
        expect(await ground(own)).not.toBe(NONE);
        expect(await tools(own)).toBe('1');
        await over(own);
        await page.waitForTimeout(250);
        expect(await ground(own)).not.toBe(NONE);
        expect(await tools(own)).toBe('1');
        await over(other);
      }
      // The menu closes: the row under the pointer wakes without a move.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('menu')).toHaveCount(0);
      await expect.poll(() => ground(other)).not.toBe(NONE);
      await expect.poll(() => tools(other)).toBe('1');
    });
  }

  test('the row of an open menu has no hairlines, like the same row under the pointer', async ({
    page,
  }) => {
    await open(page, WIN);
    const [, second, third] = await listed(page);
    const lines = (): Promise<string[]> =>
      Promise.all(
        [second!, third!].map((key) =>
          page
            .locator(`[data-key="${key.replace('-', ':')}"]`)
            .evaluate((node) => getComputedStyle(node, '::before').opacity),
        ),
      );
    await page.mouse.move(0, 0);
    expect(await lines()).toEqual(['1', '1']);
    await pointAt(page, second!);
    expect(await lines()).toEqual(['0', '0']);
    const menu = await rowMenu(page, second!);
    await menu.getByTestId('menu-item-open-ad').hover();
    expect(await lines()).toEqual(['0', '0']);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    expect(await lines()).toEqual(['1', '1']);
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

test('the row menu and the reader offer the same: no alert mail, no ad text, an ad gone offline, an excluded job', async ({
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
  // without a score no prompt; the reader of a job not scored yet shows its state box and,
  // under it, what its menu offers (the ad).
  const failed = await offered('freelancermap-2805');
  expect(failed.menu).toEqual(['none', `${T.actions.openAd} on`, 'none']);
  expect(failed.reader).toEqual(failed.menu);
  await expect(stage(page).getByTestId('detail-note')).toBeVisible();
  const closed = await offered('linkedin-4100200304');
  expect(closed.menu).toEqual([
    `${T.actions.mail} on`,
    `${T.actions.openAd} on`,
    `${T.actions.prompt} on`,
  ]);
  expect(closed.reader).toEqual(closed.menu);
  // An excluded job: its state box with Trotzdem bewerten, and what its menu offers.
  const { excluded } = await stubList(page);
  await unfoldExcluded(page);
  const out = await offered(excluded[0]!);
  expect(out.menu).toContain(`${T.actions.openAd} on`);
  expect(out.reader).toEqual(out.menu);
});

test.describe('Alert-Mail öffnen, the row and the job view alike', () => {
  const key = 'freelancermap-2801';
  /** A mailbox other than Gmail: no job has a link to its mail (core::view, commands/files.rs). */
  const noGmail = (page: Page): Promise<void> =>
    page.evaluate(() => {
      window.__harness.editDetail = (detail) => ({
        ...detail,
        mail: { ...detail.mail, gmailUrl: null },
      });
    });
  const dialog = (page: Page): Locator => page.getByTestId('dialog-mail');

  test('without a Gmail link both read the mail CXact kept, in the one dialog', async ({
    page,
  }) => {
    await open(page, WIN);
    await noGmail(page);
    const y = (await row(page, key).boundingBox())!.y;
    await viaMenu(page, 'mail', key);
    await expect(dialog(page)).toBeVisible();
    const text = await page.getByTestId('mail-text').innerText();
    expect(text).not.toBe('');
    await page.getByTestId('dialog-confirm').click();
    await expect(dialog(page)).toHaveCount(0);
    // No word of a mail that is gone, and the rows stayed where they were.
    await expect(page.getByTestId('header-error')).toHaveCount(0);
    expect((await row(page, key).boundingBox())!.y).toBe(y);
    await openJob(page, key);
    await stage(page).getByTestId('reader-mail').click();
    await expect(page.getByTestId('mail-text')).toHaveText(text);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect(await calls(page, 'alert_mail')).toHaveLength(2);
    expect(await calls(page, 'open_target')).toHaveLength(0);
  });

  test('with a Gmail link both open it, and no dialog', async ({ page }) => {
    await open(page, WIN);
    const target = { kind: 'gmail', key: { portal: 'freelancermap', id: '2801' } };
    await viaMenu(page, 'mail', key);
    await expect.poll(() => calls(page, 'open_target')).toEqual([['open_target', { target }]]);
    await openJob(page, key);
    await stage(page).getByTestId('reader-mail').click();
    await expect.poll(async () => (await calls(page, 'open_target')).length).toBe(2);
    await expect(dialog(page)).toHaveCount(0);
    expect(await calls(page, 'alert_mail')).toHaveLength(0);
  });

  test('a mail that does not come says so where it was asked', async ({ page }) => {
    await open(page, WIN);
    await noGmail(page);
    await failNext(page, 'alert_mail');
    await viaMenu(page, 'mail', key);
    await expect(page.getByTestId('header-error')).toHaveText(T.error.text('db', {}));
    await expect(dialog(page)).toHaveCount(0);
    await openJob(page, key);
    await failNext(page, 'alert_mail');
    await stage(page).getByTestId('reader-mail').click();
    await expect(page.getByTestId('toast-text')).toHaveText(T.error.text('db', {}));
    await expect(dialog(page)).toHaveCount(0);
  });

  test('the dialog goes with the view', async ({ page }) => {
    await open(page, WIN);
    await noGmail(page);
    await viaMenu(page, 'mail', key);
    await expect(dialog(page)).toBeVisible();
    // The native menu changes the view behind it.
    await page.evaluate(() => window.__harness.fire('navigate', 'settings'));
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(() => window.__harness.fire('navigate', 'jobs'));
    await expect(row(page, key)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test('an excluded row shows the ban in the ring place, without a number', async ({ page }) => {
  await open(page, WIN);
  const { excluded } = await stubList(page);
  expect(excluded.length).toBeGreaterThan(0);
  await unfoldExcluded(page);
  for (const key of excluded) {
    const ban = row(page, key).getByTestId('row-excluded');
    await expect(ban).toBeVisible();
    await expect(ban).toHaveAttribute('aria-label', T.score.excluded);
    await expect(ban.locator('.value')).toHaveCount(0);
  }
  // A scored row keeps its ring.
  await expect(row(page, 'linkedin-4100200301').locator('.ring')).toHaveCount(1);
});

test.describe('a click on a row that is cut', () => {
  const pane = (page: Page): Locator => page.getByTestId('list-scroll');
  const scrollTop = (page: Page): Promise<number> => pane(page).evaluate((node) => node.scrollTop);
  /** The pane scrolled to `top`, once every row has mounted (they come chunk by chunk). */
  const scrollTo = async (page: Page, top: number): Promise<void> => {
    await expect(rows(page)).toHaveCount((await stubList(page)).active.length);
    await pane(page).evaluate((node, top) => (node.scrollTop = top), top);
    await settle(page);
  };
  /** The first row the day's heading that sticks cuts (its part below the heading is pressed),
   *  and the heading's lower edge. */
  const cutByHeading = async (
    page: Page,
  ): Promise<{ key: string; x: number; y: number; line: number }> => {
    const heading = (await page.getByTestId('day-heading').first().boundingBox())!;
    const line = heading.y + heading.height;
    for (const key of await listed(page)) {
      const box = (await row(page, key).boundingBox())!;
      if (box.y < line && box.y + box.height > line + 4) {
        return { key, x: box.x + 120, y: line + 2, line };
      }
    }
    throw new Error('no row under the heading');
  };
  /** The row the pane's end cuts, and a point of its part in view. */
  const cutByEnd = async (
    page: Page,
  ): Promise<{ key: string; x: number; y: number; end: number }> => {
    const view = (await pane(page).boundingBox())!;
    const end = view.y + (await pane(page).evaluate((node) => node.clientHeight));
    for (const key of await listed(page)) {
      const box = (await row(page, key).boundingBox())!;
      if (box.y < end - 4 && box.y + box.height > end) {
        return { key, x: box.x + 120, y: end - 2, end };
      }
    }
    throw new Error('no row at the end');
  };
  /** The row at a point of the window (its test id). */
  const underPoint = (page: Page, x: number, y: number): Promise<string | null | undefined> =>
    page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-testid^="job-row-"]')
          ?.getAttribute('data-testid'),
      { x, y },
    );
  /** The tops of the pane from now on, frame by frame. */
  const logTops = async (page: Page): Promise<() => Promise<number[]>> => {
    await pane(page).evaluate((node) => {
      const tops: number[] = [];
      (window as unknown as { tops: number[] }).tops = tops;
      const frame = (): void => {
        tops.push(node.scrollTop);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return () => page.evaluate(() => (window as unknown as { tops: number[] }).tops);
  };

  test('under the sticking heading: it glides out, just clear of the heading', async ({ page }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key, x, y, line } = await cutByHeading(page);
    const box = (await row(page, key).boundingBox())!;
    const tops = await logTops(page);
    await page.mouse.click(x, y);
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
    // As little as it takes: the row stands right under the heading, not in the middle.
    await expect
      .poll(async () => Math.round((await row(page, key).boundingBox())!.y))
      .toBe(Math.round(line));
    expect(await scrollTop(page)).toBe(Math.round(70 - (line - box.y)));
    // A glide: it passes places on its way.
    const log = await tops();
    expect(new Set(log).size).toBeGreaterThanOrEqual(3);
  });

  test("at the pane's end: it glides up just far enough, the press stays on it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key, x, y, end } = await cutByEnd(page);
    const box = (await row(page, key).boundingBox())!;
    const tops = await logTops(page);
    await page.mouse.click(x, y);
    await expect
      .poll(async () => {
        const at = (await row(page, key).boundingBox())!;
        return Math.round(end - (at.y + at.height));
      })
      .toBe(0);
    expect(await scrollTop(page)).toBe(Math.round(70 + box.y + box.height - end));
    // A glide: it passes places on its way.
    expect(new Set(await tops()).size).toBeGreaterThanOrEqual(3);
    // The pointer that rests still stands on the row it pressed.
    expect(await underPoint(page, x, y)).toBe(`job-row-${key}`);
  });

  test('a row that stands whole does not move, also right at the end or under the heading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key: byEnd, end } = await cutByEnd(page);
    const { key: byHeading, line } = await cutByHeading(page);
    const keys = await listed(page);
    // Its end a little above the pane's.
    const box = (await row(page, byEnd).boundingBox())!;
    await scrollTo(page, Math.round(70 + box.y + box.height - end + 8));
    const top = await scrollTop(page);
    // The mouse itself: Playwright's click scrolls an element out of that room first.
    const pressMiddle = async (key: string): Promise<void> => {
      const at = (await row(page, key).boundingBox())!;
      await page.mouse.click(at.x + 120, at.y + at.height / 2);
    };
    await pressMiddle(byEnd);
    await expect(row(page, byEnd)).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(250);
    expect(await scrollTop(page)).toBe(top);
    // Its top a little under the heading's lower edge.
    await scrollTo(page, 70);
    const next = keys[keys.indexOf(byHeading) + 1]!;
    const below = (await row(page, next).boundingBox())!;
    await scrollTo(page, Math.round(70 + below.y - line - 4));
    const under = await scrollTop(page);
    await pressMiddle(next);
    await expect(row(page, next)).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(250);
    expect(await scrollTop(page)).toBe(under);
  });

  test('the open row, cut since, pressed again: it comes whole into view too', async ({ page }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key, x, y } = await cutByEnd(page);
    await page.mouse.click(x, y);
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    await motionSettled(page);
    await page.waitForTimeout(250);
    await scrollTo(page, 70);
    expect(await wholeInList(page, key)).toBe(false);
    await page.mouse.click(x, y);
    await expect.poll(() => wholeInList(page, key)).toBe(true);
  });

  test('a flat order has no heading to clear: the row glides to the edge of the pane', async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await chooseSort(page, 'match');
    await motionSettled(page);
    await scrollTo(page, 70);
    const view = (await pane(page).boundingBox())!;
    const keys = await listed(page);
    let key = '';
    for (const candidate of keys) {
      const box = (await row(page, candidate).boundingBox())!;
      if (box.y < view.y && box.y + box.height > view.y + 4) key = candidate;
    }
    expect(key).not.toBe('');
    const box = (await row(page, key).boundingBox())!;
    await page.mouse.click(box.x + 120, view.y + 2);
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
    await motionSettled(page);
    await expect
      .poll(async () => Math.round((await row(page, key).boundingBox())!.y))
      .toBe(Math.round(view.y));
  });

  test('the glide stops when the user scrolls', async ({ page }) => {
    await setToken(page, '--dur-slow', '1500ms');
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { x, y } = await cutByEnd(page);
    await page.mouse.click(x, y);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(71);
    await page.mouse.wheel(0, -30);
    const after = async (): Promise<number> => {
      const at = await scrollTop(page);
      await page.waitForTimeout(200);
      return at;
    };
    // It stands: the wheel has the pane, and nothing takes it to where the glide went.
    await expect.poll(async () => (await after()) === (await scrollTop(page))).toBe(true);
    const stands = await scrollTop(page);
    await page.waitForTimeout(1600);
    expect(await scrollTop(page)).toBe(stands);
  });

  test('a double click opens the ad of the row first pressed, though it slid away', async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key, x, y } = await cutByEnd(page);
    const keys = await listed(page);
    const next = keys[keys.indexOf(key) + 1]!;
    await page.mouse.move(x, y);
    await page.mouse.down({ clickCount: 1 });
    await page.mouse.up({ clickCount: 1 });
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
    await motionSettled(page);
    // The list moved on by itself (a run's new rows, the wheel): the next row slid under the
    // pointer that rests, and the engine counts this press second.
    const height = (await row(page, key).boundingBox())!.height;
    await scrollTo(page, (await scrollTop(page)) + Math.round(height));
    await expect.poll(() => underPoint(page, x, y)).toBe(`job-row-${next}`);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    const [portal, id] = key.split(/-(.*)/);
    await expect
      .poll(() => calls(page, 'open_target'))
      .toEqual([['open_target', { target: { kind: 'jobUrl', key: { portal, id } } }]]);
    // The row under the pointer was pressed by nothing.
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
    await expect(row(page, next)).not.toHaveAttribute('aria-current', 'true');
    expect(
      (await calls(page, 'job_detail')).filter(
        ([, args]) => (args as { key: { id: string } }).key.id === next.split(/-(.*)/)[1],
      ),
    ).toHaveLength(0);
  });

  test('a quick double click on a cut row opens its ad, once', async ({ page }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 700 });
    await open(page, WIN);
    await scrollTo(page, 70);
    const { key, x, y } = await cutByEnd(page);
    await page.mouse.dblclick(x, y);
    const [portal, id] = key.split(/-(.*)/);
    await expect
      .poll(() => calls(page, 'open_target'))
      .toEqual([['open_target', { target: { kind: 'jobUrl', key: { portal, id } } }]]);
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => wholeInList(page, key)).toBe(true);
  });

  test('a real double click on a whole row opens its ad, once', async ({ page }) => {
    await open(page, WIN);
    const key = (await listed(page))[1]!;
    await row(page, key).dblclick();
    const [portal, id] = key.split(/-(.*)/);
    await expect
      .poll(() => calls(page, 'open_target'))
      .toEqual([['open_target', { target: { kind: 'jobUrl', key: { portal, id } } }]]);
    await expect(row(page, key)).toHaveAttribute('aria-current', 'true');
  });

  test('a press that closed a menu starts no double click', async ({ page }) => {
    await open(page, WIN);
    const [first, second] = await listed(page);
    await rowMenu(page, first!);
    // Beside the menu, which opened at the middle of the row above.
    const box = (await row(page, second!).boundingBox())!;
    const at = { x: box.x + 20, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ clickCount: 1 });
    await page.mouse.up({ clickCount: 1 });
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(150);
    expect(await calls(page, 'open_target')).toHaveLength(0);
  });
});

test.describe('after a click on a row', () => {
  const scrollTop = (page: Page): Promise<number> =>
    page.getByTestId('list-scroll').evaluate((node) => node.scrollTop);

  test('the arrows, Home and End scroll the list, in both engines, and Tab still reaches the rows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 600 });
    await open(page, WIN);
    const first = (await listed(page))[0]!;
    await row(page, first).click();
    // A press focuses no row: nothing stands armed for a key.
    await expect(row(page, first)).not.toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
    await page.keyboard.press('End');
    const end = await page
      .getByTestId('list-scroll')
      .evaluate((node) => node.scrollHeight - node.clientHeight);
    await expect.poll(() => scrollTop(page)).toBe(end);
    await page.keyboard.press('Home');
    await expect.poll(() => scrollTop(page)).toBe(0);
    await page.keyboard.press('PageDown');
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
    // The keys still go through the rows.
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('[data-key]')?.tagName ?? null),
      )
      .toBe('DIV');
  });

  test('a press leaves nothing armed that a key left the focus on: Enter and Shift+F10 speak for what is open', async ({
    page,
  }) => {
    await open(page, WIN);
    const [, second, , , fifth] = await listed(page);
    const open_ = (): Promise<string | null> =>
      list(page).locator('[data-open]').getAttribute('data-key');
    // Tab reached the second row; the mouse opens the fifth.
    await row(page, second!).focus();
    await row(page, fifth!).click();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await open_()).toBe(fifth!.replace('-', ':'));
    await page.keyboard.press('Shift+F10');
    const menu = page.getByTestId('menu');
    await expect(menu).toBeVisible();
    const box = (await row(page, fifth!).boundingBox())!;
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // A button the keys reached: Enter after the press does not press it.
    await page.getByTestId('fetch').focus();
    await row(page, second!).click();
    await page.keyboard.press('Enter');
    await settle(page);
    await expect(page.getByTestId('cancel-run')).toHaveCount(0);
    expect(await calls(page, 'start_run')).toHaveLength(0);
    // A press on what holds the focus keeps it there: nothing else stands armed.
    await row(page, second!).focus();
    await row(page, second!).click();
    await expect(row(page, second!)).toBeFocused();
  });

  test('Shift+F10 opens the menu of the open row; on a control, or with no job open, nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = page.getByTestId('menu');
    // No job open: the key has nothing to speak for.
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(0);
    const second = (await listed(page))[1]!;
    await row(page, second).click();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    // Below its row, the first entry active as from the keyboard, and it acts on that job.
    const box = (await row(page, second).boundingBox())!;
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
    await expect(page.getByTestId('menu-item-open-ad')).toHaveAttribute('data-active', '');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    const [, args] = (await calls(page, 'open_target')).at(-1)!;
    expect(args).toEqual({
      target: { kind: 'jobUrl', key: (await stubList(page)).jobs[1]!.key },
    });
    // A control that holds the focus speaks for itself.
    await page.getByTestId('filter').focus();
    await page.keyboard.press('Shift+F10');
    await page.waitForTimeout(100);
    await expect(menu).toHaveCount(0);
  });

  test('the menu of a row scrolled out of view stands inside the window', async ({ page }) => {
    await page.setViewportSize({ width: WINDOW.width, height: 500 });
    await open(page, WIN);
    const keys = await listed(page);
    const menu = page.getByTestId('menu');
    const pane = (await page.getByTestId('list-scroll').boundingBox())!;
    const inWindow = async (): Promise<void> => {
      await expect(menu).toBeVisible();
      const box = (await menu.locator('xpath=..').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(500);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    };
    // Its row above the window.
    await row(page, keys[0]!).click();
    await page.mouse.move(pane.x + 40, pane.y + 100);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(300);
    await expect.poll(async () => (await row(page, keys[0]!).boundingBox())!.y).toBeLessThan(-40);
    await page.keyboard.press('Shift+F10');
    await inWindow();
    // Its row below the window.
    await page.getByTestId('list-scroll').evaluate((node) => (node.scrollTop = 0));
    const last = keys.at(-1)!;
    await row(page, last).scrollIntoViewIfNeeded();
    await row(page, last).click();
    await page.getByTestId('list-scroll').evaluate((node) => (node.scrollTop = 0));
    await expect.poll(async () => (await row(page, last).boundingBox())!.y).toBeGreaterThan(500);
    await page.keyboard.press('Shift+F10');
    await inWindow();
  });
});
