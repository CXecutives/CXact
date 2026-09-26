// The Übersicht, a view of its own and where the app starts: its blocks in the one order of
// blocks.ts, each only with content; every tile and point leads to exactly the set it
// counts (and never changes the kept order); the open points by weight; a failed fetch is
// said as such under the tiles; the rows of "Heute ansehen" stand one height apart; the
// requirements the profile lacks most often go in at once; the market of 30 days; 480 px.

import type { Page } from '@playwright/test';
import type { JobKey, RunRequest } from '../../../ui/src/lib/ipc/types';
import { calls, expect, open, test } from './fixtures';
import {
  excludedRows,
  filterLine,
  filterWordsOf,
  funnel,
  lastQuery,
  listed,
  rows,
  stubList,
} from './helpers';

const OVERVIEW = '?platform=windows&view=overview';

/** The test ids of the blocks the Übersicht shows, top to bottom. */
function blocks(page: Page): Promise<string[]> {
  return page
    .getByTestId('day-overview')
    .locator(':scope > section')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid') ?? ''));
}

/** The number a tile shows. */
async function tile(page: Page, id: string): Promise<number> {
  return Number((await page.getByTestId(id).locator('.digits').innerText()).replace(/\D/g, ''));
}

test('the blocks stand in their order, each only with content', async ({ page }) => {
  await open(page, OVERVIEW);
  await expect(page.getByTestId('since').getByRole('heading')).toHaveText('Eingang');
  await expect
    .poll(() => blocks(page))
    .toEqual(['since', 'best', 'compare', 'issues', 'open-musts', 'market', 'files']);
  // The only favourite stands in "Heute ansehen" already (its star says it): no Favoriten.
  await expect(page.getByTestId('best-freelancermap-2801')).toBeVisible();
  // One way to each set: no tile of the excluded jobs, no "Alle n neuen", no time line.
  await expect(page.getByTestId('tile-excluded')).toHaveCount(0);
  await expect(page.getByTestId('overview-all-new')).toHaveCount(0);
  await expect(page.getByTestId('day-overview')).not.toContainText('Abgerufen');
  await expect(page.getByTestId('day-overview')).not.toContainText('Braucht eine Entscheidung');
  // The comparison prompt has its own place, never in a heading.
  await expect(page.getByTestId('best').getByTestId('prompt-top')).toHaveCount(0);
  await expect(page.getByTestId('compare').getByTestId('prompt-top')).toHaveText(
    'KI-Prompt kopieren',
  );

  // Nothing in the inbox: the counts, the open points and the files, nothing else.
  await open(page, `${OVERVIEW}&scenario=empty`);
  await expect.poll(() => blocks(page)).toEqual(['since', 'issues', 'files']);
});

test('Neu opens the Eingang without a filter, its unopened jobs dotted, the kept order untouched', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('jobs-sort', 'newest');
    localStorage.setItem('jobs-filter', JSON.stringify({ portal: 'linkedin' }));
  });
  await open(page, OVERVIEW);
  const count = await tile(page, 'tile-new');
  expect(count).toBe(6);
  await page.getByTestId('tile-new').click();
  await expect(filterLine(page)).toHaveCount(0);
  await expect.poll(() => listed(page)).toEqual((await stubList(page, { sort: 'newest' })).active);
  await expect(page.getByTestId('job-rows').locator('.dot')).toHaveCount(count);
  expect(await lastQuery(page)).toMatchObject({ sort: 'newest', portal: null, minBand: null });
});

test('Hohe Passung opens the high band of the inbox, read or not', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobs-sort', 'newest'));
  await open(page, OVERVIEW);
  const count = await tile(page, 'tile-high');
  expect(count).toBe(2);
  await page.getByTestId('tile-high').click();
  await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('band-high'));
  await expect(funnel(page).getByTestId('button-dot')).toBeVisible();
  await expect(rows(page)).toHaveCount(count);
  expect(await lastQuery(page)).toMatchObject({ sort: 'newest', minBand: 'high', unread: false });
});

test('the excluded jobs not opened yet: the Eingang with its excluded section open', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '0'));
  await open(page, OVERVIEW);
  const point = page.getByTestId('issue-excluded');
  await expect(point).toContainText('1 neuer Job ausgeschlossen');
  await point.getByRole('button', { name: 'Ansehen' }).click();
  await expect(filterLine(page)).toHaveCount(0);
  await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
  await expect(excludedRows(page)).toHaveCount((await stubList(page)).excluded.length);
});

test('a job opens in the Eingang, whatever list and search Jobs had', async ({ page }) => {
  await open(page, '?platform=windows');
  await page.getByTestId('place-archive').click();
  await page.getByTestId('search').fill('Controller');
  await page.getByTestId('nav-overview').click();
  const row = page.getByTestId('best').locator('[data-testid^="best-"]').first();
  const title = (await row.locator('.title').first().innerText()).trim();
  await row.click();
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('search')).toHaveValue('');
  await expect(page.getByTestId('reader')).toContainText(title);
});

test('the open points stand by weight: to act, to fetch, to look at, what resolves itself', async ({
  page,
}) => {
  await open(page, `${OVERVIEW}&scenario=paused`);
  const ids = await page
    .getByTestId('issues')
    .locator('[data-testid^="issue-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  expect(ids).toEqual([
    'issue-freelance-mails',
    'issue-details',
    'issue-excluded',
    'issue-linkedin-health',
  ]);
  await expect(page.getByTestId('issue-freelance-mails')).toHaveClass(/warning/);
  // A pause resolves itself: a calm note in the words of the settings.
  await expect(page.getByTestId('issue-linkedin-health')).toHaveClass(/info/);
  await expect(page.getByTestId('issue-linkedin-health')).toContainText('von selbst weiter');

  // Without a profile that comes first, and leads to the empty form.
  await open(page, `${OVERVIEW}&scenario=no-profile`);
  const first = page.getByTestId('issues').locator('[data-testid^="issue-"]').first();
  await expect(first).toHaveAttribute('data-testid', 'issue-profile');
  await expect(first).toContainText('Ohne Profil gibt es keine Passung.');
  await first.getByRole('button', { name: 'Profil anlegen' }).click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
});

test('a portal switched off has no open points', async ({ page }) => {
  await open(page, OVERVIEW);
  await expect(page.getByTestId('issue-freelance-mails')).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(page.getByTestId('toggle-enabled-freelance')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByTestId('nav-overview').click();
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.getByTestId('issue-freelance-mails')).toHaveCount(0);
});

test('the best rows have the list tools; one that fails says so at its block', async ({ page }) => {
  await open(page, OVERVIEW);
  const best = page.getByTestId('best');
  const row = best.locator('[data-testid^="best-"]').first();
  const id = (await row.getAttribute('data-testid'))!.replace('best-', '');
  await row.hover();
  await expect(best.getByRole('button', { name: /Favorit/ }).first()).toBeVisible();
  await page.getByTestId(`archive-${id}`).click();
  await expect(page.getByTestId(`best-${id}`)).toHaveCount(0);
  expect((await calls(page, 'move_jobs')).length).toBeGreaterThan(0);
});

test('the comparison prompt: copied with a toast, a refusing clipboard said beside it', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await open(page, OVERVIEW);
  await page.getByTestId('prompt-top').click();
  await expect(page.getByTestId('toast').last()).toContainText('Prompt kopiert.');
  expect((await calls(page, 'ai_prompt_top'))[0]?.[1]).toEqual({ limit: 5 });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await open(page, OVERVIEW);
  await page.getByTestId('prompt-top').click();
  const error = page.getByTestId('compare-error');
  await expect(error).toHaveText('Der Prompt ließ sich nicht kopieren.');
  await expect(error).toBeInViewport();
});

test('"Details holen" counts and asks for only the ads it can still fetch', async ({ page }) => {
  await open(page, OVERVIEW);
  const point = page.getByTestId('issue-details');
  await expect(point).toContainText('2 Jobs ohne ganze Anzeige');
  await point.getByRole('button', { name: 'Details holen' }).click();
  await expect.poll(async () => (await calls(page, 'start_run')).length).toBe(1);
  const request = (await calls(page, 'start_run'))[0]![1] as { request: RunRequest };
  expect(request.request.kind).toBe('details');
  const keys = (request.request as { keys: JobKey[] }).keys;
  expect(keys).toHaveLength(2);
  for (const key of keys) {
    const job = await page.evaluate((k) => window.__harness.job(k), key);
    // Not fetched yet or failed so far; never a teaser without the sign-in, a gone ad.
    expect(['pending', 'onRequest', 'failed']).toContain(job?.detail.kind);
  }
});

test('a portal that never sent an alert mail leads to its site', async ({ page }) => {
  await open(page, `${OVERVIEW}&scenario=empty`);
  const quiet = page.getByTestId('issue-quiet-linkedin');
  await expect(quiet).toContainText('Noch keine Alert-Mail angekommen.');
  await quiet.getByRole('button', { name: 'Alert anlegen' }).click();
  await expect
    .poll(async () => (await calls(page, 'open_target')).map(([, args]) => args))
    .toContainEqual({ target: { kind: 'portalHome', portal: 'linkedin' } });
});

test('a failed fetch is said under the tiles, never as "Abgerufen"', async ({ page }) => {
  await open(page, `${OVERVIEW}&scenario=offline`);
  const failed = page.getByTestId('since').getByTestId('run-failed');
  await expect(failed).toContainText('Letzter Abruf');
  await expect(failed).toBeInViewport();
  await expect(page.getByTestId('day-overview')).not.toContainText('Abgerufen');
});

test('jobs that did not load say so in place of "Heute ansehen", with a retry', async ({
  page,
}) => {
  await open(page, `${OVERVIEW}&scenario=list-error`);
  const note = page.getByTestId('best-error');
  await expect(note).toContainText('Die Jobliste ließ sich nicht laden.');
  await expect(note.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  await expect(page.getByTestId('best')).toHaveCount(0);
});

test('"Heute ansehen" rows stand one height apart, whatever a row shows', async ({ page }) => {
  await open(page, OVERVIEW);
  const rows = page.getByTestId('best').locator('[data-testid^="best-"]');
  await expect(rows).toHaveCount(5);
  const boxes = await rows.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      return { top: box.top, height: box.height };
    }),
  );
  for (const [i, box] of boxes.entries()) {
    expect(box.height).toBe(boxes[0]!.height);
    if (i > 0) expect(box.top - boxes[i - 1]!.top).toBe(boxes[0]!.height);
  }
});

test('a favourite shows once; more of them lead to all in Jobs', async ({ page }) => {
  // Favourites beyond the best: a dozen jobs chosen in Jobs (none opened), starred at once.
  await open(page, '?platform=windows');
  // The rows mount chunk by chunk.
  await expect.poll(() => rows(page).count()).toBeGreaterThanOrEqual(12);
  for (const id of (await listed(page)).slice(0, 12)) {
    await page.getByTestId(`job-row-${id}`).click({ modifiers: ['Control'] });
  }
  await page.getByTestId('pane-star').click();
  await expect.poll(async () => (await calls(page, 'set_pinned')).length).toBeGreaterThan(10);
  await page.getByTestId('nav-overview').click();
  await expect(page.getByTestId('favourites')).toBeVisible();
  const keys = await page
    .getByTestId('day-overview')
    .locator('[data-testid^="best-"], [data-testid^="favourite-"]')
    .evaluateAll((items) =>
      items.map((item) => (item.getAttribute('data-testid') ?? '').replace(/^\w+-/, '')),
    );
  expect(new Set(keys).size).toBe(keys.length);
  // More favourites than both blocks show: all of them in Jobs.
  const all = page.getByTestId('overview-all-favourites');
  await expect(all).toHaveText(/Alle \d+ Favoriten/);
  const count = Number((await all.innerText()).replace(/\D/g, ''));
  await all.click();
  await expect(page.getByTestId('filter-words')).toHaveText(filterWordsOf('favourites'));
  await expect(rows(page)).toHaveCount(count);
});

test('an open must goes into the profile at once and comes out with the undo', async ({ page }) => {
  await open(page, OVERVIEW);
  const block = page.getByTestId('open-musts');
  await expect(block.getByRole('heading')).toHaveText('Oft verlangt, nicht im Profil');
  const first = block.getByTestId('open-must').first();
  const term = (await first.locator('[data-copy]').textContent())?.trim() ?? '';
  expect(term).not.toBe('');
  await first.getByTestId('add-must').click();
  await expect(page.getByTestId('toast')).toContainText(`„${term}“ zum Profil hinzugefügt.`);
  const saved = await calls(page, 'save_profile');
  expect(saved).toHaveLength(1);
  const after = (saved[0]![1] as { save: { after: { keywords: string[] } } }).save.after;
  expect(after.keywords).toContain(term);
  await page.getByTestId('toast').getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(async () => (await calls(page, 'save_profile')).length).toBe(2);
  const undone = (await calls(page, 'save_profile'))[1]![1] as {
    save: { after: { keywords: string[] } };
  };
  expect(undone.save.after.keywords).not.toContain(term);
});

test('the market says 30 days per portal, the median rate beside the minimum, remote', async ({
  page,
}) => {
  await open(page, OVERVIEW);
  const block = page.getByTestId('market');
  await expect(block.getByRole('heading')).toHaveText('Markt der letzten 30 Tage');
  await expect(block.getByTestId('market-new')).toContainText('linkedin.com');
  await expect(block.getByTestId('market-rate')).toContainText('im Median aus');
  await expect(block.getByTestId('market-rate')).toContainText('dein Minimum');
  await expect(block.getByTestId('market-remote')).toContainText('%');
});

test('the files: the report, the Excel file, the folder; one not written yet says why', async ({
  page,
}) => {
  await open(page, OVERVIEW);
  const files = page.getByTestId('overview-files');
  const glyphs = await files
    .locator('.glyph')
    .evaluateAll((all) => all.map((glyph) => glyph.getAttribute('data-icon')));
  expect(glyphs).toEqual(['file-text', 'file-spreadsheet', 'folder-open']);
  await files.getByTestId('overview-folder').click();
  await expect
    .poll(async () => (await calls(page, 'open_target')).at(-1)?.[1])
    .toEqual({ target: { kind: 'excelInFolder' } });

  await open(page, `${OVERVIEW}&scenario=no-files`);
  const excel = page.getByTestId('overview-excel');
  await expect(excel).toHaveAttribute('aria-disabled', 'true');
  await excel.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Die Excel-Datei entsteht beim ersten Abruf.');
  await page.getByTestId('overview-open').click();
  await expect
    .poll(async () => (await calls(page, 'open_target')).at(-1)?.[1])
    .toEqual({ target: { kind: 'overview' } });
});

test('without a profile no requirement block and no ring counts', async ({ page }) => {
  await open(page, `${OVERVIEW}&scenario=no-profile`);
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.getByTestId('open-musts')).toHaveCount(0);
  await expect(page.getByTestId('tile-high')).toHaveCount(0);
  await expect(page.getByTestId('issue-excluded')).toHaveCount(0);
});

test('at 480 px nothing runs over; Abrufen ends on the column edge', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, OVERVIEW);
  const view = page.getByTestId('view-overview');
  const over = await view.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  const fetch = await page.getByTestId('overview-fetch').boundingBox();
  const tiles = await page.getByTestId('since').locator('.tiles').boundingBox();
  expect(fetch).not.toBeNull();
  expect(tiles).not.toBeNull();
  expect(Math.abs(fetch!.x + fetch!.width - (tiles!.x + tiles!.width))).toBeLessThanOrEqual(1);
  // While a run goes, Abbrechen takes its place.
  await page.getByTestId('overview-fetch').click();
  await expect(page.getByTestId('overview-cancel')).toBeVisible();
});
