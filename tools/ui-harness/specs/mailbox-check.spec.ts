// "Verbinden" in the mailbox form of Einstellungen while it signs in and counts: it holds the
// page, it can be stopped, and a sign-in whose count did not finish is still a connected
// mailbox. The providers: their texts and their pages.

import type { Page } from '@playwright/test';
import { calls, expect, open, test, text } from './fixtures';
import { expectMailboxState, reveal, T } from './helpers';

const WIN = '?platform=windows';

async function changeMailbox(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
}

const form = (page: Page) => page.getByTestId('mailbox-form');
const save = (page: Page) => page.getByTestId('mailbox-save');

/** Chooses a provider in the form's list. */
async function choose(page: Page, name: string): Promise<void> {
  await page.getByTestId('mailbox-provider').click();
  await page
    .getByRole('listbox', { name: T.settings.providerLabel })
    .getByRole('option', { name })
    .click();
}

test('CRED-1: cancel and Esc stop a check in progress, quietly', async ({ page }) => {
  await changeMailbox(page);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  const width = (await save(page).boundingBox())!.width;
  await save(page).click();
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  // Busy, Verbinden keeps its width.
  expect(Math.abs((await save(page).boundingBox())!.width - width)).toBeLessThan(1);
  // While it signs in and counts, cancel stays live and stops it.
  const cancel = page.getByTestId('mailbox-cancel');
  await expect(cancel).not.toHaveAttribute('aria-disabled', 'true');
  await cancel.click();
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(form(page)).toHaveCount(0);
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
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  expect(await calls(page, 'cancel_run')).toHaveLength(2);
  await expect(form(page)).toHaveCount(0);
  await page.evaluate(() => (window.__harness.holdMailbox = false));
});

test('CRED-3: signed in but not counted is connected, and its state is the answer', async ({
  page,
}) => {
  await changeMailbox(page, `${WIN}&mail=uncounted`);
  await save(page).click();
  await expect(form(page)).toHaveCount(0);
  const connected = await text(page, 'settings.connected');
  await expectMailboxState(page, connected);
  // Einstellungen shows no count: the state says it all, no toast repeats it.
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // With the count there, the same.
  await changeMailbox(page);
  await save(page).click();
  await expect(form(page)).toHaveCount(0);
  await expectMailboxState(page, connected);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('CRED-2: a mistyped app password is named at once, also while a fetch runs', async ({
  page,
}) => {
  await changeMailbox(page);
  // A fetch starts while the form is open.
  await page.evaluate(() => {
    window.__harness.holdAfter = 1;
    window.__harness.appRun('fetch');
  });
  await page.getByTestId('mailbox-password').fill('kurz');
  await save(page).click();
  await expect(form(page)).toContainText('Ein App-Passwort hat 16 Buchstaben.');
  // In the right shape it waits for the fetch, which the form says; the form stays.
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await save(page).click();
  await expect(form(page)).toContainText('Gerade läuft schon eine Suche.');
  await expect(form(page)).toBeVisible();
  expect(await calls(page, 'save_mailbox')).toHaveLength(2);
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('a provider of its own: GMX takes the password, its page says how to allow IMAP', async ({
  page,
}) => {
  await changeMailbox(page);
  const provider = page.getByTestId('mailbox-provider');
  await expect(provider).toHaveText('Gmail');
  await provider.click();
  const list = page.getByRole('listbox', { name: T.settings.providerLabel });
  await expect(list.getByRole('option')).toHaveText(['Gmail', 'iCloud', 'GMX', 'WEB.DE']);
  // Esc closes the list and leaves the form open.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(form(page)).toBeVisible();
  // Gmail: the app password with its info symbol and Google's page.
  await expect(form(page)).toContainText(T.settings.password);
  // iCloud: an app password too, in Apple's words.
  await choose(page, 'iCloud');
  await expect(form(page).getByTestId('info-tip')).toHaveCount(1);
  await expect(page.getByTestId('mailbox-user')).toHaveAttribute(
    'placeholder',
    T.settings.addressExample('icloud'),
  );
  await choose(page, 'GMX');
  // GMX: the password, no info symbol, no example, the way to allow IMAP.
  await expect(form(page)).toContainText(T.settings.plainPassword);
  await expect(form(page)).not.toContainText(T.settings.password);
  await expect(page.getByTestId('mailbox-password')).not.toHaveAttribute('placeholder', /./);
  await expect(form(page).getByTestId('create-password')).toHaveText(T.settings.allowImap);
  await expect(form(page).getByTestId('info-tip')).toHaveCount(0);
  await form(page).getByTestId('create-password').click();
  expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
    target: { kind: 'passwordPage', provider: 'gmx' },
  });
  // An empty password is said in the provider's word.
  await page.getByTestId('mailbox-password').fill('');
  await save(page).click();
  await expect(form(page)).toContainText(T.settings.passwordMissing(false));
  // A refused sign-in at GMX says to allow IMAP.
  await page.getByTestId('mailbox-user').fill('jobs@gmx.de');
  await page.getByTestId('mailbox-password').fill('falschfalschfals');
  await save(page).click();
  await expect(page.getByTestId('mailbox-error')).toContainText('IMAP-Abruf');
  // Any password works there; the mailbox remembers its provider.
  await page.getByTestId('mailbox-password').fill('geheim');
  await save(page).click();
  await expect(form(page)).toHaveCount(0);
  expect((await calls(page, 'save_mailbox')).at(-1)?.[1]).toMatchObject({
    provider: 'gmx',
    user: 'jobs@gmx.de',
  });
  // Its removal speaks of the password, not an app password.
  await page.getByTestId('mailbox-remove').click();
  await expect(page.getByTestId('dialog-remove-mailbox')).toContainText(
    T.settings.removeMailboxText(false),
  );
});
