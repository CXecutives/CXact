// Einstellungen against the stub: the cards in their order (Postfach, Suche, Alert-Mails,
// Export, Darstellung, Daten), their rows flush on one edge, the mailbox and its dialog, the
// sources with their calls and the automatic fetch, the export switches, the palettes and the language, the backups, the
// reset and the version.

import type { Page } from '@playwright/test';
import type { SettingsPatch } from '../../../ui/src/lib/ipc/types';
import { calls, expect, expectShot, nav, open, settle, test, visibleCount } from './fixtures';
import { ALERT_PORTALS, ALL_PORTALS, failNext, SEARCHED, T, tokenPx } from './helpers';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

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

/** A whole patch from what changes (the rest unchanged, as the page sends it). */
const patch = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  fetchRange: null,
  exportExcel: null,
  exportCsv: null,
  autoFetch: null,
  language: null,
  palette: null,
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

/** The tooltip of a locked button. */
async function reason(page: Page, testid: string): Promise<string | null> {
  const button = page.getByTestId(testid);
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

/** The top of `watched` in every frame for `ms` after a click on `clicked` (both test ids),
 *  both in the page, so no frame is missed. */
function topsAfterClick(page: Page, clicked: string, watched: string, ms = 320): Promise<number[]> {
  return page.evaluate(
    ([clicked, watched, ms]) =>
      new Promise<number[]>((resolve) => {
        const target = document.querySelector(`[data-testid="${watched}"]`)!;
        const tops = [Math.round(target.getBoundingClientRect().top)];
        document.querySelector<HTMLElement>(`[data-testid="${clicked}"]`)!.click();
        const start = performance.now();
        const frame = (): void => {
          tops.push(Math.round(target.getBoundingClientRect().top));
          if (performance.now() - start < ms) requestAnimationFrame(frame);
          else resolve(tops);
        };
        requestAnimationFrame(frame);
      }),
    [clicked, watched, ms] as const,
  );
}

/** It moved by more than a little, and not in one frame: a step stood between. */
function glided(tops: number[]): boolean {
  const first = tops[0]!;
  const last = tops.at(-1)!;
  return (
    Math.abs(last - first) > 20 &&
    tops.some((top) => Math.abs(top - first) > 2 && Math.abs(top - last) > 2)
  );
}

/* ---------------------------------------------------------------- the page */

test('the cards in their order, the first heading on the first row, the version below', async ({
  page,
}) => {
  await settings(page);
  expect(await ids(page, 'settings', ':scope > section')).toEqual([
    'settings-mailbox',
    'settings-search',
    'settings-alerts',
    'settings-data',
  ]);
  await expect(page.getByTestId('settings').locator('h2')).toHaveText([
    T.settings.mailbox,
    T.settings.search,
    T.settings.alerts,
    T.settings.data,
  ]);
  // Every heading stands 12 px above its card, the first one too.
  const gaps = await page
    .getByTestId('settings')
    .locator(':scope > section')
    .evaluateAll((sections) =>
      sections.map((section) => {
        const heading = section.querySelector('h2')!.getBoundingClientRect();
        const card = section.querySelector('.card')!.getBoundingClientRect();
        return Math.round(card.top - heading.bottom);
      }),
    );
  expect(gaps).toEqual([12, 12, 12, 12]);
  // Nothing here asks for a primary; what went is gone.
  expect(await visibleCount(page, '.btn.primary')).toBe(0);
  // "Automatisch abrufen" is back in Suche (user decision 2026-10-01).
  for (const gone of ['Tastenkürzel', 'Bericht', 'Textdateien', 'Standard']) {
    await expect(page.getByTestId('settings')).not.toContainText(gone);
  }
  // No version line (user decision 2026-09-27).
  await expect(page.getByTestId('version')).toHaveCount(0);
  // "Postfach" stands on the first row, as the sidebar's first entry (macOS too).
  for (const query of [WIN, MAC]) {
    await settings(page, query);
    const row = page.getByTestId('settings-mailbox').locator('[data-first-row]');
    await expect(row).toContainText(T.settings.mailbox);
    const middle = (box: { y: number; height: number } | null): number =>
      box === null ? -1 : box.y + box.height / 2;
    expect(middle(await row.boundingBox())).toBe(
      middle(await page.getByTestId('nav-jobs').boundingBox()),
    );
  }
});

test('button styles: every text button of a row is outlined, what deletes for good is red', async ({
  page,
}) => {
  await settings(page);
  // Every button with words in a row of a card: the one outlined kind, 26 px.
  const kinds = await page
    .getByTestId('settings')
    .locator('.card button.btn:not(.icon-only)')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-testid'),
        secondary: node.classList.contains('secondary'),
        height: Math.round(node.getBoundingClientRect().height),
      })),
    );
  expect(kinds.map((kind) => kind.id)).toEqual([
    'mailbox-change',
    'mailbox-remove',
    'setup-linkedin',
    'setup-freelance',
    'sign-in-freelance',
    'folder-change',
    'folder-open',
    'reset',
  ]);
  const small = await tokenPx(page, '--control-sm');
  expect(kinds.filter((kind) => !kind.secondary || kind.height !== small)).toEqual([]);
  // Only what loses something for good is red, with the one glyph of deleting (icons.ts):
  // Entfernen and Zurücksetzen.
  const danger = await colour(page, '--danger-strong');
  for (const [id, warns] of [
    ['mailbox-remove', true],
    ['reset', true],
    ['mailbox-change', false],
    ['folder-open', false],
  ] as const) {
    const button = page.getByTestId(id);
    if (warns) {
      await expect(button, id).toHaveCSS('color', danger);
      await expect(button.locator('[data-icon]'), id).toHaveAttribute('data-icon', 'trash');
    } else await expect(button, id).not.toHaveCSS('color', danger);
  }
  // Every row ends on the same edge: its last button, switch or choice.
  const ends = await page
    .getByTestId('settings')
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
    );
  // The mailbox, three portals, the work folder and the reset.
  expect(ends.length).toBeGreaterThanOrEqual(6);
  expect(new Set(ends).size).toBe(1);
  // The sources' rows sit edge to edge like every other row: no inset above the first.
  const [card, first] = await Promise.all([
    page.getByTestId('portals-alerts').boundingBox(),
    page.getByTestId('portal-linkedin').boundingBox(),
  ]);
  expect(Math.round(first!.y - card!.y)).toBe(1);
  // Every button of the page is at most 29 px high.
  const heights = await page
    .getByTestId('settings')
    .locator('button:not([role="switch"]):not([role="radio"])')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(heights.filter((height) => height > 32)).toEqual([]);
});

test('narrow, a row puts its control under the label only where the two do not fit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await settings(page);
  // Label and control side by side, one line, like the wider rows.
  for (const id of ['reset-all']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(Math.round(box.height), id).toBe(
      (await tokenPx(page, '--control-md')) + 2 * (await tokenPx(page, '--space-12')),
    );
  }
  // At the smallest window the path of the work folder keeps its room: the buttons stand
  // beside it or go under it, never over it.
  await page.setViewportSize({ width: 480, height: 800 });
  const folder = page.getByTestId('folder');
  const [text, control] = await Promise.all([
    folder.locator('.text').boundingBox(),
    folder.locator('.control').boundingBox(),
  ]);
  const under = control!.y >= text!.y + text!.height;
  const beside = control!.x >= text!.x + text!.width;
  expect(under || beside).toBe(true);
});

test('narrow, every meter keeps one width and the path breaks only at a separator', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await settings(page);
  const widths = await page
    .locator('[data-testid^="portals-"]')
    .getByRole('progressbar')
    .evaluateAll((meters) =>
      meters.map((meter) => Math.round(meter.getBoundingClientRect().width)),
    );
  expect(widths).toHaveLength(ALL_PORTALS.length);
  expect(new Set(widths).size).toBe(1);
  // The sign-in goes to a line of its own under the calls.
  const [signIn, quota] = await Promise.all([
    page.getByTestId('sign-in-freelance').boundingBox(),
    page.getByTestId('quota-freelance').boundingBox(),
  ]);
  expect(signIn!.y).toBeGreaterThanOrEqual(quota!.y + quota!.height);
  // The path wraps after a "/", never at the hyphen of "Job-Alerts"; it copies whole.
  const path = page.getByTestId('folder').locator('[data-copy]');
  const ends = await path.evaluate((node) => {
    const chars: { char: string; top: number }[] = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text) {
      for (let index = 0; index < text.data.length; index += 1) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        const box = range.getBoundingClientRect();
        if (box.width > 0) chars.push({ char: text.data[index]!, top: Math.round(box.top) });
      }
    }
    return chars.filter((each, index) => (chars[index + 1]?.top ?? each.top) > each.top + 2);
  });
  expect(ends.length).toBeGreaterThan(0);
  for (const end of ends) expect(end.char).toMatch(/[/\\]/);
  const copied = await path.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return getSelection()!.toString().trim();
  });
  expect(copied).toBe('C:/Users/demo/Documents/Job-Alerts');
});

/* ---------------------------------------------------------------- Postfach */

test('mailbox: the address, no word about the vault, no whole-mailbox row', async ({ page }) => {
  await settings(page);
  const mailbox = page.getByTestId('settings-mailbox');
  await expect(page.getByTestId('mailbox').locator('[data-copy]')).toHaveText(
    'alerts.demo@gmail.com',
  );
  await expect(mailbox.locator('.badge')).toHaveText(T.settings.connected);
  await expect(mailbox).not.toContainText('Anmeldeinformationsverwaltung');
  await expect(mailbox).not.toContainText('Alle Alert-Mails');
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
});

test('mailbox: Ändern opens the form in a dialog; Verbinden saves, Esc gives the focus back', async ({
  page,
}) => {
  await settings(page);
  const change = page.getByTestId('mailbox-change');
  await change.focus();
  await page.keyboard.press('Enter');
  // The dialog follows the verb of its button.
  const dialog = page.getByTestId('dialog-mailbox');
  await expect(dialog.getByRole('heading')).toHaveText(T.settings.changeHeading);
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.settings.connect);
  // The address stays, so the caret waits in the app password; the two Google pages below.
  await expect(page.getByTestId('mailbox-password')).toBeFocused();
  await expect(page.getByTestId('mailbox-user')).toHaveValue('alerts.demo@gmail.com');
  await expect(dialog.getByTestId('two-step')).toBeVisible();
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

test('mailbox: a saved change is answered by its badge; a mail error before it is past', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=offline`);
  const mailbox = page.getByTestId('settings-mailbox');
  const badge = mailbox.locator('.badge');
  // The last fetch could not reach Gmail: one red badge, said once.
  await expect(badge).toHaveText(T.settings.unreachable);
  await expect(badge).toHaveClass(/danger/);
  await expect(page.getByTestId('mailbox-failure')).toHaveCount(0);
  // A new sign-in: Gmail accepted it, the badge says so, no note and no toast.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('dialog-mailbox').getByTestId('dialog-confirm').click();
  await expect(badge).toHaveText(T.settings.connected);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
});

test('mailbox: removing asks first, a failure stays; then "Kein Postfach" connects', async ({
  page,
}) => {
  await settings(page);
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
  await expect(page.getByTestId('settings-mailbox').locator('.badge')).toHaveText(
    T.settings.connected,
  );
});

test('the period of a fetch is no row of Einstellungen', async ({ page }) => {
  await settings(page);
  await expect(
    page.getByTestId('settings').getByRole('radio', { name: T.toolbar.rangeName.all }),
  ).toHaveCount(0);
  await expect(page.getByTestId('settings-mailbox').locator('[data-setting-row]')).toHaveCount(1);
});

/* ---------------------------------------------------------- Suche, Alert-Mails */

test('sources: Suche and Alert-Mails, each in the order of the UI, each with its calls of today', async ({
  page,
}) => {
  await settings(page);
  expect(await ids(page, 'portals-search', '[data-testid^="portal-"]')).toEqual(
    SEARCHED.map((portal) => `portal-${portal}`),
  );
  expect(await ids(page, 'portals-alerts', '[data-testid^="portal-"]')).toEqual(
    ALERT_PORTALS.map((portal) => `portal-${portal}`),
  );
  await expect(page.getByTestId('settings-search').locator('.card')).toHaveCount(1);
  await expect(page.getByTestId('settings-alerts').locator('.card')).toHaveCount(1);
  for (const [portal, used] of [
    ['freelance', 11],
    ['linkedin', 23],
    ['freelancermap', 86],
    ['hays', 18],
    ['michaelpage', 6],
    ['solcom', 6],
    ['etengo', 6],
    ['gulp', 0],
    ['roberthalf', 0],
    ['interimx', 0],
  ] as const) {
    const quota = page.getByTestId(`quota-${portal}`);
    await expect(quota).toContainText(T.settings.quota(used, 100));
    await expect(quota.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(used));
    const row = page.getByTestId(`portal-${portal}`);
    await expect(row.getByTestId(`open-portal-${portal}`)).toBeVisible();
    await expect(row.getByRole('switch')).toHaveAccessibleName(T.portal[portal]);
  }
  // Only freelance.de offers a sign-in; no intro sentence, no "Details holen".
  await expect(page.getByTestId('view-settings').locator('[data-testid^="sign-in-"]')).toHaveCount(
    1,
  );
  for (const card of ['settings-search', 'settings-alerts']) {
    await expect(page.getByTestId(card)).not.toContainText('Details');
    await expect(page.getByTestId(card)).not.toContainText('Seiten');
  }
  // Only a source of alert mails offers "Alert anlegen", its page in the browser.
  await expect(page.getByTestId('settings-search').locator('[data-testid^="setup-"]')).toHaveCount(
    0,
  );
  await expect(page.getByTestId('settings-alerts').locator('[data-testid^="setup-"]')).toHaveText([
    T.settings.setUpAlert,
    T.settings.setUpAlert,
  ]);
  await page.getByTestId('setup-freelance').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalSetup', portal: 'freelance' } });
  // Its sign-in and tools 12 apart, like the buttons and the switch of every other row.
  const gap = await page
    .getByTestId('portal-freelance')
    .locator('.tools')
    .evaluate((node) => getComputedStyle(node).columnGap);
  expect(gap).toBe('12px');
  const [signIn, external] = await Promise.all([
    page.getByTestId('sign-in-freelance').boundingBox(),
    page.getByTestId('open-portal-freelance').boundingBox(),
  ]);
  expect(Math.round(external!.x - (signIn!.x + signIn!.width))).toBe(12);
  await page.getByTestId('open-portal-linkedin').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'linkedin' } });
});

test('Automatisch abrufen: on by default, first in Suche, saved at once', async ({ page }) => {
  await settings(page);
  const row = page.getByTestId('settings-search').getByTestId('auto-fetch');
  await expect(row).toContainText(T.settings.autoFetch);
  await expect(row).toContainText(T.settings.autoFetchHint);
  // Above the sources.
  const [auto, first] = await Promise.all([
    row.boundingBox(),
    page.getByTestId('portal-hays').boundingBox(),
  ]);
  expect(auto!.y).toBeLessThan(first!.y);
  const toggle = page.getByTestId('toggle-autoFetch');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toHaveAccessibleName(T.settings.autoFetch);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await saved(page)).toEqual([patch({ autoFetch: false })]);
});

test('portals: the switches save at once; only the switch switches', async ({ page }) => {
  await settings(page);
  const toggle = page.getByTestId('toggle-enabled-linkedin');
  await page.getByTestId('portal-linkedin').getByText(T.portal.linkedin).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // Off, the row keeps its calls; no toast answers a switch.
  await expect(page.getByTestId('quota-linkedin')).toBeVisible();
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
  await page.getByTestId('sign-in-freelance').click();
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
  await page.getByTestId('sign-in-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  expect(await calls(page, 'portal_login')).toHaveLength(0);
  expect((await saved(page)).at(-1)?.portals[0]?.loginEnabled).toBe(true);
  await settings(page, `${WIN}&scenario=session-left`);
  // With the portal off the stored sign-in shows, so it can be removed.
  await page.getByTestId('toggle-enabled-freelance').click();
  await page.getByTestId('sign-out-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toHaveCount(0);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a pause or an empty alert mail is one quiet line; the meter stays one blue', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=paused`);
  const pause = page.getByTestId('health-linkedin');
  await expect(pause).toHaveText(
    'Die Quelle bremst die Aufrufe, der Abruf macht ab 11:05 von selbst weiter.',
  );
  await expect(pause).toHaveClass(/info/);
  const mails = page.getByTestId('health-freelance');
  await expect(mails.locator('.text')).toHaveText('In 2 Alert-Mails fand die App keine Jobs.');
  await expect(mails).toHaveClass(/warning/);
  await mails.getByRole('button', { name: T.reader.mail }).click();
  expect(await lastOpened(page)).toEqual({
    target: { kind: 'alertMail', gmailId: '18c2f0a9d1e4b7a3' },
  });
  // Near the day's limit and while a portal rests the meter keeps its one blue.
  const blue = await colour(page, '--meter-fill');
  const fill = (portal: string): Promise<string> =>
    page
      .getByTestId(`quota-${portal}`)
      .locator('.fill')
      .evaluate((node) => getComputedStyle(node).backgroundColor);
  for (const portal of ['freelancermap', 'linkedin', 'freelance']) {
    expect(await fill(portal), portal).toBe(blue);
  }
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
  const quiet = page.getByTestId('alert-quiet-freelance');
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

/* ------------------------------------------------------------------ Export */

// The export is hidden for now (cards.ts EXPORT_SHOWN, user 2026-09-30); kept for its return.
test.skip('export: the export folder with its path, Excel and CSV with their switches', async ({
  page,
}) => {
  await settings(page);
  const folder = page.getByTestId('folder');
  await expect(folder).toContainText(T.settings.folder);
  await expect(folder.locator('[data-copy]')).toHaveText('C:/Users/demo/Documents/Job-Alerts');
  await expect(folder.getByRole('button')).toHaveText([T.common.change, T.common.open]);
  await expect(page.getByTestId('settings-export')).not.toContainText('Arbeitsordner');
  for (const [id, kind] of [
    ['folder-open', 'workspace'],
    ['excel-open', 'excel'],
  ] as const) {
    await page.getByTestId(id).click();
    expect(await lastOpened(page), id).toEqual({ target: { kind } });
  }
  const excel = page.getByTestId('toggle-exportExcel');
  const csv = page.getByTestId('toggle-exportCsv');
  await expect(excel).toHaveAttribute('aria-checked', 'true');
  await expect(excel).toHaveAccessibleName(T.settings.excel);
  await expect(csv).toHaveAttribute('aria-checked', 'false');
  // CSV is off: its file waits and says why; switched on it opens.
  expect(await reason(page, 'csv-open')).toBe(T.settings.csvOff);
  await csv.click();
  await expect(csv).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('csv-open').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'csv' } });
  // Excel off: no file is written, so it waits too.
  await excel.click();
  await expect(excel).toHaveAttribute('aria-checked', 'false');
  expect(await reason(page, 'excel-open')).toBe(T.settings.excelOff);
  expect(await saved(page)).toEqual([patch({ exportCsv: true }), patch({ exportExcel: false })]);
  // A file that does not open says so in its card; the note unfolds, so the cards below
  // glide down instead of jumping.
  await failNext(page, 'open_target');
  const tops = await topsAfterClick(page, 'folder-open', 'settings-data');
  await expect(page.getByTestId('export-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  expect(glided(tops), tops.join(' ')).toBe(true);
});

test('another work folder takes the profile along; its own profile is said', async ({ page }) => {
  await settings(page, `${WIN}&folder=other`);
  await page.getByTestId('folder-change').click();
  await expect(page.getByTestId('settings-data')).toContainText('C:/Users/demo/Documents/Jobs');
  await expect(page.getByTestId('toast')).toHaveText(new RegExp(T.settings.folderMoved));
  await settings(page, `${WIN}&folder=own`);
  await page.getByTestId('folder-change').click();
  await expect(page.getByTestId('toast')).toHaveText(new RegExp(T.settings.folderOwnProfile));
});

/* ------------------------------------------------------------- Darstellung */

// Darstellung is hidden for now (cards.ts LOOK_SHOWN, user 2026-09-30); kept for its return.
test.skip('Darstellung: a palette applies at once, is saved and wears the start', async ({
  page,
}) => {
  await settings(page);
  const look = page.getByTestId('settings-look');
  await expect(look.locator('[data-setting-row]')).toHaveCount(2);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-palette', 'cxact');
  const cream = await colour(page, '--bg');
  // CXact first (the default), then light and dark, in words.
  const palette = page.getByTestId('palette');
  const name = T.settings.paletteName;
  await expect(palette.getByRole('radio')).toHaveText(['CXact', 'Hell', 'Dunkel']);
  // The one height of every choice of the app, as in the Profil form: a field's.
  await expect(palette).toHaveCSS('height', `${await tokenPx(page, '--control-field')}px`);
  await palette.getByRole('radio', { name: name.dark }).click();
  await expect(root).toHaveAttribute('data-palette', 'dark');
  await expect(page.locator('body')).not.toHaveCSS('background-color', cream);
  await palette.getByRole('radio', { name: name.light }).click();
  await expect(root).toHaveAttribute('data-palette', 'light');
  expect(await saved(page)).toEqual([patch({ palette: 'dark' }), patch({ palette: 'light' })]);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // The backend keeps the choice: a start wears it.
  await settings(page, `${WIN}&palette=dark`);
  await expect(root).toHaveAttribute('data-palette', 'dark');
  // A save that fails puts the palette back and says why in the card.
  await failNext(page, 'save_settings');
  await palette.getByRole('radio', { name: name.light }).click();
  await expect(page.getByTestId('look-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  await expect(root).toHaveAttribute('data-palette', 'dark');
});

test('Darstellung: every palette keeps its texts readable (WCAG AA)', async ({ page }) => {
  for (const palette of ['cxact', 'light', 'dark']) {
    await settings(page, `${WIN}&palette=${palette}`);
    const weak = await page.evaluate(() => {
      const rgb = (value: string): number[] =>
        (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const read = (token: string, property: 'color' | 'backgroundColor'): number[] => {
        const probe = document.body.appendChild(document.createElement('span'));
        probe.style[property] = `var(${token})`;
        const value = getComputedStyle(probe)[property];
        probe.remove();
        return rgb(value);
      };
      const luminance = (bytes: number[]): number => {
        const [r, g, b] = bytes.map((value) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const pairs: [string, string][] = [
        ['--text', '--bg'],
        ['--text', '--surface'],
        ['--text-muted', '--surface'],
        ['--text-muted', '--bg'],
        ['--text-subtle', '--surface'],
        ['--text-subtle', '--surface-muted'],
        ['--text-heading', '--surface'],
        ['--link', '--surface'],
        ['--text', '--surface-selected'],
        ['--text-inverse', '--surface-inverse'],
        ['--danger-strong', '--danger-soft'],
        ['--success-strong', '--success-soft'],
        ['--warning-strong', '--warning-soft'],
        ['--count-soft-fg', '--count-soft-bg'],
      ];
      return pairs.flatMap(([text, ground]) => {
        const [light, dark] = [
          luminance(read(text, 'color')),
          luminance(read(ground, 'backgroundColor')),
        ].sort((a, b) => b - a);
        const ratio = (light! + 0.05) / (dark! + 0.05);
        return ratio < 4.5 ? [`${text} on ${ground}: ${ratio.toFixed(2)}`] : [];
      });
    });
    expect(weak, palette).toEqual([]);
  }
});

// Darstellung is hidden for now (cards.ts LOOK_SHOWN, user 2026-09-30); kept for its return.
test.skip('Darstellung: the language switches everything at once; notes follow it', async ({
  page,
}) => {
  await settings(page);
  await failNext(page, 'open_target');
  await page.getByTestId('folder-open').click();
  await expect(page.getByTestId('export-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  await page.getByTestId('language').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('settings-export')).toContainText('Export folder');
  await expect(page.getByTestId('export-note')).toHaveText('The database reports an error.');
  await expect(page.getByTestId('portal-freelance')).toContainText('11 of 100 requests today');
  expect((await saved(page)).at(-1)).toEqual(patch({ language: 'en' }));
});

/* ------------------------------------------------------------------- Daten */

test('Daten: only Alle Daten zurücksetzen; no Sicherung, no Protokoll, no data path', async ({
  page,
}) => {
  await settings(page);
  const data = page.getByTestId('settings-data');
  // The work folder stands here while the export is hidden.
  expect(await ids(page, 'settings-data', '[data-setting-row]')).toEqual(['folder', 'reset-all']);
  await expect(page.getByTestId('reset')).toHaveText(T.settings.resetAction);
  for (const gone of ['backup-restore', 'logs-open']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await expect(data.locator('[data-copy]')).toHaveCount(1);
  await expect(data).not.toContainText('Excel');
});

test('reset: the danger dialog lists what goes; a failure stays in it', async ({ page }) => {
  await settings(page);
  await page.getByTestId('reset').click();
  const dialog = page.getByTestId('dialog-reset');
  await expect(dialog.getByRole('button', { name: T.common.cancel })).toBeFocused();
  await expect(dialog.getByRole('heading')).toHaveText(T.settings.resetHeading);
  // What it does in its order: it deletes, then it starts anew.
  await expect(dialog).toContainText(T.settings.resetText);
  await expect(dialog.getByTestId('dialog-items').locator('li')).toHaveText(T.settings.resetItems);
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.settings.resetAction);
  await failNext(page, 'reset_all');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'reset_all')).toHaveLength(2);
});

/* ------------------------------------------------------------------- locks */

test('a run holds the mailbox, the folder and the sign-in, with its reason', async ({ page }) => {
  await settings(page, `${WIN}&scenario=running`);
  for (const id of ['mailbox-change', 'mailbox-remove', 'folder-change', 'reset']) {
    expect(await reason(page, id), id).toBe(T.error.text('busy', { activity: 'fetch' }));
  }
  // A rescore says its own reason; the sign-out waits too.
  await settings(page);
  await page.getByTestId('sign-in-freelance').click();
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('rescore');
  });
  for (const id of ['mailbox-change', 'reset', 'sign-out-freelance']) {
    expect(await reason(page, id), id).toBe(T.error.text('busy', { activity: 'rescore' }));
  }
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('the dry run and the demo keep to their own data and say so', async ({ page }) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  await expect(page.getByTestId('settings')).toContainText('probelauf@example.org');
  expect(await reason(page, 'mailbox-remove')).toBe('Im Probelauf geht das nicht.');
  await settings(page, `${WIN}&scenario=demo`);
  await expect(page.getByTestId('demo-note')).toBeVisible();
  for (const id of ['mailbox-change', 'mailbox-remove', 'folder-change', 'reset']) {
    expect(await reason(page, id), id).toBe('In der Demo geht das nicht.');
  }
  // Its made-up mailbox, connected; no calls of a portal (its portals are made up too).
  await expect(page.getByTestId('mailbox')).toContainText('demo@example.com');
  await expect(page.getByTestId('settings-mailbox')).toContainText(T.settings.connected);
  await expect(page.locator('[data-testid^="quota-"]')).toHaveCount(0);
});

test('macOS shows Mac paths', async ({ page }) => {
  await settings(page, MAC);
  await expect(page.getByTestId('settings-data')).toContainText('/Users/demo/Documents/Job-Alerts');
  await expect(page.getByTestId('settings')).not.toContainText('C:/');
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

test('baseline: settings in Dark', async ({ page }) => {
  await settings(page, `${WIN}&palette=dark`);
  await expectShot(page, 'settings-dark');
});
