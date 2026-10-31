// Einstellungen against the stub: one page, three groups in their order (Jobportale, Postfach,
// Daten), the portals with how they bring their jobs and what they brought, the mailbox and
// its form, the profile's folder and the reset. The look of the page's rows is not pinned here
// beyond their one height; the measures of the mailbox form's rows are.

import type { Locator, Page } from '@playwright/test';
import type { SettingsPatch } from '../../../ui/src/lib/ipc/types';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  nav,
  NOW,
  open,
  runFinished,
  settle,
  test,
  text,
  visibleCount,
} from './fixtures';
import {
  ALERT_PORTALS,
  expectMailboxState,
  failNext,
  PORTALS,
  SEARCHED,
  reveal,
  T,
} from './helpers';

const WIN = '?platform=windows';
/** What a failed command of the stub says (`failNext`). */
const DB_ERROR = T.error.text('db', {});

/* ------------------------------------------------------------------ helpers */

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await nav(page, 'nav-settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  await settle(page);
}

/** The target of the last open_target. */
async function lastOpened(page: Page): Promise<unknown> {
  return (await calls(page, 'open_target')).at(-1)?.[1];
}

/** The patches of every save_settings so far. */
async function saved(page: Page): Promise<SettingsPatch[]> {
  return (await calls(page, 'save_settings')).map(
    ([, args]) => (args as { patch: SettingsPatch }).patch,
  );
}

/** The tooltip of a locked button. */
async function reason(page: Page, testid: string): Promise<string | null> {
  const button = await reveal(page, page.getByTestId(testid));
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.hover();
  return page.getByRole('tooltip').textContent();
}

/** The widths of the buttons of these test ids. */
async function widths(page: Page, ...testids: string[]): Promise<number[]> {
  return Promise.all(testids.map(async (id) => (await page.getByTestId(id).boundingBox())!.width));
}

/** The test ids of the children of a container that carry one, in order. */
function ids(page: Page, testid: string, selector: string): Promise<(string | null)[]> {
  return page
    .getByTestId(testid)
    .locator(selector)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
}

/** The ids of the page's references of a name or a description that name no text. */
function dangling(page: Page): Promise<string[]> {
  return page
    .getByTestId('view-settings')
    .evaluate((root) =>
      [...root.querySelectorAll('[aria-describedby], [aria-labelledby]')].flatMap((node) =>
        ['aria-describedby', 'aria-labelledby'].flatMap((name) =>
          (node.getAttribute(name) ?? '')
            .split(/\s+/)
            .filter((id) => id !== '' && document.getElementById(id) === null),
        ),
      ),
    );
}

/** The open form's box: it holds the focus while no field has it. */
const formBox = (page: Page): Locator => page.getByTestId('mailbox-form').locator('xpath=..');

/** A row of the mailbox form by its control's test id: the row, its label, its control and its
 *  provider's page, each in whole pixels from the form's corner (so it does not matter that the
 *  page may still glide), and where its hairline starts. */
function formRow(page: Page, control: string) {
  return page.getByTestId(control).evaluate((node) => {
    const row = node.closest('.cell')!;
    const form = node.closest('[data-testid="mailbox-form"]')!.getBoundingClientRect();
    const box = (part: Element) => {
      const { left, right, top, bottom } = part.getBoundingClientRect();
      return {
        left: Math.round(left - form.left),
        right: Math.round(right - form.left),
        top: Math.round(top - form.top),
        bottom: Math.round(bottom - form.top),
      };
    };
    const link = row.querySelector('[data-testid="create-password"]');
    return {
      row: box(row),
      label: box(document.querySelector(`label[for="${node.id}"]`)!),
      control: box(node),
      link: link === null ? null : box(link),
      hairline: parseFloat(getComputedStyle(row, '::before').left),
    };
  });
}

/** The form's three rows. */
async function formRows(page: Page) {
  return {
    provider: await formRow(page, 'mailbox-provider'),
    address: await formRow(page, 'mailbox-user'),
    password: await formRow(page, 'mailbox-password'),
  };
}

/* ---------------------------------------------------------------- the page */

test('one page: Jobportale, Postfach and Daten, the reset last in Daten', async ({ page }) => {
  await settings(page);
  const view = page.getByTestId('settings');
  await expect(view.getByRole('tab')).toHaveCount(0);
  await expect(view.locator('section h2')).toHaveText([
    T.settings.portals,
    T.settings.mailbox,
    T.settings.data,
  ]);
  expect(await ids(page, 'settings', 'section[data-section]')).toEqual([
    'settings-portals',
    'settings-mailbox',
    'settings-data',
  ]);
  // Every portal in one list: the ones the app searches, then the ones of alert mails.
  expect(await ids(page, 'settings-portals', '[data-setting-row]')).toEqual(
    [...SEARCHED, ...ALERT_PORTALS].map((portal) => `portal-${portal}`),
  );
  expect(await ids(page, 'settings-mailbox', '[data-setting-row]')).toEqual(['mailbox']);
  expect(await ids(page, 'settings-data', '[data-setting-row]')).toEqual(['folder', 'reset-all']);
  // No info symbol at the headings (user 2026-10-04); no version, no search terms; no
  // primary.
  await expect(view.locator('[data-testid^="info-"]')).toHaveCount(0);
  await expect(view).not.toContainText('Version');
  await expect(page.getByTestId('search-terms')).toHaveCount(0);
  expect(await visibleCount(page, '.btn.primary')).toBe(0);
  await expect(page.getByTestId('settings-heading')).toHaveText(T.nav.settings);
  // No button carries an ellipsis.
  const words = await view.getByRole('button').allInnerTexts();
  expect(words.length).toBeGreaterThan(0);
  expect(words.filter((word) => /…|\.\.\./.test(word))).toEqual([]);
});
// Narrow, a row's buttons stand beside its label or under it, never over it.
test('narrow, a row keeps its buttons clear of its label', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await settings(page);
  const clear = async (id: string): Promise<void> => {
    const row = await reveal(page, page.getByTestId(id));
    const [text, control] = await Promise.all([
      row.locator('.text').boundingBox(),
      row.locator('.actions').boundingBox(),
    ]);
    const under = control!.y >= text!.y + text!.height;
    const beside = control!.x >= text!.x + text!.width;
    expect(under || beside, id).toBe(true);
  };
  await clear('reset-all');
  // At the smallest window the label keeps its room too.
  await page.setViewportSize({ width: 480, height: 800 });
  await clear('reset-all');
  await clear('folder');
});

test('narrow, the calls stay clear of the portal state', async ({ page }) => {
  await settings(page);
  await page.setViewportSize({ width: 480, height: 800 });
  await reveal(page, page.getByTestId('sign-in-freelance'));
  const [signIn, status] = await Promise.all([
    page.getByTestId('sign-in-freelance').boundingBox(),
    page.getByTestId('portal-freelance-hint').boundingBox(),
  ]);
  expect(signIn!.y).toBeGreaterThanOrEqual(status!.y + status!.height);
});
/* ---------------------------------------------------------------- Postfach */

test('mailbox: the address, no word about the vault, no whole-mailbox row', async ({ page }) => {
  await settings(page);
  const mailbox = await reveal(page, page.getByTestId('settings-mailbox'));
  // The address and under it its state (no badge).
  await expect(page.getByTestId('mailbox').locator('[data-copy]')).toHaveText(
    'alerts.demo@gmail.com',
  );
  await expectMailboxState(page, T.settings.connected);
  await expect(mailbox.locator('.badge')).toHaveCount(0);
  await expect(mailbox).not.toContainText('Anmeldeinformationsverwaltung');
  await expect(mailbox).not.toContainText('Alle Alert-Mails');
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
});

test('mailbox: Ändern unfolds the form under the row; Esc folds it, Verbinden saves', async ({
  page,
}) => {
  await settings(page);
  const change = await reveal(page, page.getByTestId('mailbox-change'));
  await expect(change).toHaveText(T.common.edit);
  await change.focus();
  await page.keyboard.press('Enter');
  // No dialog: the form unfolds in the box, comes into view whole and the row's buttons step
  // aside.
  const form = page.getByTestId('mailbox-form');
  await expect(form).toBeVisible();
  await expect(page.getByTestId('mailbox-buttons')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-change')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-remove')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-save')).toHaveText(T.settings.connect);
  // The address stays. No field takes the caret by itself: the focus rests on the form's box.
  // The password's info symbol beside its label, the provider's page and the example in the
  // field.
  await expect(formBox(page)).toBeFocused();
  await expect(page.getByTestId('mailbox-user')).toHaveValue('alerts.demo@gmail.com');
  await expect(form.getByTestId('info-tip')).toHaveAccessibleName(
    T.common.infoAbout(T.settings.password),
  );
  await expect(form.getByTestId('create-password')).toHaveText(T.settings.createPassword);
  const password = page.getByTestId('mailbox-password');
  await expect(password).toHaveAttribute('placeholder', T.settings.passwordExample);
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
  // Nothing was on its way, so nothing is stopped.
  expect(await calls(page, 'cancel_run')).toHaveLength(0);
  // Empty password: said at its field by a danger notice, it describes the field; the form
  // stays.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-save').click();
  await expect(form.locator('.notice.danger')).toHaveText(T.settings.passwordMissing(true));
  await expect(password).toHaveAccessibleDescription(T.settings.passwordMissing(true));
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  expect(await calls(page, 'save_mailbox')).toHaveLength(0);
  // Enter in the field connects; the form folds away once saved.
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(form).toHaveCount(0);
  expect(await calls(page, 'save_mailbox')).toHaveLength(1);
  await expect(page.getByTestId('mailbox-change')).toBeFocused();
});

test('mailbox form: rows like the Profil, the buttons in the order of the OS', async ({ page }) => {
  for (const [os, words] of [
    ['windows', [T.settings.connect, T.common.cancel]],
    ['macos', [T.common.cancel, T.settings.connect]],
  ] as const) {
    await settings(page, `?platform=${os}`);
    await (await reveal(page, page.getByTestId('mailbox-change'))).click();
    const buttons = page.getByTestId('mailbox-buttons').getByRole('button');
    await expect(buttons).toHaveText([...words]);
    // A pair is one width, the wider label's, so a short word does not look thin.
    const [first, second] = await widths(page, 'mailbox-save', 'mailbox-cancel');
    expect(first).toBeGreaterThanOrEqual(88);
    expect(first).toBeCloseTo(second!, 0);
  }
  const form = page.getByTestId('mailbox-form');
  await expect(form.locator('label')).toHaveText([
    T.settings.providerLabel,
    T.settings.address,
    T.settings.password,
  ]);
  const { provider, address, password } = await formRows(page);
  const pageRow = Math.round((await page.getByTestId('mailbox').boundingBox())!.height);
  // One row each, none beside another, as high as the page's own rows.
  expect(address.row.top).toBeGreaterThanOrEqual(provider.row.bottom);
  expect(password.row.top).toBeGreaterThanOrEqual(address.row.bottom);
  expect(provider.row.bottom - provider.row.top).toBe(pageRow);
  expect(address.row.bottom - address.row.top).toBe(pageRow);
  for (const { row, label, control, hairline } of [provider, address, password]) {
    // The label beside its control, on the control's height; the control 16 under the hairline
    // (a field's input lies 1 inside its edge), the hairline from the text.
    expect(label.right).toBeLessThan(control.left);
    expect(
      Math.abs((label.top + label.bottom) / 2 - (control.top + control.bottom) / 2),
    ).toBeLessThan(2);
    expect(Math.abs(control.top - row.top - 16)).toBeLessThanOrEqual(1);
    expect(hairline).toBe(label.left);
  }
  // One left edge; the provider one short width, the address as wide as its row.
  expect(Math.abs(address.control.left - provider.control.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(password.control.left - provider.control.left)).toBeLessThanOrEqual(1);
  expect(provider.control.right).toBeLessThan(address.control.right);
  // The provider's page stands under the control, on its left edge.
  expect(password.link!.top).toBeGreaterThanOrEqual(password.control.bottom);
  expect(Math.abs(password.link!.left - password.control.left)).toBeLessThanOrEqual(1);
  // The example follows the provider.
  const user = page.getByTestId('mailbox-user');
  await expect(user).toHaveAttribute('placeholder', T.settings.addressExample('gmail'));
  // A message only grows its row downward: its control stays where it was in the row.
  await user.fill('');
  await page.getByTestId('mailbox-save').click();
  await expect(form.locator('.notice.danger')).toHaveText([
    T.settings.addressMissing,
    T.settings.passwordMissing(true),
  ]);
  const said = await formRows(page);
  expect(said.address.row.top).toBe(address.row.top);
  expect(said.address.row.bottom).toBeGreaterThan(address.row.bottom);
  expect(said.address.control.top).toBe(address.control.top);
  expect(said.password.control.top - said.password.row.top).toBe(
    password.control.top - password.row.top,
  );
  // In a box under 560 wide the label stands above its control; the provider keeps its short
  // width.
  await page.setViewportSize({ width: 480, height: 800 });
  const narrow = await formRows(page);
  expect(narrow.address.row.top).toBeGreaterThanOrEqual(narrow.provider.row.bottom);
  for (const { label, control } of [narrow.provider, narrow.address, narrow.password]) {
    expect(label.bottom).toBeLessThanOrEqual(control.top);
    expect(Math.abs(label.left - control.left)).toBeLessThanOrEqual(1);
  }
  expect(narrow.provider.control.right).toBeLessThan(narrow.address.control.right);
  expect(narrow.password.link!.top).toBeGreaterThanOrEqual(narrow.password.control.bottom);
});

test('mailbox form: a field refers to its message only while one shows', async ({ page }) => {
  await settings(page);
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  const password = page.getByTestId('mailbox-password');
  // With a message the field is described by it.
  await page.getByTestId('mailbox-save').click();
  await expect(password).toHaveAccessibleDescription(T.settings.passwordMissing(true));
  // Without one it refers to no text that is not there (Field.svelte).
  await password.pressSequentially('x');
  await expect(password).toHaveAccessibleDescription('');
  expect(await dangling(page)).toEqual([]);
});

test('mailbox: a saved change is answered by its state; a mail error before it is past', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=offline`);
  const mailbox = await reveal(page, page.getByTestId('settings-mailbox'));
  // The last fetch could not reach the mailbox: said once, in red.
  await expectMailboxState(page, T.settings.unreachable);
  await expect(page.getByTestId('mailbox-hint').locator('.status')).toHaveClass(/danger/);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
  // A new sign-in: the mailbox accepted it, the state says so, no note and no toast.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-save').click();
  await expectMailboxState(page, T.settings.connected);
  await expect(page.getByTestId('mailbox-hint').locator('.status')).toHaveClass(/success/);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: no network is no fault of the mailbox: the toast does not lead there', async ({
  page,
}) => {
  await open(page, `${WIN}&mail=no-internet&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  const warning = page.getByTestId('toast').filter({ hasText: T.error.text('offline', {}) });
  await expect(warning).toHaveCount(1);
  await expect(warning.getByTestId('toast-action')).toHaveCount(0);
  // The Postfach has nothing to say about it either: it stays connected.
  await nav(page, 'nav-settings');
  await expectMailboxState(page, T.settings.connected);
});

test('mailbox: what a toast sends here, the row says: a keychain out of reach', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=mailbox-keychain`);
  await reveal(page, page.getByTestId('settings-mailbox'));
  await expectMailboxState(page, T.settings.unreachable);
  await expect(page.getByTestId('mailbox-hint').locator('.status')).toHaveClass(/danger/);
});

test('mailbox: the app password was refused while the search went on; said once', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=mailbox-refused`);
  const mailbox = await reveal(page, page.getByTestId('settings-mailbox'));
  await expectMailboxState(page, T.settings.refused(true));
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: removing asks first, a failure stays; then "Kein Postfach verbunden" connects', async ({
  page,
}) => {
  await settings(page);
  await reveal(page, page.getByTestId('mailbox-remove'));
  // Entfernen is a plain button that opens a dialog, which carries the danger; Ändern beside it
  // is as wide.
  await expect(page.getByTestId('mailbox-remove')).toHaveClass(/secondary/);
  await expect(page.getByTestId('mailbox-remove')).toHaveText(T.common.remove);
  const [change, remove] = await widths(page, 'mailbox-change', 'mailbox-remove');
  expect(change).toBeCloseTo(remove!, 0);
  await page.getByTestId('mailbox-remove').click();
  const dialog = page.getByTestId('dialog-remove-mailbox');
  await expect(dialog).toContainText(T.settings.removeMailboxText(true));
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.common.remove);
  // The dialog's pair is one width too.
  const [confirm, cancel] = await widths(page, 'dialog-confirm', 'dialog-cancel');
  expect(confirm).toBeCloseTo(cancel!, 0);
  await failNext(page, 'remove_mailbox');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText(DB_ERROR);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'remove_mailbox')).toHaveLength(2);
  // Without a mailbox its row says so and connects in the same form.
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnectedHint);
  await page.getByTestId('mailbox-connect').click();
  // A new form and no field takes the caret by itself: only a press on the field puts it there.
  const user = page.getByTestId('mailbox-user');
  await expect(formBox(page)).toBeFocused();
  await expect(user).toHaveValue('');
  await user.click();
  await expect(user).toBeFocused();
  await user.fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-save').click();
  await expectMailboxState(page, T.settings.connected);
});

test('Postfach: the mailbox alone; its portals stand last in Jobportale', async ({ page }) => {
  await settings(page);
  expect(await ids(page, 'settings-mailbox', '[data-setting-row]')).toEqual(['mailbox']);
  const portals = await ids(page, 'settings-portals', '[data-setting-row]');
  expect(portals.slice(-ALERT_PORTALS.length)).toEqual(
    ALERT_PORTALS.map((portal) => `portal-${portal}`),
  );
});
/* ------------------------------------------------------------ Suche, Postfach */

test('portals: two groups in the order of the UI, each portal with its state and its calls', async ({
  page,
}) => {
  await settings(page);
  expect(await ids(page, 'settings-portals', '[data-setting-row]')).toEqual(
    [...SEARCHED, ...ALERT_PORTALS].map((portal) => `portal-${portal}`),
  );
  await expect(page.getByTestId('portals-search')).toHaveText(T.settings.way.search);
  await expect(page.getByTestId('portals-alert')).toHaveText(T.settings.way.alert);
  // Every portal has its brand name (LinkedIn, not linkedin.com).
  for (const portal of PORTALS) expect(T.portal[portal], portal).toMatch(/\S/);
  expect(T.portal.linkedin).toBe('LinkedIn');
  // The last search asked all eight: each says what it brought.
  for (const [portal, state] of [
    ['freelancermap', T.settings.lastNew(3)],
    ['hays', T.settings.lastNew(0)],
    ['michaelpage', T.settings.lastNew(0)],
    ['solcom', T.settings.lastNew(0)],
    ['gulp', T.settings.lastNew(0)],
    ['amadeusfire', T.settings.lastNew(0)],
    ['interimx', T.settings.lastNew(0)],
    ['fratch', T.settings.lastNew(0)],
    ['linkedin', T.settings.alertMails(24)],
    ['freelance', T.settings.alertMails(11)],
  ] as const) {
    // Its state in one quiet line; no meter, no calls counted.
    const row = await reveal(page, page.getByTestId(`portal-${portal}`));
    await expect(row.locator('.badge')).toHaveCount(0);
    await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveText(state);
    await expect(row.getByRole('progressbar')).toHaveCount(0);
    await expect(row).not.toContainText('Aufrufen');
    // No tile and no glyph that only repeats the name: the name, its line, its calls, the
    // switch.
    await expect(row.locator('.tile')).toHaveCount(0);
    if (!ALERT_PORTALS.includes(portal)) await expect(row.getByRole('button')).toHaveCount(0);
    await expect(row.getByRole('switch')).toHaveAccessibleName(T.portal[portal]);
  }
  // Only freelance.de offers a sign-in; no "Details holen".
  await expect(page.locator('[data-testid^="note-"]')).toHaveCount(0);
  await expect(page.getByTestId('view-settings').locator('[data-testid^="sign-in-"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId('settings-portals')).not.toContainText('Details');
  await expect(page.getByTestId('settings-portals')).not.toContainText('Seiten');
  // Only a portal of alert mails offers "Alert anlegen", its page in the browser.
  const setUp = page.locator('[data-testid^="setup-"]');
  await expect(setUp).toHaveCount(2);
  for (const button of await setUp.all()) {
    await expect(button).toHaveAccessibleName(T.settings.setUpAlert);
  }
  await (await reveal(page, page.getByTestId('setup-freelance'))).click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalSetup', portal: 'freelance' } });
});

test('portals: before the first search the line says so; a portal the search did not ask has none', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=fresh`);
  for (const portal of SEARCHED) {
    await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveText(T.settings.noSearchYet);
  }
  // No alert mail counted yet: nothing to say, and its switch refers to no line. Its row keeps
  // the height of a row with a line.
  for (const portal of ALERT_PORTALS) {
    await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveCount(0);
  }
  expect(await dangling(page)).toEqual([]);
  const heights = await page
    .locator('[data-setting-row]')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  expect(new Set(heights).size).toBe(1);
  // Off, a portal is not asked: the next search has no line of it, and its row says nothing.
  await (await reveal(page, page.getByTestId('toggle-enabled-hays'))).click();
  await nav(page, 'nav-jobs');
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await nav(page, 'nav-settings');
  await expect(page.getByTestId('portal-gulp-hint')).toHaveText(T.settings.lastNew(0));
  await expect(page.getByTestId('portal-linkedin-hint')).toHaveText(T.settings.alertMails(24));
  await expect(page.getByTestId('portal-hays-hint')).toHaveCount(0);
});

test('portals: before the first fetch a portal of alert mails says what Verbinden counted', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=fresh`);
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  await expect(page.getByTestId('portal-linkedin-hint')).toHaveText(T.settings.alertMails(20));
  await expect(page.getByTestId('portal-freelance-hint')).toHaveText(T.settings.alertMails(0));
});

test('portals: the switches save at once; only the switch switches', async ({ page }) => {
  await settings(page);
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-linkedin'));
  await page.getByTestId('portal-linkedin').getByText(T.portal.linkedin).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // Off, the row keeps its state; no toast answers a switch.
  await expect(page.getByTestId('portal-linkedin-hint')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await saved(page)).toEqual([
    { portals: [{ portal: 'linkedin', enabled: false, loginEnabled: null }] },
  ]);
  // Off, it offers no alert to set up.
  await expect(page.getByTestId('setup-linkedin')).toHaveCount(0);
  // No label element anywhere on the page: no text is a click target of a switch.
  await expect(page.getByTestId('settings').locator('label')).toHaveCount(0);
  // Every reference of a name or a description names a text that is there.
  expect(await dangling(page)).toEqual([]);
  // A save that fails puts the switch back and says why in the row, under its word in red.
  await reveal(page, page.getByTestId('toggle-enabled-freelancermap'));
  await failNext(page, 'save_settings');
  await page.getByTestId('toggle-enabled-freelancermap').click();
  await expect(page.getByTestId('portal-freelancermap').getByTestId('portal-error')).toHaveText(
    DB_ERROR,
  );
  const failed = page.getByTestId('portal-freelancermap-hint');
  await expect(failed).toHaveText(T.settings.problem.failed);
  await expect(failed.locator('.status')).toHaveClass(/danger/);
  await expect(page.getByTestId('toggle-enabled-freelancermap')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('portals: freelance.de signs in and out', async ({ page }) => {
  await settings(page);
  await (await reveal(page, page.getByTestId('sign-in-freelance'))).click();
  await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  await page.getByTestId('sign-out-freelance').click();
  await expect(page.getByTestId('sign-in-freelance')).toBeVisible();
  const logins = (await saved(page)).map((each) => each.portals[0]?.loginEnabled);
  expect(logins).toEqual([true, false]);
  expect(await calls(page, 'portal_login')).toHaveLength(1);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a stored sign-in the fetch does not use looks like none until it is used', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=session-left`);
  // With the portal off the stored sign-in shows, so it can be removed.
  await expect(await reveal(page, page.getByTestId('sign-out-freelance'))).toBeVisible();
  // Switched on it looks like none, and Anmelden only lets the fetch use it: no sign-in
  // window.
  await page.getByTestId('toggle-enabled-freelance').click();
  await page.getByTestId('sign-in-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  expect(await calls(page, 'portal_login')).toHaveLength(0);
  expect((await saved(page)).at(-1)?.portals[0]?.loginEnabled).toBe(true);
  // Off, Abmelden removes it.
  await settings(page, `${WIN}&scenario=session-left`);
  await (await reveal(page, page.getByTestId('sign-out-freelance'))).click();
  await expect(page.getByTestId('sign-out-freelance')).toHaveCount(0);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a pause says until when in the state line, an empty alert mail in one word with its count', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=paused`);
  const status = await reveal(page, page.getByTestId('portal-linkedin-hint'));
  // The stub's pause of linkedin ends 95 minutes after its fixed "now".
  const until = new Date(NOW.getTime() + 95 * 60_000).toISOString();
  await expect(status).toHaveText(await text(page, 'settings.pausedUntil', until));
  // A status word: the warning's dot and colour.
  await expect(status.locator('.status')).toHaveClass(/warning/);
  await expect(page.getByTestId('health-linkedin')).toHaveCount(0);
  // The word with its count says it all, in the row's one line; no second sentence.
  const empty = page.getByTestId('portal-freelance-hint');
  await expect(empty).toHaveText(T.settings.problem.emptyMails(2));
  await expect(empty.locator('.status')).toHaveClass(/warning/);
  await expect(page.getByTestId('health-freelance')).toHaveCount(0);
  // Its way out takes the place of "Alert anlegen", in its width.
  await expect(page.getByTestId('setup-freelance')).toHaveCount(0);
  const [way, setUp] = await widths(page, 'alert-mail-freelance', 'setup-linkedin');
  expect(way).toBeCloseTo(setUp!, 0);
  await page.getByTestId('alert-mail-freelance').click();
  expect(await lastOpened(page)).toEqual({
    target: { kind: 'alertMail', gmailId: '18c2f0a9d1e4b7a3' },
  });
  // A portal that is off says no problem of its own, only its quiet state.
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(empty).toHaveText(T.settings.alertMails(11));
  await expect(page.getByTestId('health-freelance')).toHaveCount(0);
});
test('portals: pages that changed say so once: the word, and in one line what comes next', async ({
  page,
}) => {
  await settings(page);
  const row = await reveal(page, page.getByTestId('portal-linkedin'));
  const plain = (await row.boundingBox())!.height;
  await page.evaluate(() =>
    window.__harness.emit({
      type: 'portalHealth',
      portal: 'linkedin',
      health: { kind: 'layoutSuspect', emptyMails: 0, pages: 3 },
      actionNeeded: false,
    }),
  );
  await expect(page.getByTestId('portal-linkedin-hint')).toHaveText(T.settings.problem.pages);
  const line = page.getByTestId('health-linkedin');
  await expect(line).toHaveText(T.health.advice.pages);
  await animationsDone(page);
  // The sentence beside the button keeps to one line: no second line that repeats the first.
  const lines = await line.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set([...range.getClientRects()].map((part) => Math.round(part.top))).size;
  });
  expect(lines).toBe(1);
  expect((await row.boundingBox())!.height - plain).toBe((await line.boundingBox())!.height);
});

test('portals: a week without an alert mail is the status word, with Alert prüfen', async ({
  page,
}) => {
  // The demo's portals all sent alert mails lately: no word.
  await settings(page);
  await expect(page.getByText(T.settings.problem.quiet(9))).toHaveCount(0);
  // freelance.de sent its last one nine days before the last fetch: the word says it, once.
  await settings(page, `${WIN}&scenario=quiet-alert`);
  const quiet = await reveal(page, page.getByTestId('portal-freelance-hint'));
  await expect(quiet).toHaveText(T.settings.problem.quiet(9));
  await expect(page.getByTestId('portal-freelance').locator('.line')).toHaveCount(0);
  await expect(page.getByTestId('check-alert-freelance')).toHaveAccessibleName(
    T.settings.checkAlert,
  );
  await page.getByTestId('check-alert-freelance').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'freelance' } });
  // A portal that is off says nothing about its alert mails.
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(quiet).not.toHaveText(T.settings.problem.quiet(9));
  // The Jobs view shows nothing of it.
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByText(T.settings.problem.quiet(9))).toHaveCount(0);
});

test('another provider than Gmail: the alert calls wait for the place of the mail', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=quiet-alert`);
  await expect(page.getByTestId('check-alert-freelance')).toHaveCount(1);
  const [before] = await widths(page, 'check-alert-freelance');
  const signIn = (await page.getByTestId('sign-in-freelance').boundingBox())!.x;
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  await page.getByTestId('mailbox-provider').click();
  await page
    .getByRole('listbox', { name: T.settings.providerLabel })
    .getByRole('option', { name: 'GMX' })
    .click();
  await page.getByTestId('mailbox-user').fill('jobs@gmx.de');
  await page.getByTestId('mailbox-password').fill('geheim');
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  // The word stays; its call waits, "Alert anlegen" keeps its place.
  await expect(page.getByTestId('portal-freelance-hint')).toHaveText(T.settings.problem.quiet(9));
  await expect(page.getByTestId('check-alert-freelance')).toHaveCount(0);
  await expect(page.getByTestId('setup-freelance')).toBeVisible();
  // The call keeps its width whatever its face, so Anmelden does not move.
  const [after] = await widths(page, 'setup-freelance');
  expect(after).toBeCloseTo(before!, 0);
  expect((await page.getByTestId('sign-in-freelance').boundingBox())!.x).toBeCloseTo(signIn, 0);
});

test('without a mailbox the portals of alert mails say they need one; one Verbinden', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=no-mailbox`);
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  for (const portal of ALERT_PORTALS) {
    // The row cannot work: no calls and no link, its line says it needs a mailbox; its switch
    // off and waiting with its reason, while the stored value stays on.
    const row = page.getByTestId(`portal-${portal}`);
    await expect(row.getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveText(T.settings.needsMailbox);
    expect(await reason(page, `toggle-enabled-${portal}`)).toBe(T.settings.needsMailboxReason);
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  }
  await page.getByTestId('toggle-enabled-linkedin').click({ force: true });
  expect(await saved(page)).toEqual([]);
  // The Postfach is the one way to connect: its Verbinden unfolds the form.
  const connect = page.getByTestId('view-settings').getByTestId('mailbox-connect');
  await expect(connect).toHaveCount(1);
  await (await reveal(page, connect)).click();
  await expect(page.getByTestId('mailbox-form')).toBeInViewport();
  await expect(page.getByTestId('mailbox-connect')).toHaveCount(0);
  // The stored value stayed: connected, the portals work again.
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  await expect(page.getByTestId('toggle-enabled-linkedin')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('portal-linkedin-hint')).toHaveText(T.settings.alertMails(24));
  await expect(page.getByTestId('setup-linkedin')).toBeVisible();
});

test('portals: a sign-in that ran out says so in red and offers Anmelden', async ({ page }) => {
  await settings(page, `${WIN}&scenario=sign-in-expired`);
  const status = await reveal(page, page.getByTestId('portal-freelance-hint'));
  await expect(status).toHaveText(T.settings.signInExpired);
  await expect(status.locator('.status')).toHaveClass(/danger/);
  // Said once: no problem line repeats it.
  await expect(page.getByTestId('health-freelance')).toHaveCount(0);
  await expect(page.getByTestId('sign-in-freelance')).toBeVisible();
});

test('portals: Anmelden and Abmelden keep one width', async ({ page }) => {
  await settings(page);
  const signIn = await reveal(page, page.getByTestId('sign-in-freelance'));
  const before = (await signIn.boundingBox())!.width;
  await signIn.click();
  const after = (await page.getByTestId('sign-out-freelance').boundingBox())!.width;
  expect(Math.abs(after - before)).toBeLessThan(1);
});
/* ------------------------------------------------------------------- Daten */

test('Daten: the Profil-Ordner with its path, Ändern and Öffnen; then Alles zurücksetzen', async ({
  page,
}) => {
  await settings(page, `${WIN}&folder=other`);
  const data = page.getByTestId('settings-data');
  expect(await ids(page, 'settings-data', '[data-setting-row]')).toEqual(['folder', 'reset-all']);
  const folder = page.getByTestId('folder');
  await expect(folder).toContainText(T.settings.folder);
  // The path as Windows writes it.
  await expect(folder.locator('[data-copy]')).toHaveText('C:\\Users\\demo\\Documents\\CXact');
  await expect(page.getByTestId('reset-all')).toContainText(T.settings.reset);
  await expect(page.getByTestId('reset-all')).toContainText(T.settings.resetHint);
  await expect(page.getByTestId('reset')).toHaveText(T.settings.resetAction);
  await expect(page.getByTestId('folder-change')).toHaveText(T.common.edit);
  for (const gone of ['backup-restore', 'logs-open']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await reveal(page, page.getByTestId('folder-open'));
  // Öffnen and Ändern are one width.
  const [opens, changes] = await widths(page, 'folder-open', 'folder-change');
  expect(opens).toBeCloseTo(changes!, 0);
  await page.getByTestId('folder-open').click();
  // Öffnen opens the folder shown.
  expect(await lastOpened(page)).toEqual({ target: { kind: 'workspace' } });
  // A folder that does not open says so at the end of its section.
  await failNext(page, 'open_target');
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('data-note')).toHaveText(DB_ERROR);
  // Ändern: the folder dialog; the profile comes along and the toast says so.
  await page.getByTestId('folder-change').click();
  await expect(page.getByTestId('toast-text')).toHaveText(T.settings.folderMoved);
  await expect(data.getByTestId('folder-hint')).toHaveText('C:\\Users\\demo\\Documents\\Jobs');
});

test('Daten: the note at the end of the box stands on the rows left edge, not on the box edge', async ({
  page,
}) => {
  await settings(page);
  await failNext(page, 'open_target');
  await (await reveal(page, page.getByTestId('folder-open'))).click();
  const note = page.getByTestId('data-note');
  await expect(note).toHaveText(DB_ERROR);
  const [sign, name] = await Promise.all([
    note.boundingBox(),
    page.getByTestId('folder').getByText(T.settings.folder).boundingBox(),
  ]);
  expect(sign!.x).toBeCloseTo(name!.x, 0);
});

test('Daten: another folder says what became of the profile; no folder chosen says nothing', async ({
  page,
}) => {
  for (const [query, words] of [
    ['folder=own', T.settings.folderOwnProfile],
    ['folder=other&scenario=no-profile', T.settings.folderFiles],
  ] as const) {
    await settings(page, `${WIN}&${query}`);
    await (await reveal(page, page.getByTestId('folder-change'))).click();
    await expect(page.getByTestId('toast-text')).toHaveText(words);
    await expect(page.getByTestId('folder-hint')).toHaveText('C:\\Users\\demo\\Documents\\Jobs');
  }
  // The folder dialog closed without a choice: the path stays, nothing is said.
  await settings(page);
  await (await reveal(page, page.getByTestId('folder-change'))).click();
  await expect.poll(async () => (await calls(page, 'pick_workspace')).length).toBe(1);
  await expect(page.getByTestId('folder-change')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(page.getByTestId('data-note')).toHaveCount(0);
  await expect(page.getByTestId('folder-hint')).toHaveText('C:\\Users\\demo\\Documents\\CXact');
});

test('reset: the danger dialog says what goes in one sentence; a failure stays in it', async ({
  page,
}) => {
  await settings(page);
  await (await reveal(page, page.getByTestId('reset'))).click();
  const dialog = page.getByTestId('dialog-reset');
  await expect(dialog.getByRole('button', { name: T.common.cancel })).toBeFocused();
  await expect(dialog.getByRole('heading')).toHaveText(T.settings.resetHeading);
  // One short sentence: the setup starts anew.
  await expect(dialog).toContainText(T.settings.resetText);
  await expect(dialog.getByTestId('dialog-items')).toHaveCount(0);
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.settings.resetAction);
  await failNext(page, 'reset_all');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText(DB_ERROR);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'reset_all')).toHaveLength(2);
});

/* ------------------------------------------------------------------- locks */

test('a run holds the mailbox, the reset and the sign-in, with its reason', async ({ page }) => {
  await settings(page, `${WIN}&scenario=running`);
  for (const id of ['mailbox-change', 'mailbox-remove', 'reset']) {
    expect(await reason(page, id), id).toBe(T.error.text('busy', { activity: 'fetch' }));
  }
  // A rescore says its own reason; the sign-out waits too.
  await settings(page);
  await (await reveal(page, page.getByTestId('sign-in-freelance'))).click();
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('rescore');
  });
  for (const id of ['mailbox-change', 'reset', 'sign-out-freelance']) {
    expect(await reason(page, id), id).toBe(T.error.text('busy', { activity: 'rescore' }));
  }
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('the dry run keeps to its own data and says so', async ({ page }) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  await expect(page.getByTestId('settings')).toContainText('probelauf@example.org');
  await expect(page.getByTestId('dry-run-note')).toContainText(T.settings.dryRun);
  expect(await reason(page, 'mailbox-remove')).toBe(T.error.text('dryRun', {}));
});

/* ============================================================ what the audit found */

test('a search that waits for the sign-in leaves Anmelden of that portal on', async ({ page }) => {
  await settings(page, `${WIN}&scenario=sign-in-waiting`);
  await expect(page.getByTestId('portal-freelance-hint')).toHaveText(T.settings.signInWaiting);
  // The sign-in window is the one the search waits for: its button is the way to give it. The
  // other portals' calls wait for the run.
  const signIn = await reveal(page, page.getByTestId('sign-in-freelance'));
  await expect(signIn).not.toHaveAttribute('aria-disabled', 'true');
  await signIn.click();
  await expect
    .poll(async () => (await calls(page, 'portal_login')).at(-1)?.[1])
    .toEqual({ portal: 'freelance' });
});

test('switching a portal off lets its calls fade out together: Anmelden does not jump', async ({
  page,
}) => {
  await settings(page);
  const signIn = await reveal(page, page.getByTestId('sign-in-freelance'));
  const before = (await signIn.boundingBox())!.x;
  await page.getByTestId('toggle-enabled-freelance').click();
  // Right after the switch, while both fade, Anmelden stands where it stood.
  const during = await page.evaluate(
    () => document.querySelector('[data-testid="sign-in-freelance"]')?.getBoundingClientRect().x,
  );
  expect(during).toBeCloseTo(before, 0);
  await expect(page.getByTestId('sign-in-freelance')).toHaveCount(0);
  await expect(page.getByTestId('setup-freelance')).toHaveCount(0);
});

/* ---------------------------------------------------------------- baselines */

test('baseline: first run', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await expectShot(page, 'first-run');
});

test('baseline: settings', async ({ page }) => {
  await settings(page);
  await expectShot(page, 'settings');
});
