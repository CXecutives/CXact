// Einstellungen and the first-run page (Erste Schritte) against the stub: the steps, the
// mailbox, the switches, the portals, the files, Darstellung (palettes and language), the
// keys, the maintenance rows and the reset.

import type { Page } from '@playwright/test';
import type { SettingsPatch } from '../../../ui/src/lib/ipc/types';
import {
  calls,
  expect,
  expectShot,
  open,
  runFinished,
  settle,
  test,
  visibleCount,
} from './fixtures';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

/* ------------------------------------------------------------------ helpers */

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
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
  autoArchiveDays: null,
  autoEmptyTrashDays: null,
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

/** The next call of `command` fails with `db` ("Die Datenbank meldet einen Fehler."). */
async function failNext(page: Page, command: string): Promise<void> {
  await page.evaluate((name) => {
    const calls = window.__harness.calls;
    const push = calls.push.bind(calls);
    calls.push = (...items: [string, unknown][]) => {
      if (items.some(([each]) => each === name)) {
        calls.push = push;
        push(...items);
        throw { kind: 'db', params: {} };
      }
      return push(...items);
    };
  }, command);
}

/** The tooltip of a locked button. */
async function reason(page: Page, testid: string): Promise<string | null> {
  const button = page.getByTestId(testid);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.hover();
  return page.getByRole('tooltip').textContent();
}

/* ---------------------------------------------------------------- first run */

test('first run: three steps that tick themselves, fetch locked until a mailbox', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await expect(page.getByTestId('first-run')).toBeVisible();
  expect(await visibleCount(page, '.btn.primary')).toBe(1);
  // The caret waits in the first field; the setup stands for Jobs in the sidebar.
  await expect(page.getByTestId('mailbox-user')).toBeFocused();
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  // What an app password needs, before anything is typed: one line under both fields, the
  // two pages in the order she needs them.
  const links = await page
    .getByTestId('mailbox-form')
    .locator('.help .btn')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(links).toEqual(['two-step', 'create-password']);
  await page.getByTestId('two-step').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'twoStepPage' } });
  // Empty fields are said at once, both, without asking Gmail.
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-form')).toContainText('Die Gmail-Adresse fehlt.');
  await expect(page.getByTestId('mailbox-form')).toContainText('Das App-Passwort fehlt.');
  await expect(page.getByTestId('mailbox-user')).toBeFocused();
  expect(await calls(page, 'save_mailbox')).toHaveLength(0);
  await expect(page.getByTestId('step-mailbox')).toContainText(
    'Die Alert-Mails von linkedin.com, freelance.de und freelancermap.de müssen an diese Gmail-Adresse gehen.',
  );
  expect(await reason(page, 'first-fetch')).toBe('Verbinde erst ein Postfach.');

  await page.getByTestId('mailbox-user').fill('alerts.demo');
  await page.getByTestId('mailbox-password').fill('abcdabcdabcdabcd');
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('mailbox-form')).toContainText('Die Adresse ist unvollständig.');
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('kurz');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(page.getByTestId('mailbox-form')).toContainText(
    'Ein App-Passwort hat 16 Buchstaben.',
  );
  await expect(page.getByTestId('step-mailbox')).toHaveAttribute('aria-current', 'step');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(page.getByTestId('step-mailbox')).toHaveAttribute('data-done', 'true');
  // The stepper moves on: the profile is the current step, the ticked check draws, the focus
  // waits on the next step's action.
  await expect(page.getByTestId('step-profile')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('step-mailbox').locator('.marker')).toHaveClass(/drawn/);
  await expect(page.getByTestId('first-profile')).toBeFocused();
  await expect(page.getByTestId('first-fetch')).not.toHaveAttribute('aria-disabled', 'true');
  // The address is text to copy; per portal what "Verbinden" found, or its page to set up an
  // alert where it found none.
  await expect(page.getByTestId('step-mailbox').locator('.done-text')).toHaveAttribute(
    'data-copy',
    '',
  );
  await expect(page.getByTestId('first-mails-linkedin')).toHaveText('20 Alert-Mails');
  await expect(page.getByTestId('first-mails-freelancermap')).toHaveText('14 Alert-Mails');
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveText(['Alert anlegen']);
  await page.getByTestId('first-alert-freelance').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'freelance' } });
  await expect(page.getByTestId('step-fetch')).toContainText('Alert-Mails der letzten 30 Tage');
});

test('first run: a step done before the page opened is simply there', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  const mailbox = page.getByTestId('step-mailbox');
  await expect(mailbox).toHaveAttribute('data-done', 'true');
  await expect(mailbox.locator('.marker')).not.toHaveClass(/drawn/);
  await expect(page.getByTestId('step-profile')).toHaveAttribute('aria-current', 'step');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // Connected in an earlier session: nothing counted, every portal offers its page.
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveCount(3);
});

test('first run: step 1 names the portals that are on; none on leads to Einstellungen', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('toggle-enabled-linkedin').click();
  await page.getByTestId('nav-jobs').click();
  const step = page.getByTestId('step-mailbox');
  await expect(step).toContainText(
    'Die Alert-Mails von freelance.de und freelancermap.de müssen an diese Gmail-Adresse gehen.',
  );
  await expect(page.getByTestId('first-no-portal')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('toggle-enabled-freelance').click();
  await page.getByTestId('toggle-enabled-freelancermap').click();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('first-no-portal')).toHaveText('Schalte erst ein Portal ein.');
  await expect(step).not.toContainText('müssen an diese Gmail-Adresse gehen');
  await page.getByTestId('first-open-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  // In English the same, and "in Gmail" never breaks apart in the intro.
  await open(page, `${WIN}&scenario=first-run&lang=en`);
  await expect(page.getByTestId('step-mailbox')).toContainText(
    'The alert emails from linkedin.com, freelance.de and freelancermap.de must go to this Gmail address.',
  );
  expect(await page.getByTestId('first-run').locator('.benefit').textContent()).toContain(
    'in Gmail',
  );
});

test('first run: no alert mail in 30 days says to set up an alert first', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run&alerts=none`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('first-no-alerts')).toHaveText(
    'In den letzten 30 Tagen kam keine Alert-Mail an, leg erst einen Alert an.',
  );
  await expect(page.getByTestId('step-fetch')).not.toContainText('dauert ein paar Minuten');
});

test('first run: step 2 opens the CV steps, "Profil anlegen" the empty form', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  const step = page.getByTestId('step-profile');
  await expect(step.getByTestId('first-profile')).toHaveText('Aus Lebenslauf anlegen');
  await step.getByTestId('first-profile').click();
  const paste = page.getByTestId('profile-paste');
  await expect(paste).toBeVisible();
  await expect(paste.getByRole('heading', { level: 2 })).toHaveText('Aus Lebenslauf anlegen');
  await page.getByTestId('paste-cancel').click();
  await page.getByTestId('nav-jobs').click();
  // The empty form is the second way, named as the Profil view names it.
  const create = page.getByTestId('first-profile-form');
  await expect(create).toHaveText('Profil anlegen');
  await create.click();
  await page.getByTestId('competence-name').fill('Controlling');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-name')).toHaveText('Profil ohne Namen');
  await page.getByTestId('nav-jobs').click();
  await expect(step).toHaveAttribute('data-done', 'true');
  await expect(step.locator('.done-text')).toHaveText('Profil ohne Namen');
});

test('first run: a profile that does not count keeps step 2 open and says why', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run-empty-profile`);
  await expect(page.getByTestId('step-profile')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('first-profile')).toHaveClass(/primary/);
  await expect(page.getByTestId('first-fetch')).not.toHaveClass(/primary/);
  const problem = page.getByTestId('first-profile-problem');
  await expect(problem).toHaveText('Ohne Kompetenzen wird nichts bewertet.');
  await expect(problem.locator('svg')).toHaveCount(1);
  // In the size of every step's sentence, 4 px under its name, in the tone of a warning.
  const hint = page.getByTestId('step-fetch').locator('.hint');
  for (const property of ['font-size', 'line-height']) {
    const value = await hint.evaluate(
      (node, name) => getComputedStyle(node).getPropertyValue(name),
      property,
    );
    await expect(problem).toHaveCSS(property, value);
  }
  await expect(problem).toHaveCSS('color', await colour(page, '--warning-strong'));
  const gap = await page.getByTestId('step-fetch').evaluate((node) => {
    const name = node.querySelector('.name')!.getBoundingClientRect();
    return node.querySelector('.hint')!.getBoundingClientRect().top - name.bottom;
  });
  expect(gap).toBe(4);
  const openProfile = page.getByTestId('first-profile');
  await expect(openProfile).toHaveText('Profil öffnen');
  await expect(openProfile.locator('[data-icon]')).toHaveAttribute('data-icon', 'document');
});

test('first run: Einstellungen and Profil open, Jobs leads back to the setup', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  const nav = page.getByTestId('sidebar').locator('nav');
  await expect(nav.locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  // The language can be chosen before anything is set up.
  await page.getByTestId('language').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('nav-settings')).toContainText('Settings');
  await page.getByTestId('language').getByRole('radio', { name: 'Deutsch' }).click();
  await expect(page.getByTestId('nav-settings')).toContainText('Einstellungen');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await expect(page.locator('[data-testid^="nav-"][aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await expect(
    page
      .getByTestId('first-run')
      .getByTestId('mailbox-form')
      .locator('.help')
      .getByTestId('create-password'),
  ).toBeVisible();
});

test('first run: after the first fetch the list opens on its inbox', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  await page.getByTestId('first-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await page.getByTestId('first-fetch').click();
  await runFinished(page);
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByTestId('job-rows').locator('[data-testid^="job-row-"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId('excluded-rows')).toHaveCount(0);
});

test('first run: a failed first fetch keeps the page, says why, and no run status', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-fetch-failed`);
  const step = page.getByTestId('step-fetch');
  await expect(step).toContainText('30 Tage');
  await expect(step.getByTestId('first-fetch-failed')).toBeVisible();
  // The setup page says it itself: the sidebar keeps no run status here, only elsewhere.
  await expect(page.getByTestId('run-status')).toHaveCount(0);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('run-status')).toBeVisible();
  await page.getByTestId('nav-jobs').click();
  // Abrufen again completes and ends the setup.
  await page.getByTestId('first-fetch').click();
  await expect(page.getByTestId('first-run')).toHaveCount(0, { timeout: 15_000 });
});

test('first run: the three steps are in view at 1280 x 720 on both systems', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  /** How far a control ends below the bottom of the view (0 or less: in view). */
  const below = (id: string): Promise<number> =>
    page.getByTestId(id).evaluate((node) => {
      const view = node.closest('.view')!.getBoundingClientRect();
      return node.getBoundingClientRect().bottom - view.bottom;
    });
  for (const platform of ['windows', 'macos']) {
    await open(page, `?platform=${platform}&scenario=first-run`);
    expect(await below('first-fetch')).toBeLessThanOrEqual(0);
    // After a reset that left something its warning stands above: the action is in view.
    await open(page, `?platform=${platform}&scenario=reset`);
    expect(await below('mailbox-save')).toBeLessThanOrEqual(0);
  }
});

test('first run: its card lines up with the cards of the views it leads to', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  for (const platform of ['windows', 'macos']) {
    await open(page, `?platform=${platform}&scenario=mailbox-only`);
    const first = await page.getByTestId('first-run').locator('.card').first().boundingBox();
    await settings(page, `?platform=${platform}`);
    const card = await page.getByTestId('settings-mailbox').locator('.card').first().boundingBox();
    expect(first?.x).toBe(card?.x);
    expect(first?.width).toBe(card?.width);
  }
});

test('first run: it opens at its top, the caret waiting in the address', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  for (const query of [`${WIN}&scenario=reset&lang=en`, `${MAC}&scenario=first-run`]) {
    await open(page, query);
    const user = page.getByTestId('mailbox-user');
    await expect(user).toBeFocused();
    // The mark and the title are in view, and after a reset its warning (WebKit scrolled to a
    // field focused too early a moment later: wait for that moment).
    await page.waitForTimeout(200);
    const top = await page
      .getByTestId('first-run')
      .evaluate((node) => node.closest('.view')?.scrollTop ?? -1);
    expect(top).toBe(0);
    if (query.includes('reset')) {
      await expect(page.getByTestId('first-reset-report')).toBeInViewport({ ratio: 1 });
    }
    await page.keyboard.type('alerts');
    await expect(user).toHaveValue('alerts');
    await expect(user).toBeInViewport();
  }
});

test('first run: a refused app password says so in the form', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('fals chfa lsch fals');
  await page.getByTestId('mailbox-password').press('Enter');
  // Said once above the button; both fields are marked, since either may be wrong.
  await expect(page.getByTestId('mailbox-error')).toHaveText(
    'Gmail lehnt Adresse oder App-Passwort ab.',
  );
  for (const id of ['mailbox-user', 'mailbox-password']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-invalid', 'true');
  }
  await expect(page.getByTestId('step-mailbox')).toHaveAttribute('data-done', 'false');
});

test('reset: a clean one says so once; one that left something warns with the log', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=reset&reset=clean`);
  await expect(page.getByTestId('toast')).toHaveText(/Die App ist zurückgesetzt\./);
  await expect(page.getByTestId('first-reset-report')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('toast')).toHaveCount(1);

  await open(page, `${WIN}&scenario=reset`);
  const report = page.getByTestId('first-reset-report');
  await expect(report).toContainText(
    'Die App ist zurückgesetzt, 1 Element ließ sich nicht löschen.',
  );
  await expect(report).toHaveClass(/warning/);
  // What stays behind need not be a file (the app password, a sign-in).
  await expect(report).not.toContainText('Datei');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // What stayed is named in the log.
  const log = report.getByRole('button', { name: 'Protokoll öffnen' });
  await expect(log.locator('[data-icon]')).toHaveAttribute('data-icon', 'folder');
  await log.click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'logDir' } });
  // A folder that does not open says so in its place.
  await failNext(page, 'open_target');
  await log.click();
  await expect(page.getByTestId('open-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  await expect(page.getByTestId('step-mailbox')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('step-profile')).toHaveAttribute('data-done', 'false');
});

/* ------------------------------------------------------------ Einstellungen */

test('settings: the cards in their order, the first heading on the first row', async ({ page }) => {
  await settings(page);
  const cards = await page
    .getByTestId('settings')
    .locator(':scope > section')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(cards).toEqual([
    'settings-mailbox',
    'settings-fetch',
    'settings-portals',
    'settings-files',
    'settings-look',
    'settings-keys',
    'settings-care',
    'settings-reset',
  ]);
  // "Abrufen" lives in the Jobs view: nothing here asks for a primary.
  expect(await visibleCount(page, '.btn.primary')).toBe(0);
  await expect(page.getByTestId('settings-mailbox')).toContainText('alerts.demo@gmail.com');
  // "Postfach" stands on the first row, as the sidebar's first entry (macOS too).
  for (const query of [WIN, MAC]) {
    await settings(page, query);
    const row = page.getByTestId('settings-mailbox').locator('[data-first-row]');
    await expect(row).toContainText('Postfach');
    const middle = (box: { y: number; height: number } | null): number =>
      box === null ? -1 : box.y + box.height / 2;
    expect(middle(await row.boundingBox())).toBe(
      middle(await page.getByTestId('nav-overview').boundingBox()),
    );
  }
});

test('button styles: the row changes its own value in secondary, the rest is quiet', async ({
  page,
}) => {
  await settings(page);
  for (const id of ['mailbox-change', 'full-mailbox', 'workspace-change', 'sign-in-freelance']) {
    await expect(page.getByTestId(id), id).toHaveClass(/secondary/);
  }
  for (const id of [
    'mailbox-remove',
    'workspace-open',
    'excel-open',
    'excel-reveal',
    'overview-open',
    'overview-reveal',
    'txt-rewrite',
    'txt-reveal',
    'txt-clear',
    'logs-open',
    'data-open',
    'reset',
  ]) {
    await expect(page.getByTestId(id), id).toHaveClass(/ghost/);
  }
  const glyph = (id: string) => page.getByTestId(id).locator('[data-icon]');
  for (const [id, icon] of [
    ['mailbox-change', 'edit'],
    ['mailbox-remove', 'purge'],
    ['full-mailbox', 'fetch'],
    ['workspace-change', 'edit'],
    ['excel-open', 'excel'],
    ['txt-rewrite', 'rewrite'],
    ['txt-reveal', 'folder'],
    ['txt-clear', 'trash'],
    ['logs-open', 'folder'],
    ['reset', 'reset'],
  ] as const) {
    await expect(glyph(id), id).toHaveAttribute('data-icon', icon);
  }
  // Only what loses something for good warns on hover (it asks first); the text files can
  // be written again.
  const danger = await colour(page, '--danger-strong');
  for (const [id, warns] of [
    ['mailbox-remove', true],
    ['reset', true],
    ['txt-clear', false],
  ] as const) {
    const button = page.getByTestId(id);
    await button.hover();
    if (warns) await expect(button, id).toHaveCSS('color', danger);
    else await expect(button, id).not.toHaveCSS('color', danger);
  }
  // Every button of the page is at most 32 px high.
  const heights = await page
    .getByTestId('settings')
    .locator('button:not([role="switch"]):not([role="radio"])')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(heights.filter((height) => height > 32)).toEqual([]);
});

test('mailbox: Ändern opens the form, Esc and Abbrechen give the focus back', async ({ page }) => {
  await settings(page);
  const change = page.getByTestId('mailbox-change');
  const password = page.getByTestId('mailbox-password');
  // The address stays, so the caret waits in the app password; one primary, save.
  await change.focus();
  await page.keyboard.press('Enter');
  await expect(password).toBeFocused();
  await expect(page.getByTestId('mailbox-user')).toHaveValue('alerts.demo@gmail.com');
  expect(await visibleCount(page, '.btn.primary')).toBe(1);
  await expect(page.getByTestId('mailbox-save')).toHaveClass(/primary/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mailbox-form')).toHaveCount(0);
  await expect(change).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(password).toBeFocused();
  await page.getByTestId('mailbox-cancel').focus();
  await page.keyboard.press('Enter');
  await expect(change).toBeFocused();
});

test('mailbox: save and cancel follow the OS and end on the edge, 32 px like the fields', async ({
  page,
}) => {
  for (const [query, order] of [
    [WIN, ['mailbox-save', 'mailbox-cancel']],
    [MAC, ['mailbox-cancel', 'mailbox-save']],
  ] as const) {
    await settings(page, query);
    await page.getByTestId('mailbox-change').click();
    const place = await page.evaluate(() => {
      const box = (selector: string): DOMRect =>
        document.querySelector(selector)!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll('[data-testid="mailbox-form"] .actions .btn')];
      const boxes = buttons.map((node) => node.getBoundingClientRect());
      return {
        order: buttons.map((node) => node.getAttribute('data-testid')),
        end: boxes.at(-1)!.right,
        gap: boxes[1]!.left - boxes[0]!.right,
        heights: boxes.map((each) => Math.round(each.height)),
        // A switch of the next card ends on the content edge of the column.
        edge: box('[data-testid="toggle-auto-archive"]').right,
        fields: box('[data-testid="mailbox-form"] .fields').width,
      };
    });
    expect(place.order).toEqual(order);
    expect(Math.abs(place.end - place.edge)).toBeLessThanOrEqual(1);
    expect(place.gap).toBe(12);
    expect(place.heights).toEqual([32, 32]);
    expect(place.fields).toBeLessThanOrEqual(560);
  }
});

test('mailbox: a saved change is answered by its badge; a mail error before it is past', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=offline`);
  const mailbox = page.getByTestId('settings-mailbox');
  const badge = mailbox.locator('.badge');
  // The last fetch could not reach Gmail: one red badge, said once.
  await expect(badge).toHaveText('Nicht erreichbar');
  await expect(badge).toHaveClass(/danger/);
  await expect(mailbox).not.toContainText('Gmail ist nicht erreichbar.');
  await expect(page.getByTestId('mailbox-failure')).toHaveCount(0);
  // A new sign-in: Gmail accepted it, the badge says so, no note and no toast.
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-save').click();
  await expect(badge).toHaveText('Verbunden');
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await expect(mailbox.locator('.notice')).toHaveCount(0);
  // It stays so after the view was left (the time of the sign-in is the backend's).
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-mailbox').locator('.badge')).toHaveText('Verbunden');
});

test('mailbox: removing asks first; a failure stays in the dialog, which tries again', async ({
  page,
}) => {
  await settings(page);
  await page.getByTestId('mailbox-remove').click();
  const dialog = page.getByTestId('dialog-remove-mailbox');
  await failNext(page, 'remove_mailbox');
  await dialog.getByRole('button', { name: 'Entfernen' }).click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  await dialog.getByRole('button', { name: 'Entfernen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('mailbox-form')).toBeVisible();
  expect(await calls(page, 'remove_mailbox')).toHaveLength(2);
  // Without a mailbox there is nothing to fetch every alert mail from: the row goes.
  await expect(page.getByTestId('full-mailbox')).toHaveCount(0);
});

test('mailbox: fetching every alert mail asks first, then shows the run', async ({ page }) => {
  await settings(page);
  await page.getByTestId('full-mailbox').click();
  const dialog = page.getByTestId('dialog-full-mailbox');
  await expect(dialog.getByTestId('dialog-confirm')).toHaveText('Abrufen');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  const started = await calls(page, 'start_run');
  expect((started[0]?.[1] as { request: unknown }).request).toEqual({ kind: 'fullMailbox' });
});

test('switches: they move at once, save alone and are their own answer', async ({ page }) => {
  await settings(page);
  const archive = page.getByTestId('toggle-auto-archive');
  const trash = page.getByTestId('toggle-auto-empty-trash');
  const fetch = page.getByTestId('settings-fetch');
  await expect(fetch).toContainText('Jobs nach 30 Tagen archivieren');
  await expect(fetch).toContainText('Favoriten werden nie archiviert.');
  await expect(fetch).toContainText('Papierkorb nach 30 Tagen leeren');
  await expect(fetch).toContainText('Jobs im Papierkorb werden dann endgültig gelöscht.');
  await expect(fetch.getByRole('switch')).toHaveCount(2);
  await archive.click();
  await expect(archive).toHaveAttribute('aria-checked', 'false');
  await archive.click();
  await expect(archive).toHaveAttribute('aria-checked', 'true');
  await trash.click();
  await expect(trash).toHaveAttribute('aria-checked', 'false');
  expect(await saved(page)).toEqual([
    patch({ autoArchiveDays: 0 }),
    patch({ autoArchiveDays: 30 }),
    patch({ autoEmptyTrashDays: 0 }),
  ]);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('switches: only the switch switches, like the system settings; its text names it', async ({
  page,
}) => {
  await settings(page);
  const auto = page.getByTestId('toggle-auto-archive');
  await page.getByTestId('settings-fetch').getByText('Jobs nach 30 Tagen archivieren').click();
  await page.getByTestId('settings-fetch').getByText('Favoriten werden nie archiviert.').click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  const details = page.getByTestId('toggle-details-linkedin');
  await page.getByTestId('details-linkedin').getByText('Details holen').click();
  await expect(details).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('portal-linkedin').getByText('linkedin.com').click();
  await expect(page.getByTestId('toggle-enabled-linkedin')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Jobs nach 30 Tagen archivieren' })).toHaveCount(1);
  await expect(auto).toHaveAccessibleDescription('Favoriten werden nie archiviert.');
  await details.click();
  await expect(details).toHaveAttribute('aria-checked', 'false');
  // No label element anywhere on the page: no text is a click target of a switch.
  await expect(page.getByTestId('settings').locator('label')).toHaveCount(0);
});

test('portals: the switches save at once; an inactive portal says so and hides its rows', async ({
  page,
}) => {
  await settings(page);
  await expect(page.getByTestId('portals-hint')).toHaveText(
    'Ohne „Details holen“ bekommen die Jobs eines Portals keine Passung.',
  );
  await expect(page.getByTestId('details-linkedin').locator('.hint')).toHaveCount(0);
  const toggle = page.getByTestId('toggle-enabled-linkedin');
  await expect(toggle).toHaveAccessibleName('linkedin.com');
  // Described only while its "off" note shows; every reference names a text that is there.
  await expect(toggle).not.toHaveAttribute('aria-describedby', /./);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('portal-off-linkedin')).toHaveText('Wird beim Abruf übersprungen.');
  await expect(toggle).toHaveAccessibleDescription('Wird beim Abruf übersprungen.');
  await expect(page.getByTestId('toggle-details-linkedin')).toHaveCount(0);
  await expect(page.getByTestId('toggle-details-freelancermap')).toBeVisible();
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
  await expect(page.getByTestId('toast')).toHaveCount(0);
  expect(await saved(page)).toEqual([
    patch({
      portals: [{ portal: 'linkedin', enabled: false, fetchDetails: null, loginEnabled: null }],
    }),
  ]);
});

test('portals: one sign-in row; freelance.de signs in and out', async ({ page }) => {
  await settings(page);
  await expect(page.getByTestId('toggle-login-freelance')).toHaveCount(0);
  const session = page.getByTestId('session-freelance');
  await expect(session).toContainText('Anmeldung');
  await expect(session).toContainText('Zeigt ganze Anzeigen.');
  for (const word of ['Graubereich', 'Kontorisiko', 'Geringes Risiko']) {
    await expect(page.getByTestId('settings-portals')).not.toContainText(word);
  }
  await page.getByTestId('sign-in-freelance').click();
  await expect(session.locator('.badge')).toHaveText('Angemeldet');
  await page.getByTestId('sign-out-freelance').click();
  await expect(session.locator('.badge')).toHaveCount(0);
  const logins = (await saved(page)).map((each) => each.portals[0]?.loginEnabled);
  expect(logins).toEqual([true, false]);
  // Details off: no page is fetched, so signing in waits and says why.
  await page.getByTestId('toggle-details-freelance').click();
  expect(await reason(page, 'sign-in-freelance')).toBe('Schalte erst „Details holen“ ein.');
  expect(await calls(page, 'portal_login')).toHaveLength(1);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: a stored sign-in the fetch does not use looks like none until it is used', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=session-left`);
  const session = page.getByTestId('session-freelance');
  await expect(session.locator('.badge')).toHaveCount(0);
  // Anmelden only lets the fetch use the stored sign-in: no sign-in window.
  await page.getByTestId('sign-in-freelance').click();
  await expect(session.locator('.badge')).toHaveText('Angemeldet');
  expect(await calls(page, 'portal_login')).toHaveLength(0);
  expect((await saved(page)).at(-1)?.portals[0]?.loginEnabled).toBe(true);
  await settings(page, `${WIN}&scenario=session-left`);
  // With the portal off the stored sign-in shows, so it can be removed.
  await page.getByTestId('toggle-enabled-freelance').click();
  await expect(session.locator('.badge')).toHaveText('Angemeldet');
  await page.getByTestId('sign-out-freelance').click();
  await expect(page.getByTestId('sign-out-freelance')).toHaveCount(0);
  expect(await calls(page, 'portal_logout')).toHaveLength(1);
});

test('portals: quota only from 80 %, pauses with reason and end, details off', async ({ page }) => {
  await settings(page);
  const freelancermap = page.getByTestId('quota-freelancermap');
  await expect(freelancermap).toContainText('Heute 86 von 100 Seiten');
  await expect(freelancermap.getByRole('progressbar')).toBeVisible();
  await expect(page.getByTestId('quota-linkedin')).toHaveText('Heute 23 von 80 Seiten');
  await expect(page.getByTestId('quota-linkedin').getByRole('progressbar')).toHaveCount(0);
  const order = await page
    .getByTestId('portal-freelancermap')
    .evaluate((card) =>
      [...card.querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid')),
    );
  expect(order.indexOf('status-freelancermap')).toBeGreaterThan(
    order.indexOf('details-freelancermap'),
  );
  // Details off: no page counts.
  await page.getByTestId('toggle-details-freelancermap').click();
  await expect(page.getByTestId('quota-freelancermap')).toHaveCount(0);
  await expect(page.getByTestId('status-freelancermap')).toHaveCount(0);

  await settings(page, `${WIN}&scenario=paused`);
  const pause = page.getByTestId('health-linkedin');
  await expect(pause).toHaveText(
    'Das Portal bremst die Anfragen, der Abruf macht ab 11:05 von selbst weiter.',
  );
  await expect(pause).toHaveClass(/info/);
  await expect(pause.getByRole('button')).toHaveCount(0);
  const mails = page.getByTestId('health-freelance');
  await expect(mails.locator('.text')).toHaveText('In 2 Alert-Mails fand die App keine Jobs.');
  await expect(mails).toHaveClass(/warning/);
  await mails.getByRole('button', { name: 'Alert-Mail öffnen' }).click();
  expect(await lastOpened(page)).toEqual({
    target: { kind: 'alertMail', gmailId: '18c2f0a9d1e4b7a3' },
  });
  const quota = page.getByTestId('quota-freelancermap');
  await expect(quota).toContainText('Diese Stunde 38 von 40 Seiten');
  await expect(quota.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^9[45]/);
  // A pause concerns the pages: it goes with the details; mails without jobs stay.
  await page.getByTestId('toggle-details-linkedin').click();
  await expect(page.getByTestId('health-linkedin')).toHaveCount(0);
  await page.getByTestId('toggle-details-freelance').click();
  await expect(page.getByTestId('health-freelance')).toBeVisible();
});

test('files: every row opens its file and its folder; the path at the work folder', async ({
  page,
}) => {
  await settings(page);
  const files = page.getByTestId('settings-files');
  await expect(files.locator('[data-copy]')).toHaveCount(1);
  await expect(files.locator('[data-copy]')).toHaveText('C:/Users/demo/Documents/Job-Alerts');
  await expect(page.getByTestId('excel')).not.toContainText('JobAlerts.xlsx');
  for (const row of ['excel', 'overview']) {
    await expect(page.getByTestId(row).getByRole('button')).toHaveText(['Öffnen', 'Ordner öffnen']);
  }
  await expect(page.getByTestId('txt').getByRole('button')).toHaveText([
    'Neu schreiben',
    'Ordner öffnen',
    'Löschen',
  ]);
  await expect(page.getByTestId('txt')).toContainText('38 Anzeigen als Text für eine KI');
  for (const [id, kind] of [
    ['excel-open', 'excel'],
    ['excel-reveal', 'excelInFolder'],
    ['overview-open', 'overview'],
    ['overview-reveal', 'overviewInFolder'],
    ['txt-reveal', 'txtDir'],
    ['workspace-open', 'workspace'],
    ['logs-open', 'logDir'],
    ['data-open', 'dataDir'],
  ] as const) {
    await page.getByTestId(id).click();
    expect(await lastOpened(page), id).toEqual({ target: { kind } });
  }
  await expect(page.getByTestId('logs-open')).toHaveText('Ordner öffnen');
  await expect(page.getByTestId('version')).toContainText('3.0.0');
  // A folder that does not open says so in its card.
  await failNext(page, 'open_target');
  await page.getByTestId('excel-reveal').click();
  await expect(page.getByTestId('files-note')).toHaveText('Die Datenbank meldet einen Fehler.');
});

test('files: before the first fetch they wait and say why; their folders open', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=first-run`);
  expect(await reason(page, 'excel-open')).toBe('Die Excel-Datei entsteht beim ersten Abruf.');
  expect(await reason(page, 'overview-open')).toBe('Der Bericht entsteht beim ersten Abruf.');
  expect(await reason(page, 'txt-rewrite')).toBe('Die Textdateien entstehen beim ersten Abruf.');
  expect(await reason(page, 'txt-reveal')).toBe('Es gibt keine Textdateien.');
  expect(await reason(page, 'txt-clear')).toBe('Es gibt keine Textdateien.');
  for (const id of ['excel-reveal', 'overview-reveal', 'workspace-open']) {
    await expect(page.getByTestId(id), id).not.toHaveAttribute('aria-disabled', 'true');
  }
  // A work folder without files after a fetch: the Excel file waits, the rest works.
  await settings(page, `${WIN}&scenario=no-files`);
  expect(await reason(page, 'excel-open')).toBe('Die Excel-Datei entsteht beim ersten Abruf.');
  await expect(page.getByTestId('txt-rewrite')).not.toHaveAttribute('aria-disabled', 'true');
});

test('files: text files are written again with a toast, deleted with an undo', async ({ page }) => {
  await settings(page);
  await page.getByTestId('txt-rewrite').click();
  await expect(page.getByTestId('toast')).toHaveText(/Textdateien neu geschrieben\./);
  await expect(page.getByTestId('files-note')).toHaveCount(0);
  // Deleting asks nothing (it can be undone): a toast with its undo.
  await page.getByTestId('txt-clear').click();
  await expect(page.getByTestId('dialog-clear')).toHaveCount(0);
  const toast = page.getByTestId('toast').filter({ hasText: 'Textdateien gelöscht.' });
  await expect(toast).toBeVisible();
  await expect(page.getByTestId('txt')).toContainText('0 Anzeigen als Text für eine KI');
  await expect(page.getByTestId('txt-clear')).toHaveAttribute('aria-disabled', 'true');
  await toast.getByTestId('toast-action').click();
  await expect(page.getByTestId('txt')).toContainText('38 Anzeigen als Text für eine KI');
  expect(await calls(page, 'rewrite_txt')).toHaveLength(2);
  // Nothing to write yet: the toast says so.
  await settings(page, `${WIN}&scenario=empty`);
  await page.getByTestId('txt-rewrite').click();
  await expect(page.getByTestId('toast')).toHaveText(
    /Es gibt noch keine Anzeige mit ganzem Text\./,
  );
});

test('files: another work folder takes the profile along; its own profile is said', async ({
  page,
}) => {
  await settings(page, `${WIN}&folder=other`);
  await page.getByTestId('workspace-change').click();
  const files = page.getByTestId('settings-files');
  await expect(files).toContainText('C:/Users/demo/Documents/Jobs');
  await expect(page.getByTestId('toast')).toHaveText(
    /Profil und Dateien liegen jetzt im neuen Ordner\./,
  );
  await expect(page.getByTestId('files-note')).toHaveCount(0);
  await expect(files).toContainText('38 Anzeigen als Text für eine KI');
  await settings(page, `${WIN}&folder=own`);
  await page.getByTestId('workspace-change').click();
  await expect(page.getByTestId('toast')).toHaveText(
    /Die App nutzt jetzt das Profil aus diesem Ordner\./,
  );
});

test('Darstellung: a palette applies at once, is saved and wears the start', async ({ page }) => {
  await settings(page);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-palette', 'coast');
  const cream = await colour(page, '--bg');
  const palette = page.getByTestId('palette');
  await expect(palette.getByRole('radio')).toHaveText(['Coast', 'Light', 'Dark']);
  await palette.getByRole('radio', { name: 'Dark' }).click();
  await expect(root).toHaveAttribute('data-palette', 'dark');
  await expect(page.locator('body')).not.toHaveCSS('background-color', cream);
  expect(await colour(page, '--bg')).toBe('rgb(1, 4, 9)');
  await palette.getByRole('radio', { name: 'Light' }).click();
  await expect(root).toHaveAttribute('data-palette', 'light');
  expect(await colour(page, '--surface')).toBe('rgb(255, 255, 255)');
  expect(await saved(page)).toEqual([patch({ palette: 'dark' }), patch({ palette: 'light' })]);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // The backend keeps the choice: a start wears it (the window too, which is the backend's).
  await settings(page, `${WIN}&palette=dark`);
  await expect(root).toHaveAttribute('data-palette', 'dark');
  await expect(palette.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // A save that fails puts the palette back and says why in the card.
  await failNext(page, 'save_settings');
  await palette.getByRole('radio', { name: 'Coast' }).click();
  await expect(page.getByTestId('look-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  await expect(root).toHaveAttribute('data-palette', 'dark');
});

test('Darstellung: every palette keeps its texts readable (WCAG AA)', async ({ page }) => {
  for (const palette of ['coast', 'light', 'dark']) {
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
  // Light and Dark also keep the text on the filled buttons readable.
  for (const palette of ['light', 'dark']) {
    await settings(page, `${WIN}&palette=${palette}`);
    await page.getByTestId('mailbox-change').click();
    const save = page.getByTestId('mailbox-save');
    const [fg, bg] = await save.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor];
    });
    const ratio = await page.evaluate(
      ([a, b]) => {
        const lum = (value: string): number => {
          const [r, g, bl] = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
            const c = Number(part) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
        };
        const [x, y] = [lum(a!), lum(b!)].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      },
      [fg, bg],
    );
    expect(ratio, palette).toBeGreaterThanOrEqual(4.5);
  }
});

test('Darstellung: the language switches everything at once; notes follow it', async ({ page }) => {
  await settings(page);
  // An error in its card and the errors of the open mailbox form.
  await failNext(page, 'open_target');
  await page.getByTestId('excel-reveal').click();
  await expect(page.getByTestId('files-note')).toHaveText('Die Datenbank meldet einen Fehler.');
  await page.getByTestId('mailbox-change').click();
  await page.getByTestId('mailbox-user').fill('');
  await page.getByTestId('mailbox-save').click();
  const form = page.getByTestId('mailbox-form');
  await expect(form).toContainText('Die Gmail-Adresse fehlt.');
  // No hint under the language: Excel file and report follow by themselves.
  await expect(page.getByTestId('row-language').locator('.hint')).toHaveCount(0);
  await page.getByTestId('language').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('settings-files')).toContainText('Files');
  await expect(page.getByTestId('files-note')).toHaveText('The database reports an error.');
  await expect(form).toContainText('The Gmail address is missing.');
  await expect(form).toContainText('The app password is missing.');
  expect((await saved(page)).at(-1)).toEqual(patch({ language: 'en' }));
});

test('keys: Einstellungen and the card of the keys show one list, named per OS', async ({
  page,
}) => {
  const rows = async (scope: string): Promise<string[]> =>
    page
      .getByTestId(scope)
      .locator('[data-testid^="key-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  for (const [query, views, fetch] of [
    [WIN, 'Strg+1 bis Strg+4', 'F5'],
    [MAC, '⌘1 bis ⌘4', '⌘R'],
  ] as const) {
    await settings(page, query);
    const keys = page.getByTestId('settings-keys');
    await expect(keys.getByRole('heading', { level: 2 })).toHaveText('Tastenkürzel');
    await expect(keys.getByRole('heading', { level: 3 })).toHaveText([
      'Überall',
      'In der Jobliste',
    ]);
    await expect(keys.getByTestId('key-views').locator('dd')).toHaveText(views);
    await expect(keys.getByTestId('key-fetch').locator('dd')).toHaveText(fetch);
    // Suchen belongs to the list.
    await expect(keys.locator('section').nth(1).getByTestId('key-search').locator('dt')).toHaveText(
      'Suchen',
    );
    const inSettings = await rows('settings-keys');
    await page.keyboard.press(query === MAC ? 'Meta+/' : 'Control+/');
    await expect(page.getByTestId('keys-help')).toBeVisible();
    expect(await rows('keys-help')).toEqual(inSettings);
  }
});

test('keys: F5 fetches in Einstellungen too, as the list says', async ({ page }) => {
  await settings(page);
  await page.getByTestId('settings-fetch').locator('h2').click();
  await page.keyboard.press('F5');
  await expect.poll(async () => (await calls(page, 'start_run')).length).toBe(1);
});

test('a run holds the mailbox, the folder, the files and the sign-in, with its reason', async ({
  page,
}) => {
  await settings(page, `${WIN}&scenario=running`);
  for (const id of ['mailbox-change', 'mailbox-remove', 'workspace-change', 'txt-clear']) {
    expect(await reason(page, id), id).toBe('Ein Abruf läuft gerade.');
  }
  // A rescore says its own reason; the sign-out waits too.
  await settings(page);
  await page.getByTestId('sign-in-freelance').click();
  await page.evaluate(() => {
    window.__harness.holdAfter = 2;
    window.__harness.appRun('rescore');
  });
  for (const id of [
    'mailbox-change',
    'txt-rewrite',
    'full-mailbox',
    'reset',
    'sign-out-freelance',
  ]) {
    expect(await reason(page, id), id).toBe('Die Jobs werden gerade neu bewertet.');
  }
  await page.evaluate(() => (window.__harness.holdAfter = null));
});

test('the dry run and the demo keep to their own data and say so', async ({ page }) => {
  await settings(page, `${WIN}&scenario=dry-run`);
  await expect(page.getByTestId('settings')).toContainText('probelauf@example.org');
  expect(await reason(page, 'mailbox-remove')).toBe('Im Probelauf geht das nicht.');
  expect(await reason(page, 'txt-rewrite')).toBe('Im Probelauf geht das nicht.');
  await settings(page, `${WIN}&scenario=demo`);
  await expect(page.getByTestId('demo-note')).toBeVisible();
  for (const id of ['mailbox-change', 'workspace-change', 'reset']) {
    expect(await reason(page, id), id).toBe('In der Demo geht das nicht.');
  }
});

test('the macOS demo shows the keychain and Mac paths', async ({ page }) => {
  await settings(page, MAC);
  await expect(page.getByTestId('settings-mailbox')).toContainText('macOS-Schlüsselbund');
  await expect(page.getByTestId('settings-files')).toContainText(
    '/Users/demo/Documents/Job-Alerts',
  );
  await expect(page.getByTestId('settings')).not.toContainText('C:/');
});

test('backups: chosen by their day, restored after a question, then undone from the toast', async ({
  page,
}) => {
  await settings(page);
  const row = page.getByTestId('settings-care').getByTestId('backup');
  await expect(row).toContainText('Sicherung wiederherstellen');
  await expect(row).toContainText('Die App sichert die Jobs einmal am Tag.');
  const button = page.getByTestId('backup-restore');
  await expect(button).toHaveClass(/ghost/);
  await button.click();
  const dialog = page.getByTestId('dialog-backup');
  const rows = dialog.getByTestId('backup-list').getByRole('radio');
  // Newest first and chosen, by day in the app's words, the size at the end; a copy from
  // before an update says so.
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
  for (const [index, text] of [
    [0, 'Heute 08:05'],
    [0, '12,4 MB'],
    [1, 'Gestern 08:41'],
    [2, 'Vorgestern 09:12'],
    [3, 'Fr 10:20'],
    [3, 'vor einem Update'],
  ] as const) {
    await expect(rows.nth(index)).toContainText(text);
  }
  // The arrows choose like native radio buttons; the question names the date.
  await rows.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByRole('heading')).toHaveText(
    'Sicherung vom 23.09.2026 um 08:41 wiederherstellen?',
  );
  await expect(dialog).toContainText('Der jetzige Stand wird vorher gesichert.');
  expect(await calls(page, 'restore_backup')).toHaveLength(0);
  // A failure stays in the dialog, which tries again.
  await failNext(page, 'restore_backup');
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  const loads = (await calls(page, 'app_state')).length;
  await dialog.getByTestId('dialog-confirm').click();
  await expect(dialog).toBeHidden();
  // Everything loads again, and the toast offers the undo: the copy of the state before.
  const toast = page.getByTestId('toast').filter({ hasText: 'Sicherung wiederhergestellt.' });
  await expect(toast).toBeVisible();
  expect((await calls(page, 'app_state')).length).toBeGreaterThan(loads);
  await toast.getByTestId('toast-action').click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Der vorherige Stand ist zurück.' }),
  ).toBeVisible();
  const restored = (await calls(page, 'restore_backup')).map(
    ([, args]) => (args as { id: string }).id,
  );
  expect(restored).toEqual([
    'jobs-2026-09-23.db',
    'jobs-2026-09-23.db',
    'jobs.before-restore-20260924-073000-000.db',
  ]);
  // Both copies of a state before a restore are in the list now, newest first.
  await button.click();
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toContainText('Heute 09:30');
  await expect(rows.nth(0)).toContainText('vor dem Wiederherstellen');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The demo restores nothing and says why.
  await settings(page, `${WIN}&scenario=demo`);
  expect(await reason(page, 'backup-restore')).toBe('In der Demo geht das nicht.');
});

test('reset: asks with a danger dialog; a failure stays in it, no report in Einstellungen', async ({
  page,
}) => {
  await settings(page);
  await expect(page.getByTestId('settings-reset')).toContainText(
    'Löscht Jobs, Einstellungen, Profil, App-Passwort, Anmeldungen und die Dateien der App im Arbeitsordner.',
  );
  await expect(page.getByTestId('settings-care').getByTestId('reset')).toHaveCount(0);
  await page.getByTestId('reset').click();
  const dialog = page.getByTestId('dialog-reset');
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  // It lists everything, the files in the user's own work folder too (core reset: `app_files`).
  await expect(dialog).toContainText('Die App startet danach neu und löscht');
  await expect(dialog.getByTestId('dialog-items').locator('li')).toHaveText([
    'die Jobs und die Einstellungen',
    'das Profil',
    'das App-Passwort',
    'die Anmeldungen bei den Portalen',
    'Excel-Datei, Bericht und Textdateien im Arbeitsordner',
  ]);
  await failNext(page, 'reset_all');
  await dialog.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(dialog.getByTestId('dialog-error')).toHaveText('Die Datenbank meldet einen Fehler.');
  await dialog.getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, 'reset_all')).toHaveLength(2);
  // After a reset the app starts on the first run; Einstellungen keep no report.
  await settings(page, `${WIN}&scenario=reset`);
  await expect(page.getByTestId('reset-report')).toHaveCount(0);
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

test('baseline: settings with portals', async ({ page }) => {
  await settings(page, `${WIN}&scenario=paused`);
  await page.getByTestId('settings-portals').scrollIntoViewIfNeeded();
  await expectShot(page, 'settings-portals');
});

test('baseline: settings in Dark', async ({ page }) => {
  await settings(page, `${WIN}&palette=dark`);
  await expectShot(page, 'settings-dark');
});
