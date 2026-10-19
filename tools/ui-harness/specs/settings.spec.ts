// Einstellungen against the stub: one page, three groups in their order (Jobportale, Postfach,
// Daten), the portals with how they bring their jobs and what they brought, the mailbox and
// its dialog, the profile's folder and the reset. The look of the rows is not pinned here.

import type { Page } from '@playwright/test';
import type { SettingsPatch } from '../../../ui/src/lib/ipc/types';
import { calls, expect, expectShot, nav, open, settle, test, visibleCount } from './fixtures';
import { ALERT_PORTALS, expectMailboxState, failNext, SEARCHED, reveal, T } from './helpers';

const WIN = '?platform=windows';

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

/** The test ids of the children of a container that carry one, in order. */
function ids(page: Page, testid: string, selector: string): Promise<(string | null)[]> {
  return page
    .getByTestId(testid)
    .locator(selector)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
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

test('mailbox: Ändern opens the form in a dialog; Verbinden saves, Esc gives the focus back', async ({
  page,
}) => {
  await settings(page);
  const change = await reveal(page, page.getByTestId('mailbox-change'));
  await change.focus();
  await page.keyboard.press('Enter');
  // The dialog follows the verb of its button.
  const dialog = page.getByTestId('dialog-mailbox');
  await expect(dialog.getByRole('heading')).toHaveText(T.settings.changeHeading);
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.settings.connect);
  // The address stays, so the caret waits in the app password; its info symbol beside it
  // and Google's page of the app passwords below.
  await expect(page.getByTestId('mailbox-password')).toBeFocused();
  await expect(page.getByTestId('mailbox-user')).toHaveValue('alerts.demo@gmail.com');
  await expect(dialog.getByTestId('info-tip')).toHaveAccessibleName(
    T.common.infoAbout(T.settings.password),
  );
  await expect(dialog.getByTestId('two-step')).toHaveCount(0);
  await expect(dialog.getByTestId('create-password')).toBeVisible();
  await expect(dialog).not.toContainText('16 Buchstaben');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(change).toBeFocused();
  // Empty password: said at its field, the dialog stays.
  await change.click();
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toContainText(T.settings.passwordMissing);
  expect(await calls(page, 'save_mailbox')).toHaveLength(0);
  // Enter in the field connects; the dialog closes once saved.
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'save_mailbox')).toHaveLength(1);
});

test('mailbox: a saved change is answered by its state; a mail error before it is past', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=offline`);
  const mailbox = await reveal(page, page.getByTestId('settings-mailbox'));
  // The last fetch could not reach Gmail: said once.
  await expectMailboxState(page, T.settings.unreachable);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
  // A new sign-in: Gmail accepted it, the state says so, no note and no toast.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('dialog-mailbox').getByTestId('dialog-confirm').click();
  await expectMailboxState(page, T.settings.connected);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: Gmail refused the app password while the search went on; said once', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=mailbox-refused`);
  const mailbox = await reveal(page, page.getByTestId('settings-mailbox'));
  await expectMailboxState(page, T.settings.refused);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: removing asks first, a failure stays; then "Nicht verbunden" connects', async ({
  page,
}) => {
  await settings(page);
  await reveal(page, page.getByTestId('mailbox-remove'));
  await page.getByTestId('mailbox-remove').click();
  const dialog = page.getByTestId('dialog-remove-mailbox');
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.common.remove);
  await failNext(page, 'remove_mailbox');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'remove_mailbox')).toHaveLength(2);
  // Without a mailbox its row says so and connects in the same dialog.
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  await page.getByTestId('mailbox-connect').click();
  await expect(page.getByTestId('dialog-mailbox').getByRole('heading')).toHaveText(
    T.settings.connectHeading,
  );
  await expect(page.getByTestId('mailbox-user')).toBeFocused();
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('dialog-mailbox').getByTestId('dialog-confirm').click();
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
  for (const [portal, state] of [
    ['freelancermap', T.settings.lastNew(3)],
    ['hays', null],
    ['michaelpage', null],
    ['solcom', null],
    ['gulp', null],
    ['amadeusfire', null],
    ['interimx', null],
    ['fratch', null],
    ['linkedin', T.settings.alertMails(24)],
    ['freelance', T.settings.alertMails(11)],
  ] as const) {
    // Its state in one quiet line; no meter, no calls counted.
    const row = await reveal(page, page.getByTestId(`portal-${portal}`));
    await expect(row.locator('.badge')).toHaveCount(0);
    if (state === null) await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveCount(0);
    else await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveText(state);
    await expect(row.getByRole('progressbar')).toHaveCount(0);
    await expect(row).not.toContainText('Aufrufen');
    // The browser's glyph only where "Alert anlegen" does not open the portal already.
    await expect(row.getByTestId(`open-portal-${portal}`)).toHaveCount(
      ALERT_PORTALS.includes(portal) ? 0 : 1,
    );
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
  await expect(page.locator('[data-testid^="setup-"]')).toHaveText([
    T.settings.setUpAlert,
    T.settings.setUpAlert,
  ]);
  await (await reveal(page, page.getByTestId('setup-freelance'))).click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalSetup', portal: 'freelance' } });
  await page.getByTestId('open-portal-hays').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'hays' } });
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
  // No label element anywhere on the page: no text is a click target of a switch.
  await expect(page.getByTestId('settings').locator('label')).toHaveCount(0);
  // Every reference of a name or a description names a text that is there.
  const dangling = await page
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
  expect(dangling).toEqual([]);
  // A save that fails puts the switch back and says why in the row.
  await reveal(page, page.getByTestId('toggle-enabled-freelancermap'));
  await failNext(page, 'save_settings');
  await page.getByTestId('toggle-enabled-freelancermap').click();
  await expect(page.getByTestId('portal-freelancermap').getByTestId('portal-error')).toHaveText(
    'Die Datenbank meldet einen Fehler.',
  );
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
  // Anmelden only lets the fetch use the stored sign-in: no sign-in window.
  await (await reveal(page, page.getByTestId('sign-in-freelance'))).click();
  await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  expect(await calls(page, 'portal_login')).toHaveLength(0);
  expect((await saved(page)).at(-1)?.portals[0]?.loginEnabled).toBe(true);
  await settings(page, `${WIN}&scenario=session-left`);
  // With the portal off the stored sign-in shows, so it can be removed.
  await (await reveal(page, page.getByTestId('toggle-enabled-freelance'))).click();
  await page.getByTestId('sign-out-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toHaveCount(0);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a pause says until when in the state line, an empty alert mail in a quiet line', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=paused`);
  const status = await reveal(page, page.getByTestId('portal-linkedin-hint'));
  await expect(status).toHaveText(/^Pausiert bis /);
  await expect(page.getByTestId('health-linkedin')).toHaveCount(0);
  const mails = page.getByTestId('health-freelance');
  await expect(mails.locator('.text')).toHaveText('In 2 Alert-Mails fand CXact keine Jobs.');
  await mails.getByRole('button', { name: T.reader.mail }).click();
  expect(await lastOpened(page)).toEqual({
    target: { kind: 'alertMail', gmailId: '18c2f0a9d1e4b7a3' },
  });
  // A portal that is off says no problem of its own.
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(page.getByTestId('health-freelance')).toHaveCount(0);
});
test('portals: a week without an alert mail is one quiet line with Alert prüfen', async ({
  page,
}) => {
  // The demo's portals all sent alert mails lately: no line.
  await settings(page);
  await expect(page.locator('[data-testid^="alert-quiet-"]')).toHaveCount(0);
  // freelance.de sent its last one nine days before the last fetch.
  await settings(page, `${WIN}&scenario=quiet-alert`);
  const quiet = await reveal(page, page.getByTestId('alert-quiet-freelance'));
  await expect(quiet.locator('.text')).toHaveText(T.settings.alertQuiet(9));
  await expect(page.locator('[data-testid^="alert-quiet-"]')).toHaveCount(1);
  await quiet.getByRole('button', { name: T.settings.checkAlert }).click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'freelance' } });
  // A portal that is off says nothing about its alert mails.
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(quiet).toHaveCount(0);
  // The Jobs view shows nothing of it.
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByText(T.settings.alertQuiet(9))).toHaveCount(0);
});

test('without a mailbox the portals of alert mails say they need one; one Verbinden', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=no-mailbox`);
  await expect(page.getByTestId('mailbox')).toContainText(T.settings.notConnected);
  for (const portal of ALERT_PORTALS) {
    await expect(page.getByTestId(`portal-${portal}-hint`)).toHaveText(T.settings.needsMailbox);
  }
  await expect(page.getByTestId('view-settings').getByTestId('mailbox-connect')).toHaveCount(1);
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
  for (const gone of ['backup-restore', 'logs-open']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await (await reveal(page, page.getByTestId('folder-open'))).click();
  // Öffnen opens the folder shown.
  expect(await lastOpened(page)).toEqual({ target: { kind: 'workspace' } });
  // A folder that does not open says so at the end of its section.
  await failNext(page, 'open_target');
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('data-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  // Ändern: the folder dialog; the profile comes along and the toast says so.
  await page.getByTestId('folder-change').click();
  await expect(page.getByTestId('toast-text')).toHaveText(T.settings.folderMoved);
  await expect(data.locator('[data-copy]')).toHaveText('C:\\Users\\demo\\Documents\\Jobs');
});

test('reset: the danger dialog lists what goes; a failure stays in it', async ({ page }) => {
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
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
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
  expect(await reason(page, 'mailbox-remove')).toBe('Im Probelauf geht das nicht.');
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
