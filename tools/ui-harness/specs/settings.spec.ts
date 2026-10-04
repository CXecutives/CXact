// Einstellungen against the stub: the tabs in their order (Portale, Daten) and the cards of
// each, their rows flush on one edge, the search's terms, the mailbox and its dialog, the
// portals with what they brought, the profiles' folder, the version and the reset.

import type { Locator, Page } from '@playwright/test';
import { ICONS } from '../../../ui/src/lib/icons';
import type { SettingsPatch } from '../../../ui/src/lib/ipc/types';
import { calls, expect, expectShot, nav, open, settle, test, visibleCount } from './fixtures';
import {
  ALERT_PORTALS,
  expectMailboxState,
  failNext,
  SEARCHED,
  showTab,
  T,
  tokenPx,
} from './helpers';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

/** The tabs of Einstellungen in their order (lib/state/settings.svelte.ts). */
const TABS = ['portals', 'data'] as const;
type Tab = (typeof TABS)[number];

/* ------------------------------------------------------------------ helpers */

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await nav(page, 'nav-settings');
  await expect(page.getByTestId('settings')).toBeVisible();
  await settle(page);
}

/** Shows a tab of Einstellungen; its panel (one shows at a time). */
async function showSettingsTab(page: Page, tab: Tab): Promise<Locator> {
  await page.getByTestId(`settings-tab-${tab}`).click();
  const panel = page.getByTestId(`settings-panel-${tab}`);
  await expect(panel).toBeVisible();
  return panel;
}

/** What `read` finds in each tab's panel, the tabs shown one after the other. */
async function eachTab<Item>(
  page: Page,
  read: (panel: Locator) => Promise<Item[]>,
): Promise<Item[]> {
  const all: Item[] = [];
  for (const tab of TABS) all.push(...(await read(await showSettingsTab(page, tab))));
  return all;
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

/** A whole patch from what changes (the rest unchanged, as the page sends it). */
const patch = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  fetchMail: null,
  fetchSearch: null,
  ...change,
});

/** A colour token as the page computes it (rgb()). */
async function colour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = `var(${name})`;
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

/** The tooltip of a locked button (its tab shown first). */
async function reason(page: Page, testid: string): Promise<string | null> {
  const button = await showTab(page, page.getByTestId(testid));
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

const middle = (box: { y: number; height: number } | null): number =>
  box === null ? -1 : box.y + box.height / 2;

/* ---------------------------------------------------------------- the page */

test('the tabs Portale and Daten, the tab bar on the first row, each tab with its cards', async ({
  page,
}) => {
  await settings(page);
  const tabs = page.getByTestId('settings-tabs').getByRole('tab');
  await expect(tabs).toHaveText([T.settings.portals, T.settings.data]);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  // Portale: CXact sucht nach (its info symbol beside it), Jobportale and Alert-Mails, each
  // under its heading; the mailbox on top of the alert mails' portals.
  const portals = await showSettingsTab(page, 'portals');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(portals.locator('h2')).toHaveText([
    T.settings.terms,
    T.settings.search,
    T.settings.alerts,
  ]);
  await expect(page.getByTestId('info-terms')).toHaveAccessibleName(
    T.common.infoAbout(T.settings.terms),
  );
  expect(await ids(page, 'settings-panel-portals', ':scope > section')).toEqual([
    'settings-terms',
    'settings-search',
    'settings-mailbox',
  ]);
  expect(await ids(page, 'settings-search', '[data-setting-row]')).toEqual(
    SEARCHED.map((portal) => `portal-${portal}`),
  );
  expect(await ids(page, 'settings-mailbox', '[data-setting-row]')).toEqual([
    'mailbox',
    ...ALERT_PORTALS.map((portal) => `portal-${portal}`),
  ]);
  // The info symbols of the page: only at CXact sucht nach.
  await expect(page.getByTestId('settings').locator('[data-testid^="info-"]')).toHaveCount(1);
  expect(await visibleCount(page, '.btn.primary')).toBe(0);
  // Daten: the profiles' folder and the reset, the version quietly under them; the tab names
  // the card.
  const data = await showSettingsTab(page, 'data');
  await expect(data.locator('h2')).toHaveCount(0);
  expect(await ids(page, 'settings-data', '[data-setting-row]')).toEqual(['profiles', 'reset-all']);
  await expect(page.getByTestId('data-footnote')).toHaveText(T.settings.version('4.0.0'));
  expect(await visibleCount(page, '.btn.primary')).toBe(0);
  // The title stands on the first row, centred on the sidebar's first entry (macOS too),
  // the tabs under it, 24 above the first section.
  const title = page.getByTestId('settings').locator('[data-first-row]');
  for (const query of [WIN, MAC]) {
    await settings(page, query);
    await expect(title).toHaveText(T.settings.title);
    const line = middle(await page.getByTestId('nav-jobs').boundingBox());
    expect(middle(await title.boundingBox()), query).toBe(line);
    const [above, first] = await Promise.all([
      page.getByTestId('settings-tabs').boundingBox(),
      page.getByTestId('settings-terms').boundingBox(),
    ]);
    expect(Math.round(first!.y - (above!.y + above!.height)), query).toBe(24);
  }
});

test('CXact sucht nach: the terms with what they brought, the way to the profile', async ({
  page,
}) => {
  await settings(page);
  const terms = page.getByTestId('search-term');
  await expect(terms.first()).toContainText('Interim CFO');
  await expect(terms.first()).toContainText(T.settings.termMatched(6));
  await expect(page.getByTestId('search-terms')).toContainText(T.settings.termNew);
  expect((await calls(page, 'search_terms')).length).toBeGreaterThan(0);
  await page.getByTestId('terms-edit').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  // Without a profile: one sentence and "Profil anlegen".
  await settings(page, `${WIN}&scenario=no-profile`);
  await expect(page.getByTestId('search-terms')).toContainText(T.settings.noTerms);
  await expect(page.getByTestId('search-term')).toHaveCount(0);
  await page.getByTestId('terms-create-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
});

test('button styles: every text button of a row is outlined, what deletes for good is red', async ({
  page,
}) => {
  await settings(page);
  // Every button with words in a row of a card, tab by tab: the one outlined kind, 28 px
  // like all.
  const kinds = await eachTab(page, (panel) =>
    panel.locator('.card button.btn:not(.icon-only):not(.link)').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-testid'),
        secondary: node.classList.contains('secondary'),
        height: Math.round(node.getBoundingClientRect().height),
      })),
    ),
  );
  expect(kinds.map((kind) => kind.id)).toEqual([
    'mailbox-change',
    'mailbox-remove',
    'setup-linkedin',
    'sign-in-freelance',
    'setup-freelance',
    'profiles-open',
    'reset',
  ]);
  const height = await tokenPx(page, '--control-field');
  expect(kinds.filter((kind) => !kind.secondary || kind.height !== height)).toEqual([]);
  // Only what loses something for good is red, with the one glyph of deleting (icons.ts):
  // Entfernen and Zurücksetzen.
  const danger = await colour(page, '--danger-strong');
  for (const [id, warns] of [
    ['mailbox-remove', true],
    ['reset', true],
    ['mailbox-change', false],
    ['profiles-open', false],
  ] as const) {
    const button = await showTab(page, page.getByTestId(id));
    if (warns) {
      await expect(button, id).toHaveCSS('color', danger);
      await expect(button.locator('[data-icon]'), id).toHaveAttribute('data-icon', 'trash');
    } else await expect(button, id).not.toHaveCSS('color', danger);
  }
  // Every row of every tab ends on the same edge: its last button, switch or choice.
  const ends = await eachTab(page, (panel) =>
    panel
      .locator('[data-setting-row]')
      .evaluateAll((rows) =>
        rows.map((row) =>
          Math.round(
            Math.max(
              ...[...row.querySelectorAll('button, [role="radiogroup"]')].map(
                (node) => node.getBoundingClientRect().right,
              ),
            ),
          ),
        ),
      ),
  );
  // The portals, the mailbox, the profiles' folder and the reset.
  expect(ends).toHaveLength(SEARCHED.length + 1 + ALERT_PORTALS.length + 2);
  expect(new Set(ends).size).toBe(1);
  // The sources' rows sit edge to edge like every other row: no inset above the first.
  await showSettingsTab(page, 'portals');
  const [card, first] = await Promise.all([
    page.getByTestId('portals-search').boundingBox(),
    page.getByTestId('portal-hays').boundingBox(),
  ]);
  expect(Math.round(first!.y - card!.y)).toBe(1);
  // Every button of every tab is at most 32 px high.
  const heights = await eachTab(page, (panel) =>
    panel
      .locator('button:not([role="switch"]):not([role="radio"])')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height))),
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(heights.filter((height) => height > 32)).toEqual([]);
});

test('narrow, a row puts its control under the label only where the two do not fit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await settings(page);
  await showTab(page, page.getByTestId('reset-all'));
  // Label and control side by side, like the wider rows.
  for (const id of ['reset-all']) {
    const row = page.getByTestId(id);
    const [text, control] = await Promise.all([
      row.locator('.text').boundingBox(),
      row.locator('.control').boundingBox(),
    ]);
    expect(control!.x, id).toBeGreaterThanOrEqual(text!.x + text!.width);
  }
  // At the smallest window the label keeps its room: the button stands beside it or goes
  // under it, never over it.
  await page.setViewportSize({ width: 480, height: 800 });
  const profiles = page.getByTestId('profiles');
  const [text, control] = await Promise.all([
    profiles.locator('.text').boundingBox(),
    profiles.locator('.control').boundingBox(),
  ]);
  const under = control!.y >= text!.y + text!.height;
  const beside = control!.x >= text!.x + text!.width;
  expect(under || beside).toBe(true);
});

test('narrow, the sign-in goes to a line of its own under the portal', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await settings(page);
  await showTab(page, page.getByTestId('sign-in-freelance'));
  const [signIn, note] = await Promise.all([
    page.getByTestId('sign-in-freelance').boundingBox(),
    page.getByTestId('note-freelance').boundingBox(),
  ]);
  expect(signIn!.y).toBeGreaterThanOrEqual(note!.y + note!.height);
});

/* ---------------------------------------------------------------- Postfach */

test('mailbox: the address, no word about the vault, no whole-mailbox row', async ({ page }) => {
  await settings(page);
  const mailbox = await showTab(page, page.getByTestId('settings-mailbox'));
  // The mail tile, the address and under it its state after a green dot (no badge).
  const glyph = await page
    .getByTestId('mailbox')
    .locator('.lead svg')
    .evaluate((node) => [...node.classList]);
  expect(glyph).toContain(`lucide-${ICONS.alertMail}`);
  await expect(page.getByTestId('mailbox').locator('[data-copy]')).toHaveText(
    'alerts.demo@gmail.com',
  );
  await expectMailboxState(page, T.settings.connected, 'success');
  await expect(mailbox.locator('.badge')).toHaveCount(0);
  await expect(mailbox).not.toContainText('Anmeldeinformationsverwaltung');
  await expect(mailbox).not.toContainText('Alle Alert-Mails');
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
});

test('mailbox: Ändern opens the form in a dialog; Verbinden saves, Esc gives the focus back', async ({
  page,
}) => {
  await settings(page);
  const change = await showTab(page, page.getByTestId('mailbox-change'));
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
  const mailbox = await showTab(page, page.getByTestId('settings-mailbox'));
  // The last fetch could not reach Gmail: said once, after a red dot.
  await expectMailboxState(page, T.settings.unreachable, 'danger');
  await expect(page.getByTestId('mailbox-failure')).toHaveCount(0);
  // A new sign-in: Gmail accepted it, the state says so, no note and no toast.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('dialog-mailbox').getByTestId('dialog-confirm').click();
  await expectMailboxState(page, T.settings.connected, 'success');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: removing asks first, a failure stays; then "Kein Postfach" connects', async ({
  page,
}) => {
  await settings(page);
  await showTab(page, page.getByTestId('mailbox-remove'));
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
  await expectMailboxState(page, T.settings.connected, 'success');
});

test('Alert-Mails: the connection first, then the portals of its alert mails', async ({ page }) => {
  await settings(page);
  const rows = page.getByTestId('settings-mailbox').locator('[data-setting-row]');
  expect(
    await rows.evaluateAll((all) => all.map((row) => row.getAttribute('data-testid'))),
  ).toEqual(['mailbox', ...ALERT_PORTALS.map((portal) => `portal-${portal}`)]);
});

/* ------------------------------------------------------------ Suche, Postfach */

test('sources: Suche, and in Postfach those of its alert mails, in the order of the UI, with their calls', async ({
  page,
}) => {
  await settings(page);
  expect(await ids(page, 'portals-search', '[data-testid^="portal-"]')).toEqual(
    SEARCHED.map((portal) => `portal-${portal}`),
  );
  expect(await ids(page, 'portals-mailbox', '[data-testid^="portal-"]')).toEqual(
    ALERT_PORTALS.map((portal) => `portal-${portal}`),
  );
  // Jobportale one card; Alert-Mails one card, the mailbox's row first, its portals under it.
  expect(await ids(page, 'settings-search', '.card')).toEqual(['portals-search']);
  expect(await ids(page, 'settings-mailbox', '.card')).toEqual(['portals-mailbox']);
  await expect(
    page.getByTestId('portals-mailbox').locator('[data-setting-row]').first(),
  ).toHaveAttribute('data-testid', 'mailbox');
  for (const [portal, brought] of [
    ['freelance', 2],
    ['linkedin', 2],
    ['freelancermap', 3],
    ['hays', null],
    ['michaelpage', null],
    ['solcom', null],
    ['gulp', null],
    ['amadeusfire', null],
    ['interimx', null],
    ['fratch', null],
  ] as const) {
    // What the last search brought from it in one quiet line (the limits are the run's to
    // say), no meter, no calls.
    const row = await showTab(page, page.getByTestId(`portal-${portal}`));
    if (brought === null) await expect(page.getByTestId(`last-new-${portal}`)).toHaveCount(0);
    else
      await expect(page.getByTestId(`last-new-${portal}`)).toHaveText(T.settings.lastNew(brought));
    await expect(row.getByRole('progressbar')).toHaveCount(0);
    await expect(row).not.toContainText('Aufrufen');
    await expect(row.getByTestId(`open-portal-${portal}`)).toBeVisible();
    await expect(row.getByRole('switch')).toHaveAccessibleName(T.portal[portal]);
  }
  // Only freelance.de offers a sign-in, and says what it adds; no "Details holen".
  await expect(page.getByTestId('note-freelance')).toHaveText(T.settings.portalNote('freelance')!);
  await expect(page.locator('[data-testid^="note-"]')).toHaveCount(1);
  await expect(page.getByTestId('view-settings').locator('[data-testid^="sign-in-"]')).toHaveCount(
    1,
  );
  for (const card of ['settings-search', 'settings-mailbox']) {
    await expect(page.getByTestId(card)).not.toContainText('Details');
    await expect(page.getByTestId(card)).not.toContainText('Seiten');
  }
  // Only a source of alert mails offers "Alert anlegen", its page in the browser.
  await expect(page.getByTestId('settings-search').locator('[data-testid^="setup-"]')).toHaveCount(
    0,
  );
  await expect(page.getByTestId('settings-mailbox').locator('[data-testid^="setup-"]')).toHaveText([
    T.settings.setUpAlert,
    T.settings.setUpAlert,
  ]);
  await (await showTab(page, page.getByTestId('setup-freelance'))).click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalSetup', portal: 'freelance' } });
  // The sign-in before "Alert anlegen", which stands in one column in every row; the buttons
  // and the tools 12 apart, like the buttons and the switch of every other row.
  const gap = await page
    .getByTestId('portal-freelance')
    .locator('.tools')
    .evaluate((node) => getComputedStyle(node).columnGap);
  expect(gap).toBe('12px');
  const [signIn, setup, otherSetup, external] = await Promise.all([
    page.getByTestId('sign-in-freelance').boundingBox(),
    page.getByTestId('setup-freelance').boundingBox(),
    page.getByTestId('setup-linkedin').boundingBox(),
    page.getByTestId('open-portal-freelance').boundingBox(),
  ]);
  expect(Math.round(setup!.x - (signIn!.x + signIn!.width))).toBe(12);
  expect(Math.round(external!.x - (setup!.x + setup!.width))).toBe(12);
  expect(Math.round(setup!.x)).toBe(Math.round(otherSetup!.x));
  await page.getByTestId('open-portal-linkedin').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'linkedin' } });
});

test('portals: the switches save at once; only the switch switches', async ({ page }) => {
  await settings(page);
  const toggle = await showTab(page, page.getByTestId('toggle-enabled-linkedin'));
  await page.getByTestId('portal-linkedin').getByText(T.portal.linkedin).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // Off, the row keeps what it brought; no toast answers a switch.
  await expect(page.getByTestId('last-new-linkedin')).toBeVisible();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await saved(page)).toEqual([
    patch({ portals: [{ portal: 'linkedin', enabled: false, loginEnabled: null }] }),
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
  await showTab(page, page.getByTestId('toggle-enabled-freelancermap'));
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
  await (await showTab(page, page.getByTestId('sign-in-freelance'))).click();
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
  await (await showTab(page, page.getByTestId('sign-in-freelance'))).click();
  await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  expect(await calls(page, 'portal_login')).toHaveLength(0);
  expect((await saved(page)).at(-1)?.portals[0]?.loginEnabled).toBe(true);
  await settings(page, `${WIN}&scenario=session-left`);
  // With the portal off the stored sign-in shows, so it can be removed.
  await (await showTab(page, page.getByTestId('toggle-enabled-freelance'))).click();
  await page.getByTestId('sign-out-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toHaveCount(0);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a pause or an empty alert mail is one quiet line', async ({ page }) => {
  await settings(page, `${WIN}&scenario=paused`);
  const pause = await showTab(page, page.getByTestId('health-linkedin'));
  await expect(pause).toHaveText(
    'Das Portal bremst die Aufrufe, die Suche macht ab 11:05 von selbst weiter.',
  );
  await expect(pause).toHaveClass(/info/);
  const mails = page.getByTestId('health-freelance');
  await expect(mails.locator('.text')).toHaveText('In 2 Alert-Mails fand die App keine Jobs.');
  await expect(mails).toHaveClass(/warning/);
  await mails.getByRole('button', { name: T.reader.mail }).click();
  expect(await lastOpened(page)).toEqual({
    target: { kind: 'alertMail', gmailId: '18c2f0a9d1e4b7a3' },
  });
  // A portal that is off says no problem of its own.
  await page.getByTestId('toggle-enabled-linkedin').click();
  await expect(page.getByTestId('health-linkedin')).toHaveCount(0);
});

test('portals: a week without an alert mail is one quiet line with Alert prüfen', async ({
  page,
}) => {
  // The demo's portals all sent alert mails lately: no line.
  await settings(page);
  await expect(page.locator('[data-testid^="alert-quiet-"]')).toHaveCount(0);
  // freelance.de sent its last one nine days before the last fetch.
  await settings(page, `${WIN}&scenario=quiet-alert`);
  const quiet = await showTab(page, page.getByTestId('alert-quiet-freelance'));
  await expect(quiet.locator('.text')).toHaveText(T.settings.alertQuiet(9));
  await expect(quiet).toHaveClass(/warning/);
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

test('without a mailbox the portals of alert mails rest: one sentence, one Verbinden', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=no-mailbox`);
  await expect(page.getByTestId('mailbox')).toContainText(
    T.settings.noMailbox(['linkedin', 'freelance']),
  );
  await expect(page.getByTestId('view-settings').getByTestId('mailbox-connect')).toHaveCount(1);
});

/* ------------------------------------------------------------------- Daten */

test('Daten: Profile with Ordner öffnen, Alle Daten zurücksetzen; no Sicherung, no path', async ({
  page,
}) => {
  await settings(page);
  const data = page.getByTestId('settings-data');
  expect(await ids(page, 'settings-data', '[data-setting-row]')).toEqual(['profiles', 'reset-all']);
  await expect(page.getByTestId('reset')).toHaveText(T.settings.resetAction);
  for (const gone of ['backup-restore', 'logs-open', 'folder-change']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await expect(data.locator('[data-copy]')).toHaveCount(0);
  await (await showTab(page, page.getByTestId('profiles-open'))).click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'profileDir' } });
  // A folder that does not open says so at the end of its card.
  await failNext(page, 'open_target');
  await page.getByTestId('profiles-open').click();
  await expect(page.getByTestId('data-note')).toHaveText('Die Datenbank meldet einen Fehler.');
});

test('reset: the danger dialog lists what goes; a failure stays in it', async ({ page }) => {
  await settings(page);
  await (await showTab(page, page.getByTestId('reset'))).click();
  const dialog = page.getByTestId('dialog-reset');
  await expect(dialog.getByRole('button', { name: T.common.cancel })).toBeFocused();
  await expect(dialog.getByRole('heading')).toHaveText(T.settings.resetHeading);
  // What it does in two short sentences: it deletes, then the setup starts anew.
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
  await (await showTab(page, page.getByTestId('sign-in-freelance'))).click();
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
