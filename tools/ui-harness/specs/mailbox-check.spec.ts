// "Verbinden" in Einstellungen while it signs in and counts: it holds the app and it can be
// stopped.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';

const WIN = '?platform=windows';

async function changeMailbox(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
}

test('CRED-1: cancel stops a check in progress, quietly', async ({ page }) => {
  await changeMailbox(page);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-save').click();
  const cancel = page.getByTestId('mailbox-cancel');
  await expect(page.getByTestId('mailbox-save')).toHaveAttribute('aria-busy', 'true');
  // While it signs in and counts, cancel stays live and stops it.
  await expect(cancel).not.toHaveAttribute('aria-disabled', 'true');
  await cancel.click();
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
  // The stop says nothing, and nothing was saved.
  await expect(page.getByTestId('mailbox-note')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(page.getByTestId('settings-mailbox')).not.toContainText('Abgebrochen');
  await page.evaluate(() => (window.__harness.holdMailbox = false));

  // Esc does the same.
  await page.getByTestId('mailbox-change').click();
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(page.getByTestId('mailbox-save')).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  expect(await calls(page, 'cancel_run')).toHaveLength(2);
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-note')).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdMailbox = false));
});

test('CRED-1: a fetch waits while the mailbox is checked, and says why', async ({ page }) => {
  await changeMailbox(page);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-save')).toHaveAttribute('aria-busy', 'true');
  // The check goes on while she looks at the jobs: Abrufen is refused, naming the check.
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('start-error')).toHaveText('Gerade wird das Postfach geprüft.');
  await expect(page.getByTestId('run-running')).toHaveCount(0);
  // Once it is done (the page loads the saved state), Abrufen reads the new mailbox.
  const loads = (await calls(page, 'app_state')).length;
  await page.evaluate(() => (window.__harness.holdMailbox = false));
  await expect.poll(async () => (await calls(page, 'app_state')).length).toBeGreaterThan(loads);
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-running')).toBeVisible();
});
