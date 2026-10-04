// The setup (features/first-run) against the stub: a mode of the shell of its own, its steps
// from the table, every switch of the view refused, Zurück (and the mouse's back button), the
// two ways as tiles, the CV's upload, evaluation and failures, the short forms of the Profil
// ("Fast fertig" after the CV, "Dein Profil" by hand) whose Weiter waits while something is
// missing, the optional Alert-Mails, Fertig, resuming from what is stored and the smallest
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
    // One colour, no seam: the bar is the cream page's.
    await expect(page.getByTestId('title-bar')).not.toHaveClass(/docked/);
    await expect(page.getByTestId('title-bar')).toHaveClass(/setup/);
    await expect(page.getByTestId('first-back')).toHaveCount(0);
    // Willkommen has no step indicator; the primary sits in the card's foot.
    await expect(page.getByTestId('first-steps')).toHaveCount(0);
    await expect(page.getByTestId('first-card').getByTestId('first-next')).toHaveText(
      T.firstRun.begin,
    );
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
  // Enter is the primary.
  await page.keyboard.press('Enter');
  await expectStep(page, T.firstRun.way);
  await expect(heading(page)).toBeFocused();
  await expect(page.getByTestId('first-steps').locator('[aria-current="step"]')).toContainText(
    T.firstRun.stages[0]!,
  );
  // The mouse's back button is Zurück; Willkommen has none.
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await next(page).click();
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.welcome);
});

test('the CV: its tile, the upload, the evaluation, Fast fertig; Weiter goes on', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await next(page).click();
  // Two tiles side by side; a click goes on, no Weiter.
  await expectStep(page, T.firstRun.way);
  await expect(next(page)).toHaveCount(0);
  const way = page.getByTestId('first-way');
  await expect(way.getByTestId('way-cv')).toContainText(T.profile.wayCv);
  await expect(way.getByTestId('way-self')).toContainText(T.profile.byHand);
  await way.getByTestId('way-cv').click();
  await expectStep(page, T.firstRun.upload);
  const zone = page.getByTestId('upload-zone');
  await expect(zone).toContainText(T.profile.cvDrop);
  await expect(zone).toContainText(T.profile.cvFormats);
  await expect(page.getByTestId('upload-ai')).toHaveText(T.profile.fromCvHint);
  // The whole zone is one button: no Weiter.
  await expect(next(page)).toHaveCount(0);
  await expect(zone).toHaveRole('button');
  await zone.click();
  await expectStep(page, T.firstRun.reading);
  await expect(page.getByTestId('cv-reading')).toBeVisible();
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  await expect(page.getByTestId('cv-cancel')).toBeVisible();
  await expectStep(page, T.firstRun.review);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: false });
  // The Profil's short form: no title, no CV button, no Speichern; what the CV brought
  // besides in a quiet strip.
  await expect(page.getByTestId('profile-form')).toBeVisible();
  for (const gone of ['profile-heading', 'profile-from-cv', 'profile-save']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await expect(page.getByTestId('first-brought')).toContainText(T.firstRun.later);
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
  await expectStep(page, T.firstRun.alerts);
});
test('a failed evaluation says one sentence and its ways on; Abbrechen goes back', async ({
  page,
}) => {
  const cases = [
    ['limit', 'limit', ['self']],
    ['offline', 'offline', ['retry', 'self']],
    ['unreadable', 'unreadable', ['otherFile', 'self']],
    ['unsupported', 'unsupported', ['otherFile', 'self']],
    ['unavailable', 'unavailable', ['retry', 'self']],
    ['paused', 'paused', ['self']],
    ['outdated', 'outdated', ['self']],
  ] as const;
  for (const [cv, reason, ways] of cases) {
    await open(page, `${WIN}&scenario=first-run&step=reading&cv=${cv}`);
    await expect(page.getByTestId('cv-error')).toHaveText(T.profile.cvError[reason]);
    // The ways at the right, the primary (the table's first) last; Zurück at the left.
    const buttons = page.getByTestId('cv-problem').locator('.btn[data-testid^="cv-"]');
    await expect(buttons).toHaveCount(ways.length);
    for (const [index, way] of [...ways].reverse().entries()) {
      await expect(buttons.nth(index)).toHaveAttribute('data-testid', `cv-${way}`);
    }
    await expect(buttons.last()).toHaveClass(/primary/);
    await expect(page.getByTestId('first-back')).toBeVisible();
  }
  // Zurück after a failure: back to the upload.
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.upload);
  await open(page, `${WIN}&scenario=first-run&step=reading&cv=outdated`);
  // "Selbst ausfüllen": the short form by hand.
  await page.getByTestId('cv-self').click();
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // Abbrechen while it evaluates: back to the upload.
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await page.getByTestId('cv-cancel').click();
  await expectStep(page, T.firstRun.upload);
});

test('by hand: Weiter waits while something is missing and says what; Esc does nothing', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=way`);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.self);
  await page.getByTestId('profile-roles').locator('input').focus();
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.self);
  // Wunschrollen, Kompetenzen and Sprachen are missing: the line says so, Weiter waits and
  // its tooltip says what.
  const words = T.profile.field;
  const lacking = T.profile.missing([words.roles, words.competences, words.languages]);
  await expect(page.getByTestId('profile-missing')).toBeVisible();
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
  await next(page).hover();
  await expect(page.getByRole('tooltip')).toHaveText(lacking);
  // Enter in a field puts the caret into the first that is missing.
  await page.getByTestId('profile-roles').locator('input').press('Enter');
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('profile-roles').locator('input')).toBeFocused();
  const roles = page.getByTestId('profile-roles').locator('input');
  await roles.fill('Interim CFO');
  await roles.press('Enter');
  const competences = page.getByTestId('profile-competence-names').locator('input');
  await competences.fill('Controlling');
  await competences.press('Enter');
  await page.getByTestId('language-name').click();
  await page.getByTestId('menu-item-Deutsch').click();
  await expect(page.getByTestId('profile-missing')).toHaveCount(0);
  await expect(next(page)).not.toHaveAttribute('aria-disabled', 'true');
  await next(page).click();
  await expectStep(page, T.firstRun.alerts);
  // Back to the short form (the mouse; the card has Überspringen in Zurück's place): what
  // was typed is still there.
  await mouseBack(page);
  await expectStep(page, T.firstRun.self);
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
});
test('Alert-Mails: skipped, or connected with the portals rows; Fertig opens the jobs', async ({
  page,
}) => {
  // A usable profile and no mailbox: the setup resumes at Alert-Mails.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expectStep(page, T.firstRun.alerts);
  // "Verbinden" is the primary, "Überspringen" at the left in Zurück's place.
  await expect(next(page)).toHaveText(T.settings.connect);
  await expect(next(page)).toHaveClass(/primary/);
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  await page.getByTestId('first-skip').click();
  await expectStep(page, T.firstRun.done);
  // Fertig: both stages done, no Zurück.
  await expect(page.getByTestId('first-steps').locator('[data-state="done"]')).toHaveCount(2);
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  expect(await calls(page, 'finish_onboarding')).toHaveLength(1);
  await expect(page.getByTestId('cv-reading')).toHaveCount(0);
  await next(page).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('toggle-sidebar')).toBeVisible();
  expect(await calls(page, 'start_run')).toHaveLength(0);

  // Connected: the address and the portals' rows with "Alert anlegen", then Weiter.
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcdabcdabcdabcd');
  await next(page).click();
  await expect(page.getByTestId('first-address')).toHaveText('alerts.demo@gmail.com');
  await expect(page.getByTestId('first-alerts')).toContainText(T.settings.setUpAlert);
  await expect(next(page)).toHaveText(T.firstRun.next);
  await expect(next(page)).toHaveClass(/primary/);
  await next(page).click();
  await expectStep(page, T.firstRun.done);
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
