// Final round, team "switches and profile": the mailbox address to copy (the Profil parts of
// this round are in profile.spec.ts).

import { expect, open, test } from './fixtures';
import { showTab } from './helpers';

const WIN = '?platform=windows';

test('the connected mailbox address is text to copy', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  const address = await showTab(
    page,
    page.getByTestId('settings-mailbox').locator('[data-copy]').first(),
  );
  await expect(address).toHaveText('alerts.demo@gmail.com');
  expect(await address.evaluate((node) => getComputedStyle(node).userSelect)).not.toBe('none');
});
