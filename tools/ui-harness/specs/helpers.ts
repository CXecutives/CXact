// Page helpers of the Jobs view (list.spec.ts, reader.spec.ts): what a user does and sees,
// named once, and the texts and tables of the app itself (the German catalog, the filter
// table), so a changed word or entry changes the specs with it.

import './runes';
import type { Locator, Page } from '@playwright/test';
import { de } from '../../../ui/src/lib/i18n/de';
import type { JobCounts, JobQuery, JobView, Portal } from '../../../ui/src/lib/ipc/types';
import {
  FILTER_GROUPS,
  filterWords,
  type ListChoice,
  NO_FILTER,
} from '../../../ui/src/lib/state/filter';
import { animationsDone, calls, expect, settle } from './fixtures';

/** The German catalog (the harness runs in de-DE). */
export const T = de;
export { FILTER_GROUPS };

export const WIN = '?platform=windows';
export const MAC = '?platform=macos';

/** The portals of the stub, in the app's order (the settings'). */
export const PORTALS: readonly Portal[] = ['linkedin', 'freelance', 'freelancermap'];

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

/** A row's tool (it exists while the pointer is on the row). */
export async function tool(page: Page, id: string, key: string): Promise<void> {
  await row(page, key).hover();
  await page.getByTestId(`${id}-${key}`).click();
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

/** The number on the Eingang tab (0 when it shows none). */
export async function inboxCount(page: Page): Promise<number> {
  const count = page.getByTestId('place-inbox-count');
  return (await count.count()) === 0 ? 0 : Number(await count.innerText());
}

/* ------------------------------------------------------------------- filter */

export const funnel = (page: Page): Locator => page.getByTestId('filter');
export const menuItem = (page: Page, id: string): Locator => page.getByTestId(`menu-item-${id}`);
export const filterLine = (page: Page): Locator => page.getByTestId('filter-line');

/** Open the funnel's menu. */
export async function openFilter(page: Page): Promise<Locator> {
  await funnel(page).click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Pick an entry of the funnel's menu by its id (the table's); the menu closes. */
export async function chooseFilter(page: Page, id: string): Promise<void> {
  await openFilter(page);
  await menuItem(page, id).click();
  await expect(page.getByTestId('menu')).toHaveCount(0);
}

/** The menu as the table says it: per group its heading and entries (the stub's portals). */
export function filterMenu(): { heading: string | null; entries: string[] }[] {
  return FILTER_GROUPS.map((group) => ({
    heading: group.heading?.(T) ?? null,
    entries: group.entries(PORTALS).map((entry) => entry.label(T)),
  }));
}

/** The label of an entry of the table by its id. */
export function filterLabel(id: string): string {
  for (const group of FILTER_GROUPS) {
    const entry = group.entries(PORTALS).find((candidate) => candidate.id === id);
    if (entry) return entry.label(T);
  }
  throw new Error(`no filter entry ${id}`);
}

/** The words of the line under the toolbar once these entries are picked. */
export function filterWordsOf(...ids: string[]): string {
  let choice: ListChoice = { sort: 'match', filter: NO_FILTER };
  for (const group of FILTER_GROUPS) {
    for (const entry of group.entries(PORTALS)) {
      if (!ids.includes(entry.id)) continue;
      const change = entry.pick(choice);
      choice = {
        sort: change.sort ?? choice.sort,
        filter: { ...choice.filter, ...change.filter },
      };
    }
  }
  return T.toolbar.filterLine(filterWords(choice.filter, PORTALS, T));
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

/** Change jobs of the stub before the page asks for the app state (read, pinned): these
 *  keys, or every unread job of the inbox. */
export async function atStart(
  page: Page,
  keys: readonly (readonly [Portal, string])[] | 'unread',
  change: Partial<JobView>,
): Promise<void> {
  await page.addInitScript(
    ({ keys, change }) => {
      let harness: Window['__harness'] | undefined;
      Object.defineProperty(window, '__harness', {
        configurable: true,
        get: () => harness,
        set: (value: Window['__harness']) => {
          harness = value;
          // After the stub has built its jobs (the rest of its module), before app_state.
          queueMicrotask(() => {
            const chosen =
              keys === 'unread'
                ? value
                    .list({})
                    .jobs.filter((job) => job.unread)
                    .map((job) => [job.key.portal, job.key.id] as const)
                : keys;
            for (const [portal, id] of chosen) {
              const job = value.job({ portal, id });
              if (job) value.emit({ type: 'jobUpdated', job: { ...job, ...change }, fresh: false });
            }
          });
        },
      });
    },
    { keys, change },
  );
}

/** A colour token as the engine computes it. */
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
