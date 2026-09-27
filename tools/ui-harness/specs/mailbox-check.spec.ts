// "Verbinden" in the mailbox dialog of Einstellungen while it signs in and counts: it holds
// the page, it can be stopped, and a sign-in whose count did not finish is still a connected
// mailbox.

import type { Page } from '@playwright/test';
import { calls, expect, open, test, text } from './fixtures';

const WIN = '?platform=windows';

async function changeMailbox(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
}

const dialog = (page: Page) => page.getByTestId('dialog-mailbox');

test('CRED-1: cancel and Esc stop a check in progress, quietly', async ({ page }) => {
  await changeMailbox(page);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  const connect = dialog(page).getByTestId('dialog-confirm');
  await connect.click();
  await expect(connect).toHaveAttribute('aria-busy', 'true');
  // While it signs in and counts, cancel stays live and stops it.
  const cancel = dialog(page).getByTestId('dialog-cancel');
  await expect(cancel).not.toHaveAttribute('aria-disabled', 'true');
  await cancel.click();
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
  // The stop says nothing, and nothing was saved.
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(page.getByTestId('settings-mailbox')).not.toContainText('Abgebrochen');
  await page.evaluate(() => (window.__harness.holdMailbox = false));

  // Esc does the same.
  await page.getByTestId('mailbox-change').click();
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(dialog(page).getByTestId('dialog-confirm')).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  expect(await calls(page, 'cancel_run')).toHaveLength(2);
  await expect(dialog(page)).toBeHidden();
  await page.evaluate(() => (window.__harness.holdMailbox = false));
});

test('CRED-3: signed in but not counted is connected, and its badge is the answer', async ({
  page,
}) => {
  await changeMailbox(page, `${WIN}&mail=uncounted`);
  await dialog(page).getByTestId('dialog-confirm').click();
  await expect(dialog(page)).toBeHidden();
  const connected = await text(page, 'settings.connected');
  await expect(page.getByTestId('settings-mailbox')).toContainText(connected);
  // Einstellungen shows no count: the badge says it all, no toast repeats it.
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // With the count there, the same.
  await changeMailbox(page);
  await dialog(page).getByTestId('dialog-confirm').click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByTestId('settings-mailbox')).toContainText(connected);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('CRED-2: a mistyped app password is named at once, also while a fetch runs', async ({
  page,
}) => {
  await changeMailbox(page);
  // A fetch starts while the dialog is open.
  await page.evaluate(() => {
    window.__harness.holdAfter = 1;
    window.__harness.appRun('fetch');
  });
  await page.getByTestId('mailbox-password').fill('kurz');
  await dialog(page).getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('mailbox-form')).toContainText(
    'Ein App-Passwort hat 16 Buchstaben.',
  );
  // In the right shape it waits for the fetch, which the form says; the dialog stays.
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await dialog(page).getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('mailbox-form')).toContainText('Gerade läuft schon ein Abruf.');
  await expect(dialog(page)).toBeVisible();
  expect(await calls(page, 'save_mailbox')).toHaveLength(2);
  await page.evaluate(() => (window.__harness.holdAfter = null));
});
