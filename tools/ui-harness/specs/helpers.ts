// Page helpers of the Jobs view (list.spec.ts, reader.spec.ts): what a user does and sees,
// named once, and the texts and tables of the app itself (the German catalog, the filter
// table), so a changed word or entry changes the specs with it.

import './runes';
import type { Locator, Page } from '@playwright/test';
import { de } from '../../../ui/src/lib/i18n/de';
import { ICONS, type IconMeaning } from '../../../ui/src/lib/icons';
import type { JobCounts, JobQuery, JobSort, JobView, Portal } from '../../../ui/src/lib/ipc/types';
import { PORTAL_ORDER } from '../../../ui/src/lib/portals';
import {
  activeFilters,
  FILTER_GROUPS,
  type ListFilter,
  NO_FILTER,
  SORTS,
  sortEntryId,
} from '../../../ui/src/lib/state/filter';
import { animationsDone, calls, expect, settle } from './fixtures';

/** The German catalog (the harness runs in de-DE). */
export const T = de;
export { FILTER_GROUPS, NO_FILTER, SORTS, sortEntryId };

export const WIN = '?platform=windows';
export const MAC = '?platform=macos';

/** Every source in the UI's order (lib/portals.ts). */
export const ALL_PORTALS = PORTAL_ORDER;
/** The sources the app searches itself (Einstellungen, Suche); the others bring alert mails. */
export const SEARCHED: readonly Portal[] = [
  'hays',
  'freelancermap',
  'michaelpage',
  'solcom',
  'etengo',
  'gulp',
  'roberthalf',
  'interimx',
];
export const ALERT_PORTALS: readonly Portal[] = PORTAL_ORDER.filter(
  (portal) => !SEARCHED.includes(portal),
);
/** The sources the stub's jobs came from, in the UI's order: the funnel's menu lists them so
 *  (the sources added on 2026-10-01 have no job in the demo). */
export const PORTALS: readonly Portal[] = PORTAL_ORDER.filter((portal) =>
  (['linkedin', 'freelance', 'freelancermap'] as const).some((own) => own === portal),
);

/* ---------------------------------------------------------------------- list */

export const list = (page: Page): Locator => page.getByTestId('job-list');
/** The rows of the list outside the excluded fold. */
export const rows = (page: Page): Locator =>
  page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
export const excludedRows = (page: Page): Locator =>
  page.getByTestId('excluded-rows').locator('[data-testid^="job-row-"]');
/** A row by its key, `portal-id`. */
export const row = (page: Page, key: string): Locator => list(page).getByTestId(`job-row-${key}`);

/** The keys of the rows outside the fold (`portal-id`), in the list's order. */
export function listed(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((items) =>
    items.map((item) => (item.getAttribute('data-testid') ?? '').replace('job-row-', '')),
  );
}

/** The keys of every mounted row (`portal:id`, the fold's too), in the list's order. */
export function mountedKeys(page: Page): Promise<string[]> {
  return list(page)
    .locator('[data-key]')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.key ?? ''));
}

/** The open job's reader (the one on its way out has dropped its test id). */
export const stage = (page: Page): Locator => page.getByTestId('stage');

/** Open the folded section of the excluded jobs (it stays open when it is). */
export async function unfoldExcluded(page: Page): Promise<void> {
  const divider = page.getByTestId('excluded-divider');
  if ((await divider.getAttribute('aria-expanded')) === 'false') await divider.click();
}

/** Open a job of the one list by its row (an excluded one in the fold at the end, which
 *  opens for it) and wait until the reader shows it and has settled. */
export async function openJob(page: Page, key: string): Promise<void> {
  const [portal, id] = key.split(/-(.*)/) as [Portal, string];
  if ((await stubJob(page, portal, id)).match?.status === 'excluded') await unfoldExcluded(page);
  const target = row(page, key);
  await target.click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await target.locator('.title').innerText(),
  );
  await animationsDone(page);
}

/** Open a row's menu (a right click on it); resolves with the menu. */
export async function rowMenu(page: Page, key: string): Promise<Locator> {
  await row(page, key).click({ button: 'right' });
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** A job's action through its row's menu (`archive`, `trash`, `restore`, `purge` ...). */
export async function viaMenu(page: Page, id: string, key: string): Promise<void> {
  await rowMenu(page, key);
  await page.getByTestId(`menu-item-${id}`).click();
}

/** The open menu shows these icons (lib/icons.ts meanings), entry by entry. */
export async function expectMenuIcons(page: Page, icons: readonly IconMeaning[]): Promise<void> {
  const classes = await page
    .getByTestId('menu')
    .locator('[role^="menuitem"] .lead')
    .evaluateAll((leads) => leads.map((lead) => [...(lead.querySelector('svg')?.classList ?? [])]));
  expect(classes).toHaveLength(icons.length);
  icons.forEach((icon, at) => expect(classes[at], icon).toContain(`lucide-${ICONS[icon]}`));
}

/** After a move the list ignores clicks for a moment (the row under the pointer changed). */
export async function settleMoves(page: Page): Promise<void> {
  await page.waitForTimeout(550);
}

/** Choose a place by its tab. */
export async function openPlace(page: Page, place: 'inbox' | 'archive' | 'trash'): Promise<void> {
  await page.getByTestId(`place-${place}`).click();
  await settle(page);
}

/* ------------------------------------------------------------------- filter */

export const funnel = (page: Page): Locator => page.getByTestId('filter');
export const menuItem = (page: Page, id: string): Locator => page.getByTestId(`menu-item-${id}`);
/** The chips of the chosen filter under the toolbar. */
export const chips = (page: Page): Locator => page.getByTestId('filter-chips');
export const chip = (page: Page, key: keyof ListFilter): Locator => page.getByTestId(`chip-${key}`);

/** Open the funnel's menu. */
export async function openFilter(page: Page): Promise<Locator> {
  await funnel(page).click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Pick an entry of the funnel's menu by its id (the table's); the menu stays open for the
 *  next choice, Esc closes it. */
export async function chooseFilter(page: Page, id: string): Promise<void> {
  await openFilter(page);
  await menuItem(page, id).click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
}

/** The funnel's menu as the tables say it: per group its heading (null for a switch of its
 *  own) and entries, the order ("Sortierung") first, then the filter's groups (the stub's
 *  portals). */
export function filterMenu(): { heading: string | null; entries: string[] }[] {
  return [
    {
      heading: T.toolbar.sortHeading,
      entries: SORTS.map((sort) => T.toolbar.sortLabel[sort]),
    },
    ...FILTER_GROUPS.map((group) => ({
      heading: group.heading?.(T) ?? null,
      entries: group.entries(PORTALS).map((entry) => entry.label(T)),
    })),
  ];
}

/** The label of an entry of the table by its id. */
export function filterLabel(id: string): string {
  for (const group of FILTER_GROUPS) {
    const entry = group.entries(PORTALS).find((candidate) => candidate.id === id);
    if (entry) return entry.label(T);
  }
  throw new Error(`no filter entry ${id}`);
}

/** Pick an order in the funnel's menu ('match', 'newest'), then close it with Esc. */
export async function chooseSort(page: Page, id: JobSort): Promise<void> {
  await openFilter(page);
  await menuItem(page, sortEntryId(id)).click();
  await expect(menuItem(page, sortEntryId(id))).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
}

/** The order the funnel's menu has checked ('match', 'newest'); the menu closes again. */
export async function checkedSort(page: Page): Promise<JobSort | undefined> {
  await openFilter(page);
  const checked: JobSort[] = [];
  for (const sort of SORTS) {
    if ((await menuItem(page, sortEntryId(sort)).getAttribute('aria-checked')) === 'true') {
      checked.push(sort);
    }
  }
  await page.keyboard.press('Escape');
  expect(checked).toHaveLength(1);
  return checked[0];
}

/** The words of the chips once these entries are picked, in their order. */
export function chipWordsOf(...ids: string[]): string[] {
  const filter: Record<string, unknown> = { ...NO_FILTER };
  for (const group of FILTER_GROUPS) {
    for (const entry of group.entries(PORTALS)) {
      if (ids.includes(entry.id)) filter[group.key] = entry.value;
    }
  }
  return activeFilters(filter as unknown as ListFilter, PORTALS, T).map((part) => part.label);
}

/* ---------------------------------------------------------------------- stub */

/** The query of the last list load (not a counts-only one). */
export async function lastQuery(page: Page): Promise<JobQuery | undefined> {
  return (await calls(page, 'list_jobs'))
    .map(([, args]) => (args as { query: JobQuery }).query)
    .filter((query) => query.limit > 0)
    .at(-1);
}

/** A list as the stub serves it now, keys as `portal-id`. */
export interface StubList {
  /** The rows outside the excluded fold, in the list's order. */
  active: string[];
  /** The rows in the fold. */
  excluded: string[];
  jobs: JobView[];
  counts: JobCounts;
}

/** What the stub lists for a query (the inbox by match unless it says otherwise), without a
 *  recorded call: the specs read the demo data instead of copying it. */
export async function stubList(page: Page, query: Partial<JobQuery> = {}): Promise<StubList> {
  const { jobs, counts } = await page.evaluate((query) => window.__harness.list(query), query);
  const key = (job: JobView): string => `${job.key.portal}-${job.key.id}`;
  const out = (job: JobView): boolean => job.match?.status === 'excluded';
  return {
    active: jobs.filter((job) => !out(job)).map(key),
    excluded: jobs.filter(out).map(key),
    jobs,
    counts,
  };
}

/** A job as the stub holds it now. */
export async function stubJob(page: Page, portal: Portal, id: string): Promise<JobView> {
  const found = await page.evaluate((key) => window.__harness.job(key), { portal, id });
  if (found === null) throw new Error(`no job ${portal}:${id}`);
  return found;
}

/** The next call of `command` fails with a database error. */
export async function failNext(page: Page, command: string): Promise<void> {
  await page.evaluate((command) => {
    const calls = window.__harness.calls;
    const push = calls.push.bind(calls);
    calls.push = (...items: [string, unknown][]) => {
      if (items.some(([name]) => name === command)) {
        calls.push = push;
        push(...items);
        throw { kind: 'db', params: {} };
      }
      return push(...items);
    };
  }, command);
}

/** A colour token as the engine computes it. */
/** A length of tokens.css in px as the page resolves it (sizes change; tests follow them). */
export async function tokenPx(page: Page, token: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.setProperty('position', 'absolute');
    probe.style.setProperty('width', `var(${name})`);
    document.body.append(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, token);
}

/** The raw value of a token of tokens.css (a weight, a number). */
export async function tokenValue(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token,
  );
}

export async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.setProperty('color', `var(${name})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

/** Opens the tab of the Profil that holds `target` (one tab shows at a time); the target. */
export async function showTab(page: Page, target: Locator): Promise<Locator> {
  const panel = await target
    .first()
    .evaluate((node) => node.closest('[role="tabpanel"]')?.getAttribute('data-testid') ?? '');
  const id = panel.replace('profile-panel-', '');
  if (id !== '') await page.getByTestId(`profile-tab-${id}`).click();
  await expect(target.first()).toBeVisible();
  return target;
}

/** In the open dialog "Neues Profil": chooses a way and goes on with it (from the CV the
 *  answer comes from the clipboard). */
export async function chooseWay(page: Page, way: 'cv' | 'empty' | 'file'): Promise<void> {
  const dialog = page.getByTestId('dialog-new-profile');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('new-profile-ways').locator(`[data-id="${way}"]`).click();
  await dialog.getByTestId('dialog-confirm').click();
  // Gone, its way out too (a leaving dialog still takes the keys).
  await expect(dialog).toHaveCount(0);
}
