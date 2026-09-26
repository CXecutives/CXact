// The Profil page's small hints: what the Schwerpunkt star does, why Speichern, Verwerfen
// and Übernehmen wait (moved here when Einstellungen and the first run got one spec).

import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures';

const WIN = '?platform=windows';

async function profile(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
}

test('the Schwerpunkt star says what a click does; an empty row what comes first', async ({
  page,
}) => {
  await profile(page);
  const stars = page.getByTestId('competence-star');
  // Like the favourite star of a job: its words follow its state.
  const marked = stars.and(page.locator('[aria-pressed="true"]')).first();
  await expect(marked).toHaveAttribute('aria-label', 'Schwerpunkt entfernen');
  await marked.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Schwerpunkt entfernen');
  const plain = stars.and(page.locator('[aria-pressed="false"]')).first();
  await expect(plain).toHaveAttribute('aria-label', 'Als Schwerpunkt markieren');
  // A row without a competence: its star waits, and says for what.
  await page.getByTestId('competence-add').click();
  const empty = page.getByTestId('competence-row').last().getByTestId('competence-star');
  await expect(empty).toHaveAttribute('aria-disabled', 'true');
  await empty.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Trag erst eine Kompetenz ein.');
});

test('Speichern, Verwerfen and Übernehmen say why they wait', async ({ page }) => {
  await profile(page);
  for (const id of ['profile-save', 'profile-discard']) {
    const button = page.getByTestId(id);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Noch nichts geändert.');
  }
  // With a change they work, and say nothing.
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(page.getByTestId('profile-save')).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-discard').click();
  // The steps with an AI: Übernehmen waits for the answer.
  await page.getByTestId('profile-update-cv').click();
  const take = page.getByTestId('paste-take');
  await expect(take).toHaveAttribute('aria-disabled', 'true');
  await take.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Füge erst die Antwort der KI ein.');
});
