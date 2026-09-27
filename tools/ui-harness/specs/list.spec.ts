// The list area of the Jobs view (the approved design of 2026-09-26): the tabs Eingang (with
// its unopened jobs), Archiv, Papierkorb; one toolbar row (the search, the funnel, Abrufen);
// the funnel's menu (the order, then the filter table) and the chips of an active filter; one list
// per place in the chosen order with the excluded jobs folded at its end; the empty states;
// the search and its hits elsewhere; moves and their undo; the run line; the open row's bar;
// the sidebar; the smallest window.
// Texts come from the catalog (T) and the filter table, the demo data from the stub
// (stubList), not typed again.

import type { Page } from '@playwright/test';
import { ICONS } from '../../../ui/src/lib/icons';
import type { FetchRange, JobQuery, JobView } from '../../../ui/src/lib/ipc/types';
import { WORK_MODES, workModeOf } from '../../../ui/src/lib/state/filter';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  motionSettled,
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
  filterLabel,
  FILTER_GROUPS,
  filterMenu,
  funnel,
  lastQuery,
  list,
  listed,
  MAC,
  expectMenuIcons,
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
  SORTS,
  sortEntryId,
  stage,
  stubList,
  T,
  tokenColour,
  unfoldExcluded,
  viaMenu,
  WIN,
} from './helpers';

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

/* ======================================================================= header */

/** How far apart the vertical middles of two elements are, measured in the same frame (px). */
function middlesApart(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([first, second]) => {
      const middle = (id: string): number => {
        const box = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      return Math.abs(middle(first) - middle(second));
    },
    [a, b] as const,
  );
}

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
      (await stubList(page, { unread: true })).counts.inbox;
    const before = await fresh();
    // The same mails again: every job is known, nothing is added, nothing turns new.
    await page.getByTestId('fetch').click();
    await runFinished(page);
    expect(await listed(page)).toEqual(first);
    expect(await fresh()).toBe(before);
    expect(await readOf(newest)).toBe(false);
  });

  test('the tabs name their place only, no numbers; the chosen one has the line', async ({
    page,
  }) => {
    await open(page, WIN);
    for (const place of ['inbox', 'archive', 'trash'] as const) {
      await expect(page.getByTestId(`place-${place}`)).toHaveText(T.place[place]);
    }
    // 44 px high, 15 px labels (one step above the sidebar's entries), the chosen one with the
    // line under it; it slides to another choice.
    expect(Math.round((await page.getByTestId('places').boundingBox())!.height)).toBe(44);
    await expect(page.getByTestId('place-archive')).toHaveCSS('font-size', '15px');
    const under = async (place: 'inbox' | 'archive'): Promise<void> => {
      const chosen = (await page.getByTestId(`place-${place}`).boundingBox())!;
      await expect
        .poll(async () => {
          const line = (await page.getByTestId('places').locator('.line').boundingBox())!;
          return [line.x, line.width].map(Math.round);
        })
        .toEqual([chosen.x, chosen.width].map(Math.round));
    };
    await under('inbox');
    await openPlace(page, 'archive');
    await under('archive');
  });

  test('one header in the three places: the tabs with the action, the search and the funnel', async ({
    page,
  }) => {
    await open(page, WIN);
    // Eingang: "Postfach abrufen" with the Zeitraum's button at the end of the tabs' row.
    await expect(page.getByTestId('fetch')).toHaveText(T.toolbar.fetch);
    // Measured in one frame, once the header has its final layout.
    await expect.poll(() => middlesApart(page, 'places', 'fetch')).toBeLessThanOrEqual(1);
    expect(await rightOf(page, 'places')).toBeLessThan(await rightOf(page, 'fetch'));
    // The toolbar row under it: the search and the funnel on one line, left to right, the
    // funnel's right edge on the action's; no sort button (the order is the funnel's first
    // group).
    await expect.poll(() => middlesApart(page, 'search', 'filter')).toBeLessThanOrEqual(1);
    expect(await rightOf(page, 'search')).toBeLessThan(await rightOf(page, 'filter'));
    const end = await rightOf(page, 'fetch-range');
    expect(await rightOf(page, 'filter')).toBe(end);
    await expect(page.getByTestId('sort')).toHaveCount(0);
    await expect(funnel(page)).toHaveAttribute('aria-label', T.toolbar.filter);
    expect(T.toolbar.filter).toBe('Sortieren und filtern');
    // Each place's search names its place.
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.inbox);
    expect(T.place.search.inbox).toBe('Eingang durchsuchen');
    const top = (await page.getByTestId('search').boundingBox())!.y;
    // Archiv: the same row, no action.
    await openPlace(page, 'archive');
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(funnel(page)).toBeVisible();
    await expect(page.getByTestId('place-action')).toHaveCount(0);
    expect((await page.getByTestId('search').boundingBox())!.y).toBe(top);
    // Papierkorb: "Papierkorb leeren", an outlined button with the trash in red, in the
    // action's place.
    await openPlace(page, 'inbox');
    for (const key of ['freelancermap-2802', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    const empty = page.getByTestId('empty-trash');
    await expect(empty).toHaveText(T.actions.emptyTrash);
    await expect(empty).toHaveClass(/secondary/);
    await expect(empty).toHaveClass(/warns/);
    await expect(empty).toHaveCSS('color', await tokenColour(page, '--danger-strong'));
    await expect(empty.locator('svg')).toHaveClass(new RegExp(`lucide-${ICONS.trash}`));
    expect(await rightOf(page, 'empty-trash')).toBe(end);
    expect((await page.getByTestId('search').boundingBox())!.y).toBe(top);
    // No second row, no count line.
    await expect(page.getByTestId('place-count')).toHaveCount(0);
  });

  test('Postfach abrufen has the Zeitraum beside it: an outlined icon button with its menu', async ({
    page,
  }) => {
    await open(page, WIN);
    const fetch = page.getByTestId('fetch');
    const chevron = page.getByTestId('fetch-range');
    // Beside the action: the same row and height, 8 px apart; the fetch is the view's
    // primary, the Zeitraum an outlined square with its icon.
    const main = (await fetch.boundingBox())!;
    const part = (await chevron.boundingBox())!;
    expect(part.y).toBe(main.y);
    expect(part.height).toBe(main.height);
    expect(part.width).toBe(part.height);
    expect(Math.round(part.x - (main.x + main.width))).toBe(8);
    await expect(fetch).toHaveClass(/primary/);
    await expect(chevron).toHaveClass(/secondary/);
    await expect(chevron.locator('svg')).toHaveClass(new RegExp(`lucide-${ICONS.range}`));
    await expect(chevron).toHaveAttribute('aria-label', T.toolbar.range);
    await expect(chevron).toHaveAttribute('aria-haspopup', 'menu');
    // Its menu: "Zeitraum" and the four ranges, the current one checked.
    const ranges: FetchRange[] = ['sinceLast', 'days7', 'days30', 'all'];
    await chevron.click();
    const menu = page.getByTestId('menu');
    await expect(menu).toHaveAttribute('aria-label', T.toolbar.range);
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByTestId('menu-heading')).toHaveText([T.toolbar.range]);
    await expect(menu.locator('[role^="menuitem"]')).toHaveText(
      ranges.map((range) => T.toolbar.rangeName[range]),
    );
    await expect(menuItem(page, 'range-sinceLast')).toHaveAttribute('aria-checked', 'true');
    // Right edge on the control's.
    const box = (await menu.boundingBox())!;
    expect(Math.abs(box.x + box.width - (part.x + part.width))).toBeLessThanOrEqual(1);
    // A choice is saved at once through the settings patch, and the menu closes.
    await menuItem(page, 'range-days30').click();
    await expect(menu).toHaveCount(0);
    await expect
      .poll(async () => (await calls(page, 'save_settings')).at(-1)?.[1])
      .toMatchObject({ patch: { fetchRange: 'days30', portals: [], exportExcel: null } });
    await chevron.click();
    await expect(menuItem(page, 'range-days30')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'range-sinceLast')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    // The fetch itself still starts from the main part.
    await fetch.click();
    await expect(page.getByTestId('cancel-run')).toBeVisible();
    await expect(chevron).toHaveCount(0);
    await page.getByTestId('cancel-run').click();
    await runFinished(page);
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

  test('Postfach abrufen and Abbrechen share one slot; the hairline shows once the list scrolls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 600 });
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

  test('an empty place has nothing to search, order or filter; the open inbox job closes there', async ({
    page,
  }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    const top = (await page.getByTestId('list-scroll').boundingBox())!.y;
    await openPlace(page, 'trash');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    await expect(page.getByTestId('empty-place-trash')).toHaveText(T.place.empty.trash);
    for (const id of ['search', 'filter', 'place-action']) {
      await expect(page.getByTestId(id), id).toHaveCount(0);
    }
    // The list says it: the reader beside it adds no second empty state.
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    // The row stays: the list starts where it starts in the other places.
    expect((await page.getByTestId('list-scroll').boundingBox())!.y).toBe(top);
  });

  test('a fetch into an empty Eingang leaves no empty band: the search row stands above the run line', async ({
    page,
  }) => {
    for (const platform of [WIN, MAC]) {
      // Where the search stands under the tabs in a list with jobs.
      await open(page, platform);
      const under = async (): Promise<number> => {
        const tabs = (await page.getByTestId('places').boundingBox())!;
        return (await page.getByTestId('search').boundingBox())!.y - (tabs.y + tabs.height);
      };
      const usual = await under();
      await open(page, `${platform}&scenario=empty&tick=40`);
      await expect(page.getByTestId('search')).toHaveCount(0);
      await page.evaluate(() => (window.__harness.holdAfter = 4));
      await page.getByTestId('fetch').click();
      const line = page.getByTestId('run-line');
      await expect(line).toBeVisible();
      // The row under the tabs holds the search and the funnel; the run line follows it.
      const search = (await page.getByTestId('search').boundingBox())!;
      await expect(funnel(page)).toBeVisible();
      await animationsDone(page);
      const at = (await line.boundingBox())!;
      expect(at.y - (search.y + search.height)).toBeLessThanOrEqual(16);
      expect(Math.abs((await under()) - usual)).toBeLessThan(1);
      // The first jobs come in: nothing above them moves.
      await page.evaluate(() => (window.__harness.holdAfter = null));
      await expect.poll(async () => (await listed(page)).length).toBeGreaterThan(0);
      expect((await page.getByTestId('search').boundingBox())!.y).toBe(search.y);
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
  test('one menu: Sortierung, Portal, Übereinstimmung, Vertragsart, Arbeitsmodell, Nur neue, none chosen', async ({
    page,
  }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    await expect(funnel(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toHaveAttribute('aria-label', T.toolbar.filter);
    const table = filterMenu();
    await expect(menu.getByTestId('menu-heading')).toHaveText([
      T.toolbar.sortHeading,
      T.toolbar.portalHeading,
      T.toolbar.bandHeading,
      T.toolbar.contractHeading,
      T.toolbar.workHeading,
    ]);
    await expect(menu.getByTestId('menu-heading')).toHaveText(
      table.flatMap((group) => (group.heading === null ? [] : [group.heading])),
    );
    // Every entry of the table, then the way back (off while no filter is on).
    await expect(menu.locator('[role^="menuitem"]')).toHaveText([
      ...table.flatMap((group) => group.entries),
      T.toolbar.filterReset,
    ]);
    // A line before every group and the way back; switches of their own share theirs.
    const lone = (group: (typeof table)[number]): boolean =>
      group.heading === null && group.entries.length === 1;
    const shared = table.filter((group, at) => at > 0 && lone(group) && lone(table[at - 1]!));
    await expect(menu.getByRole('separator')).toHaveCount(table.length - shared.length);
    // A group lists every value of its dimension: the three bands and the three work modes,
    // their words under their heading without repeating it.
    for (const band of ['high', 'mid', 'low'] as const) {
      await expect(menuItem(page, `band-${band}`)).toHaveText(T.toolbar.band[band]);
      expect(T.toolbar.band[band]).not.toContain(T.toolbar.bandHeading);
    }
    for (const mode of ['remote', 'hybrid', 'onsite'] as const) {
      await expect(menuItem(page, `mode-${mode}`)).toHaveText(T.toolbar.work[mode]);
    }
    // The choices of a group are radio items, none checked while the group filters nothing;
    // Nur neue is a switch of its own. There is no deadline and no pay filter.
    for (const id of ['portal-linkedin', 'band-mid', 'contract-interim', 'mode-remote']) {
      await expect(menuItem(page, id)).toHaveAttribute('role', 'menuitemradio');
      await expect(menuItem(page, id)).toHaveAttribute('aria-checked', 'false');
    }
    await expect(menuItem(page, 'unread-only')).toHaveAttribute('role', 'menuitemcheckbox');
    await expect(menuItem(page, 'unread-only')).toHaveAttribute('aria-checked', 'false');
    for (const gone of ['deadline-soon', 'pay-min', 'pay-wish', 'remote-only', 'remote-hybrid']) {
      await expect(menuItem(page, gone)).toHaveCount(0);
    }
    await expect(menu).not.toContainText('Frist');
    // The portals in the UI's order (lib/portals.ts), the same as Einstellungen.
    const portals = await menu
      .locator('[data-testid^="menu-item-portal-"]')
      .evaluateAll((all) => all.map((item) => item.getAttribute('data-testid')));
    expect(portals).toEqual([
      'menu-item-portal-freelance',
      'menu-item-portal-linkedin',
      'menu-item-portal-freelancermap',
    ]);
    await expect(menuItem(page, 'portal-freelance')).toHaveText(T.portal.freelance);
    await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'false');
    await expect(menuItem(page, 'filter-reset')).toHaveAttribute('aria-disabled', 'true');
    // The whole menu opens below the funnel in the usual window, nothing to scroll.
    const funnelBox = (await funnel(page).boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeGreaterThanOrEqual(funnelBox.y + funnelBox.height);
    expect(await menu.evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(0);
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
    await menuItem(page, 'sort-newest').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'sort-match')).toHaveAttribute('aria-checked', 'false');
    await menuItem(page, 'portal-linkedin').click();
    await expect(menu).toBeVisible();
    await expect(menuItem(page, 'portal-linkedin')).toHaveAttribute('aria-checked', 'true');
    await expect(menuItem(page, 'portal-freelance')).toHaveAttribute('aria-checked', 'false');
    // Both apply at once, the list follows while the menu is open.
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { sort: 'newest', portal: 'linkedin' }));
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
      sort: 'newest',
      portal: 'linkedin',
      band: 'mid',
    });
  });

  test('the order sets no dot and no chip; Filter zurücksetzen keeps it, then closes', async ({
    page,
  }) => {
    await open(page, WIN);
    await chooseSort(page, 'newest');
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
    await openFilter(page);
    await expect(menuItem(page, 'filter-reset')).toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'contract-interim').click();
    await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
    await expect(menuItem(page, 'filter-reset')).not.toHaveAttribute('aria-disabled', 'true');
    await menuItem(page, 'filter-reset').click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await expect(chips(page)).toHaveCount(0);
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    expect(await checkedSort(page)).toBe('newest');
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { sort: 'newest' }));
  });

  test('the same control in the Eingang, the Archiv and the Papierkorb, kept for every list', async ({
    page,
  }) => {
    await open(page, WIN);
    await viaMenu(page, 'trash', 'freelancermap-2802');
    await settleMoves(page);
    await chooseSort(page, 'newest');
    await chooseFilter(page, 'portal-freelancermap');
    for (const place of ['inbox', 'archive', 'trash'] as const) {
      await openPlace(page, place);
      await expect(page.getByTestId('sort')).toHaveCount(0);
      await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
      await expect(chip(page, 'portal')).toHaveText(filterLabel('portal-freelancermap'));
      expect(await lastQuery(page)).toMatchObject({
        place,
        sort: 'newest',
        portal: 'freelancermap',
      });
      const menu = await openFilter(page);
      await expect(menu.getByTestId('menu-heading')).toHaveText(
        filterMenu().flatMap((group) => (group.heading === null ? [] : [group.heading])),
      );
      await expect(menuItem(page, 'sort-newest')).toHaveAttribute('aria-checked', 'true');
      await expect(menuItem(page, 'portal-freelancermap')).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
    }
  });

  test('the chips follow the menu: the groups in its order', async ({ page }) => {
    await open(page, WIN);
    const menu = await openFilter(page);
    // Picked from the last group to the first: the chips still stand in the menu's order.
    for (const id of ['mode-remote', 'contract-freelance', 'band-mid', 'portal-freelance']) {
      await menuItem(page, id).click();
    }
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    // The band's chip says its heading with it: the ring's name of the band.
    await expect(chips(page).getByRole('button')).toHaveText([
      T.portal.freelance,
      T.score.band.mid,
      filterLabel('contract-freelance'),
      T.toolbar.work.remote,
    ]);
    expect(
      chipWordsOf('mode-remote', 'contract-freelance', 'band-mid', 'portal-freelance'),
    ).toEqual([
      T.portal.freelance,
      T.score.band.mid,
      filterLabel('contract-freelance'),
      T.toolbar.work.remote,
    ]);
    // A second choice takes a part off again, the menu stays.
    await openFilter(page);
    await expect(menuItem(page, 'mode-remote')).toHaveAttribute('aria-checked', 'true');
    await menuItem(page, 'mode-remote').click();
    await expect(menuItem(page, 'mode-remote')).toHaveAttribute('aria-checked', 'false');
    await menuItem(page, 'band-mid').click();
    await expect(menuItem(page, 'band-mid')).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chip(page, 'workMode')).toHaveCount(0);
    await expect(chip(page, 'band')).toHaveCount(0);
  });

  test('the menu keeps its height when a first filter is chosen, inside a small window', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page, WIN);
    const menu = await openFilter(page);
    const before = (await menu.boundingBox())!;
    await menuItem(page, 'portal-linkedin').click();
    await expect(menuItem(page, 'filter-reset')).not.toHaveAttribute('aria-disabled', 'true');
    const after = (await menu.boundingBox())!;
    expect(after).toEqual(before);
    // Its last entry stands inside the window, within reach.
    const reset = (await menuItem(page, 'filter-reset').boundingBox())!;
    expect(reset.y + reset.height).toBeLessThanOrEqual(768);
    await page.keyboard.press('Escape');
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
    await expect(chip(page, 'portal')).toHaveText(filterLabel('portal-linkedin'));
    await expect(menuItem(page, 'portal-linkedin')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(active).toBe('menu-item-portal-linkedin');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('menu')).toHaveCount(0);
  });

  test('the portal and the band narrow the list; each stands as a chip with its ×', async ({
    page,
  }) => {
    await open(page, WIN);
    const { jobs, active: all } = await stubList(page);
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    await chooseFilter(page, 'portal-linkedin');
    const linkedin = await inbox(page, { portal: 'linkedin' });
    expect(linkedin.every((key) => key.startsWith('linkedin-'))).toBe(true);
    await expect.poll(() => listed(page)).toEqual(linkedin);
    expect(await lastQuery(page)).toMatchObject({ portal: 'linkedin', band: null });
    await expect(funnel(page).getByTestId('button-dot')).toHaveCSS(
      'background-color',
      await tokenColour(page, '--unread'),
    );
    await chooseFilter(page, 'band-mid');
    const mid = await inbox(page, { portal: 'linkedin', band: 'mid' });
    expect(mid.length).toBeGreaterThan(0);
    await expect.poll(() => listed(page)).toEqual(mid);
    expect(await lastQuery(page)).toMatchObject({ portal: 'linkedin', band: 'mid' });
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
    // Gering takes the band's place: only the low band.
    await chooseFilter(page, 'band-low');
    const low = await inbox(page, { portal: 'linkedin', band: 'low' });
    expect(low.length).toBeGreaterThan(0);
    await expect.poll(() => listed(page)).toEqual(low);
    for (const key of low) expect(bandOf(key)).toBe('low');
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-linkedin', 'band-low'),
    );
    // A chip's × takes its part off; the last one hands the focus to the funnel.
    await chip(page, 'band').click();
    await expect.poll(() => listed(page)).toEqual(linkedin);
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-linkedin'));
    await chip(page, 'portal').click();
    await expect(chips(page)).toHaveCount(0);
    await expect.poll(() => listed(page)).toEqual(all);
    await expect(funnel(page)).toBeFocused();
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
  });

  test('the work mode and Nur neue narrow the list; each a chip', async ({ page }) => {
    await open(page, WIN);
    const { jobs, active: all } = await stubList(page);
    const jobOf = (key: string): JobView => jobs.find((job) => keyOf(job) === key)!;
    // Remote, Hybrid, Vor Ort: each takes the place of the one before in the same group and
    // lists the jobs of its mode as the Jobdetails name it (the stated share first, the
    // location without one).
    const moded: string[] = [];
    for (const mode of WORK_MODES) {
      await chooseFilter(page, `mode-${mode}`);
      const listedMode = await inbox(page, { workMode: mode });
      expect(listedMode.length).toBeGreaterThan(0);
      await expect.poll(() => listed(page)).toEqual(listedMode);
      expect(await lastQuery(page)).toMatchObject({ workMode: mode });
      await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf(`mode-${mode}`));
      for (const key of listedMode) expect(workModeOf(jobOf(key))).toBe(mode);
      moded.push(...listedMode);
    }
    // A share the ad states wins over a location that says nothing.
    const stated = all.find((key) => {
      const job = jobOf(key);
      return job.workMode === null && (job.match?.facts.remoteFrom ?? null) !== null;
    });
    expect(stated).toBeDefined();
    expect(moded).toContain(stated);
    // A job whose mode is unknown passes none of the three.
    const unknown = all.filter((key) => !moded.includes(key));
    expect(unknown.length).toBeGreaterThan(0);
    for (const key of unknown) expect(workModeOf(jobOf(key))).toBeNull();
    await chip(page, 'workMode').click();
    // Nur neue: the jobs not opened yet and not excluded, its counts too.
    await chooseFilter(page, 'unread-only');
    const fresh = await inbox(page, { unread: true });
    expect(fresh.length).toBeGreaterThan(0);
    await expect.poll(() => listed(page)).toEqual(fresh);
    expect(await lastQuery(page)).toMatchObject({ unread: true });
    for (const key of fresh) {
      const job = jobs.find((each) => keyOf(each) === key);
      expect(job?.unread && job.match?.status !== 'excluded', key).toBe(true);
    }
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('unread-only'));
    // Kept like the rest of the filter; the list asks for no deadline and no pay.
    await open(page, WIN);
    const kept = await lastQuery(page);
    expect(kept).toMatchObject({ unread: true, band: null, workMode: null });
    for (const gone of ['deadlineSoon', 'minDayRate', 'minSalary', 'minBand', 'remoteOnly']) {
      expect(kept).not.toHaveProperty(gone);
    }
  });

  test('a filter kept by an earlier version: its lowest band, work mode and pay floor are none', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'jobs-filter',
        JSON.stringify({ portal: 'linkedin', minBand: 'mid', remote: 'remote', pay: 'min' }),
      ),
    );
    await open(page, WIN);
    expect(await lastQuery(page)).toMatchObject({
      portal: 'linkedin',
      band: null,
      workMode: null,
      contracts: [],
    });
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-linkedin'));
    await expect.poll(() => listed(page)).toEqual(await inbox(page, { portal: 'linkedin' }));
    await openFilter(page);
    for (const id of ['band-mid', 'mode-remote']) {
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
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
  });

  test('the chips unfold under the toolbar and fold away: the list glides, nothing jumps', async ({
    page,
  }) => {
    await open(page, WIN);
    await openFilter(page);
    // Picked in the page itself, so the next frame can be watched.
    const unfolding = await page.evaluate(async () => {
      document.querySelector<HTMLElement>('[data-testid="menu-item-portal-linkedin"]')!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const wrapper = document.querySelector('[data-testid="filter-chips"]')!.parentElement!;
      return wrapper
        .getAnimations()
        .some((animation) =>
          ((animation.effect as KeyframeEffect).getKeyframes() ?? []).some(
            (key) => 'height' in key,
          ),
        );
    });
    expect(unfolding).toBe(true);
    await animationsDone(page);
    const folding = await page.evaluate(async () => {
      const wrapper = document.querySelector('[data-testid="filter-chips"]')!.parentElement!;
      document.querySelector<HTMLElement>('[data-testid="chip-portal"]')!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return wrapper.getAnimations().length;
    });
    expect(folding).toBeGreaterThan(0);
    await expect(chips(page)).toHaveCount(0);
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
      .toEqual(await inbox(page, { portal: 'freelancermap', band: 'mid' }));
    // The app starts again: the same filter.
    await open(page, WIN);
    await expect(chips(page).getByRole('button')).toHaveText(
      chipWordsOf('portal-freelancermap', 'band-mid'),
    );
    expect(await lastQuery(page)).toMatchObject({ portal: 'freelancermap', band: 'mid' });
    // The archive lists with it too.
    await openPlace(page, 'archive');
    expect(await lastQuery(page)).toMatchObject({
      place: 'archive',
      portal: 'freelancermap',
      band: 'mid',
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
      localStorage.setItem('jobs-filter', JSON.stringify({ band: 'high' })),
    );
    await open(page, `${WIN}&scenario=no-profile`);
    await expect(funnel(page).getByTestId('button-dot')).toHaveCount(0);
    expect(await lastQuery(page)).toMatchObject({ sort: 'newest', band: null });
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
    expect(await lastQuery(page)).toMatchObject({ portal: 'freelance', band: null });
    await expect
      .poll(() => listed(page))
      .toEqual(await inbox(page, { portal: 'freelance', sort: 'newest' }));
    expect(await kept()).toEqual({ ...NO_FILTER, portal: 'freelance', band: 'high' });
    await expect(chips(page).getByRole('button')).toHaveText(chipWordsOf('portal-freelance'));
  });

  test('a filter that leaves nothing says so once and takes itself off', async ({ page }) => {
    await open(page, WIN);
    // A portal whose inbox has no job of the high band.
    let empty: string | null = null;
    for (const portal of ['freelance', 'freelancermap', 'linkedin'] as const) {
      const { active, excluded: out } = await stubList(page, { portal, band: 'high' });
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
    const high = await inbox(page, { band: 'high' });
    expect(high).toContain('freelancermap-2801');
    await expect.poll(() => listed(page)).toEqual(high);
    await expect(page.getByTestId('reader-title')).toBeVisible();
    await expect(row(page, 'freelancermap-2801')).toHaveAttribute('aria-current', 'true');
    await chooseFilter(page, 'portal-linkedin');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
    expect(await listed(page)).toEqual(await inbox(page, { band: 'high', portal: 'linkedin' }));
  });

  test('macOS: the same funnel, menu and chips', async ({ page }) => {
    await open(page, MAC);
    await chooseFilter(page, 'portal-linkedin');
    await expect(rows(page)).toHaveCount((await inbox(page, { portal: 'linkedin' })).length);
    await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
    await expect(chip(page, 'portal')).toHaveText(filterLabel('portal-linkedin'));
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
    expect(await lastQuery(page)).toMatchObject({ unread: false });
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

  test('new is unread and not excluded: the dot in every place, Nur neue lists those rows', async ({
    page,
  }) => {
    await open(page, WIN);
    const { jobs } = await stubList(page);
    const isNew = (job: JobView): boolean => job.unread && !excluded(job);
    const fresh = jobs.filter(isNew).map(keyOf).sort();
    /** The keys of the mounted rows that carry the dot (the fold's too). */
    const dotted = async (): Promise<string[]> =>
      (
        await list(page)
          .locator('[data-testid^="job-row-"]')
          .evaluateAll((items) =>
            items
              .filter((item) => item.closest('.job')?.querySelector('.dot') != null)
              .map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
          )
      ).sort();
    // An unread excluded job carries none: it is no new one.
    expect(jobs.some((job) => job.unread && excluded(job))).toBe(true);
    await unfoldExcluded(page);
    expect(await dotted()).toEqual(fresh);
    // "Nur neue" lists exactly the dotted rows, no excluded one behind the fold.
    await chooseFilter(page, 'unread-only');
    await expect.poll(async () => (await listed(page)).sort()).toEqual(fresh);
    await expect(page.getByTestId('excluded-divider')).toHaveCount(0);
    await chip(page, 'unread').click();
    // A new job moved to the Archiv keeps its dot there, like a mail app's unread mark.
    const moved = fresh[0]!;
    await viaMenu(page, 'archive', moved);
    await settleMoves(page);
    await openPlace(page, 'archive');
    await expect.poll(dotted).toContain(moved);
  });

  test('the excluded jobs are one folded section at the end, counted per place; kept open', async ({
    page,
  }) => {
    await open(page, WIN);
    const { active, excluded: out } = await stubList(page);
    expect(out.length).toBeGreaterThan(1);
    const divider = page.getByTestId('excluded-divider');
    const count = divider.locator('.count');
    // Its count after the label, quiet like the tabs' (no brackets).
    await expect(divider).toHaveText(`${T.list.excluded}${out.length}`);
    await expect(count).toHaveText(String(out.length));
    await expect(count).toHaveCSS('color', await tokenColour(page, '--text-subtle'));
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    const last = (await rows(page).last().boundingBox())!;
    expect((await divider.boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height);
    await divider.click();
    await expect(excludedRows(page)).toHaveCount(out.length);
    // Rows like every other, the ban in the ring's place, no reason.
    await expect(excludedRows(page).first().getByTestId('row-excluded')).toBeVisible();
    await expect(excludedRows(page).first().locator('.foot')).toHaveCount(0);
    // Kept: the next start shows it open; an archived job is in no list of the inbox.
    await open(page, WIN);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'linkedin-4100200306')).toHaveCount(0);
    expect(await listed(page)).toEqual(active);
    // Each place counts its own excluded jobs.
    await viaMenu(page, 'archive', out[0]!);
    await expect(count).toHaveText(String(out.length - 1));
    await openPlace(page, 'archive');
    await expect(count).toHaveText('1');
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
    await stage(page).getByTestId('reader-close').click();
    await open(page, WIN);
    await expect(page.getByTestId('place-reader')).toBeVisible();
  });

  test('the order is kept for every list and keeps the open job', async ({ page }) => {
    await open(page, WIN);
    await openJob(page, 'freelancermap-2803');
    await chooseSort(page, 'newest');
    const newest = await inbox(page, { sort: 'newest' });
    expect(newest).not.toEqual(await inbox(page));
    await expect.poll(() => listed(page)).toEqual(newest);
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'freelancermap-2803')).toBeInViewport();
    await openPlace(page, 'archive');
    expect(await checkedSort(page)).toBe('newest');
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
    await expect(page.getByTestId('run-line')).toBeVisible();
    const before = await rows(page).count();
    await watch(600, '[data-testid="cancel-run"]');
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
    await chooseSort(page, 'newest');
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

  test('loading takes a moment: placeholder rows shaped like rows, then the rows in their place', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=slow`);
    const skeleton = page.getByTestId('list-skeleton');
    await expect(skeleton).toBeVisible();
    // Each placeholder row: the ring, the title with the stamp at its end, the second line.
    const first = skeleton.locator('.skeleton-row').first();
    await expect(first.locator('.skeleton.circle')).toHaveCount(1);
    await expect(first.locator('.title .skeleton')).toHaveCount(2);
    await expect(first.locator('.skeleton')).toHaveCount(4);
    await expect(first.locator('.skeleton').first()).toHaveCSS('opacity', '1');
    const placeholder = (await first.boundingBox())!;
    // The rows take the placeholders' place: the same top, the same height.
    await expect(rows(page).first()).toBeVisible({ timeout: 5000 });
    await expect(skeleton).toHaveCount(0);
    const row = (await rows(page).first().boundingBox())!;
    expect(Math.abs(row.y - placeholder.y)).toBeLessThan(1);
    expect(Math.abs(row.height - placeholder.height)).toBeLessThan(1);
  });

  test('an empty inbox says what comes: an icon, one sentence and Postfach abrufen', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=empty`);
    const empty = page.getByTestId('empty-all');
    await expect(empty).toBeVisible();
    // The place's own icon, like the empty Archiv and Papierkorb.
    await expect(empty.locator('.tile svg, svg').first()).toHaveClass(
      new RegExp(`lucide-${ICONS.inbox}`),
    );
    // The way on: a fetch, secondary (the header holds the view's primary).
    const fetch = empty.getByRole('button', { name: T.toolbar.fetch });
    await expect(empty.getByRole('button')).toHaveCount(1);
    await expect(fetch).toHaveClass(/secondary/);
    await expect(fetch.locator('svg')).toHaveClass(new RegExp(`lucide-${ICONS.fetch}`));
    expect(await visibleCount(page, '[data-testid^="empty-"]')).toBe(1);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    for (const gone of ['alert-linkedin', 'read-older']) {
      await expect(page.getByTestId(gone)).toHaveCount(0);
    }
    // The same place in the column as the empty Archiv's.
    const at = (await empty.boundingBox())!;
    await openPlace(page, 'archive');
    const archive = (await page.getByTestId('empty-place-archive').boundingBox())!;
    expect(Math.abs(archive.y + archive.height / 2 - (at.y + at.height / 2))).toBeLessThan(1);
    await openPlace(page, 'inbox');
    await page.getByTestId('empty-all').getByRole('button', { name: T.toolbar.fetch }).click();
    expect((await calls(page, 'start_run')).at(-1)?.[1]).toMatchObject({
      request: { kind: 'fetch' },
    });
    // While the fetch goes the list says the jobs come, and offers no second fetch.
    await expect(page.getByTestId('empty-all')).toContainText(T.list.emptyWhileRun);
    await expect(page.getByTestId('empty-all').getByRole('button')).toHaveCount(0);
  });

  test('an empty inbox without a mailbox says so once and leads to the mailbox card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 600 });
    await open(page, `${WIN}&scenario=empty`);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('mailbox-remove').click();
    await page
      .getByTestId('dialog-remove-mailbox')
      .getByRole('button', { name: T.common.remove })
      .click();
    await expect(page.getByTestId('mailbox-connect')).toBeVisible();
    // Einstellungen scrolled down: the way back opens it at the mailbox card anyway.
    await page.getByTestId('view-settings').evaluate((view) => {
      const scroller = [view, ...view.querySelectorAll<HTMLElement>('*')].find(
        (node) => node.scrollHeight > node.clientHeight + 1,
      );
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });
    await expect(page.getByTestId('settings-mailbox')).not.toBeInViewport();
    await page.getByTestId('nav-jobs').click();
    const empty = page.getByTestId('empty-all');
    await expect(empty).toContainText(T.list.noMailbox);
    await expect(page.getByTestId('no-mailbox')).toHaveCount(0);
    await empty.getByRole('button', { name: T.list.connectMailbox }).click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    await expect(page.getByTestId('settings-mailbox')).toBeInViewport();
    await expect(page.getByTestId('mailbox-connect')).toBeFocused();
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
    // A split control is one button: its chevron's part wears the colour of its action.
    const primary = '.btn.primary:not(.joined-end)';
    for (const scenario of ['default', 'empty', 'no-profile', 'offline']) {
      await open(page, `${WIN}&scenario=${scenario}`);
      expect(await visibleCount(page, primary), scenario).toBeLessThanOrEqual(1);
    }
    await open(page, WIN);
    await openJob(page, 'freelancermap-2801');
    expect(await visibleCount(page, primary)).toBeLessThanOrEqual(1);
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
    expect([...new Set(heights)]).toEqual([64]);
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
    // Without a profile the rows keep the one height.
    await open(page, `${WIN}&scenario=no-profile`);
    expect((await rows(page).first().boundingBox())!.height).toBe(64);
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

  test('the menu of a row in each place: its entries in order, their icons, no keys', async ({
    page,
  }) => {
    await open(page, WIN);
    const shows = [T.actions.open, T.actions.mail, T.actions.openAd, T.actions.prompt];
    const showIcons = ['open', 'alertMail', 'external', 'prompt'] as const;
    // Eingang.
    let menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu).toHaveAttribute('aria-label', T.menu.job);
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.archive,
      T.actions.trash,
    ]);
    await expectMenuIcons(page, [...showIcons, 'archive', 'trash']);
    // Deleting is one look everywhere: the trash, in red.
    await expect(menuItem(page, 'trash')).toHaveClass(/danger/);
    await expect(menuItem(page, 'archive')).not.toHaveClass(/danger/);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    await expect(menu.locator('.keys')).toHaveCount(0);
    await expect(menuItem(page, 'unread')).toHaveCount(0);
    // "Öffnen" opens the job; the open job's own menu has none.
    await menuItem(page, 'open').click();
    await expect(page.getByTestId('reader-title')).toHaveText(
      await row(page, 'freelancermap-2802').locator('.title').innerText(),
    );
    await rowMenu(page, 'freelancermap-2802');
    await expect(menuItem(page, 'open')).toHaveCount(0);
    await expect(menuItem(page, 'mail')).toBeVisible();
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
    await expectMenuIcons(page, [...showIcons, 'unarchive', 'trash']);
    await menuItem(page, 'trash').click();
    await settleMoves(page);
    // The trash: restore, delete for good (red).
    await openPlace(page, 'trash');
    menu = await rowMenu(page, 'freelancermap-2802');
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      ...shows,
      T.actions.restore,
      T.actions.purge,
    ]);
    await expectMenuIcons(page, [...showIcons, 'undo', 'trash']);
    await expect(menuItem(page, 'purge')).toHaveClass(/danger/);
    await expect(menuItem(page, 'restore')).not.toHaveClass(/danger/);
  });

  test('an excluded job counts anyway from its menu, with an undo, and can be excluded again', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    const key = 'linkedin-4100200305';
    await expect(page.getByTestId('excluded-rows').getByTestId(`job-row-${key}`)).toBeVisible();
    const menu = await rowMenu(page, key);
    await expect(menu.getByRole('menuitem').locator('.label')).toHaveText([
      T.actions.open,
      T.actions.mail,
      T.actions.openAd,
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
    await rowMenu(page, key);
    await expect(menuItem(page, 'exclude')).toHaveText(T.actions.exclude);
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

  test('a list ring that waits is the one empty ring with its dash, nothing moves', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=running`);
    await settle(page);
    const ring = list(page)
      .locator('.job', { has: page.getByTestId('job-row-linkedin-4100200302') })
      .locator('.ring');
    await expect(ring).toHaveClass(/pending/);
    await expect(ring.locator('.center')).toHaveText('–');
    // One track, no arc; nothing loops (a change of the ring's colours may still be ending
    // right after the start on a busy machine, so the check waits for it).
    expect(await ring.evaluate((node) => node.querySelectorAll('circle').length)).toBe(1);
    await expect
      .poll(() => ring.evaluate((node) => node.getAnimations({ subtree: true }).length))
      .toBe(0);
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
    await expect(marks.first()).toHaveCSS('background-color', await tokenColour(page, '--mark'));
    // The title keeps its ink and its one line; the full title in its tooltip.
    await expect(target.locator('.title')).toHaveText('Kaufmännische Leitung Projektgeschäft');
    await expect(marks.first()).toHaveCSS('color', await tokenColour(page, '--text'));
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

  test('hits elsewhere are a button that goes there, centred under an empty search', async ({
    page,
  }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const button = page.getByTestId('also-archive');
    await expect(button.locator('.label')).toHaveText(T.place.hitsIn.archive);
    await expect(button.locator('.count')).toHaveText('1');
    const a = (await page.getByTestId('empty-search').boundingBox())!;
    const b = (await button.boundingBox())!;
    expect(Math.abs(a.x + a.width / 2 - (b.x + b.width / 2))).toBeLessThan(2);
    // The one way on under an empty state: a field button, as far below the sentence as the
    // empty state's own (16 px).
    expect(Math.round(b.height)).toBe(32);
    const sentence = (await page.getByTestId('empty-search').locator('.text').boundingBox())!;
    expect(Math.round(b.y - (sentence.y + sentence.height))).toBe(16);
    // The reader beside a search without hits has nothing to choose from: it says nothing.
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
    await button.click();
    await expect(page.getByTestId('search')).toHaveAttribute('placeholder', T.place.search.archive);
    await expect(rows(page)).toHaveCount(1);
  });

  test('the hits elsewhere count with the filter, as the other place lists them', async ({
    page,
  }) => {
    await open(page, WIN);
    // The archived job is a linkedin one: another portal's filter hides it there too.
    await chooseFilter(page, 'portal-freelance');
    await page.getByTestId('search').fill('Kreditoren');
    await expect(page.getByTestId('empty-search')).toBeVisible();
    await expect(page.getByTestId('also-archive')).toHaveCount(0);
    await chooseFilter(page, 'portal-linkedin');
    await expect(page.getByTestId('also-archive').locator('.count')).toHaveText('1');
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

/* ======================================================================== moves */

test.describe('moves and undo', () => {
  test('archive from the row: short toasts that merge, one undo, In den Eingang', async ({
    page,
  }) => {
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

  test('the Papierkorb: restore, delete for good and empty it, asking first', async ({ page }) => {
    await open(page, WIN);
    for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.trashed);
    await openPlace(page, 'trash');
    await expect(page.getByTestId('place-reader')).toHaveText(T.place.pickJob);
    await viaMenu(page, 'restore', 'freelancermap-2802');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.restored);
    await settleMoves(page);
    // Endgültig löschen asks first, with its own verb on the button and no title.
    await viaMenu(page, 'purge', 'freelancermap-2803');
    const dialog = page.getByTestId('dialog-purge');
    await expect(dialog.getByRole('heading')).toHaveText(T.actions.purgeHeading(1));
    await dialog.getByRole('button', { name: T.actions.purgeConfirm, exact: true }).click();
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('toast-text').last()).toHaveText(T.toast.deleted);
    expect((await calls(page, 'purge_jobs')).map(([, args]) => args)).toEqual([
      { keys: [{ portal: 'freelancermap', id: '2803' }] },
    ]);
    // The last row went: the focus is on the Papierkorb's tab, not on the window.
    await expect(page.getByTestId('place-trash')).toBeFocused();
    // Papierkorb leeren: two jobs there, a search that finds one: both go, and it says so.
    await openPlace(page, 'inbox');
    for (const key of ['freelancermap-2802', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    await page.getByTestId('search').fill('Treasury');
    await expect(rows(page)).toHaveCount(1);
    await page.getByTestId('empty-trash').click();
    await expect(page.getByTestId('dialog-empty-trash')).toContainText(T.actions.emptyTrashText(2));
    await page
      .getByTestId('dialog-empty-trash')
      .getByRole('button', { name: T.actions.emptyTrash, exact: true })
      .click();
    await expect(page.getByTestId('dialog-empty-trash')).toBeHidden();
    await page.getByTestId('search').fill('');
    await expect(page.getByTestId('empty-place-trash')).toBeVisible();
    expect(await calls(page, 'empty_trash')).toHaveLength(1);
  });

  test('deleting for good hands the focus on; emptying names its count until it is gone', async ({
    page,
  }) => {
    await open(page, WIN);
    for (const key of ['freelancermap-2802', 'freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    const [first, second] = await listed(page);
    // Endgültig löschen of a row: after the dialog the focus is on the row below.
    await viaMenu(page, 'purge', first!);
    await page
      .getByTestId('dialog-purge')
      .getByRole('button', { name: T.actions.purgeConfirm, exact: true })
      .click();
    await expect(row(page, first!)).toHaveCount(0);
    await expect(row(page, second!)).toBeFocused();
    // Papierkorb leeren: the dialog says the two it deletes until it has faded out.
    await page.getByTestId('empty-trash').click();
    const dialog = page.getByTestId('dialog-empty-trash');
    await expect(dialog).toContainText(T.actions.emptyTrashText(2));
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="dialog-empty-trash"]')?.textContent;
        if (text) seen.push(text);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await dialog.getByRole('button', { name: T.actions.emptyTrash, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    expect(seen.length).toBeGreaterThan(0);
    for (const text of seen) expect(text).toContain(T.actions.emptyTrashText(2));
    // Its button went with the jobs: the focus is on the Papierkorb's tab.
    await expect(page.getByTestId('place-trash')).toBeFocused();
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
    await expect(page.getByRole('tooltip')).toHaveText(T.settings.running);
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
    await page.getByTestId('reader-more').click();
    await menuItem(page, 'trash').click();
    await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
    await page.getByTestId('toast-action').click();
    await expect(row(page, 'linkedin-4100200301')).toBeVisible();
    await expect(page.getByTestId('reader-title')).toContainText(
      'Head of Controlling Transformation',
    );
    const back = (await calls(page, 'move_back')).at(-1)?.[1] as { jobs: { to: string }[] };
    expect(back.jobs.map(({ to }) => to)).toEqual(['inbox']);
    await page.getByTestId('reader-close').click();
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
  test('a fetch: a slim bar and one line under the header, then a toast of what it brought', async ({
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
    await expect(line.getByTestId('run-progress')).toHaveAttribute('role', 'progressbar');
    // Under the header's rows, in the header.
    const search = (await page.getByTestId('search').boundingBox())!;
    expect((await line.boundingBox())!.y).toBeGreaterThan(search.y + search.height);
    await expect(page.getByTestId('list-header').getByTestId('run-line')).toHaveCount(1);
    // One line of what happens, in the catalog's words.
    const said = new Set<string>();
    await expect
      .poll(
        async () => {
          said.add((await page.getByTestId('run-text').textContent()) ?? '');
          return [...said].some((text) => /^Anzeigen \d+ von \d+$/.test(text));
        },
        { intervals: [20], timeout: 10_000 },
      )
      .toBe(true);
    // The count moves on in place: the same words, only the number changes (no blink).
    const text = page.getByTestId('run-text');
    const count = /^Anzeigen \d+ von \d+$/;
    const now = async (): Promise<string> => (await text.textContent()) ?? '';
    await expect.poll(now, { intervals: [10], timeout: 10_000 }).toMatch(count);
    await text.evaluate((node) => ((node as HTMLElement).dataset['kept'] = 'yes'));
    const counted = await now();
    await expect.poll(now, { intervals: [10], timeout: 10_000 }).not.toBe(counted);
    if (count.test(await now())) await expect(text).toHaveAttribute('data-kept', 'yes');
    const words = new Set<string>([
      T.run.line.mailbox,
      T.run.line.adsStart,
      T.run.line.scoring,
      T.run.line.files,
    ]);
    for (const text of said) {
      expect(words.has(text) || /^Anzeigen \d+ von \d+$/.test(text), text).toBe(true);
    }
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
    // One word for one, the plural for more, none at 0.
    expect([T.toast.runDone(0), T.toast.runDone(1), T.toast.runDone(2, 1)]).toEqual([
      'Keine neuen Jobs',
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
    await expect(page.getByTestId('run-text')).toHaveText(T.run.line.ads(5, 7));
    await expect(page.getByTestId('run-progress')).toHaveAttribute('aria-valuenow', '71');
    await expect(page.getByTestId('cancel-run')).toBeVisible();
  });

  test('failed: one quiet line and its ×, no second way to fetch; cancelled says nothing', async ({
    page,
  }) => {
    await open(page, `${WIN}&mail=offline&tick=15`);
    await expect(page.getByTestId('run-problem')).toHaveCount(0);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const problem = page.getByTestId('run-problem');
    await expect(problem).toContainText('Gmail ist nicht erreichbar.');
    // Drawn like every note of the column: the sentence in 14 px ink, the × at the column's
    // edge. No "Erneut versuchen" beside a working "Postfach abrufen", which does the same.
    await expect(problem.locator('.text')).toHaveCSS('font-size', '14px');
    await expect(problem.getByTestId('run-retry')).toHaveCount(0);
    // A fetch that ends at once brings back a working "Postfach abrufen".
    await expect(page.getByTestId('fetch')).toBeEnabled();
    expect(
      await page
        .getByTestId('place-action')
        .evaluate((node) => node.querySelector('[inert] [data-testid="fetch"]')),
    ).toBeNull();
    expect(await rightOf(page, 'run-close')).toBe(await rightOf(page, 'fetch-range'));
    await page.getByTestId('fetch').click();
    expect(await calls(page, 'start_run')).toHaveLength(2);
    await runFinished(page);
    await page.getByTestId('run-close').click();
    await expect(problem).toHaveCount(0);
    await open(page, `${WIN}&tick=200`);
    await page.getByTestId('fetch').click();
    await page.getByTestId('cancel-run').click();
    await runFinished(page);
    await expect(page.getByTestId('run-line')).toHaveCount(0);
    await expect(page.getByTestId('run-problem')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('two runs in a row end idle; a rescore is no fetch', async ({ page }) => {
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
    await expect(page.getByTestId('run-problem')).toHaveCount(0);
    expect(await calls(page, 'start_run')).toHaveLength(0);
  });

  test('under reduced motion a run without progress still shows its bar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, `${WIN}&tick=3000`);
    await page.getByTestId('fetch').click();
    const bar = page.getByTestId('run-progress');
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

/* ====================================================================== the bar */

interface Sample {
  top: number;
  height: number;
  left: number;
  opacity: number;
  moves: string[];
  row: { top: number; height: number } | null;
  key: string | null;
  /** How far the list is scrolled. */
  scroll: number;
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
        scroll: document.querySelector('[data-testid="list-scroll"]')?.scrollTop ?? 0,
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
  test('it slides to the clicked row like the sidebar pill; grey on an excluded row', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click();
    const start = await resting(page);
    expect(start.height).toBe(64 - 2 * INSET);
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
    // Grey on the excluded row.
    await row(page, 'linkedin-4100200305').click();
    await expect(row(page, 'linkedin-4100200305')).toHaveAttribute('aria-current', 'true');
    expect((await resting(page)).opacity).toBe(0.6);
    await rows(page).first().click();
    expect((await resting(page)).top).toBe(INSET);
    // Under reduced motion it never slides: it is simply at the next row.
    const order = await listed(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startSampling(page);
    await row(page, 'freelancermap-2803').click();
    await row(page, order[order.indexOf('freelancermap-2803') + 1]!).click();
    await page.waitForTimeout(300);
    for (const sample of await stopSampling(page)) {
      expect(sample.moves, JSON.stringify(sample)).toEqual([]);
      expect(onRow(sample) || sample.key === null, JSON.stringify(sample)).toBe(true);
    }
  });

  test('no slide when the list is built again: the view back, a search, a filter, a run', async ({
    page,
  }) => {
    await open(page, `${WIN}&tick=30`);
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
    // A run lands new jobs above the open one and re-sorts at its end, then another order:
    // the row moves or glides, the bar with it, always on its row.
    await chip(page, 'portal').click();
    await row(page, 'freelancermap-2804').click();
    await resting(page);
    await startSampling(page);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    // The re-sort keeps the open row in view by scrolling the list: wait until the list is
    // sorted and stands still.
    await expect.poll(() => listed(page)).toEqual(await inbox(page));
    const scroller = page.getByTestId('list-scroll');
    await expect
      .poll(async () => {
        const top = await scroller.evaluate((node) => node.scrollTop);
        await page.waitForTimeout(400);
        return top === (await scroller.evaluate((node) => node.scrollTop));
      })
      .toBe(true);
    await chooseSort(page, 'newest');
    await page.waitForTimeout(400);
    const moved = await stopSampling(page);
    expect(
      moved.filter((sample) => sample.opacity > 0 && sample.row !== null).length,
    ).toBeGreaterThan(20);
    still(moved);
    await resting(page);
  });

  test('it keeps its row while the list scrolls and grows, the window narrows, one column', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=many`);
    await rows(page).nth(3).click();
    const slot = await resting(page);
    expect(slot.height).toBe(64 - 2 * INSET);
    // Small steps, a frame each, then the wheel: further windows of rows are built.
    const built = (): Promise<number> => list(page).locator('.item[data-key]').count();
    const before = await built();
    await startSampling(page);
    await page.getByTestId('list-scroll').evaluate(async (scroller) => {
      for (let step = 0; step < 40; step += 1) {
        scroller.scrollTop += 37 + step * 4;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
    await page.mouse.move(200, 500);
    for (let turn = 0; turn < 6; turn += 1) await page.mouse.wheel(0, 1200);
    await expect.poll(built).toBeGreaterThan(before);
    await page.getByTestId('list-scroll').evaluate((scroller) => (scroller.scrollTop = 0));
    await page.waitForTimeout(300);
    const scrolled = await stopSampling(page);
    // Seen all along the way: the places the list stood at, not a count of frames (WebKit
    // samples every other frame or less, and a busy machine draws fewer in the waits). The
    // 40 steps alone pass 40 places.
    expect(new Set(scrolled.map((sample) => sample.scroll)).size).toBeGreaterThan(10);
    for (const sample of scrolled) expect(onRow(sample), JSON.stringify(sample)).toBe(true);
    // A narrower window keeps the row's height; one column and back never slide the bar.
    await page.setViewportSize({ width: 960, height: 900 });
    expect((await resting(page)).height).toBe(64 - 2 * INSET);
    await page.setViewportSize({ width: 780, height: 900 });
    await expect(page.getByTestId('reader')).toBeVisible();
    await startSampling(page);
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.waitForTimeout(300);
    for (const sample of (await stopSampling(page)).filter((s) => s.opacity > 0)) {
      expect(sample.moves.filter((move) => move.startsWith('180 '))).toEqual([]);
    }
    await resting(page);
  });

  test('archive and undo: the bar ends on the job that opens, in the same place', async ({
    page,
  }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2802').click();
    const slot = await resting(page);
    await animationsDone(page);
    await page.getByTestId('reader-more').click();
    await startSampling(page);
    await menuItem(page, 'archive').click();
    await expect(row(page, 'freelancermap-2803')).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(400);
    const samples = await stopSampling(page);
    expect(samples.at(-1)!.key).toBe('freelancermap:2803');
    for (const sample of samples) expect(sample.top, JSON.stringify(sample)).toBe(slot.top);
    await page.getByTestId('toast').last().getByTestId('toast-action').click();
    await expect(row(page, 'freelancermap-2802')).toHaveAttribute('aria-current', 'true');
    expect((await resting(page)).top).toBe(slot.top);
  });

  test('it steps inside the focus ring and greys with the inactive window', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    expect((await resting(page)).left).toBe(0);
    // The keyboard focus on the open row (Shift+Tab from the next one).
    await row(page, 'linkedin-4100200301').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(row(page, 'freelancermap-2801')).toBeFocused();
    await expect.poll(async () => (await resting(page)).left).toBe(2);
    const colour = (): Promise<string> =>
      page.getByTestId('row-bar').evaluate((bar) => getComputedStyle(bar).backgroundColor);
    await page.evaluate(() => (document.documentElement.dataset['window'] = 'inactive'));
    await expect.poll(colour).toBe(await tokenColour(page, '--text-subtle'));
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
    // It folds only by the window width: no edge to drag, Ctrl+B and Cmd+B change nothing.
    const width = async (): Promise<number> => Math.round((await sidebar.boundingBox())!.width);
    await expect(page.getByTestId('sidebar-edge')).toHaveCount(0);
    const full = await width();
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Meta+b');
    expect(await width()).toBe(full);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(width).toBeLessThan(full);
    // Folded to its icons, the names are the tooltips.
    await page.getByTestId('nav-profile').hover();
    await expect(page.getByRole('tooltip')).toHaveText(T.nav.profile);
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(width).toBe(full);
  });

  for (const os of [WIN, MAC]) {
    test(`the rail keeps every entry in the window down to 480 x 360 ${os}`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 700 });
      await open(page, os);
      for (const id of ['nav-jobs', 'nav-profile', 'nav-settings']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect([box.width, box.height], id).toEqual([40, 40]);
      }
      await page.setViewportSize({ width: 480, height: 360 });
      for (const id of ['nav-jobs', 'nav-profile', 'nav-settings']) {
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

test('the list column: never narrower as the window grows; at 480 x 360 the toolbar fits', async ({
  page,
}) => {
  await open(page, WIN);
  // The splitter's hit strip lies beside the list, never over its scrollbar; its grip stays
  // centred on the border.
  const hit = (await page.getByTestId('list-splitter').locator('.hit').boundingBox())!;
  const scroll = (await page.getByTestId('list-scroll').boundingBox())!;
  expect(hit.x).toBeGreaterThanOrEqual(scroll.x + scroll.width);
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  const grip = (await page.getByTestId('list-splitter').locator('.grip').boundingBox())!;
  expect(Math.abs(grip.x + grip.width / 2 - hit.x)).toBeLessThanOrEqual(1);
  await page.mouse.move(4, 4);
  // The column (as its handle says it) never gets narrower while the window grows, across
  // the rail too, and ends at least 520 px wide.
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
  expect(last).toBeGreaterThanOrEqual(520);
  // The smallest window: the header and the chips stay in it; below 900 px one column.
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await chooseFilter(page, 'portal-linkedin');
  for (const id of ['search', 'filter', 'fetch', 'chip-portal']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width, id).toBeLessThanOrEqual(480);
  }
  await page.setViewportSize({ width: 780, height: 560 });
  await expect(page.getByTestId('reader-pane')).toBeHidden();
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('list-scroll')).toBeHidden();
  await page.getByTestId('reader-close').click();
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
