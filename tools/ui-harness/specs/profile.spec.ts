// The Profil view against the stub, in one spec: the head (the title and the CV button, which
// opens the file dialog at once), the bar at the foot (Verwerfen and Speichern only while
// something changed), the red marks of required fields that are still empty, the form as the
// table of sections.ts lays it out (six groups on one page, each field a row with its label
// beside it, the info symbols at their places), the boxes of entries, the two ways in, the
// CV and its failures, saving (answered by a toast), discarding,
// leaving and closing with unsaved changes, values that hold the save, refused values, a
// quiet hint where values contradict each other. The stub's demo
// profile looks for Interim CFO roles in Germany and Austria (projects and permanent roles),
// from 1 September 2026, and is complete.

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { calls, expect, expectShot, open, runFinished, settle, test } from './fixtures';
import { adder, chooseWay, fillRequired, T, WIN } from './helpers';

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
const field = (page: Page, name: string): Locator => page.locator(`[data-field~="${name}"]`);
const label = (scope: Locator): Locator => scope.locator('.top .label').first();
const countries = (page: Page): Locator => page.getByTestId('profile-countries');
const countryInput = (page: Page): Locator => countries(page).locator('input');
const options = (page: Page): Locator => page.getByTestId('profile-countries-options');
const roles = (page: Page): Locator => page.getByTestId('profile-roles');
const saves = async (page: Page): Promise<number> => (await calls(page, 'save_profile')).length;
/** A contract type of Vertragsart (a checkbox of the choice of several). */
const contract = (page: Page, id: 'project' | 'permanent' | 'temporary'): Locator =>
  page.getByTestId(`contract-${id}`);
/** The bar of unsaved changes at the foot. */
const bar = (page: Page): Locator => page.getByTestId('profile-save-bar');
/** The fields marked red as required and still empty. */
const marked = (page: Page): Promise<string[]> =>
  page
    .locator('[data-missing]')
    .evaluateAll((all) => all.map((cell) => cell.getAttribute('data-field') ?? ''));
/** "Aus Lebenslauf ausfüllen": the file dialog of the CV, at once. */
async function pickCv(page: Page): Promise<void> {
  await page.getByTestId('profile-from-cv').click();
}
/** The names of an item list's rows (`competences`, `languages`). */
const names = (page: Page, list: 'competences' | 'languages'): Locator =>
  page.getByTestId(list).locator('[data-copy]');

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
  // From outside, so the pointer enters it (a press before hides the bubble).
  await page.mouse.move(0, 0);
  await target.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  return (await tip.textContent()) ?? '';
}

// ------------------------------------------------------------------ the head

test('the title Profil with "Aus Lebenslauf ausfüllen" on its line; the bar comes only with a change', async ({
  page,
}) => {
  await profile(page);
  // The page's title (design round 7), its one action at the end of its line.
  await expect(page.getByTestId('profile-heading')).toHaveText(T.nav.profile);
  const head = page.getByTestId('profile-head');
  const cv = page.getByTestId('profile-from-cv');
  await expect(cv).toHaveText(T.profile.fromCv);
  await expect(head.getByRole('button')).toHaveCount(1);
  // A complete profile: nothing red, no bar.
  expect(await marked(page)).toEqual([]);
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await expect(bar(page)).toContainText(T.profile.unsaved);
  await expect(bar(page).getByRole('button')).toHaveText([T.profile.save, T.profile.discard]);
  await expect(head.getByRole('button')).toHaveCount(1);
});
test('six groups on one page in their order, no info symbol at their headings', async ({
  page,
}) => {
  await profile(page);
  const ids = ['job', 'work', 'experience', 'competences', 'languages', 'exclusions'] as const;
  await expect(page.locator('[data-section]')).toHaveCount(ids.length);
  for (const [index, id] of ids.entries()) {
    const section = page.locator('[data-section]').nth(index);
    await expect(section).toHaveAttribute('data-section', id);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(T.profile.section[id]);
    await expect(section.locator('.head').getByTestId('info-tip')).toHaveCount(0);
  }
});
test('each field is a row of its group with its label beside it', async ({ page }) => {
  await profile(page);
  const words = T.profile.field;
  const layout: Record<string, [string, string][]> = {
    job: [
      ['roles', words.roles],
      ['project', words.contracts],
      ['dayRateWish', words.dayRateWish],
      ['dayRateMin', words.dayRateMin],
      ['minSalary', words.minSalary],
    ],
    work: [
      ['countries', words.countries],
      ['regions', words.regions],
      ['workMode', words.workMode],
      ['workload', words.workload],
      ['available', words.available],
      ['minMonths', words.minMonths],
    ],
    experience: [
      ['years', words.totalYears],
      ['tools', words.tools],
      ['industries', words.industries],
      ['degrees', words.degrees],
      ['certificates', words.certificates],
    ],
    exclusions: [['exclusionWords', words.exclusionWords]],
  };
  for (const [section, fields] of Object.entries(layout)) {
    const scope = page.getByTestId(`section-${section}`);
    const cells = scope.locator(':scope [data-field]');
    await expect(cells).toHaveCount(fields.length);
    // In the order of the page.
    expect(await cells.evaluateAll((all) => all.map((cell) => cell.dataset.field))).toEqual(
      fields.map(([name]) => name),
    );
    for (const [name, text] of fields) {
      await expect(label(scope.locator(`[data-field~="${name}"]`)), name).toHaveText(text);
    }
  }
  // Kompetenzen and Sprachen: a group each, whose rows are the entries.
  for (const list of ['competences', 'languages'] as const) {
    await expect(field(page, list).getByTestId(`section-${list}`)).toBeVisible();
    await expect(field(page, list).getByTestId(list)).toBeVisible();
  }
  // A number carries its unit inside, as wide as it needs.
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.unit.day);
  await expect(field(page, 'minSalary')).toContainText(T.profile.unit.year);
  await expect(field(page, 'years')).toContainText(T.profile.unit.years);
  const box = (id: string): Promise<DOMRect> =>
    page.getByTestId(id).evaluate((input) => input.closest('.field')!.getBoundingClientRect());
  expect((await box('profile-wish-rate')).width).toBe(170);
  expect((await box('profile-years')).width).toBe(130);
  // The label in its column of 188, 24 before the control, centred on a single line.
  const name = await label(field(page, 'dayRateWish')).evaluate((node) =>
    node.getBoundingClientRect(),
  );
  const control = await box('profile-wish-rate');
  expect(Math.round(control.left - name.left)).toBe(188 + 24);
  expect(
    Math.abs(name.top + name.height / 2 - (control.top + control.height / 2)),
  ).toBeLessThanOrEqual(1);
  // The placeholders and the add buttons say what to do.
  await expect(roles(page).locator('input')).toHaveAttribute('placeholder', words.rolesPlaceholder);
  await expect(countryInput(page)).toHaveAttribute('placeholder', words.countriesPlaceholder);
  await expect(page.getByTestId('competences-add')).toHaveText(words.competencePlaceholder);
  await expect(page.getByTestId('languages-add')).toHaveText(words.languagePlaceholder);
  await expect(await adder(page, 'competence')).toHaveAttribute(
    'placeholder',
    words.competencePlaceholder,
  );
  await expect(await adder(page, 'language')).toHaveAttribute(
    'placeholder',
    words.languagePlaceholder,
  );
});

test('in a narrow window the label stands above its control', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const words = await label(field(page, 'dayRateWish')).evaluate((node) =>
    node.getBoundingClientRect(),
  );
  const control = await page
    .getByTestId('profile-wish-rate')
    .evaluate((input) => input.closest('.field')!.getBoundingClientRect());
  expect(control.top).toBeGreaterThanOrEqual(words.bottom);
  expect(Math.round(control.left)).toBe(Math.round(words.left));
  // Nothing wider than the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('the stored profile fills every field', async ({ page }) => {
  await profile(page);
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(contract(page, 'project')).toHaveAttribute('aria-checked', 'true');
  await expect(contract(page, 'permanent')).toHaveAttribute('aria-checked', 'true');
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('profile-wish-rate')).toHaveValue('1.200');
  await expect(page.getByTestId('profile-min-rate')).toHaveValue('1.100');
  await expect(page.getByTestId('profile-min-salary')).toHaveValue('');
  await expect(
    page.getByTestId('profile-work-mode').getByRole('radio', { checked: true }),
  ).toHaveText(T.profile.workMode.remote);
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  await expect(chips(page.getByTestId('profile-regions'))).toHaveText(['Hamburg']);
  await expect(page.getByTestId('profile-date')).toHaveValue('01.09.2026');
  await expect(
    page.getByTestId('profile-workload').getByRole('radio', { checked: true }),
  ).toHaveText(T.profile.workload.any);
  await expect(page.getByTestId('profile-min-months')).toHaveText(T.profile.minMonths[6]);
  await expect(names(page, 'competences')).toHaveCount(6);
  await expect(page.getByTestId('competence-years').first()).toHaveValue('12');
  await expect(chips(page.getByTestId('profile-tools'))).toContainText(['SAP S/4HANA']);
  await expect(page.getByTestId('profile-years')).toHaveValue('20');
  await expect(chips(page.getByTestId('profile-industries'))).toHaveText([
    'Maschinenbau',
    'Automotive',
    'Chemie',
  ]);
  await expect(names(page, 'languages')).toHaveText(['Deutsch', 'Englisch']);
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
  await expect(save(page)).toHaveCount(0);
});

test('info symbols only at their places, their sentence on hover, keyboard focus and click', async ({
  page,
}) => {
  await profile(page);
  const places: [string, keyof typeof T.profile.info, string][] = [
    ['project', 'contracts', T.profile.field.contracts],
    ['dayRateMin', 'dayRate', T.profile.field.dayRateMin],
    ['countries', 'countries', T.profile.field.countries],
    ['exclusionWords', 'exclusionWords', T.profile.field.exclusionWords],
  ];
  // Beside these fields' labels only (user 2026-10-04).
  const tips = page.getByTestId('profile-form').getByTestId('info-tip');
  await expect(tips).toHaveCount(places.length);
  for (const [name, info, words] of places) {
    const tip = field(page, name).getByTestId('info-tip').first();
    await expect(tip, name).toHaveAccessibleName(T.common.infoAbout(words));
    expect(await tooltipOf(page, tip)).toBe(T.profile.info[info]);
  }
  // A click shows it at once and a second one hides it; Tab shows it too.
  const tip = field(page, 'exclusionWords').getByTestId('info-tip');
  const bubble = page.getByRole('tooltip');
  await page.mouse.move(0, 0);
  await expect(bubble).toHaveCount(0);
  await tip.dispatchEvent('click');
  await expect(bubble).toHaveText(T.profile.info.exclusionWords);
  await tip.dispatchEvent('click');
  await expect(bubble).toHaveCount(0);
  await field(page, 'exclusionWords').locator('input').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(tip).toBeFocused();
  await expect(bubble).toHaveText(T.profile.info.exclusionWords);
});

// ------------------------------------------------------------------ the controls

test('Vertragsart is a choice of several, one stays; the salary comes with Festanstellung or Zeitarbeit', async ({
  page,
}) => {
  await profile(page);
  const choice = page.getByTestId('profile-contracts');
  await expect(choice).toHaveAttribute('role', 'group');
  await expect(choice.getByRole('checkbox')).toHaveText([
    T.profile.contract.project,
    T.profile.contract.permanent,
    T.profile.contract.temporary,
  ]);
  const salary = page.getByTestId('profile-min-salary');
  await expect(salary).toBeVisible();
  await contract(page, 'permanent').click();
  await expect(contract(page, 'permanent')).toHaveAttribute('aria-checked', 'false');
  await expect(salary).toHaveCount(0);
  await contract(page, 'temporary').click();
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-checked', 'true');
  await expect(salary).toBeVisible();
  await salary.fill('90000');
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after).toMatchObject({ permanent: false, temporary: true, minSalary: 90000 });
  // The save's rescore says so above the groups for a moment; once it ends nothing moves
  // under the pointer.
  await runFinished(page);
  // Without both the salary is not kept; the last chosen type stays and says why.
  await contract(page, 'temporary').click();
  await contract(page, 'project').click();
  await expect(contract(page, 'project')).toHaveAttribute('aria-checked', 'true');
  expect(await tooltipOf(page, contract(page, 'project'))).toBe(T.profile.field.keepOneContract);
  await save(page).click();
  expect((await lastSave(page)).after).toMatchObject({
    project: true,
    temporary: false,
    minSalary: null,
  });
});
test('the rates; a wish under the minimum says so quietly under the wish', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-wish-rate').fill('900');
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.belowMinRate);
  await expect(field(page, 'dayRateMin').getByTestId('info-tip')).toHaveCount(1);
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await expect(field(page, 'dayRateWish')).not.toContainText(T.profile.field.belowMinRate);
});

test('Arbeitsmodell, Verfügbar, Auslastung and Mindestlaufzeit choose one option each', async ({
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
  const loads = page.getByTestId('profile-workload').getByRole('radio');
  await expect(loads).toHaveText(Object.values(T.profile.workload));
  await loads.filter({ hasText: T.profile.workload.fulltime }).click();
  // Mindestlaufzeit, a value on a scale: a select.
  await page.getByTestId('profile-min-months').click();
  const months = page.getByRole('listbox').getByRole('option');
  await expect(months).toHaveText(Object.values(T.profile.minMonths));
  await months.filter({ hasText: T.profile.minMonths[12] }).click();
  await expect(page.getByTestId('profile-min-months')).toHaveText(T.profile.minMonths[12]);
  await save(page).click();
  expect((await lastSave(page)).after).toMatchObject({
    workMode: 'hybrid',
    available: { kind: 'now' },
    workload: 'fulltime',
    minMonths: 12,
  });
});
test('Länder: the focus lists the others, Schweiz as a suggestion; typing narrows', async ({
  page,
}) => {
  await profile(page);
  await countryInput(page).focus();
  // Like every tag field the focus opens no list and there are no suggestions (owner,
  // 2026-10-28); typing lists the countries not chosen yet.
  const listed = options(page).getByRole('option');
  await expect(listed).toHaveCount(0);
  await expect(page.getByTestId('country-pick')).toHaveCount(0);
  // By either name, Enter takes the first match.
  await countryInput(page).fill('Belg');
  await expect(listed).toHaveText(['Belgien']);
  await countryInput(page).fill('Schw');
  await countryInput(page).press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await expect(listed).toHaveCount(0);
  await countryInput(page).fill('Atlantis');
  await expect(page.getByTestId('profile-countries-none')).toHaveText(T.profile.field.countryNone);
  await countryInput(page).fill('');
  await save(page).click();
  expect((await lastSave(page)).after.countries).toEqual(['DE', 'AT', 'CH']);
  // A new profile starts with Deutschland.
  await create(page);
  await expect(chips(countries(page))).toHaveText(['Deutschland']);
  await countries(page).getByRole('button', { name: 'Deutschland entfernen' }).click();
  await expect(page.getByTestId('country-pick').getByRole('button')).toHaveText([
    'Deutschland',
    'Österreich',
    'Schweiz',
  ]);
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

test('Branchen: plain names, no star', async ({ page }) => {
  await profile(page);
  const industries = page.getByTestId('profile-industries');
  await expect(industries.getByTestId('chip-star')).toHaveCount(0);
  await industries.locator('input').fill('Energie');
  await industries.locator('input').press('Enter');
  await industries.getByRole('button', { name: 'Automotive entfernen' }).click();
  await save(page).click();
  expect((await lastSave(page)).after.industries).toEqual(['Maschinenbau', 'Chemie', 'Energie']);
});

test('Sprachen: an item list, the level a select of A1 to C2, the add row a search list', async ({
  page,
}) => {
  await profile(page);
  const level = (index: number) => page.getByTestId('language-level').nth(index);
  // The focus opens the list of every language not chosen yet.
  await (await adder(page, 'language')).focus();
  const listed = page.getByTestId('language-add-options').getByRole('option');
  await expect(listed.first()).toBeVisible();
  expect(await listed.allTextContents()).not.toContain('Deutsch');
  // Typing narrows it; Enter takes the first, which starts at B2.
  await (await adder(page, 'language')).fill('Franz');
  await page.keyboard.press('Enter');
  await expect(names(page, 'languages')).toHaveText(['Deutsch', 'Englisch', 'Französisch']);
  await expect(await adder(page, 'language')).toHaveValue('');
  await expect(level(2)).toHaveText(T.profile.level.B2);
  // Esc closes the list of the field, a second Esc the field: its button is back.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('language-add-options')).toBeHidden();
  await expect(page.getByTestId('language-add').locator('input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('languages-add')).toBeFocused();
  // The level: a select of the levels.
  await level(2).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(
    Object.values(T.profile.level),
  );
  await page.getByRole('listbox').getByRole('option', { name: T.profile.level.A2 }).click();
  await expect(level(2)).toHaveText(T.profile.level.A2);
  // Nothing outside the list: it says so.
  await (await adder(page, 'language')).fill('Klingonisch');
  await expect(page.getByTestId('language-add-none')).toHaveText(T.profile.field.languageNone);
  await (await adder(page, 'language')).fill('Schwed');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // The x of a row removes it ("Entfernen").
  await page.getByTestId('languages-remove').first().click();
  await save(page).click();
  expect((await lastSave(page)).after.languages).toEqual([
    { language: 'Englisch', level: 'B2' },
    { language: 'Französisch', level: 'A2' },
    { language: 'Schwedisch', level: 'B2' },
  ]);
});

// ------------------------------------------------------------------ what is still open

test('a required field stays red while it is empty; Speichern saves anyway, without a success sign', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-incomplete');
  // Red at once on the Profil page (decision 2): the edge and the label.
  expect(await marked(page)).toEqual(['roles', 'languages']);
  const red = await label(field(page, 'roles')).evaluate((node) => getComputedStyle(node).color);
  const ink = await label(field(page, 'tools')).evaluate((node) => getComputedStyle(node).color);
  expect(red).not.toBe(ink);
  // A gap never holds the save.
  await contract(page, 'temporary').click();
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  // Speichern: saved, a plain toast, the first red field in view, no caret in it.
  await page.getByTestId('profile-years').focus();
  await page.getByTestId('profile-years').evaluate((node) => node.scrollIntoView());
  await save(page).click();
  await lastSave(page);
  await expect(savedToast(page)).toHaveAttribute('data-kind', 'plain');
  await expect(roles(page).locator('input')).not.toBeFocused();
  await expect(roles(page).locator('input')).toBeInViewport();
  await expect(save(page)).toHaveCount(0);
  expect(await marked(page)).toEqual(['roles', 'languages']);
  // Filled, a field is no longer red, at once.
  await roles(page).locator('input').fill('Interim CFO');
  await roles(page).locator('input').press('Enter');
  await expect.poll(() => marked(page)).toEqual(['languages']);
  await (await adder(page, 'language')).fill('Deutsch');
  await page.keyboard.press('Enter');
  await expect.poll(() => marked(page)).toEqual([]);
  // Complete, the save's toast has its success sign.
  await save(page).click();
  await lastSave(page);
  await expect(savedToast(page).last()).toHaveAttribute('data-kind', 'success');
});
// ------------------------------------------------------------------ the CV

test('"Aus Lebenslauf ausfüllen" opens the file dialog at once; the AI works in its place, then it fills', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-incomplete');
  const cv = page.getByTestId('profile-from-cv');
  const busy = page.getByTestId('profile-cv-busy');
  const place = (): Promise<number> =>
    page
      .getByTestId('profile-head')
      .locator('.actions > *')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);
  const before = await place();
  await expect(busy).toBeHidden();
  await pickCv(page);
  // No popover: the dialog at once; while the AI reads it, the words say so in the same width.
  await expect(busy).toBeVisible();
  await expect(busy).toHaveText(T.profile.cvBusy);
  await expect(cv).toBeHidden();
  expect(await place()).toBe(before);
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.filled })).toBeVisible();
  await expect(cv).toBeVisible();
  expect(await calls(page, 'profile_from_cv')).toHaveLength(1);
  expect(await saves(page)).toBe(0);
  // Merged: what was there stays, the CV's names come after.
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(names(page, 'competences').first()).toHaveText('Controlling');
  await expect(names(page, 'languages')).toHaveText(['Deutsch', 'Englisch']);
  expect(await marked(page)).toEqual([]);
  await expect(save(page)).toHaveCount(0);
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

test('no evaluation left today: the CV buttons say so ahead of the click, a drop is not taken', async ({
  page,
}) => {
  await profile(page, '&cv=used');
  const cv = page.getByTestId('profile-from-cv');
  await expect(cv).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, cv)).toBe(T.profile.cvError.limit);
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await page.waitForTimeout(100);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(0);
  // The start page's tile says it on the click, without asking.
  await profile(page, '&scenario=no-profile&cv=used');
  await chooseWay(page, 'cv');
  await expect(page.getByTestId('cv-error')).toContainText(T.profile.cvError.limit);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(0);
  // A limit met on the click is a state box under the head, and turns the button off from
  // then on.
  await profile(page, '&cv=limit');
  await pickCv(page);
  const error = page.getByTestId('cv-error');
  await expect(error).toContainText(T.profile.cvFailed);
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.limit);
  await expect(error.getByTestId('cv-pick')).toHaveCount(0);
  await expect(cv).toHaveAttribute('aria-disabled', 'true');
  // It stands between the head and the first group.
  const y = (node: Locator): Promise<number> =>
    node.evaluate((element) => element.getBoundingClientRect().top);
  expect(await y(error)).toBeGreaterThan(await y(page.getByTestId('profile-head')));
  expect(await y(error)).toBeLessThan(await y(page.getByTestId('section-job')));
});

test('a CV failure on the Profil says why under the head, whose button is the way out', async ({
  page,
}) => {
  await profile(page, '&cv=offline');
  await pickCv(page);
  const error = page.getByTestId('cv-error');
  await expect(error).toContainText(T.profile.cvFailed);
  await expect(page.getByTestId('cv-error-text')).toHaveText(T.profile.cvError.offline);
  // No second "Datei auswählen" under the head's button that opens the same dialog.
  await expect(error.getByTestId('cv-pick')).toHaveCount(0);
  await page.getByTestId('profile-from-cv').click();
  await expect.poll(async () => (await calls(page, 'profile_from_cv')).length).toBe(2);
});

test('a CV dropped anywhere on the profile page fills it like the button', async ({ page }) => {
  await profile(page, '&scenario=profile-incomplete');
  await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.filled })).toBeVisible();
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: true });
  // While the form holds changes the drop waits like the button.
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await page.waitForTimeout(100);
  expect(await calls(page, 'profile_from_cv')).toHaveLength(1);
  // On the start page too.
  await profile(page, '&scenario=no-profile');
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expect(page.getByTestId('profile-form')).toBeVisible();
});

test('a CV that fills nothing says why in one sentence, with its way on', async ({ page }) => {
  // Ten starts of the app: WebKit needs close to the default 30 s.
  test.setTimeout(60_000);
  // "Datei auswählen" where a new try can work.
  const cases: [string, keyof typeof T.profile.cvError, boolean][] = [
    ['limit', 'limit', false],
    ['offline', 'offline', true],
    ['timeout', 'timeout', true],
    ['unreadable', 'unreadable', true],
    ['tooBig', 'tooLarge', true],
    ['unsupported', 'unsupported', true],
    ['unavailable', 'unavailable', true],
    ['paused', 'paused', false],
    ['outdated', 'outdated', false],
  ];
  for (const [cv, reason, pick] of cases) {
    await profile(page, `&scenario=no-profile&cv=${cv}`);
    await chooseWay(page, 'cv');
    const error = page.getByTestId('cv-error');
    await expect(error, cv).toContainText(T.profile.cvError[reason]);
    await expect(error.getByTestId('cv-pick')).toHaveCount(pick ? 1 : 0);
    if (pick) await expect(error.getByTestId('cv-pick')).toHaveText(T.profile.pickFile);
    // Nothing stored; "Selbst ausfüllen" stays the way.
    expect(await saves(page)).toBe(0);
    await expect(page.getByTestId('way-self')).toBeVisible();
  }
  // Another try runs the CV again.
  await page.getByTestId('nav-jobs').click();
  await profile(page, '&scenario=no-profile&cv=offline');
  await chooseWay(page, 'cv');
  await page.getByTestId('cv-pick').click();
  await expect.poll(async () => (await calls(page, 'profile_from_cv')).length).toBe(2);
  // A closed dialog says nothing.
  await profile(page, '&scenario=no-profile&cv=none');
  await chooseWay(page, 'cv');
  await expect.poll(async () => (await calls(page, 'profile_from_cv')).length).toBe(1);
  await expect(page.getByTestId('cv-error')).toHaveCount(0);
});

// ------------------------------------------------------------------ the ways in

test('no profile: one sentence and the two ways as tiles, a click goes its way', async ({
  page,
}) => {
  await profile(page, '&scenario=no-profile');
  // The title without an action: nothing to fill from a CV before a profile exists.
  await expect(page.getByTestId('profile-heading')).toHaveText(T.nav.profile);
  await expect(page.getByTestId('profile-from-cv')).toHaveCount(0);
  await expect(page.getByTestId('profile-empty')).toContainText(T.profile.noneText);
  const ways = page.getByTestId('new-profile-ways');
  await expect(ways.getByTestId('way-cv')).toContainText(T.profile.wayCv);
  await expect(ways.getByTestId('way-cv')).toContainText(T.profile.wayCvNote);
  await expect(ways.getByTestId('way-self')).toContainText(T.profile.byHand);
  await expect(ways.getByTestId('way-self')).toContainText(T.profile.byHandNote);
  // The CV makes the profile: the form shows it as stored.
  await chooseWay(page, 'cv');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(save(page)).toHaveCount(0);
});
test('Selbst ausfüllen: the empty form, Esc back while untouched; saved once complete', async ({
  page,
}) => {
  await create(page);
  await expect(roles(page).locator('input')).toBeFocused();
  // Core is asked what the new form still lacks: those fields are red at once.
  await expect.poll(async () => (await calls(page, 'profile_missing')).length).toBeGreaterThan(0);
  await expect.poll(() => marked(page)).toEqual(['roles', 'competences', 'languages']);
  await expect(names(page, 'competences')).toHaveCount(0);
  await expect(names(page, 'languages')).toHaveCount(0);
  await expect(save(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await chooseWay(page, 'empty');
  await fillRequired(page);
  await expect(save(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after).toMatchObject({
    roles: ['Interim CFO'],
    project: true,
    permanent: false,
    temporary: false,
    countries: ['DE'],
    competences: [{ name: 'Controlling', years: null }],
    languages: [{ language: 'Deutsch', level: 'B2' }],
  });
  expect(await marked(page)).toEqual([]);
});

test('a profile edited into broken JSON says so and where, with its folder', async ({ page }) => {
  await profile(page, '&scenario=profile-broken');
  const empty = page.getByTestId('profile-empty');
  await expect(page.getByTestId('profile-heading')).toHaveText(T.profile.unreadable);
  await expect(empty).toContainText(
    'Die Datei ist beschädigt (Zeile 12). Ein neues Profil ersetzt die Datei.',
  );
  // Its folder is the page's own action, in the head.
  await page.getByTestId('profile-head').getByTestId('profile-folder').click();
  expect((await calls(page, 'open_target')).at(-1)![1]).toEqual({
    target: { kind: 'profileDir' },
  });
  await chooseWay(page, 'empty');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('way-cv')).toBeFocused();
});

// ------------------------------------------------------------------ saving

test('edit and discard: the form goes back to what is stored, the bar leaves', async ({ page }) => {
  await profile(page);
  await expect(save(page)).toHaveCount(0);
  await roles(page).locator('input').fill('Interim CTO');
  await roles(page).locator('input').press('Enter');
  await expect(save(page)).toBeVisible();
  await contract(page, 'temporary').click();
  await discard(page).click();
  await expect(chips(roles(page))).toHaveText(['Interim CFO']);
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-checked', 'false');
  await expect(save(page)).toHaveCount(0);
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
  // No word about what is unsaved: Verwerfen and Speichern in the head say it.
  await expect(discard(page)).toBeVisible();
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.before.dayRateMin).toBe(1100);
  expect(sent.after.dayRateMin).toBe(1250);
  expect(sent.after.tools.at(-1)).toBe('Bilanzierung');
  expect(sent.after.available).toEqual({ kind: 'from', date: '01.11.2026' });
  expect(sent.after.exclusionWords).toEqual(['Werkstudent', 'Trainee']);
  await expect(save(page)).toHaveCount(0);
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
  // The reason names the field.
  expect(await tooltipOf(page, save(page))).toBe(T.profile.fixFirst(T.profile.field.dayRateMin));
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
    await expect(save(page)).toHaveCount(0);
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
  // A tag field and an item list's add row take what was typed.
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await expect(chips(page.getByTestId('profile-tools')).last()).toHaveText('Miro');
  await (await adder(page, 'competence')).fill('Treasury');
  await (await adder(page, 'competence')).press('Enter');
  await expect(names(page, 'competences').last()).toHaveText('Treasury');
  expect(await saves(page)).toBe(3);
});

test('Kompetenzen: an item list; the add row suggests, a name comes once, the x removes', async ({
  page,
}) => {
  await profile(page);
  const list = names(page, 'competences');
  await expect(list).toHaveCount(6);
  // Typed and Enter: a new row at the end with no years yet, the add row empty again.
  await (await adder(page, 'competence')).fill('Konzernabschluss');
  await (await adder(page, 'competence')).press('Enter');
  await expect(list).toHaveCount(7);
  await expect(list.last()).toHaveText('Konzernabschluss');
  await expect(await adder(page, 'competence')).toHaveValue('');
  await expect(page.getByTestId('competence-years').last()).toHaveValue('');
  // A name that is there already (in any case) comes once.
  await (await adder(page, 'competence')).fill('controlling');
  await (await adder(page, 'competence')).press('Enter');
  await expect(list).toHaveCount(7);
  // The engine's words from the first character; a click takes one.
  await (await adder(page, 'competence')).fill('T');
  const hints = page.getByTestId('competence-add-suggestions').getByRole('option');
  await expect(hints.first()).toBeVisible();
  const term = (await hints.first().textContent())!.trim();
  await hints.first().click();
  await expect(list.last()).toHaveText(term);
  // The years of a row, and its x ("Entfernen").
  await page.getByTestId('competence-years').nth(6).fill('4');
  const remove = page.getByTestId('competences-remove').first();
  expect(await tooltipOf(page, remove)).toBe(T.common.remove);
  await remove.click();
  await expect(list.first()).toHaveText('Controlling');
  await save(page).click();
  const sent = (await lastSave(page)).after.competences;
  expect(sent.map((row) => row.name)).not.toContain('Interim Management');
  expect(sent.find((row) => row.name === 'Konzernabschluss')?.years).toBe(4);
  expect(sent.at(-1)?.name).toBe(term);
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

test('the day exists only for "Ab Datum", gets the caret and is judged when left or saved', async ({
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
  await date.fill('20.11.2026');
  await page.getByTestId('profile-years').focus();
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  // Typed only: no calendar beside it.
  await expect(date).toHaveAttribute('placeholder', T.profile.field.datePlaceholder);
  await expect(day.getByRole('button')).toHaveCount(0);
  await save(page).click();
  expect((await lastSave(page)).after.available).toEqual({ kind: 'from', date: '20.11.2026' });
});

test('a number field shows no letter: after the digits, over a selection, in the middle', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('edit-job').click();
  const wish = page.getByTestId('profile-wish-rate');
  await wish.click();
  await wish.press('Control+A');
  await page.keyboard.type('12a');
  await expect(wish).toHaveValue('12');
  await wish.press('Control+A');
  await page.keyboard.type('abc');
  await expect(wish).toHaveValue('');
  // A letter among the digits goes, the caret stays where it was.
  await page.keyboard.type('12');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('x');
  await expect(wish).toHaveValue('12');
  await page.keyboard.type('5');
  await expect(wish).toHaveValue('152');
  // Leaving the field keeps the digits.
  await page.getByTestId('profile-min-rate').click();
  await expect(wish).toHaveValue('152');
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
