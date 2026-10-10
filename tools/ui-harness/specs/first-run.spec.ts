// The setup (features/first-run) against the stub: a mode of the shell of its own, its steps
// from the table in the Profil page's frame, every switch of the view refused, Zurück (and the
// mouse's back button), Willkommen with the two ways as tiles, the CV's upload, evaluation and
// failures (back on the upload with the reason), the whole Profil page ("Profil prüfen" after
// the CV, "Profil ausfüllen" by hand) whose Weiter marks what is missing and says it, the
// Postfach (skipped or connected), Fertig, resuming from what is stored and the smallest
// window.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
import { T, WIN, MAC } from './helpers';

const heading = (page: Page) => page.getByTestId('first-heading');
const next = (page: Page) => page.getByTestId('first-next');

/** The step the setup shows. */
async function expectStep(page: Page, words: string): Promise<void> {
  await expect(heading(page)).toHaveText(words);
}

/** The mouse's back button, as the OS sends it (button 3). */
async function mouseBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const init = { bubbles: true, cancelable: true, button: 3 };
    document.body.dispatchEvent(new MouseEvent('mousedown', init));
    document.body.dispatchEvent(new MouseEvent('mouseup', init));
  });
}

test('the setup is a mode of its own: no sidebar, no buttons in the top bar', async ({ page }) => {
  for (const os of [WIN, MAC]) {
    await open(page, `${os}&scenario=first-run`);
    await expect(page.getByTestId('first-run')).toBeVisible();
    await expectStep(page, T.firstRun.welcome);
    await expect(heading(page)).toBeFocused();
    for (const gone of [
      'sidebar',
      'sidebar-floating',
      'toggle-sidebar',
      'history-back',
      'history-forward',
      'toggle-reader',
    ]) {
      await expect(page.getByTestId(gone)).toHaveCount(0);
    }
    // One colour, no seam: the bar is the page's.
    await expect(page.getByTestId('title-bar')).not.toHaveClass(/docked/);
    await expect(page.getByTestId('title-bar')).toHaveClass(/page/);
    // Willkommen has no foot: a tile goes on.
    await expect(page.getByTestId('first-bar')).toHaveCount(0);
  }
});

test('no step indicator: the heading opens the column, flush left, on every step', async ({
  page,
}) => {
  for (const query of ['scenario=first-run', 'scenario=setup-profile', 'scenario=setup-mailbox']) {
    await open(page, `${WIN}&${query}`);
    await expect(page.getByTestId('first-steps')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Einrichtung' })).toHaveCount(0);
    const [title, column] = await Promise.all([
      heading(page).boundingBox(),
      page.getByTestId('first-step').boundingBox(),
    ]);
    expect(Math.abs(title!.x - column!.x)).toBeLessThanOrEqual(1);
    // Nothing above it but the step's own top padding.
    expect(title!.y - column!.y).toBeGreaterThanOrEqual(0);
    expect(title!.y - column!.y).toBeLessThanOrEqual(16);
  }
});

test('every switch of the view is refused while it stands; Zurück and the mouse go back', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  // The native menu (macOS Cmd+,) asks for Einstellungen: nothing happens.
  await page.evaluate(() => window.__harness.fire('navigate', 'settings'));
  await expect(page.getByTestId('first-run')).toBeVisible();
  await expect(page.getByTestId('view-settings')).toHaveCount(0);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.self);
  await expect(heading(page)).toBeFocused();
  // The mouse's back button is Zurück; Willkommen has none.
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await page.getByTestId('way-cv').click();
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.welcome);
});

test('the CV: its tile, the upload, the evaluation, the whole profile; Weiter goes on', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  // Two tiles side by side; the CV's says the AI; a click goes on.
  const way = page.getByTestId('first-way');
  await expect(page.getByTestId('first-step')).toContainText(T.firstRun.welcomeText);
  // What the setup holds, under the two ways, instead of a step indicator.
  await expect(page.getByTestId('first-overview')).toHaveText(T.firstRun.overview);
  await expect(way.getByTestId('way-cv')).toContainText(T.profile.fromCv);
  await expect(way.getByTestId('way-cv')).toContainText(T.profile.fromCvHint);
  await expect(way.getByTestId('way-self')).toHaveText(T.profile.byHand);
  await way.getByTestId('way-cv').click();
  await expectStep(page, T.firstRun.upload);
  const zone = page.getByTestId('upload-zone');
  await expect(zone).toContainText(T.profile.cvDrop);
  await expect(zone).toContainText(T.profile.cvFormats);
  await expect(page.getByTestId('first-step')).not.toContainText(T.profile.fromCvHint);
  // The whole zone is one button: no Weiter, Zurück at the left.
  await expect(next(page)).toHaveCount(0);
  await expect(page.getByTestId('first-back')).toBeVisible();
  await expect(zone).toHaveRole('button');
  await zone.click();
  await expectStep(page, T.firstRun.reading);
  await expect(page.getByTestId('cv-reading')).toBeVisible();
  await expect(page.getByTestId('first-step').locator('.text')).toHaveCount(0);
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  await expect(page.getByTestId('cv-cancel')).toBeVisible();
  await expectStep(page, T.firstRun.review);
  // After the CV it says what only the user knows.
  await expect(page.getByTestId('first-step')).toContainText(T.firstRun.reviewText);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: false });
  // The whole Profil page: its four groups, without its head, the CV button and the bar.
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(page.locator('[data-section]')).toHaveCount(4);
  for (const gone of ['profile-heading', 'profile-from-cv', 'profile-save-bar']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  // Zurück skips the evaluation.
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.upload);
  // A dropped file is taken from the window: the page never sends its path.
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expectStep(page, T.firstRun.review);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: true });
  await next(page).click();
  await expectStep(page, T.settings.connectHeading);
});

test('the CV fills the form even after a draft was typed by hand', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('way-self').click();
  const roles = page.getByTestId('profile-roles');
  await roles.locator('input').fill('Entwurf');
  await roles.locator('input').press('Enter');
  await expect(roles).toContainText('Entwurf');
  await mouseBack(page);
  await page.getByTestId('way-cv').click();
  await page.getByTestId('upload-zone').click();
  await expectStep(page, T.firstRun.review);
  await expect(page.getByTestId('profile-roles')).not.toContainText('Entwurf');
  await expect(page.getByTestId('profile-roles').locator('.chip').first()).toBeVisible();
});

test('a failed evaluation comes back to the upload and says why above it', async ({ page }) => {
  // A new try can work: the drop zone stays and is the way on.
  for (const [cv, reason] of [
    ['offline', 'offline'],
    ['timeout', 'timeout'],
    ['unreadable', 'unreadable'],
    ['tooBig', 'tooLarge'],
    ['unsupported', 'unsupported'],
    ['unavailable', 'unavailable'],
  ] as const) {
    await open(page, `${WIN}&scenario=first-run&step=reading&cv=${cv}`);
    await expectStep(page, T.firstRun.upload);
    await expect(page.getByTestId('cv-error')).toHaveText(T.profile.cvError[reason]);
    await expect(page.getByTestId('upload-zone')).toBeVisible();
    await expect(page.getByTestId('cv-self')).toHaveCount(0);
    await expect(page.getByTestId('first-back')).toBeVisible();
  }
  // No new try can work: "Selbst ausfüllen" takes the drop zone's place.
  for (const reason of ['limit', 'paused', 'outdated'] as const) {
    await open(page, `${WIN}&scenario=first-run&step=reading&cv=${reason}`);
    await expectStep(page, T.firstRun.upload);
    await expect(page.getByTestId('cv-error')).toHaveText(T.profile.cvError[reason]);
    await expect(page.getByTestId('upload-zone')).toHaveCount(0);
    await expect(page.getByTestId('cv-self')).toHaveText(T.profile.byHand);
    await expect(page.getByTestId('cv-self')).toHaveClass(/primary/);
    await expect(page.getByTestId('first-back')).toBeVisible();
  }
  await page.getByTestId('cv-self').click();
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // The tries used up before any: said at once, no drop zone.
  await open(page, `${WIN}&scenario=first-run&step=upload&cv=used`);
  await expect(page.getByTestId('cv-error')).toHaveText(T.profile.cvError.limit);
  await expect(page.getByTestId('upload-zone')).toHaveCount(0);
  // Abbrechen while it evaluates: back to the upload, nothing to say.
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await page.getByTestId('cv-cancel').click();
  await expectStep(page, T.firstRun.upload);
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
});

test('by hand: Weiter marks what is missing and says it beside itself; Esc does nothing', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('first-step')).toContainText(T.firstRun.later);
  await expect(page.locator('[data-section]')).toHaveCount(4);
  const roles = page.getByTestId('profile-roles').locator('input');
  await roles.focus();
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.self);
  // Nothing warns up front; Weiter is always on.
  const missing = page.getByTestId('first-bar').getByTestId('profile-missing');
  await expect(page.getByTestId('profile-missing')).toHaveCount(0);
  await expect(next(page)).not.toHaveAttribute('aria-disabled', 'true');
  // Weiter: Wunschrollen, Kompetenzen and Sprachen marked and said beside it, the first in view
  // but no caret in it (the user clicks where they want to type); the step stays.
  const words = T.profile.field;
  await next(page).click();
  await expectStep(page, T.firstRun.self);
  for (const name of [words.roles, words.competences, words.languages]) {
    await expect(missing).toContainText(name);
  }
  await expect(roles).not.toBeFocused();
  await expect(roles).toBeInViewport();
  await expect(page.locator('[data-field~="roles"]')).toHaveAttribute('data-missing', '');
  await roles.fill('Interim CFO');
  await roles.press('Enter');
  await expect(missing).not.toContainText(words.roles);
  await page.getByTestId('competence-name').first().fill('Controlling');
  await page.getByTestId('language-pick-Deutsch').click();
  await expect(page.getByTestId('profile-missing')).toHaveCount(0);
  await next(page).click();
  await expectStep(page, T.settings.connectHeading);
  // Back to the profile (the mouse): what was typed is still there.
  await mouseBack(page);
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
});

test('Postfach: skipped, or connected with the portals rows; Fertig opens the jobs', async ({
  page,
}) => {
  // A usable profile and no mailbox: the setup resumes at the Postfach.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expectStep(page, T.settings.connectHeading);
  await expect(page.getByTestId('first-step')).toContainText(
    T.firstRun.alertsText(['linkedin', 'freelance']),
  );
  // The form in one group, Google's page as the password field's link.
  await expect(page.getByTestId('mailbox-form').getByTestId('create-password')).toHaveText(
    T.settings.createPassword,
  );
  // Zurück at the left; "Überspringen" then "Verbinden", the primary, at the right.
  await expect(page.getByTestId('first-back')).toBeVisible();
  const ends = page.getByTestId('first-bar').locator('.ends .btn');
  await expect(ends).toHaveCount(2);
  await expect(ends.nth(0)).toHaveAttribute('data-testid', 'first-skip');
  await expect(ends.nth(0)).toHaveClass(/secondary/);
  await expect(ends.nth(1)).toHaveText(T.settings.connect);
  await expect(ends.nth(1)).toHaveClass(/primary/);
  await page.getByTestId('first-skip').click();
  // Fertig without a mailbox: the summary says the Postfach is left for later.
  await expectStep(page, T.firstRun.done);
  await expect(page.getByTestId('first-summary').locator('li')).toHaveText([
    T.firstRun.summaryProfile,
    T.firstRun.summaryMailboxLater,
  ]);
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  expect(await calls(page, 'finish_onboarding')).toHaveLength(1);
  await expect(next(page)).toHaveText(T.firstRun.toJobs);
  await next(page).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('toggle-sidebar')).toBeVisible();
  expect(await calls(page, 'start_run')).toHaveLength(0);

  // Connected (Enter is the primary): the address and the alert portals' rows with what
  // "Verbinden" counted and "Alert anlegen", nothing else; then Fertig.
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcdabcdabcdabcd');
  await page.keyboard.press('Enter');
  await expectStep(page, T.firstRun.connected);
  await expect(page.getByTestId('first-address')).toHaveText('alerts.demo@gmail.com');
  await expect(page.getByTestId('first-step')).toContainText(T.firstRun.alertsDone);
  const rows = page.getByTestId('first-alerts');
  await expect(rows.locator('[data-setting-row]')).toHaveCount(2);
  await expect(page.getByTestId('portal-linkedin-hint')).toHaveText(T.settings.alertMails(20));
  await expect(page.getByTestId('portal-freelance-hint')).toHaveText(T.settings.alertMails(0));
  await expect(rows.getByTestId('setup-linkedin')).toHaveText(T.settings.setUpAlert);
  await expect(rows.getByRole('switch')).toHaveCount(0);
  await expect(
    rows.locator('[data-testid^="open-portal-"], [data-testid^="sign-in-"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId('first-back')).toBeVisible();
  await expect(page.getByTestId('first-skip')).toHaveCount(0);
  await expect(next(page)).toHaveText(T.firstRun.next);
  await expect(next(page)).toHaveClass(/primary/);
  await next(page).click();
  await expectStep(page, T.firstRun.done);
  await expect(page.getByTestId('first-summary').locator('li')).toHaveText([
    T.firstRun.summaryProfile,
    T.firstRun.summaryMailbox,
  ]);
});

test('the smallest window keeps every step usable', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, `${WIN}&scenario=first-run&step=review`);
  await expectStep(page, T.firstRun.review);
  await expect(next(page)).toBeInViewport();
  await expect(page.getByTestId('first-back')).toBeInViewport();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(480);
});
