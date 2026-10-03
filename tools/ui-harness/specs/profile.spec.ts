// The Profil view against the stub, in one spec: the head (the title, the CV button, what is
// still open, the dots of the CV), the jump links, the form as the table
// of sections.ts lays it out (three sections on one page, each field with its words and
// control, the info symbols at their places), the two ways in, the CV and its failures, the
// save bar that shows only while something changed, saving (answered by a toast), discarding,
// leaving and closing with unsaved changes, values that hold the save, refused values, a
// quiet hint where values contradict each other, and "Häufig verlangt". The stub's demo
// profile looks for Interim CFO roles in Germany and Austria (projects and permanent roles),
// from 1 September 2026, and is complete.

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { DEMO } from './demo';
import { calls, expect, expectShot, open, runFinished, settle, test } from './fixtures';
import { chooseWay, failNext, fillRequired, showTab as show, T, WIN } from './helpers';

/** The Profil view: `query` after the Windows platform (`&scenario=…`), or a whole query. */
async function profile(page: Page, query = ''): Promise<void> {
  read.delete(page);
  await open(page, query.startsWith('?') ? query : `${WIN}${query}`);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible();
}

/** The empty form from the start page ("Selbst ausfüllen"). */
async function create(page: Page, scenario = 'no-profile'): Promise<void> {
  await profile(page, `&scenario=${scenario}`);
  await chooseWay(page, 'empty');
  await expect(page.getByTestId('profile-form')).toBeVisible();
}

const save = (page: Page): Locator => page.getByTestId('profile-save');
const discard = (page: Page): Locator => page.getByTestId('profile-discard');
const chips = (field: Locator): Locator => field.locator('.chip .text');
const bar = (page: Page): Locator => page.getByTestId('profile-save-bar');
const field = (page: Page, name: string): Locator => page.locator(`[data-field~="${name}"]`);
const label = (scope: Locator): Locator => scope.locator('.top .label').first();
const countries = (page: Page): Locator => page.getByTestId('profile-countries');
const countryInput = (page: Page): Locator => countries(page).locator('input');
const options = (page: Page): Locator => page.getByTestId('profile-countries-options');
const roles = (page: Page): Locator => page.getByTestId('profile-roles');
const saves = async (page: Page): Promise<number> => (await calls(page, 'save_profile')).length;
const contract = (page: Page, id: string): Locator => page.getByTestId(`profile-contract-${id}`);
const menuItem = (page: Page, id: string): Locator => page.getByTestId(`menu-item-${id}`);

/** The toast that answers a save (with what its rescore changed, when it did). */
const savedToast = (page: Page): Locator =>
  page.getByTestId('toast').filter({ hasText: T.profile.saved });

/** The next save_profile is refused like core refuses a value (`profileValue`). */
async function refuseNext(
  page: Page,
  params: { field: string; row: number | null; max: number | null },
): Promise<void> {
  await page.evaluate((refused) => {
    const calls = window.__harness.calls;
    const push = calls.push.bind(calls);
    calls.push = (...items: [string, unknown][]) => {
      if (items.some(([name]) => name === 'save_profile')) {
        calls.push = push;
        push(...items);
        throw { kind: 'invalid', params: { reason: 'profileValue', ...refused } };
      }
      return push(...items);
    };
  }, params);
}

/** The competences marked as Schwerpunkt (their star pressed), in the order of the rows. */
async function marked(page: Page): Promise<string[]> {
  return page
    .getByTestId('competence-row')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.querySelector('[data-testid="competence-star"][aria-pressed="true"]'))
        .map(
          (row) => row.querySelector<HTMLInputElement>('[data-testid="competence-name"]')!.value,
        ),
    );
}

/** How many saves of the page a test has read (the next read waits for a newer one). */
const read = new WeakMap<Page, number>();

/** The save the last action sent, once it has reached the stub. */
async function lastSave(page: Page): Promise<ProfileSave> {
  const before = read.get(page) ?? 0;
  await expect.poll(() => saves(page)).toBeGreaterThan(before);
  const all = await calls(page, 'save_profile');
  read.set(page, all.length);
  return (all.at(-1)![1] as { save: ProfileSave }).save;
}

/** The tooltip of an element after hovering it. */
async function tooltipOf(page: Page, target: Locator): Promise<string> {
  await target.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  return (await tip.textContent()) ?? '';
}

// ------------------------------------------------------------------ the head

test('the head: "Profil" with "Aus Lebenslauf ausfüllen", no menu of profiles', async ({
  page,
}) => {
  await profile(page);
  const head = page.getByTestId('profile-head');
  await expect(page.getByTestId('profile-heading')).toHaveText(T.profile.title);
  const cv = page.getByTestId('profile-from-cv');
  await expect(cv).toHaveText(T.profile.fromCv);
  // Speichern is the view's one primary.
  await expect(cv).toHaveClass(/secondary/);
  await expect(head.getByRole('button')).toHaveCount(1);
  // A complete profile without a CV: nothing open, no dots, no lines.
  await expect(page.getByTestId('profile-open')).toHaveCount(0);
  await expect(page.getByTestId('profile-ai-filled')).toHaveCount(0);
  await expect(page.getByTestId('field-mark')).toHaveCount(0);
});

test('three sections on one page in their order; the jump links lead to each', async ({ page }) => {
  await profile(page);
  const ids = ['search', 'skills', 'exclusions'] as const;
  await expect(page.locator('[data-section]')).toHaveCount(3);
  for (const [index, id] of ids.entries()) {
    const section = page.locator('[data-section]').nth(index);
    await expect(section).toHaveAttribute('data-section', id);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(T.profile.section[id]);
  }
  const jumps = page.getByTestId('profile-jumps');
  await expect(jumps.getByRole('button')).toHaveText(ids.map((id) => T.profile.section[id]));
  // A jump puts its heading at the top, under the links, which stay in view.
  await page.getByTestId('profile-jump-exclusions').click();
  const heading = page.getByTestId('section-exclusions').getByRole('heading');
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
  await expect(jumps).toBeInViewport();
  const links = (await jumps.boundingBox())!;
  await expect
    .poll(async () => (await heading.boundingBox())!.y)
    .toBeGreaterThanOrEqual(links.y + links.height - 1);
  await page.getByTestId('profile-jump-search').click();
  await expect(page.getByTestId('section-search').getByRole('heading')).toBeFocused();
});

test('each field under its section with its label', async ({ page }) => {
  await profile(page);
  const words = T.profile.field;
  const layout: Record<string, [string, string][]> = {
    search: [
      ['roles', words.roles],
      ['permanent', words.contracts],
      ['dayRateWish', words.dayRateWish],
      ['dayRateMin', words.dayRateMin],
      ['minSalary', words.minSalary],
      ['workMode', words.workMode],
      ['countries', words.countries],
      ['regions', words.regions],
      ['available', words.available],
      ['workload', words.workload],
      ['minMonths', words.minMonths],
    ],
    skills: [
      ['competences', words.competences],
      ['tools', words.tools],
      ['years', words.totalYears],
      ['industries', words.industries],
      ['languages', words.languages],
      ['degrees', words.degrees],
      ['certificates', words.certificates],
    ],
    exclusions: [['exclusionWords', words.exclusionWords]],
  };
  for (const [section, fields] of Object.entries(layout)) {
    const scope = page.getByTestId(`section-${section}`);
    await expect(scope.locator(':scope [data-field]')).toHaveCount(fields.length);
    for (const [name, text] of fields) {
      await expect(label(scope.locator(`[data-field~="${name}"]`)), name).toHaveText(text);
    }
  }
  // Side by side: the rates, the countries and regions, the selects, the degrees and
  // certificates.
  for (const [a, b] of [
    ['dayRateWish', 'dayRateMin'],
    ['countries', 'regions'],
    ['workload', 'minMonths'],
    ['degrees', 'certificates'],
  ]) {
    const [left, right] = [
      await field(page, a!).boundingBox(),
      await field(page, b!).boundingBox(),
    ];
    expect(Math.abs(left!.y - right!.y), `${a} ${b}`).toBeLessThan(2);
    expect(right!.x).toBeGreaterThan(left!.x + left!.width);
  }
});

test('the stored profile fills every field', async ({ page }) => {
  await profile(page);
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(contract(page, 'project')).toHaveAttribute('aria-pressed', 'true');
  await expect(contract(page, 'permanent')).toHaveAttribute('aria-pressed', 'true');
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('profile-wish-rate')).toHaveValue('1.200');
  await expect(page.getByTestId('profile-min-rate')).toHaveValue('1.100');
  await expect(page.getByTestId('profile-min-salary')).toHaveValue('');
  await expect(
    page.getByTestId('profile-work-mode').getByRole('radio', { checked: true }),
  ).toHaveText(T.profile.workMode.remote);
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  await expect(chips(page.getByTestId('profile-regions'))).toHaveText(['Hamburg']);
  await expect(page.getByTestId('profile-date')).toHaveValue('01.09.2026');
  await expect(page.getByTestId('profile-workload')).toContainText(T.profile.workload.any);
  await expect(page.getByTestId('profile-min-months')).toContainText(T.profile.minMonths[6]);
  await expect(page.getByTestId('competence-name')).toHaveCount(6);
  expect(await marked(page)).toEqual(['Controlling', 'Konzernrechnungslegung nach IFRS']);
  await expect(page.getByTestId('competence-years').first()).toHaveValue('12');
  await expect(chips(page.getByTestId('profile-tools'))).toContainText(['SAP S/4HANA']);
  await expect(page.getByTestId('profile-years')).toHaveValue('20');
  await expect(chips(page.getByTestId('profile-industries'))).toHaveText([
    'Maschinenbau',
    'Automotive',
    'Chemie',
  ]);
  await expect(page.getByTestId('language-name')).toHaveText(['Deutsch', 'Englisch']);
  await expect(page.getByTestId('language-level')).toHaveText([
    T.profile.level.native,
    T.profile.level.B2,
  ]);
  await expect(chips(page.getByTestId('profile-degrees'))).toHaveText(['Diplom-Kauffrau (Univ.)']);
  await expect(chips(page.getByTestId('profile-certificates'))).toHaveText([
    'Certified Interim Manager (DDIM)',
  ]);
  await expect(chips(page.getByTestId('profile-exclusion-words'))).toHaveText([
    'Werkstudent',
    'Praktikum',
  ]);
  await expect(bar(page)).toHaveCount(0);
});

test('info symbols only at their places, their sentence on hover, keyboard focus and click', async ({
  page,
}) => {
  await profile(page);
  const places: [string, keyof typeof T.profile.info, string][] = [
    ['roles', 'roles', T.profile.field.roles],
    ['permanent', 'contracts', T.profile.field.contracts],
    ['dayRateWish', 'dayRate', T.profile.field.dayRateWish],
    ['workMode', 'workMode', T.profile.field.workMode],
    ['countries', 'countries', T.profile.field.countries],
    ['competences', 'competences', T.profile.field.competences],
    ['industries', 'industries', T.profile.field.industries],
    ['exclusionWords', 'exclusionWords', T.profile.field.exclusionWords],
  ];
  const tips = page.getByTestId('profile-form').getByTestId('info-tip');
  await expect(tips).toHaveCount(places.length);
  for (const [name, info, words] of places) {
    const tip = field(page, name).getByTestId('info-tip').first();
    await expect(tip, name).toHaveAccessibleName(T.common.infoAbout(words));
    expect(await tooltipOf(page, tip)).toBe(T.profile.info[info]);
  }
  // A click shows it at once and a second one hides it; Tab shows it too.
  const tip = field(page, 'roles').getByTestId('info-tip');
  const bubble = page.getByRole('tooltip');
  await page.mouse.move(0, 0);
  await expect(bubble).toHaveCount(0);
  await tip.dispatchEvent('click');
  await expect(bubble).toHaveText(T.profile.info.roles);
  await tip.dispatchEvent('click');
  await expect(bubble).toHaveCount(0);
  await field(page, 'roles').locator('input').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tip).toBeFocused();
  await expect(bubble).toHaveText(T.profile.info.roles);
});

// ------------------------------------------------------------------ the controls

test('Vertragsart: Projekt und Interim always ticked, the others toggle; the salary comes with them', async ({
  page,
}) => {
  await profile(page);
  const project = contract(page, 'project');
  await expect(project).toHaveText(T.profile.contract.project);
  await expect(project).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, project)).toBe(T.profile.contractFixed);
  // Ticked ones show the check, the others the plus.
  await expect(contract(page, 'permanent').locator('[data-icon]')).toHaveAttribute(
    'data-icon',
    'check',
  );
  await expect(contract(page, 'temporary').locator('[data-icon]')).toHaveAttribute(
    'data-icon',
    'add',
  );
  const salary = page.getByTestId('profile-min-salary');
  await expect(salary).toBeVisible();
  await contract(page, 'permanent').click();
  await expect(salary).toHaveCount(0);
  await contract(page, 'temporary').click();
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-pressed', 'true');
  await expect(salary).toBeVisible();
  await salary.fill('90000');
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after).toMatchObject({ permanent: false, temporary: true, minSalary: 90000 });
  // Without both the salary is not kept.
  await contract(page, 'temporary').click();
  await save(page).click();
  expect((await lastSave(page)).after).toMatchObject({ temporary: false, minSalary: null });
});

test('the rates side by side; a wish under the minimum says so quietly', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-wish-rate').fill('900');
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.belowMinRate);
  // The info symbol gives way to the hint (never both).
  await expect(field(page, 'dayRateWish').getByTestId('info-tip')).toHaveCount(0);
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await expect(field(page, 'dayRateWish')).not.toContainText(T.profile.field.belowMinRate);
  await expect(field(page, 'dayRateWish').getByTestId('info-tip')).toHaveCount(1);
});

test('Arbeitsmodell and Verfügbar ab are segments, Auslastung and Mindestlaufzeit selects', async ({
  page,
}) => {
  await profile(page);
  const modes = page.getByTestId('profile-work-mode').getByRole('radio');
  await expect(modes).toHaveText(Object.values(T.profile.workMode));
  await modes.filter({ hasText: T.profile.workMode.hybrid }).click();
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: T.profile.availability.now })
    .click();
  await page.getByTestId('profile-workload-open').click();
  await expect(page.getByRole('menuitemradio')).toHaveText(Object.values(T.profile.workload));
  await menuItem(page, 'fulltime').click();
  await expect(page.getByTestId('profile-workload')).toContainText(T.profile.workload.fulltime);
  await page.getByTestId('profile-min-months-open').click();
  await expect(page.getByRole('menuitemradio')).toHaveText(Object.values(T.profile.minMonths));
  await menuItem(page, '12').click();
  await save(page).click();
  expect((await lastSave(page)).after).toMatchObject({
    workMode: 'hybrid',
    available: { kind: 'now' },
    workload: 'fulltime',
    minMonths: 12,
  });
});

test('Länder: the list opens with Deutschland, Österreich and Schweiz first; typing finds', async ({
  page,
}) => {
  await profile(page);
  await countryInput(page).focus();
  // The chosen ones are not offered again: Schweiz leads, then the rest by name.
  const listed = options(page).getByRole('option');
  await expect(listed.first()).toHaveText('Schweiz');
  await expect(listed.nth(1)).toHaveText('Belgien');
  await page.keyboard.press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  // By either name, Enter takes the first match.
  await countryInput(page).fill('Switz');
  await expect(listed).toHaveText(['Schweiz']);
  await page.keyboard.press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await countryInput(page).fill('Atlantis');
  await expect(page.getByTestId('profile-countries-none')).toHaveText(T.profile.field.countryNone);
  await countryInput(page).fill('');
  await save(page).click();
  expect((await lastSave(page)).after.countries).toEqual(['DE', 'AT', 'CH']);
  // A new profile starts with Deutschland.
  await create(page);
  await expect(chips(countries(page))).toHaveText(['Deutschland']);
  await countries(page).getByRole('button', { name: 'Deutschland entfernen' }).click();
  await countryInput(page).focus();
  await expect(listed.first()).toHaveText('Deutschland');
  await expect(listed.nth(1)).toHaveText('Österreich');
  await expect(listed.nth(2)).toHaveText('Schweiz');
});

test('Regionen suggest the regions of Germany, Austria and Switzerland; typed text stays', async ({
  page,
}) => {
  await profile(page);
  const input = page.getByTestId('profile-regions').locator('input');
  await input.fill('Ober');
  const hints = page.getByTestId('profile-regions-suggestions').getByRole('option');
  await expect(hints).toContainText(['Oberösterreich']);
  await hints.filter({ hasText: 'Oberösterreich' }).click();
  await input.fill('Rheinhessen');
  await input.press('Enter');
  await expect(chips(page.getByTestId('profile-regions'))).toHaveText([
    'Hamburg',
    'Oberösterreich',
    'Rheinhessen',
  ]);
});

test('at most five Schwerpunkte: the star says what a click does, a sixth waits', async ({
  page,
}) => {
  await profile(page);
  const stars = page.getByTestId('competence-star');
  await expect(page.getByTestId('focus-count')).toHaveText('2/5');
  await expect(stars.nth(1)).toHaveAccessibleName(T.profile.field.unstar);
  await expect(stars.nth(0)).toHaveAccessibleName(T.profile.field.star);
  for (const index of [0, 3, 4]) await stars.nth(index).click();
  await expect(page.getByTestId('focus-count')).toHaveText('5/5');
  await expect(stars.nth(5)).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, stars.nth(5))).toBe(T.profile.field.focusFull);
  // A row without a competence has no star to give yet.
  await page.getByTestId('competence-add').click();
  await expect(stars.nth(6)).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, stars.nth(6))).toBe(T.profile.field.starEmpty);
  await stars.nth(1).click();
  await expect(stars.nth(5)).not.toHaveAttribute('aria-disabled', 'true');
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after.competences.filter((row) => row.focus).map((row) => row.name)).toEqual([
    'Interim Management',
    'Konzernrechnungslegung nach IFRS',
    'Konsolidierung',
    'Liquiditätsplanung',
  ]);
  // The empty row is not saved.
  expect(sent.after.competences).toHaveLength(6);
});

test('Branchen: a star marks a preferred industry', async ({ page }) => {
  await profile(page);
  const industries = page.getByTestId('profile-industries');
  const star = industries.getByTestId('chip-star');
  await expect(star).toHaveCount(3);
  await expect(star.first()).toHaveAccessibleName(T.profile.field.prefer('Maschinenbau'));
  await expect(star.first()).toHaveAttribute('aria-pressed', 'false');
  await star.first().click();
  await expect(star.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(star.first()).toHaveAccessibleName(T.profile.field.unprefer('Maschinenbau'));
  // A new industry starts without one; removing one keeps the others' stars.
  await industries.locator('input').fill('Energie');
  await industries.locator('input').press('Enter');
  await industries.getByRole('button', { name: 'Automotive entfernen' }).click();
  await save(page).click();
  expect((await lastSave(page)).after.industries).toEqual([
    { name: 'Maschinenbau', preferred: true },
    { name: 'Chemie', preferred: false },
    { name: 'Energie', preferred: false },
  ]);
});

test('Sprachen: a menu adds a common language at B2, the level in plain words', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('language-add').click();
  // The common languages not chosen yet.
  await expect(menuItem(page, 'language-Deutsch')).toHaveCount(0);
  await menuItem(page, 'language-Französisch').click();
  await expect(page.getByTestId('language-name')).toHaveText([
    'Deutsch',
    'Englisch',
    'Französisch',
  ]);
  await expect(page.getByTestId('language-level').nth(2)).toHaveText(T.profile.level.B2);
  await page.getByTestId('language-level-open').nth(2).click();
  await expect(page.getByRole('menuitemradio')).toHaveText(Object.values(T.profile.level));
  await menuItem(page, 'A2').click();
  // The language of a row is a select too.
  await page.getByTestId('language-name-open').nth(1).click();
  await menuItem(page, 'Spanisch').click();
  await page.getByTestId('language-remove').first().click();
  await save(page).click();
  expect((await lastSave(page)).after.languages).toEqual([
    { language: 'Spanisch', level: 'B2' },
    { language: 'Französisch', level: 'A2' },
  ]);
});

// ------------------------------------------------------------------ what is still open

test('"Noch n Angaben offen": "Zum ersten" puts the caret there, the count follows the form', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-incomplete');
  const open = page.getByTestId('profile-open');
  await expect(open).toContainText(T.profile.open(2));
  await page.getByTestId('profile-to-first').click();
  await expect(roles(page).locator('input')).toBeFocused();
  await roles(page).locator('input').fill('Interim CFO');
  await roles(page).locator('input').press('Enter');
  await expect(open).toContainText(T.profile.open(1));
  await page.getByTestId('profile-to-first').click();
  await expect(page.getByTestId('language-add')).toBeFocused();
  await page.getByTestId('language-add').click();
  await menuItem(page, 'language-Deutsch').click();
  await expect(open).toHaveCount(0);
  await save(page).click();
  await lastSave(page);
  await expect.poll(() => page.evaluate(() => window.__harness.form()?.languages.length)).toBe(1);
  await expect(open).toHaveCount(0);
});

// ------------------------------------------------------------------ the CV

test('"Aus Lebenslauf ausfüllen" fills and saves at once; dots mark what the CV filled', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-incomplete');
  const cv = page.getByTestId('profile-from-cv');
  await cv.click();
  await expect(cv).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.filled })).toBeVisible();
  expect(await calls(page, 'profile_from_cv')).toHaveLength(1);
  expect(await saves(page)).toBe(0);
  // Merged: what was there stays, the CV's names come after.
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(page.getByTestId('competence-name').first()).toHaveValue('Controlling');
  await expect(page.getByTestId('language-name')).toHaveText(['Deutsch', 'Englisch']);
  await expect(page.getByTestId('profile-open')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  // The fields the CV fills carry the dot, the head says once what it means.
  await expect(page.getByTestId('profile-ai-filled')).toHaveText(T.profile.aiFilled);
  for (const name of ['roles', 'competences', 'tools', 'languages']) {
    await expect(field(page, name).getByTestId('field-mark'), name).toHaveAccessibleName(
      T.profile.aiFilled,
    );
  }
  for (const name of ['permanent', 'dayRateMin', 'countries', 'exclusionWords']) {
    await expect(field(page, name).getByTestId('field-mark'), name).toHaveCount(0);
  }
  // Until the next save.
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await save(page).click();
  await lastSave(page);
  await expect(page.getByTestId('field-mark')).toHaveCount(0);
  await expect(page.getByTestId('profile-ai-filled')).toHaveCount(0);
});

test('"Aus Lebenslauf ausfüllen" waits while the form holds changes', async ({ page }) => {
  await profile(page);
  const cv = page.getByTestId('profile-from-cv');
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await expect(cv).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, cv)).toBe(T.profile.saveFirst);
  await discard(page).click();
  await expect(cv).not.toHaveAttribute('aria-disabled', 'true');
});

test('a CV that fills nothing says why in one sentence, with its way on', async ({ page }) => {
  const cases: [string, keyof typeof T.profile.cvError, string | null][] = [
    ['limit', 'limit', null],
    ['offline', 'offline', T.common.retry],
    ['timeout', 'timeout', T.common.retry],
    ['unreadable', 'unreadable', T.profile.otherFile],
    ['tooBig', 'tooLarge', T.profile.otherFile],
    ['unavailable', 'paused', null],
    ['outdated', 'outdated', null],
  ];
  for (const [cv, reason, again] of cases) {
    await profile(page, `&scenario=no-profile&cv=${cv}`);
    await page.getByTestId('new-profile-cv').click();
    const error = page.getByTestId('cv-error');
    await expect(error, cv).toContainText(T.profile.cvError[reason]);
    await expect(error.getByTestId('cv-again')).toHaveCount(again === null ? 0 : 1);
    if (again !== null) await expect(error.getByTestId('cv-again')).toHaveText(again);
    // Nothing stored; "Selbst ausfüllen" stays the way.
    expect(await saves(page)).toBe(0);
    await expect(page.getByTestId('new-profile-empty')).toBeVisible();
  }
  // Another try runs the CV again.
  await page.getByTestId('nav-jobs').click();
  await profile(page, '&scenario=no-profile&cv=offline');
  await page.getByTestId('new-profile-cv').click();
  await page.getByTestId('cv-again').click();
  await expect.poll(async () => (await calls(page, 'profile_from_cv')).length).toBe(2);
  // A closed dialog says nothing.
  await profile(page, '&scenario=no-profile&cv=none');
  await page.getByTestId('new-profile-cv').click();
  await expect.poll(async () => (await calls(page, 'profile_from_cv')).length).toBe(1);
  await expect(page.getByTestId('new-profile-cv')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
});

// ------------------------------------------------------------------ the ways in

test('no profile: the start page with its two ways, each with its own button', async ({ page }) => {
  await profile(page, '&scenario=no-profile');
  await expect(page.getByTestId('profile-start-heading')).toHaveText(T.profile.title);
  const ways = page.getByTestId('new-profile-ways');
  await expect(ways.getByTestId('new-profile-way-cv')).toContainText(T.profile.fromCv);
  await expect(ways.getByTestId('new-profile-way-cv')).toContainText(T.profile.fromCvHint);
  await expect(ways.getByTestId('new-profile-way-empty')).toContainText(T.profile.byHand);
  await expect(ways.getByRole('button')).toHaveText([T.profile.pickCv, T.profile.startEmpty]);
  // The CV makes the profile: the form shows it as stored.
  await chooseWay(page, 'cv');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(bar(page)).toHaveCount(0);
});

test('Selbst ausfüllen: the empty form, Esc back while untouched; saved once complete', async ({
  page,
}) => {
  await create(page);
  await expect(roles(page).locator('input')).toBeFocused();
  await expect(page.getByTestId('competence-row')).toHaveCount(1);
  await expect(page.getByTestId('language-row')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await chooseWay(page, 'empty');
  await fillRequired(page);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after).toMatchObject({
    roles: ['Interim CFO'],
    permanent: true,
    temporary: true,
    countries: ['DE'],
    competences: [{ name: 'Controlling', years: null, focus: false }],
    languages: [{ language: 'Deutsch', level: 'B2' }],
  });
  await expect(page.getByTestId('profile-open')).toHaveCount(0);
});

test('a profile edited into broken JSON says so and where, with its folder', async ({ page }) => {
  await profile(page, '&scenario=profile-broken');
  const empty = page.getByTestId('profile-empty');
  await expect(empty).toContainText('Profil nicht lesbar');
  await expect(empty).toContainText(
    'Die Datei ist beschädigt (Zeile 12). Ein neues Profil ersetzt die Datei.',
  );
  await empty.getByTestId('profile-folder').click();
  expect((await calls(page, 'open_target')).at(-1)![1]).toEqual({
    target: { kind: 'profileDir' },
  });
  await chooseWay(page, 'empty');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('new-profile-cv')).toBeFocused();
});

// ------------------------------------------------------------------ saving

test('edit and discard: the form goes back to what is stored, the bar leaves', async ({ page }) => {
  await profile(page);
  await expect(bar(page)).toHaveCount(0);
  await roles(page).locator('input').fill('Interim CTO');
  await roles(page).locator('input').press('Enter');
  await expect(bar(page)).toBeVisible();
  await contract(page, 'temporary').click();
  await discard(page).click();
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page)).toHaveCount(0);
  expect(await saves(page)).toBe(0);
});

test('edit and save: both forms go to the backend, the toast answers', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-min-rate').fill('1.250');
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Bilanzierung');
  await tools.press('Enter');
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: T.profile.availability.from, exact: true })
    .click();
  await page.getByTestId('profile-date').fill('1.11.2026');
  const words = page.getByTestId('profile-exclusion-words');
  await words.getByRole('button', { name: 'Praktikum entfernen' }).click();
  await words.locator('input').fill('Trainee');
  await words.locator('input').press('Enter');
  // No word about what is unsaved: the bar itself says it.
  await expect(bar(page)).toHaveText(/^\s*(Speichern\s*Verwerfen|Verwerfen\s*Speichern)\s*$/);
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.before.dayRateMin).toBe(1100);
  expect(sent.after.dayRateMin).toBe(1250);
  expect(sent.after.tools.at(-1)).toBe('Bilanzierung');
  expect(sent.after.available).toEqual({ kind: 'from', date: '01.11.2026' });
  expect(sent.after.exclusionWords).toEqual(['Werkstudent', 'Trainee']);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByTestId('profile-date')).toHaveValue('01.11.2026');
});

test('the toast of a save says what the rescore changed, only the parts that did', async ({
  page,
}) => {
  // The demo profile saved again moves no job: the toast says only that it is saved.
  await profile(page);
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await save(page).click();
  await expect(savedToast(page).getByTestId('toast-text')).toHaveText(T.profile.saved);
  // A first profile scores the jobs of Aktuell: the ones now high and the excluded ones.
  await create(page);
  await fillRequired(page);
  await save(page).click();
  await lastSave(page);
  const { counts } = await page.evaluate(() => window.__harness.list({ place: 'inbox' }));
  const high = (
    await page.evaluate(() => window.__harness.list({ place: 'inbox', bands: ['high'] }))
  ).counts.inbox;
  expect(high).toBeGreaterThan(0);
  await expect(savedToast(page).getByTestId('toast-text')).toHaveText(
    T.profile.savedEffect(high, counts.excluded),
  );
  expect(T.profile.savedEffect(0, 1)).toBe('Profil gespeichert, 1 Job ausgeschlossen');
  expect(T.profile.savedEffect(0, 0)).toBe(T.profile.saved);
});

test('a value too large is said at its field and holds the save', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('200000');
  await expect(field(page, 'dayRateMin')).toContainText(T.profile.field.atMost(100000));
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, save(page))).toBe(T.profile.fixFirst);
  await rate.press('Enter');
  expect(await saves(page)).toBe(0);
  // A 0 is no rate a job could meet.
  await rate.fill('0');
  await expect(field(page, 'dayRateMin')).toContainText(T.profile.field.atLeast(1));
  await rate.fill('1.300');
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await save(page).click();
  await expect.poll(() => saves(page)).toBe(1);
});

test('a value the backend refuses is said at its field, which gets the caret', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-years').fill('25');
  await refuseNext(page, { field: 'years', row: null, max: 70 });
  await save(page).click();
  await expect(field(page, 'years')).toContainText(T.profile.field.atMost(70));
  await expect(page.getByTestId('profile-years')).toBeFocused();
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  // Changed, the error goes.
  await page.getByTestId('profile-years').fill('24');
  await expect(field(page, 'years')).not.toContainText(T.profile.field.atMost(70));
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
});

test('leaving with unsaved changes asks once; cancel stays, discard leaves, save saves', async ({
  page,
}) => {
  await profile(page);
  const wish = page.getByTestId('profile-wish-rate');
  await wish.fill('1.300');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(T.profile.leaveHeading);
  await expect(dialog.locator('p')).toHaveCount(0);
  await expect(dialog.getByRole('button')).toHaveText(['Speichern', 'Verwerfen', 'Abbrechen']);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(wish).toHaveValue('1.300');
  await page.getByTestId('nav-settings').click();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await expect(wish).toHaveValue('1.200');
  await wish.fill('1.400');
  await page.getByTestId('nav-settings').click();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  expect((await lastSave(page)).after.dayRateWish).toBe(1400);
});

test('closing the window with unsaved changes asks; without any it closes at once', async ({
  page,
}) => {
  await profile(page);
  const closed = (): Promise<boolean> => page.evaluate(() => window.__harness.closed);
  const requestClose = (): Promise<void> => page.evaluate(() => window.__harness.requestClose());
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(false);
  await requestClose();
  expect(await closed()).toBe(true);
  await page.evaluate(() => (window.__harness.closed = false));
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(true);
  await requestClose();
  const dialog = page.getByTestId('dialog-leave-profile');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await closed()).toBe(false);
  await requestClose();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(closed).toBe(true);
  expect((await lastSave(page)).after.dayRateWish).toBe(1300);
});

// ------------------------------------------------------------------ keys

test('Enter in a field saves the form; lists and chips keep their Enter', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-min-rate').press('Enter');
  expect(await saves(page)).toBe(0);
  for (const [id, value] of [
    ['profile-min-rate', '1.300'],
    ['profile-years', '21'],
  ] as const) {
    const before = await saves(page);
    await page.getByTestId(id).fill(value);
    await page.getByTestId(id).press('Enter');
    await expect.poll(() => saves(page), id).toBe(before + 1);
    await expect(bar(page)).toHaveCount(0);
  }
  // The day: Enter judges it while it does not read.
  const date = page.getByTestId('profile-date');
  await date.fill('31.02.2026');
  await date.press('Enter');
  await expect(field(page, 'available')).toContainText(T.profile.field.dateImpossible);
  expect(await saves(page)).toBe(2);
  await date.fill('01.12.2026');
  await date.press('Enter');
  await expect.poll(() => saves(page)).toBe(3);
  // A chip field adds what was typed; a row goes to the next row.
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await expect(chips(page.getByTestId('profile-tools')).last()).toHaveText('Miro');
  await page.getByTestId('competence-name').first().press('Enter');
  await expect(page.getByTestId('competence-name').nth(1)).toBeFocused();
  expect(await saves(page)).toBe(3);
});

test('Enter goes through the rows and never saves; on an empty last row it moves on', async ({
  page,
}) => {
  await profile(page);
  const names = page.getByTestId('competence-name');
  await page.getByTestId('competence-years').nth(5).press('Enter');
  await expect(names).toHaveCount(7);
  await expect(names.nth(6)).toBeFocused();
  await names.nth(6).fill('Konzernabschluss');
  await names.nth(6).press('Enter');
  await expect(names).toHaveCount(8);
  await names.nth(7).press('Enter');
  await expect(names).toHaveCount(7);
  await expect(page.getByTestId('profile-tools').locator('input')).toBeFocused();
  expect(await saves(page)).toBe(0);
});

// ------------------------------------------------------------------ numbers and the day

test('money is grouped like everywhere; cents count whole, and say so', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await expect(rate).toHaveValue('1.100');
  await rate.fill('1250');
  await expect(rate).toHaveValue('1250');
  await page.getByTestId('profile-years').focus();
  await expect(rate).toHaveValue('1.250');
  await rate.fill('950,50');
  await page.getByTestId('profile-years').focus();
  await expect(rate).toHaveValue('950');
  await expect(page.getByTestId('profile-min-rate-rounded')).toHaveText(T.profile.field.rounded);
  await save(page).click();
  expect((await lastSave(page)).after.dayRateMin).toBe(950);
});

test('the day exists only for "Datum", gets the caret and is judged when left or saved', async ({
  page,
}) => {
  await profile(page);
  const choices = page.getByTestId('profile-available');
  const date = page.getByTestId('profile-date');
  const day = field(page, 'available');
  await choices.getByRole('radio', { name: T.profile.availability.now }).click();
  await expect(date).toHaveCount(0);
  await choices.getByRole('radio', { name: T.profile.availability.from, exact: true }).click();
  await expect(date).toBeFocused();
  await date.fill('1.11.202');
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  await page.getByTestId('profile-years').focus();
  await expect(day).toContainText(T.profile.field.dateInvalid);
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await date.fill('15.11.2026');
  await page.getByTestId('profile-years').focus();
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  // The calendar beside it writes a day in its form.
  await page.getByTestId('profile-date-calendar').click();
  await page
    .getByTestId('profile-date-calendar-popover')
    .locator('[data-day="2026-11-20"]')
    .click();
  await expect(date).toHaveValue('20.11.2026');
  await save(page).click();
  expect((await lastSave(page)).after.available).toEqual({ kind: 'from', date: '20.11.2026' });
});

// ------------------------------------------------------------------ the terms the jobs ask for

const asked = (page: Page): Locator => page.getByTestId('asked');
/** The terms of the rows "Häufig verlangt", in their order. */
const askedWords = (page: Page): Promise<string[]> =>
  page
    .getByTestId('asked-term')
    .evaluateAll((all) => all.map((term) => term.getAttribute('data-term') ?? ''));
/** The button of a term. */
const askedRow = (page: Page, term: string): Locator =>
  page.locator(`[data-testid="asked-term"][data-term="${term}"]`);

/** The demo jobs whose reader names `term` as the term of an open requirement. */
const askingJobs = (term: string): number =>
  Object.values(DEMO.details).filter((detail) =>
    detail.match?.reasons.some((reason) => reason.kind === 'open' && reason.params.term === term),
  ).length;

test('"Häufig verlangt" under its field: the terms the jobs ask for, each where it goes', async ({
  page,
}) => {
  await profile(page);
  await show(page, asked(page).first());
  expect(await calls(page, 'asked_terms')).toHaveLength(1);
  const tools = field(page, 'tools');
  const block = tools.getByTestId('asked');
  await expect(block).toHaveAttribute('data-for', 'tool');
  await expect(block).toContainText(T.profile.asked);
  const words = await askedWords(page);
  expect(words.length).toBeGreaterThan(0);
  expect(words.length).toBeLessThanOrEqual(8);
  expect(new Set(words).size).toBe(words.length);
  for (const [term, kind, key] of [
    ['Energie', 'industry', 'industries'],
    ['SAP Analytics Cloud', 'tool', 'tools'],
    ['Anaplan', 'tool', 'tools'],
  ] as const) {
    const row = askedRow(page, term);
    await expect(row).toHaveCount(1);
    await expect(page.locator(`[data-field~="${key}"] [data-for="${kind}"]`)).toContainText(term);
    const count = Number(await row.getByTestId('asked-add').locator('.count').textContent());
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(askingJobs(term));
  }
  const stored = (await page.evaluate(() => window.__harness.form()))!;
  const names = [
    ...stored.competences.map((c) => c.name),
    ...stored.tools,
    ...stored.industries.map((i) => i.name),
  ].map((name) => name.toLowerCase());
  for (const term of words) expect(names).not.toContain(term.toLowerCase());
});

test('"Hinzufügen" puts the term into its field, an unsaved change like any other', async ({
  page,
}) => {
  await profile(page);
  const tools = chips(page.getByTestId('profile-tools'));
  const industries = chips(page.getByTestId('profile-industries'));
  await askedRow(page, 'Anaplan').getByTestId('asked-add').click();
  await expect(tools.last()).toHaveText('Anaplan');
  await expect(askedRow(page, 'Anaplan')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await discard(page).click();
  await expect(askedRow(page, 'Anaplan')).toHaveCount(1);
  await askedRow(page, 'Energie').getByTestId('asked-add').click();
  await expect(industries.last()).toHaveText('Energie');
  await askedRow(page, 'Anaplan').getByTestId('asked-add').click();
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.after.tools).toContain('Anaplan');
  expect(sent.after.industries).toContainEqual({ name: 'Energie', preferred: false });
  expect(sent.before.tools).not.toContain('Anaplan');
});

test('a row goes with its last term; a focused term hands the focus on, then to its field', async ({
  page,
}) => {
  await profile(page);
  const block = field(page, 'tools').getByTestId('asked');
  const words = await block
    .getByTestId('asked-term')
    .evaluateAll((all) => all.map((term) => term.getAttribute('data-term') ?? ''));
  expect(words.length).toBeGreaterThan(1);
  const add = block.getByTestId('asked-add');
  for (let left = words.length; left > 1; left -= 1) {
    await add.first().focus();
    await page.keyboard.press('Enter');
    await expect(add).toHaveCount(left - 1);
    await expect(add.first()).toBeFocused();
  }
  await add.first().focus();
  await page.keyboard.press('Enter');
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('profile-tools').locator('input')).toBeFocused();
});

test('the rows ask again after a fetch; without an answer they stay away', async ({ page }) => {
  await profile(page);
  await expect(asked(page).first()).toBeVisible();
  const before = (await calls(page, 'asked_terms')).length;
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  await expect.poll(async () => (await calls(page, 'asked_terms')).length).toBeGreaterThan(before);
  read.delete(page);
  await open(page, WIN);
  await failNext(page, 'asked_terms');
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect.poll(async () => (await calls(page, 'asked_terms')).length).toBeGreaterThan(0);
  await expect(asked(page)).toHaveCount(0);
});

// ------------------------------------------------------------------ baselines

test('baseline: profile', async ({ page }) => {
  await profile(page);
  await settle(page);
  await expectShot(page, 'profile');
});

test('baseline: no profile yet', async ({ page }) => {
  await profile(page, '&scenario=no-profile');
  await expectShot(page, 'profile-empty');
});
