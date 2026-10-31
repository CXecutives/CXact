// "Verbinden" in the mailbox form of Einstellungen while it signs in and counts: it keeps its
// width, it can be stopped, and a sign-in whose count did not finish is still a connected
// mailbox. The providers: their texts and their pages.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
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

test('CRED-1: cancel and Esc stop a check in progress, quietly', async ({ page, browserName }) => {
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
  // The focus goes back to the row's button where a click focused Abbrechen (Windows; on macOS,
  // WebKit, a click focuses no button, as the OS does).
  if (browserName === 'chromium') await expect(page.getByTestId('mailbox-change')).toBeFocused();
  // The stop says nothing, and nothing was saved.
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(page.getByTestId('settings-mailbox')).not.toContainText(
    T.error.text('mailCancelled', {}),
  );
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
  await expectMailboxState(page, T.settings.connected);
  // Einstellungen shows no count: the state says it all, no toast repeats it.
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // With the count there, the same.
  await changeMailbox(page);
  await save(page).click();
  await expect(form(page)).toHaveCount(0);
  await expectMailboxState(page, T.settings.connected);
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
  await expect(form(page)).toContainText(T.error.text('invalid', { reason: 'appPassword' }));
  // In the right shape it waits for the fetch, which the form says; the form stays.
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await save(page).click();
  await expect(form(page)).toContainText(T.error.text('busy', { activity: 'fetch' }));
  await expect(form(page)).toBeVisible();
  expect(await calls(page, 'save_mailbox')).toHaveLength(2);
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('a provider of its own: GMX takes the password, its page says how to allow IMAP', async ({
  page,
}) => {
  await changeMailbox(page);
  const names = T.settings.provider;
  const provider = page.getByTestId('mailbox-provider');
  await expect(provider).toHaveText(names.gmail);
  await provider.click();
  const list = page.getByRole('listbox', { name: T.settings.providerLabel });
  await expect(list.getByRole('option')).toHaveText([
    names.gmail,
    names.icloud,
    names.gmx,
    names.webde,
  ]);
  // The chosen option carries the tick, and only it.
  await expect(list.locator('.tick')).toHaveCount(1);
  const chosen = list.getByRole('option', { selected: true });
  await expect(chosen).toHaveText(names.gmail);
  await expect(chosen.locator('.tick')).toHaveCount(1);
  // Esc closes the list and leaves the form open.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(form(page)).toBeVisible();
  // Gmail: the app password with its info symbol and Google's page.
  await expect(form(page)).toContainText(T.settings.password);
  await form(page).getByTestId('info-tip').hover();
  await expect(page.getByRole('tooltip')).toHaveText(T.settings.passwordInfo.gmail);
  await expect(form(page).getByTestId('create-password')).toHaveText(T.settings.createPassword);
  await form(page).getByTestId('create-password').click();
  expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
    target: { kind: 'passwordPage', provider: 'gmail' },
  });
  // iCloud: an app password too, in Apple's words.
  await choose(page, names.icloud);
  await expect(provider).toHaveText(names.icloud);
  await form(page).getByTestId('info-tip').hover();
  await expect(page.getByRole('tooltip')).toHaveText(T.settings.passwordInfo.icloud);
  await expect(page.getByTestId('mailbox-user')).toHaveAttribute(
    'placeholder',
    T.settings.addressExample('icloud'),
  );
  await choose(page, names.gmx);
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
  await expect(page.getByTestId('mailbox-error')).toHaveText(
    T.error.text('mailAuth', { allowImap: true }),
  );
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

/* ============================================================ what the audit found */

test('an open form answers Esc and Enter with no field focused', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  // The button went with the opening: the focus rests on the form's box, not in a field.
  await expect(form(page)).toBeVisible();
  const box = page.getByTestId('mailbox-form').locator('xpath=..');
  await expect(box).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('DIV');
  // Enter connects (no password: it says so), Esc folds the form away.
  await page.keyboard.press('Enter');
  await expect(form(page)).toContainText(T.settings.passwordMissing(true));
  await page.keyboard.press('Escape');
  await expect(form(page)).toHaveCount(0);
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
});

test('the errors of the form go with what they spoke of', async ({ page }) => {
  await changeMailbox(page);
  const password = page.getByTestId('mailbox-password');
  const user = page.getByTestId('mailbox-user');
  const refuse = async (): Promise<void> => {
    await password.fill('falschfalschfals');
    await save(page).click();
    await expect(page.getByTestId('mailbox-error')).toHaveText(T.error.text('mailAuth', {}));
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(user).toHaveAttribute('aria-invalid', 'true');
    // The password comes into view, but no field takes the caret by itself.
    await expect(password).toBeInViewport();
    await expect(password).not.toBeFocused();
    await expect(user).not.toBeFocused();
  };
  // Retyping the password takes the refusal away, both edges and the sentence.
  await refuse();
  await password.pressSequentially('x');
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  await expect(user).not.toHaveAttribute('aria-invalid', 'true');
  // So does retyping the address.
  await refuse();
  await user.pressSequentially('x');
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  // And another provider: nothing was said of it.
  await user.fill('alerts.demo@gmail.com');
  await refuse();
  await choose(page, T.settings.provider.icloud);
  await expect(page.getByTestId('mailbox-error')).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  await expect(user).not.toHaveAttribute('aria-invalid', 'true');
  // A mistyped address is said at its own field, only that field is marked, and retyping it
  // takes the sentence away.
  await user.fill('kein-postfach');
  await save(page).click();
  const mistyped = T.error.text('invalid', { reason: 'mailAddress' });
  await expect(user).toHaveAccessibleDescription(mistyped);
  await expect(user).toHaveAttribute('aria-invalid', 'true');
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  await user.pressSequentially('x');
  await expect(form(page)).not.toContainText(mistyped);
  await expect(user).not.toHaveAttribute('aria-invalid', 'true');
});

test('a double click on the provider page opens it once', async ({ page }) => {
  await changeMailbox(page);
  await form(page).getByTestId('create-password').dblclick();
  expect(await calls(page, 'open_target')).toHaveLength(1);
});

test('removing the mailbox from the keyboard leaves the focus on Verbinden', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  await page.keyboard.press('Tab');
  await (await reveal(page, page.getByTestId('mailbox-remove'))).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('dialog-remove-mailbox');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('dialog-confirm').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mailbox-connect')).toBeFocused();
});
