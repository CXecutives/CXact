// The setup (features/first-run) against the stub: a mode of the shell of its own, its seven
// steps from the table as cards on the cream (the profile a whole page), every switch of the
// view refused, Zurück (and the mouse's back button), Willkommen, the two ways, the CV's
// upload, evaluation, cancel and failures (back on the upload with the reason in a state
// box), "Dein Profil" whose Weiter marks what is missing red without a sentence, the optional
// Postfach (skipped or connected, its pair in the OS order), Fertig that says what was set up,
// resuming from what is stored and the smallest window.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
import { fillRequired, T, WIN, MAC } from './helpers';

const heading = (page: Page) => page.getByTestId('first-heading');
const next = (page: Page) => page.getByTestId('first-next');
const back = (page: Page) => page.getByTestId('first-back');

/** The step the setup shows (its heading, a badge may follow). */
async function expectStep(page: Page, words: string): Promise<void> {
  await expect(heading(page).locator('[data-heading]')).toHaveText(words);
}

/** The mouse's back button, as the OS sends it (button 3). */
async function mouseBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const init = { bubbles: true, cancelable: true, button: 3 };
    document.body.dispatchEvent(new MouseEvent('mousedown', init));
    document.body.dispatchEvent(new MouseEvent('mouseup', init));
  });
}

/** From Willkommen to the two ways. */
async function toWays(page: Page): Promise<void> {
  await expectStep(page, T.firstRun.welcome);
  await next(page).click();
  await expectStep(page, T.firstRun.way);
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
  }
});

test('Willkommen: the app mark, one job with its ring and Loslegen; no dots on any step', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  const step = page.getByTestId('first-step');
  await expect(step.locator('img')).toHaveCount(1);
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.welcomeText);
  // One job as CXact shows it: its ring with the match, its title and its band; under it
  // what the number means. A picture: no control in it.
  const job = page.getByTestId('first-example');
  await expect(job.getByRole('img')).toHaveAccessibleName(
    new RegExp(`^${T.score.value(T.score.band.high, '89')}`),
  );
  await expect(job).toContainText(T.firstRun.example);
  await expect(job).toContainText(T.score.band.high);
  await expect(page.getByTestId('first-intro').getByRole('button')).toHaveCount(0);
  await expect(back(page)).toHaveCount(0);
  await expect(next(page)).toHaveText(T.firstRun.start);
  // Enter is the primary.
  await page.keyboard.press('Enter');
  await expectStep(page, T.firstRun.way);
  for (const query of ['scenario=first-run', 'scenario=setup-profile', 'scenario=setup-mailbox']) {
    await open(page, `${WIN}&${query}`);
    await expect(heading(page)).toBeVisible();
    await expect(page.getByTestId('first-dots')).toHaveCount(0);
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
  await toWays(page);
  await expect(heading(page)).toBeFocused();
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.profileSelf);
  await expect(heading(page)).toBeFocused();
  // The mouse's back button is Zurück; Willkommen has none.
  await mouseBack(page);
  await expectStep(page, T.firstRun.way);
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await mouseBack(page);
  await expectStep(page, T.firstRun.welcome);
  await next(page).click();
  await page.getByTestId('way-cv').click();
  await back(page).click();
  await expectStep(page, T.firstRun.way);
  await expect(back(page)).toHaveText(T.common.back);
});

test('the CV: its tile, the upload, the evaluation, the whole profile; Weiter goes on', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('first-way').getByTestId('way-cv').click();
  await expectStep(page, T.firstRun.upload);
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.uploadText);
  const zone = page.getByTestId('upload-zone');
  await expect(zone).toContainText(T.firstRun.drop);
  await expect(zone).toContainText(T.firstRun.formats);
  // One upload glyph on the card, the step's tile: the zone has none.
  await expect(zone.locator('.icon')).toHaveCount(0);
  await expect(page.getByTestId('upload-ai')).toHaveText(T.firstRun.ai);
  // The whole zone is one button: no primary, Zurück at the left.
  await expect(next(page)).toHaveCount(0);
  await expect(back(page)).toBeVisible();
  await expect(zone).toHaveRole('button');
  await zone.click();
  await expectStep(page, T.firstRun.reading);
  await expect(page.getByTestId('cv-reading')).toBeVisible();
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.readingText);
  await expect(back(page)).toHaveCount(0);
  await expect(page.getByTestId('cv-cancel')).toHaveText(T.common.cancel);
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.profileCv);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: false });
  // The whole Profil page: its six groups, without its head, the CV button and the save bar;
  // its own bar with Zurück and Weiter.
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(page.locator('[data-section]')).toHaveCount(6);
  for (const gone of ['profile-heading', 'profile-from-cv', 'profile-save-bar']) {
    await expect(page.getByTestId(gone)).toHaveCount(0);
  }
  const bar = page.getByTestId('first-bar');
  await expect(bar.getByTestId('first-back')).toBeVisible();
  await expect(bar.getByTestId('first-next')).toHaveText(T.firstRun.next);
  // Zurück skips the evaluation.
  await back(page).click();
  await expectStep(page, T.firstRun.upload);
  // A dropped file is taken from the window: the page never sends its path.
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expectStep(page, T.firstRun.profile);
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: true });
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
});

test('the CV fills the form even after a draft was typed by hand', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  const roles = page.getByTestId('profile-roles');
  await roles.locator('input').fill('Entwurf');
  await roles.locator('input').press('Enter');
  await expect(roles).toContainText('Entwurf');
  await mouseBack(page);
  await page.getByTestId('way-cv').click();
  await page.getByTestId('upload-zone').click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('profile-roles')).not.toContainText('Entwurf');
  await expect(page.getByTestId('profile-roles').locator('.chip').first()).toBeVisible();
});

test('Zurück then "Selbst ausfüllen" keeps what was typed', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  const roles = page.getByTestId('profile-roles');
  await roles.locator('input').fill('Interim CFO');
  await roles.locator('input').press('Enter');
  await back(page).click();
  await expectStep(page, T.firstRun.way);
  await page.getByTestId('way-self').click();
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
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
    await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError[reason]);
    await expect(page.getByTestId('upload-zone')).toBeVisible();
    await expect(page.getByTestId('cv-self')).toHaveCount(0);
    await expect(back(page)).toBeVisible();
  }
  // No new try can work: the box offers "Selbst ausfüllen" in the drop zone's place.
  for (const reason of ['limit', 'paused', 'outdated'] as const) {
    await open(page, `${WIN}&scenario=first-run&step=reading&cv=${reason}`);
    await expectStep(page, T.firstRun.upload);
    await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError[reason]);
    await expect(page.getByTestId('upload-zone')).toHaveCount(0);
    await expect(page.getByTestId('upload-ai')).toHaveCount(0);
    await expect(page.getByTestId('cv-error').getByTestId('cv-self')).toHaveText(T.profile.byHand);
    await expect(back(page)).toBeVisible();
    // In the card's narrow box the button stands under the words, so the title keeps its line.
    const [title, button] = await Promise.all([
      page.getByTestId('cv-error').locator('.title').boundingBox(),
      page.getByTestId('cv-self').boundingBox(),
    ]);
    expect(title!.height).toBeLessThan(24);
    expect(button!.y).toBeGreaterThan(title!.y + title!.height);
  }
  await page.getByTestId('cv-self').click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // The tries used up before any: said at once, no drop zone.
  await open(page, `${WIN}&scenario=first-run&step=upload&cv=used`);
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.limit);
  await expect(page.getByTestId('upload-zone')).toHaveCount(0);
});

test('Abbrechen stops the evaluation in the backend and goes back to the upload', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await page.getByTestId('cv-cancel').click();
  await expectStep(page, T.firstRun.upload);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
  // Its answer never comes back as a profile.
  await page.waitForTimeout(1700);
  await expectStep(page, T.firstRun.upload);
  expect(await page.evaluate(() => window.__harness.form())).toBeNull();
});

test('by hand: Weiter marks what is missing red without a sentence; Esc does nothing', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.locator('[data-section]')).toHaveCount(6);
  const roles = page.getByTestId('profile-roles').locator('input');
  await roles.focus();
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.profile);
  // Nothing marked up front; Weiter is always on.
  await expect(page.locator('[data-missing]')).toHaveCount(0);
  await expect(next(page)).not.toHaveAttribute('aria-disabled', 'true');
  // Weiter: the empty required fields turn red, the first comes into view without a caret,
  // no sentence names them; the step stays.
  await next(page).click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.locator('[data-field~="roles"]')).toHaveAttribute('data-missing', '');
  await expect(roles).not.toBeFocused();
  await expect(roles).toBeInViewport();
  await expect(page.getByTestId('profile-missing')).toHaveCount(0);
  await fillRequired(page);
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  // Back to the profile (the mouse): what was typed is still there.
  await mouseBack(page);
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
});

test('Postfach: optional, its pair in the OS order; skipped, Fertig opens the jobs', async ({
  page,
}) => {
  // A usable profile and no mailbox: the setup resumes at the Postfach.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expectStep(page, T.firstRun.mailbox);
  await expect(page.getByTestId('first-lead')).toHaveText(
    T.firstRun.mailboxText(['linkedin', 'freelance']),
  );
  await expect(page.getByTestId('mailbox-form')).toBeVisible();
  await expect(back(page)).toBeVisible();
  // Windows: Verbinden first, then Überspringen; both at least the pair's width.
  const ends = page.getByTestId('first-bar').locator('.actions .btn');
  await expect(ends).toHaveCount(2);
  await expect(ends.nth(0)).toHaveAttribute('data-testid', 'first-next');
  await expect(ends.nth(0)).toHaveText(T.firstRun.connect);
  await expect(ends.nth(1)).toHaveAttribute('data-testid', 'first-skip');
  for (const end of await ends.all()) {
    expect((await end.boundingBox())!.width).toBeGreaterThanOrEqual(88);
  }
  await page.getByTestId('first-skip').click();
  // Fertig without a mailbox says the profile is set up.
  await expectStep(page, T.firstRun.doneProfile);
  await expect(page.getByTestId('first-success')).toBeVisible();
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.doneText);
  await expect(back(page)).toHaveCount(0);
  expect(await calls(page, 'finish_onboarding')).toHaveLength(1);
  await expect(next(page)).toHaveText(T.firstRun.toJobs);
  await next(page).click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('toggle-sidebar')).toBeVisible();
  expect(await calls(page, 'start_run')).toHaveLength(0);
  // macOS: Überspringen first, Verbinden last.
  await open(page, `${MAC}&scenario=setup-profile`);
  await expect(ends.nth(0)).toHaveAttribute('data-testid', 'first-skip');
  await expect(ends.nth(1)).toHaveAttribute('data-testid', 'first-next');
});

test('Postfach connected (Enter is the primary): Fertig says everything is set up', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcdabcdabcdabcd');
  await page.keyboard.press('Enter');
  await expectStep(page, T.firstRun.done);
  expect(await calls(page, 'save_mailbox')).toHaveLength(1);
  // A setup resumed with a mailbox connected goes straight to Fertig.
  await open(page, `${WIN}&scenario=setup-mailbox`);
  await expectStep(page, T.firstRun.done);
  await expect(back(page)).toHaveCount(0);
});

test('the smallest window keeps every step usable', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, `${WIN}&scenario=setup-cv&step=profile`);
  await expectStep(page, T.firstRun.profile);
  await expect(next(page)).toBeInViewport();
  await expect(back(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(480);
  // A card longer than the window keeps its foot at the window's bottom edge.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expect(next(page)).toBeInViewport();
  await expect(back(page)).toBeInViewport();
});

test('the step heading stands at one height on every step of a card', async ({ page }) => {
  const top = async (): Promise<number> => (await heading(page).boundingBox())!.y;
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  const reading = await top();
  // The spinner and Fertig's ring are as large as a step's tile.
  const mark = (await page.getByTestId('cv-reading').boundingBox())!;
  for (const query of [
    'scenario=first-run',
    'scenario=first-run&step=upload',
    'scenario=first-run&step=done',
    'scenario=setup-profile',
    'scenario=setup-mailbox',
  ]) {
    await open(page, `${WIN}&${query}`);
    expect(await top(), query).toBeCloseTo(reading, 0);
  }
  await open(page, `${WIN}&scenario=first-run&step=done`);
  const ring = (await page.getByTestId('first-success').boundingBox())!;
  await open(page, `${WIN}&scenario=first-run&step=upload`);
  const tile = (await page.getByTestId('first-step').locator('.top > *').boundingBox())!;
  for (const box of [mark, ring]) {
    expect(box.width).toBeCloseTo(tile.width, 0);
    expect(box.height).toBeCloseTo(tile.height, 0);
  }
});
