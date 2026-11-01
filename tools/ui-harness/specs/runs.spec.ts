// Runs and their numbers against the stub: every run shows as its kind (also the ones the
// app starts by itself), the end toast says what a fetch brought and leads to it, and the
// list and the reader stay true while a run updates jobs.

import type { Page } from '@playwright/test';
import type { JobView } from '../../../ui/src/lib/ipc/types';
import { calls, expect, open, runFinished, settle, test } from './fixtures';
import {
  ALL_PORTALS,
  chip,
  chipRemove,
  chipWordsOf,
  chooseFilter,
  lastQuery,
  stubList,
  listed,
  T,
  chipWords,
} from './helpers';

const WIN = '?platform=windows';
/** The end toast of the demo's fetch: two new jobs (the third is excluded), one of the high
 *  band. */
const DONE = T.toast.runDone(2, 1);
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const row = (page: Page, key: string) => page.getByTestId('job-list').getByTestId(`job-row-${key}`);
/** The chips of the filter, each with its words (its × is a button of its own, without any). */

/** Send run events the way the backend does (the page's channel when no run holds one). */
async function emit(page: Page, ...events: unknown[]): Promise<void> {
  await page.evaluate((list) => {
    for (const event of list) window.__harness.emit(event as never);
  }, events);
}

test('a rescore the app starts shows as a rescore: its strip and Abbrechen, no fetch', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await expect(page.getByTestId('toast-text')).toHaveText(DONE);
  // The profile changed: the app scores every job anew by itself, on the page's channel.
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('rescore');
  });
  // Decision 21: the strip says the jobs are scored anew, Abbrechen in the fetch's place.
  const fetch = page.getByTestId('fetch');
  await expect(page.getByTestId('run-step')).toHaveText(T.run.line.rescore);
  await expect(page.getByTestId('cancel-run')).toBeVisible();
  await expect(fetch).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  // Afterwards nothing speaks of it, and Jobs suchen is back.
  await expect(page.getByTestId('run-line')).toHaveCount(0);
  await expect(fetch).not.toHaveAttribute('aria-disabled', 'true');
  expect(await calls(page, 'start_run')).toHaveLength(1);
});

test('the end toast counts the run: the new jobs that are not excluded', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // Three new jobs came in, one of them excluded: two new.
  await expect(page.getByTestId('toast-text')).toHaveText(DONE);
});

test('the end toast names the new jobs of the high band; Zeigen lists exactly those, chips to take off', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // One word for one, the plural for more, none at 0, the high ones only when there are.
  expect([
    T.toast.runDone(0, 0),
    T.toast.runDone(1, 0),
    T.toast.runDone(5, 1),
    T.toast.runDone(5, 2),
  ]).toEqual([
    'Keine neuen passenden Jobs',
    '1 neuer Job',
    '5 neue Jobs, 1 mit hoher Übereinstimmung',
    '5 neue Jobs, 2 mit hoher Übereinstimmung',
  ]);
  const toast = page.getByTestId('toast').filter({ hasText: DONE });
  await toast.getByTestId('toast-action').click();
  // Aktuell with the new jobs of that fetch in the high band: the one the toast names.
  await expect(chipWords(page)).toHaveText([T.toolbar.lastFetch, ...chipWordsOf('band-high')]);
  const query = (await lastQuery(page))!;
  expect(query).toMatchObject({ place: 'inbox', bands: ['high'] });
  expect(query.run).toEqual(expect.any(Number));
  await expect.poll(() => listed(page)).toEqual(['linkedin-4100200399']);
  // Each chip takes its part off: without the band the two new jobs the toast counts, not
  // the excluded one of the fetch.
  await chipRemove(page, 'band-high').click();
  await expect(chipWords(page)).toHaveText([T.toolbar.lastFetch]);
  const { active } = await stubList(page, { run: query.run });
  expect(active).toHaveLength(2);
  expect(active).toContain('linkedin-4100200399');
  await expect.poll(() => listed(page)).toEqual(active);
  // Never kept: the next start lists Aktuell as before.
  await open(page, `${WIN}&tick=15`);
  expect(await lastQuery(page)).toMatchObject({ run: null, bands: [] });
  await expect(page.getByTestId('filter-chips')).toHaveCount(0);
});

test('from another view Zeigen opens Aktuell without its search, filtered to the new jobs', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('search').fill('Controller');
  await page.getByTestId('fetch').click();
  await page.getByTestId('nav-settings').click();
  await runFinished(page);
  await page.getByTestId('toast').filter({ hasText: DONE }).getByTestId('toast-action').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('search')).toHaveValue('');
  const run = (await lastQuery(page))?.run;
  expect(await lastQuery(page)).toMatchObject({ search: null, bands: ['high'] });
  expect(run).toEqual(expect.any(Number));
  // The next search takes "Aus der letzten Suche" off (it would speak of the one before), and
  // the band that Zeigen set with it: the list is the user's own filter again.
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await expect(chip(page, 'run')).toHaveCount(0);
  await expect(page.getByTestId('filter-chips')).toHaveCount(0);
  expect(await lastQuery(page)).toMatchObject({ run: null, bands: [] });
});

test('the first search of an empty app: the two columns come with its first row', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=fresh&tick=15`);
  // Every frame that shows a row of the list without the job view beside it.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { alone: number[] }).alone = seen;
    const look = (): void => {
      const count = document.querySelectorAll('[data-testid^="job-row-"]').length;
      if (count > 0 && document.querySelector('[data-testid="reader-pane"]') === null) {
        seen.push(count);
      }
      requestAnimationFrame(look);
    };
    look();
  });
  await page.getByTestId('fetch').click();
  await expect(page.locator(`[data-testid^="job-row-"]`).first()).toBeVisible();
  await expect(page.getByTestId('reader-pane')).toBeVisible();
  await runFinished(page);
  expect(await page.evaluate(() => (window as unknown as { alone: number[] }).alone)).toEqual([]);
});

test('Zeigen closes the open job its list no longer holds; the one it holds stays', async ({
  page,
}) => {
  /** The new job of the high band, the one Zeigen lists. */
  const shown = 'linkedin-4100200399';
  const zeigen = page.getByTestId('toast').filter({ hasText: DONE }).getByTestId('toast-action');
  await open(page, `${WIN}&tick=15`);
  await row(page, 'freelancermap-2801').click();
  await expect(page.getByTestId('reader-title')).toBeVisible();
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await zeigen.click();
  await expect(chip(page, 'run')).toHaveText(T.toolbar.lastFetch);
  await expect.poll(() => listed(page)).toEqual([shown]);
  await expect(page.getByTestId('reader-title')).toHaveCount(0);
  await expect(page.getByTestId('place-reader')).toBeVisible();
  // A job of that search stays open beside the jobs Zeigen shows.
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await row(page, shown).click();
  const title = await page.getByTestId('reader-title').innerText();
  await zeigen.click();
  await expect(chip(page, 'run')).toHaveText(T.toolbar.lastFetch);
  await expect.poll(() => listed(page)).toEqual([shown]);
  await expect(page.getByTestId('reader-title')).toHaveText(title);
});

test('what Zeigen set is never the user filter: its chips taken off keep nothing, the own one stays', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  // The user's own filter, kept: one portal.
  await chooseFilter(page, 'portal-linkedin');
  const kept = await page.evaluate(() => localStorage.getItem('jobs-filter'));
  expect(kept).not.toBeNull();
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await page.getByTestId('toast').filter({ hasText: DONE }).getByTestId('toast-action').click();
  await expect(chip(page, 'run')).toHaveText(T.toolbar.lastFetch);
  // Taking off Zeigen's chips, each on its own, writes nothing: the stored filter is the user's.
  await chipRemove(page, 'run').click();
  await expect(chip(page, 'run')).toHaveCount(0);
  await chipRemove(page, 'band-high').click();
  expect(await page.evaluate(() => localStorage.getItem('jobs-filter'))).toBe(kept);
  // With the last of them gone the user's own stands again at once, not only at the next start.
  await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin'));
  await expect
    .poll(() => lastQuery(page))
    .toMatchObject({ run: null, bands: [], portals: ['linkedin'] });
  await open(page, `${WIN}&tick=15`);
  await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin'));
});

test('Filter zurücksetzen takes the fetch of Zeigen off with the rest', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await page.getByTestId('toast').filter({ hasText: DONE }).getByTestId('toast-action').click();
  await expect(chip(page, 'run')).toHaveText(T.toolbar.lastFetch);
  // Its button stands where a filter leaves nothing: no job of the fetch came from this portal.
  await chooseFilter(page, 'portal-hays');
  const nothing = page.getByTestId('empty-filter');
  await expect(nothing.locator('h3')).toHaveText(T.list.noFilterHit);
  await nothing.getByTestId('filter-reset').click();
  await expect(page.getByTestId('filter-chips')).toHaveCount(0);
  await expect.poll(() => listed(page)).toEqual((await stubList(page)).active);
  expect(await lastQuery(page)).toMatchObject({ run: null, bands: [], portals: [] });
});

test('Filter zurücksetzen under what Zeigen set brings the own filter back', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await chooseFilter(page, 'portal-linkedin');
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await page.getByTestId('toast').filter({ hasText: DONE }).getByTestId('toast-action').click();
  await expect(chip(page, 'run')).toHaveText(T.toolbar.lastFetch);
  // Its button stands where the filter leaves nothing.
  await chooseFilter(page, 'portal-hays');
  await page.getByTestId('empty-filter').getByTestId('filter-reset').click();
  await expect(chipWords(page)).toHaveText(chipWordsOf('portal-linkedin'));
  await expect
    .poll(() => lastQuery(page))
    .toMatchObject({ run: null, bands: [], portals: ['linkedin'] });
});

// The preview's runs that are under way when the page starts (the scenarios `running`,
// `sign-in-waiting` and `rescoring`) end with Abbrechen like a run the page started.
for (const scenario of ['running', 'sign-in-waiting', 'rescoring']) {
  test(`Abbrechen ends the run the page finds under way (${scenario})`, async ({ page }) => {
    await open(page, `${WIN}&scenario=${scenario}`);
    const cancel = page.getByTestId('cancel-run');
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    await expect(page.getByTestId('run-line')).toHaveCount(0);
    await expect(page.getByTestId('fetch')).toBeVisible();
  });
}

test('Anmelden at a search that waits ends the wait: the search goes on to its end', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=sign-in-waiting`);
  const step = page.getByTestId('run-step');
  await expect(step).toHaveText(T.run.line.waiting(T.portal.freelance));
  await page.evaluate(() => (window.__harness.holdAfter = 1));
  await page.getByTestId('run-sign-in').click();
  await expect
    .poll(async () => (await calls(page, 'portal_login')).at(-1)?.[1])
    .toEqual({ portal: 'freelance' });
  // The strip says what the search does now, without the way to sign in.
  await expect(step).toHaveText(T.run.line.ads);
  await expect(page.getByTestId('run-sign-in')).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(page.getByTestId('run-line')).toHaveCount(0);
  await expect(page.getByTestId('fetch')).toBeVisible();
  await expect(page.getByTestId('toast-text')).toHaveText(T.toast.runDone(0));
});

test('loading ads is no search: no run line, no Abbrechen, no fetch toast', async ({ page }) => {
  await open(page, `${WIN}&tick=40`);
  await page.evaluate(() => {
    window.__harness.holdAfter = 3;
    window.__harness.appRun('details');
  });
  // "Jobs suchen" waits for it and says why; nothing else of a search shows.
  const fetch = page.getByTestId('fetch');
  await expect(fetch).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('run-line')).toHaveCount(0);
  await expect(page.getByTestId('cancel-run')).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(fetch).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('both parts work: the mails first, then the portals; the end toast counts both', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // LinkedIn and freelance.de came by mail, freelancermap by the search.
  const { active } = await stubList(page, {});
  expect(active).toEqual(expect.arrayContaining(['linkedin-4100200399', 'freelancermap-2899']));
  await expect(page.getByTestId('toast-text')).toHaveText(DONE);
});

test('the mail part fails, the search works: it ends completed, the mailbox is to check', async ({
  page,
}) => {
  await open(page, `${WIN}&mail=offline&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // The search's job came, the mails' did not.
  const { active } = await stubList(page, {});
  expect(active).toContain('freelancermap-2899');
  expect(active).not.toContain('linkedin-4100200399');
  const warning = page.getByTestId('toast').filter({ hasText: T.error.text('mailConnect', {}) });
  await expect(warning.getByTestId('toast-action')).toHaveText(T.run.checkMailbox);
  await expect(page.getByTestId('toast').filter({ hasText: T.toast.runDone(1) })).toHaveCount(1);
  // "Postfach prüfen" leads to the Postfach, which says what failed.
  await warning.getByTestId('toast-action').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('settings-mailbox')).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('mailbox-hint')).toHaveText(T.settings.unreachable);
});

test('the reader stays with the selected job while a run updates the one before', async ({
  page,
}) => {
  await open(page, WIN);
  await row(page, 'linkedin-4100200301').click();
  await expect(page.getByTestId('reader-title')).toHaveText('Head of Controlling Transformation');
  await page.evaluate(() => (window.__harness.detailDelay = 400));
  const before = (await calls(page, 'job_detail')).length;
  const a = await jobOf(page, 'linkedin', '4100200301');
  await row(page, 'freelancermap-2802').click();
  // While B loads, a run update of A arrives.
  await emit(page, {
    type: 'jobUpdated',
    job: a,
    fresh: false,
  });
  await expect(page.getByTestId('reader-title')).toHaveText('Interim Head of Finance');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('reader-title')).toHaveText('Interim Head of Finance');
  const asked = (await calls(page, 'job_detail')).slice(before).map(([, args]) => args);
  expect(asked).toEqual([{ key: { portal: 'freelancermap', id: '2802' } }]);
});

test('a run update of a job beyond the loaded page is no new row', async ({ page }) => {
  await open(page, `${WIN}&scenario=many`);
  await expect(rows(page).first()).toBeVisible();
  const first = await rows(page).first().getAttribute('data-testid');
  const newBefore = (await stubList(page)).counts.inbox;
  // Job 101998, among the oldest of the scored jobs, sorts far beyond the first page.
  const far = await jobOf(page, 'linkedin', '101998');
  await emit(page, {
    type: 'jobUpdated',
    job: { ...far, match: { ...far.match!, score: 35, band: 'low' } },
    fresh: false,
  });
  await page.waitForTimeout(600);
  await settle(page);
  await expect(rows(page).first()).toHaveAttribute('data-testid', first!);
  await expect(page.getByTestId('job-row-linkedin-101998')).toHaveCount(0);
  expect((await stubList(page)).counts.inbox).toBe(newBefore);

  // A job new in the run comes in at the top, and the counts follow the backend.
  await emit(page, {
    type: 'jobUpdated',
    job: { ...far, key: { portal: 'linkedin', id: '999999' }, title: 'Neu im Lauf' },
    fresh: true,
  });
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'job-row-linkedin-999999');
  await expect.poll(async () => (await stubList(page)).counts.inbox).toBe(newBefore + 1);
});

test('a page that fails while scrolling says so and loads on retry', async ({ page }) => {
  await open(page, `${WIN}&scenario=many`);
  await expect(rows(page).first()).toBeVisible();
  await page.evaluate(() => (window.__harness.failPages = 1));
  // Scroll window by window to the end of the first page; the next page fails.
  const scroller = page.getByTestId('list-scroll');
  const error = page.getByTestId('page-error');
  for (let i = 0; i < 40 && (await error.count()) === 0; i += 1) {
    await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('page-error')).toContainText(T.list.pageFailed);
  const mounted = await page.locator('[data-testid^="job-row-"]').count();
  await page.getByTestId('page-error').getByRole('button', { name: T.common.retry }).click();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
  await expect
    .poll(() => page.locator('[data-testid^="job-row-"]').count())
    .toBeGreaterThan(mounted);
});

test('the excluded section holds every excluded row of the list, its label without a count', async ({
  page,
}) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  await expect(page.getByTestId('excluded-divider')).toHaveText(T.list.excluded);
  // The list arrives from the backend and builds a few rows per frame: then the section
  // holds every excluded row of it.
  const excluded = page.getByTestId('excluded-rows').locator('[data-testid^="job-row-"]');
  const { excluded: out } = await stubList(page);
  await expect(excluded).toHaveCount(out.length);
});

test('Einstellungen shows the portals in the order of the UI', async ({ page }) => {
  await open(page, `${WIN}&scenario=empty`);
  await page.getByTestId('nav-settings').click();
  const cards = await page
    .locator('[data-testid^="portal-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  expect(cards.filter((id) => /^portal-[a-z]+$/.test(id ?? ''))).toEqual(
    ALL_PORTALS.map((portal) => `portal-${portal}`),
  );
});

/** A job as the stub holds it. */
async function jobOf(page: Page, portal: JobView['portal'], id: string): Promise<JobView> {
  const job = await page.evaluate((key) => window.__harness.job(key), { portal, id });
  expect(job, `${portal}-${id}`).not.toBeNull();
  return job!;
}

test('an archived job leaves the list and every count but the archive', async ({ page }) => {
  await open(page, WIN);
  // Every row mounted first (the list builds a few rows per frame).
  const all = (await stubList(page)).active.length;
  await expect.poll(async () => (await listed(page)).length).toBe(all);
  await row(page, 'linkedin-4100200301').click();
  await row(page, 'linkedin-4100200301').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await expect(row(page, 'linkedin-4100200301')).toHaveCount(0);
  await expect.poll(async () => (await listed(page)).length).toBe(all - 1);
  expect((await calls(page, 'move_jobs')).map(([, args]) => args)).toEqual([
    { keys: [{ portal: 'linkedin', id: '4100200301' }], to: 'archive' },
  ]);
  expect((await jobOf(page, 'linkedin', '4100200301')).place).toBe('archive');
  // The archive lists it.
  await page.getByTestId('place-archive').click();
  await expect(row(page, 'linkedin-4100200301')).toHaveCount(1);
});
