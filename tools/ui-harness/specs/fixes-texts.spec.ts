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

test('an archived job is brought back with the verb of the Papierkorb: Wiederherstellen', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('place-archive').click();
  const key = 'linkedin-4100200306';
  await page.getByTestId('job-list').getByTestId(`job-row-${key}`).click({ button: 'right' });
  await expect(page.getByTestId('menu-item-toInbox')).toHaveText('Wiederherstellen');
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
  // The row carries no badge; the reader says it.
  await expect(row.locator('.badge')).toHaveCount(0);
  await row.click();
  await expect(page.getByTestId('detail-note')).toHaveText(
    'Die Anzeige ließ sich mehrmals nicht holen.',
  );
});

test('English names the preferred rate one way everywhere', async ({ page }) => {
  await open(page, `${WIN}&lang=en`);
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
