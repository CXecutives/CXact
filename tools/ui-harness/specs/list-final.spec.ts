// The job list of the final round: its widths, its sections (Ausgeschlossen, Noch ohne
// Passung, Seit dem letzten Abruf), the search's keys and its hits elsewhere, the choice of
// several jobs, the run card, the states of the list and the trash's days.

import type { Page } from '@playwright/test';
import { calls, expect, NOW, open, settle, test } from './fixtures';

const WIN = '?platform=windows';
const list = (page: Page) => page.getByTestId('job-list');
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const excludedRows = (page: Page) =>
  page.getByTestId('excluded-rows').locator('[data-testid^="job-row-"]');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const facet = (page: Page, name: string) =>
  page.getByTestId('facet').getByRole('radio', { name: new RegExp(name) });

/** The width of the list column as the handle says it (the column ends at the handle). */
async function listWidth(page: Page): Promise<number> {
  await settle(page);
  return Number(await page.getByTestId('list-splitter').getAttribute('aria-valuenow'));
}

test.describe('widths', () => {
  test('the first width is at least 520 px where the reader keeps its room', async ({ page }) => {
    for (const width of [1360, 1600, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, WIN);
      expect(await listWidth(page), `${width} px`).toBeGreaterThanOrEqual(520);
    }
  });

  test('the list never gets narrower while the window grows, across the rail too', async ({
    page,
  }) => {
    await open(page, WIN);
    let last = 0;
    for (const width of [920, 1000, 1060, 1099, 1100, 1130, 1160, 1250, 1360, 1600, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => listWidth(page)).toBeGreaterThanOrEqual(last);
      last = await listWidth(page);
    }
    expect(last).toBeGreaterThanOrEqual(520);
  });

  test('the handle catches the pointer beside the list, never over its scrollbar', async ({
    page,
  }) => {
    await open(page, WIN);
    const hit = (await page.getByTestId('list-splitter').locator('.hit').boundingBox())!;
    const scroll = (await page.getByTestId('list-scroll').boundingBox())!;
    // The list's scroll area (its scrollbar at its right end) ends where the strip begins.
    expect(hit.x).toBeGreaterThanOrEqual(scroll.x + scroll.width);
    // The grip stays centred on the border.
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    const grip = (await page.getByTestId('list-splitter').locator('.grip').boundingBox())!;
    expect(Math.abs(grip.x + grip.width / 2 - hit.x)).toBeLessThanOrEqual(1);
  });
});

test('Neu, Alle and Favoriten keep their widths when a count goes', async ({ page }) => {
  await open(page, WIN);
  const neu = page.getByTestId('facet').getByRole('radio', { name: /Neu/ });
  const before = (await neu.boundingBox())!.width;
  await page.getByTestId('mark-all-read').click();
  await expect(neu.locator('.spare')).toHaveCount(1);
  expect((await neu.boundingBox())!.width).toBe(before);
});

test.describe('sections', () => {
  test('the excluded jobs are one folded section at the end; the choice is kept', async ({
    page,
  }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
    const divider = page.getByTestId('excluded-divider');
    // Under Alle: agency work, a country and an exclusion word.
    await expect(divider).toHaveText('Ausgeschlossen (3)');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
    // At the end of the list, below every other row.
    const last = (await rows(page).last().boundingBox())!;
    expect((await divider.boundingBox())!.y).toBeGreaterThanOrEqual(last.y + last.height);
    // The keys stay above a folded section: End opens the last row before it.
    await page.keyboard.press('End');
    await expect(list(page).locator('[data-group="rest"] [data-open]')).toHaveCount(1);
    await divider.click();
    await expect(divider).toHaveAttribute('aria-expanded', 'true');
    await expect(excludedRows(page)).toHaveCount(3);
    // Kept: the next start shows it open, in every place.
    await open(page, WIN);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'true');
    await expect(excludedRows(page)).toHaveCount(1);
    await page.getByTestId('excluded-divider').click();
    await open(page, WIN);
    await expect(page.getByTestId('excluded-divider')).toHaveAttribute('aria-expanded', 'false');
  });

  test('Neu counts no excluded job; its excluded ones wait in their section', async ({ page }) => {
    await open(page, WIN);
    await expect(facet(page, 'Neu')).toContainText('6');
    await expect(rows(page)).toHaveCount(6);
    await expect(page.getByTestId('excluded-divider')).toHaveText('Ausgeschlossen (1)');
  });

  test('under Neu the jobs of the last fetch stand apart from the older ones', async ({ page }) => {
    await open(page, WIN);
    const fresh = page.getByTestId('fresh-divider');
    await expect(fresh).toHaveText('Seit dem letzten Abruf');
    await expect(page.getByTestId('older-divider')).toHaveText('Früher');
    const group = (name: string) =>
      list(page).locator(`[data-group="${name}"] [data-testid^="job-row-"]`);
    await expect(group('fresh')).toHaveCount(3);
    await expect(group('rest')).toHaveCount(3);
    await expect(group('fresh').first()).toHaveAttribute(
      'data-testid',
      'job-row-freelancermap-2801',
    );
    // Alle is one list: no such divider there.
    await facet(page, 'Alle').click();
    await expect(page.getByTestId('fresh-divider')).toHaveCount(0);
  });

  test('after Alle gelesen Neu says there is nothing new and leads to Alle', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('mark-all-read').click();
    const line = page.getByTestId('caught-up');
    await expect(line).toContainText('Keine neuen Jobs.');
    await line.getByRole('button', { name: 'Alle zeigen' }).click();
    await expect(facet(page, 'Alle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('caught-up')).toHaveCount(0);
  });

  test('by match the jobs still waiting for their score stand on top', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    await facet(page, 'Alle').click();
    await settle(page);
    const divider = page.getByTestId('pending-divider');
    await expect(divider).toHaveText('Noch ohne Passung');
    await expect(rows(page).first()).toHaveAttribute('data-testid', 'job-row-linkedin-4100200302');
    const waiting = (await row(page, 'linkedin-4100200302').boundingBox())!;
    expect(waiting.y).toBeLessThan((await row(page, 'freelancermap-2801').boundingBox())!.y);
    // By date there is no such group.
    await page.getByTestId('sort').click();
    await page.getByTestId('menu-item-newest').click();
    await expect(page.getByTestId('pending-divider')).toHaveCount(0);
  });
});

test.describe('search', () => {
  test('Enter in the search opens the first hit, its row takes the focus', async ({ page }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
    const search = page.getByTestId('search');
    await search.fill('Interim');
    await expect(rows(page)).toHaveCount(3);
    await search.press('Enter');
    await expect(rows(page).first()).toBeFocused();
    await expect(list(page).locator('[data-open]')).toHaveCount(1);
    const opened = await list(page)
      .locator('[data-open] [data-testid^="job-row-"]')
      .getAttribute('data-testid');
    expect(opened).toBe(await rows(page).first().getAttribute('data-testid'));
    await expect(page.getByTestId('reader-title')).toBeVisible();
  });

  test('ArrowDown in the search goes to the first hit too', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').click();
    await page.keyboard.press('ArrowDown');
    await expect(rows(page).first()).toBeFocused();
    await expect(page.getByTestId('reader-title')).toBeVisible();
  });

  test('hits in another place are a button that goes there', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('search').fill('Kreditoren');
    const button = page.getByTestId('also-archive');
    await expect(button).toHaveText('Im Archiv (1)');
    await expect(button).toHaveClass(/secondary/);
    await button.click();
    await expect(page.getByTestId('places').getByRole('tab', { name: 'Archiv' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByTestId('search')).toHaveValue('Kreditoren');
  });
});

test.describe('choosing several', () => {
  test('the pane names the chosen jobs and offers what fits them, with words', async ({ page }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
    // The first opens (and is read), the unread one joins without opening.
    await row(page, 'freelancermap-2805').click();
    await expect(row(page, 'freelancermap-2805')).toHaveAttribute('aria-current', 'true');
    await row(page, 'linkedin-4100200302').click({ modifiers: ['Control'] });
    const pane = page.getByTestId('selection-pane');
    await expect(pane).toContainText('2 Jobs ausgewählt');
    const titles = pane.getByTestId('selection-titles');
    await expect(titles).toContainText('Finance Business Partner Shared Service');
    await expect(titles).toContainText('Projektcontroller Bau');
    const actions = pane.getByTestId('selection-actions').getByRole('button');
    await expect(actions).toHaveText([
      'Archivieren',
      'In den Papierkorb',
      'Favorit',
      'Als gelesen',
      'Details holen',
    ]);
    // Both lack their full ad: one run fetches them.
    await pane.getByTestId('pane-details').click();
    const started = await calls(page, 'start_run');
    expect(started.at(-1)?.[1]).toMatchObject({
      request: {
        kind: 'details',
        keys: expect.arrayContaining([
          { portal: 'linkedin', id: '4100200302' },
          { portal: 'freelancermap', id: '2805' },
        ]),
      },
    });
    // A job with its full ad: no Details holen.
    await page.keyboard.press('Escape');
    await row(page, 'freelancermap-2801').click();
    await expect(row(page, 'freelancermap-2801')).toHaveAttribute('aria-current', 'true');
    await row(page, 'linkedin-4100200301').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('pane-details')).toHaveCount(0);
  });

  test('many chosen: eight titles, then how many more; the bar is one line', async ({ page }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
    await rows(page).first().click();
    await page.keyboard.press('Shift+End');
    const pane = page.getByTestId('selection-pane');
    await expect(pane).toContainText('12 Jobs ausgewählt');
    await expect(pane.getByTestId('selection-titles').locator('li')).toHaveCount(9);
    await expect(pane.getByTestId('selection-more')).toHaveText('+4');
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toBeVisible();
    expect((await bar.locator('xpath=..').boundingBox())!.height).toBe(28);
    await expect(page.getByTestId('selection-clear')).toHaveAttribute(
      'aria-label',
      'Auswahl aufheben',
    );
    await page.getByTestId('selection-clear').click();
    await expect(pane).toHaveCount(0);
  });

  test('a checkbox over the ring chooses the row, in two columns and in one', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    const check = list(page).getByTestId('check-linkedin-4100200301');
    await check.hover();
    await expect(check).toHaveCSS('opacity', '1');
    await check.click();
    await expect(page.getByTestId('selection-pane')).toContainText('2 Jobs ausgewählt');
    await expect(check).toHaveAttribute('aria-checked', 'true');
    await expect(list(page).getByTestId('check-freelancermap-2801')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Again: out of the choice, the other job alone is open.
    await check.click();
    await expect(page.getByTestId('selection-pane')).toHaveCount(0);
    await expect(page.getByTestId('reader-title')).toBeVisible();
    // One column: choosing opens nothing, the header's bar acts on the row.
    await page.setViewportSize({ width: 800, height: 700 });
    await open(page, WIN);
    await list(page).getByTestId('check-freelancermap-2802').click();
    await expect(page.getByTestId('selection-count')).toHaveText('1 ausgewählt');
    await expect(page.getByTestId('reader-title')).toHaveCount(0);
  });
});

test.describe('run card', () => {
  test('finished: one line per portal; its counts lead to Neu', async ({ page }) => {
    await open(page, WIN);
    await page.getByTestId('sort').click();
    await page.getByTestId('menu-item-newest').click();
    await page.getByTestId('place-archive').click();
    await page.getByTestId('run-status').click();
    const linkedin = page.getByTestId('portal-line-linkedin');
    await expect(linkedin).toContainText('linkedin.com');
    await expect(linkedin).toContainText('2 neu, 1 doppelt, 1 ohne Details');
    await expect(page.getByTestId('portal-line-freelancermap')).toContainText('3 neu');
    // One way to close it, no second one to fold it.
    await expect(
      page.getByTestId('run-card').getByRole('button', { name: 'Ausblenden' }),
    ).toHaveCount(1);
    await expect(page.getByTestId('run-toggle')).toHaveCount(0);
    // "2 mit hoher Passung": Neu, the good ones first.
    await page.getByTestId('last-top').click();
    await expect(facet(page, 'Neu')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('sort')).toContainText('Nach Passung');
    await page.getByTestId('place-trash').click();
    await page.getByTestId('last-new').click();
    await expect(facet(page, 'Neu')).toHaveAttribute('aria-checked', 'true');
  });

  test('running: one line per portal with its countdown, then it goes on shortly', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=running`);
    await expect(page.getByTestId('countdown-linkedin')).toHaveText('Weiter in 0:42');
    await expect(page.getByTestId('countdown-freelance')).toHaveText('Weiter in 12:00');
    await page.clock.setFixedTime(new Date(NOW.getTime() + 60_000));
    await expect(page.getByTestId('countdown-linkedin')).toHaveText('Geht gleich weiter');
    await expect(page.getByTestId('countdown-freelance')).toHaveText('Weiter in 11:00');
  });

  test('failed: the time of the attempt, why, and a way to try again', async ({ page }) => {
    await open(page, `${WIN}&scenario=offline`);
    await page.getByTestId('run-status').click();
    const card = page.getByTestId('run-finished');
    await expect(card).toContainText('08:30');
    const failed = page.getByTestId('run-failed');
    await expect(failed).toContainText('Gmail ist nicht erreichbar.');
    await failed.getByRole('button', { name: 'Erneut versuchen' }).click();
    expect(await calls(page, 'start_run')).toHaveLength(1);
  });
});

test.describe('states', () => {
  test('a list that did not load says so, with a retry; the header counts nothing', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=list-error`);
    const error = page.getByTestId('list-error');
    await expect(error).toContainText('Die Jobliste ließ sich nicht laden.');
    await expect(error.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
    await expect(page.getByTestId('facet')).toHaveCount(0);
    await expect(page.getByTestId('sort')).toHaveCount(0);
    await expect(page.getByTestId('mark-all-read')).toHaveCount(0);
  });

  test('a thin profile says once that the fit stays rough, and leads to it', async ({ page }) => {
    await open(page, `${WIN}&scenario=profile-thin`);
    const note = page.getByTestId('thin-profile');
    await expect(note).toContainText('Wenig Inhalt im Profil, die Passung bleibt grob.');
    await note.getByRole('button', { name: 'Profil öffnen' }).click();
    await expect(page.getByTestId('view-profile')).toBeVisible();
  });

  test('a job in the Papierkorb says how long it has left', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2802').hover();
    await page.getByTestId('trash-freelancermap-2802').click();
    await page.waitForTimeout(550);
    await page.getByTestId('place-trash').click();
    const left = row(page, 'freelancermap-2802').getByTestId('trash-left');
    await expect(left).toHaveText('noch 30 Tage');
    // A day later (the page's clock moves on when the window comes back).
    await page.clock.setFixedTime(new Date(NOW.getTime() + 86_400_000 + 60_000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(left).toHaveText('noch 29 Tage');
  });
});
