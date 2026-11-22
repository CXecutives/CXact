// "Verbinden" in the mailbox form of Einstellungen while it signs in and counts: it keeps its
// width, it can be stopped, and a sign-in whose count did not finish is still a connected
// mailbox. What the form says stands at its field, its buttons stay in the window. The providers:
// their texts and their pages.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, open, runFinished, test } from './fixtures';
import { expectMailboxState, reveal, T } from './helpers';
import { MIN_WINDOW } from './scale';

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
/** What the form says, at the field it belongs to. */
const said = (page: Page) => form(page).getByRole('alert');

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
  await expect(said(page)).toHaveCount(0);
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
  await expect(said(page)).toHaveText(T.error.text('mailAuth', { allowImap: true }));
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
    await expect(said(page)).toHaveText(T.error.text('mailAuth', {}));
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
  await expect(said(page)).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  await expect(user).not.toHaveAttribute('aria-invalid', 'true');
  // So does retyping the address.
  await refuse();
  await user.pressSequentially('x');
  await expect(said(page)).toHaveCount(0);
  await expect(password).not.toHaveAttribute('aria-invalid', 'true');
  // And another provider: nothing was said of it.
  await user.fill('alerts.demo@gmail.com');
  await refuse();
  await choose(page, T.settings.provider.icloud);
  await expect(said(page)).toHaveCount(0);
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

/** Where a field's message stands against its control: how far under it, how far in. */
function messageOf(control: Locator): Promise<{ under: number; inset: number }> {
  return control.evaluate((node) => {
    const message = node.closest('.cell')!.querySelector('[role="alert"]')!.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
      under: Math.round(message.top - box.bottom),
      inset: Math.round(message.left - box.left),
    };
  });
}

test('every message of the form stands right under its field, its way on under the message', async ({
  page,
}) => {
  await changeMailbox(page);
  const user = page.getByTestId('mailbox-user');
  const password = page.getByTestId('mailbox-password');
  await user.fill('');
  await password.fill('');
  await save(page).click();
  await expect(said(page)).toHaveCount(2);
  await animationsDone(page);
  expect(await messageOf(password)).toEqual(await messageOf(user));
  const [message, link] = await Promise.all([
    said(page).last().boundingBox(),
    form(page).getByTestId('create-password').boundingBox(),
  ]);
  expect(link!.y).toBeGreaterThanOrEqual(message!.y + message!.height - 1);
});

test('a refused pair is said under the password, in Einstellungen and the setup alike', async ({
  page,
}) => {
  const check = async (): Promise<void> => {
    const user = page.getByTestId('mailbox-user');
    const password = page.getByTestId('mailbox-password');
    await user.fill('');
    await password.fill('');
    await page.keyboard.press('Enter');
    await expect(said(page)).toHaveCount(2);
    await animationsDone(page);
    const place = await messageOf(user);
    await user.fill('alerts.demo@gmail.com');
    await password.fill('falschfalschfals');
    await page.keyboard.press('Enter');
    await expect(said(page)).toHaveText(T.error.text('mailAuth', {}));
    await animationsDone(page);
    expect(await messageOf(password)).toEqual(place);
    // It describes the field it stands under, and has no row of its own.
    await expect(password).toHaveAccessibleDescription(T.error.text('mailAuth', {}));
    await expect(form(page).locator('.cell')).toHaveCount(3);
  };
  await changeMailbox(page);
  await check();
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('mailbox-user').click();
  await check();
});

test('a link of a field underlines like every other link: under its words, not through them', async ({
  page,
}) => {
  await changeMailbox(page);
  const link = form(page).getByTestId('create-password');
  await link.hover();
  await animationsDone(page);
  const look = await link.evaluate((node) => {
    const label = node.querySelector('.label');
    return {
      through: getComputedStyle(node).textDecorationLine,
      under: label === null ? null : getComputedStyle(label, '::after').opacity,
    };
  });
  expect(look).toEqual({ through: 'none', under: '1' });
  // In the size of the label's row: its words 13, its glyph 14, a hit of 24 around its line.
  const size = await link.evaluate((node) => ({
    words: getComputedStyle(node.querySelector('.label')!).fontSize,
    glyph: Math.round(node.querySelector('svg')!.getBoundingClientRect().width),
    hit: Math.round(node.getBoundingClientRect().height),
  }));
  expect(size).toEqual({ words: '13px', glyph: 14, hit: 24 });
});

/** The form opened for a new mailbox, its first glide over. */
async function connectForm(page: Page): Promise<void> {
  await open(page, `${WIN}&scenario=no-mailbox&view=settings`);
  await (await reveal(page, page.getByTestId('mailbox-connect'))).click();
  await expect(form(page)).toBeVisible();
  await animationsDone(page);
}

/** Verbinden stands wholly in the window. */
const footInWindow = (page: Page) =>
  save(page).evaluate((node) => {
    const { top, bottom } = node.getBoundingClientRect();
    return top >= 0 && bottom <= innerHeight;
  });

test('a message that grows the form keeps its buttons in the window', async ({ page }) => {
  await connectForm(page);
  await expect.poll(() => footInWindow(page)).toBe(true);
  // Empty fields: both are said, and the button just pressed stays under the hand.
  await save(page).click();
  await expect(said(page)).toHaveCount(2);
  await expect.poll(() => footInWindow(page)).toBe(true);
  // A refused pair: the same.
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('falschfalschfals');
  await save(page).click();
  await expect(said(page)).toHaveText(T.error.text('mailAuth', {}));
  await expect.poll(() => footInWindow(page)).toBe(true);
});

test('in the smallest window too the buttons just pressed stay in the window', async ({ page }) => {
  await page.setViewportSize(MIN_WINDOW);
  await connectForm(page);
  // The form is higher than the window here: Verbinden lies at its end.
  await (await reveal(page, save(page))).click();
  await expect(said(page)).toHaveCount(2);
  await expect.poll(() => footInWindow(page)).toBe(true);
});

test('leaving Einstellungen stops a check under way, as Abbrechen does, and says nothing', async ({
  page,
}) => {
  await connectForm(page);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  await page.getByTestId('nav-jobs').click();
  await expect.poll(async () => (await calls(page, 'cancel_run')).length).toBe(1);
  // Nothing holds the app any more: a search starts.
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-line')).toBeVisible();
  await expect(
    page.getByTestId('toast').filter({ hasText: T.error.text('busy', { activity: 'mailbox' }) }),
  ).toHaveCount(0);
  await runFinished(page);
  // Back there nothing was connected, and nothing changes by itself later.
  await page.getByTestId('nav-settings').click();
  await page.evaluate(() => (window.__harness.holdMailbox = false));
  await page.waitForTimeout(150);
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
});

test('a change while Verbinden checks stops it: the form keeps what stands and its caret, the row stays', async ({
  page,
}) => {
  await connectForm(page);
  const user = page.getByTestId('mailbox-user');
  const password = page.getByTestId('mailbox-password');
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await user.fill('tippfehler@gmail.com');
  await password.fill('abcd efgh ijkl mnop');
  await save(page).click();
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  // Noticed while it spins: the correction stops it, nothing dims and nothing is said.
  await user.click();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(user).toHaveValue('tippfehler@gmail.comx');
  await expect(user).toBeFocused();
  await expect(password).toHaveValue('abcd efgh ijkl mnop');
  await expect(said(page)).toHaveCount(0);
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  // The other provider too: the check was of the pair at the first one.
  await save(page).click();
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  await choose(page, T.settings.provider.icloud);
  await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
  expect(await calls(page, 'cancel_run')).toHaveLength(2);
  await page.evaluate(() => (window.__harness.holdMailbox = false));
  // Verbinden then sends what stands.
  await user.fill('richtig@icloud.com');
  await save(page).click();
  await expect(form(page)).toHaveCount(0);
  const sent = (await calls(page, 'save_mailbox')).at(-1)![1];
  expect(sent).toMatchObject({ provider: 'icloud', user: 'richtig@icloud.com' });
  await expect(page.getByTestId('mailbox')).toContainText('richtig@icloud.com');
});

test('a change that stops the check moves nothing: the caret keeps its place in a low window', async ({
  page,
}) => {
  await page.setViewportSize(MIN_WINDOW);
  await connectForm(page);
  const user = page.getByTestId('mailbox-user');
  const view = page.getByTestId('view-settings');
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await user.fill('alerts.demo@gmail.com');
  // Begun from the field, low in the view, with the buttons below the window's edge.
  await user.evaluate((node) => {
    const pane = node.closest<HTMLElement>('[data-testid="view-settings"]')!;
    const gap = pane.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
    pane.scrollTop -= gap - 12;
  });
  await page.keyboard.press('Enter');
  await expect(save(page)).toHaveAttribute('aria-busy', 'true');
  expect(await footInWindow(page)).toBe(false);
  const top = await view.evaluate((node) => node.scrollTop);
  await page.keyboard.type('x');
  await expect(save(page)).not.toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(300);
  expect(await view.evaluate((node) => node.scrollTop)).toBe(top);
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
