// What the page does when a source or the profile is gone, through the stub, which mirrors the
// backend's contract: a profile that no longer reads leaves no scores behind, and every
// source may be switched off, while a fetch then waits for one and says why
// (the backend refuses it too, never with a failed fetch).

import { calls, expect, open, test } from './fixtures';
import { PORTALS, reveal, T } from './helpers';

const WIN = '?platform=windows';

test('every portal may be switched off; Jobs suchen then waits for one and says why', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  // Every source switched on (the sites outside Germany are off already).
  for (const portal of PORTALS) {
    await (await reveal(page, page.getByTestId(`toggle-enabled-${portal}`))).click();
    await expect(page.getByTestId(`toggle-enabled-${portal}`)).toHaveAttribute(
      'aria-checked',
      'false',
    );
  }
  // Saved as chosen: no refusal after the switches moved.
  await expect(page.getByTestId('portal-error')).toHaveCount(0);
  expect(await calls(page, 'save_settings')).toHaveLength(PORTALS.length);

  await page.getByTestId('nav-jobs').click();
  const fetch = page.getByTestId('fetch');
  await expect(fetch).toHaveAttribute('aria-disabled', 'true');
  await fetch.hover();
  await expect(page.getByRole('tooltip')).toHaveText(T.toolbar.needsPortal);
  await fetch.click({ force: true });
  expect(await calls(page, 'start_run')).toHaveLength(0);
  // No run began, so no failed fetch and no refusal.
  await expect(page.getByTestId('start-error')).toHaveCount(0);
  await expect(page.getByText('Abruf fehlgeschlagen')).toHaveCount(0);

  // One portal back on: Jobs suchen goes again.
  await page.getByTestId('nav-settings').click();
  await (await reveal(page, page.getByTestId('toggle-enabled-freelancermap'))).click();
  await page.getByTestId('nav-jobs').click();
  await expect(fetch).not.toHaveAttribute('aria-disabled', 'true');
});

test('a profile that no longer reads leaves no verdicts in the list', async ({ page }) => {
  await open(page, `${WIN}&scenario=profile-broken`);
  await expect(page.getByTestId('no-profile')).toContainText(T.list.profileBrokenText);
  // Without a profile no job has a score: they all stand in "Noch nicht bewertet".
  await expect(
    page.getByTestId('unscored-rows').locator('[data-testid^="job-row-"]').first(),
  ).toBeVisible();
  // Nothing is excluded or scored by a profile that is not there.
  await expect(page.getByTestId('excluded-divider')).toHaveCount(0);
});
