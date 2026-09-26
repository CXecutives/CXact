// The interface of engine 16: the three fields of the Profil view's Konditionen (Auslastung,
// Mindestlaufzeit, Ausschlusswörter) with their save, their limits and their values that do not
// read; the reader's rows Auslastung and Laufzeit with their verdicts; a job excluded by an
// exclusion word; the workload in a list row. The stub's demo profile works three to five days
// a week for at least six months and excludes "Werkstudent" and "Praktikum".

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, open, test } from './fixtures';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';

const WIN = '?platform=windows';
const MAC = '?platform=macos';

async function profile(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible();
}

async function lastSave(page: Page): Promise<ProfileSave> {
  const all = await calls(page, 'save_profile');
  return (all.at(-1)![1] as { save: ProfileSave }).save;
}

const chips = (field: Locator): Locator => field.locator('.chip .text');
const list = (page: Page) => page.getByTestId('job-list');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const stage = (page: Page) => page.getByTestId('stage');
const term = (page: Page, key: string) =>
  stage(page).getByTestId('criteria').getByTestId(`term-${key}`);

/** Opens a job from "Alle" (an excluded one from its folded section at the end). */
async function show(page: Page, key: string, query = WIN): Promise<void> {
  await open(page, query);
  await page
    .getByTestId('facet')
    .getByRole('radio', { name: /Alle|All/ })
    .click();
  const target = row(page, key);
  if ((await target.count()) === 0) await page.getByTestId('excluded-divider').click();
  await target.click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await target.locator('.title').innerText(),
  );
  await animationsDone(page);
}

/** The value, the profile's side and the verdict of a row of the terms. */
async function cell(page: Page, key: string): Promise<[string, string, string]> {
  const target = term(page, key);
  const text = async (css: string): Promise<string> =>
    (await target.locator(css).count()) === 0
      ? ''
      : ((await target.locator(css).textContent()) ?? '').replace(/\s+/g, ' ').trim();
  return [await text('.term-line'), await text('.term-profile'), await text('.verdict')];
}

test('Konditionen hold the workload, the minimum duration and the exclusion words after the start', async ({
  page,
}) => {
  await profile(page);
  const min = page.getByTestId('profile-workload-min');
  const max = page.getByTestId('profile-workload-max');
  const months = page.getByTestId('profile-min-months');
  const words = page.getByTestId('profile-exclusion-words');
  await expect(min).toHaveValue('3');
  await expect(max).toHaveValue('5');
  await expect(months).toHaveValue('6');
  await expect(chips(words)).toHaveText(['Werkstudent', 'Praktikum']);
  // Named for a screen reader, with the unit beside the second day and the months.
  await expect(min).toHaveAccessibleName('Auslastung von');
  await expect(max).toHaveAccessibleName('Auslastung bis');
  await expect(page.getByTestId('profile-workload')).toContainText('von');
  await expect(page.getByTestId('profile-workload')).toContainText('Tage pro Woche');
  await expect(page.getByTestId('section-criteria')).toContainText(
    'Jobs mit diesen Wörtern im Titel oder Text werden ausgeschlossen.',
  );
  // After "Verfügbar ab", before the countries; the two days on one line.
  const y = async (node: Locator): Promise<number> => (await node.boundingBox())!.y;
  expect(await y(min)).toBeGreaterThan(await y(page.getByTestId('profile-available')));
  expect(await y(words)).toBeGreaterThan(await y(min));
  expect(await y(page.getByTestId('profile-countries'))).toBeGreaterThan(await y(words));
  expect(await y(max)).toBe(await y(min));
  // The reading names them as the engine applies them.
  const reading = page.getByTestId('reading-criteria');
  await expect(reading).toContainText('Auslastung 3 bis 5 Tage pro Woche');
  await expect(reading).toContainText('Mindestlaufzeit 6 Monate');
  await expect(reading).toContainText('Ausschlusswörter Werkstudent, Praktikum');
});

test('the three fields go into the save; either day may stay empty', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-workload-min').fill('2');
  await page.getByTestId('profile-workload-max').fill('');
  await page.getByTestId('profile-min-months').fill('12');
  const words = page.getByTestId('profile-exclusion-words');
  await words.getByRole('button', { name: 'Praktikum entfernen' }).click();
  await words.locator('input').fill('Trainee');
  await words.locator('input').press('Enter');
  await expect(chips(words)).toHaveText(['Werkstudent', 'Trainee']);
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.before.criteria.workloadMinDays).toBe(3);
  expect(sent.after.criteria.workloadMinDays).toBe(2);
  expect(sent.after.criteria.workloadMaxDays).toBeNull();
  expect(sent.after.criteria.minMonths).toBe(12);
  expect(sent.after.criteria.exclusionWords).toEqual(['Werkstudent', 'Trainee']);
  // Saved: the form and the reading are the stored profile again.
  await expect(page.getByTestId('profile-workload-max')).toHaveValue('');
  await expect(page.getByTestId('reading-criteria')).toContainText(
    'Auslastung mindestens 2 Tage pro Woche',
  );
  await expect(page.getByTestId('reading-criteria')).toContainText('Mindestlaufzeit 12 Monate');
});

for (const [platform, query] of [
  ['Windows', WIN],
  ['macOS', MAC],
] as const) {
  test(`days the backend refuses are said at the workload (${platform})`, async ({ page }) => {
    await profile(page, query);
    const section = page.getByTestId('section-criteria');
    const max = page.getByTestId('profile-workload-max');
    await max.fill('7');
    await page.getByTestId('profile-save').click();
    await expect(section).toContainText('Höchstens 5.');
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await expect(max).toBeFocused();
    await expect(page.getByTestId('profile-save-status')).toHaveText('Nicht gespeichert');
    // The second day below the first has no limit, it says which way round.
    await page.getByTestId('profile-workload-min').fill('4');
    await max.fill('3');
    await expect(max).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByTestId('profile-save').click();
    await expect(section).toContainText('Der zweite Wert liegt unter dem ersten.');
    await expect(max).toBeFocused();
    expect(await calls(page, 'save_profile')).toHaveLength(2);
  });
}

test('a minimum duration the backend refuses is said at its field; put right, it saves', async ({
  page,
}) => {
  await profile(page);
  const months = page.getByTestId('profile-min-months');
  await months.fill('200');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('section-criteria')).toContainText('Höchstens 120.');
  await expect(months).toHaveAttribute('aria-invalid', 'true');
  await expect(months).toBeFocused();
  await months.fill('9');
  await page.getByTestId('profile-workload-min').fill('4');
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
  expect(await calls(page, 'save_profile')).toHaveLength(2);
  expect((await lastSave(page)).after.criteria).toMatchObject({
    workloadMinDays: 4,
    workloadMaxDays: 5,
    minMonths: 9,
  });
});

test('values of the file that do not read are said at their field and removed', async ({
  page,
}) => {
  await profile(page, `${WIN}&scenario=profile-unreadable`);
  const workload = page.locator('[data-field="workload"]');
  // Both days of one field: one message (the first), one "Wert entfernen" for both.
  await expect(workload).toContainText('In der Datei stand „viel“, das ist keine Zahl.');
  await expect(page.getByTestId('profile-workload-min')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('profile-workload-max')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-field="minMonths"]')).toContainText(
    'In der Datei stand „lang“, das ist keine Zahl.',
  );
  await expect(page.locator('[data-field="exclusionWords"]')).toContainText(
    'In der Datei stand „5“, das kann die App nicht lesen.',
  );
  await workload.getByTestId('value-remove').click();
  await expect(workload.getByTestId('value-remove')).toHaveCount(0);
  await expect(page.getByTestId('profile-workload-max')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.locator('[data-field="exclusionWords"]').getByTestId('value-remove').click();
  // A new value fixes the months as well.
  await page.getByTestId('profile-min-months').fill('6');
  await expect(page.locator('[data-field="minMonths"]')).not.toContainText('lang');
  await page.getByTestId('profile-save').click();
  const sent = await lastSave(page);
  expect(sent.clear).toEqual(
    expect.arrayContaining(['workloadMinDays', 'workloadMaxDays', 'exclusionWords']),
  );
  expect(sent.clear).not.toContain('minMonths');
  expect(sent.after.criteria.minMonths).toBe(6);
});

test('the reader: Auslastung after Laufzeit, a check below the profile', async ({ page }) => {
  // Two days a week against the profile's three to five: to check.
  await show(page, 'freelance-900413');
  const names = await stage(page).getByTestId('criteria').locator('.term-name').allInnerTexts();
  expect(names.slice(3, 5)).toEqual(['Laufzeit', 'Auslastung']);
  expect(await cell(page, 'workload')).toEqual(['2 Tage pro Woche', '3 bis 5 Tage', 'prüfen']);
  // Said in the row, not again among the points to check.
  await expect(stage(page).getByTestId('why')).not.toContainText('Tage pro Woche');
  // The value marks the passage that states it.
  await term(page, 'workload').locator('button.chip').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active').first()).toContainText('Einsatz an 2 Tagen pro Woche');
});

test('the reader: a workload and a duration within the profile fit', async ({ page }) => {
  // Three days a week for a year.
  await show(page, 'freelancermap-2804');
  expect(await cell(page, 'workload')).toEqual(['3 Tage pro Woche', '3 bis 5 Tage', 'passt']);
  expect(await cell(page, 'duration')).toEqual(['12 Monate', 'mindestens 6 Monate', 'passt']);
});

test('the reader: an ad that says nothing of its workload leaves the verdict empty', async ({
  page,
}) => {
  await show(page, 'freelancermap-2801');
  expect(await cell(page, 'workload')).toEqual(['offen', '3 bis 5 Tage', '']);
  expect(await cell(page, 'duration')).toEqual(['6 Monate', 'mindestens 6 Monate', 'passt']);
});

test('the reader: a duration below the minimum is a check in the row Laufzeit', async ({
  page,
}) => {
  await show(page, 'freelancermap-2802');
  expect(await cell(page, 'duration')).toEqual(['3 Monate', 'mindestens 6 Monate', 'prüfen']);
  await expect(stage(page).getByTestId('why')).not.toContainText('liegt unter dem Minimum');
  await term(page, 'duration').locator('button.chip').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active').first()).toContainText('Laufzeit 3 Monate');
});

test('a job excluded by an exclusion word says the word and shows it in the ad', async ({
  page,
}) => {
  await show(page, 'freelancermap-2807');
  // The row names why in short words.
  await expect(row(page, 'freelancermap-2807')).toContainText('Ausschlusswort');
  const box = stage(page).getByTestId('exclusion-box');
  await expect(box.getByTestId('exclusion')).toHaveText(
    '„Werkstudent“ steht auf deiner Liste der Ausschlusswörter.',
  );
  // Not said twice among the reasons.
  await expect(stage(page).getByTestId('why')).not.toContainText('Liste der Ausschlusswörter');
  await box.getByTestId('show-in-ad').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active').first()).toHaveText('Werkstudent');
  await expect(page.locator('mark.active').first()).toBeInViewport();
});

test('a list row shows the workload after the duration, short', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  await expect(row(page, 'freelance-900413').getByTestId('row-facts')).toHaveText('2 Tage/Woche');
  await expect(row(page, 'freelancermap-2804').getByTestId('row-facts')).toHaveText(
    /^12 Monate.*3 Tage\/Woche$/,
  );
});

test('in English: the row Workload, its value and the profile side', async ({ page }) => {
  await show(page, 'freelance-900413', `${WIN}&lang=en`);
  const names = await stage(page).getByTestId('criteria').locator('.term-name').allInnerTexts();
  expect(names).toContain('Workload');
  expect(await cell(page, 'workload')).toEqual(['2 days a week', '3 to 5 days', 'check']);
  await expect(row(page, 'freelance-900413').getByTestId('row-facts')).toHaveText('2 days/week');
});
