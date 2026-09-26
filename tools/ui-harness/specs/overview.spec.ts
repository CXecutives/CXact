// The Übersicht, a view of its own and where the app starts: each block only with content,
// every count leads into the list, the requirements the profile lacks most often (added at
// once, with an undo), the market of the week.

import { calls, expect, open, test } from './fixtures';

test('the app starts in the Übersicht; a count leads into the list', async ({ page }) => {
  await open(page, '?platform=windows&view=overview');
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.getByTestId('tile-new')).toContainText('6');
  await page.getByTestId('tile-new').click();
  await expect(page.getByTestId('list-scroll')).toBeVisible();
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
});

test('no job is marked applied: no Beworben block, no note', async ({ page }) => {
  await open(page, '?platform=windows&view=overview');
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.getByTestId('applied')).toHaveCount(0);
  await expect(page.getByTestId('day-overview')).not.toContainText('Beworben');
});

test('an open must goes into the profile at once and comes out with the undo', async ({ page }) => {
  await open(page, '?platform=windows&view=overview');
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

test('the market says the week per portal, the median rate beside the minimum, remote', async ({
  page,
}) => {
  await open(page, '?platform=windows&view=overview');
  const block = page.getByTestId('market');
  await expect(block.getByTestId('market-new')).toContainText('linkedin.com');
  await expect(block.getByTestId('market-rate')).toContainText('im Mittel aus');
  await expect(block.getByTestId('market-rate')).toContainText('dein Minimum');
  await expect(block.getByTestId('market-remote')).toContainText('%');
});

test('without a profile no requirement block and no ring counts', async ({ page }) => {
  await open(page, '?platform=windows&view=overview&scenario=no-profile');
  await expect(page.getByTestId('day-overview')).toBeVisible();
  await expect(page.getByTestId('open-musts')).toHaveCount(0);
  await expect(page.getByTestId('tile-high')).toHaveCount(0);
});
