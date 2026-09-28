// The first-run page (Erste Schritte) against the stub: the steps that tick themselves, the
// mailbox form with its "Verbinden", the portals it names, the profile step, the first fetch
// and the report of a reset.

import type { Page } from '@playwright/test';
import { calls, expect, open, runFinished, test, visibleCount } from './fixtures';
import { T, failNext } from './helpers';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

/** The target of the last open_target. */
async function lastOpened(page: Page): Promise<unknown> {
  return (await calls(page, 'open_target')).at(-1)?.[1];
}

/** The tooltip of a locked button. */
async function reason(page: Page, testid: string): Promise<string | null> {
  const button = page.getByTestId(testid);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await button.hover();
  return page.getByRole('tooltip').textContent();
}

test('three steps that tick themselves, the fetch locked until a mailbox', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  const first = page.getByTestId('first-run');
  await expect(first).toBeVisible();
  // No sentence introduces the page: the mark, the name and the steps.
  await expect(first.locator('header')).toHaveText(T.app.name);
  await expect(first).not.toContainText('Alles bleibt auf diesem Rechner');
  expect(await visibleCount(page, '.btn.primary')).toBe(1);
  // The caret waits in the first field; the setup stands for Jobs in the sidebar.
  await expect(page.getByTestId('mailbox-user')).toBeFocused();
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  // The two Google pages in the order she needs them, no sentence about app passwords.
  const form = page.getByTestId('mailbox-form');
  await expect(form.locator('.links .btn')).toHaveText([
    T.settings.twoStepAction,
    T.settings.createPassword,
  ]);
  await expect(form).not.toContainText('16 Buchstaben');
  await page.getByTestId('two-step').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'twoStepPage' } });
  // "Verbinden", as in Einstellungen, with its glyph like every action of the steps. Empty
  // fields are said at once, both, without Gmail.
  await expect(page.getByTestId('mailbox-save')).toHaveText(T.settings.connect);
  await expect(page.getByTestId('mailbox-save').locator('[data-icon]')).toHaveAttribute(
    'data-icon',
    'signIn',
  );
  await page.getByTestId('mailbox-save').click();
  await expect(form).toContainText(T.settings.addressMissing);
  await expect(form).toContainText(T.settings.passwordMissing);
  await expect(page.getByTestId('mailbox-user')).toBeFocused();
  expect(await calls(page, 'save_mailbox')).toHaveLength(0);
  // The portals whose alert mails must come here, in the UI's order.
  await expect(page.getByTestId('first-mailbox-hint')).toHaveText(
    T.firstRun.mailboxText(['freelance', 'linkedin', 'freelancermap']),
  );
  expect(await reason(page, 'first-fetch')).toBe('Verbinde erst ein Postfach.');

  await page.getByTestId('mailbox-user').fill('alerts.demo');
  await page.getByTestId('mailbox-password').fill('abcdabcdabcdabcd');
  await page.getByTestId('mailbox-save').click();
  await expect(form).toContainText('Die Adresse ist unvollständig.');
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
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
  // alert where it found none, in the UI's order.
  await expect(page.getByTestId('step-mailbox').locator('.done-text')).toHaveAttribute(
    'data-copy',
    '',
  );
  // The list names the portals, so the sentence above it no longer does.
  await expect(page.getByTestId('first-mailbox-hint')).toHaveText(T.firstRun.mailboxDone);
  await expect(page.getByTestId('first-mailbox-hint')).not.toContainText('freelance.de');
  const portals = await page
    .getByTestId('first-alerts')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  expect(portals).toEqual([
    'first-portal-freelance',
    'first-portal-linkedin',
    'first-portal-freelancermap',
  ]);
  await expect(page.getByTestId('first-mails-linkedin')).toHaveText('20 Alert-Mails');
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveText(['Alert anlegen']);
  await page.getByTestId('first-alert-freelance').click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'portalHome', portal: 'freelance' } });
  // Each step is its name and the controls it needs: no sentence explains a step.
  for (const step of ['step-profile', 'step-fetch']) {
    await expect(page.getByTestId(step).locator('.hint')).toHaveCount(0);
  }
});

test('a step done before the page opened is simply there', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  const mailbox = page.getByTestId('step-mailbox');
  await expect(mailbox).toHaveAttribute('data-done', 'true');
  await expect(mailbox.locator('.marker')).not.toHaveClass(/drawn/);
  await expect(page.getByTestId('step-profile')).toHaveAttribute('aria-current', 'step');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  // Connected in an earlier session: nothing counted, every portal offers its page.
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveCount(3);
});

test('step 1 names the portals that are on; none on leads to Einstellungen', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('toggle-enabled-linkedin').click();
  await page.getByTestId('nav-jobs').click();
  const step = page.getByTestId('step-mailbox');
  await expect(step.getByTestId('first-mailbox-hint')).toHaveText(
    T.firstRun.mailboxText(['freelance', 'freelancermap']),
  );
  // The compound never breaks at its hyphen.
  expect(T.firstRun.mailboxText(['freelance'])).toContain('Gmail‑Adresse');
  await expect(page.getByTestId('first-no-portal')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('toggle-enabled-freelance').click();
  await page.getByTestId('toggle-enabled-freelancermap').click();
  await page.getByTestId('nav-jobs').click();
  // The words of the locked fetch, not a sentence of its own.
  await expect(page.getByTestId('first-no-portal')).toHaveText(T.toolbar.needsPortal);
  await expect(step.getByTestId('first-mailbox-hint')).toHaveCount(0);
  await page.getByTestId('first-open-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  // In English the same.
  await open(page, `${WIN}&scenario=first-run&lang=en`);
  await expect(page.getByTestId('step-mailbox')).toContainText(
    'The alert emails from freelance.de, linkedin.com and freelancermap.de must go to this Gmail address.',
  );
});

test('no alert mail in 30 days says to set up an alert first', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run&alerts=none`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByTestId('mailbox-password').press('Enter');
  await expect(page.getByTestId('first-alerts').getByRole('button')).toHaveCount(3);
  await expect(page.getByTestId('first-no-alerts')).toHaveText(T.firstRun.noAlerts);
});

test('step 2 offers the ways of the Profil view: the empty form, a file, the prompt', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await open(page, `${WIN}&scenario=mailbox-only`);
  const step = page.getByTestId('step-profile');
  // The same buttons as on the Profil view's empty state: 29 px, each with its glyph, the
  // empty form the primary one.
  await expect(step.getByRole('button')).toHaveText([
    T.profile.newProfile,
    T.profile.load,
    T.profile.prompt,
  ]);
  const create = step.getByTestId('first-profile');
  await expect(create).toHaveClass(/primary/);
  for (const [id, icon] of [
    ['first-profile', 'add'],
    ['first-profile-file', 'pickFile'],
    ['first-profile-prompt', 'prompt'],
  ] as const) {
    await expect(step.getByTestId(id)).toHaveCSS('height', '28px');
    await expect(step.getByTestId(id).locator('[data-icon]')).toHaveAttribute('data-icon', icon);
  }
  // The prompt goes to the clipboard and a toast says so; the page stays.
  await step.getByTestId('first-profile-prompt').click();
  await expect(page.getByTestId('toast').last()).toContainText(T.toast.prompt);
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  // A chosen file opens in the Profil view for review; nothing is stored yet.
  await step.getByTestId('first-profile-file').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  expect(await calls(page, 'save_profile')).toHaveLength(0);
  await page.getByTestId('profile-discard').click();
  await page.getByTestId('nav-jobs').click();
  await create.click();
  await page.getByTestId('competence-name').fill('Controlling');
  await page.getByTestId('profile-save').click();
  // Saved during the setup: the toast leads on to the first fetch.
  const toast = page.getByTestId('toast').filter({ hasText: T.profile.saved });
  await expect(toast.getByTestId('toast-action')).toHaveText(T.profile.next);
  await page.getByTestId('nav-jobs').click();
  await expect(step).toHaveAttribute('data-done', 'true');
  await expect(step.locator('.done-text')).toHaveText(T.profile.unnamed);
});

test('a profile that does not count keeps step 2 open and says why', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run-empty-profile`);
  await expect(page.getByTestId('step-profile')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('first-profile')).toHaveClass(/primary/);
  await expect(page.getByTestId('first-fetch')).not.toHaveClass(/primary/);
  const problem = page.getByTestId('first-profile-problem');
  await expect(problem).toHaveText(T.firstRun.profileEmpty);
  await expect(problem.locator('svg')).toHaveCount(1);
  const openProfile = page.getByTestId('first-profile');
  await expect(openProfile).toHaveText(T.list.openProfile);
  await expect(openProfile.locator('[data-icon]')).toHaveAttribute('data-icon', 'document');
});

test('every view opens; the sidebar is the same as always, Jobs leads back', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  const nav = page.getByTestId('sidebar').locator('nav');
  await expect(nav.locator('xpath=ancestor-or-self::*[@inert]')).toHaveCount(0);
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  await expect(page.locator('[data-testid^="nav-"][aria-current="page"]')).toHaveCount(1);
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
});

test('after the first fetch the list opens on its inbox', async ({ page }) => {
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
});

test('a failed first fetch keeps the page and says why', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-fetch-failed`);
  const step = page.getByTestId('step-fetch');
  await expect(step.getByTestId('first-fetch-failed')).toBeVisible();
  // Fetching again completes and ends the setup.
  await page.getByTestId('first-fetch').click();
  await expect(page.getByTestId('first-run')).toHaveCount(0, { timeout: 15_000 });
});

test('the three steps are in view at 1280 x 720 on both systems', async ({ page }) => {
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

test('it opens at its top, the caret waiting in the address', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  for (const query of [`${WIN}&scenario=reset&lang=en`, `${MAC}&scenario=first-run`]) {
    await open(page, query);
    const user = page.getByTestId('mailbox-user');
    await expect(user).toBeFocused();
    // WebKit scrolled to a field focused too early a moment later: wait for that moment.
    await page.waitForTimeout(200);
    const top = await page
      .getByTestId('first-run')
      .evaluate((node) => node.closest('.view')?.scrollTop ?? -1);
    expect(top).toBe(0);
    await page.keyboard.type('alerts');
    await expect(user).toHaveValue('alerts');
    await expect(user).toBeInViewport();
  }
});

test('a refused app password says so in the form', async ({ page }) => {
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
  await expect(report).toContainText(T.settings.resetPartly(1));
  await expect(report).toHaveClass(/warning/);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // What stayed is named in the log.
  const log = report.getByRole('button', { name: T.common.openLog });
  await log.click();
  expect(await lastOpened(page)).toEqual({ target: { kind: 'logDir' } });
  // A folder that does not open says so in its place.
  await failNext(page, 'open_target');
  await log.click();
  await expect(page.getByTestId('open-error')).toHaveText('Die Datenbank meldet einen Fehler.');
});
