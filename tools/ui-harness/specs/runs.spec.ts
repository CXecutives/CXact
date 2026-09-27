// Runs and their numbers against the stub: every run shows as its kind (also the ones the
// app starts by itself), the end toast says what a fetch brought, the run line what a run
// could not write (once), and the list and the reader stay true while a run updates jobs.

import type { Page } from '@playwright/test';
import type { JobView } from '../../../ui/src/lib/ipc/types';
import { calls, expect, open, runFinished, settle, test } from './fixtures';
import { tabCount, listed, T } from './helpers';

const WIN = '?platform=windows';
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const row = (page: Page, key: string) => page.getByTestId('job-list').getByTestId(`job-row-${key}`);

/** Send run events the way the backend does (the page's channel when no run holds one). */
async function emit(page: Page, ...events: unknown[]): Promise<void> {
  await page.evaluate((list) => {
    for (const event of list) window.__harness.emit(event as never);
  }, events);
}

test('a rescore the app starts shows as a rescore: no run line, the fetch waits', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await expect(page.getByTestId('toast-text')).toHaveText('2 neue Jobs');
  // The profile changed: the app scores every job anew by itself, on the page's channel.
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('rescore');
  });
  const fetch = page.getByTestId('fetch');
  await expect(fetch).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('cancel-run')).toHaveCount(0);
  await expect(page.getByTestId('run-line')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await fetch.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Die Jobs werden gerade neu bewertet.');
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  // Afterwards nothing speaks of it, and Postfach abrufen is back.
  await expect(page.getByTestId('run-problem')).toHaveCount(0);
  await expect(fetch).not.toHaveAttribute('aria-disabled', 'true');
  expect(await calls(page, 'start_run')).toHaveLength(1);
});

test('the auto fetch the app starts shows as a fetch', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await page.evaluate(() => {
    window.__harness.holdAfter = 3;
    window.__harness.appRun('fetch');
  });
  await expect(page.getByTestId('run-line')).toBeVisible();
  await expect(page.getByTestId('cancel-run')).toBeVisible();
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(page.getByTestId('toast-text')).toHaveText('2 neue Jobs');
});

test('a rescore that cannot write the files says so once, with a retry', async ({ page }) => {
  await open(page, `${WIN}&tick=15&export=locked`);
  await page.evaluate(() => window.__harness.appRun('rescore'));
  await runFinished(page);
  const problem = page.getByTestId('run-problem');
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText(
    'Die Excel-Datei ist in einem anderen Programm geöffnet und blieb unverändert.',
  );
  await expect(page.getByText('blieb unverändert')).toHaveCount(1);
  await problem.getByRole('button', { name: 'Erneut versuchen' }).click();
  await runFinished(page);
  const started = await calls(page, 'start_run');
  expect((started.at(-1)?.[1] as { request: unknown }).request).toEqual({ kind: 'rescore' });
});

test('a fetch that cannot write the Excel file: the toast counts, the line says why', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=15&export=locked`);
  await page.getByTestId('fetch').click();
  await page.getByTestId('nav-settings').click();
  await runFinished(page);
  const toast = page.getByTestId('toast').filter({ hasText: '2 neue Jobs' });
  await toast.getByTestId('toast-action').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('run-problem')).toHaveCount(1);
  await expect(page.getByText('blieb unverändert')).toHaveCount(1);
});

test('the end toast counts the run: the new jobs that are not excluded', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // Three new jobs came in, one of them excluded: two new.
  await expect(page.getByTestId('toast-text')).toHaveText('2 neue Jobs');
  await expect(page.getByTestId('run-problem')).toHaveCount(0);
});

test('a details run shows its line and brings no fetch toast', async ({ page }) => {
  await open(page, `${WIN}&tick=40`);
  await page.evaluate(() => {
    window.__harness.holdAfter = 3;
    window.__harness.appRun('details');
  });
  await expect(page.getByTestId('run-line')).toBeVisible();
  await expect(page.getByTestId('run-text')).not.toHaveText(/Postfach/);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(page.getByTestId('run-line')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('a failed first fetch does not claim the alert mails were empty', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only&mail=offline&tick=15`);
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await page.getByTestId('first-fetch').click();
  await runFinished(page);
  // Only a completed fetch ends the setup: its last step says why this one failed.
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await expect(page.getByTestId('first-fetch-failed')).toContainText('Gmail ist nicht erreichbar.');
  await expect(page.getByText('enthielten bisher keine Jobs')).toHaveCount(0);
});

test('after a restart a failed last fetch says so once in the run line, a new fetch clears it', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=last-failed&tick=15`);
  const problem = page.getByTestId('run-problem');
  await expect(problem).toHaveCount(1);
  await expect(problem).toContainText(T.error.text('mailConnect', {}));
  await expect(problem.getByTestId('run-retry')).toHaveText(T.common.retry);
  // Nowhere else: the sidebar has no status line.
  await expect(page.getByTestId('sidebar')).not.toContainText(T.error.text('mailConnect', {}));
  await problem.getByTestId('run-retry').click();
  await runFinished(page);
  await expect(page.getByTestId('run-problem')).toHaveCount(0);
  expect((await calls(page, 'start_run')).at(-1)?.[1]).toMatchObject({
    request: { kind: 'fetch' },
  });
  // Its × hides it until the next run.
  await open(page, `${WIN}&scenario=last-failed`);
  await page.getByTestId('run-close').click();
  await expect(page.getByTestId('run-problem')).toHaveCount(0);
});

test('a start that fails keeps the last result and says why', async ({ page }) => {
  await open(page, `${WIN}&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  // A run the page has not heard of yet holds the slot: start_run answers "busy".
  await page.evaluate(() => {
    window.__harness.holdAfter = 0;
    window.__harness.appRun('rescore');
  });
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-problem-text')).toHaveText('Gerade läuft schon ein Abruf.');
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
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
  const newBefore = await tabCount(page);
  // Job 100000 scores 0 and sorts far beyond the first page of 500.
  const far = await jobOf(page, 'linkedin', '100000');
  await emit(page, {
    type: 'jobUpdated',
    job: { ...far, match: { ...far.match!, score: 35, band: 'low' } },
    fresh: false,
  });
  await page.waitForTimeout(600);
  await settle(page);
  await expect(rows(page).first()).toHaveAttribute('data-testid', first!);
  await expect(page.getByTestId('job-row-linkedin-100000')).toHaveCount(0);
  expect(await tabCount(page)).toBe(newBefore);

  // A job new in the run comes in at the top, and the counts follow the backend.
  await emit(page, {
    type: 'jobUpdated',
    job: { ...far, key: { portal: 'linkedin', id: '999999' }, title: 'Neu im Lauf' },
    fresh: true,
  });
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'job-row-linkedin-999999');
  await expect.poll(() => tabCount(page)).toBe(newBefore + 1);
});

test('a page that fails while scrolling says so and loads on retry', async ({ page }) => {
  await open(page, `${WIN}&scenario=many`);
  await expect(rows(page).first()).toBeVisible();
  await page.evaluate(() => (window.__harness.failPages = 1));
  // Scroll window by window to the end of the first page of 500; the next page fails.
  const scroller = page.getByTestId('list-scroll');
  const error = page.getByTestId('page-error');
  for (let i = 0; i < 40 && (await error.count()) === 0; i += 1) {
    await scroller.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId('page-error')).toContainText(
    'Weitere Jobs ließen sich nicht laden.',
  );
  const mounted = await page.locator('[data-testid^="job-row-"]').count();
  await page.getByTestId('page-error').getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(page.getByTestId('page-error')).toHaveCount(0);
  await expect
    .poll(() => page.locator('[data-testid^="job-row-"]').count())
    .toBeGreaterThan(mounted);
});

test('the excluded section names its count, every excluded row of the list', async ({ page }) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  await expect(page.getByTestId('excluded-divider')).toHaveText(/Ausgeschlossen \(\d+\)/);
  // The list arrives from the backend and builds a few rows per frame: then the divider
  // names every excluded row of it.
  const divider = page.getByTestId('excluded-divider');
  const excluded = page.getByTestId('excluded-rows').locator('[data-testid^="job-row-"]');
  const named = async (): Promise<boolean> => {
    const count = await excluded.count();
    const text = (await divider.innerText()).replace(/\s+/g, ' ').trim();
    return count > 0 && text === `Ausgeschlossen (${count})`;
  };
  await expect.poll(named).toBe(true);
});

test('Einstellungen shows the portals in the order of the UI', async ({ page }) => {
  await open(page, `${WIN}&scenario=empty`);
  await page.getByTestId('nav-settings').click();
  const cards = await page
    .locator('[data-testid^="portal-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  expect(cards.filter((id) => /^portal-[a-z]+$/.test(id ?? ''))).toEqual([
    'portal-freelance',
    'portal-linkedin',
    'portal-freelancermap',
  ]);
});

/** A job as the stub holds it. */
async function jobOf(page: Page, portal: JobView['portal'], id: string): Promise<JobView> {
  const job = await page.evaluate((key) => window.__harness.job(key), { portal, id });
  expect(job, `${portal}-${id}`).not.toBeNull();
  return job!;
}

test('an archived job leaves the list and every count but the archive', async ({ page }) => {
  await open(page, WIN);
  const all = (await listed(page)).length;
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
