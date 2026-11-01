// The list area of the Jobs view: the places Aktuell, Archiv, Papierkorb under Jobs in the
// sidebar; the list's head in one row (the search, the funnel, Jobs suchen); the funnel's menu
// (the order, then the filter table) and the chips of an active filter; one list per place in
// the chosen order with the excluded jobs folded at its end; the empty states;
// the search and its hits elsewhere; moves and their undo; the run line; the open row's bar;
// the sidebar; the smallest window.
// Texts come from the catalog (T) and the filter table, the demo data from the stub
// (stubList), not typed again.

import type { Locator, Page } from '@playwright/test';
import type { JobQuery, JobView } from '../../../ui/src/lib/ipc/types';
import { RECEIVED } from '../../../ui/src/lib/state/filter';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  NOW,
  open,
  motionSettled,
  runFinished,
  settle,
  test,
  visibleCount,
} from './fixtures';
import {
  checkedSort,
  chip,
  chipRemove,
  chips,
  chipWords,
  chipWordsOf,
  chooseFilter,
  chooseSort,
  excludedRows,
  expectHighlightOn,
  failNext,
  FILTER_GROUPS,
  filterLabel,
  filterMenu,
  funnel,
  lastQuery,
  list,
  listed,
  MAC,
  menuItem,
  mountedKeys,
  NO_FILTER,
  openFilter,
  openJob,
  openPlace,
  PORTALS,
  row,
  rowMenu,
  rows,
  reveal,
  sortEntryId,
  SORTS,
  stage,
  stubJob,
  stubList,
  setToken,
  wholeInList,
  T,
  unfoldExcluded,
  viaMenu,
  WIN,
  menuFrame,
} from './helpers';

/** A typed search waits `ms` before it loads (--dur-base), time to change the list meanwhile. */
const slowSearch = (page: Page, ms: number): Promise<void> =>
  setToken(page, '--dur-base', `${ms}ms`);

/** A locked control answers no pointer: its colours stay what they are at rest. */
async function expectNoAnswer(page: Page, control: Locator): Promise<void> {
  await page.mouse.move(0, 0);
  const colours = (): Promise<string[]> =>
    control.evaluate((node) =>
      [node, ...node.querySelectorAll('*')].map((part) => getComputedStyle(part).color),
    );
  const rest = await colours();
  await control.hover({ force: true });
  await motionSettled(page);
  expect(await colours()).toEqual(rest);
}

/** The rows outside the fold as the stub lists them: the inbox by date unless said. */
async function inbox(page: Page, query: Partial<JobQuery> = {}): Promise<string[]> {
  return (await stubList(page, query)).active;
}

const keyOf = (job: JobView): string => `${job.key.portal}-${job.key.id}`;
const excluded = (job: JobView): boolean => job.match?.status === 'excluded';

/** Whether the element `a` starts before the element `b` (the order along a line). */
async function leftOf(page: Page, a: string, b: string): Promise<boolean> {
  const [first, second] = await Promise.all(
    [a, b].map(async (id) => (await page.getByTestId(id).boundingBox())!),
  );
  return first!.x < second!.x;
}

/** Whether the elements stand on one row: the middle of each inside the height of the first. */
async function onOneRow(page: Page, ...ids: string[]): Promise<boolean> {
  const boxes = await Promise.all(
    ids.map(async (id) => (await page.getByTestId(id).boundingBox())!),
  );
  const row = boxes[0]!;
  return boxes.every((box) => {
    const middle = box.y + box.height / 2;
    return middle > row.y && middle < row.y + row.height;
  });
}

/** Whether something stands in the middle of the list's column: its own middle within the
 *  middle third of the column, both ways. */
async function inTheMiddle(page: Page, what: Locator): Promise<boolean> {
  const column = (await page.getByTestId('list-scroll').boundingBox())!;
  const box = (await what.boundingBox())!;
  const inside = (at: number, start: number, size: number): boolean =>
    at > start + size / 3 && at < start + (2 * size) / 3;
  return (
    inside(box.x + box.width / 2, column.x, column.width) &&
    inside(box.y + box.height / 2, column.y, column.height)
  );
}

/** A state stands in the very middle of its pane, top to bottom (on a whole pixel). */
async function expectInTheVeryMiddle(what: Locator, pane: Locator): Promise<void> {
  const box = (await what.boundingBox())!;
  const around = (await pane.boundingBox())!;
  const off = box.y + box.height / 2 - (around.y + around.height / 2);
  expect(Math.abs(off)).toBeLessThanOrEqual(1);
}

/** A place that holds nothing and has no head: its empty state alone. */
async function expectBarePlace(
  page: Page,
  words: { heading: string; text: string },
): Promise<Locator> {
  const empty = page.getByTestId('empty-all');
  await expect(empty.locator('h3')).toHaveText(words.heading);
  await expect(empty.locator('p')).toHaveText(words.text);
  await expect(page.getByTestId('list-header')).toHaveCount(0);
  return empty;
}

/* ======================================================================= header */

test.describe('header', () => {
  test('a job comes in once: a second fetch brings nothing new and no dot comes back', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=60`);
    // The first fetch brings the new jobs of its mails.
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const first = await listed(page);
    // The newest one read: it stays read.
    const newest = first[0]!;
    await row(page, newest).click();
    const readOf = async (key: string): Promise<boolean | undefined> =>
      (await stubList(page)).jobs.find((j) => `${j.key.portal}-${j.key.id}` === key)?.unread;
    await expect.poll(() => readOf(newest)).toBe(false);
    const fresh = async (): Promise<number> =>
      (await stubList(page)).jobs.filter((j) => j.unread && j.match?.status !== 'excluded').length;
    const before = await fresh();
    // The same mails again: every job is known, nothing is added, nothing turns new.
    await page.getByTestId('fetch').click();
    await runFinished(page);
    expect(await listed(page)).toEqual(first);
    expect(await fresh()).toBe(before);
    expect(await readOf(newest)).toBe(false);
  });

  test('the places stand under Jobs in the sidebar: their names only, no numbers; the chosen one is marked', async ({
    page,
  }) => {
    await open(page, WIN);
    const sidebar = page.getByTestId('sidebar');
    for (const place of ['inbox', 'archive', 'trash'] as const) {
      await expect(sidebar.getByTestId(`place-${place}`)).toHaveText(T.place[place]);
    }
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
    await openPlace(page, 'archive');
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('place-inbox')).not.toHaveAttribute('aria-current');
    // Jobs says where the window is, the pill stands on the place.
    await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'true');
  });

  test('one head in the three places: the search, the funnel and the action in one row, no tabs', async ({
    page,
  }) => {
    await open(page, WIN);
    // Aktuell: the search, the funnel, at the row's end the fetch; no tabs above it and no sort
    // button (the order is the funnel's first group).
    await expect(page.getByTestId('fetch')).toHaveAccessibleName(T.toolbar.searchNow);
    expect(await leftOf(page, 'search', 'filter')).toBe(true);
    expect(await leftOf(page, 'filter', 'fetch')).toBe(true);
    expect(await onOneRow(page, 'search', 'filter', 'fetch')).toBe(true);
    await expect(page.getByTestId('places')).toHaveCount(0);
    await expect(page.getByTestId('view-jobs').getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('sort')).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-label', T.toolbar.filter);
    expect(T.toolbar.filter).toBe('Sortieren und filtern');
    // Each place's search names its place.
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
    expect(T.place.search.inbox).toContain(T.place.inbox);
    // Archiv: the same row, no action.
    await openPlace(page, 'archive');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    expect(T.place.search.archive).toContain(T.place.archive);
    await expect(funnel(page)).toBeVisible();
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    // Papierkorb: the search, no funnel (it has no filter), no action ("Papierkorb leeren" is
    // gone: deleting for good goes job by job, asking first).
    await openPlace(page, 'trash');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.trash);
    expect(T.place.search.trash).toContain(T.place.trash);
    await expect(funnel(page)).toHaveCount(0);
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
    // No count line.
    await expect(page.getByTestId('place-count')).toHaveCount(0);
  });

  test('Jobs suchen and Abbrechen keep one width, so the swap moves nothing', async ({ page }) => {
    for (const platform of [WIN, MAC]) {
      await open(page, `${platform}&tick=15`);
      const fetch = page.getByTestId('fetch');
      const before = (await fetch.boundingBox())!;
      await page.evaluate(() => (window.__harness.holdAfter = 3));
      await fetch.click();
      const cancel = page.getByTestId('cancel-run');
      await expect(cancel).toHaveAccessibleName(T.toolbar.cancel);
      const after = (await cancel.boundingBox())!;
      expect(Math.round(after.width)).toBe(Math.round(before.width));
      expect(Math.round(after.x + after.width)).toBe(Math.round(before.x + before.width));
      await cancel.click();
      await runFinished(page);
      await page.evaluate(() => (window.__harness.holdAfter = null));
    }
  });

  test('one fetch, Jobs suchen, with or without a mailbox; Abbrechen takes its place', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    const fetch = page.getByTestId('fetch');
    await expect(fetch).toHaveAccessibleName(T.toolbar.searchNow);
    expect(T.toolbar.searchNow).toBe('Jobs suchen');
    // No menu of ways beside it.
    await expect(page.getByTestId('fetch-ways')).toHaveCount(0);
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await fetch.click();
    // "Abbrechen" takes the place of the fetch while it runs.
    const cancel = page.getByTestId('cancel-run');
    await expect(cancel).toBeVisible();
    await expect(fetch).toHaveCount(0);
    const sent = (await calls(page, 'start_run')).at(-1)?.[1] as { request: object };
    expect(sent.request).toEqual({ kind: 'fetch' });
    await cancel.click();
    await runFinished(page);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    // Without a mailbox it still fetches (the search needs none).
    await open(page, `${WIN}&scenario=no-mailbox`);
    await expect(page.getByTestId('fetch')).toBeEnabled();
  });

  test('from the keyboard the focus goes with the action, Jobs suchen to Abbrechen and back', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await page.getByTestId('fetch').focus();
    await page.keyboard.press('Enter');
    // Not to the top of the window: the action of the place keeps it.
    const cancel = page.getByTestId('cancel-run');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Enter');
    await runFinished(page);
    await expect(page.getByTestId('fetch')).toBeFocused();
  });

  test("from the keyboard the empty state's Jobs suchen hands the focus on too, and takes it back", async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=fresh&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    const empty = await expectBarePlace(page, T.list.empty.inbox);
    await empty.getByTestId('fetch').focus();
    await page.keyboard.press('Enter');
    // The head comes with the run, and its Abbrechen takes the focus.
    const cancel = page.getByTestId('list-header').getByTestId('cancel-run');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Enter');
    await runFinished(page);
    // The list is bare again: the empty state's button takes it back.
    await expectBarePlace(page, T.list.empty.inbox);
    await expect(page.getByTestId('empty-all').getByTestId('fetch')).toBeFocused();
    // A run that brings jobs: the head's button takes it, the head stays.
    await page.keyboard.press('Enter');
    await expect(cancel).toBeFocused();
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByTestId('list-header').getByTestId('fetch')).toBeFocused();
  });

  test('a short run that brings the first jobs keeps its head at its end', async ({ page }) => {
    await open(page, `${WIN}&scenario=fresh&tick=15`);
    await expectBarePlace(page, T.list.empty.inbox);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await page.getByTestId('cancel-run').waitFor();
    // From here on the head stands: the rows of the run never stand without it, not even for
    // as long as the counts take to hear of them.
    const headless = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const watch = new MutationObserver(() => {
            if (document.querySelector('[data-testid="list-header"]') !== null) return;
            watch.disconnect();
            resolve(true);
          });
          watch.observe(document.body, { childList: true, subtree: true });
          window.__harness.holdAfter = null;
          const done = setInterval(() => {
            if (!window.__harness.done) return;
            clearInterval(done);
            setTimeout(() => {
              watch.disconnect();
              resolve(false);
            }, 300);
          }, 20);
        }),
    );
    await runFinished(page);
    expect(await headless).toBe(false);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByTestId('list-header')).toBeVisible();
  });

  test('from the keyboard an Abbrechen with no Jobs suchen after it hands the focus to the place', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await openPlace(page, 'archive');
    await page.getByTestId('cancel-run').focus();
    await page.keyboard.press('Enter');
    await runFinished(page);
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    await expect(page.getByTestId('place-archive')).toBeFocused();
  });

  test('a click on the action moves no focus, neither to Abbrechen nor back', async ({ page }) => {
    await open(page, `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    const cancel = page.getByTestId('cancel-run');
    await expect(cancel).toBeVisible();
    await expect(cancel).not.toBeFocused();
    await cancel.click();
    await runFinished(page);
    await expect(page.getByTestId('fetch')).not.toBeFocused();
    // Nor the empty state's, which a press focuses in Chromium.
    await open(page, `${WIN}&scenario=fresh&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('empty-all').getByTestId('fetch').click();
    await expect(cancel).toBeVisible();
    await expect(cancel).not.toBeFocused();
    await cancel.click();
    await runFinished(page);
    await expect(page.getByTestId('fetch')).toBeVisible();
    await expect(page.getByTestId('fetch')).not.toBeFocused();
  });

  test('while a fetch goes Abbrechen and the strip stand in every place', async ({ page }) => {
    await open(page, `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await page.getByTestId('fetch').click();
    const cancel = page.getByTestId('cancel-run');
    await expect(cancel).toBeVisible();
    for (const place of ['archive', 'trash'] as const) {
      await openPlace(page, place);
      await expect(cancel, place).toBeVisible();
      await expect(page.getByTestId('run-line'), place).toBeVisible();
    }
    await cancel.click();
    await runFinished(page);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    // Jobs suchen is Aktuell's only.
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    await expect(page.getByTestId('run-line')).toHaveCount(0);
    await openPlace(page, 'archive');
    await expect(page.getByTestId('place-action')).toHaveCount(0);
  });

  test("the head's controls fit its column at every width, their words whole", async ({ page }) => {
    const header = page.getByTestId('list-header');
    const fits = (): Promise<boolean> =>
      header.evaluate((node) => {
        const column = node.getBoundingClientRect();
        const fetch = node.querySelector('[data-testid="fetch"]')!;
        return (
          ['search', 'filter', 'fetch'].every(
            (id) =>
              node.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().right <=
              column.right,
          ) && fetch.scrollWidth <= fetch.clientWidth
        );
      });
    await open(page, WIN);
    expect(await fits()).toBe(true);
    for (const width of [1024, 900, 820, 640, 480]) {
      await page.setViewportSize({ width, height: 768 });
      await expect.poll(fits, `${width}`).toBe(true);
      await expect(page.getByTestId('fetch')).toContainText(T.toolbar.searchNow);
    }
  });

  test('a chosen place drops the search, the hits link keeps it, an open place reloads nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    await search.fill('Kreditoren');
    await page.getByTestId('also-archive').click();
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    await expect(search).toHaveValue('Kreditoren');
    await expect(rows(page)).toHaveCount(1);
    // Another view and Zurück keeps the place and its search.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await page.getByTestId('history-back').click();
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    await expect(search).toHaveValue('Kreditoren');
    // Aktuell: the inbox as a whole, like a folder of a mail app.
    await openPlace(page, 'inbox');
    await expect(search).toHaveValue('');
    expect((await lastQuery(page))?.search).toBeNull();
    const loads = (await calls(page, 'list_jobs')).length;
    await page.getByTestId('place-inbox').click();
    await page.getByTestId('nav-jobs').click();
    await settle(page);
    expect((await calls(page, 'list_jobs')).length).toBe(loads);
  });

  test('no job in a place: no head, the empty state in the middle, Aktuell with Jobs suchen', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=fresh`);
    // Aktuell before the first search: no head (no search, funnel or button above), the
    // briefcase, a heading and one sentence in the middle of the full width, and under them its
    // one primary, Jobs suchen; nothing beside the list. The places stand in the sidebar.
    const inbox = await expectBarePlace(page, T.list.empty.inbox);
    for (const id of ['search', 'filter']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
    await expect(page.getByTestId('place-archive')).toBeVisible();
    await expect(page.getByTestId('toggle-reader')).toHaveCount(0);
    const fetch = inbox.getByTestId('fetch');
    await expect(fetch).toHaveText(T.toolbar.searchNow);
    await expect(fetch).toHaveClass(/primary/);
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    await expect(page.getByTestId('list-splitter')).toHaveCount(0);
    const scroll = (await page.getByTestId('list-scroll').boundingBox())!;
    const sheet = (await page.getByTestId('jobs').boundingBox())!;
    expect(Math.round(scroll.x + scroll.width)).toBe(Math.round(sheet.x + sheet.width));
    const shown = (await inbox.boundingBox())!;
    const middle = shown.y + shown.height / 2;
    expect(Math.abs(middle - (scroll.y + scroll.height / 2))).toBeLessThan(24);
    expect(Math.abs(shown.x + shown.width / 2 - (scroll.x + scroll.width / 2))).toBeLessThan(12);
    // The Archiv and the Papierkorb, each in its words, in the middle too and with no button.
    await open(page, `${WIN}&scenario=concept`);
    for (const place of ['archive', 'trash'] as const) {
      await openPlace(page, place);
      const empty = await expectBarePlace(page, T.list.empty[place]);
      await expect(empty.getByRole('button')).toHaveCount(0);
      await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    }
    // A job open in Aktuell closes in another place.
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await openPlace(page, 'archive');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });

  test('an empty place under a kept filter or a run keeps its head, in its own words', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('jobs-filter', JSON.stringify({ portals: ['linkedin'] })),
    );
    await open(page, `${WIN}&scenario=concept&tick=15`);
    // The Archiv holds nothing at all: the filter left nothing out, so it offers no reset, but
    // its chip stays to be taken off.
    await openPlace(page, 'archive');
    const archive = page.getByTestId('empty-place-archive');
    await expect(archive.locator('h3')).toHaveText(T.list.empty.archive.heading);
    await expect(archive.locator('p')).toHaveText(T.list.empty.archive.text);
    await expect(archive.getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('empty-filter')).toHaveCount(0);
    await expect(page.getByTestId('search')).toBeVisible();
    await expect(funnel(page)).toBeVisible();
    await expect(chip(page, 'portal-linkedin')).toBeVisible();
    // The chip gone, nothing is left to head.
    await chipRemove(page, 'portal-linkedin').click();
    await expectBarePlace(page, T.list.empty.archive);
    // While a run goes the Papierkorb has its head: the search, no funnel, Abbrechen.
    await openPlace(page, 'inbox');
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await page.getByTestId('fetch').click();
    await openPlace(page, 'trash');
    const trash = page.getByTestId('empty-place-trash');
    await expect(trash.locator('h3')).toHaveText(T.list.empty.trash.heading);
    await expect(trash.locator('p')).toHaveText(T.list.empty.trash.text);
    await expect(page.getByTestId('search')).toBeVisible();
    await expect(funnel(page)).toHaveCount(0);
    await expect(page.getByTestId('cancel-run')).toBeVisible();
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    // The run over, the head goes again.
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    await expectBarePlace(page, T.list.empty.trash);
  });

  test('a fetch into an empty Aktuell brings the head back: the strip under the search, Abbrechen', async ({
    page,
  }) => {
    for (const platform of [WIN, MAC]) {
      await open(page, `${platform}&scenario=empty&tick=40`);
      await expect(page.getByTestId('search')).toHaveCount(0);
      await page.evaluate(() => (window.__harness.holdAfter = 4));
      await page.getByTestId('empty-all').getByTestId('fetch').click();
      const line = page.getByTestId('run-line');
      await expect(line).toBeVisible();
      await expect(page.getByTestId('cancel-run')).toBeVisible();
      // While it fills Aktuell the empty state says so, at the top under the head.
      await expect(page.getByTestId('empty-all').locator('p')).toHaveText(
        T.list.empty.running.text,
      );
      await expect(funnel(page)).toBeVisible();
      const search = (await page.getByTestId('search').boundingBox())!;
      expect((await line.boundingBox())!.y).toBeGreaterThanOrEqual(search.y + search.height);
      // The first jobs come in.
      await page.evaluate(() => (window.__harness.holdAfter = null));
      await expect.poll(async () => (await listed(page)).length).toBeGreaterThan(0);
      await runFinished(page);
      // The list it brought keeps its head.
      await expect(page.getByTestId('search')).toBeVisible();
      await expect(funnel(page)).toBeVisible();
    }
  });

  test('a list that did not load says so in the middle with a primary retry; no head unless a run goes', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=list-error&tick=15`);
    const error = page.getByTestId('list-error');
    await expect(error.locator('h3')).toHaveText(T.list.loadFailed);
    // Nothing to choose beside it: the list takes the whole width, the reader says nothing.
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    expect(await inTheMiddle(page, error)).toBe(true);
    // No head: nothing to search or filter, and no fetch above it.
    for (const id of ['list-header', 'search', 'filter', 'fetch']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
    // The one way on, the primary: it asks again.
    const retry = error.getByRole('button', { name: T.common.retry });
    await expect(retry).toHaveClass(/primary/);
    const loads = (await calls(page, 'list_jobs')).length;
    await retry.click();
    await expect.poll(async () => (await calls(page, 'list_jobs')).length).toBeGreaterThan(loads);
    await expect(error).toBeVisible();
    await expect(page.getByTestId('list-header')).toHaveCount(0);
    // A run that goes on brings the head with its strip and Abbrechen, still no search.
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await page.evaluate(() => window.__harness.appRun('fetch'));
    await expect(page.getByTestId('run-line')).toBeVisible();
    await expect(page.getByTestId('cancel-run')).toBeVisible();
    await expect(page.getByTestId('search')).toHaveCount(0);
    await expect(funnel(page)).toHaveCount(0);
    await expect(error).toBeVisible();
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    await expect(page.getByTestId('list-header')).toHaveCount(0);
    await expect(error).toBeVisible();
  });

  test('a list that failed comes back by its retry, its head with it', async ({ page }) => {
    await open(page, WIN);
    await failNext(page, 'list_jobs');
    await page.getByTestId('place-archive').click();
    const error = page.getByTestId('list-error');
    await expect(error).toBeVisible();
    await expect(page.getByTestId('list-header')).toHaveCount(0);
    await error.getByRole('button', { name: T.common.retry }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { place: 'archive' }));
  });
});

/* ======================================================================= filter */

test.describe('filter', () => {
  test('one menu: Sortierung, Portal, Übereinstimmung, Neu seit, none chosen', async ({ page }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAttribute('aria-label', T.toolbar.filter);
    const table = filterMenu();
    await expect(menu.getByTestId('menu-heading')).toHaveText([
      T.toolbar.sortHeading,
      T.toolbar.portalHeading,
      T.toolbar.bandHeading,
      T.toolbar.receivedHeading,
    ]);
    await expect(menu.getByTestId('menu-heading')).toHaveText(
      table.flatMap((group) => (group.heading === null ? [] : [group.heading])),
    );
    // The headings in the weight of the list's day headings.
    const weight = (node: Element): string => getComputedStyle(node).fontWeight;
    await expect(menu.getByTestId('menu-heading').first()).toHaveCSS(
      'font-weight',
      await list(page).getByTestId('day-heading').first().evaluate(weight),
    );
    // Every entry of the table, and no way back: a filter goes with its chip's ×, the whole of
    // it only where it leaves nothing.
    await expect(menu.locator('[role^="menuitem"]')).toHaveText(
      table.flatMap((group) => group.entries),
    );
    await expect(menuItem(page, 'filter-reset')).toHaveCount(0);
    // A group lists every value of its dimension: the three bands and the three day ranges,
    // their words under their heading without repeating it.
    for (const band of ['high', 'mid', 'low'] as const) {
      await expect(menuItem(page, `band-${band}`)).toHaveText(T.toolbar.band[band]);
      expect(T.toolbar.band[band]).not.toContain(T.toolbar.bandHeading);
    }
    for (const received of RECEIVED) {
      await expect(menuItem(page, `received-${received}`)).toHaveText(T.toolbar.received[received]);
    }
    // Portal and Übereinstimmung take several choices (check items), Neu seit one (radio
    // items); none checked while a group filters nothing. There is no contract, work mode,
    // deadline or pay filter and no "Nur neue" (user decision 2026-10-01).
    for (const id of ['portal-linkedin', 'band-mid']) {
      await expect(menuItem(page, id)).toHaveAttribute('role', 'menuitemcheckbox');
      await expect(menuItem(page, id)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(menuItem(page, 'received-today')).toHaveAttribute('role', 'menuitemradio');
    await expect(menuItem(page, 'received-today')).toHaveAttribute('aria-checked', 'false');
    for (const gone of [
      'contract-interim',
      'mode-remote',
      'unread-only',
      'deadline-soon',
      'pay-min',
      'pay-wish',
      'remote-only',
      'remote-hybrid',
    ]) {
      await expect(menuItem(page, gone)).toHaveCount(0);
    }
    await expect(menu).not.toContainText('Frist');
    // The portals in the UI's order (lib/portals.ts), the same as Einstellungen.
    const portals = await menu
      .locator('[data-testid^="menu-item-portal-"]')
      .evaluateAll((all) => all.map((item) => item.getAttribute('data-testid')));
    // Every source switched on, jobs or not yet (Hays has none in the demo; user 2026-10-01).
    expect(portals).toEqual(PORTALS.map((portal) => `menu-item-portal-${portal}`));
    expect(portals).toContain('menu-item-portal-hays');
    await expect(menuItem(page, 'portal-freelance')).toHaveText(T.portal.freelance);
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'false');
    // One sign for what is chosen in a menu: the tick, for the order as for a filter.
    await expect(menuItem(page, 'sort-newest').locator('.tick')).toHaveCount(1);
    await expect(menuItem(page, 'sort-match').locator('.tick')).toHaveCount(0);
    // The whole menu opens below the funnel and stays inside the window; with every group
    // (and more sources with jobs) it scrolls where the window is too low (2026-10-01).
    await animationsDone(page);
    const funnelBox = (await funnel(page).boundingBox())!;
    const menuBox = (await menuFrame(page).boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(funnelBox.y + funnelBox.height);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(chips(page)).toHaveCount(0);
  });

  test('the menu stays open while choosing: two picks, the checks move; Esc, outside, funnel close', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    const heightOf = async (): Promise<number> => Math.round((await menu.boundingBox())!.height);
    const height = await heightOf();
    await menuItem(page, 'sort-match').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'false');
    await menuItem(page, 'portal-linkedin').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'portal-linkedin')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'portal-freelance')).toHaveAttribute('aria-checked', 'false');
    // The tick marks a filter's choice as it marks the order's.
    await expect(menuItem(page, 'portal-linkedin').locator('.tick')).toHaveCount(1);
    await expect(menuItem(page, 'portal-freelance').locator('.tick')).toHaveCount(0);
    // Both apply at once, the list follows while the menu is open.
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { sort: 'match', portals: ['linkedin'] }));
    await menuItem(page, 'band-mid').click();
    await expect(menuItem(page, 'band-mid')).toHaveAttribute('aria-checked', 'true');
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin', 'band-mid'));
    // The menu keeps its height whatever is chosen.
    expect(await heightOf()).toBe(height);
    // Esc closes it.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // A press outside closes it (and does nothing else).
    await openFilter(page);
    await page.getByTestId('search').click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await expect(page.getByTestId('search')).not.toBeFocused();
    // The funnel closes it.
    await openFilter(page);
    await funnel(page).click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'false');
    // Kept: the next start has the same order and filter.
    await open(page, WIN);
    expect(await lastQuery(page)).toMatchObject({
      sort: 'match',
      portals: ['linkedin'],
      bands: ['mid'],
    });
  });

  test('the order sets no chip, and taking the filter off keeps it', async ({ page }) => {
    await open(page, WIN);
    await chooseSort(page, 'match');
    await expect(chips(page)).toHaveCount(0);
    await chooseFilter(page, 'received-days30');
    await chipRemove(page, 'received-days30').click();
    await expect(chips(page)).toHaveCount(0);
    expect(await checkedSort(page)).toBe('match');
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { sort: 'match' }));
    // Filter zurücksetzen, of a filter that leaves nothing, keeps it too.
    await chooseFilter(page, 'portal-hays');
    await page.getByTestId('filter-reset').click();
    await expect(chips(page)).toHaveCount(0);
    expect(await checkedSort(page)).toBe('match');
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { sort: 'match' }));
  });

  test('the same control in Aktuell and the Archiv, kept for every list; none in the Papierkorb', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseSort(page, 'match');
    await chooseFilter(page, 'portal-freelancermap');
    for (const place of ['inbox', 'archive'] as const) {
      await openPlace(page, place);
      await expect(page.getByTestId('sort')).toHaveCount(0);
      await expect(chip(page, 'portal-freelancermap')).toHaveText(
        filterLabel('portal-freelancermap'),
      );
      expect(await lastQuery(page)).toMatchObject({
        place,
        sort: 'match',
        portals: ['freelancermap'],
      });
      const menu = await openFilter(page);
      await expect(menu.getByTestId('menu-heading')).toHaveText(
        filterMenu().flatMap((group) => (group.heading === null ? [] : [group.heading])),
      );
      await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'true');
      await expect(menuItem(page, 'portal-freelancermap')).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
    }
    // The Papierkorb has no funnel and no filter (decision 25): every job of it, no chip; the
    // filter stays kept for the other places.
    await openPlace(page, 'trash');
    await expect(funnel(page)).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
    expect(await lastQuery(page)).toMatchObject({ place: 'trash', portals: [], bands: [] });
    await openPlace(page, 'inbox');
    await expect(chip(page, 'portal-freelancermap')).toBeVisible();
  });

  test('the chips follow the menu: the groups in its order, one chip per choice', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    // Picked from the last group to the first: the chips still stand in the menu's order,
    // a group's choices in its own.
    for (const id of ['received-days7', 'band-low', 'band-high', 'portal-freelance']) {
      await menuItem(page, id).click();
    }
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    // The band's chip says its heading with it (the ring's name of the band), the day's
    // chip says what it counts.
    const words = [
      T.portal.freelance,
      T.score.band.high,
      T.score.band.low,
      T.toolbar.receivedChip.days7,
    ];
    await expect(chipWords(page)).toHaveText(words);
    expect(chipWordsOf('received-days7', 'band-low', 'band-high', 'portal-freelance')).toEqual(
      words,
    );
    // A second choice takes a part off again, the menu stays.
    await openFilter(page);
    await expect(menuItem(page, 'received-days7')).toHaveAttribute('aria-checked', 'true');
    await menuItem(page, 'received-days7').click();
    await expect(menuItem(page, 'received-days7')).toHaveAttribute('aria-checked', 'false');
    await menuItem(page, 'band-low').click();
    await expect(menuItem(page, 'band-low')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'band-high')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chip(page, 'received-days7')).toHaveCount(0);
    await expect(chip(page, 'band-low')).toHaveCount(0);
    await expect(chipWords(page)).toHaveText([T.portal.freelance, T.score.band.high]);
  });

  test('the menu never covers the funnel or the title bar; where it does not fit it scrolls', async ({
    page,
  }) => {
    for (const [width, height] of [
      [1360, 820],
      [1000, 700],
      [480, 360],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page, WIN);
      await openFilter(page);
      const menu = menuFrame(page);
      const button = (await funnel(page).boundingBox())!;
      const bar = (await page.getByTestId('title-bar').boundingBox())!;
      const size = `${width}x${height}`;
      // Settled (it drops in): below the funnel or above it, under the bar, in the window.
      await expect
        .poll(async () => {
          const box = (await menu.boundingBox())!;
          return (
            (box.y >= button.y + button.height || box.y + box.height <= button.y) &&
            box.y >= bar.y + bar.height &&
            box.y + box.height <= height
          );
        }, size)
        .toBe(true);
      // Its last entry is within reach: the menu scrolls inside itself.
      const last = menuItem(page, FILTER_GROUPS.at(-1)!.entries(PORTALS).at(-1)!.id);
      await last.scrollIntoViewIfNeeded();
      await expect(last, size).toBeInViewport();
      // A second click on the funnel reaches the funnel and closes the menu (a choice would
      // keep it open).
      await funnel(page).click();
      await expect(page.getByTestId('menu'), size).toHaveCount(0);
      await expect(funnel(page), size).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('the keys pass over the headings: arrows, Home, End and the type-ahead', async ({
    page,
  }) => {
    await open(page, WIN);
    await funnel(page).focus();
    await page.keyboard.press('Enter');
    const active = (): Promise<string | null> =>
      page.evaluate(() => {
        const menu = document.querySelector('[data-testid="menu"]');
        const id = menu?.getAttribute('aria-activedescendant');
        return id ? (document.getElementById(id)?.dataset['testid'] ?? null) : null;
      });
    // The first order, the last entry of the last group (lib/state/filter.ts).
    const first = `menu-item-${sortEntryId(SORTS[0]!)}`;
    const last = `menu-item-${FILTER_GROUPS.at(-1)!.entries(PORTALS).at(-1)!.id}`;
    await expect.poll(active).toBe(first);
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe(last);
    await page.keyboard.press('Home');
    await expect.poll(active).toBe(first);
    await page.keyboard.press('End');
    await expect.poll(active).toBe(last);
    // A heading's word is no entry: typing it finds the entry that starts with it instead.
    await page.keyboard.type(filterLabel('portal-linkedin').slice(0, 4).toLowerCase());
    await expect.poll(active).toBe('menu-item-portal-linkedin');
    // Enter chooses it and the menu stays for the next choice.
    await page.keyboard.press('Enter');
    await expect(chip(page, 'portal-linkedin')).toHaveText(filterLabel('portal-linkedin'));
    await expect(menuItem(page, 'portal-linkedin')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(active).toBe('menu-item-portal-linkedin');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toHaveCount(0);
  });

  test('the portals and the bands narrow the list, any of them; each a chip with its ×', async ({
    page,
  }) => {
    await open(page, WIN);
    const { jobs, active: all } = await stubList(page);
    await chooseFilter(page, 'portal-linkedin');
    const linkedin = await inbox(page, { portals: ['linkedin'] });
    expect(linkedin.every((key) => key.startsWith('linkedin-'))).toBe(true);
    await expect.poll(() => listed(page)).toEqual(linkedin);
    expect(await lastQuery(page)).toMatchObject({ portals: ['linkedin'], bands: [] });
    // A second source adds its jobs (user decision 2026-10-01: several at once).
    await chooseFilter(page, 'portal-freelance');
    const two = await inbox(page, { portals: ['linkedin', 'freelance'] });
    expect(two.length).toBeGreaterThan(linkedin.length);
    expect(two.every((key) => /^(linkedin|freelance)-/.test(key))).toBe(true);
    await expect.poll(() => listed(page)).toEqual(two);
    await chipRemove(page, 'portal-freelance').click();
    await expect.poll(() => listed(page)).toEqual(linkedin);
    await chooseFilter(page, 'band-mid');
    const mid = await inbox(page, { portals: ['linkedin'], bands: ['mid'] });
    expect(mid.length).toBeGreaterThan(0);
    await expect.poll(() => listed(page)).toEqual(mid);
    expect(await lastQuery(page)).toMatchObject({ portals: ['linkedin'], bands: ['mid'] });
    // Exactly that band: no job of another band, no unscored and no excluded job.
    const bandOf = (key: string): string | null => {
      const match = jobs.find((job) => keyOf(job) === key)?.match ?? null;
      return match?.status === 'scored' ? match.band : null;
    };
    for (const key of mid) expect(bandOf(key)).toBe('mid');
    const unscored = jobs.filter((job) => job.match === null).map(keyOf);
    expect(unscored.length).toBeGreaterThan(0);
    for (const key of unscored) expect(await listed(page)).not.toContain(key);
    await expect(page.getByTestId('excluded-divider')).toHaveCount(0);
    // The chips in the menu's words, in the table's order.
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin', 'band-mid'));
    // Each × says what it takes off; the words themselves take nothing off.
    await expect(chipRemove(page, 'band-mid')).toHaveAccessibleName(
      T.chips.remove(chipWordsOf('band-mid')[0]!),
    );
    await chip(page, 'band-mid').locator('.text').click();
    await expect(chip(page, 'band-mid')).toBeVisible();
    expect(await lastQuery(page)).toMatchObject({ portals: ['linkedin'], bands: ['mid'] });
    // Gering adds the low band: the jobs of both.
    await chooseFilter(page, 'band-low');
    const both = await inbox(page, { portals: ['linkedin'], bands: ['mid', 'low'] });
    expect(both.length).toBeGreaterThan(mid.length);
    await expect.poll(() => listed(page)).toEqual(both);
    for (const key of both) expect(['mid', 'low']).toContain(bandOf(key));
    await expect(chipWords(page)).toHaveText(
      chipWordsOf('portal-linkedin', 'band-mid', 'band-low'),
    );
    // A chip's × takes its choice off; a click sets no focus anywhere, not even after the last.
    await chipRemove(page, 'band-mid').click();
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portals: ['linkedin'], bands: ['low'] }));
    await chipRemove(page, 'band-low').click();
    await expect.poll(() => listed(page)).toEqual(linkedin);
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin'));
    await chipRemove(page, 'portal-linkedin').click();
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(funnel(page)).not.toBeFocused();
    // From the keyboard the last one hands the focus to the funnel; before it the next chip's ×
    // takes it, and Delete takes a chip off like Enter.
    await chooseFilter(page, 'portal-linkedin');
    await chooseFilter(page, 'band-mid');
    await page.keyboard.press('Tab');
    await chipRemove(page, 'portal-linkedin').focus();
    await page.keyboard.press('Enter');
    await expect(chip(page, 'portal-linkedin')).toHaveCount(0);
    await expect(chipRemove(page, 'band-mid')).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(chips(page)).toHaveCount(0);
    await expect(funnel(page)).toBeFocused();
  });

  test("from the keyboard the last chip's × hands the focus on, also where the funnel goes with it", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('jobs-filter', JSON.stringify({ portals: ['linkedin'] })),
    );
    await open(page, `${WIN}&scenario=concept`);
    await openPlace(page, 'archive');
    await chipRemove(page, 'portal-linkedin').focus();
    await page.keyboard.press('Enter');
    await expectBarePlace(page, T.list.empty.archive);
    // Not to the top of the window: the place takes it, as when its last row went.
    await expect(page.getByTestId('place-archive')).toBeFocused();
  });

  test('Neu seit: the jobs of today, of the last 7 or 30 days, one choice at a time', async ({
    page,
  }) => {
    // The demo's day (its alert mails came on 23 and 24 September).
    await page.clock.setFixedTime(new Date('2026-09-24T09:30:00+02:00'));
    await open(page, WIN);
    const all = await inbox(page);
    const midnight = (back: number): Promise<number> =>
      page.evaluate((days) => {
        const now = new Date();
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
        return Math.floor(day.getTime() / 1000);
      }, back);
    const sinceOf = async (): Promise<number | null> =>
      ((await lastQuery(page)) as { receivedSince: number | null }).receivedSince;
    // Heute: from the start of the day in the user's time zone.
    await chooseFilter(page, 'received-today');
    await expect.poll(sinceOf).toBe(await midnight(0));
    const today = await inbox(page, { receivedSince: await midnight(0) });
    expect(today.length).toBeGreaterThan(0);
    expect(today.length).toBeLessThan(all.length);
    await expect.poll(() => listed(page)).toEqual(today);
    await expect(chipWords(page)).toHaveText([T.toolbar.receivedChip.today]);
    // Letzte 7 Tage takes its place: today and the six days before it.
    await chooseFilter(page, 'received-days7');
    await expect.poll(sinceOf).toBe(await midnight(6));
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(chipWords(page)).toHaveText([T.toolbar.receivedChip.days7]);
    await openFilter(page);
    await expect(menuItem(page, 'received-today')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'received-days7')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'received-today').locator('.tick')).toHaveCount(0);
    await expect(menuItem(page, 'received-days7').locator('.tick')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Kept like the rest of the filter: the next start counts from its own today.
    await open(page, WIN);
    await expect.poll(sinceOf).toBe(await midnight(6));
    await chipRemove(page, 'received-days7').click();
    await expect.poll(sinceOf).toBeNull();
  });

  test('a filter kept by an earlier version: its single choices and the groups gone are none', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'jobs-filter',
        JSON.stringify({
          portal: 'linkedin',
          band: 'high',
          portals: ['freelance', 'nowhere'],
          minBand: 'mid',
          remote: 'remote',
          workMode: 'remote',
          unread: true,
          pay: 'min',
        }),
      ),
    );
    await open(page, WIN);
    // One portal and one band of an earlier version, the groups gone and an unknown source
    // are none; the sources it can hold stay.
    const query = (await lastQuery(page))!;
    expect(query).toMatchObject({ portals: ['freelance'], bands: [] });
    for (const gone of ['workMode', 'unread', 'contracts', 'origin'])
      expect(query).not.toHaveProperty(gone);
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-freelance'));
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { portals: ['freelance'] }));
    await openFilter(page);
    for (const id of ['band-mid', 'band-high', 'portal-linkedin']) {
      await expect(menuItem(page, id)).toHaveAttribute('aria-checked', 'false');
    }
    await page.keyboard.press('Escape');
  });

  test('Nach Tagessatz: the highest day rate first, the jobs without one last', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseSort(page, 'rate');
    const byRate = await inbox(page, { sort: 'rate' });
    await expect.poll(() => listed(page)).toEqual(byRate);
    expect(await lastQuery(page)).toMatchObject({ sort: 'rate' });
    const { jobs } = await stubList(page, { sort: 'rate' });
    const rates = jobs.map((job) => job.match?.facts.rate ?? null);
    const stated = rates.filter((rate): rate is number => rate !== null);
    expect(stated.length).toBeGreaterThan(1);
    expect(rates.slice(0, stated.length)).toEqual([...stated].sort((a, b) => b - a));
    // Kept for the next start; the order sets no dot.
    await open(page, WIN);
    expect(await checkedSort(page)).toBe('rate');
  });

  test('the filter is the same in every place and kept; its chips take it off', async ({
    page,
  }) => {
    await open(page, WIN);
    const all = await inbox(page);
    await chooseFilter(page, 'portal-freelancermap');
    await chooseFilter(page, 'band-mid');
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portals: ['freelancermap'], bands: ['mid'] }));
    // The app starts again: the same filter.
    await open(page, WIN);
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-freelancermap', 'band-mid'));
    expect(await lastQuery(page)).toMatchObject({
      portals: ['freelancermap'],
      bands: ['mid'],
    });
    // The archive lists with it too.
    await openPlace(page, 'archive');
    expect(await lastQuery(page)).toMatchObject({
      place: 'archive',
      portals: ['freelancermap'],
      bands: ['mid'],
    });
    await expect(chipWords(page)).toHaveCount(2);
    await openPlace(page, 'inbox');
    await chipRemove(page, 'portal-freelancermap').click();
    await chipRemove(page, 'band-mid').click();
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
    expect(await page.evaluate(() => localStorage.getItem('jobs-filter'))).toBeNull();
  });

  test('without a profile the bands and the match order are off and say why', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('jobs-filter', JSON.stringify({ bands: ['high'] })),
    );
    await open(page, `${WIN}&scenario=no-profile`);
    expect(await lastQuery(page)).toMatchObject({ sort: 'newest', bands: [] });
    await openFilter(page);
    // By date only: the order is off and says why.
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'true');
    for (const sort of SORTS) {
      await expect(menuItem(page, sortEntryId(sort))).toHaveAttribute('aria-disabled', 'true');
    }
    await menuItem(page, 'sort-match').hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.toolbar.sortNoProfile);
    for (const id of ['band-high', 'band-mid', 'band-low']) {
      await expect(menuItem(page, id)).toHaveAttribute('aria-disabled', 'true');
    }
    await menuItem(page, 'band-high').hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.toolbar.bandNoProfile);
    await menuItem(page, 'band-high').click({ force: true });
    await expect(page.getByTestId('menu')).toBeVisible();
    // The portals still filter; the kept band waits for the profile.
    const kept = (): Promise<unknown> =>
      page.evaluate(() => JSON.parse(localStorage.getItem('jobs-filter') ?? 'null') as unknown);
    await menuItem(page, 'portal-freelance').click();
    expect(await lastQuery(page)).toMatchObject({ portals: ['freelance'], bands: [] });
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portals: ['freelance'], sort: 'newest' }));
    expect(await kept()).toEqual({ ...NO_FILTER, portals: ['freelance'], bands: ['high'] });
    await expect(chipWords(page)).toHaveText(chipWordsOf('portal-freelance'));
  });

  test('a filter that leaves nothing says so once and takes itself off', async ({ page }) => {
    await open(page, WIN);
    // A portal whose inbox has no job of the high band.
    let empty: string | null = null;
    for (const portal of ['freelance', 'freelancermap', 'linkedin'] as const) {
      const { active, excluded: out } = await stubList(page, {
        portals: [portal],
        bands: ['high'],
      });
      if (active.length + out.length === 0) empty = `portal-${portal}`;
    }
    expect(empty).not.toBeNull();
    await chooseFilter(page, empty!);
    await chooseFilter(page, 'band-high');
    // An empty state like every other: its title and one sentence, the reset under them.
    const state = page.getByTestId('empty-filter');
    await expect(state.locator('.tile')).toHaveCount(1);
    await expect(state.locator('h3')).toHaveText(T.list.noFilterHit);
    await expect(state.locator('p')).toHaveText(T.list.noFilterHitText);
    expect(T.list.noFilterHit).not.toMatch(/\.$/);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(funnel(page)).toBeVisible();
    await expect(chipWords(page)).toHaveCount(2);
    const reset = state.getByTestId('filter-reset');
    await expect(reset).toHaveText(T.toolbar.filterReset);
    // A click takes the filter off and sets no focus (a button the code focused would show a
    // tooltip nobody asked for); from the keyboard the funnel takes it, not the top of the window.
    await reset.click();
    await expect(state).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    await expect(funnel(page)).not.toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('jobs-filter'))).toBeNull();
    await chooseFilter(page, empty!);
    await chooseFilter(page, 'band-high');
    await expect(state).toBeVisible();
    await page.keyboard.press('Tab');
    await reset.focus();
    await page.keyboard.press('Enter');
    await expect(state).toHaveCount(0);
    await expect(funnel(page)).toBeFocused();
  });

  test('the open job stays while the filter lists it, else it closes', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await chooseFilter(page, 'band-high');
    const high = await inbox(page, { bands: ['high'] });
    expect(high).toContain('freelancermap-2801');
    await expect.poll(() => listed(page)).toEqual(high);
    await expect(page.getByTestId('reader-title')).toBeVisible();
    await expect(row(page, 'freelancermap-2801')).toHaveAttribute('aria-current', 'true');
    await chooseFilter(page, 'portal-linkedin');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { bands: ['high'], portals: ['linkedin'] }));
  });

  test('macOS: the same funnel, menu and chips', async ({ page }) => {
    await open(page, MAC);
    await chooseFilter(page, 'portal-linkedin');
    await expect(rows(page)).toHaveCount((await inbox(page, { portals: ['linkedin'] })).length);
    await expect(chip(page, 'portal-linkedin')).toHaveText(filterLabel('portal-linkedin'));
  });
});

/* ========================================================================= list */

test.describe('one list', () => {
  test('the inbox: the scored jobs, then the ones without a score in their open section, the new ones in 650', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active: all, jobs } = await stubList(page);
    await expect.poll(() => listed(page)).toEqual(all);
    // Every job whose ring shows no number stands after the scored ones, in its own section
    // "Noch nicht bewertet", open (design round 7): not scored yet and unscorable together.
    const unscored = jobs
      .filter((job) => job.match?.status !== 'scored' && !excluded(job))
      .map(keyOf);
    expect(jobs.some((job) => job.match === null)).toBe(true);
    expect(jobs.some((job) => job.match?.status === 'unscorable')).toBe(true);
    expect(all.slice(-unscored.length).sort()).toEqual([...unscored].sort());
    const divider = page.getByTestId('unscored-divider');
    await expect(divider).toContainText(T.list.unscored);
    await expect(
      page.getByTestId('unscored-rows').locator('[data-testid^="job-row-"]'),
    ).toHaveCount(unscored.length);
    for (const id of [
      'facet',
      'caught-up',
      'fresh-divider',
      'older-divider',
      'pending-divider',
      'empty-new',
    ]) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
    // A new job: its title in 650 and a hidden "Neu"; no dot.
    await expect(list(page).locator('.dot')).toHaveCount(0);
    const fresh = await rows(page).evaluateAll((items) =>
      items
        .filter((item) => item.querySelector('.title.unread') != null)
        .map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
    );
    const unseen = rows(page).filter({ has: page.locator('.unseen') });
    await expect(unseen.first().locator('.unseen')).toHaveText(T.job.unread);
    expect(await unseen.count()).toBe(fresh.length);
    expect(fresh.sort()).toEqual(
      jobs
        .filter((job) => job.unread && !excluded(job))
        .map(keyOf)
        .sort(),
    );
  });

  test('opening a job reads it once, on a real click; the row stays, its title steps down', async ({
    page,
  }) => {
    await open(page, WIN);
    const all = await inbox(page);
    expect(await calls(page, 'mark_read')).toHaveLength(0);
    const first = row(page, 'linkedin-4100200301');
    await openJob(page, 'linkedin-4100200301');
    await openJob(page, 'freelancermap-2802');
    await openJob(page, 'linkedin-4100200301');
    expect((await calls(page, 'mark_read')).map(([, args]) => args)).toEqual([
      { key: { portal: 'linkedin', id: '4100200301' } },
      { key: { portal: 'freelancermap', id: '2802' } },
    ]);
    await expect(first.locator('.title')).not.toHaveClass(/unread/);
    await expect(first.locator('.unseen')).toHaveCount(0);
    await expect(first).toBeVisible();
    await expect.poll(() => listed(page)).toEqual(all);
    // Back from another view the list is the same.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('nav-jobs').click();
    await expect.poll(() => listed(page)).toEqual(all);
  });

  test('new is unread and not excluded: the heavier title in every place', async ({ page }) => {
    await open(page, WIN);
    const { jobs } = await stubList(page);
    const isNew = (job: JobView): boolean => job.unread && !excluded(job);
    const fresh = jobs.filter(isNew).map(keyOf).sort();
    /** The keys of the mounted rows that are marked new (the fold's too). */
    const dotted = async (): Promise<string[]> =>
      (
        await list(page)
          .locator('[data-testid^="job-row-"]')
          .evaluateAll((items) =>
            items
              .filter((item) => item.querySelector('.title.unread') != null)
              .map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
          )
      ).sort();
    // An unread excluded job carries none: it is no new one.
    expect(jobs.some((job) => job.unread && excluded(job))).toBe(true);
    await unfoldExcluded(page);
    expect(await dotted()).toEqual(fresh);
    // A new job moved to the Archiv stays new there, like a mail app's unread mark.
    const moved = fresh[0]!;
    await viaMenu(page, 'archive', moved);
    await openPlace(page, 'archive');
    await expect.poll(dotted).toContain(moved);
  });

  test('the excluded jobs are one folded section at the end of each place, no count; kept open', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active, excluded: out } = await stubList(page);
    expect(out.length).toBeGreaterThan(1);
    const divider = page.getByTestId('excluded-divider');
    // Its label only (no count), its chevron at the end.
    await expect(divider).toHaveText(T.list.excluded);
    await expect(divider.locator('.count')).toHaveCount(0);
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    const last = (await rows(page).last().boundingBox())!;
    expect((await divider.boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height);
    await divider.click();
    await expect(excludedRows(page)).toHaveCount(out.length);
    // Newest first, as by date: their rings show the ban, not the fit they keep.
    expect(out).toEqual((await stubList(page, { sort: 'newest' })).excluded);
    expect(
      await excludedRows(page).evaluateAll((items) =>
        items.map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
      ),
    ).toEqual(out);
    // Rows like every other, the ban in the ring's place, no reason.
    await expect(excludedRows(page).first().getByTestId('row-excluded')).toBeVisible();
    await expect(excludedRows(page).first().locator('.foot')).toHaveCount(0);
    // Kept: the next start shows it open; an archived job is in no list of the inbox.
    await open(page, WIN);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'linkedin-4100200306')).toHaveCount(0);
    expect(await listed(page)).toEqual(active);
    // Each place has its own: one excluded job archived is in the Archiv's section.
    await viaMenu(page, 'archive', out[0]!);
    await expect(excludedRows(page)).toHaveCount(out.length - 1);
    await openPlace(page, 'archive');
    await expect(excludedRows(page)).toHaveCount(1);
  });

  test('the job open when the app closed opens again, its place with it, while it lies there', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2802');
    const title = await row(page, 'freelancermap-2802').locator('.title').innerText();
    // The next start: the job is open again, its row marked and in view.
    await open(page, WIN);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(title);
    await expect(row(page, 'freelancermap-2802')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'freelancermap-2802')).toBeInViewport();
    // Kept per work folder.
    const kept = await page.evaluate(() =>
      Object.keys(localStorage).filter((name) => name.startsWith('jobs-open:')),
    );
    expect(kept).toHaveLength(1);
    // In one column the app starts with the list; the job stays kept for a wider window.
    await page.setViewportSize({ width: 683, height: 700 });
    await open(page, WIN);
    await expect(row(page, 'freelancermap-2802')).toBeVisible();
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    await page.setViewportSize({ width: 1360, height: 900 });
    await open(page, WIN);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(title);
    // A job of the Archiv opens with its place.
    await openPlace(page, 'archive');
    await openJob(page, 'linkedin-4100200306');
    await open(page, WIN);
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    await expect(row(page, 'linkedin-4100200306')).toHaveAttribute('aria-current', 'true');
    // A job no longer where it lay opens nothing, and is forgotten.
    await page.evaluate((name) => {
      localStorage.setItem(
        name,
        JSON.stringify({ key: { portal: 'freelancermap', id: '2801' }, place: 'trash' }),
      );
    }, kept[0]!);
    await open(page, WIN);
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('place-reader')).toBeVisible();
    expect(await page.evaluate((name) => localStorage.getItem(name), kept[0]!)).toBeNull();
    // Closed, it stays closed.
    await openJob(page, 'freelancermap-2801');
    // Hiding the job view closes the job; shown again it asks for one.
    await page.getByTestId('toggle-reader').click();
    await page.getByTestId('toggle-reader').click();
    await open(page, WIN);
    await expect(page.getByTestId('place-reader')).toBeVisible();
  });

  test('the order is kept for every list and keeps the open job', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2803');
    await chooseSort(page, 'match');
    const byMatch = await inbox(page, { sort: 'match' });
    await expect.poll(() => listed(page)).toEqual(byMatch);
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'freelancermap-2803')).toBeInViewport();
    await openPlace(page, 'archive');
    expect(await checkedSort(page)).toBe('match');
    await open(page, WIN);
    expect(await lastQuery(page)).toMatchObject({ sort: 'match' });
  });

  test('paging: the next page follows on from the last and skips no job', async ({ page }) => {
    await open(page, `${WIN}&scenario=many`);
    for (const index of [0, 1, 2]) await rows(page).nth(index).click();
    const scroller = page.getByTestId('list-scroll');
    await expect
      .poll(
        async () => {
          await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
          return list(page).locator('[data-key]').count();
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(240);
    const offsets = (await calls(page, 'list_jobs'))
      .map(([, args]) => (args as { query: { offset: number; limit: number } }).query)
      .filter((query) => query.offset > 0 && query.limit > 0)
      .map((query) => query.offset);
    expect(offsets[0]).toBe(120);
    const keys = await mountedKeys(page);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('loading takes a moment: placeholder rows, then the rows in their place', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=slow`);
    const skeleton = page.getByTestId('list-skeleton');
    await expect(skeleton).toBeVisible();
    // The rows take the placeholders' place.
    await expect(rows(page).first()).toBeVisible({ timeout: 5000 });
    await expect(skeleton).toHaveCount(0);
  });

  test('an empty inbox says what comes in a heading and one sentence, and fetches', async ({
    page,
  }) => {
    const says = async (words: { heading: string; text: string }): Promise<void> => {
      const shown = page.getByTestId('empty-all');
      await expect(shown.locator('h3')).toHaveText(words.heading);
      await expect(shown.locator('p')).toHaveText(words.text);
    };
    // Before the first search: Jobs suchen under it, its one button.
    await open(page, `${WIN}&scenario=fresh`);
    await says(T.list.empty.inbox);
    await expect(page.getByTestId('empty-all').getByRole('button')).toHaveText([
      T.toolbar.searchNow,
    ]);
    // After a search that found nothing that fits: that, and the way to the profile.
    await open(page, `${WIN}&scenario=empty`);
    const empty = page.getByTestId('empty-all');
    await says(T.list.empty.noMatch);
    // Its jobs all archived or deleted: no hint that the profile does not fit.
    await open(page, `${WIN}&scenario=archived`);
    await says(T.list.empty.noActive);
    await expect(page.getByTestId('empty-all').getByRole('button')).toHaveText([
      T.toolbar.searchNow,
    ]);
    await open(page, `${WIN}&scenario=empty`);
    // No job anywhere: no head, Jobs suchen and the way to the profile under it.
    await expect(empty.getByRole('button')).toHaveText([T.toolbar.searchNow, T.list.openProfile]);
    await expect(page.getByTestId('list-header')).toHaveCount(0);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    for (const gone of ['alert-linkedin', 'read-older']) {
      await expect(page.getByTestId(gone)).toHaveCount(0);
    }
    await page.getByTestId('fetch').click();
    expect((await calls(page, 'start_run')).at(-1)?.[1]).toMatchObject({
      request: { kind: 'fetch' },
    });
    // While the fetch goes the list says the jobs come, and offers no second fetch.
    await says(T.list.empty.running);
    await expect(page.getByTestId('empty-all').getByRole('button')).toHaveCount(0);
  });

  test('without a profile: newest first, one line leads to the start of a new profile', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    const notice = page.getByTestId('no-profile');
    await expect(notice).toContainText(T.list.noProfile);
    await expect(notice).toContainText(T.list.noProfileText);
    await expect(page.getByTestId('place-reader')).toContainText(T.reader.pickJob);
    expect((await calls(page, 'list_jobs'))[0]?.[1]).toMatchObject({
      query: { sort: 'newest' },
    });
    await notice.getByRole('button', { name: T.list.createProfile }).click();
    await expect(page.getByTestId('new-profile-ways')).toBeVisible();
  });

  test('a profile the app cannot use, or a thin one: one line on top leads to it', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=profile-broken`);
    const broken = page.getByTestId('no-profile');
    await expect(broken).toContainText(T.list.profileBrokenText);
    await broken.getByRole('button', { name: T.list.openProfile }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
    await open(page, `${WIN}&scenario=profile-thin`);
    const thin = page.getByTestId('thin-profile');
    await expect(thin).toContainText(T.list.thinProfile);
    await expect(thin).toContainText(T.profile.warning.fewCompetences);
    // Its competences stand below the window's end until the way leads to them.
    await page.setViewportSize({ width: 1360, height: 480 });
    const competences = page.locator('[data-field~="competences"]');
    await page.getByTestId('nav-profile').click();
    await expect(competences).not.toBeInViewport();
    await page.getByTestId('nav-jobs').click();
    await thin.getByRole('button', { name: T.list.completeProfile }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
    // It lacks no field, but little of its competences: they come up, no caret goes there.
    await expect(competences).toBeInViewport();
    expect(await page.evaluate(() => document.activeElement?.matches('input, textarea'))).toBe(
      false,
    );
  });

  test('a removed mailbox keeps the jobs: the search goes on, the mailbox says what it needs', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-settings').click();
    await (await reveal(page, page.getByTestId('mailbox-remove'))).click();
    await page
      .getByTestId('dialog-remove-mailbox')
      .getByRole('button', { name: T.common.remove })
      .click();
    await page.getByTestId('nav-jobs').click();
    await expect(rows(page).first()).toBeVisible();
    // The portals' search goes on without a mailbox: no note, the fetch stays on.
    await expect(page.getByTestId('fetch')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('no-mailbox')).toHaveCount(0);
  });

  test('without a profile Jobs suchen waits and says why', async ({ page }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    const fetch = page.getByTestId('fetch');
    await expect(fetch).toHaveAttribute('aria-disabled', 'true');
    await fetch.hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.toolbar.needsProfile);
    await fetch.click({ force: true });
    expect(await calls(page, 'start_run')).toHaveLength(0);
  });

  test('a fetch refused again says so in the one toast that is up', async ({ page }) => {
    await open(page, WIN);
    for (const round of [1, 2, 3]) {
      await failNext(page, 'start_run');
      await page.getByTestId('fetch').click();
      await expect(page.getByTestId('toast'), `round ${round}`).toHaveCount(1);
    }
  });

  test('one primary button in every state of the list, and with a job open', async ({ page }) => {
    const primary = '.btn.primary';
    for (const scenario of [
      'default',
      'fresh',
      'empty',
      'archived',
      'no-profile',
      'offline',
      'list-error',
    ]) {
      await open(page, `${WIN}&scenario=${scenario}`);
      expect(await visibleCount(page, primary), scenario).toBeLessThanOrEqual(1);
    }
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    expect(await visibleCount(page, primary)).toBeLessThanOrEqual(1);
  });
});

/* ========================================================================= days */

test.describe('days', () => {
  /** The days' headings of the list, in their order. */
  const headings = (page: Page): Promise<string[]> =>
    list(page).getByTestId('day-heading').allTextContents();
  /** The list's head draws its hairline. */
  const lined = (page: Page): Promise<boolean> =>
    page
      .getByTestId('list-header')
      .locator('header')
      .evaluate((node) => node.classList.contains('line'));

  test('by date (the default): Heute, Gestern, then the weekday and date; none in the sections', async ({
    page,
  }) => {
    await open(page, WIN);
    expect(await checkedSort(page)).toBe('newest');
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    // The fixed clock stands at Thursday 24.09., 09:30 in Berlin; a job that came at 00:30
    // local time (22:30 UTC the day before) is today's.
    expect(await headings(page)).toEqual(['Heute', 'Gestern', 'Di 22.09.']);
    // Within a day the open ads before the closed one, then the best match.
    const { jobs } = await stubList(page);
    const day = jobs.filter((job) => job.firstSeenAt.startsWith('2026-09-22'));
    expect(day.map((job) => job.closed)).toEqual([false, true]);
    // The sections have no days.
    await unfoldExcluded(page);
    for (const id of ['unscored-rows', 'excluded-rows']) {
      await expect(page.getByTestId(id).getByTestId('day-heading'), id).toHaveCount(0);
    }
    // The flat orders have none.
    await chooseSort(page, 'match');
    await expect(list(page).getByTestId('day-heading')).toHaveCount(0);
    await chooseSort(page, 'rate');
    await expect(list(page).getByTestId('day-heading')).toHaveCount(0);
  });

  test('the Papierkorb heads its days by when the jobs went there', async ({ page }) => {
    await open(page, WIN);
    await viaMenu(page, 'trash', 'freelancermap-2805');
    await viaMenu(page, 'trash', 'linkedin-4100200303');
    await openPlace(page, 'trash');
    // Two jobs went there before (today, yesterday), one now (scored, it joins today).
    expect(await headings(page)).toEqual(['Heute', 'Gestern']);
    const today = list(page).locator('.day').first();
    await expect(today.getByTestId('job-row-linkedin-4100200303')).toBeVisible();
  });

  test('a day folds with its last row', async ({ page }) => {
    await open(page, WIN);
    await openPlace(page, 'archive');
    expect(await headings(page)).toEqual(['Di 22.09.', 'Fr 11.09.']);
    await viaMenu(page, 'unarchive', 'linkedin-4100200306');
    await expect.poll(() => headings(page)).toEqual(['Fr 11.09.']);
  });

  test('the headings roll over at midnight', async ({ page }) => {
    await open(page, WIN);
    expect((await headings(page))[0]).toBe('Heute');
    await page.clock.setFixedTime(new Date(NOW.getTime() + 24 * 3_600_000));
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect.poll(async () => (await headings(page))[0]).toBe('Gestern');
    expect((await headings(page))[1]).toBe('Mi 23.09.');
  });

  test('a heading sticks while its rows pass; the head draws its line only where none sticks', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 420 });
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    const scroller = page.getByTestId('list-scroll');
    const top = (await scroller.boundingBox())!.y;
    expect(await lined(page)).toBe(false);
    /** The opacity of the fade under the first day's heading. */
    const fade = () =>
      list(page)
        .getByTestId('day-heading')
        .first()
        .evaluate((node) => getComputedStyle(node, '::after').opacity);
    // In its place it has no fade (it would lie over its first row).
    expect(await fade()).toBe('0');
    // A little down: today's heading sticks at the top, the rows fade out under it, the head
    // has no line.
    await scroller.evaluate((node) => node.scrollTo({ top: 60 }));
    await expect
      .poll(async () =>
        Math.round((await list(page).getByTestId('day-heading').first().boundingBox())!.y),
      )
      .toBe(Math.round(top));
    await expect.poll(fade).toBe('1');
    await expect.poll(() => lined(page)).toBe(false);
    // Past the days (the sections at the top): the line.
    await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    await expect.poll(() => lined(page)).toBe(true);
    // A flat order keeps the line once the list scrolled.
    await scroller.evaluate((node) => node.scrollTo({ top: 0 }));
    await chooseSort(page, 'match');
    await expect.poll(() => lined(page)).toBe(false);
    await scroller.evaluate((node) => node.scrollTo({ top: 60 }));
    await expect.poll(() => lined(page)).toBe(true);
  });
});

test('a profile that lacks fields: Jobs suchen names them, the state box leads to the Profil', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=profile-incomplete`);
  const fetch = page.getByTestId('fetch');
  await expect(fetch).toHaveAttribute('aria-disabled', 'true');
  await fetch.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    T.toolbar.needsFields([T.profile.field.roles, T.profile.field.languages]),
  );
  const box = page.getByTestId('no-profile');
  await expect(box).toContainText(T.list.profileEmpty);
  await box.getByRole('button', { name: T.list.completeProfile }).click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  // The first required field still empty is in view, without the caret, and what is missing is
  // marked, as with the button of the card, which says it too.
  const roles = page.getByTestId('profile-roles');
  await expect(roles).toBeInViewport();
  await expect(roles.locator('input')).not.toBeFocused();
  await expect(page.getByTestId('profile-missing')).toBeVisible();
  await expect(page.locator('[data-field~="roles"][data-missing]')).toHaveCount(1);
});

/* ========================================================================= rows */

test.describe('rows', () => {
  test('the menu of a row in each place: its entries in order, no keys', async ({ page }) => {
    await open(page, WIN);
    // A click opens the job: the menu has no "Öffnen".
    const shows = [T.actions.openAd, T.actions.mail, T.actions.prompt];
    // Aktuell.
    let menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu).toHaveAttribute('aria-label', T.menu.job);
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.archive,
      T.actions.trash,
    ]);
    await expect(menu.locator('.keys')).toHaveCount(0);
    await expect(menuItem(page, 'unread')).toHaveCount(0);
    await expect(menuItem(page, 'open')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The archive: unarchive, delete.
    await viaMenu(page, 'archive', 'freelancermap-2802');
    await openPlace(page, 'archive');
    menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.unarchive,
      T.actions.trash,
    ]);
    await menuItem(page, 'trash').click();
    // The trash: restore, delete for good.
    await openPlace(page, 'trash');
    menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.restore,
      T.actions.purge,
    ]);
  });

  test('an excluded job kept open from the last start opens its folded section', async ({
    page,
  }) => {
    await open(page, `${WIN}&open=freelance:900412`);
    await expect(stage(page).getByTestId('exclusion')).toBeVisible();
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
    await expect(excludedRows(page).and(row(page, 'freelance-900412'))).toBeVisible();
  });

  test('the open job that turns out excluded keeps its row: its section opens, the kept choice stays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 600 });
    await open(page, `${WIN}&open=freelancermap:2805&tick=15`);
    const key = 'freelancermap-2805';
    const divider = page.getByTestId('excluded-divider');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.excluded);
    await expect(divider).toHaveAttribute('aria-expanded', 'true');
    await expect(excludedRows(page).and(row(page, key))).toBeVisible();
    await expectHighlightOn(page, key);
    // Its row stands in view, whichever end of the list it came to.
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    // For now: the kept choice is what it was.
    expect(await page.evaluate(() => localStorage.getItem('jobs-excluded-open'))).toBeNull();
    // A fold by hand keeps working: the job stays open, nothing opens the section again.
    await divider.click();
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    await expect(page.getByTestId('row-bar')).not.toHaveClass(/\bshown\b/);
    const job = await stubJob(page, 'freelancermap', '2805');
    await page.evaluate(
      (job) => window.__harness.emit({ type: 'jobUpdated', job, fresh: false }),
      job,
    );
    await page.waitForTimeout(100);
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.excluded);
  });

  test('the open job that loses its score keeps its row: the folded section without a score opens', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-unscored-open', '0'));
    await open(page, WIN);
    const key = (await listed(page))[0]!;
    await openJob(page, key);
    const divider = page.getByTestId('unscored-divider');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    const [portal, id] = key.split(/-(.*)/) as ['freelancermap', string];
    const job = await stubJob(page, portal, id);
    await page.evaluate(
      (job) =>
        window.__harness.emit({ type: 'jobUpdated', job: { ...job, match: null }, fresh: false }),
      job,
    );
    await expect(divider).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('unscored-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    await expectHighlightOn(page, key);
    expect(await page.evaluate(() => localStorage.getItem('jobs-unscored-open'))).toBe('0');
  });

  test('an excluded job counts anyway from its job view: its row stays in view, with its undo', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 520 });
    await open(page, `${WIN}&open=freelance:900412`);
    const key = 'freelance-900412';
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    await stage(page).getByTestId('reader-include').click();
    await expect(page.getByTestId('job-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    await expectHighlightOn(page, key);
    await page.getByTestId('toast').last().getByTestId('toast-action').click();
    await expect(excludedRows(page).and(row(page, key))).toBeVisible();
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    await expectHighlightOn(page, key);
  });

  test('another job counting anyway leaves the list where the user looks', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 520 });
    await open(page, WIN);
    const { active, excluded } = await stubList(page);
    const opened = active[0]!;
    await openJob(page, opened);
    await unfoldExcluded(page);
    const pane = page.getByTestId('list-scroll');
    await pane.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await expect.poll(() => wholeInList(page, opened)).toBe(false);
    await viaMenu(page, 'include', excluded[0]!);
    await expect(page.getByTestId('job-rows').getByTestId(`job-row-${excluded[0]}`)).toBeAttached();
    await page.waitForTimeout(200);
    expect(await wholeInList(page, opened)).toBe(false);
  });

  test('an excluded job counts anyway from its menu, with an undo; no way to exclude it again', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    const key = 'linkedin-4100200305';
    await expect(page.getByTestId('excluded-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    const menu = await rowMenu(page, key);
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      T.actions.openAd,
      T.actions.mail,
      T.actions.prompt,
      T.actions.include,
      T.actions.archive,
      T.actions.trash,
    ]);
    await menuItem(page, 'include').click();
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toEqual({
      key: { portal: 'linkedin', id: '4100200305' },
      include: true,
    });
    // It stands with the scored rows, its ring back; the toast says it with an undo.
    await expect(page.getByTestId('job-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    await expect(row(page, key).getByTestId('row-excluded')).toHaveCount(0);
    const toast = page.getByTestId('toast').filter({ hasText: T.toast.included });
    await expect(toast.getByTestId('toast-action')).toHaveText(T.common.undo);
    // "Wieder ausschließen" is hidden for now (user, 2026-09-29): the undo is the way back.
    await rowMenu(page, key);
    await expect(menuItem(page, 'include')).toHaveCount(0);
    await expect(page.getByTestId('menu-item-exclude')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await toast.getByTestId('toast-action').click();
    await expect(page.getByTestId('excluded-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toMatchObject({ include: false });
  });

  test('a double click on a row opens its ad in the browser, like Anzeige öffnen', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'linkedin-4100200301').dblclick();
    await expect.poll(async () => (await calls(page, 'open_target')).length).toBe(1);
    expect((await calls(page, 'open_target'))[0]?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'linkedin', id: '4100200301' } },
    });
    await expect(row(page, 'linkedin-4100200301')).toHaveAttribute('aria-current', 'true');
    // The menu's entry makes the same call.
    await viaMenu(page, 'open-ad', 'linkedin-4100200301');
    await expect.poll(async () => (await calls(page, 'open_target')).length).toBe(2);
    expect((await calls(page, 'open_target'))[1]?.[1]).toEqual(
      (await calls(page, 'open_target'))[0]?.[1],
    );
  });

  test('a list ring that waits shows a dash instead of a score', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    await settle(page);
    const ring = list(page)
      .locator('.job', { has: page.getByTestId('job-row-linkedin-4100200302') })
      .locator('.ring');
    await expect(ring.locator('.center')).toHaveText('–');
  });
});

/* ======================================================================= search */

test.describe('search', () => {
  test('the words of a search are marked in the titles, in any case and with or without accents', async ({
    page,
  }) => {
    await open(page, WIN);
    // "kaufmannisch" finds "Kaufmännische" like the backend's folded search, "leitung" too.
    await page.getByTestId('search').fill('kaufmannisch LEITUNG');
    const target = row(page, 'freelancermap-2803');
    await expect(target).toBeVisible();
    const marks = target.locator('.title mark');
    await expect(marks).toHaveText(['Kaufmännisch', 'Leitung']);
    // The title keeps its text.
    await expect(target.locator('.title')).toHaveText('Kaufmännische Leitung Projektgeschäft');
    // Without a search nothing is marked.
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(rows(page).first()).toBeVisible();
    await expect(list(page).locator('.title mark')).toHaveCount(0);
  });

  test('no hit: one empty state; the search clears by its ×', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kernfusion');
    // An empty state like every other: its title and one sentence.
    const none = page.getByTestId('empty-search');
    await expect(none.locator('.tile')).toHaveCount(1);
    await expect(none.locator('h3')).toHaveText(T.list.noHit('Kernfusion'));
    await expect(none.locator('p')).toHaveText(T.list.noHitText);
    expect(T.list.noHit('Kernfusion')).not.toMatch(/\.$/);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(none.getByRole('button')).toHaveCount(0);
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(rows(page).first()).toBeVisible();
  });

  test('a search and a filter that leave nothing say so and offer the reset; the search stays', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-freelance');
    const search = page.getByTestId('search');
    await search.fill('Kreditoren');
    const none = page.getByTestId('empty-search');
    await expect(none.locator('h3')).toHaveText(T.list.noHitFiltered('Kreditoren'));
    await expect(none.locator('p')).toHaveText(T.list.noHitFilteredText);
    expect(T.list.noHitFiltered('Kreditoren')).not.toMatch(/\.$/);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(page.getByTestId('also-archive')).toHaveCount(0);
    const reset = none.getByTestId('filter-reset');
    await expect(reset).toHaveText(T.toolbar.filterReset);
    await reset.click();
    // The filter goes, the search stays: now it finds its job in the Archiv, whose button stands
    // under the state, and there is nothing left to reset.
    await expect(chips(page)).toHaveCount(0);
    await expect(search).toHaveValue('Kreditoren');
    await expect(none.locator('h3')).toHaveText(T.list.noHit('Kreditoren'));
    await expect(none.locator('p')).toHaveText(T.list.noHitText);
    await expect(none.getByTestId('filter-reset')).toHaveCount(0);
    await expect(none.getByTestId('also-archive')).toBeVisible();
    expect((await lastQuery(page))?.search).toBe('Kreditoren');
  });

  test('while a search is on both sections stand open, their headings locked; the kept choice returns', async ({
    page,
  }) => {
    await open(page, WIN);
    const unscored = page.getByTestId('unscored-divider');
    const excludedOnes = page.getByTestId('excluded-divider');
    const kept = (): Promise<[string | null, string | null]> =>
      page.evaluate(() => [
        localStorage.getItem('jobs-unscored-open'),
        localStorage.getItem('jobs-excluded-open'),
      ]);
    // Both folded by the choice kept.
    await unscored.click();
    await expect(page.getByTestId('unscored-rows')).toHaveCount(0);
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    const choice = await kept();
    // A word with hits in both.
    await page.getByTestId('search').fill('Hamburg');
    const { active, excluded: out, jobs } = await stubList(page, { search: 'Hamburg' });
    const waiting = jobs.filter((job) => job.match?.status === 'unscorable').map(keyOf);
    expect(waiting.length).toBeGreaterThan(0);
    expect(out.length).toBeGreaterThan(0);
    await expect(unscored).toHaveAttribute('aria-expanded', 'true');
    await expect(excludedOnes).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => listed(page)).toEqual(active);
    await expect(excludedRows(page)).toHaveCount(out.length);
    // Their headings are locked while it is on: they answer no pointer and change nothing kept.
    for (const divider of [unscored, excludedOnes]) {
      await expect(divider).toBeDisabled();
      await expectNoAnswer(page, divider);
      await divider.click({ force: true });
      await expect(divider).toHaveAttribute('aria-expanded', 'true');
      // A press on it is a press on the list: an open menu closes (its end stands beside the menu).
      await openFilter(page);
      const box = (await divider.boundingBox())!;
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await expect(page.getByTestId('menu')).toHaveCount(0);
    }
    await expect(page.getByTestId('unscored-rows').locator('[data-key]')).toHaveCount(
      waiting.length,
    );
    await expect(excludedRows(page)).toHaveCount(out.length);
    expect(await kept()).toEqual(choice);
    // The search gone, each section as it was chosen.
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await expect(excludedOnes).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('unscored-rows')).toHaveCount(0);
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    // Their chevrons work again.
    await excludedOnes.click();
    await expect(excludedOnes).toHaveAttribute('aria-expanded', 'true');
  });

  test('the first typed letter unfolds nothing over the old list: sections and marks come with the hits', async ({
    page,
  }) => {
    await slowSearch(page, 800);
    await open(page, WIN);
    const unscored = page.getByTestId('unscored-divider');
    await unscored.click();
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await openJob(page, 'linkedin-4100200301');
    const marks = list(page).locator('mark');
    const adMarks = stage(page).getByTestId('ad-text').locator('mark');
    await page.getByTestId('search').fill('Control');
    // On its way the answer changes nothing: the old list stands as it was, the open ad too.
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'false');
    await expect(marks).toHaveCount(0);
    await expect(adMarks).toHaveCount(0);
    // The answer: its hits at once, the sections open with them, nothing unfolding.
    await expect(excludedRows(page)).toHaveCount(1);
    await expect(unscored).toHaveAttribute('aria-expanded', 'true');
    await expect(marks.first()).toBeVisible();
    await expect(adMarks.first()).toBeVisible();
    expect(
      await page.getByTestId('excluded-rows').evaluate((node) => node.getAnimations().length),
    ).toBe(0);
  });

  test('a list that starts with a section: no line over its heading, which stands where a day stands', async ({
    page,
  }) => {
    /** Where the words of a heading start. */
    const wordsTop = (heading: Locator): Promise<number> =>
      heading.evaluate((node) => {
        const words = document.createRange();
        words.selectNodeContents(node);
        return words.getBoundingClientRect().top;
      });
    const lineOf = (heading: Locator): Promise<string> =>
      heading.evaluate((node) => getComputedStyle(node).borderTopWidth);
    await open(page, WIN);
    const day = await wordsTop(page.getByTestId('day-heading').first());
    const unscored = page.getByTestId('unscored-divider');
    // Between rows it keeps its line.
    expect(await lineOf(unscored)).not.toBe('0px');
    await page.getByTestId('search').fill('Buchhaltung');
    const excludedOnes = page.getByTestId('excluded-divider');
    await expect(excludedRows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveCount(0);
    expect(await lineOf(excludedOnes)).toBe('0px');
    expect(await wordsTop(excludedOnes.locator('.label'))).toBe(day);
    // In the flat orders too (their rows hold an empty group).
    await chooseSort(page, 'match');
    await expect(page.getByTestId('day-heading')).toHaveCount(0);
    await expect(excludedRows(page)).toHaveCount(1);
    expect(await lineOf(excludedOnes)).toBe('0px');
    expect(await wordsTop(excludedOnes.locator('.label'))).toBe(day);
    // No profile: all of a place stands in its one section, under the state box.
    await open(page, `${WIN}&scenario=no-profile`);
    expect(await lineOf(unscored)).toBe('0px');
  });

  test('a place that holds only what its folds hide stands open, its heading locked; the kept choice returns', async ({
    page,
  }) => {
    const scored = ['freelancermap-2801', 'freelance-900411', 'freelancermap-2804'];
    const waiting = 'linkedin-4100200302';
    const out = 'freelance-900412';
    await open(page, `${WIN}&scenario=concept`);
    const unscored = page.getByTestId('unscored-divider');
    const excludedOnes = page.getByTestId('excluded-divider');
    const kept = (): Promise<[string | null, string | null]> =>
      page.evaluate(() => [
        localStorage.getItem('jobs-unscored-open'),
        localStorage.getItem('jobs-excluded-open'),
      ]);
    const archiveScored = async (): Promise<void> => {
      for (const key of scored) {
        await viaMenu(page, 'archive', key);
        await expect(row(page, key)).toHaveCount(0);
      }
    };
    // Both folded by the choice kept: only the scored rows show.
    await unscored.click();
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await expect(row(page, waiting)).toHaveCount(0);
    const choice = await kept();
    await archiveScored();
    // Nothing else would show: both stand open, locked, the choice untouched.
    for (const divider of [unscored, excludedOnes]) {
      await expect(divider).toHaveAttribute('aria-expanded', 'true');
      await expect(divider).toBeDisabled();
      await expectNoAnswer(page, divider);
      await divider.click({ force: true });
      await expect(divider).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(row(page, waiting)).toBeVisible();
    await expect(row(page, out)).toBeVisible();
    expect(await kept()).toEqual(choice);
    // Other rows again: each as it was chosen, and its heading works.
    await page.getByTestId('toast-action').click();
    await expect(row(page, scored[0]!)).toBeVisible();
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await expect(excludedOnes).toHaveAttribute('aria-expanded', 'false');
    await expect(unscored).toBeEnabled();
    await expect(excludedOnes).toBeEnabled();
    // One section open by the choice: the only one with rows on screen is locked, a fold
    // beside it stays a fold.
    await excludedOnes.click();
    await expect(excludedOnes).toHaveAttribute('aria-expanded', 'true');
    await archiveScored();
    await expect(excludedOnes).toBeDisabled();
    await expect(unscored).toHaveAttribute('aria-expanded', 'false');
    await expect(unscored).toBeEnabled();
    await unscored.click();
    await expect(row(page, waiting)).toBeVisible();
  });

  test('the end of a search brings the open job back into view, as an order or a filter does', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 600 });
    await open(page, `${WIN}&scenario=many`);
    const search = page.getByTestId('search');
    // A hit further down the whole list than its first page.
    const words = 'Familienunternehmen 602';
    const key = (await stubList(page, { search: words })).active[0]!;
    expect((await stubList(page, { limit: 120 })).active).not.toContain(key);
    await search.fill(words);
    await row(page, key).click();
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    // Esc in the search: the list loads as far as needed, the row stands in view with its mark.
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(row(page, key)).toBeVisible();
    await expect.poll(() => wholeInList(page, key)).toBe(true);
    await expectHighlightOn(page, key);
    // Its × and a chosen place do the same.
    for (const end of ['clear', 'place'] as const) {
      await search.fill(words);
      await expect(page.getByTestId('list-scroll')).toHaveJSProperty('scrollTop', 0);
      await expect(row(page, key)).toBeVisible();
      if (end === 'clear') await page.getByRole('button', { name: T.field.clear }).click();
      else await page.getByTestId('place-inbox').click();
      await expect(search).toHaveValue('');
      await expect.poll(() => wholeInList(page, key)).toBe(true);
      await expectHighlightOn(page, key);
    }
  });

  test('the open job behind a closed fold builds no rows when the list changes under it', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=many`);
    const words = 'Buchhaltung über Personaldienstleister 404';
    await page.getByTestId('search').fill(words);
    await excludedRows(page).first().click();
    const title = stage(page).getByTestId('reader-title');
    await expect(title).toBeVisible();
    const mounted = async (): Promise<number> => (await mountedKeys(page)).length;
    // The end of the search: its section goes back to the kept choice, the job stays open.
    await page.getByTestId('search').press('Escape');
    await expect.poll(mounted).toBe(60);
    await page.waitForTimeout(300);
    expect(await mounted()).toBe(60);
    await expect(title).toBeVisible();
    // Another order, another filter: the same.
    await chooseSort(page, 'match');
    await page.waitForTimeout(300);
    expect(await mounted()).toBeLessThanOrEqual(60);
    await chooseFilter(page, 'band-high');
    await page.waitForTimeout(300);
    expect(await mounted()).toBeLessThanOrEqual(60);
  });

  test('a hit opened from a section only the search holds open: without the search the kept choice returns', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Hamburg');
    await expect(excludedRows(page)).toHaveCount(1);
    await excludedRows(page).first().click();
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'false');
    // The section without a score too, once the choice folds it.
    const waiting = page.getByTestId('unscored-divider');
    await waiting.click();
    await expect(waiting).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('search').fill('Hamburg');
    // The search's hits first: a row it does not find would close again when its answer comes.
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { search: 'Hamburg' }));
    await page.getByTestId('unscored-rows').locator('[data-testid^="job-row-"]').first().click();
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(page.getByTestId('search')).toHaveValue('');
    await expect(waiting).toHaveAttribute('aria-expanded', 'false');
  });

  test('a search or a filter without a hit stands until the next answer: nothing blinks beside the typing', async ({
    page,
  }) => {
    /** Every frame from now on, what it shows of the empty state and beside it. */
    const watch = (): Promise<void> =>
      page.evaluate(() => {
        const frames = new Set<string>();
        (window as unknown as { frames_: Set<string> }).frames_ = frames;
        const has = (id: string): boolean =>
          document.querySelector(`[data-testid="${id}"]`) !== null;
        const look = (): void => {
          const rows = document.querySelector('[data-testid^="job-row-"]') !== null;
          const none = has('empty-search') || has('empty-filter');
          frames.add(
            `${none ? 'none' : rows ? 'rows' : 'blank'}${has('place-reader') ? '+tile' : ''}`,
          );
          requestAnimationFrame(look);
        };
        look();
      });
    const seen = (): Promise<string[]> =>
      page.evaluate(() => [...(window as unknown as { frames_: Set<string> }).frames_]);
    await open(page, `${WIN}&scenario=slow`);
    const search = page.getByTestId('search');
    const none = page.getByTestId('empty-search');
    await search.fill('zzz');
    await expect(none.locator('h3')).toHaveText(T.list.noHit('zzz'));
    await watch();
    // One more letter: the state stands, it speaks of the answer it has until the next comes.
    await search.fill('zzzz');
    await expect.poll(async () => (await lastQuery(page))?.search).toBe('zzzz');
    await expect(none.locator('h3')).toHaveText(T.list.noHit('zzzz'));
    await expect(list(page)).toHaveAttribute('aria-busy', 'false');
    expect(await seen()).toEqual(['none']);
    // The search taken off: the rows take its place at once, with the tile beside them.
    await watch();
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(rows(page).first()).toBeVisible();
    expect((await seen()).sort()).toEqual(['none', 'rows+tile']);
    // A filter that leaves nothing, taken off: the same.
    await chooseFilter(page, 'portal-hays');
    const emptied = page.getByTestId('empty-filter');
    await expect(emptied).toBeVisible();
    await watch();
    await emptied.getByTestId('filter-reset').click();
    await expect(rows(page).first()).toBeVisible();
    expect((await seen()).sort()).toEqual(['none', 'rows+tile']);
  });

  test('hits here and elsewhere: a button per other place under the rows, which goes there with the search', async ({
    page,
  }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    await search.fill('Leitung');
    const also = page.getByTestId('also-in');
    await expect(also.getByRole('button')).toHaveText([T.place.archive, T.place.trash]);
    const last = (await rows(page).last().boundingBox())!;
    expect((await also.boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height);
    await page.getByTestId('also-trash').click();
    await expect(page.getByTestId('place-trash')).toHaveAttribute('aria-current', 'page');
    await expect(search).toHaveValue('Leitung');
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { place: 'trash', search: 'Leitung' }));
  });

  test('hits elsewhere are a button under an empty search that goes there', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const button = page.getByTestId('also-archive');
    // Named like its place.
    await expect(button.locator('.label')).toHaveText(T.place.archive);
    await expect(page.getByTestId('empty-search').getByTestId('also-archive')).toBeVisible();
    // The one way on stands under the sentence of the empty state.
    const sentence = (await page.getByTestId('empty-search').locator('p').boundingBox())!;
    expect((await button.boundingBox())!.y).toBeGreaterThanOrEqual(sentence.y + sentence.height);
    // The reader beside a search without hits has nothing to choose from: it says nothing.
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    await button.click();
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(rows(page)).toHaveCount(1);
  });

  test('the hits elsewhere follow the filter, as the other place lists them', async ({ page }) => {
    await open(page, WIN);
    // The archived job is a linkedin one: another portal's filter hides it there too.
    await chooseFilter(page, 'portal-freelance');
    await page.getByTestId('search').fill('Kreditoren');
    await expect(page.getByTestId('empty-search')).toBeVisible();
    await expect(page.getByTestId('also-archive')).toHaveCount(0);
    await chooseFilter(page, 'portal-linkedin');
    await expect(page.getByTestId('also-archive')).toBeVisible();
    await page.getByTestId('also-archive').click();
    await expect(row(page, 'linkedin-4100200306')).toBeVisible();
  });

  test('a button of hits elsewhere leads to hits, also from the Papierkorb under a kept filter', async ({
    page,
  }) => {
    await open(page, WIN);
    // The archived job is a linkedin one: the Archiv does not list it under this filter, though
    // the Papierkorb (no filter of its own) searches without it.
    await chooseFilter(page, 'portal-freelance');
    await openPlace(page, 'trash');
    await page.getByTestId('search').fill('Kreditoren');
    await expect(page.getByTestId('empty-search')).toBeVisible();
    expect(
      await inbox(page, { place: 'archive', search: 'Kreditoren', portals: ['freelance'] }),
    ).toEqual([]);
    await expect(page.getByTestId('also-archive')).toHaveCount(0);
    // What Aktuell lists under the filter is named, and its button leads there.
    await page.getByTestId('search').fill('SAP');
    const hits = await inbox(page, { search: 'SAP', portals: ['freelance'] });
    expect(hits.length).toBeGreaterThan(0);
    await page.getByTestId('also-inbox').click();
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => listed(page)).toEqual(hits);
  });

  test('the Papierkorb has no filter: under one its hits are still named', async ({ page }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-freelance');
    await page.getByTestId('search').fill('Bau');
    const none = page.getByTestId('empty-search');
    await expect(none).toBeVisible();
    // Its one job with the word is a freelancermap one, and it lists it whatever the filter.
    expect(await inbox(page, { place: 'trash', search: 'Bau' })).toEqual(['freelancermap-2809']);
    await expect(none.getByTestId('also-trash')).toHaveText(T.place.trash);
  });

  test('a job moved under a filter: the place it went to is named at once, its undo takes that back', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-freelance');
    await page.getByTestId('search').fill('SAP');
    const hits = await inbox(page, { search: 'SAP', portals: ['freelance'] });
    await expect.poll(() => listed(page)).toEqual(hits);
    const trash = page.getByTestId('also-trash');
    await expect(trash).toHaveCount(0);
    await viaMenu(page, 'trash', hits[0]!);
    await expect(trash).toBeVisible();
    await page.getByTestId('toast-action').click();
    await expect(row(page, hits[0]!)).toBeVisible();
    await expect(trash).toHaveCount(0);
  });

  test('the hits elsewhere never show an old answer', async ({ page }) => {
    // Every answer of the backend takes its time here.
    await open(page, `${WIN}&scenario=slow`);
    await chooseFilter(page, 'portal-freelance');
    const search = page.getByTestId('search');
    const trash = page.getByTestId('also-trash');
    await search.fill('Bau');
    await expect(trash).toBeVisible();
    // Another word: the button goes with the word, not with the word's answer.
    const stayed = await search.evaluate(async (field) => {
      const input = field as HTMLInputElement;
      input.value = 'Kernfusion';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      return document.querySelector('[data-testid="also-trash"]') !== null;
    });
    expect(stayed).toBe(false);
    await expect.poll(async () => (await lastQuery(page))?.search).toBe('Kernfusion');
    await expect(list(page)).toHaveAttribute('aria-busy', 'false');
    await expect(trash).toHaveCount(0);
    // The answer to a word typed over comes too late to show: the next word is typed as soon as
    // the question of the one before has gone out, long before its answer.
    const came = await search.evaluate(async (field) => {
      const type = (word: string): void => {
        (field as HTMLInputElement).value = word;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const until = (done: () => boolean): Promise<void> =>
        new Promise((resolve) => {
          const look = setInterval(() => {
            if (!done()) return;
            clearInterval(look);
            resolve();
          }, 5);
        });
      const asked = (word: string): boolean =>
        window.__harness.calls.some(
          ([name, args]) =>
            name === 'list_jobs' && (args as { query: JobQuery }).query.search === word,
        );
      let shown = false;
      const watch = new MutationObserver(() => {
        shown ||= document.querySelector('[data-testid^="also-"]') !== null;
      });
      watch.observe(document.body, { childList: true, subtree: true });
      type('BAU');
      await until(() => asked('BAU'));
      type('Kernspaltung');
      await until(() => asked('Kernspaltung'));
      await until(
        () =>
          document.querySelector('[data-testid="job-list"]')?.getAttribute('aria-busy') === 'false',
      );
      watch.disconnect();
      return shown;
    });
    expect(came).toBe(false);
  });

  test('one more question only while a search looks under a filter', async ({ page }) => {
    await open(page, WIN);
    const searches = async (): Promise<JobQuery[]> =>
      (await calls(page, 'list_jobs'))
        .map(([, args]) => (args as { query: JobQuery }).query)
        .filter((query) => query.limit === 0 && query.search !== null);
    await page.getByTestId('search').fill('SAP');
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { search: 'SAP' }));
    expect(await searches()).toEqual([]);
    // Under a filter it asks what the Papierkorb lists, which has none.
    await chooseFilter(page, 'portal-freelance');
    await expect.poll(async () => (await searches()).at(-1)?.portals).toEqual([]);
    // In the Papierkorb what Aktuell and the Archiv list, under the filter.
    await page.getByTestId('place-trash').click();
    await page.getByTestId('search').fill('Bau');
    await expect.poll(async () => (await searches()).at(-1)?.portals).toEqual(['freelance']);
    await expect.poll(async () => (await searches()).at(-1)?.search).toBe('Bau');
    // Without a search none.
    const asked = (await searches()).length;
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(page.getByTestId('search')).toHaveValue('');
    await settle(page);
    expect(await searches()).toHaveLength(asked);
  });

  test('a second click keeps the open job; a search that no longer finds it closes it', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await row(page, 'freelancermap-2801').click();
    await expect(row(page, 'freelancermap-2801')).toHaveAttribute('aria-current', 'true');
    await page.getByTestId('search').fill('Kernfusion');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });

  test("the search's own answer judges the open job, not a change of the list while it waits", async ({
    page,
  }) => {
    await slowSearch(page, 4000);
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await page.getByTestId('search').fill('Kernfusion');
    // While the search waits another job leaves the list (its row is still there).
    await viaMenu(page, 'archive', 'freelancermap-2805');
    await expect(page.getByTestId('empty-search')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });
});

/* ======================================================================== moves */

test.describe('moves and undo', () => {
  test('archive from the row: short toasts that merge, one undo, Zurückholen', async ({ page }) => {
    await open(page, WIN);
    // One word, no title.
    await viaMenu(page, 'trash', 'freelancermap-2805');
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.trashed);
    await page.getByTestId('toast-action').click();
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await viaMenu(page, 'archive', key);
      await expect(row(page, key)).toHaveCount(0);
    }
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await expect(page.getByTestId('toast-text')).toHaveText(T.toast.archived);
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2802')).toHaveCount(1);
    await expect(row(page, 'freelancermap-2803')).toHaveCount(1);
    await viaMenu(page, 'archive', 'freelancermap-2802');
    await openPlace(page, 'archive');
    await viaMenu(page, 'unarchive', 'freelancermap-2802');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.unarchived);
    await openPlace(page, 'inbox');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(1);
  });

  test('the Papierkorb: restore, and delete for good job by job, asking first', async ({
    page,
  }) => {
    await open(page, WIN);
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await viaMenu(page, 'trash', key);
    }
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.trashed);
    await openPlace(page, 'trash');
    await expect(page.getByTestId('place-reader')).toContainText(T.reader.pickJob);
    // No "Papierkorb leeren": deleting for good goes job by job.
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
    await viaMenu(page, 'restore', 'freelancermap-2802');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.restored);
    // Endgültig löschen asks first: the job by its title, what it means, and "Löschen".
    const title = await row(page, 'freelancermap-2803').locator('.title').innerText();
    await viaMenu(page, 'purge', 'freelancermap-2803');
    const dialog = page.getByTestId('dialog-purge');
    await expect(dialog.getByRole('heading')).toHaveText(T.reader.purgeHeading);
    await expect(dialog).toContainText(T.reader.purgeText(title));
    await dialog.getByRole('button', { name: T.reader.purgeConfirm, exact: true }).click();
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.deleted);
    expect((await calls(page, 'purge_jobs')).map(([, args]) => args)).toEqual([
      { keys: [{ portal: 'freelancermap', id: '2803' }] },
    ]);
    expect(await calls(page, 'empty_trash')).toHaveLength(0);
  });

  test('deleting for good hands the focus on: the row below, then the place', async ({ page }) => {
    await open(page, WIN);
    await openPlace(page, 'trash');
    const keys = await listed(page);
    expect(keys.length).toBeGreaterThan(1);
    // Endgültig löschen of a row: after the dialog the focus is on the row below.
    for (const [index, key] of keys.entries()) {
      await viaMenu(page, 'purge', key);
      await page
        .getByTestId('dialog-purge')
        .getByRole('button', { name: T.reader.purgeConfirm, exact: true })
        .click();
      await expect(row(page, key)).toHaveCount(0);
      const next = keys[index + 1];
      if (next !== undefined) await expect(row(page, next)).toBeFocused();
    }
    // The last one went: the focus is on the Papierkorb in the sidebar, and the place says it is
    // empty, with no head.
    await expect(page.getByTestId('place-trash')).toBeFocused();
    await expectBarePlace(page, T.list.empty.trash);
  });

  test('a move from the keyboard hands the focus on too: the row below, then the place', async ({
    page,
  }) => {
    await open(page, WIN);
    await openPlace(page, 'archive');
    const keys = await listed(page);
    expect(keys.length).toBeGreaterThan(1);
    for (const [index, key] of keys.entries()) {
      await row(page, key).focus();
      await page.keyboard.press('Shift+F10');
      await expect(page.getByTestId('menu')).toBeVisible();
      await page.keyboard.type(T.actions.unarchive.slice(0, 4));
      await page.keyboard.press('Enter');
      await expect(row(page, key)).toHaveCount(0);
      const next = keys[index + 1];
      if (next !== undefined) await expect(row(page, next)).toBeFocused();
    }
    await expect(page.getByTestId('place-archive')).toBeFocused();
  });

  test('a move from the keyboard, the sidebar folded away: its button takes the focus for the place', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await open(page, WIN);
    await page.getByTestId('toggle-sidebar').click();
    await page.getByTestId('sidebar-floating').getByTestId('place-archive').click();
    await expect(page.getByTestId('sidebar-floating')).toHaveCount(0);
    await settle(page);
    const keys = await listed(page);
    for (const key of keys) {
      await row(page, key).focus();
      await page.keyboard.press('Shift+F10');
      await expect(page.getByTestId('menu')).toBeVisible();
      await page.keyboard.type(T.actions.unarchive.slice(0, 4));
      await page.keyboard.press('Enter');
      await expect(row(page, key)).toHaveCount(0);
    }
    await expect(page.getByTestId('toggle-sidebar')).toBeFocused();
  });

  test("with the places folded Jobs takes the focus for the place, not the sidebar's button", async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-places').click();
    await expect(page.getByTestId('place-inbox')).toHaveCount(0);
    // A button that goes with its list: the way to the hits in another place, from the keyboard.
    const search = page.getByTestId('search');
    await search.fill('Kreditoren');
    await page.getByTestId('also-archive').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('also-archive')).toHaveCount(0);
    await expect(page.getByTestId('nav-jobs')).toBeFocused();
    // The place's last job moved away from the keyboard.
    await search.fill('');
    const keys = (await stubList(page, { place: 'archive' })).active;
    await expect.poll(() => listed(page)).toEqual(keys);
    for (const key of keys) {
      await row(page, key).focus();
      await page.keyboard.press('Shift+F10');
      await expect(page.getByTestId('menu')).toBeVisible();
      await page.keyboard.type(T.actions.unarchive.slice(0, 4));
      await page.keyboard.press('Enter');
      await expect(row(page, key)).toHaveCount(0);
    }
    await expect(page.getByTestId('nav-jobs')).toBeFocused();
  });

  test('a click on a move hands no focus on, by a tool or by the menu', async ({ page }) => {
    await open(page, WIN);
    const [first, second, third, fourth] = await listed(page);
    // A press opens the job and leaves no focus on its row.
    await row(page, first!).click();
    await expect(page.getByTestId('reader-title')).toBeVisible();
    // Its menu: the next job opens, its row takes no focus.
    await viaMenu(page, 'archive', first!);
    await expect(row(page, first!)).toHaveCount(0);
    await expect(row(page, second!)).toHaveAttribute('aria-current', 'true');
    await expect(row(page, second!)).not.toBeFocused();
    // The tool of a row that is not the open one.
    await row(page, third!).hover();
    await row(page, third!).locator('xpath=..').getByTestId('tool-archive').click();
    await expect(row(page, third!)).toHaveCount(0);
    await expect(row(page, fourth!)).not.toBeFocused();
    // A row that holds the focus keeps it while another one moves, by the keyboard too.
    await row(page, fourth!).focus();
    await viaMenu(page, 'archive', second!);
    await expect(row(page, second!)).toHaveCount(0);
    await expect(row(page, fourth!)).toBeFocused();
    const [fifth, sixth] = (await listed(page)).filter((key) => key !== fourth);
    await rowMenu(page, fifth!);
    await page.keyboard.type(T.actions.archive.slice(0, 4));
    await page.keyboard.press('Enter');
    await expect(row(page, fifth!)).toHaveCount(0);
    await expect(row(page, fourth!)).toBeFocused();
    await expect(row(page, sixth!)).not.toBeFocused();
  });

  test.describe('Rückgängig brings a row back the way it left', () => {
    /** What each frame paints from now on: a row's top and the highlight's top and height. */
    interface Painted {
      y: number | null;
      tintY: number;
      tint: number;
    }
    const watch = async (page: Page, key: string): Promise<() => Promise<Painted[]>> => {
      await page.evaluate((key) => {
        const log: Painted[] = [];
        (window as unknown as { painted: Painted[] }).painted = log;
        // After the frame, in a task of its own: the highlight follows in the frame's own layout.
        const after = new MessageChannel();
        after.port1.onmessage = (): void => {
          const row = document.querySelector(`[data-testid="job-row-${key}"]`);
          const bar = document.querySelector('[data-testid="row-bar"]')!.getBoundingClientRect();
          log.push({
            y: row === null ? null : row.getBoundingClientRect().y,
            tintY: bar.y,
            tint: bar.height,
          });
        };
        const frame = (): void => {
          after.port2.postMessage(0);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }, key);
      return () => page.evaluate(() => (window as unknown as { painted: Painted[] }).painted);
    };
    /** The unfolding, long enough to count its frames on a busy machine. */
    const slowly = (page: Page): Promise<void> => setToken(page, '--dur-base', '600ms');
    const undo = (page: Page): Promise<void> => page.getByTestId('toast-action').last().click();
    const archiveByTool = async (page: Page, key: string): Promise<void> => {
      await row(page, key).hover();
      await row(page, key).locator('xpath=..').getByTestId('tool-archive').click();
      await expect(row(page, key)).toHaveCount(0);
      await motionSettled(page);
    };
    /** The rows' tops of the frames from where it starts to move: never back, and through at
     *  least three places on the way. */
    const glided = (tops: number[], distance: number): void => {
      const start = tops[0]!;
      const places = new Set(tops);
      for (const [at, top] of tops.entries()) {
        if (at > 0) expect(top).toBeGreaterThanOrEqual(tops[at - 1]!);
      }
      expect(tops.at(-1)).toBe(start + distance);
      expect(places.size).toBeGreaterThanOrEqual(5);
    };

    test('another job: the rows below glide, and the highlight stays on its row', async ({
      page,
    }) => {
      await slowly(page);
      await open(page, WIN);
      const [, gone, , opened] = await listed(page);
      await openJob(page, opened!);
      await archiveByTool(page, gone!);
      const before = (await row(page, opened!).boundingBox())!.y;
      const height = (await row(page, opened!).boundingBox())!.height;
      const frames = await watch(page, opened!);
      await undo(page);
      await expect(row(page, gone!)).toBeVisible();
      await motionSettled(page);
      const painted = await frames();
      expect(painted[0]!.y).toBe(before);
      glided(
        painted.map((frame) => frame.y!),
        height,
      );
      for (const frame of painted) {
        expect(Math.round(frame.tint)).toBe(height);
        expect(Math.abs(frame.tintY - frame.y!)).toBeLessThanOrEqual(1);
      }
    });

    test('the open job: the highlight stands at its full height while its row unfolds under it', async ({
      page,
    }) => {
      await slowly(page);
      await open(page, WIN);
      const [, gone, next] = await listed(page);
      await openJob(page, gone!);
      const height = (await row(page, gone!).boundingBox())!.height;
      await archiveByTool(page, gone!);
      await expect(row(page, next!)).toHaveAttribute('aria-current', 'true');
      await motionSettled(page);
      const place = (await row(page, next!).boundingBox())!.y;
      const frames = await watch(page, next!);
      await undo(page);
      await expect(row(page, gone!)).toHaveAttribute('aria-current', 'true');
      await motionSettled(page);
      await expectHighlightOn(page, gone!);
      const painted = await frames();
      // The next row glides away from under it: no snap.
      glided(
        painted.map((frame) => frame.y!),
        height,
      );
      // The highlight never moves and never changes its height.
      for (const frame of painted) {
        expect(Math.round(frame.tint)).toBe(height);
        expect(Math.round(frame.tintY)).toBe(Math.round(place));
      }
    });

    test('the open job, with another job opened since: the highlight glides there, one height', async ({
      page,
    }) => {
      await slowly(page);
      await open(page, WIN);
      const [, gone, , further] = await listed(page);
      await openJob(page, gone!);
      const height = (await row(page, gone!).boundingBox())!.height;
      await archiveByTool(page, gone!);
      await openJob(page, further!);
      const frames = await watch(page, further!);
      await undo(page);
      await expect(row(page, gone!)).toHaveAttribute('aria-current', 'true');
      await motionSettled(page);
      await expectHighlightOn(page, gone!);
      const painted = await frames();
      for (const [at, frame] of painted.entries()) {
        expect(Math.round(frame.tint)).toBe(height);
        if (at > 0) expect(frame.tintY).toBeLessThanOrEqual(painted[at - 1]!.tintY + 1);
      }
    });

    test('a day comes back with its last row, heading and all', async ({ page }) => {
      await slowly(page);
      await open(page, WIN);
      const { active } = await stubList(page);
      const days = page.getByTestId('day-heading');
      const count = await days.count();
      // The rows of the second day: two moves of different kinds, so each has its own toast.
      const day = days.nth(1).locator('xpath=..');
      const keys = await day
        .locator('[data-key]')
        .evaluateAll((items) =>
          items.map((item) => (item as HTMLElement).dataset.key!.replace(':', '-')),
        );
      expect(keys.length).toBe(2);
      const next = active[active.indexOf(keys[1]!) + 1]!;
      await viaMenu(page, 'trash', keys[0]!);
      await expect(row(page, keys[0]!)).toHaveCount(0);
      await motionSettled(page);
      await archiveByTool(page, keys[1]!);
      await expect(days).toHaveCount(count - 1);
      const frames = await watch(page, next);
      await undo(page);
      await expect(days).toHaveCount(count);
      await motionSettled(page);
      const painted = await frames();
      const tops = painted.map((frame) => frame.y!);
      const height = tops.at(-1)! - tops[0]!;
      glided(tops, height);
      // The heading comes with the row.
      expect(height).toBeGreaterThan((await row(page, keys[1]!).boundingBox())!.height);
    });
  });

  test('the last job of a place goes: no head; its undo brings the list and the head back', async ({
    page,
  }) => {
    await open(page, WIN);
    await openPlace(page, 'archive');
    const keys = await listed(page);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      await viaMenu(page, 'unarchive', key);
      await expect(row(page, key)).toHaveCount(0);
    }
    await expectBarePlace(page, T.list.empty.archive);
    await page.getByTestId('toast-action').click();
    await expect.poll(() => listed(page)).toEqual(keys);
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  });

  test('deleting for good waits for a run: its menu entry says why', async ({ page }) => {
    await open(page, WIN);
    await viaMenu(page, 'trash', 'linkedin-4100200303');
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await openPlace(page, 'trash');
    await rowMenu(page, 'linkedin-4100200303');
    await expect(menuItem(page, 'purge')).toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'purge').hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.error.text('busy', { activity: 'fetch' }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
  });

  test('the open job moved away: the next job opens and is read once looked at', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    await viaMenu(page, 'archive', 'linkedin-4100200301');
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
    await expect(page.getByTestId('reader-title')).toHaveText('SAP S/4HANA Finance Projektleitung');
    const read = async (): Promise<boolean> =>
      (await calls(page, 'mark_read')).some(
        ([, args]) => (args as { key: { id: string } }).key.id === '900411',
      );
    expect(await read()).toBe(false);
    await page.getByTestId('reader-title').click();
    await expect.poll(read).toBe(true);
  });

  test('an undo toast stays longer and takes back the moves merged into it', async ({ page }) => {
    await open(page, WIN);
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await viaMenu(page, 'archive', 'linkedin-4100200302');
    const archived = page.getByTestId('toast').filter({ hasText: T.toast.archived });
    await expect(archived).toHaveCount(1);
    // Still up after the 4 s of a plain toast.
    await page.waitForTimeout(4500);
    await archived.getByTestId('toast-action').click();
    await expect(row(page, 'linkedin-4100200302')).toBeVisible();
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
    // The trash has a toast of its own: it stays.
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-action')).toHaveCount(1);
  });

  test('the undo brings the open job back and opens it; one it did not take opens nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    await page.getByTestId('reader-trash').click();
    await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'linkedin-4100200301')).toBeVisible();
    await expect(page.getByTestId('reader-title')).toContainText(
      'Head of Controlling Transformation',
    );
    const back = (await calls(page, 'move_back')).at(-1)?.[1] as { jobs: { to: string }[] };
    expect(back.jobs.map(({ to }) => to)).toEqual(['inbox']);
    await page.getByTestId('toggle-reader').click();
    await page.getByTestId('toggle-reader').click();
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });

  test('a move or an undo that fails says so in the header until the next list', async ({
    page,
  }) => {
    await open(page, WIN);
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await failNext(page, 'move_back');
    await page.getByTestId('toast-action').click();
    const error = page.getByTestId('header-error');
    await expect(error).toHaveText(T.error.text('db', {}));
    await openPlace(page, 'archive');
    await expect(error).toHaveCount(0);
    await openPlace(page, 'inbox');
    await failNext(page, 'move_jobs');
    await viaMenu(page, 'archive', 'linkedin-4100200301');
    await expect(error).toHaveText(T.error.text('db', {}));
  });

  test('deleting a job for good keeps the undo of another one', async ({ page }) => {
    await open(page, WIN);
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await openPlace(page, 'trash');
    await viaMenu(page, 'purge', 'freelancermap-2802');
    await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
    await expect(
      page.getByTestId('toast-text').getByText(T.toast.deleted, { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('toast-action')).toHaveCount(1);
    await expect(page.getByTestId('dialog-purge')).toHaveCount(0);
    await page.getByTestId('toast-action').click();
    await expect(page.getByTestId('toast-action')).toHaveCount(0);
    await openPlace(page, 'inbox');
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
  });
});

/* ===================================================================== run line */

test.describe('run line', () => {
  test('a fetch: the strip under the header, its step and its count, then a toast of what it brought', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=60`);
    // The rows already there stay the same elements while the run brings new ones.
    await rows(page)
      .first()
      .evaluate((node) => ((node as HTMLElement).dataset['kept'] = 'yes'));
    const before = await listed(page);
    await page.getByTestId('fetch').click();
    const line = page.getByTestId('run-line');
    await expect(line).toBeVisible();
    await expect(line.getByTestId('run-meter')).toHaveAttribute('role', 'progressbar');
    // Under the search, in the header.
    const search = (await page.getByTestId('search').boundingBox())!;
    expect((await line.boundingBox())!.y).toBeGreaterThan(search.y + search.height);
    await expect(page.getByTestId('list-header').getByTestId('run-line')).toHaveCount(1);
    // The step in the catalog's words, without a count; how far it is at the right.
    const steps = new Set<string>();
    const counts = new Set<string>();
    const step = page.getByTestId('run-step');
    const count = line.locator('.count');
    await expect
      .poll(
        async () => {
          steps.add((await step.textContent()) ?? '');
          if ((await count.count()) > 0) counts.add((await count.textContent()) ?? '');
          return steps.has(T.run.line.ads);
        },
        { intervals: [20], timeout: 10_000 },
      )
      .toBe(true);
    // The count moves on in place: the same element, only the number changes (no blink).
    await expect(count).toHaveText(/^\d+ von \d+$/);
    await count.evaluate((node) => ((node as HTMLElement).dataset['kept'] = 'yes'));
    const counted = (await count.textContent()) ?? '';
    await expect
      .poll(async () => (await count.textContent()) ?? '', { intervals: [10], timeout: 10_000 })
      .not.toBe(counted);
    if ((await count.count()) > 0) await expect(count).toHaveAttribute('data-kept', 'yes');
    // The portals run side by side: never named; no "Bisher" line (the end toast says it).
    const words = [T.run.line.mailbox, T.run.line.portals, T.run.line.ads, T.run.line.scoring];
    for (const text of steps) expect(words, text).toContain(text);
    for (const text of counts) expect(text).toMatch(/^\d+ von \d+$/);
    await expect(page.getByTestId('run-new')).toHaveCount(0);
    await expect.poll(async () => (await listed(page)).length).toBeGreaterThan(before.length);
    await expect(list(page).locator('[data-kept="yes"]')).toHaveCount(1);
    await runFinished(page);
    await expect(line).toHaveCount(0);
    // Two new jobs (the third is excluded), one of the high band; its way lists them.
    const toast = page.getByTestId('toast').filter({ hasText: T.toast.runDone(2, 1) });
    await expect(toast).toHaveCount(1);
    await expect(toast.getByTestId('toast-action')).toHaveText(T.toast.show);
    // The run re-sorts the list once it has finished: the new jobs in their places.
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    // One word for one, the plural for more; none at 0, with the excluded ones counted.
    expect([
      T.toast.runDone(0),
      T.toast.runDone(0, 0, 3),
      T.toast.runDone(1),
      T.toast.runDone(2, 1),
    ]).toEqual([
      'Keine neuen passenden Jobs',
      'Keine neuen passenden Jobs, 3 ausgeschlossen',
      '1 neuer Job',
      '2 neue Jobs, 1 mit hoher Übereinstimmung',
    ]);
  });

  test('elsewhere the end toast leads to the list', async ({ page }) => {
    await open(page, `${WIN}&tick=15`);
    await page.getByTestId('fetch').click();
    await page.getByTestId('nav-settings').click();
    await runFinished(page);
    const toast = page.getByTestId('toast').filter({ hasText: T.toast.runDone(2, 1) });
    await toast.getByTestId('toast-action').click();
    await expect(page.getByTestId('view-jobs')).toBeVisible();
  });

  test('a run that is on its way: the step and its count', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    await expect(page.getByTestId('run-step')).toHaveText(T.run.line.ads);
    await expect(page.getByTestId('run-line').locator('.count')).toHaveText(T.run.line.count(5, 7));
    // The bar: the portals' half is done, then the ads (5 of 7) fill their share.
    await expect(page.getByTestId('run-meter')).toHaveAttribute('aria-valuenow', '79');
    await expect(page.getByTestId('cancel-run')).toBeVisible();
  });

  test('a rescore after a save: Jobs werden neu bewertet, with Abbrechen', async ({ page }) => {
    await open(page, `${WIN}&scenario=rescoring`);
    await expect(page.getByTestId('run-step')).toHaveText(T.run.line.rescore);
    await expect(page.getByTestId('run-line').locator('.count')).toHaveText(T.run.line.count(3, 8));
    // The bar follows its count: a rescore is this one step.
    await expect(page.getByTestId('run-meter')).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((3 / 8) * 100)),
    );
    await expect(page.getByTestId('cancel-run')).toBeVisible();
    await expect(page.getByTestId('fetch')).toHaveCount(0);
    await page.getByTestId('cancel-run').click();
    expect(await calls(page, 'cancel_run')).toHaveLength(1);
  });

  test('a search that waits for a sign-in says so, with Anmelden', async ({ page }) => {
    await open(page, `${WIN}&scenario=sign-in-waiting`);
    await expect(page.getByTestId('run-step')).toHaveText(T.run.line.waiting(T.portal.freelance));
    const signIn = page.getByTestId('run-sign-in');
    await expect(signIn).toHaveText(T.run.line.signIn);
    await signIn.click();
    await expect
      .poll(async () => (await calls(page, 'portal_login')).at(-1)?.[1])
      .toEqual({ portal: 'freelance' });
  });

  test('two runs in a row end idle; a rescore of the app shows its strip, no fetch', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    for (const round of [1, 2]) {
      await page.getByTestId('fetch').click();
      await runFinished(page);
      await expect(page.getByTestId('run-line'), `run ${round}`).toHaveCount(0);
      await expect(page.getByTestId('fetch'), `run ${round}`).toBeVisible();
    }
    expect(await calls(page, 'start_run')).toHaveLength(2);
    await open(page, `${WIN}&tick=15`);
    await page.getByTestId('nav-profile').click();
    await page.evaluate(() => window.__harness.appRun('rescore'));
    await runFinished(page);
    await page.getByTestId('nav-jobs').click();
    await expect(page.getByTestId('run-line')).toHaveCount(0);
    expect(await calls(page, 'start_run')).toHaveLength(0);
  });

  test('under reduced motion a run without progress still shows its bar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, `${WIN}&tick=3000`);
    await page.getByTestId('fetch').click();
    const bar = page.getByTestId('run-meter');
    await expect(bar).toBeVisible();
    const inside = await bar.evaluate((track) => {
      const fill = track.firstElementChild!.getBoundingClientRect();
      const box = track.getBoundingClientRect();
      return fill.width > 0 && fill.left >= box.left - 1 && fill.right <= box.right + 1;
    });
    expect(inside).toBe(true);
    await page.getByTestId('cancel-run').click();
    await runFinished(page);
  });
});

/* ====================================================================== sidebar */

test.describe('sidebar', () => {
  test('three views, the places under Jobs, no counts, no tooltips beside their names; the app starts in Jobs', async ({
    page,
  }) => {
    await open(page, `${WIN}&view=start`);
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    const sidebar = page.getByTestId('sidebar');
    // The views, and under Jobs its places, like a mailbox's folders.
    await expect(sidebar.locator('nav button:not([aria-expanded])')).toHaveText([
      T.nav.jobs,
      T.place.inbox,
      T.place.archive,
      T.place.trash,
      T.nav.profile,
      T.nav.settings,
    ]);
    await expect(sidebar.locator('nav .count, nav .dot')).toHaveCount(0);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await page.getByTestId('nav-jobs').hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // Ctrl+B and Cmd+B change nothing (no keys of the app); a narrow window folds it away.
    await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Meta+b');
    await expect(sidebar).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(sidebar).toHaveCount(0);
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(sidebar).toBeVisible();
  });

  for (const os of [WIN, MAC]) {
    test(`the floating sidebar keeps every entry in the window at 480 x 360 ${os}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 480, height: 360 });
      await open(page, os);
      await page.getByTestId('toggle-sidebar').click();
      for (const id of [
        'nav-jobs',
        'place-inbox',
        'place-archive',
        'place-trash',
        'nav-profile',
        'nav-settings',
      ]) {
        await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
      }
    });
  }

  test('a place chosen in the floating sidebar opens, and it folds again', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await open(page, WIN);
    await page.getByTestId('toggle-sidebar').click();
    await page.getByTestId('place-archive').click();
    await expect(page.getByTestId('sidebar-floating')).toHaveCount(0);
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  });

  test('a value that is wrong keeps the Profil until the question is answered; a place waits for it', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-profile').click();
    const wish = page.getByTestId('profile-wish-rate');
    await wish.fill('0');
    await page.getByTestId('nav-jobs').click();
    const dialog = page.getByTestId('dialog-leave-profile');
    await expect(dialog).toContainText(T.profile.leaveHeading);
    await dialog.getByRole('button', { name: T.common.cancel }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
    await expect(wish).toHaveValue('0');
    // A place of the sidebar asks the same and opens once it is answered.
    await page.getByTestId('place-archive').click();
    await dialog.getByRole('button', { name: T.profile.discard }).click();
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
  });

  test('a value that is right is saved on the way to a place, which opens at once', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('profile-wish-rate').fill('1.300');
    await page.getByTestId('place-archive').click();
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => window.__harness.form()?.dayRateWish)).toBe(1300);
  });
});

/* ================================================================ small windows */

test('the list column: never narrower as the window grows; at 480 x 360 the toolbar fits', async ({
  page,
}) => {
  await open(page, WIN);
  // The splitter's hit strip starts on the list's border and never lies over its scrollbar.
  const hit = (await page.getByTestId('list-splitter').locator('.hit').boundingBox())!;
  const scroll = (await page.getByTestId('list-scroll').boundingBox())!;
  const edge = scroll.x + scroll.width;
  expect(hit.x).toBeGreaterThanOrEqual(edge - 0.5);
  expect(hit.x).toBeLessThanOrEqual(edge + 1.5);
  // The column (as its handle says it) never gets narrower while the window grows, across
  // the rail too.
  const listWidth = async (): Promise<number> => {
    await settle(page);
    return Number(await page.getByTestId('list-splitter').getAttribute('aria-valuenow'));
  };
  let last = 0;
  for (const width of [920, 1000, 1060, 1099, 1100, 1130, 1160, 1250, 1360, 1600, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(listWidth).toBeGreaterThanOrEqual(last);
    last = await listWidth();
  }
  // The smallest window: the header and the chips stay in it; below 900 px one column.
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await chooseFilter(page, 'portal-linkedin');
  for (const id of ['search', 'filter', 'fetch', 'chip-portal-linkedin']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width, id).toBeLessThanOrEqual(480);
  }
  await page.setViewportSize({ width: 780, height: 560 });
  await expect(page.getByTestId('reader-pane')).toBeHidden();
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('list-scroll')).toBeHidden();
  await page.getByTestId('history-back').click();
  await expect(page.getByTestId('list-scroll')).toBeVisible();
});

/* ============================================================== what the audit found */

// Logic of the list found by the audit of 2026-10-30: each test says in its name what a user
// must be able to rely on.

test.describe('the list keeps true', () => {
  /** The key of the open row, as `portal-id` (null: none is marked). */
  const openKeyOf = (page: Page): Promise<string | null> =>
    list(page).evaluate(
      (node) =>
        node.querySelector<HTMLElement>('[data-open]')?.dataset['key']?.replace(':', '-') ?? null,
    );

  test('an undo of another place takes its row out of that list and opens the next job', async ({
    page,
  }) => {
    await open(page, WIN);
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await openPlace(page, 'archive');
    await openJob(page, 'freelancermap-2803');
    const { active } = await stubList(page, { place: 'archive' });
    const at = active.indexOf('freelancermap-2803');
    const next = active[at + 1]!;
    expect(next).toBeDefined();
    // Rückgängig of the toast of the archive, pressed in the Archiv itself.
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    // The open job left with it: the next row of the list opens, which is marked.
    await expect.poll(() => openKeyOf(page)).toBe(next);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(
      await row(page, next).locator('.title').innerText(),
    );
    await openPlace(page, 'inbox');
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
  });

  test('an undo that fails keeps its toast as a warning that offers to try again', async ({
    page,
  }) => {
    await open(page, WIN);
    await viaMenu(page, 'archive', 'freelancermap-2803');
    await failNext(page, 'move_back');
    await page.getByTestId('toast-action').click();
    const warning = page.getByTestId('toast').filter({ hasText: T.error.text('db', {}) });
    await expect(warning).toHaveCount(1);
    await expect(warning.getByTestId('toast-action')).toHaveText(T.common.retry);
    await warning.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('the job kept from the last start counts as read once it has been looked at', async ({
    page,
  }) => {
    await open(page, `${WIN}&open=freelance:900411`);
    const title = row(page, 'freelance-900411').locator('.title');
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    await expect(title).toHaveClass(/unread/);
    await expect(title).not.toHaveClass(/unread/);
    expect((await calls(page, 'mark_read')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelance', id: '900411' },
    });
  });

  test('a press on the open row counts as looked at: the job the app opened is read at once', async ({
    page,
  }) => {
    // Opened by itself after the job before it left, not yet read.
    await open(page, WIN);
    const [first, second] = await listed(page);
    await openJob(page, first!);
    await page.getByTestId('reader-archive').click();
    await expect(row(page, first!)).toHaveCount(0);
    await expect(page.locator('[data-open]')).toHaveAttribute(
      'data-key',
      second!.replace('-', ':'),
    );
    const title = row(page, second!).locator('.title');
    await expect(title).toHaveClass(/unread/);
    await row(page, second!).click();
    // Before its dwell of two seconds.
    await expect(title).not.toHaveClass(/unread/, { timeout: 1000 });
  });

  test('a second click, a slow double click, on the row that slid under a row tool opens nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    // The first row of the first day: the next row slides under the pointer.
    const first = (await listed(page))[0]!;
    await row(page, first).hover();
    const box = (await page.getByTestId('tool-trash').boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(300);
    // The engine counts the second press of the double click.
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await page.waitForTimeout(300);
    await expect(row(page, first)).toHaveCount(0);
    expect(await calls(page, 'job_detail')).toHaveLength(0);
    expect(await calls(page, 'mark_read')).toHaveLength(0);
    await expect(page.getByTestId('reader')).toHaveCount(0);
  });

  test('a click on another row right after a move opens it', async ({ page }) => {
    await open(page, WIN);
    const [first, , third] = await listed(page);
    await row(page, first!).hover();
    const other = (await row(page, third!).boundingBox())!;
    await page.getByTestId('tool-archive').click();
    await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);
    await expect.poll(async () => (await calls(page, 'job_detail')).length).toBe(1);
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
  });

  test('archiving the last row of Noch nicht bewertet opens the row above, not the folded Ausgeschlossen', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active, excluded: out } = await stubList(page);
    expect(out.length).toBeGreaterThan(0);
    const last = active.at(-1)!;
    const above = active.at(-2)!;
    await openJob(page, last);
    await page.getByTestId('reader-archive').click();
    await expect.poll(() => openKeyOf(page)).toBe(above);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a move during a search opens the row below, also in a section only the search holds open', async ({
    page,
  }) => {
    await open(page, WIN);
    // Ausgeschlossen is folded by its kept choice; the word has a hit in it, on screen.
    await page.getByTestId('search').fill('Hamburg');
    await expect(excludedRows(page)).toHaveCount(1);
    const { active, excluded: out } = await stubList(page, { search: 'Hamburg' });
    const last = active.at(-1)!;
    await openJob(page, last);
    await page.getByTestId('reader-archive').click();
    await expect(row(page, last)).toHaveCount(0);
    await expect.poll(() => openKeyOf(page)).toBe(out[0]);
  });

  test('a move during a search opens the row below, also where the kept choice folds its section', async ({
    page,
  }) => {
    await open(page, WIN);
    const divider = page.getByTestId('unscored-divider');
    await divider.click();
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('search').fill('Hamburg');
    // The search's hits first: a row it does not find would close again when its answer comes.
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { search: 'Hamburg' }));
    await expect(divider).toHaveAttribute('aria-expanded', 'true');
    const { jobs } = await stubList(page, { search: 'Hamburg' });
    const scored = jobs.filter((job) => job.match?.status === 'scored').map(keyOf);
    const waiting = jobs.filter((job) => job.match?.status === 'unscorable').map(keyOf);
    expect(scored.length).toBeGreaterThan(0);
    expect(waiting.length).toBeGreaterThan(0);
    await openJob(page, scored.at(-1)!);
    await page.getByTestId('reader-archive').click();
    await expect(row(page, scored.at(-1)!)).toHaveCount(0);
    await expect.poll(() => openKeyOf(page)).toBe(waiting[0]);
  });

  test('a row brought into view from below clears the sticky heading of its day', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 520 });
    await open(page, WIN);
    const keys = await listed(page);
    const [first, last] = [keys[0]!, keys.at(-1)!];
    const scroller = page.getByTestId('list-scroll');
    const heading = page.getByTestId('day-heading').first();
    /** The row's top is under the heading that sticks above it. */
    const expectClear = async (key: string): Promise<void> => {
      await expect
        .poll(async () => {
          const top = (await row(page, key).boundingBox())!.y;
          const end = (await heading.boundingBox())!;
          return top - (end.y + end.height);
        })
        .toBeGreaterThanOrEqual(0);
    };
    await row(page, first).click();
    await scroller.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await row(page, last).click();
    await page.getByTestId('history-back').click();
    await expect(page.locator('[data-open]')).toHaveAttribute('data-key', first.replace('-', ':'));
    await expectClear(first);
    // From the keyboard too: the focus moves up over a row the heading covers.
    await scroller.evaluate((node) => (node.scrollTop = node.scrollHeight));
    await row(page, keys[2]!).focus();
    await scroller.evaluate((node) => (node.scrollTop += 60));
    await page.keyboard.press('Shift+Tab');
    await expect(row(page, keys[1]!)).toBeFocused();
    await expectClear(keys[1]!);
  });

  test('folding the section of the open job takes the highlight away; unfolding brings it back', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active } = await stubList(page);
    await openJob(page, active.at(-1)!);
    const bar = page.getByTestId('row-bar');
    await expect(bar).toHaveClass(/\bshown\b/);
    const divider = page.getByTestId('unscored-divider');
    await divider.click();
    await expect(page.getByTestId('unscored-rows')).toHaveCount(0);
    await expect(bar).not.toHaveClass(/\bshown\b/);
    await divider.click();
    await expect(bar).toHaveClass(/\bshown\b/);
  });

  /** Notes every part of a list with its job view that stands in a frame drawn from now on,
   *  for `flashed` to read. */
  const watchFrames = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { flash: string[] }).flash = seen;
      const parts = [
        'list-header',
        'reader-pane',
        'place-reader',
        'list-skeleton',
        'list-splitter',
      ];
      const frame = (): void => {
        for (const id of parts) {
          if (document.querySelector(`[data-testid="${id}"]`) && !seen.includes(id)) {
            seen.push(id);
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  };
  const flashed = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { flash: string[] }).flash);

  for (const scenario of ['fresh', 'empty', 'archived']) {
    test(`a place without a job never shows a head or the two columns while its list loads (${scenario})`, async ({
      page,
    }) => {
      // Every frame that is drawn, until the list has answered.
      await watchFrames(page);
      await open(page, `${WIN}&scenario=${scenario}`);
      await expect(page.getByTestId('empty-all')).toBeVisible();
      await settle(page);
      expect(await flashed(page)).toEqual([]);
    });
  }

  test('an empty place chosen never shows a head or the two columns while its list loads', async ({
    page,
  }) => {
    await watchFrames(page);
    await open(page, `${WIN}&scenario=concept`);
    await expect(rows(page).first()).toBeVisible();
    // What the place with its jobs drew is over: only the frames from the click on count, so
    // the click and the clean slate come in one task.
    await page.getByTestId('place-archive').evaluate((entry) => {
      (entry as HTMLElement).click();
      (window as unknown as { flash: string[] }).flash.length = 0;
    });
    await expect(page.getByTestId('empty-all')).toBeVisible();
    await settle(page);
    expect(await flashed(page)).toEqual([]);
  });

  test('a long search without a space breaks inside the list', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('x'.repeat(300));
    const none = page.getByTestId('empty-search');
    await expect(none).toBeVisible();
    const scroll = page.getByTestId('list-scroll');
    const [text, column] = [(await none.boundingBox())!, (await scroll.boundingBox())!];
    expect(text.x + text.width).toBeLessThanOrEqual(column.x + column.width);
    expect(await scroll.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });

  test('the list and the open job keep their scroll place while another view is shown', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 420 });
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    const scroller = page.getByTestId('list-scroll');
    await scroller.evaluate((node) => node.scrollTo({ top: 120 }));
    await stage(page).evaluate((node) => node.scrollTo({ top: 200 }));
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(120);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await page.getByTestId('nav-jobs').click();
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(120);
    await expect.poll(() => stage(page).evaluate((node) => node.scrollTop)).toBe(200);
    // Another job, and the first again by a click, start at the top.
    await openJob(page, 'freelancermap-2802');
    expect(await stage(page).evaluate((node) => node.scrollTop)).toBe(0);
    await stage(page).evaluate((node) => node.scrollTo({ top: 150 }));
    await openJob(page, 'linkedin-4100200301');
    expect(await stage(page).evaluate((node) => node.scrollTop)).toBe(0);
  });

  test('Jobs and Aktuell lead to one place: both open it without the search', async ({ page }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    for (const entry of ['nav-jobs', 'place-inbox']) {
      await search.fill('Kreditoren');
      await expect.poll(async () => (await lastQuery(page))?.search).toBe('Kreditoren');
      await page.getByTestId(entry).click();
      await expect(search, entry).toHaveValue('');
    }
  });

  test('Trotzdem bewerten is not offered in the Papierkorb, neither in the menu nor in the job view', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    const key = 'linkedin-4100200305';
    await openJob(page, key);
    await expect(page.getByTestId('reader-include')).toBeVisible();
    await viaMenu(page, 'trash', key);
    await openPlace(page, 'trash');
    await openJob(page, key);
    await expect(stage(page).getByTestId('exclusion')).toBeVisible();
    await expect(page.getByTestId('reader-include')).toHaveCount(0);
    await rowMenu(page, key);
    await expect(menuItem(page, 'restore')).toBeVisible();
    await expect(menuItem(page, 'include')).toHaveCount(0);
  });
});

/* ==================================================================== baselines */

test('baseline: the jobs', async ({ page }) => {
  await open(page, WIN);
  await expectShot(page, 'jobs-list');
});

test('baseline: jobs while a run is going', async ({ page }) => {
  await open(page, `${WIN}&scenario=running`);
  await expectShot(page, 'jobs-running');
});

test('baseline: jobs at 780 x 560', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await open(page, WIN);
  await expectShot(page, 'jobs-narrow');
});

test('baseline: jobs without a profile', async ({ page }) => {
  await open(page, `${WIN}&scenario=no-profile`);
  await expect(page.getByTestId('no-profile')).toBeVisible();
  await expectShot(page, 'jobs-no-profile');
});

test('baseline: jobs at the minimum size 480 x 360', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await expectShot(page, 'jobs-min');
});

test('Profil ergänzen has the glyph of Ergänzen on the Profil; Profil öffnen the person', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=profile-thin`);
  await expect(page.getByTestId('thin-profile').locator('[data-icon="edit"]')).toHaveCount(1);
  await open(page, `${WIN}&scenario=profile-incomplete`);
  await expect(page.getByTestId('no-profile').locator('[data-icon="edit"]')).toHaveCount(1);
  await open(page, `${WIN}&scenario=profile-broken`);
  await expect(page.getByTestId('no-profile').locator('[data-icon="profile"]')).toHaveCount(1);
});

test('the empty states without a head stand in the very middle of their pane', async ({ page }) => {
  await open(page, `${WIN}&scenario=fresh`);
  const column = page.getByTestId('list-scroll');
  await expectInTheVeryMiddle(page.getByTestId('empty-all'), column);
  await open(page, `${WIN}&scenario=empty`);
  await expectInTheVeryMiddle(page.getByTestId('empty-all'), column);
  await open(page, `${WIN}&scenario=list-error`);
  await expectInTheVeryMiddle(page.getByTestId('list-error'), column);
  // The job view with no job open, in the same middle.
  await open(page, WIN);
  await expectInTheVeryMiddle(page.getByTestId('place-reader'), page.getByTestId('stage'));
});

test('a job that closes leaves no room behind: a list that fits stands at its top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 700 });
  await open(page, '?scenario=default');
  const scroller = page.getByTestId('list-scroll');
  await scroller.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await page.locator('[data-key="freelancermap:2805"] .row').click();
  await page.getByTestId('search').fill('Hamburg');
  await expect(page.locator('[data-key="freelancermap:2801"]')).toBeVisible();
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollHeight <= node.clientHeight))
    .toBe(true);
});

test('a button of hits elsewhere pressed from the keyboard hands the focus to the place', async ({
  page,
}) => {
  await open(page, '?scenario=default');
  await page.getByTestId('search').fill('Kreditoren');
  const also = page.getByTestId('also-archive');
  await also.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('place-archive')).toBeFocused();
});
