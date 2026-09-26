// The words of the final text audit: what a text promises is what the app does, one name
// for one thing, numbers formatted like every other count, rows in short words.

import type { Page } from '@playwright/test';
import { expect, open, runFinished, test } from './fixtures';

const WIN = '?platform=windows';

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
}

test('the English reader counts the must-have requirements, as the German one does', async ({
  page,
}) => {
  await open(page, `${WIN}&lang=en`);
  // The best scored job (by match the first row is one still without a score).
  await page.getByTestId('job-row-freelancermap-2801').click();
  // German counts Pflichtanforderungen; the English AI prompt says "must-have requirements".
  await expect(page.getByTestId('must')).toHaveText(/^\d+ of \d+ must-haves met/);
});

test('an excluded row names a missing degree or licence in short words, never a sentence', async ({
  page,
}) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  const excluded = page.getByTestId('excluded-rows');
  // A country outside the profile says what does not fit, like its neighbours.
  await expect(excluded.getByTestId('job-row-linkedin-4100200305').locator('.foot')).toHaveText(
    'Einsatzland passt nicht',
  );
  const key = { portal: 'freelance', id: '900412' } as const;
  const row = excluded.getByTestId('job-row-freelance-900412');
  await expect(row.locator('.foot')).toHaveText('Zeitarbeit');
  const job = await page.evaluate((k) => window.__harness.job(k), key);
  // The engine excludes on a degree or licence the ad makes mandatory (`formalOpen`).
  const exclude = (code: string, params: Record<string, string | boolean>) =>
    page.evaluate(
      ([base, note]) => {
        window.__harness.emit({
          type: 'jobUpdated',
          job: { ...base, match: { ...base.match!, note } },
          fresh: false,
        });
      },
      [job!, { code, params }] as const,
    );
  await exclude('formalOpen', { class: 'degree', mandatory: true });
  await expect(row.locator('.foot')).toHaveText('Abschluss fehlt');
  await exclude('formalOpen', { class: 'licence', mandatory: true });
  await expect(row.locator('.foot')).toHaveText('Zulassung fehlt');
  // A code of a newer core: the plain word, not a raw code and not a cut sentence.
  await exclude('somethingNew', {});
  await expect(row.locator('.foot')).toHaveText('Ausgeschlossen');
});

test('fetching every alert mail has one name: in the list, the settings and the run', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=empty`);
  await expect(page.getByTestId('read-older')).toContainText('Alle Alert-Mails abrufen');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-mailbox')).toContainText('Alle Alert-Mails abrufen');
  // The run card names the run by its kind until the first status comes.
  await page.evaluate(() => (window.__harness.holdAfter = 1));
  await page.getByTestId('full-mailbox').click();
  await page
    .getByTestId('dialog-full-mailbox')
    .getByRole('button', { name: 'Abrufen', exact: true })
    .click();
  await expect(page.getByTestId('run-running')).toContainText('Alle Alert-Mails abrufen');
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
});

test('the selection bar counts with a thousands separator, like the pane beside it', async ({
  page,
}) => {
  // A thousand rows come in windows of 60: more time than a usual test.
  test.setTimeout(60_000);
  await open(page, `${WIN}&scenario=many`);
  const rows = page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
  await rows.first().click();
  // The list shows its rows in windows: scroll until more than a thousand are there.
  const list = page.getByTestId('list-scroll');
  await expect
    .poll(
      async () => {
        await list.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
        return rows.count();
      },
      { intervals: [50], timeout: 40_000 },
    )
    .toBeGreaterThan(1000);
  await rows.nth(1000).click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('selection-count')).toHaveText('1.001 ausgewählt');
  await expect(page.getByTestId('reader-pane')).toContainText('1.001 Jobs ausgewählt');
});

test('an empty list during a fetch says the jobs come in as it goes, not at its end', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=empty`);
  await page.evaluate(() => (window.__harness.holdAfter = 1));
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('empty-all')).toHaveText('Die Jobs erscheinen hier nach und nach.');
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
});

test('one word per thing: the Excel file', async ({ page }) => {
  await open(page, WIN);
  // The glossary's Excel-Datei, as in Einstellungen ("Excel öffnen" read as "start Excel").
  await page.getByTestId('nav-overview').click();
  await expect(page.getByTestId('overview-excel')).toHaveText('Excel-Datei öffnen');
});

test('a job of last week shows its weekday and date, not "vor 4 Tagen"', async ({ page }) => {
  // The clock stands on Thursday 24.09.2026, 09:30.
  await open(page, WIN);
  const date = (key: string) =>
    page.getByTestId('job-rows').getByTestId(`job-row-${key}`).locator('.date');
  // Two days back still reads as a word, earlier days by weekday and date.
  await expect(date('freelance-900413')).toHaveText('vorgestern');
  await expect(date('freelancermap-2805')).toHaveText('Mo 21.09.');
  await expect(date('freelancermap-2806')).toHaveText('So 20.09.');
});

test('an archived job is brought back with a verb, not a way back to Jobs', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('place-archive').click();
  const key = 'linkedin-4100200306';
  await page.getByTestId('job-list').getByTestId(`job-row-${key}`).hover();
  // The place it goes to, like the other moves ("In den Papierkorb").
  await expect(page.getByTestId(`toInbox-${key}`)).toHaveAttribute(
    'aria-label',
    'Zurück in den Eingang',
  );
});

test('an ad that could not be fetched says so with the one verb for details', async ({ page }) => {
  await open(page, WIN);
  const key = { portal: 'freelancermap', id: '2805' } as const;
  const job = await page.evaluate((k) => window.__harness.job(k), key);
  await page.evaluate((base) => {
    window.__harness.emit({
      type: 'jobUpdated',
      job: { ...base, detail: { kind: 'unfetchable' } },
      fresh: false,
    });
  }, job!);
  const row = page.getByTestId('job-rows').getByTestId('job-row-freelancermap-2805');
  // "Details holen" is the verb for details: the badge's tooltip and the reader agree.
  await row.locator('.badge').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Die Anzeige ließ sich mehrmals nicht holen.');
  await row.click();
  await expect(page.getByTestId('detail-note')).toHaveText(
    'Die Anzeige ließ sich mehrmals nicht holen.',
  );
});

test('the teaser badge says what "Vorschau" is', async ({ page }) => {
  await open(page, WIN);
  const badge = page
    .getByTestId('job-rows')
    .getByTestId('job-row-freelance-900411')
    .locator('.badge');
  await expect(badge).toHaveText('Nur Vorschau');
  await badge.hover();
  await expect(page.getByRole('tooltip')).toHaveText(
    'Ohne Anmeldung zeigt das Portal nur den Anfang der Anzeige.',
  );
});

test('English names agency work and the preferred rate one way everywhere', async ({ page }) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, `${WIN}&lang=en`);
  // Short "Agency work" read like any work through an agency, common for freelancers.
  await expect(
    page.getByTestId('excluded-rows').getByTestId('job-row-freelance-900412').locator('.foot'),
  ).toHaveText('Temporary agency work');
  // The field is "Preferred day rate"; "target" is the word of the target roles. The
  // preference is the reason of the rate's verdict, in its tooltip.
  await page.getByTestId('job-rows').getByTestId('job-row-freelancermap-2801').click();
  await page.getByTestId('criteria').getByTestId('term-rate').locator('.verdict').hover();
  await expect(page.getByRole('tooltip')).toContainText('preferred rate of €1,200');
});

test('a sentence speaks to the user and quotes the control it names', async ({ page }) => {
  await settings(page);
  // "Erst Details holen einschalten." read as "first fetch details, then switch on".
  await page.getByTestId('toggle-details-freelance').click();
  await page.getByTestId('sign-in-freelance').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Schalte erst „Details holen“ ein.');
});
