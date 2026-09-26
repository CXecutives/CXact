// English beside German: the reader's words for an exclusion in both languages, and the two
// English baselines (the reader and the settings). The switch itself and the start in the
// language the backend says are shell.spec.ts.

import type { Page } from '@playwright/test';
import { expect, expectShot, open, test } from './fixtures';

const WIN = '?platform=windows';
const EN = `${WIN}&lang=en`;

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
}

test('an exclusion by country names the countries in words, in both languages', async ({
  page,
}) => {
  for (const [query, sentence] of [
    [WIN, 'Der Einsatzort liegt außerhalb von Deutschland und Österreich.'],
    [EN, 'The location is outside Germany and Austria.'],
  ] as const) {
    // The excluded section open, as a user who opened it once finds it.
    await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
    await open(page, query);
    await page
      .getByTestId('excluded-rows')
      .locator('[data-testid^="job-row-"]')
      .filter({ hasText: 'Payroll Specialist' })
      .click();
    await expect(page.getByTestId('exclusion')).toContainText(sentence);
  }
});

test('baseline: jobs with the reader in English', async ({ page }) => {
  await open(page, EN);
  // The best scored job (by match the first row is one still without a score).
  await page.getByTestId('job-row-freelancermap-2801').click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  await expectShot(page, 'jobs-reader-en');
});

test('baseline: settings in English', async ({ page }) => {
  await settings(page, EN);
  await page.getByTestId('settings-look').scrollIntoViewIfNeeded();
  await expectShot(page, 'settings-en');
});
