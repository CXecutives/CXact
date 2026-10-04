// The setup (features/first-run) against the stub: a mode of the shell of its own, its steps
// from the table, every switch of the view refused, Zurück (and the mouse's back button), the
// CV's upload, evaluation and failures, the review in the Profil's setup mode, the optional
// Alert-Mails, Fertig, resuming from what is stored, the report of a reset and the smallest
// window.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
import { fillRequired, T, WIN, MAC } from './helpers';

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
    // One colour, no seam: the bar is the view's.
    await expect(page.getByTestId('title-bar')).not.toHaveClass(/docked/);
    await expect(page.getByTestId('first-back')).toHaveCount(0);
    await expect(next(page)).toHaveText(T.firstRun.begin);
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
  // The mouse's back button is Zurück; Willkommen has none.
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await next(page).click();
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.welcome);
});

test('the CV: upload, evaluation, review; Weiter saves and goes on to the alert mails', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await next(page).click();
  // The CV is the recommended way, chosen at once.
  await expect(page.getByTestId('first-way').getByRole('radio', { checked: true })).toContainText(
    T.profile.fromCv,
  );
  await next(page).click();
  await expectStep(page, T.firstRun.upload);
  await expect(page.getByTestId('upload-zone')).toContainText(T.firstRun.formats);
  await expect(page.getByTestId('upload-ai')).toHaveText(T.profile.fromCvHint);
  // The step's own button goes on: no Weiter.
  await expect(next(page)).toHaveCount(0);
  await page.getByTestId('upload-pick').click();
  await expectStep(page, T.firstRun.reading);
  await expect(page.getByTestId('cv-reading')).toBeVisible();
  await expect(page.getByTestId('first-back')).toHaveCount(0);
  await expectStep(page, T.firstRun.review);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ path: null });
  // The Profil's form in its setup mode: no title, no CV button, no save bar.
  await expect(page.getByTestId('profile-form')).toBeVisible();
  for (const gone of ['profile-heading', 'profile-from-cv', 'profile-jumps', 'profile-save-bar']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  await expect(page.getByTestId('profile-ai-filled')).toBeVisible();
  // Zurück skips the evaluation.
  await page.getByTestId('first-back').click();
  await expectStep(page, T.firstRun.upload);
  // A dropped file is read from its path.
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expectStep(page, T.firstRun.review);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({
    path: 'C:/Users/demo/Lebenslauf.pdf',
  });
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
    ['unavailable', 'paused', ['self']],
    ['outdated', 'outdated', ['self']],
  ] as const;
  for (const [cv, reason, ways] of cases) {
    await open(page, `${WIN}&scenario=first-run&step=reading&cv=${cv}`);
    await expect(page.getByTestId('cv-error')).toHaveText(T.profile.cvError[reason]);
    const buttons = page.getByTestId('cv-problem').locator('.btn');
    await expect(buttons).toHaveCount(ways.length);
    for (const [index, way] of ways.entries()) {
      await expect(buttons.nth(index)).toHaveAttribute('data-testid', `cv-${way}`);
    }
    await expect(buttons.first()).toHaveClass(/primary/);
  }
  // "Selbst ausfüllen": the empty form.
  await page.getByTestId('cv-self').click();
  await expectStep(page, T.firstRun.review);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // Abbrechen while it evaluates: back to the upload.
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await page.getByTestId('cv-cancel').click();
  await expectStep(page, T.firstRun.upload);
});

test('by hand: Weiter goes on only once nothing required is open; Esc does nothing', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=way`);
  await page.getByTestId('first-way').getByRole('radio', { name: T.profile.byHand }).click();
  await next(page).click();
  await expectStep(page, T.firstRun.review);
  await page.getByTestId('profile-roles').locator('input').focus();
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.review);
  // Saved, but required fields are open: the caret goes to the first of them.
  await next(page).click();
  await expect(page.getByTestId('profile-open')).toBeVisible();
  await expectStep(page, T.firstRun.review);
  // The stored profile has no competence row left: one is added first.
  await page.getByTestId('competence-add').click();
  await fillRequired(page);
  await next(page).click();
  await expectStep(page, T.firstRun.alerts);
  // Back to the review: what was typed is still there.
  await page.getByTestId('first-back').click();
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
});

test('Alert-Mails: skipped, or connected with the portals rows; Fertig opens the jobs', async ({
  page,
}) => {
  // A usable profile and no mailbox: the setup resumes at Alert-Mails.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expectStep(page, T.firstRun.alerts);
  await expect(page.getByTestId('mailbox-save')).toHaveClass(/primary/);
  await expect(next(page)).toHaveText(T.firstRun.skip);
  await expect(next(page)).not.toHaveClass(/primary/);
  await next(page).click();
  await expectStep(page, T.firstRun.done);
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
  await page.getByTestId('mailbox-save').click();
  await expect(page.getByTestId('first-address')).toHaveText('alerts.demo@gmail.com');
  await expect(page.getByTestId('first-alerts')).toContainText(T.settings.setUpAlert);
  await expect(next(page)).toHaveText(T.firstRun.next);
  await expect(next(page)).toHaveClass(/primary/);
  await next(page).click();
  await expectStep(page, T.firstRun.done);
});

test('after a reset: what stayed on Willkommen with the log, a clean one in a toast', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=reset`);
  await expect(page.getByTestId('first-reset-report')).toContainText(T.settings.resetPartly(1));
  await open(page, `${WIN}&scenario=reset&reset=clean`);
  await expect(page.getByTestId('first-reset-report')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toHaveText(new RegExp(T.settings.resetDone));
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
