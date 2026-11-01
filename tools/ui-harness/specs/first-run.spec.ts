// The setup (features/first-run) against the stub: a mode of the shell of its own, its seven
// steps from the table as cards on the cream (the profile a whole page), every switch of the
// view refused, Zurück (and the mouse's back button), Willkommen, the two ways, the CV's
// upload, evaluation, cancel and failures (back on the upload with the reason in a state
// box), "Dein Profil" whose Weiter marks what is missing red without a sentence, the optional
// Postfach (skipped or connected, its pair in the OS order), Fertig that says what was set up,
// resuming from what is stored, the smallest window, and that no step puts a caret in a field.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, motionSettled, open, settle, test } from './fixtures';
import { failNext, fillRequired, T, WIN, MAC } from './helpers';

const heading = (page: Page) => page.getByTestId('first-heading');
const next = (page: Page) => page.getByTestId('first-next');
const back = (page: Page) => page.getByTestId('first-back');
/** The fields that hold the caret: only a press on a field puts it there. */
const caret = (page: Page) => page.locator('input:focus, textarea:focus');
/** The rows marked red as required and still empty, in the order of the page. */
const marks = (page: Page): Promise<string[]> =>
  page
    .locator('[data-missing]')
    .evaluateAll((all) => all.map((cell) => cell.getAttribute('data-field') ?? ''));

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

test('Willkommen: the app mark, one job with its ring and Loslegen', async ({ page }) => {
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
});

test('every step starts with the focus on its heading: no field takes the caret', async ({
  page,
}) => {
  for (const query of [
    'scenario=first-run',
    'scenario=first-run&step=way',
    'scenario=first-run&step=upload',
    'scenario=first-run&step=profile&way=self',
    'scenario=setup-cv&step=profile',
    'scenario=setup-profile',
    'scenario=first-run&step=done',
  ]) {
    await open(page, `${WIN}&${query}`);
    await expect(heading(page), query).toBeFocused();
    await expect(caret(page), query).toHaveCount(0);
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
  // The whole Profil page: its six groups, without its head and the CV button; its own bar
  // with Zurück and Weiter.
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(page.locator('[data-section]')).toHaveCount(6);
  for (const gone of ['profile-heading', 'profile-from-cv']) {
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
  // Typed and not taken yet: Zurück takes it along.
  await roles.locator('input').fill('Interim CEO');
  await back(page).click();
  await expectStep(page, T.firstRun.way);
  await page.getByTestId('way-self').click();
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CEO');
});

test('Zurück keeps the address of the Postfach, never the password', async ({ page }) => {
  await open(page, '?scenario=setup-profile');
  await page.getByTestId('mailbox-user').fill('name@gmail.com');
  await page.getByTestId('mailbox-password').fill('abcd efgh ijkl mnop');
  await page.getByRole('button', { name: T.common.back }).click();
  await page.getByRole('button', { name: T.firstRun.next }).click();
  await expect(page.getByTestId('mailbox-user')).toHaveValue('name@gmail.com');
  await expect(page.getByTestId('mailbox-password')).toHaveValue('');
});

test('the mouse button is Zurück: it keeps what was typed too', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  const roles = page.getByTestId('profile-roles');
  await roles.locator('input').fill('Interim CEO');
  await mouseBack(page);
  await expectStep(page, T.firstRun.way);
  await page.getByTestId('way-self').click();
  await expect(roles).toContainText('Interim CEO');
});

test('what Weiter marked stays marked over Zurück, with the form that was typed in', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await next(page).click();
  const all = ['roles', 'competences', 'languages'];
  await expect.poll(() => marks(page)).toEqual(all);
  await back(page).click();
  await expectStep(page, T.firstRun.way);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  await expect.poll(() => marks(page)).toEqual(all);
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

test('Esc stops the evaluation like Abbrechen, with the focus on the step and nowhere', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await expect(heading(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.upload);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  // On the empty part of the step, past the scrollbar's room of the view.
  await page.locator('body').click({ position: { x: 20, y: 500 } });
  await page.keyboard.press('Escape');
  await expectStep(page, T.firstRun.upload);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
});

test('the Profil has the same Abbrechen: the evaluation stops and nothing is filled', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile&cv=slow`);
  const start = page.getByTestId('profile-from-cv');
  const busy = page.getByTestId('profile-cv-busy');
  const stop = page.getByTestId('cv-cancel');
  await expect(stop).toBeHidden();
  await start.click();
  await expect(busy).toHaveText(T.profile.cvBusy);
  await expect(stop).toHaveText(T.common.cancel);
  await expect(stop.locator('[data-icon]')).toHaveAttribute('data-icon', 'cancel');
  await stop.click();
  await expect(start).toBeVisible();
  await expect(busy).toBeHidden();
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  // The stop says nothing and fills nothing.
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  // From the keyboard the focus goes along, to Abbrechen and back: they have one place.
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(start).toBeFocused();
  // In the smallest window the head still holds it, beside its title.
  await page.setViewportSize({ width: 480, height: 360 });
  await start.click();
  const [title, busyBox, stopBox] = await Promise.all([
    page.getByTestId('profile-heading').boundingBox(),
    busy.boundingBox(),
    stop.boundingBox(),
  ]);
  expect(busyBox!.x).toBeGreaterThanOrEqual(title!.x + title!.width);
  expect(stopBox!.x + stopBox!.width).toBeLessThanOrEqual(480);
  await stop.click();
  // On the start page the cell goes with the evaluation: the focus goes back to its way.
  await open(page, `${WIN}&view=profile&scenario=no-profile&cv=slow`);
  const way = page.getByTestId('way-cv');
  await way.click();
  await expect(busy).toBeVisible();
  await stop.focus();
  await page.keyboard.press('Enter');
  await expect(stop).toHaveCount(0);
  await expect(way).toBeFocused();
});

test('a limit met before any file says only that, on the Profil like in the setup', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile&scenario=no-profile&cv=used`);
  await page.getByTestId('way-cv').click();
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.limit);
  await expect(page.getByTestId('cv-error')).not.toContainText(T.profile.cvFailed);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(0);
  // After a real try it says both.
  await open(page, `${WIN}&view=profile&scenario=no-profile&cv=offline`);
  await page.getByTestId('way-cv').click();
  await expect(page.getByTestId('cv-error')).toContainText(T.profile.cvFailed);
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.offline);
});

test('an old failure of the evaluation does not greet a new start', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run&step=upload&cv=unreadable`);
  await page.getByTestId('upload-zone').click();
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.unreadable);
  await back(page).click();
  await expectStep(page, T.firstRun.way);
  await page.getByTestId('way-cv').click();
  await expectStep(page, T.firstRun.upload);
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
  await expect(page.getByTestId('upload-zone')).toBeVisible();
  // What cannot run stays said.
  await open(page, `${WIN}&scenario=first-run&cv=used`);
  await toWays(page);
  await page.getByTestId('way-cv').click();
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.limit);
});

test('a setup resumed from a stored profile does not claim it came from a CV', async ({ page }) => {
  await open(page, `${WIN}&scenario=setup-profile`);
  await expectStep(page, T.firstRun.mailbox);
  await back(page).click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('first-lead')).toHaveText(T.firstRun.profileSelf);
  await back(page).click();
  await expectStep(page, T.firstRun.way);
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
  // The mouse's back button stops it the same way.
  await open(page, `${WIN}&scenario=first-run&step=reading`);
  await mouseBack(page);
  await expectStep(page, T.firstRun.upload);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
});

test('Weiter from the keyboard: the focus goes along to what is missing, a letter jumps nowhere', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=profile&way=self`);
  const roles = page.getByTestId('profile-roles').locator('input');
  await roles.click();
  await page.keyboard.type('Interim CFO');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => marks(page)).toEqual(['competences', 'languages']);
  const add = page.getByTestId('competences-add-button');
  await expect(add).toBeInViewport();
  await expect(caret(page)).toHaveCount(0);
  await page.keyboard.type('x');
  await expect(roles).toHaveValue('');
  await expect(add).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(add).toBeFocused();
});

test('Ab Datum with its day still empty holds Weiter up as little as the Profil', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run&step=profile&way=self`);
  await fillRequired(page);
  await page.getByTestId('profile-available').click();
  await page
    .getByRole('listbox')
    .getByRole('option', { name: T.profile.availability.from, exact: true })
    .click();
  await expect(page.getByTestId('profile-date')).toHaveValue('');
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  const form = await page.evaluate(() => window.__harness.form());
  expect(form?.available).toEqual({ kind: 'now' });
});

test("Weiter's failed save low on the page: its box comes into view", async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run&step=profile&way=self`);
  await fillRequired(page);
  await page.getByTestId('profile-form').evaluate((form) => {
    form.scrollIntoView({ block: 'end' });
  });
  await expect(heading(page)).not.toBeInViewport();
  await failNext(page, 'save_profile');
  await next(page).click();
  await expectStep(page, T.firstRun.profile);
  const box = page.getByTestId('profile-save-error');
  await expect(box).toHaveText(T.error.text('db', {}));
  await expect(box).toBeInViewport();
});

test('by hand: Weiter marks what is missing without a sentence; Esc does nothing', async ({
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
  // Weiter: the empty required fields are marked, the first comes into view without a caret, no
  // sentence names them; the step stays.
  await next(page).click();
  await expectStep(page, T.firstRun.profile);
  await expect.poll(() => marks(page)).toEqual(['roles', 'competences', 'languages']);
  await expect(roles).not.toBeFocused();
  await expect(caret(page)).toHaveCount(0);
  await expect(roles).toBeInViewport();
  await expect(page.getByTestId('profile-missing')).toHaveCount(0);
  // The orange is on the field itself and on the list's button; names and titles stay ink.
  const color = (node: Locator): Promise<string> =>
    node.evaluate((element) => getComputedStyle(element).color);
  const placeholder = (node: Locator): Promise<string> =>
    node.evaluate((element) => getComputedStyle(element, '::placeholder').color);
  const label = (name: string): Locator => page.locator(`[data-field~="${name}"] .label`).first();
  const title = (name: string): Locator => page.getByTestId(`section-${name}`).getByRole('heading');
  const tools = page.getByTestId('profile-tools').locator('input');
  const ink = await color(label('tools'));
  expect(await color(label('roles'))).toBe(ink);
  expect(await color(title('languages'))).toBe(await color(title('job')));
  expect(await placeholder(roles)).not.toBe(await placeholder(tools));
  const add = page.getByTestId('languages-add-button');
  await expect.poll(() => color(add)).not.toBe(ink);
  // A further Weiter leads to the next one, and the one after, then round again; still no caret.
  await next(page).click();
  await expect(page.getByTestId('section-competences')).toBeInViewport();
  await next(page).click();
  await expect(page.getByTestId('section-languages')).toBeInViewport();
  await next(page).click();
  await expect(roles).toBeInViewport();
  await expectStep(page, T.firstRun.profile);
  await expect(caret(page)).toHaveCount(0);
  // Filled, a row loses its mark at once.
  await roles.fill('Interim CFO');
  await roles.press('Enter');
  await expect.poll(() => marks(page)).toEqual(['competences', 'languages']);
  expect(await color(label('roles'))).toBe(ink);
  await fillRequired(page);
  await expect.poll(() => marks(page)).toEqual([]);
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  // Back to the profile (the mouse): what was typed is still there.
  await mouseBack(page);
  await expectStep(page, T.firstRun.profile);
  await expect(page.getByTestId('profile-roles')).toContainText('Interim CFO');
});

test('Dein Profil: Enter is the primary, on the step and in a field', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  // On the step (the focus on its heading): like Weiter, what is missing is marked.
  await expect(heading(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => marks(page)).toEqual(['roles', 'competences', 'languages']);
  await fillRequired(page);
  // In a field: nothing is missing now, so it goes on.
  const years = page.getByTestId('profile-years');
  await years.click();
  await years.fill('12');
  await years.press('Enter');
  await expectStep(page, T.firstRun.mailbox);
});

test('a held Enter presses once: it takes the chip and stays, it goes on and presses nothing there', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=setup-profile&step=profile&way=self`);
  await expectStep(page, T.firstRun.profile);
  const regions = page.getByTestId('profile-regions');
  const hold = async (): Promise<void> => {
    for (let repeat = 0; repeat < 3; repeat += 1) await page.keyboard.down('Enter');
  };
  await regions.locator('input').click();
  await page.keyboard.type('Bremen');
  await hold();
  await page.keyboard.up('Enter');
  await expect(regions.locator('[data-chip]').last()).toHaveAttribute('data-value', 'Bremen');
  await settle(page);
  await expectStep(page, T.firstRun.profile);
  // A fresh press on an empty field goes on, and the same hold never presses Verbinden.
  await page.keyboard.down('Enter');
  await expectStep(page, T.firstRun.mailbox);
  await hold();
  await page.keyboard.up('Enter');
  await settle(page);
  await expect(page.getByTestId('mailbox-user')).not.toHaveAccessibleDescription(
    T.settings.addressMissing,
  );
  await expect(page.getByTestId('mailbox-password')).not.toHaveAccessibleDescription(
    T.settings.passwordMissing(true),
  );
});

test('above the bar of Dein Profil the caret goes on with its field, the row taken above it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  const add = page.getByTestId('competences-add-button');
  await add.evaluate((node) => node.scrollIntoView({ block: 'end' }));
  // Pressed where they stand, right over the bar.
  const pressAt = async (target: Locator): Promise<void> => {
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await pressAt(add);
  const name = page.getByTestId('competence-add').locator('input');
  await expect(name).toBeVisible();
  await pressAt(name);
  await expect(name).toBeFocused();
  const bar = page.getByTestId('first-bar');
  for (const word of ['Treasury', 'Reporting']) {
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('competences').locator('[data-copy]').last()).toHaveText(word);
    await expect(name).toBeFocused();
    await expect
      .poll(async () => {
        const [input, foot] = [(await name.boundingBox())!, (await bar.boundingBox())!];
        return foot.y - (input.y + input.height);
      }, word)
      .toBeGreaterThan(0);
  }
});

test('after a press on Weiter Tab and Enter go on from the row it led to, no caret, no jump', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await expectStep(page, T.firstRun.profile);
  await next(page).click();
  await expect.poll(() => marks(page)).toEqual(['roles', 'competences', 'languages']);
  await next(page).click();
  const add = page.getByTestId('competences-add-button');
  await expect(add).toBeInViewport();
  await motionSettled(page);
  await expect(caret(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(add).toBeFocused();
  await expect(add).toBeInViewport();
  // Pressed once more, the row holds the focus again, and Enter is Weiter from there too.
  await next(page).click();
  const languages = page.getByTestId('languages-add');
  await expect(languages).toHaveAttribute('data-arrived', '');
  await expect(caret(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-field~="roles"]')).toHaveAttribute('data-arrived', '');
  await expect(caret(page)).toHaveCount(0);
});

test('Weiter waits while a value is wrong: said at its field, which comes into view, no caret', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await fillRequired(page);
  const wish = page.getByTestId('profile-wish-rate');
  await wish.fill('0');
  await next(page).click();
  await expectStep(page, T.firstRun.profile);
  await expect(page.locator('[data-field~="dayRateWish"]').getByRole('alert')).toHaveText(
    T.profile.field.atLeast(1),
  );
  await expect(wish).toBeInViewport();
  await expect(caret(page)).toHaveCount(0);
  expect(await calls(page, 'save_profile')).toHaveLength(0);
  await wish.fill('1.000');
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  expect(await calls(page, 'save_profile')).toHaveLength(1);
});

test('a save that fails at Weiter stays on the step and says so above the form', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  await toWays(page);
  await page.getByTestId('way-self').click();
  await fillRequired(page);
  await failNext(page, 'save_profile');
  await next(page).click();
  await expect(page.getByTestId('profile-save-error')).toHaveText(T.error.text('db', {}));
  await expectStep(page, T.firstRun.profile);
  // Weiter again goes on: nothing typed was lost.
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  expect((await page.evaluate(() => window.__harness.form()))?.roles).toEqual(['Interim CFO']);
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
  // No caret in its first field, and the form in rows: in the card's narrow box each label
  // above its control, one row under the other, the provider short, the link under its field.
  await expect(caret(page)).toHaveCount(0);
  await animationsDone(page);
  const boxOf = async (node: Locator) => (await node.boundingBox())!;
  const labels = page.getByTestId('mailbox-form').locator('label');
  await expect(labels).toHaveCount(3);
  const provider = await boxOf(page.getByTestId('mailbox-provider'));
  const user = await boxOf(page.getByTestId('mailbox-user'));
  const password = await boxOf(page.getByTestId('mailbox-password'));
  const link = await boxOf(page.getByTestId('create-password'));
  const [first, second, third] = [
    await boxOf(labels.nth(0)),
    await boxOf(labels.nth(1)),
    await boxOf(labels.nth(2)),
  ];
  expect(provider.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(second.y).toBeGreaterThanOrEqual(provider.y + provider.height);
  expect(user.y).toBeGreaterThanOrEqual(second.y + second.height);
  expect(third.y).toBeGreaterThanOrEqual(user.y + user.height);
  expect(password.y).toBeGreaterThanOrEqual(third.y + third.height);
  expect(link.y).toBeGreaterThanOrEqual(password.y + password.height);
  expect(provider.width).toBeLessThan(user.width);
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
  // macOS: the skip first, the connect last.
  await open(page, `${MAC}&scenario=setup-profile`);
  await expect(ends.nth(0)).toHaveAttribute('data-testid', 'first-skip');
  await expect(ends.nth(1)).toHaveAttribute('data-testid', 'first-next');
});

test('Postfach: its lead never tears the word Alert-Mails across its lines', async ({ page }) => {
  for (const width of [1360, 480]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, `${WIN}&scenario=setup-profile`);
    const tops = await page.getByTestId('first-lead').evaluate((lead) => {
      const text = lead.firstChild as Text;
      const word = /Alert\S+Mails/.exec(text.data)!;
      const range = document.createRange();
      range.setStart(text, word.index);
      range.setEnd(text, word.index + word[0].length);
      return [...range.getClientRects()].map((part) => Math.round(part.top));
    });
    expect(new Set(tops).size, `${width} wide`).toBe(1);
  }
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

/** The Postfach with a Verbinden that signs in and goes on doing so, begun by a press on its
 *  button or by Enter in the password field. */
async function connecting(page: Page, by: 'press' | 'enter' = 'press'): Promise<void> {
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.evaluate(() => (window.__harness.holdMailbox = true));
  await page.getByTestId('mailbox-user').fill('alerts.demo@gmail.com');
  const password = page.getByTestId('mailbox-password');
  await password.fill('abcdabcdabcdabcd');
  if (by === 'enter') await password.press('Enter');
  else await next(page).click();
  await expect(next(page)).toHaveAttribute('aria-busy', 'true');
}

/** Esc stops it and the step stays, quietly. */
async function escStops(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(next(page)).not.toHaveAttribute('aria-busy', 'true');
  await expectStep(page, T.firstRun.mailbox);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await expect(page.getByTestId('mailbox-form').getByRole('alert')).toHaveCount(0);
}

test('Zurück, Überspringen and Esc stop a Verbinden that goes', async ({ page }) => {
  await connecting(page);
  await back(page).click();
  await expectStep(page, T.firstRun.profile);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await connecting(page);
  await page.getByTestId('first-skip').click();
  await expectStep(page, T.firstRun.doneProfile);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  await connecting(page, 'enter');
  await escStops(page);
});

test('Esc stops a Verbinden begun by a press on its button too', async ({ page }) => {
  await connecting(page);
  await escStops(page);
});

test('the mouse button is Zurück: it stops a Verbinden that goes too', async ({ page }) => {
  await connecting(page);
  await mouseBack(page);
  await expectStep(page, T.firstRun.profile);
  expect(await calls(page, 'cancel_run')).toHaveLength(1);
  // The step stays where the user went, and nothing was connected: Fertig says so.
  await page.evaluate(() => (window.__harness.holdMailbox = false));
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.profile);
  expect(await calls(page, 'finish_onboarding')).toHaveLength(0);
  await next(page).click();
  await expectStep(page, T.firstRun.mailbox);
  await expect(next(page)).not.toHaveAttribute('aria-busy', 'true');
  await page.getByTestId('first-skip').click();
  await expectStep(page, T.firstRun.doneProfile);
});

test('a Verbinden that signs in after Zurück moves no step', async ({ page }) => {
  await connecting(page);
  // The stop comes too late (here it fails): the sign-in ends all the same and finds the user gone.
  await failNext(page, 'cancel_run');
  await back(page).click();
  await expectStep(page, T.firstRun.profile);
  const loads = (await calls(page, 'app_state')).length;
  await page.evaluate(() => (window.__harness.holdMailbox = false));
  await expect.poll(async () => (await calls(page, 'app_state')).length).toBeGreaterThan(loads);
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.profile);
  expect(await calls(page, 'finish_onboarding')).toHaveLength(0);
});

test('a Weiter whose save answers after Zurück moves no step', async ({ page }) => {
  await open(page, `${WIN}&scenario=setup-profile&step=profile`);
  await page.getByTestId('profile-years').fill('12');
  // Both in one task, so the save is under way when Zurück goes.
  await page.evaluate(() => {
    for (const id of ['first-next', 'first-back']) {
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click();
    }
  });
  await expectStep(page, T.firstRun.upload);
  await expect.poll(async () => (await calls(page, 'save_profile')).length).toBe(1);
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.upload);
});

test('Postfach: a field refers to its message only while one shows', async ({ page }) => {
  await open(page, `${WIN}&scenario=setup-profile`);
  const fields = [page.getByTestId('mailbox-user'), page.getByTestId('mailbox-password')];
  for (const field of fields) await expect(field).not.toHaveAttribute('aria-describedby');
  await next(page).click();
  await expect(fields[0]!).toHaveAccessibleDescription(T.settings.addressMissing);
  await expect(fields[1]!).toHaveAccessibleDescription(T.settings.passwordMissing(true));
  // Typing takes a field's sentence away, and its reference with it.
  await fields[1]!.pressSequentially('x');
  await expect(fields[1]!).not.toHaveAttribute('aria-describedby');
  await expect(fields[0]!).toHaveAccessibleDescription(T.settings.addressMissing);
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

test('a double click goes one step: the tile under the pointer after it is not pressed', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=first-run`);
  // Loslegen: the two ways come, neither is chosen by the second click.
  await next(page).dblclick();
  await expectStep(page, T.firstRun.way);
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.way);
  // The CV: the upload comes, its zone is not pressed (no file dialog, no reading).
  await page.getByTestId('way-cv').dblclick();
  await expectStep(page, T.firstRun.upload);
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.upload);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(0);
  // Überspringen: Fertig comes, its button in the same place is not pressed.
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('first-skip').dblclick();
  await expectStep(page, T.firstRun.doneProfile);
  await page.waitForTimeout(300);
  await expectStep(page, T.firstRun.doneProfile);
  await expect(page.getByTestId('view-jobs')).toHaveCount(0);
});

/* ---------------------------------------------------------------- the bar of Dein Profil */

/** The bar of Dein Profil reaches both edges of the window, its column stands on the page's
 *  column above it, and the view ends where the bar starts: nothing can lie under it. */
async function expectBarUnderTheView(page: Page): Promise<void> {
  const bar = page.getByTestId('first-bar');
  await expect(bar).toBeVisible();
  await motionSettled(page);
  const edges = (
    node: Locator,
  ): Promise<{ left: number; right: number; top: number; bottom: number }> =>
    node.evaluate((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    });
  const box = await edges(bar);
  expect(box.left).toBe(0);
  expect(box.right).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  expect(box.bottom).toBe(await page.evaluate(() => document.documentElement.clientHeight));
  expect((await edges(page.getByTestId('view-first-run'))).bottom).toBe(box.top);
  const column = await edges(page.getByTestId('first-profile').locator('.column'));
  const inner = await edges(bar.locator('.inner'));
  expect(inner.left).toBe(column.left);
  expect(inner.right).toBe(column.right);
}

test('the bar of Dein Profil stands under the view, across the whole window', async ({ page }) => {
  await open(page, `${WIN}&scenario=setup-cv&step=profile`);
  await expectBarUnderTheView(page);
  await open(page, `${MAC}&scenario=setup-cv&step=profile`);
  await expectBarUnderTheView(page);
});

test('beside a real scrollbar the bar of Dein Profil still reaches the edge of the window', async ({
  playwright,
  baseURL,
  browserName,
}) => {
  // Windows only (WebView2): macOS's overlay scrollbars take no room.
  test.skip(browserName !== 'chromium', 'classic scrollbars are Chromium on Windows');
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const page = await browser.newPage({
      ...(baseURL ? { baseURL } : {}),
      viewport: { width: 1360, height: 860 },
      locale: 'de-DE',
    });
    await open(page, `${WIN}&scenario=first-run&step=profile&way=self`);
    const view = page.getByTestId('view-first-run');
    expect(
      await view.evaluate((node) => (node as HTMLElement).offsetWidth - node.clientWidth),
    ).toBeGreaterThan(0);
    await expectBarUnderTheView(page);
    // At a narrow page too, with the column's narrow sides.
    await page.setViewportSize({ width: 480, height: 360 });
    await expectBarUnderTheView(page);
  } finally {
    await browser.close();
  }
});

test('a press on the bar of Dein Profil leaves Enter with Weiter, as on the rest of the step', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=setup-cv&step=profile`);
  await expect.poll(() => marks(page)).toEqual([]);
  const bar = (await page.getByTestId('first-bar').boundingBox())!;
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.keyboard.press('Enter');
  await expect.poll(() => marks(page)).not.toEqual([]);
});

test('Tab keeps every control of Dein Profil clear of the bar at its foot', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 640 });
  await open(page, `${WIN}&scenario=setup-cv&step=profile`);
  const top = await page
    .getByTestId('first-bar')
    .evaluate((bar) => bar.getBoundingClientRect().top);
  const below: string[] = [];
  let reached = 0;
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press('Tab');
    await settle(page);
    const focused = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement;
      return {
        name: node.getAttribute('data-testid') ?? node.id ?? node.tagName,
        inBar: node.closest('[data-testid="first-bar"]') !== null,
        bottom: node.getBoundingClientRect().bottom,
      };
    });
    if (focused.inBar) break;
    reached += 1;
    if (focused.bottom > top)
      below.push(`${focused.name} ends at ${focused.bottom}, bar at ${top}`);
  }
  expect(reached).toBeGreaterThan(20);
  expect(below).toEqual([]);
});
