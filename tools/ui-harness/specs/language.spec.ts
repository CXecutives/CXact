// English beside German: the reader's words for an exclusion in both languages, and the two
// English baselines (the reader and the settings). The switch itself and the start in the
// language the backend says are shell.spec.ts.

import type { Page } from '@playwright/test';
import { demoScore } from './demo';
import { expect, expectShot, open, test } from './fixtures';

/** The score of the best job, the first row of the list (freelancermap-2801). */
const BEST = String(demoScore('freelancermap-2801'));

const WIN = '?platform=windows';
const EN = `${WIN}&lang=en`;

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
}

test('baseline: jobs with the reader in English', async ({ page }) => {
  await open(page, EN);
  // The best scored job.
  await page.getByTestId('job-row-freelancermap-2801').click();
  await expect(page.getByTestId('reader-ring')).toContainText(BEST);
  await expectShot(page, 'jobs-reader-en');
});

test('baseline: settings in English', async ({ page }) => {
  // Darstellung is hidden for now (cards.ts LOOK_SHOWN): the first tab, in English.
  await settings(page, EN);
  await expectShot(page, 'settings-en');
});
