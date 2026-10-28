// The list area of the Jobs view (the approved design of 2026-09-26): the tabs Aktuell (with
// its unopened jobs), Archiv, Papierkorb; one toolbar row (the search, the funnel, Abrufen);
// the funnel's menu (the order, then the filter table) and the chips of an active filter; one list
// per place in the chosen order with the excluded jobs folded at its end; the empty states;
// the search and its hits elsewhere; moves and their undo; the run line; the open row's bar;
// the sidebar; the smallest window.
// Texts come from the catalog (T) and the filter table, the demo data from the stub
// (stubList), not typed again.

import type { Page } from '@playwright/test';
import type { JobQuery, JobView } from '../../../ui/src/lib/ipc/types';
import { RECEIVED } from '../../../ui/src/lib/state/filter';
import {
  calls,
  expect,
  expectShot,
  NOW,
  open,
  runFinished,
  settle,
  test,
  visibleCount,
} from './fixtures';
import {
  checkedSort,
  chip,
  chips,
  chipWordsOf,
  chooseFilter,
  chooseSort,
  excludedRows,
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
  settleMoves,
  reveal,
  sortEntryId,
  SORTS,
  stage,
  stubList,
  T,
  unfoldExcluded,
  viaMenu,
  WIN,
} from './helpers';

/** A typed search waits `ms` before it loads (--dur-base), time to change the list meanwhile.
 *  Tokens are read once, so it is set before the page starts. */
async function slowSearch(page: Page, ms: number): Promise<void> {
  await page.addInitScript((value) => {
    const set = (): boolean => {
      const root = document.documentElement as HTMLElement | null;
      root?.style.setProperty('--dur-base', value);
      return root !== null;
    };
    if (set()) return;
    const watch = new MutationObserver(() => {
      if (set()) watch.disconnect();
    });
    watch.observe(document, { childList: true });
  }, `${ms}ms`);
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

  test('the tabs name their place only, no numbers; the chosen one is marked', async ({ page }) => {
    await open(page, WIN);
    for (const place of ['inbox', 'archive', 'trash'] as const) {
      await expect(page.getByTestId(`place-${place}`)).toHaveText(T.place[place]);
    }
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
    await openPlace(page, 'archive');
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'false');
  });

  test('one header in the three places: the tabs with the action, the search and the funnel', async ({
    page,
  }) => {
    await open(page, WIN);
    // Aktuell: the fetch at the end of the tabs' row, the search before the funnel under it;
    // no sort button (the order is the funnel's first group).
    await expect(page.getByTestId('fetch')).toHaveAccessibleName(T.toolbar.searchNow);
    expect(await leftOf(page, 'places', 'fetch')).toBe(true);
    expect(await leftOf(page, 'search', 'filter')).toBe(true);
    await expect(page.getByTestId('sort')).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-label', T.toolbar.filter);
    expect(T.toolbar.filter).toBe('Sortieren und filtern');
    // Each place's search names its place.
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
    expect(T.place.search.inbox).toBe('Aktuelle Jobs durchsuchen');
    // Archiv: the same row, no action.
    await openPlace(page, 'archive');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(funnel(page)).toBeVisible();
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    // Papierkorb: the search, no funnel (it has no filter), no action ("Papierkorb leeren" is
    // gone: deleting for good goes job by job, asking first).
    await openPlace(page, 'trash');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.trash);
    await expect(funnel(page)).toHaveCount(0);
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
    // No second row, no count line.
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

  test('the tabs fit their row at every width', async ({ page }) => {
    const places = page.getByTestId('places');
    const fits = (): Promise<boolean> =>
      places.evaluate((node) => {
        const tabs = [...node.querySelectorAll('[role="tab"]')];
        const last = tabs.at(-1)!.getBoundingClientRect();
        const column = node.closest('[data-testid="list-header"]')!.getBoundingClientRect();
        return (
          last.right <= column.right && tabs.every((tab) => tab.scrollWidth <= tab.clientWidth)
        );
      });
    await open(page, WIN);
    expect(await fits()).toBe(true);
    for (const width of [1024, 900, 820, 640, 480]) {
      await page.setViewportSize({ width, height: 768 });
      await expect.poll(fits).toBe(true);
      await expect(page.getByTestId('place-inbox')).toContainText(T.place.inbox);
    }
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
    // Aktuell tab: the inbox as a whole, like a folder of a mail app.
    await openPlace(page, 'inbox');
    await expect(search).toHaveValue('');
    expect((await lastQuery(page))?.search).toBeNull();
    const loads = (await calls(page, 'list_jobs')).length;
    await page.getByTestId('place-inbox').click();
    await page.getByTestId('nav-jobs').click();
    await settle(page);
    expect((await calls(page, 'list_jobs')).length).toBe(loads);
  });

  test('no job anywhere: no head, the empty state in the middle with Jobs suchen; an empty place keeps its search', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=fresh`);
    // Aktuell before the first search: no head (no places, search, funnel or button above),
    // the briefcase, a heading and one sentence in the middle of the full width, and under
    // them its one primary, Jobs suchen; nothing beside the list.
    const inbox = page.getByTestId('empty-all');
    await expect(inbox.locator('h3')).toHaveText(T.list.empty.inbox.heading);
    await expect(inbox.locator('p')).toHaveText(T.list.empty.inbox.text);
    for (const id of ['list-header', 'places', 'search', 'filter']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
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
    // The Archiv and the Papierkorb, each in its words; the Papierkorb without the funnel.
    await open(page, `${WIN}&scenario=concept`);
    for (const place of ['archive', 'trash'] as const) {
      await openPlace(page, place);
      const empty = page.getByTestId(`empty-place-${place}`);
      await expect(empty.locator('h3')).toHaveText(T.list.empty[place].heading);
      await expect(empty.locator('p')).toHaveText(T.list.empty[place].text);
      await expect(page.getByTestId('search')).toBeVisible();
      await expect(funnel(page)).toHaveCount(place === 'trash' ? 0 : 1);
      await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    }
    // A job open in Aktuell closes in another place.
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    await openPlace(page, 'archive');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
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
    }
  });

  test('a list that did not load says so with a retry; the header has no tools', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=list-error`);
    const error = page.getByTestId('list-error');
    await expect(error).toContainText(T.list.loadFailed);
    // Nothing to choose beside it: the reader says nothing.
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    await expect(error.getByRole('button', { name: T.common.retry })).toBeVisible();
    await expect(funnel(page)).toHaveCount(0);
  });
});

/* ======================================================================= filter */

test.describe('filter', () => {
  test('one menu: Sortierung, Quelle, Übereinstimmung, Gefunden, none chosen', async ({ page }) => {
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
    // Every entry of the table, then the way back (off while no filter is on).
    await expect(menu.locator('[role^="menuitem"]')).toHaveText([
      ...table.flatMap((group) => group.entries),
      T.toolbar.filterReset,
    ]);
    // A group lists every value of its dimension: the three bands and the three day ranges,
    // their words under their heading without repeating it.
    for (const band of ['high', 'mid', 'low'] as const) {
      await expect(menuItem(page, `band-${band}`)).toHaveText(T.toolbar.band[band]);
      expect(T.toolbar.band[band]).not.toContain(T.toolbar.bandHeading);
    }
    for (const received of RECEIVED) {
      await expect(menuItem(page, `received-${received}`)).toHaveText(T.toolbar.received[received]);
    }
    // Quelle and Übereinstimmung take several choices (check items), Gefunden one (radio
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
    await expect(menuItem(page, 'filter-reset')).toHaveAttribute('aria-disabled', 'true');
    // The whole menu opens below the funnel and stays inside the window; with every group
    // (and more sources with jobs) it scrolls where the window is too low (2026-10-01).
    const funnelBox = (await funnel(page).boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
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
    await menuItem(page, 'sort-match').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'false');
    await menuItem(page, 'portal-linkedin').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'portal-linkedin')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'portal-freelance')).toHaveAttribute('aria-checked', 'false');
    // Both apply at once, the list follows while the menu is open.
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { sort: 'match', portals: ['linkedin'] }));
    // The way back at the end turns on once a filter is on; the menu keeps its height.
    const items = menu.locator('[role^="menuitem"]');
    await expect(items.last()).toHaveText(T.toolbar.filterReset);
    await expect(menuItem(page, 'filter-reset')).not.toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'band-mid').click();
    await expect(menuItem(page, 'band-mid')).toHaveAttribute('aria-checked', 'true');
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-linkedin', 'band-mid'),
    );
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

  test('the order sets no chip; Filter zurücksetzen keeps it, then closes', async ({ page }) => {
    await open(page, WIN);
    await chooseSort(page, 'match');
    await expect(chips(page)).toHaveCount(0);
    await openFilter(page);
    await expect(menuItem(page, 'filter-reset')).toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'received-days30').click();
    await expect(menuItem(page, 'filter-reset')).not.toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'filter-reset').click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
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
    await expect(chips(page).getByRole('button')).toHaveText(words);
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
    await expect(chips(page).getByRole('button')).toHaveText([
      T.portal.freelance,
      T.score.band.high,
    ]);
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
      const menu = await openFilter(page);
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
      const reset = menuItem(page, 'filter-reset');
      await reset.scrollIntoViewIfNeeded();
      await expect(reset, size).toBeInViewport();
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
    await chip(page, 'portal-freelance').click();
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
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-linkedin', 'band-mid'),
    );
    // Gering adds the low band: the jobs of both.
    await chooseFilter(page, 'band-low');
    const both = await inbox(page, { portals: ['linkedin'], bands: ['mid', 'low'] });
    expect(both.length).toBeGreaterThan(mid.length);
    await expect.poll(() => listed(page)).toEqual(both);
    for (const key of both) expect(['mid', 'low']).toContain(bandOf(key));
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-linkedin', 'band-mid', 'band-low'),
    );
    // A chip's × takes its choice off; the last one hands the focus to the funnel.
    await chip(page, 'band-mid').click();
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portals: ['linkedin'], bands: ['low'] }));
    await chip(page, 'band-low').click();
    await expect.poll(() => listed(page)).toEqual(linkedin);
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-linkedin'));
    await chip(page, 'portal-linkedin').click();
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(funnel(page)).toBeFocused();
  });

  test('Gefunden: the jobs of today, of the last 7 or 30 days, one choice at a time', async ({
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
    await expect(chips(page).getByRole('button')).toHaveText([T.toolbar.receivedChip.today]);
    // Letzte 7 Tage takes its place: today and the six days before it.
    await chooseFilter(page, 'received-days7');
    await expect.poll(sinceOf).toBe(await midnight(6));
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(chips(page).getByRole('button')).toHaveText([T.toolbar.receivedChip.days7]);
    await openFilter(page);
    await expect(menuItem(page, 'received-today')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'received-days7')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Kept like the rest of the filter: the next start counts from its own today.
    await open(page, WIN);
    await expect.poll(sinceOf).toBe(await midnight(6));
    await chip(page, 'received-days7').click();
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
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-freelance'));
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

  test('the filter is the same in every place and kept; Filter zurücksetzen takes it off', async ({
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
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-freelancermap', 'band-mid'),
    );
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
    await expect(chips(page).getByRole('button')).toHaveCount(2);
    await openPlace(page, 'inbox');
    await openFilter(page);
    await expect(menuItem(page, 'filter-reset')).toHaveText(T.toolbar.filterReset);
    await menuItem(page, 'filter-reset').click();
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
    for (const id of ['sort-match', 'sort-newest']) {
      await expect(menuItem(page, id)).toHaveAttribute('aria-disabled', 'true');
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
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-freelance'));
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
    const state = page.getByTestId('empty-filter');
    await expect(state).toContainText(T.list.noFilterHit);
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(funnel(page)).toBeVisible();
    await state.getByRole('button', { name: T.toolbar.filterReset }).click();
    await expect(state).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
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
    await settleMoves(page);
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
    // A job of the Archiv opens with its tab.
    await openPlace(page, 'archive');
    await openJob(page, 'linkedin-4100200306');
    await open(page, WIN);
    await expect(page.getByTestId('place-archive')).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, 'linkedin-4100200306')).toHaveAttribute('aria-current', 'true');
    // A job no longer where it lay opens nothing, and is forgotten.
    await page.evaluate((name) => {
      localStorage.setItem(
        name,
        JSON.stringify({ key: { portal: 'freelancermap', id: '2801' }, place: 'trash' }),
      );
    }, kept[0]!);
    await open(page, WIN);
    await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
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
    await expect(page.getByTestId('empty-all').getByRole('button')).toHaveCount(0);
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
    await thin.getByRole('button', { name: T.list.openProfile }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
  });

  test('a removed mailbox keeps the jobs: the search goes on, the mailbox says what it needs', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('nav-settings').click();
    await (await reveal(page, page.getByTestId('mailbox-remove'))).click();
    await page
      .getByTestId('dialog-remove-mailbox')
      .getByRole('button', { name: 'Entfernen' })
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
    for (const scenario of ['default', 'empty', 'no-profile', 'offline']) {
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
    await settleMoves(page);
    await viaMenu(page, 'trash', 'linkedin-4100200303');
    await settleMoves(page);
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
    // A little down: today's heading sticks at the top, the head has no line.
    await scroller.evaluate((node) => node.scrollTo({ top: 60 }));
    await expect
      .poll(async () =>
        Math.round((await list(page).getByTestId('day-heading').first().boundingBox())!.y),
      )
      .toBe(Math.round(top));
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
  // The first required field still empty is in view, marked.
  await expect(page.locator('[data-missing]').first()).toBeInViewport();
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
    await settleMoves(page);
    await openPlace(page, 'archive');
    menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.unarchive,
      T.actions.trash,
    ]);
    await menuItem(page, 'trash').click();
    await settleMoves(page);
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
    await expect(page.getByTestId('empty-search')).toContainText(T.list.noHit('Kernfusion'));
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(page.getByTestId('empty-search').getByRole('button')).toHaveCount(0);
    await page.getByRole('button', { name: T.field.clear }).click();
    await expect(rows(page).first()).toBeVisible();
  });

  test('hits elsewhere are a button under an empty search that goes there', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const button = page.getByTestId('also-archive');
    // Named like its tab.
    await expect(button.locator('.label')).toHaveText(T.place.archive);
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
    await settleMoves(page);
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await viaMenu(page, 'archive', key);
      await expect(row(page, key)).toHaveCount(0);
      await settleMoves(page);
    }
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await expect(page.getByTestId('toast-text')).toHaveText(T.toast.archived);
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2802')).toHaveCount(1);
    await expect(row(page, 'freelancermap-2803')).toHaveCount(1);
    await settleMoves(page);
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
      await settleMoves(page);
    }
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.trashed);
    await openPlace(page, 'trash');
    await expect(page.getByTestId('place-reader')).toContainText(T.reader.pickJob);
    // No "Papierkorb leeren": deleting for good goes job by job.
    await expect(page.getByTestId('empty-trash')).toHaveCount(0);
    await viaMenu(page, 'restore', 'freelancermap-2802');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.restored);
    await settleMoves(page);
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

  test('deleting for good hands the focus on: the row below, then the tab', async ({ page }) => {
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
      await settleMoves(page);
    }
    // The last one went: the focus is on the Papierkorb's tab, and the place says it is empty.
    await expect(page.getByTestId('place-trash')).toBeFocused();
    await expect(page.getByTestId('empty-place-trash')).toBeVisible();
  });

  test('deleting for good waits for a run: its menu entry says why', async ({ page }) => {
    await open(page, WIN);
    await viaMenu(page, 'trash', 'linkedin-4100200303');
    await settleMoves(page);
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
    await settleMoves(page);
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await settleMoves(page);
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
    await settleMoves(page);
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
    await settleMoves(page);
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
  test('three views, no counts, no tooltips beside their names; the app starts in Jobs', async ({
    page,
  }) => {
    await open(page, `${WIN}&view=start`);
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    const sidebar = page.getByTestId('sidebar');
    // Only the views: the ways under Jobs are hidden (user decision 2026-10-01).
    await expect(sidebar.locator('nav button')).toHaveText([
      T.nav.jobs,
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
      for (const id of ['nav-jobs', 'nav-profile', 'nav-settings']) {
        await expect(page.getByTestId(id), id).toBeInViewport({ ratio: 1 });
      }
    });
  }

  test('an unsaved profile keeps the view until the question is answered', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('nav-profile').click();
    await page.getByTestId('profile-wish-rate').fill('1.300');
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
