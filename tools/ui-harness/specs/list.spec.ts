// The list area of the Jobs view (the approved design of 2026-09-26): the tabs Eingang (with
// its unopened jobs), Archiv, Papierkorb; one toolbar row (the search, the funnel, Abrufen);
// the funnel's menu from the filter table and the line that names an active filter; one list
// per place in the chosen order with the excluded jobs folded at its end; the empty states;
// the search and its hits elsewhere; choosing several jobs; the keys of a mail app; moves and
// their undo; the run card; the open row's bar; the sidebar; the smallest window.
// Texts come from the catalog (T) and the filter table, the demo data from the stub
// (stubList), not typed again.

import type { Page } from '@playwright/test';
import type { JobQuery, JobView } from '../../../ui/src/lib/ipc/types';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  motionSettled,
  NOW,
  open,
  runFinished,
  settle,
  test,
  visibleCount,
} from './fixtures';
import {
  atStart,
  chooseFilter,
  excludedRows,
  failNext,
  filterLabel,
  filterLine,
  filterMenu,
  filterWordsOf,
  funnel,
  highlighted,
  inboxCount,
  lastQuery,
  list,
  listed,
  MAC,
  menuItem,
  mountedKeys,
  openFilter,
  openJob,
  openPlace,
  row,
  rows,
  settleMoves,
  stubJob,
  stubList,
  T,
  tokenColour,
  tool,
  WIN,
} from './helpers';

const DAY = 86_400_000;

/** The rows outside the fold as the stub lists them: the inbox by match unless said. */
async function inbox(page: Page, query: Partial<JobQuery> = {}): Promise<string[]> {
  return (await stubList(page, query)).active;
}

const keyOf = (job: JobView): string => `${job.key.portal}-${job.key.id}`;
const excluded = (job: JobView): boolean => job.match?.status === 'excluded';

/** The right edge of an element (px from the left of the window). */
async function rightOf(page: Page, testid: string): Promise<number> {
  const box = await page.getByTestId(testid).boundingBox();
  return Math.round((box?.x ?? 0) + (box?.width ?? 0));
}

/** How far a ghost button's box hangs out past the text it lines up with (--ghost-inset). */
function ghostInset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.setProperty('width', 'var(--ghost-inset)');
    probe.style.setProperty('position', 'absolute');
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
}

/** Where the list starts (px from the top of the window). */
function listTop(page: Page): Promise<number> {
  return page.getByTestId('list-scroll').evaluate((node) => node.getBoundingClientRect().top);
}

/* ======================================================================= header */

test.describe('header', () => {
  test('the Eingang tab counts the unopened jobs, not the excluded ones, and none at 0', async ({
    page,
  }) => {
    await open(page, WIN);
    // The unread jobs of the inbox less the excluded ones (the demo has one of those).
    const { jobs } = await stubList(page);
    expect(jobs.some((job) => job.unread && excluded(job))).toBe(true);
    const unread = jobs.filter((job) => job.unread && !excluded(job)).length;
    await expect(page.getByTestId('place-inbox-count')).toHaveText(String(unread));
    await expect(page.getByTestId('place-inbox-count')).toHaveCSS(
      'color',
      await tokenColour(page, '--unread'),
    );
    await expect(page.getByTestId('place-archive-count')).toHaveCount(0);
    await expect(page.getByTestId('place-trash-count')).toHaveCount(0);
    // A search or a filter does not change it.
    await page.getByTestId('search').fill('Interim');
    await expect(rows(page)).toHaveCount(3);
    expect(await inboxCount(page)).toBe(unread);
    await page.getByTestId('search').fill('');
    // Opening a job counts down; with nothing unopened the tab shows no number.
    await openJob(page, 'linkedin-4100200301');
    await expect.poll(() => inboxCount(page)).toBe(unread - 1);
    await atStart(page, 'unread', { unread: false });
    await open(page, WIN);
    await expect(page.getByTestId('places').getByRole('tab', { name: T.place.inbox })).toHaveText(
      T.place.inbox,
    );
    await expect(page.getByTestId('place-inbox-count')).toHaveCount(0);
  });

  test('one toolbar row: the search, the funnel in the inbox only, Abrufen', async ({ page }) => {
    await open(page, WIN);
    const middle = async (id: string): Promise<number> => {
      const box = (await page.getByTestId(id).boundingBox())!;
      return box.y + box.height / 2;
    };
    const search = await middle('search');
    expect(Math.abs((await middle('filter')) - search)).toBeLessThanOrEqual(1);
    expect(Math.abs((await middle('fetch')) - search)).toBeLessThanOrEqual(1);
    // Left to right, and nothing else in the inbox's header: no segments, no mark-all.
    expect(await rightOf(page, 'search')).toBeLessThan(await rightOf(page, 'filter'));
    expect(await rightOf(page, 'filter')).toBeLessThan(await rightOf(page, 'fetch'));
    await expect(funnel(page)).toHaveAttribute('aria-label', T.toolbar.filter);
    await expect(page.getByTestId('facet')).toHaveCount(0);
    await expect(page.getByTestId('mark-all-read')).toHaveCount(0);
    await expect(page.getByTestId('sort')).toHaveCount(0);
    await expect(page.getByTestId('list-header').locator('.second')).toHaveCount(0);
    // The archive and the trash: the same row without the funnel, their count and order below.
    await openPlace(page, 'archive');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(funnel(page)).toHaveCount(0);
    await expect(page.getByTestId('place-count')).toHaveText(T.place.count.archive(1));
    await expect(page.getByTestId('sort')).toHaveText(T.toolbar.sortLabel.match);
    await openPlace(page, 'inbox');
    await expect(funnel(page)).toBeVisible();
  });

  test('Abrufen and Abbrechen share one slot; the hairline shows once the list scrolls', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=200`);
    const header = page.getByTestId('list-header');
    const clear = 'rgba(0, 0, 0, 0)';
    await expect(header).toHaveCSS('border-bottom-color', clear);
    const scroller = page.getByTestId('list-scroll');
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(100);
    await scroller.evaluate((node) => node.scrollTo({ top: 100 }));
    await expect(header).not.toHaveCSS('border-bottom-color', clear);
    await scroller.evaluate((node) => node.scrollTo({ top: 0 }));
    await expect(header).toHaveCSS('border-bottom-color', clear);
    const width = (await page.getByTestId('search').boundingBox())!.width;
    await page.getByTestId('fetch').click();
    await expect(page.getByTestId('cancel-run')).toBeVisible();
    expect((await page.getByTestId('search').boundingBox())!.width).toBe(width);
    await page.getByTestId('cancel-run').click();
    await runFinished(page);
  });

  test('the tabs drop the search, the hits link keeps it, an open tab reloads nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    await search.fill('Kreditoren');
    await page.getByTestId('also-archive').click();
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('Kreditoren');
    await expect(rows(page)).toHaveCount(1);
    // Another view and back keeps the place and its search.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('nav-jobs').click();
    await expect(search).toHaveValue('Kreditoren');
    // The Eingang tab: the inbox as a whole, like a folder of a mail app.
    await openPlace(page, 'inbox');
    await expect(search).toHaveValue('');
    expect((await lastQuery(page))?.search).toBeNull();
    const loads = (await calls(page, 'list_jobs')).length;
    await page.getByTestId('place-inbox').click();
    await page.getByTestId('nav-jobs').click();
    await settle(page);
    expect((await calls(page, 'list_jobs')).length).toBe(loads);
  });

  test('the Papierkorb row: its count, Papierkorb leeren, the order at the end', async ({
    page,
  }) => {
    await open(page, WIN);
    const end = await rightOf(page, 'fetch');
    for (const key of ['freelancermap-2802', 'freelancermap-2804']) {
      await tool(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    await expect(page.getByTestId('place-count')).toHaveText(T.place.count.trash(2));
    // A ghost button's box hangs out by its inset: its label ends where Abrufen ends.
    expect(await rightOf(page, 'sort')).toBe(end + (await ghostInset(page)));
    const empty = (await page.getByTestId('empty-trash').boundingBox())!;
    expect(empty.x).toBeLessThan((await page.getByTestId('sort').boundingBox())!.x);
    // During a search the count says what it found there.
    await page.getByTestId('search').fill('Treasury');
    await expect(page.getByTestId('place-count')).toHaveText(T.place.found.trash(1, 'Treasury'));
  });

  test('an empty place has no second row, and the open inbox job closes there', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await openPlace(page, 'trash');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    await expect(page.getByTestId('empty-place-trash')).toHaveText(T.place.empty.trash);
    await expect(page.getByTestId('list-header').locator('.second')).toHaveCount(0);
  });

  test('a list that did not load says so with a retry; the header has no funnel', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=list-error`);
    const error = page.getByTestId('list-error');
    await expect(error).toContainText(T.list.loadFailed);
    await expect(error.getByRole('button', { name: T.common.retry })).toBeVisible();
    await expect(funnel(page)).toHaveCount(0);
    await expect(page.getByTestId('best-error')).toHaveCount(0);
  });
});

/* ======================================================================= filter */

test.describe('filter', () => {
  test('the menu is the table: small headings, its entries, the defaults checked', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAttribute('aria-label', T.toolbar.filter);
    const table = filterMenu();
    await expect(menu.getByTestId('menu-heading')).toHaveText(
      table.flatMap((group) => (group.heading === null ? [] : [group.heading])),
    );
    await expect(menu.locator('[role^="menuitem"]')).toHaveText(
      table.flatMap((group) => group.entries),
    );
    await expect(menu.getByRole('separator')).toHaveCount(table.length - 1);
    for (const id of ['match', 'portal-all', 'band-any']) {
      await expect(menuItem(page, id)).toHaveAttribute('role', 'menuitemradio');
      await expect(menuItem(page, id)).toHaveAttribute('aria-checked', 'true');
    }
    // Nur Favoriten is a switch of its own; there is no applied filter any more.
    await expect(menuItem(page, 'favourites')).toHaveAttribute('role', 'menuitemcheckbox');
    await expect(menuItem(page, 'favourites')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'applied')).toHaveCount(0);
    await expect(menuItem(page, 'filter-reset')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'false');
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
    await expect.poll(active).toBe('menu-item-match');
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe('menu-item-band-high');
    await page.keyboard.press('Home');
    await expect.poll(active).toBe('menu-item-match');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).toBe('menu-item-favourites');
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).toBe('menu-item-portal-all');
    // A heading's word is no entry: typing it finds the entry that starts with it instead.
    await page.keyboard.type(filterLabel('portal-linkedin').slice(0, 4).toLowerCase());
    await expect.poll(active).toBe('menu-item-portal-linkedin');
    await page.keyboard.press('Enter');
    await expect(filterLine(page)).toContainText(filterLabel('portal-linkedin'));
  });

  test('Nur Favoriten lists the favourites of the inbox; the line says it and takes it off', async ({
    page,
  }) => {
    await open(page, WIN);
    const all = await inbox(page);
    const favourites = await inbox(page, { favourites: true });
    expect(favourites.length).toBeGreaterThan(0);
    expect(favourites.length).toBeLessThan(all.length);
    await expect(filterLine(page)).toHaveCount(0);
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    await chooseFilter(page, 'favourites');
    await expect.poll(() => listed(page)).toEqual(favourites);
    expect(await lastQuery(page)).toMatchObject({
      place: 'inbox',
      favourites: true,
      unread: false,
      applied: false,
    });
    await expect(funnel(page).getByTestId('button-dot')).toHaveCSS(
      'background-color',
      await tokenColour(page, '--unread'),
    );
    await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('favourites'));
    await openFilter(page);
    await expect(menuItem(page, 'favourites')).toHaveAttribute('aria-checked', 'true');
    await menuItem(page, 'favourites').click();
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(filterLine(page)).toHaveCount(0);
    // The line's own way back.
    await chooseFilter(page, 'favourites');
    await filterLine(page).getByTestId('filter-line-reset').click();
    await expect(filterLine(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
  });

  test('a favourite counts and lists only while it is in the inbox', async ({ page }) => {
    await open(page, WIN);
    await chooseFilter(page, 'favourites');
    await expect(rows(page)).toHaveCount(1);
    // Archived, the favourite keeps its star but leaves the filtered inbox.
    await tool(page, 'archive', 'freelancermap-2801');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId('empty-filter')).toBeVisible();
    expect(await stubJob(page, 'freelancermap', '2801')).toMatchObject({
      pinned: true,
      place: 'archive',
    });
    // The archive lists it with its star.
    await openPlace(page, 'archive');
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
  });

  test('the portal and the band narrow the list; the line names them in the menu words', async ({
    page,
  }) => {
    await open(page, WIN);
    const { jobs } = await stubList(page);
    await chooseFilter(page, 'portal-linkedin');
    const linkedin = await inbox(page, { portal: 'linkedin' });
    expect(linkedin.every((key) => key.startsWith('linkedin-'))).toBe(true);
    await expect.poll(() => listed(page)).toEqual(linkedin);
    expect(await lastQuery(page)).toMatchObject({ portal: 'linkedin', minBand: null });
    await chooseFilter(page, 'band-mid');
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portal: 'linkedin', minBand: 'mid' }));
    // The band leaves the unscored and the excluded jobs out.
    const unscored = jobs.filter((job) => job.match === null).map(keyOf);
    expect(unscored.length).toBeGreaterThan(0);
    for (const key of unscored) expect(await listed(page)).not.toContain(key);
    await expect(page.getByTestId('excluded-divider')).toHaveCount(0);
    await chooseFilter(page, 'favourites');
    await expect(page.getByTestId('filter-words')).toHaveText(
      filterWordsOf('favourites', 'portal-linkedin', 'band-mid'),
    );
    expect(await lastQuery(page)).toMatchObject({
      favourites: true,
      portal: 'linkedin',
      minBand: 'mid',
    });
    // Only the high band, every portal again.
    await chooseFilter(page, 'favourites');
    await chooseFilter(page, 'portal-all');
    await chooseFilter(page, 'band-high');
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { minBand: 'high' }));
    await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('band-high'));
  });

  test('Filter zurücksetzen takes it all off; the filter is kept, the archive ignores it', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active: all, counts } = await stubList(page);
    await chooseFilter(page, 'portal-freelancermap');
    await chooseFilter(page, 'band-mid');
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portal: 'freelancermap', minBand: 'mid' }));
    // The app starts again: the same filter.
    await open(page, WIN);
    await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
    expect(await lastQuery(page)).toMatchObject({ portal: 'freelancermap', minBand: 'mid' });
    // The archive has no filter: its query carries none.
    await openPlace(page, 'archive');
    expect(await lastQuery(page)).toMatchObject({
      place: 'archive',
      favourites: false,
      portal: null,
      minBand: null,
    });
    await openPlace(page, 'inbox');
    await openFilter(page);
    await expect(menuItem(page, 'filter-reset')).toHaveText(T.toolbar.filterReset);
    await menuItem(page, 'filter-reset').click();
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
    expect(await page.evaluate(() => localStorage.getItem('jobs-filter'))).toBeNull();
    // The Übersicht never follows it.
    await chooseFilter(page, 'portal-linkedin');
    await page.getByTestId('nav-overview').click();
    await expect(page.getByTestId('tile-new').locator('.digits')).toHaveText(String(counts.unread));
  });

  test('without a profile the bands and the match order are off and say why', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('jobs-filter', JSON.stringify({ minBand: 'high' })),
    );
    await open(page, `${WIN}&scenario=no-profile`);
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    expect(await lastQuery(page)).toMatchObject({ sort: 'newest', minBand: null });
    await openFilter(page);
    await expect(menuItem(page, 'newest')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'match')).toHaveAttribute('aria-disabled', 'true');
    for (const id of ['band-any', 'band-mid', 'band-high']) {
      await expect(menuItem(page, id)).toHaveAttribute('aria-disabled', 'true');
    }
    await menuItem(page, 'band-high').hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.toolbar.bandNoProfile);
    await menuItem(page, 'band-high').click({ force: true });
    await expect(page.getByTestId('menu')).toBeVisible();
    // The portals and the favourites still filter; the kept band waits for the profile.
    const kept = (): Promise<unknown> =>
      page.evaluate(() => JSON.parse(localStorage.getItem('jobs-filter') ?? 'null') as unknown);
    await menuItem(page, 'portal-freelance').click();
    expect(await lastQuery(page)).toMatchObject({ portal: 'freelance', minBand: null });
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portal: 'freelance', sort: 'newest' }));
    expect(await kept()).toEqual({ favourites: false, portal: 'freelance', minBand: 'high' });
    await chooseFilter(page, 'favourites');
    expect(await kept()).toEqual({ favourites: true, portal: 'freelance', minBand: 'high' });
  });

  test('a filter that leaves nothing says so once and takes itself off', async ({ page }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-freelance');
    await chooseFilter(page, 'favourites');
    const empty = page.getByTestId('empty-filter');
    await expect(empty).toContainText(T.list.noFilterHit);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(funnel(page)).toBeVisible();
    await empty.getByRole('button', { name: T.toolbar.filterReset }).click();
    await expect(empty).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
  });

  test('the open job stays while the filter lists it, else it closes', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await chooseFilter(page, 'band-high');
    const high = await inbox(page, { minBand: 'high' });
    expect(high).toContain('freelancermap-2801');
    await expect.poll(() => listed(page)).toEqual(high);
    await expect(page.getByTestId('reader-title')).toBeVisible();
    await expect(row(page, 'freelancermap-2801')).toHaveAttribute('aria-current', 'true');
    await chooseFilter(page, 'portal-linkedin');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    expect(await listed(page)).toEqual(await inbox(page, { minBand: 'high', portal: 'linkedin' }));
  });

  test('the run card and the Übersicht open the inbox; a filter stays and its line says it', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-linkedin');
    await openPlace(page, 'archive');
    await page.getByTestId('run-status').click();
    await page.getByTestId('last-top').click();
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('portal-linkedin'));
    expect(await lastQuery(page)).toMatchObject({ place: 'inbox', sort: 'match' });
    await page.getByTestId('search').fill('Controller');
    await page.getByTestId('nav-overview').click();
    await page.getByTestId('tile-new').click();
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await expect(page.getByTestId('search')).toHaveValue('');
    await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('portal-linkedin'));
  });

  test('macOS: the same funnel and menu', async ({ page }) => {
    await open(page, MAC);
    await chooseFilter(page, 'portal-linkedin');
    await expect(rows(page)).toHaveCount((await inbox(page, { portal: 'linkedin' })).length);
    await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
  });
});

/* ========================================================================= list */

test.describe('one list', () => {
  test('the inbox is one list by match, the unscored first: no sections, the dot on the unopened', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active: all, jobs } = await stubList(page);
    await expect.poll(() => listed(page)).toEqual(all);
    // By match the jobs still without a score stand on top (each page is then complete).
    const unscored = jobs.filter((job) => job.match === null).map(keyOf);
    expect(unscored.length).toBeGreaterThan(0);
    expect(all.slice(0, unscored.length)).toEqual(unscored);
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
    const dotted = await rows(page).evaluateAll((items) =>
      items
        .filter((item) => item.closest('.job')?.querySelector('.dot') != null)
        .map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
    );
    expect(dotted.sort()).toEqual(
      jobs
        .filter((job) => job.unread && !excluded(job))
        .map(keyOf)
        .sort(),
    );
    // The query of the inbox never asks for the unread ones only.
    expect(await lastQuery(page)).toMatchObject({ unread: false, favourites: false });
  });

  test('opening a job reads it once, on a real click; the row stays, its dot goes', async ({
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
    await expect(first).toBeVisible();
    await expect.poll(() => listed(page)).toEqual(all);
    // Back from another view the list is the same.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('nav-jobs').click();
    await expect.poll(() => listed(page)).toEqual(all);
  });

  test('the excluded jobs are one folded section at the end, counted per place; kept open', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active, excluded: out } = await stubList(page);
    expect(out.length).toBeGreaterThan(1);
    const divider = page.getByTestId('excluded-divider');
    await expect(divider).toHaveText(`${T.list.excluded} (${out.length})`);
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    const last = (await rows(page).last().boundingBox())!;
    expect((await divider.boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height);
    // The keys stay above a folded section: End opens the last row before it.
    await page.keyboard.press('End');
    await expect(row(page, active.at(-1)!)).toHaveAttribute('aria-current', 'true');
    await divider.click();
    await expect(excludedRows(page)).toHaveCount(out.length);
    await expect(excludedRows(page).first().locator('.foot')).toHaveText('Arbeitnehmerüberlassung');
    // Kept: the next start shows it open; an archived job is in no list of the inbox.
    await open(page, WIN);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'linkedin-4100200306')).toHaveCount(0);
    expect(await listed(page)).toEqual(active);
    // Each place counts its own excluded jobs.
    await tool(page, 'archive', out[0]!);
    await expect(divider).toHaveText(`${T.list.excluded} (${out.length - 1})`);
    await openPlace(page, 'archive');
    await expect(divider).toHaveText(`${T.list.excluded} (1)`);
  });

  test('the order is kept for every list and keeps the open job', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2803');
    await chooseFilter(page, 'newest');
    const newest = await inbox(page, { sort: 'newest' });
    expect(newest).not.toEqual(await inbox(page));
    await expect.poll(() => listed(page)).toEqual(newest);
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'freelancermap-2803')).toBeInViewport();
    await openPlace(page, 'archive');
    await expect(page.getByTestId('sort')).toHaveText(T.toolbar.sortLabel.newest);
    await open(page, WIN);
    expect(await lastQuery(page)).toMatchObject({ sort: 'newest' });
  });

  test('only a re-sort moves rows: a run lands new jobs in place, the order glides', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=30`);
    const watch = (frames: number, during = ''): Promise<void> =>
      page.evaluate(
        ([count, selector]) => {
          const w = window as unknown as { __glides: number; __left: number };
          w.__glides = 0;
          w.__left = count;
          const gliding = (item: Element): boolean =>
            item.getAnimations().some((animation) => {
              const keys = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
              return keys.some((k) => 'transform' in k) && keys.every((k) => !('opacity' in k));
            });
          const sample = (): void => {
            if (selector && document.querySelector(selector) === null) {
              w.__left = 0;
              return;
            }
            const items = document.querySelectorAll('[data-testid="job-list"] [data-key]');
            w.__glides = Math.max(w.__glides, [...items].filter(gliding).length);
            w.__left -= 1;
            if (w.__left > 0) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        },
        [frames, during] as const,
      );
    const glides = async (): Promise<number> => {
      await page.waitForFunction(() => (window as unknown as { __left: number }).__left <= 0);
      return page.evaluate(() => (window as unknown as { __glides: number }).__glides);
    };
    await page.getByTestId('fetch').click();
    await expect(page.getByTestId('run-running')).toBeVisible();
    const before = await rows(page).count();
    await watch(600, '[data-testid="run-running"]');
    expect(await glides()).toBe(0);
    expect(await rows(page).count()).toBeGreaterThan(before);
    await runFinished(page);
    await motionSettled(page);
    await watch(20);
    const all = await rows(page).count();
    await page.getByTestId('search').fill('Interim');
    await expect.poll(() => rows(page).count()).toBeLessThan(all);
    expect(await glides()).toBe(0);
    await page.getByTestId('search').fill('');
    await expect(rows(page)).toHaveCount(all);
    await motionSettled(page);
    await watch(120);
    await chooseFilter(page, 'newest');
    expect(await glides()).toBeGreaterThan(0);
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

  test('loading takes a moment: its placeholder rows show whole, then the list', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=slow`);
    await expect(page.getByTestId('list-skeleton')).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('list-skeleton')).toHaveCount(0);
  });

  test('an empty inbox says where jobs come from; reading older mails asks first', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=empty`);
    await expect(page.getByTestId('empty-all')).toBeVisible();
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    await page.getByTestId('alert-linkedin').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'portalHome', portal: 'linkedin' },
    });
    await failNext(page, 'open_target');
    await page.getByTestId('alert-freelance').click();
    await expect(page.getByTestId('portal-error')).toBeVisible();
    await page.getByTestId('read-older').click();
    const dialog = page.getByTestId('dialog-read-older');
    await expect(dialog).toBeVisible();
    expect(await calls(page, 'start_run')).toEqual([]);
    await dialog.getByTestId('dialog-confirm').click();
    await expect.poll(async () => (await calls(page, 'start_run')).length).toBe(1);
  });

  test('without a profile: newest first, one line leads to the empty profile form', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    const notice = page.getByTestId('no-profile');
    await expect(notice).toHaveText(new RegExp(T.list.noProfile.replace('.', '\\.')));
    await expect(page.getByTestId('place-reader')).toHaveText(T.place.pickJob);
    await expect(notice.locator('.btn.primary')).toHaveCount(0);
    expect((await calls(page, 'list_jobs'))[0]?.[1]).toMatchObject({
      query: { sort: 'newest' },
    });
    await notice.getByRole('button', { name: T.list.createProfile }).click();
    await expect(page.getByTestId('profile-form')).toBeVisible();
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
    await thin.getByRole('button', { name: T.list.openProfile }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
  });

  test('a removed mailbox keeps the jobs: Abrufen waits and the list says how', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('mailbox-remove').click();
    await page
      .getByTestId('dialog-remove-mailbox')
      .getByRole('button', { name: 'Entfernen' })
      .click();
    await page.getByTestId('nav-jobs').click();
    await expect(rows(page).first()).toBeVisible();
    await expect(page.getByTestId('fetch')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('no-mailbox').getByRole('button').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
  });

  test('one primary button in every state of the list, and with a job open', async ({ page }) => {
    for (const scenario of ['default', 'empty', 'no-profile', 'offline']) {
      await open(page, `${WIN}&scenario=${scenario}`);
      expect(await visibleCount(page, '.btn.primary'), scenario).toBeLessThanOrEqual(1);
    }
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    expect(await visibleCount(page, '.btn.primary')).toBeLessThanOrEqual(1);
  });

  test('the setup page: a data folder that does not open says so', async ({ page }) => {
    await open(page, `${WIN}&scenario=reset`);
    await failNext(page, 'open_target');
    await page.getByTestId('first-reset-report').getByRole('button').click();
    await expect(page.getByTestId('folder-error')).toHaveText(T.error.text('db', {}));
    expect(await calls(page, 'open_target')).toHaveLength(1);
  });
});

/* ========================================================================= rows */

test.describe('rows', () => {
  test('one height for every row; reading a job keeps its title as wide as before', async ({
    page,
  }) => {
    await open(page, WIN);
    await motionSettled(page);
    const heights = await list(page)
      .locator('[data-testid^="job-row-"]')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect([...new Set(heights)]).toEqual([86]);
    const title = row(page, 'linkedin-4100200301').locator('.title');
    const width = (): Promise<number> =>
      title.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().width;
      });
    await expect(title).toHaveClass(/unread/);
    const unread = await width();
    await openJob(page, 'linkedin-4100200301');
    await expect(title).not.toHaveClass(/unread/);
    expect(Math.abs((await width()) - unread)).toBeLessThan(0.01);
  });

  test('a row keeps its lines: one cut meta line, a badge that says why, dates that move on', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page, WIN);
    const meta = row(page, 'linkedin-4100200303').locator('.meta .parts');
    expect(
      await meta.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.whiteSpace, style.textOverflow, style.display];
      }),
    ).toEqual(['nowrap', 'ellipsis', 'block']);
    await row(page, 'freelancermap-2806').getByText(T.score.unscorable).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Zu wenig Text für eine Bewertung.');
    // The date stands on the baseline of its title and moves on while the app stays open.
    const gaps = await list(page).evaluate((node) =>
      [...node.querySelectorAll('.job')].map((job) => {
        const baseline = (inside: Element): number => {
          const probe = document.createElement('span');
          probe.style.setProperty('display', 'inline-block');
          probe.style.setProperty('width', '0');
          probe.style.setProperty('height', '0');
          inside.prepend(probe);
          const y = probe.getBoundingClientRect().bottom;
          probe.remove();
          return y;
        };
        return (
          baseline(job.querySelector('.title')!) - baseline(job.querySelector('.date .stamp')!)
        );
      }),
    );
    expect(gaps.length).toBeGreaterThan(5);
    for (const gap of gaps) expect(Math.abs(gap)).toBeLessThan(0.5);
    const date = row(page, 'linkedin-4100200301').locator('.date');
    const before = await date.textContent();
    await page.clock.setFixedTime(new Date(NOW.getTime() + 5 * 3_600_000));
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await expect(date).not.toHaveText(before ?? '');
    // Without a profile a row without a badge keeps the one height.
    await open(page, `${WIN}&scenario=no-profile`);
    const bare = list(page).locator('.job.bare .row').first();
    expect((await bare.boundingBox())!.height).toBe(86);
  });

  test('the open row deepens while pressed, only under the pointer', async ({ page }) => {
    await open(page, WIN);
    const target = row(page, 'linkedin-4100200301');
    await target.click();
    await expect(target).toHaveAttribute('aria-current', 'true');
    const rest = await tokenColour(page, '--surface-selected');
    const hover = await tokenColour(page, '--surface-selected-hover');
    const press = await tokenColour(page, '--surface-selected-press');
    const wash = (): Promise<string> =>
      target.evaluate((node) => getComputedStyle(node).backgroundColor);
    const box = (await target.boundingBox())!;
    const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const away = { x: box.x + box.width + 200, y: box.y + box.height + 200 };
    await page.mouse.move(on.x, on.y);
    await expect.poll(wash).toBe(hover);
    await page.mouse.down();
    await expect.poll(wash).toBe(press);
    await page.mouse.move(away.x, away.y, { steps: 4 });
    await expect.poll(wash).toBe(rest);
    await page.mouse.up();
    await page.mouse.move(on.x, on.y);
    await page.mouse.down({ button: 'middle' });
    await page.waitForTimeout(250);
    expect(await wash()).toBe(hover);
    await page.mouse.up({ button: 'middle' });
    await page.mouse.move(4, 4);
  });

  test('a row shows its tools under the pointer; the star pins without opening', async ({
    page,
  }) => {
    await open(page, WIN);
    const key = 'linkedin-4100200301';
    const job = list(page).locator('.job', { has: page.getByTestId(`job-row-${key}`) });
    await expect(job.locator('.tools')).toHaveCount(0);
    await row(page, key).hover();
    await expect(job.locator('.tools .btn')).toHaveCount(3);
    expect(
      await job
        .locator('.tools .btn')
        .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))),
    ).toEqual([T.actions.archive, T.actions.trash, T.reader.pin]);
    await page.getByTestId(`pin-${key}`).click();
    await expect(page.getByTestId(`pin-${key}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('reader')).toHaveCount(0);
    expect((await calls(page, 'set_pinned')).map(([, args]) => args)).toEqual([
      { key: { portal: 'linkedin', id: '4100200301' }, on: true },
    ]);
    await page.mouse.move(0, 0);
    await expect(job.locator('.mark')).toBeVisible();
  });

  test('the menu of a row: its entries, no unread; with several chosen it acts on all', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click({ button: 'right' });
    const menu = page.getByTestId('menu');
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      T.menu.open,
      T.reader.open,
      T.reader.pin,
      T.actions.archive,
      T.actions.trash,
      T.reader.prompt,
    ]);
    await expect(menuItem(page, 'unread')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await openJob(page, 'freelancermap-2802');
    await row(page, 'freelancermap-2803').click({ modifiers: ['Control'] });
    await row(page, 'freelancermap-2803').click({ button: 'right' });
    await expect(menuItem(page, 'open')).toHaveCount(0);
    await menuItem(page, 'archive').click();
    await expect(page.getByTestId('toast').last()).toContainText(T.toast.archivedMany(2));
  });

  test('a list ring that waits breathes on its solid track', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    await settle(page);
    const ring = list(page)
      .locator('.job', { has: page.getByTestId('job-row-linkedin-4100200302') })
      .locator('.ring');
    await expect(ring).toHaveClass(/pending/);
    const wait = await ring.evaluate((node) => {
      const layer = node.querySelector('.wait')!;
      return {
        name: getComputedStyle(layer).animationName,
        dashes: getComputedStyle(layer.querySelector('.arc')!).strokeDasharray,
        track: getComputedStyle(node.querySelector('.track')!).stroke,
      };
    });
    expect(wait).toEqual({ name: 'breathe', dashes: 'none', track: 'none' });
  });
});

/* ======================================================================= search */

test.describe('search', () => {
  test('no hit: one empty state with a way back', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kernfusion');
    await expect(page.getByTestId('empty-search')).toContainText(T.list.noHit('Kernfusion'));
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await page.getByTestId('empty-search').getByRole('button').click();
    await expect(rows(page).first()).toBeVisible();
  });

  test('Enter or ArrowDown in the search open the first hit, its row takes the focus', async ({
    page,
  }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    await search.fill('Interim');
    await expect(rows(page)).toHaveCount(3);
    await search.press('Enter');
    await expect(rows(page).first()).toBeFocused();
    await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await search.click();
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).first()).toBeFocused();
    await expect(page.getByTestId('reader-title')).toBeVisible();
  });

  test('hits elsewhere are a button that goes there, centred under an empty search', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const button = page.getByTestId('also-archive');
    await expect(button).toHaveText(T.place.hitsIn.archive(1));
    const a = (await page.getByTestId('empty-search').boundingBox())!;
    const b = (await button.boundingBox())!;
    expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);
    await button.click();
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(rows(page)).toHaveCount(1);
  });

  test('the hits elsewhere count without the inbox filter', async ({ page }) => {
    await open(page, WIN);
    await chooseFilter(page, 'portal-freelance');
    await page.getByTestId('search').fill('Kreditoren');
    // The archived job is a linkedin one: the filter of the inbox does not hide it there.
    await expect(page.getByTestId('also-archive')).toHaveText(T.place.hitsIn.archive(1));
    await page.getByTestId('also-archive').click();
    await expect(row(page, 'linkedin-4100200306')).toBeVisible();
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
});

/* ============================================================= choosing several */

test.describe('choosing several', () => {
  test('Ctrl+click and Shift+click choose; the bar takes the toolbar row, the list stays', async ({
    page,
  }) => {
    await open(page, WIN);
    const all = await inbox(page);
    const top = await listTop(page);
    const end = await rightOf(page, 'fetch');
    await openJob(page, 'freelancermap-2801');
    await row(page, 'linkedin-4100200301').click({ modifiers: ['Control'] });
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toContainText(T.selection.count(2));
    await expect(page.getByTestId('search')).toHaveCount(0);
    expect(await listTop(page)).toBe(top);
    expect(await rightOf(page, 'selection-clear')).toBe(end + (await ghostInset(page)));
    await expect(page.getByTestId('selection-clear')).toHaveAttribute(
      'aria-label',
      T.selection.clear,
    );
    // Esc clears the choice; the open job stays open.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('reader')).toBeVisible();
    // Shift+click takes the range; the bar archives them in one move.
    await row(page, 'freelance-900411').click({ modifiers: ['Shift'] });
    await expect(bar).toContainText(T.selection.count(3));
    await bar.getByTestId('selection-archive').click();
    await expect(rows(page)).toHaveCount(all.length - 3);
    await expect(page.getByTestId('toast').last()).toContainText(T.toast.archivedMany(3));
    // Ctrl+F during a choice ends it and goes to the search.
    await rows(page).nth(0).click();
    await rows(page)
      .nth(1)
      .click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search')).toBeFocused();
  });

  test('the pane names the chosen jobs and offers what fits them, in words', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2805');
    await row(page, 'linkedin-4100200302').click({ modifiers: ['Control'] });
    const pane = page.getByTestId('selection-pane');
    await expect(pane).toContainText(T.selection.chosen(2));
    await expect(pane).toContainText(T.selection.hint(T.selection.commandKey.ctrl));
    await expect(pane.getByTestId('selection-titles')).toContainText('Projektcontroller Bau');
    await expect(pane.getByTestId('selection-actions').getByRole('button')).toHaveText([
      T.actions.archive,
      T.actions.trash,
      T.selection.pin,
      T.reader.fetchDetails,
    ]);
    await pane.getByTestId('pane-details').click();
    expect((await calls(page, 'start_run')).at(-1)?.[1]).toMatchObject({
      request: { kind: 'details' },
    });
    await runFinished(page);
    // Many chosen (the list as the run left it): eight titles, then how many more.
    await page.keyboard.press('Escape');
    const all = await inbox(page);
    await expect.poll(() => listed(page)).toEqual(all);
    await openJob(page, all[0]!);
    await page.keyboard.press('Shift+End');
    await expect(pane).toContainText(T.selection.chosen(all.length));
    await expect(pane.getByTestId('selection-titles').locator('li')).toHaveCount(9);
    await expect(pane.getByTestId('selection-more')).toHaveText(T.selection.more(all.length - 8));
  });

  test('the highlight shows exactly the chosen rows; Ctrl+click on the open job closes it', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await row(page, 'linkedin-4100200301').click({ modifiers: ['Control'] });
    await row(page, 'freelancermap-2802').click({ modifiers: ['Shift'] });
    expect(await highlighted(page)).toEqual([
      'linkedin:4100200301',
      'freelance:900411',
      'freelancermap:2802',
    ]);
    await row(page, 'freelance-900411').click({ modifiers: ['Control'] });
    expect(await highlighted(page)).not.toContain('freelance:900411');
    await page.keyboard.press('Escape');
    await openJob(page, 'freelancermap-2803');
    await row(page, 'freelancermap-2803').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('reader')).toHaveCount(0);
    expect(await highlighted(page)).toEqual([]);
  });

  test('a range starts from the job the app opened; one chosen row left by a move opens', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2802');
    await page.getByTestId('reader-archive').click();
    await expect(page.getByTestId('reader-title')).toHaveText(/Kaufmännische Leitung/);
    await settleMoves(page);
    await row(page, 'freelancermap-2804').click({ modifiers: ['Shift'] });
    expect(await highlighted(page)).toEqual([
      'freelancermap:2803',
      'linkedin:4100200303',
      'freelancermap:2804',
    ]);
    // Two chosen, one of them moved: the other opens alone.
    await page.keyboard.press('Escape');
    await openJob(page, 'freelancermap-2801');
    await row(page, 'freelance-900411').click({ modifiers: ['Control'] });
    await row(page, 'freelancermap-2803').click({ modifiers: ['Shift'] });
    expect(await highlighted(page)).toEqual(['freelance:900411', 'freelancermap:2803']);
    await settleMoves(page);
    await tool(page, 'archive', 'freelancermap-2803');
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(page.getByTestId('reader-title')).toHaveText('SAP S/4HANA Finance Projektleitung');
  });

  test('the checkbox over the ring chooses; one column chooses without opening', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    const check = list(page).getByTestId('check-linkedin-4100200301');
    await check.hover();
    await expect(check).toHaveCSS('opacity', '1');
    await check.click();
    await expect(page.getByTestId('selection-pane')).toContainText(T.selection.chosen(2));
    await check.click();
    await expect(page.getByTestId('selection-pane')).toHaveCount(0);
    await expect(page.getByTestId('reader-title')).toBeVisible();
    // One column: a Ctrl+click keeps the list, the bar acts on one row; two columns open it.
    await page.setViewportSize({ width: 800, height: 700 });
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('selection-count')).toHaveText(T.selection.count(1));
    await expect(page.getByTestId('reader')).toHaveCount(0);
    expect(await calls(page, 'job_detail')).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 700 });
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(row(page, 'freelancermap-2802')).toHaveAttribute('aria-current', 'true');
  });
});

/* ========================================================================= keys */

test.describe('keys', () => {
  test('like a mail app: the arrows, Home and End, Esc, Ctrl+F and the reader after a click', async ({
    page,
  }) => {
    await open(page, WIN);
    const titles = await rows(page).locator('.title').allInnerTexts();
    const reader = page.getByTestId('reader-title');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowDown');
    await expect(reader).toHaveText(titles[0]!);
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(reader).toHaveText(titles[0]!);
    await page.keyboard.press('End');
    await expect(reader).toHaveText(titles.at(-1)!);
    await page.keyboard.press('Home');
    await expect(reader).toHaveText(titles[0]!);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-reader')).toBeVisible();
    // A click into the reader's text gives it the arrows; a click on a row gives them back.
    await rows(page).nth(2).click();
    await page.getByTestId('reader-title').click();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await expect(reader).toHaveText(titles[2]!);
    await rows(page).nth(2).click();
    await page.keyboard.press('ArrowDown');
    await expect(reader).toHaveText(titles[3]!);
    // Ctrl+F to the search; Esc clears it, then closes the job; the arrows move its caret.
    await page.keyboard.press('Control+f');
    const search = page.getByTestId('search');
    await expect(search).toBeFocused();
    await page.keyboard.type('Finance');
    await search.press('ArrowLeft');
    await expect(reader).toHaveText(titles[3]!);
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-reader')).toBeVisible();
  });

  test('Cmd+F is the find key on macOS, Ctrl+F is not', async ({ page }) => {
    await open(page, MAC);
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search')).not.toBeFocused();
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('search')).toBeFocused();
  });

  test('E, Entf, S, O act on the open job, the next job opens; U and B do nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2802');
    await page.keyboard.press('s');
    await expect.poll(async () => (await stubJob(page, 'freelancermap', '2802')).pinned).toBe(true);
    await page.keyboard.press('o');
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2802' } },
    });
    await page.keyboard.press('u');
    await page.keyboard.press('b');
    expect(await calls(page, 'mark_unread')).toEqual([]);
    expect(await calls(page, 'set_applied')).toEqual([]);
    await page.keyboard.press('e');
    await expect(page.getByTestId('reader-title')).toHaveText(
      'Kaufmännische Leitung Projektgeschäft',
    );
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await settleMoves(page);
    await page.keyboard.press('Delete');
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    expect((await calls(page, 'move_jobs')).map(([, args]) => (args as { to: string }).to)).toEqual(
      ['archive', 'trash'],
    );
    // Enter on a focused row opens it.
    await rows(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  });

  test('F5 and Ctrl+R fetch like Abrufen; the keys card lists the keys of the list', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    await page.keyboard.press('F5');
    await runFinished(page);
    await page.keyboard.press('Control+r');
    await runFinished(page);
    expect(await calls(page, 'start_run')).toHaveLength(2);
    await page.keyboard.press('Control+/');
    const card = page.getByTestId('keys-help');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('key-archive')).toContainText(T.keysHelp.archive);
    await expect(card.getByTestId('key-star')).toContainText(T.keysHelp.star);
    await expect(card.getByTestId('key-unread')).toHaveCount(0);
  });

  test('the whole list: End and ArrowUp reach the last job, a re-sort keeps the open one', async ({
    page,
  }) => {
    test.slow();
    await open(page, `${WIN}&scenario=many`);
    const lastIsOpen = async (): Promise<boolean> => {
      const keys = await mountedKeys(page);
      return keys.length > 120 && (await highlighted(page))[0] === keys.at(-1);
    };
    await page.keyboard.press('End');
    await expect.poll(lastIsOpen, { timeout: 40_000 }).toBe(true);
    await expect(list(page).locator('.sentinel')).toHaveCount(0);
    await open(page, `${WIN}&scenario=many`);
    await page.keyboard.press('ArrowUp');
    await expect.poll(lastIsOpen, { timeout: 40_000 }).toBe(true);
    // A re-sort keeps the open job in view, and the arrows go on from it.
    await open(page, `${WIN}&scenario=many`);
    await rows(page).nth(39).click();
    const key = (await highlighted(page))[0] ?? '';
    await chooseFilter(page, 'newest');
    await expect.poll(async () => (await lastQuery(page))?.sort).toBe('newest');
    const target = list(page).locator(`[data-key="${key}"] .row`);
    await expect(target).toHaveClass(/selected/);
    await expect(target).toBeInViewport();
    const keys = await mountedKeys(page);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => highlighted(page)).toEqual([keys[keys.indexOf(key) + 1]]);
  });

  test('the list is one Tab stop: Tab leaves from the open row, Shift+Tab comes back', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    await expect(list(page).locator('.row:not([tabindex="-1"])')).toHaveCount(1);
    await row(page, 'linkedin-4100200301').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('excluded-divider')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[data-testid="job-list"]') != null,
      ),
    ).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(row(page, 'linkedin-4100200301')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'freelance-900411')).toBeFocused();
    await expect(row(page, 'linkedin-4100200301')).toHaveAttribute('tabindex', '-1');
  });
});

/* ======================================================================== moves */

test.describe('moves and undo', () => {
  test('archive from the row: toasts merge, one undo, the Archiv sends it back', async ({
    page,
  }) => {
    await open(page, WIN);
    // One job: the toast names its whole title.
    await tool(page, 'trash', 'freelancermap-2805');
    await expect(page.getByTestId('toast-text').last()).toContainText(
      T.toast.trashedOne('Projektcontroller Bau'),
    );
    await page.getByTestId('toast-action').click();
    await settleMoves(page);
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await tool(page, 'archive', key);
      await expect(row(page, key)).toHaveCount(0);
      await settleMoves(page);
    }
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await expect(page.getByTestId('toast')).toContainText(T.toast.archivedMany(2));
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2802')).toHaveCount(1);
    await expect(row(page, 'freelancermap-2803')).toHaveCount(1);
    await settleMoves(page);
    await tool(page, 'archive', 'freelancermap-2802');
    await openPlace(page, 'archive');
    await tool(page, 'toInbox', 'freelancermap-2802');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast').last()).toContainText('zurückgeholt.');
    await openPlace(page, 'inbox');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(1);
  });

  test('the Papierkorb: restore, delete for good and empty it, asking first', async ({ page }) => {
    await open(page, WIN);
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await tool(page, 'trash', key);
      await settleMoves(page);
    }
    await expect(page.getByTestId('toast').last()).toContainText(T.toast.trashedMany(2));
    await openPlace(page, 'trash');
    await expect(page.getByTestId('place-reader')).toContainText(T.place.trash);
    await openJob(page, 'freelancermap-2802');
    await expect(page.getByTestId('reader-pin')).toHaveCount(0);
    await page.getByTestId('reader-restore').click();
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await tool(page, 'purge', 'freelancermap-2803');
    await page
      .getByTestId('dialog-purge')
      .getByRole('button', { name: T.actions.purgeConfirm, exact: true })
      .click();
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    expect((await calls(page, 'purge_jobs')).map(([, args]) => args)).toEqual([
      { keys: [{ portal: 'freelancermap', id: '2803' }] },
    ]);
    // Papierkorb leeren: two jobs there, a search that finds one: both go, and it says so.
    await openPlace(page, 'inbox');
    for (const key of ['freelancermap-2802', 'freelancermap-2804']) {
      await tool(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    await page.getByTestId('search').fill('Treasury');
    await expect(rows(page)).toHaveCount(1);
    await page.getByTestId('empty-trash').click();
    await expect(page.getByTestId('dialog-empty-trash')).toContainText(T.actions.emptyTrashText(2));
    await page
      .getByTestId('dialog-empty-trash')
      .getByRole('button', { name: T.actions.emptyTrashConfirm, exact: true })
      .click();
    await expect(page.getByTestId('dialog-empty-trash')).toBeHidden();
    await page.getByTestId('search').fill('');
    await expect(page.getByTestId('empty-place-trash')).toBeVisible();
    expect(await calls(page, 'empty_trash')).toHaveLength(1);
  });

  test('a job in the Papierkorb counts its days down, no star; purging waits for a run', async ({
    page,
  }) => {
    await open(page, WIN);
    await tool(page, 'trash', 'linkedin-4100200303');
    await settleMoves(page);
    await tool(page, 'trash', 'freelancermap-2801');
    await openPlace(page, 'trash');
    const left = row(page, 'linkedin-4100200303').getByTestId('trash-left');
    await expect(left).toHaveText(T.job.trashLeft(30));
    await page.clock.setFixedTime(new Date(NOW.getTime() + DAY + 60_000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(left).toHaveText(T.job.trashLeft(29));
    await expect(
      list(page)
        .locator('.job', { has: page.getByTestId('job-row-freelancermap-2801') })
        .locator('.mark'),
    ).toHaveCount(0);
    await page.evaluate(() => (window.__harness.holdAfter = 1));
    await page.getByTestId('fetch').click();
    await row(page, 'linkedin-4100200303').hover();
    await expect(page.getByTestId('purge-linkedin-4100200303')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
  });

  test('a double click moves one job; the next job opens and is read once looked at', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').hover();
    const target = page.getByTestId('archive-freelancermap-2801');
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 50 });
    await expect(page.getByTestId('toast').last()).toContainText('archiviert.');
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
    await settleMoves(page);
    await openJob(page, 'linkedin-4100200301');
    await page.getByTestId('reader-archive').click();
    await expect(page.getByTestId('reader-title')).toHaveText('SAP S/4HANA Finance Projektleitung');
    const read = async (): Promise<boolean> =>
      (await calls(page, 'mark_read')).some(
        ([, args]) => (args as { key: { id: string } }).key.id === '900411',
      );
    expect(await read()).toBe(false);
    await page.getByTestId('reader-title').click();
    await expect.poll(read).toBe(true);
  });

  test('Ctrl+Z takes back the newest move while its toast is up, which stays longer', async ({
    page,
  }) => {
    await open(page, WIN);
    await tool(page, 'archive', 'freelancermap-2803');
    await settleMoves(page);
    await tool(page, 'trash', 'freelancermap-2802');
    await settleMoves(page);
    await tool(page, 'archive', 'linkedin-4100200302');
    await expect(page.getByTestId('toast-text').filter({ hasText: '2 Jobs' })).toBeVisible();
    // Still up after the 4 s of a plain toast.
    await page.waitForTimeout(4500);
    await page.keyboard.press('Control+z');
    await expect(row(page, 'linkedin-4100200302')).toBeVisible();
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
    // The trash came later, but its move was not the newest: it stays.
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-action')).toHaveCount(1);
  });

  test('the undo brings the open job back and opens it; one it did not take opens nothing', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'linkedin-4100200301');
    await page.getByTestId('reader-more').click();
    await menuItem(page, 'trash').click();
    await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(row(page, 'linkedin-4100200301')).toBeVisible();
    await expect(page.getByTestId('reader-title')).toContainText(
      'Head of Controlling Transformation',
    );
    const back = (await calls(page, 'move_back')).at(-1)?.[1] as { jobs: { to: string }[] };
    expect(back.jobs.map(({ to }) => to)).toEqual(['inbox']);
    await page.getByTestId('reader-close').click();
    await settleMoves(page);
    await tool(page, 'archive', 'freelancermap-2803');
    await page.keyboard.press('Control+z');
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });

  test('a move, an undo or a star that fails says so in the header until the next list', async ({
    page,
  }) => {
    await open(page, WIN);
    await tool(page, 'archive', 'freelancermap-2803');
    await failNext(page, 'move_back');
    await page.getByTestId('toast-action').click();
    const error = page.getByTestId('header-error');
    await expect(error).toHaveText(T.error.text('db', {}));
    await openPlace(page, 'archive');
    await expect(error).toHaveCount(0);
    await openPlace(page, 'inbox');
    await failNext(page, 'set_pinned');
    await tool(page, 'pin', 'linkedin-4100200301');
    await expect(error).toHaveText(T.error.text('db', {}));
  });

  test('deleting a job for good keeps the undo of another one', async ({ page }) => {
    await open(page, WIN);
    await tool(page, 'archive', 'freelancermap-2803');
    await settleMoves(page);
    await tool(page, 'trash', 'freelancermap-2802');
    await openPlace(page, 'trash');
    await tool(page, 'purge', 'freelancermap-2802');
    await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
    await expect(page.getByTestId('toast-text').filter({ hasText: 'gelöscht' })).toBeVisible();
    await expect(page.getByTestId('toast-action')).toHaveCount(1);
    await expect(page.getByTestId('dialog-purge')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('toast-action')).toHaveCount(0);
    await openPlace(page, 'inbox');
    await expect(row(page, 'freelancermap-2803')).toBeVisible();
  });
});

/* ===================================================================== run card */

test.describe('run card', () => {
  test('a fetch: the card runs, finishes with a line per portal, its history copies', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=30`);
    await page.getByTestId('fetch').click();
    await expect(page.getByTestId('run-running')).toBeVisible();
    // A step that finishes while the card is on screen draws its check.
    await expect(page.getByTestId('step-scan').locator('.mark')).toHaveClass(/drawn/, {
      timeout: 10_000,
    });
    await runFinished(page);
    await expect(page.getByTestId('run-finished')).toBeVisible();
    await expect(page.getByTestId('portal-line-linkedin')).toContainText('linkedin.com');
    await expect(page.getByTestId('last-new')).toBeVisible();
    await expect(page.getByTestId('run-toggle')).toHaveCount(0);
    await page.getByTestId('run-history').getByRole('button').first().click();
    const line = await page.getByTestId('run-card').locator('.history li').first().textContent();
    expect(line?.trim()).toMatch(/^\d{2}:\d{2} \S/);
    // The run re-sorts the list once it has finished: the new jobs in their places.
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    await page.getByTestId('run-close').click();
    await expect(page.getByTestId('run-card')).toHaveCount(0);
  });

  test('the counts of the last fetch lead to the inbox, the good ones first', async ({ page }) => {
    await open(page, WIN);
    await chooseFilter(page, 'newest');
    await openPlace(page, 'archive');
    await page.getByTestId('run-status').click();
    const linkedin = page.getByTestId('portal-line-linkedin');
    await expect(linkedin).toContainText('2 neu, 1 doppelt, 1 ohne Details');
    await page.getByTestId('last-top').click();
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
    await openFilter(page);
    await expect(menuItem(page, 'match')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await openPlace(page, 'trash');
    await page.getByTestId('last-new').click();
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
  });

  test('running: steps side by side, one line per portal with its countdown', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    const tops = await Promise.all(
      ['scan', 'fetch', 'score'].map(async (step) =>
        Math.round((await page.getByTestId(`step-${step}`).boundingBox())!.y),
      ),
    );
    expect(new Set(tops).size).toBe(1);
    await expect(page.getByTestId('step-fetch')).toContainText('5 von 7');
    await expect(page.getByTestId('run-running')).toContainText('Wartet auf linkedin.com');
    await expect(page.getByTestId('countdown-linkedin')).toHaveText('Weiter in 0:42');
    await expect(page.getByTestId('countdown-freelance')).toHaveText('Weiter in 12:00');
    // A card that mounts with a step already done shows a plain check.
    await expect(page.getByTestId('step-scan').locator('.mark')).not.toHaveClass(/drawn/);
    await page.getByTestId('countdown-freelance').hover();
    await expect(page.getByRole('tooltip')).toContainText(
      'Das Portal bremst die Anfragen, der Abruf macht ab 09:42 von selbst weiter.',
    );
    await page.clock.setFixedTime(new Date(NOW.getTime() + 60_000));
    await expect(page.getByTestId('countdown-linkedin')).toHaveText(T.run.resumesSoon);
  });

  test('failed: the time, why, a way to try again; cancelled says so', async ({ page }) => {
    await open(page, `${WIN}&scenario=offline`);
    await page.getByTestId('run-status').click();
    await expect(page.getByTestId('run-finished')).toContainText('08:30');
    const failed = page.getByTestId('run-failed');
    await expect(failed).toContainText('Gmail ist nicht erreichbar.');
    await failed.getByRole('button', { name: T.common.retry }).click();
    expect(await calls(page, 'start_run')).toHaveLength(1);
    await open(page, `${WIN}&tick=200`);
    await page.getByTestId('fetch').click();
    await page.getByTestId('cancel-run').click();
    await runFinished(page);
    await expect(page.getByTestId('run-finished')).toContainText(T.run.cancelled);
  });

  test('two runs in a row end idle; a rescore is no fetch', async ({ page }) => {
    await open(page, `${WIN}&tick=15`);
    for (const round of [1, 2]) {
      await page.getByTestId('fetch').click();
      await runFinished(page);
      await expect(page.getByTestId('run-finished'), `run ${round}`).toContainText(T.run.done);
      await expect(page.getByTestId('fetch'), `run ${round}`).toBeVisible();
    }
    expect(await calls(page, 'start_run')).toHaveLength(2);
    await open(page, `${WIN}&tick=15`);
    await page.getByTestId('nav-profile').click();
    await page.evaluate(() => window.__harness.appRun('rescore'));
    await runFinished(page);
    await page.getByTestId('nav-jobs').click();
    await expect(page.getByTestId('run-card')).toHaveCount(0);
    expect(await calls(page, 'start_run')).toHaveLength(0);
  });

  test('under reduced motion a run without progress still shows its bar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, `${WIN}&tick=3000`);
    await page.getByTestId('fetch').click();
    const bar = page.getByTestId('run-running').getByRole('progressbar');
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

  test('the history head darkens its chevron while pressed, only under the pointer', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=15`);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const head = page.getByTestId('run-history').locator('button').first();
    const chevron = head.locator('.chevron');
    const pressed = await tokenColour(page, '--pressed');
    const colour = (): Promise<string> => chevron.evaluate((node) => getComputedStyle(node).color);
    const box = (await head.boundingBox())!;
    const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const away = { x: box.x + box.width + 200, y: box.y + box.height + 200 };
    await page.mouse.move(away.x, away.y);
    await page.waitForTimeout(250);
    const rest = await colour();
    await page.mouse.move(on.x, on.y);
    await page.waitForTimeout(250);
    expect(await colour()).not.toBe(pressed);
    await page.mouse.down();
    await expect.poll(colour).toBe(pressed);
    await page.mouse.move(away.x, away.y, { steps: 4 });
    await expect.poll(colour).toBe(rest);
    await page.mouse.up();
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await page.mouse.move(4, 4);
  });

  test('the run card names the day of its fetch once midnight has passed', async ({ page }) => {
    await open(page, `${WIN}&tick=15`);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const time = page.getByTestId('run-finished').locator('.time');
    await expect(time).toHaveText('09:30');
    await page.clock.setFixedTime(new Date(NOW.getTime() + DAY));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(time).toHaveText(/^gestern\s09:30$/);
  });
});

/* ====================================================================== the bar */

interface Sample {
  top: number;
  height: number;
  left: number;
  opacity: number;
  moves: string[];
  row: { top: number; height: number } | null;
  key: string | null;
}

declare global {
  interface Window {
    __barSamples: Sample[];
    __barSampling: number;
  }
}

/** Records the open row's bar once per frame, as the frame is drawn, until `stopSampling`. */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__barSamples = [];
    const session = (window.__barSampling ?? 0) + 1;
    window.__barSampling = session;
    const probe = document.createElement('div');
    probe.style.setProperty('position', 'fixed');
    probe.style.setProperty('width', '1px');
    probe.style.setProperty('height', '1px');
    document.body.append(probe);
    const sample = (): void => {
      const bar = document.querySelector<HTMLElement>('[data-testid="row-bar"]');
      const frame = bar?.parentElement?.getBoundingClientRect();
      if (!bar || !frame) return;
      const box = bar.getBoundingClientRect();
      const open = bar.parentElement!.querySelector<HTMLElement>('.item[data-open]');
      const item = open?.getBoundingClientRect();
      window.__barSamples.push({
        top: box.top - frame.top,
        height: box.height,
        left: box.left - frame.left,
        opacity: Number(getComputedStyle(bar).opacity),
        moves: bar.getAnimations().map((animation) => {
          const timing = (animation.effect as KeyframeEffect).getComputedTiming();
          return `${timing.duration} ${timing.easing}`;
        }),
        row: item ? { top: item.top - frame.top, height: item.height } : null,
        key: open?.dataset['key'] ?? null,
      });
    };
    const next = (): void => {
      if (window.__barSampling !== session) {
        probe.remove();
        return;
      }
      const observer = new ResizeObserver(() => {
        observer.disconnect();
        if (window.__barSampling === session) sample();
        requestAnimationFrame(next);
      });
      observer.observe(probe);
    };
    requestAnimationFrame(next);
  });
}

async function stopSampling(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    window.__barSampling += 1;
    return window.__barSamples;
  });
}

const INSET = 12;
const onRow = (sample: Sample): boolean =>
  sample.row !== null &&
  Math.abs(sample.top - (sample.row.top + INSET)) < 1 &&
  Math.abs(sample.height - (sample.row.height - 2 * INSET)) < 1;

/** The bar at rest: shown, nothing moving, on the open row. */
async function resting(page: Page): Promise<Sample> {
  await expect
    .poll(() =>
      page
        .getByTestId('row-bar')
        .evaluate(
          (bar) => bar.getAnimations().length === 0 && getComputedStyle(bar).opacity !== '0',
        ),
    )
    .toBe(true);
  await startSampling(page);
  await expect.poll(() => page.evaluate(() => window.__barSamples.length)).toBeGreaterThan(0);
  const last = (await stopSampling(page)).at(-1)!;
  expect(last.moves).toEqual([]);
  expect(onRow(last), JSON.stringify(last)).toBe(true);
  return last;
}

test.describe("the open row's bar", () => {
  test('it slides to the clicked row like the sidebar pill; Home and End place it', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click();
    const start = await resting(page);
    expect(start.height).toBe(86 - 2 * INSET);
    await startSampling(page);
    await row(page, 'freelancermap-2803').click();
    await page.waitForTimeout(400);
    const samples = await stopSampling(page);
    expect(onRow(samples.at(-1)!)).toBe(true);
    const emphasized = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.setProperty('transition-timing-function', 'var(--ease-emphasized)');
      document.body.append(probe);
      const value = getComputedStyle(probe).transitionTimingFunction;
      probe.remove();
      return value;
    });
    expect([...new Set(samples.flatMap((sample) => sample.moves))]).toEqual([`180 ${emphasized}`]);
    // End, further than the list is high: simply there, grey on the excluded row.
    await page.keyboard.press('Home');
    await resting(page);
    await startSampling(page);
    await page.keyboard.press('End');
    await expect(row(page, 'linkedin-4100200305')).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(300);
    expect((await stopSampling(page)).flatMap((sample) => sample.moves)).not.toContainEqual(
      expect.stringMatching(/^180 /),
    );
    expect((await resting(page)).opacity).toBe(0.6);
    await page.keyboard.press('Home');
    expect((await resting(page)).top).toBe(INSET);
  });

  test('no motion when the list is built again: the view back, a search, a filter', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2803').click();
    await resting(page);
    const still = (samples: Sample[]): void => {
      const shown = samples.filter((sample) => sample.opacity > 0 && sample.row !== null);
      expect(shown.length).toBeGreaterThan(0);
      for (const sample of shown) {
        expect(
          sample.moves.filter((move) => move.startsWith('180 ')),
          JSON.stringify(sample),
        ).toEqual([]);
        expect(onRow(sample), JSON.stringify(sample)).toBe(true);
      }
    };
    await page.getByTestId('nav-profile').click();
    await settle(page);
    await startSampling(page);
    await page.getByTestId('nav-jobs').click();
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(300);
    still(await stopSampling(page));
    await startSampling(page);
    await page.getByTestId('search').fill('Leitung');
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    await page.waitForTimeout(300);
    still(await stopSampling(page));
    await page.getByTestId('search').fill('');
    await startSampling(page);
    await chooseFilter(page, 'portal-freelancermap');
    await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
    await page.waitForTimeout(300);
    still(await stopSampling(page));
  });

  test('archive and undo: the bar ends on the job that opens, in the same place', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click();
    const slot = await resting(page);
    await animationsDone(page);
    await startSampling(page);
    await page.getByTestId('reader-archive').click();
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(400);
    let samples = await stopSampling(page);
    expect(samples.at(-1)!.key).toBe('freelancermap:2803');
    for (const sample of samples) expect(sample.top, JSON.stringify(sample)).toBe(slot.top);
    await page.getByTestId('toast').last().getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2802')).toHaveAttribute('aria-current', 'true');
    expect((await resting(page)).top).toBe(slot.top);
    // Several chosen rows mark themselves; the list's bar stays still on the open one.
    await startSampling(page);
    await row(page, 'freelancermap-2803').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('selection-bar')).toContainText(T.selection.count(2));
    await page.waitForTimeout(200);
    samples = await stopSampling(page);
    expect(samples.flatMap((sample) => sample.moves)).toEqual([]);
  });

  test('it steps inside the focus ring and greys with the inactive window', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    expect((await resting(page)).left).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'linkedin-4100200301')).toBeFocused();
    await expect.poll(async () => (await resting(page)).left).toBe(2);
    const colour = (): Promise<string> =>
      page.getByTestId('row-bar').evaluate((bar) => getComputedStyle(bar).backgroundColor);
    await page.evaluate(() => (document.documentElement.dataset['window'] = 'inactive'));
    await expect.poll(colour).toBe(await tokenColour(page, '--text-subtle'));
  });
});

/* ====================================================================== sidebar */

test.describe('sidebar', () => {
  test('four views, no counts; the app starts in the Übersicht; Ctrl+1 to 4 choose', async ({
    page,
  }) => {
    await open(page, `${WIN}&view=start`);
    await expect(page.getByTestId('view-overview')).toBeVisible();
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar.locator('nav button')).toHaveText([
      T.nav.overview,
      T.nav.jobs,
      T.nav.profile,
      T.nav.settings,
    ]);
    await expect(sidebar.locator('nav .count, nav .dot')).toHaveCount(0);
    await page.keyboard.press('Control+2');
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await page.keyboard.press('Control+4');
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await page.getByTestId('nav-jobs').hover();
    await expect(page.getByRole('tooltip')).toContainText('Strg+2');
  });

  test('before the first fetch the Übersicht waits and says why', async ({ page }) => {
    await open(page, `${WIN}&scenario=first-run&view=start`);
    await expect(page.getByTestId('view-first-run')).toBeVisible();
    const overview = page.getByTestId('nav-overview');
    await expect(overview).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
    await overview.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Nach dem ersten Abruf');
  });

  for (const os of [WIN, MAC]) {
    test(`the rail keeps every entry in the window down to 480 x 360 ${os}`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 700 });
      await open(page, os);
      for (const id of ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect([box.width, box.height], id).toEqual([40, 40]);
      }
      await page.setViewportSize({ width: 480, height: 360 });
      for (const id of ['nav-overview', 'nav-jobs', 'nav-profile', 'nav-settings', 'run-status']) {
        await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
    });
  }

  test('an unsaved profile keeps the view until the question is answered', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('nav-profile').click();
    const field = page.getByTestId('view-profile').getByRole('textbox').first();
    await field.fill('Erika Muster');
    await page.getByTestId('nav-jobs').click();
    const dialog = page.getByTestId('dialog-leave-profile');
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
    await page.getByTestId('nav-jobs').click();
    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
  });
});

/* ================================================================ small windows */

test('at 480 x 360 the toolbar stays in the window; below 900 px one column', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await chooseFilter(page, 'portal-linkedin');
  for (const id of ['search', 'filter', 'fetch', 'filter-line']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width, id).toBeLessThanOrEqual(480);
  }
  await page.setViewportSize({ width: 780, height: 560 });
  await expect(page.getByTestId('reader-pane')).toBeHidden();
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('list-scroll')).toBeHidden();
  await page.getByTestId('back').click();
  await expect(page.getByTestId('list-scroll')).toBeVisible();
});

/* ==================================================================== baselines */

test('baseline: jobs with the day overview', async ({ page }) => {
  await open(page, WIN);
  await expectShot(page, 'jobs-overview');
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
