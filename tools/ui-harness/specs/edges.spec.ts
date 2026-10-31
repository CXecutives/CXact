// Edge cases across the screens: the reader's terms, the search over every word, the form's
// values and what it does with them, undo and the end of a run.

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { animationsDone, calls, expect, NOW, open, runFinished, test } from './fixtures';
import { failNext, reveal, stubList, T } from './helpers';

const WIN = '?platform=windows';
const list = (page: Page) => page.getByTestId('job-list');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const stage = (page: Page) => page.getByTestId('stage');

/** A moment longer than a changed value waits before it saves (--save-delay). */
const T_SAVE = 400;
/** What the saves of the form have sent so far, in their order. */
const saves = async (page: Page): Promise<ProfileSave[]> =>
  (await calls(page, 'save_profile')).map(([, args]) => (args as { save: ProfileSave }).save);
/** The page's last word to the backend (`set_unsaved`): the form holds what is not saved. */
const unsaved = (page: Page): Promise<boolean> => page.evaluate(() => window.__harness.unsaved);
/** Takes the caret out of the field that holds it: what it holds saves now. */
const leaveField = (page: Page): Promise<void> =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

/** The next save is refused like core refuses a value (`profileValue`). */
async function refuseNextSave(page: Page, field: string, max: number): Promise<void> {
  await page.evaluate(
    ({ field, max }) => {
      const calls = window.__harness.calls;
      const push = calls.push.bind(calls);
      calls.push = (...items: [string, unknown][]) => {
        if (items.some(([name]) => name === 'save_profile')) {
          calls.push = push;
          push(...items);
          throw { kind: 'invalid', params: { reason: 'profileValue', field, row: null, max } };
        }
        return push(...items);
      };
    },
    { field, max },
  );
}

/** From the page's end, `field` out of sight, the way to Einstellungen asks, Abbrechen stays. */
async function leaveAndStay(page: Page, field: Locator, question: string): Promise<void> {
  const view = page.getByTestId('view-profile');
  await view.evaluate((node) => node.scrollTo(0, node.scrollHeight));
  await expect(field).not.toBeInViewport();
  await page.getByTestId('nav-settings').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(question);
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(view).toBeVisible();
}

test('the reader shows the ad rate and start without a profile minimum', async ({ page }) => {
  const rate = T.facts.pay(1200, 'day', 'EUR').replace(/\s/g, ' ');
  await open(page, `${WIN}&scenario=no-minimum`);
  await row(page, 'freelancermap-2801').click();
  // The profile sets neither a minimum rate nor a start: the ad's values join the line.
  const line = stage(page).getByTestId('criteria');
  await expect(line).toContainText(rate);
  await expect(line).toContainText(T.facts.now);
  // With a minimum the criterion chip says the rate, and no fact repeats it.
  await open(page, WIN);
  await row(page, 'freelancermap-2801').click();
  const clean = stage(page).getByTestId('criteria');
  await expect(clean).toContainText(rate);
  const text = async () => (await clean.textContent())?.replace(/\s/g, ' ') ?? '';
  await expect.poll(async () => (await text()).split(rate).length).toBe(2);
});

test('the search matches every word in any field and the portal name', async ({ page }) => {
  await open(page, WIN);
  const search = page.getByTestId('search');
  // Two words that do not stand next to each other, in two fields.
  await search.fill('bremen CONTROLLING');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'linkedin-4100200301')).toBeVisible();
  await search.fill('controlling berlin');
  await expect(page.getByTestId('empty-search').locator('h3')).toHaveText(
    T.list.noHit('controlling berlin'),
  );
  await expect(rows(page)).toHaveCount(0);
  // The portal's name narrows to its jobs, and the archive's hits are named under them.
  await search.fill('linkedin bremen');
  // Named like its place in the sidebar, no count.
  await expect(page.getByTestId('also-archive')).toHaveText(T.place.archive);
  const keys = await rows(page).evaluateAll((all) => all.map((r) => r.dataset.testid ?? ''));
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.every((key) => key.startsWith('job-row-linkedin-'))).toBe(true);
});

test('a decimal number is cut to a whole one, never joined', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const years = await reveal(page, page.getByTestId('profile-years'));
  await years.fill('7,5');
  await expect(page.getByTestId('profile-years-rounded')).toHaveCount(0);
  await page.getByTestId('profile-min-rate').focus();
  await expect(years).toHaveValue('7');
  await expect(page.getByTestId('profile-years-rounded')).toHaveText(T.profile.field.roundedWhole);
  await (await reveal(page, page.getByTestId('competence-years'))).first().fill('2.5');
  // Left, the form saves by itself: the whole numbers are what goes.
  await leaveField(page);
  await expect
    .poll(async () => {
      const after = (await saves(page)).at(-1)?.after;
      return [after?.years, after?.competences[0]?.years];
    })
    .toEqual([7, 2]);
});

test('text typed into a chip field is a change: leaving takes it, closing saves it first', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const tools = (await reveal(page, page.getByTestId('profile-tools'))).locator('input');
  await tools.fill('Miro');
  // Typed, not yet a chip: the backend knows it is unsaved, and nothing goes while it is typed.
  await expect.poll(() => unsaved(page)).toBe(true);
  // Ctrl+S is no key of the app either.
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(T_SAVE);
  expect((await saves(page)).length).toBe(0);
  // Left, the text is a chip and saves by itself.
  await leaveField(page);
  await expect.poll(async () => (await saves(page)).at(-1)?.after.tools).toContain('Miro');
  await expect(tools).toHaveValue('');
  await expect.poll(() => unsaved(page)).toBe(false);

  // Closing the window with typed text saves it, and nothing asks.
  await (await reveal(page, page.getByTestId('profile-regions'))).locator('input').fill('Berlin');
  // The backend knows it (the page's `set_unsaved`) before the window closes.
  await expect.poll(() => unsaved(page)).toBe(true);
  await page.evaluate(() => window.__harness.requestClose());
  await expect.poll(() => page.evaluate(() => window.__harness.closed)).toBe(true);
  expect((await saves(page)).at(-1)?.after.regions).toContain('Berlin');
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
});

test("the note of a competence's years only grows its row downward", async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const years = (await reveal(page, page.getByTestId('competence-years'))).first();
  const before = (await years.boundingBox())!;
  await years.fill('2.5');
  await leaveField(page);
  const note = page.getByTestId('competence-years-rounded');
  await expect(note).toHaveText(T.profile.field.roundedWhole);
  // The field keeps its width and the note stands under it, not beside it.
  const after = (await years.boundingBox())!;
  expect(after.width).toBe(before.width);
  expect((await note.boundingBox())!.y).toBeGreaterThanOrEqual(after.y + after.height);
});

test('staying with a value that holds the save brings its field back, without the caret', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('200000');
  await leaveAndStay(page, rate, T.profile.leaveWrong(T.profile.field.dayRateMin));
  // Marked and in view; the user clicks where they want to type (design round 7).
  await expect(page.locator('[data-field~="dayRateMin"]')).toContainText(
    T.profile.field.atMost(100_000),
  );
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(rate).toBeInViewport();
  await expect(rate).not.toBeFocused();
  // Nothing went: it holds the save.
  expect((await saves(page)).length).toBe(0);
});

test('a value refused on the way out asks too; staying brings its field back, without the caret', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('1.300');
  await refuseNextSave(page, 'dayRateMin', 1250);
  await leaveAndStay(page, rate, T.profile.leaveWrong(T.profile.field.dayRateMin));
  await expect(page.locator('[data-field~="dayRateMin"]')).toContainText(
    T.profile.field.atMost(1250),
  );
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(rate).toBeInViewport();
  await expect(rate).not.toBeFocused();
  // Not tried again by itself; changed, it saves.
  await page.waitForTimeout(T_SAVE);
  expect((await saves(page)).length).toBe(1);
  await rate.fill('1.200');
  await leaveField(page);
  await expect.poll(async () => (await saves(page)).at(-1)?.after.dayRateMin).toBe(1200);
});

test('a wrong day rate out of sight holds no save', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('200000');
  await leaveField(page);
  await expect(page.locator('[data-field~="dayRateMin"]')).toContainText(
    T.profile.field.atMost(100_000),
  );
  // Without Projekt und Interim the day rates are out of sight, and the form saves as ever.
  await page.getByTestId('contract-project').click();
  await expect(rate).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__harness.form()?.project)).toBe(false);
  await expect(page.getByTestId('profile-save-error')).toHaveCount(0);
  // The next change goes too, and leaving asks nothing.
  await page.getByTestId('profile-years').fill('21');
  await leaveField(page);
  await expect.poll(() => page.evaluate(() => window.__harness.form()?.years)).toBe(21);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
});

test('a save that fails on the way out asks, none goes behind the question, staying says why', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-min-rate').fill('1.300');
  await failNext(page, 'save_profile');
  await page.getByTestId('nav-settings').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(T.profile.leaveFailed);
  // While it asks whether to drop the change, the change is not saved behind it.
  await page.waitForTimeout(T_SAVE);
  expect((await saves(page)).length).toBe(1);
  await dialog.getByTestId('dialog-cancel').click();
  await expect(page.getByTestId('profile-save-error')).toHaveText(T.error.text('db', {}));
  // The next way out saves first and goes.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  expect((await saves(page)).at(-1)?.after.dayRateMin).toBe(1300);
});

test('closing with a save that fails asks too; nothing goes behind the question, not by itself after it', async ({
  page,
}) => {
  const close = (): Promise<void> => page.evaluate(() => window.__harness.requestClose());
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('profile-min-rate').fill('1.300');
  await expect.poll(() => unsaved(page)).toBe(true);
  await failNext(page, 'save_profile');
  await close();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(T.profile.leaveFailed);
  // While it asks, neither a second close nor a file dropped on the page saves behind it.
  await close();
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await page.waitForTimeout(T_SAVE);
  expect((await saves(page)).length).toBe(1);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(0);
  expect(await page.evaluate(() => window.__harness.closed)).toBe(false);
  await dialog.getByTestId('dialog-cancel').click();
  await expect(page.getByTestId('profile-save-error')).toHaveText(T.error.text('db', {}));
  await page.waitForTimeout(T_SAVE);
  expect((await saves(page)).length).toBe(1);
  // The next change takes it along, and the note goes.
  await page.getByTestId('profile-years').fill('21');
  await leaveField(page);
  await expect.poll(async () => (await saves(page)).at(-1)?.after.years).toBe(21);
  expect((await saves(page)).at(-1)?.after.dayRateMin).toBe(1300);
  await expect(page.getByTestId('profile-save-error')).toHaveCount(0);
});

test('a way that waited for the question goes with its Abbrechen: the page opens at its kept place', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await open(page, `${WIN}&mail=offline&tick=15`);
  await page.getByTestId('fetch').click();
  await runFinished(page);
  await page.getByTestId('nav-profile').click();
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('0');
  // "Postfach prüfen" of that fetch waits for the question, which is cancelled.
  await page.getByTestId('toast-action').filter({ hasText: T.run.checkMailbox }).click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await dialog.getByTestId('dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  // Mended and saved, Einstellungen chosen later opens at its top, not at the Postfach.
  await rate.fill('1.300');
  await leaveField(page);
  await expect.poll(async () => (await saves(page)).length).toBe(1);
  await page.getByTestId('nav-settings').click();
  const view = page.getByTestId('view-settings');
  await expect(view).toBeVisible();
  await page.waitForTimeout(T_SAVE);
  expect(await view.evaluate((node) => node.scrollTop)).toBe(0);
});

test("a select's open list: the wheel over it moves nothing behind it, beside it closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const select = await reveal(page, page.getByTestId('profile-work-mode'));
  await select.click();
  const options = page.getByRole('listbox');
  await expect(options).toBeVisible();
  await animationsDone(page);
  const view = page.getByTestId('view-profile');
  const top = (): Promise<number> => view.evaluate((node) => node.scrollTop);
  const before = await top();
  const over = (await options.boundingBox())!;
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect(await top()).toBe(before);
  await expect(options).toBeVisible();
  // Beside it, over the row's label, the page scrolls and the list goes, like every menu: it
  // never hangs in the air away from its select.
  const beside = (await select.boundingBox())!;
  await page.mouse.move(beside.x - 100, beside.y + beside.height / 2);
  await page.mouse.wheel(0, 120);
  await expect.poll(top).toBeGreaterThan(before);
  await expect(options).toHaveCount(0);
});

test('a row whose exclusion changes in place stands with the scored rows', async ({ page }) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  await row(page, 'linkedin-4100200305').click();
  await stage(page).getByTestId('reader-include').click();
  const drawn = async () =>
    list(page)
      .locator('[data-key]')
      .evaluateAll((all) => all.map((item) => (item as HTMLElement).dataset.key ?? ''));
  // The counted row now stands above the divider, among the scored rows.
  await expect
    .poll(async () => {
      const order = await drawn();
      const index = order.indexOf('linkedin:4100200305');
      return index > 0 && index < order.length - 1;
    })
    .toBe(true);
  await expect(
    page.getByTestId('job-rows').getByTestId('job-row-linkedin-4100200305'),
  ).toBeVisible();
});

test('deleting the open job for good opens the next one', async ({ page }) => {
  await open(page, WIN);
  // The Papierkorb's rows as the stub lists them.
  const [first, next] = (await stubList(page, { place: 'trash' })).active as [string, string];
  await page.getByTestId('place-trash').click();
  await row(page, first).click();
  await expect(list(page).locator('[data-open]')).toHaveAttribute(
    'data-key',
    first.replace('-', ':'),
  );
  await row(page, first).click({ button: 'right' });
  await page.getByTestId('menu-item-purge').click();
  await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
  await expect(row(page, first)).toHaveCount(0);
  await expect(list(page).locator('[data-open]')).toHaveAttribute(
    'data-key',
    next.replace('-', ':'),
  );
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await row(page, next).locator('.title').innerText(),
  );
});

test('one column: closing shows the open row again, with the focus', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await open(page, WIN);
  await rows(page).nth(6).click();
  const key = await list(page).locator('[data-open]').getAttribute('data-key');
  await page.getByTestId('history-back').click();
  const item = list(page).locator(`[data-key="${key}"]`);
  await expect(item).toBeInViewport();
  await expect(item.locator('[data-testid^="job-row-"]')).toBeFocused();
});

test('typing a country that is chosen already says nothing and Enter clears it', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const input = page.getByTestId('profile-countries').locator('input');
  await input.fill('Österreich');
  await expect(page.getByTestId('profile-countries-none')).toHaveCount(0);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('profile-countries').locator('.chip')).toHaveCount(2);
});

test('undoing moves in another order puts the rows back where they stood', async ({ page }) => {
  await open(page, WIN);
  const keys = async () =>
    (await rows(page).evaluateAll((all) => all.map((r) => r.dataset.testid ?? ''))).slice(0, 3);
  await expect(rows(page).first()).toBeVisible();
  const before = await keys();
  for (const [index, id] of before.slice(0, 2).entries()) {
    const key = id.replace('job-row-', '');
    await row(page, key).click({ button: 'right' });
    await page.getByTestId('menu-item-archive').click();
    await page.waitForTimeout(550);
    // Later than the 2 s in which moves join one toast.
    await page.clock.setFixedTime(new Date(NOW.getTime() + (index + 1) * 5_000));
  }
  const toasts = page.getByTestId('toast');
  await expect(toasts).toHaveCount(2);
  // The older toast first, then the newer one.
  await toasts.first().getByRole('button', { name: T.common.undo }).click();
  await page.waitForTimeout(300);
  await toasts.last().getByRole('button', { name: T.common.undo }).click();
  await expect.poll(keys).toEqual(before);
});

test('the end of a run keeps the jobs read in Aktuell, the open one in its place', async ({
  page,
}) => {
  await open(page, WIN);
  const keys = async () => rows(page).evaluateAll((all) => all.map((r) => r.dataset.testid ?? ''));
  await expect(rows(page).first()).toBeVisible();
  const before = await keys();
  const first = before[0]!.replace('job-row-', '');
  const third = before[2]!.replace('job-row-', '');
  await row(page, first).click();
  await row(page, third).click();
  await page.getByTestId('fetch').click();
  await runFinished(page);
  const after = await keys();
  // Both read jobs are still listed, in the list's order.
  expect(after).toContain(`job-row-${first}`);
  expect(after.indexOf(`job-row-${first}`)).toBeLessThan(after.indexOf(`job-row-${third}`));
  await expect(list(page).locator('[data-open]')).toHaveAttribute(
    'data-key',
    third.replace('-', ':'),
  );
});

test('with the focus nowhere the arrows, Home and End scroll Profil too', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, WIN);
  await page.getByTestId('nav-profile').click();
  const view = page.getByTestId('view-profile');
  const top = (): Promise<number> => view.evaluate((node) => node.scrollTop);
  await page.locator('#profile-section-job-heading').click();
  await page.keyboard.press('ArrowDown');
  await expect.poll(top).toBeGreaterThan(0);
  await page.keyboard.press('End');
  await expect
    .poll(() => view.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(1);
  await page.keyboard.press('Home');
  await expect.poll(top).toBe(0);
});
