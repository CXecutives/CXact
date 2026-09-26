// The Profil view against the stub, in one spec: the head on the first row, the form as the
// table of sections.ts lays it out (the sections in their order, each field with its words,
// sizes and controls), the three ways in, saving, discarding, leaving and closing with
// unsaved changes, drafts from a file or an AI's answer (an update fills gaps and adds, it
// never overwrites), values of the file that do not read, refused values, quiet hints where
// values contradict each other, removing and replacing with undo, what the app reads in the
// file, the setup's way on, and "Zum Profil hinzufügen" twice in a row. The stub's demo
// profile works three to five days a week for at least six months, excludes "Werkstudent"
// and "Praktikum", and has one value that does not read (the minimum remote share).

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { calls, expect, expectShot, open, settle, test } from './fixtures';
import { MAC, T, WIN, failNext } from './helpers';

/** The Profil view: `query` after the Windows platform (`&scenario=…`), or a whole query. */
async function profile(page: Page, query = ''): Promise<void> {
  await open(page, query.startsWith('?') ? query : `${WIN}${query}`);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible();
}

/** A new form from the empty state. */
async function create(page: Page, scenario = 'no-profile'): Promise<void> {
  await profile(page, `&scenario=${scenario}`);
  await page.getByTestId('profile-create').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
}

const save = (page: Page): Locator => page.getByTestId('profile-save');
const discard = (page: Page): Locator => page.getByTestId('profile-discard');
const chips = (field: Locator): Locator => field.locator('.chip .text');
const badge = (page: Page): Locator => page.getByTestId('profile-quality');
const check = (page: Page): Locator => page.getByTestId('profile-check');
const field = (page: Page, name: string): Locator => page.locator(`[data-field="${name}"]`);
const countries = (page: Page): Locator => page.getByTestId('profile-countries');
const countryInput = (page: Page): Locator => countries(page).locator('input');
const options = (page: Page): Locator => page.getByTestId('profile-countries-options');
const saves = async (page: Page): Promise<number> => (await calls(page, 'save_profile')).length;
const middle = (box: { y: number; height: number } | null): number => box!.y + box!.height / 2;

/** The sections of the form, in order. */
const SECTIONS = [
  'section-person',
  'section-competences',
  'section-experience',
  'section-languages',
  'section-criteria',
  'section-wishes',
  'section-understood',
];

/** The competences marked as Schwerpunkt (their target pressed), in the order of the rows. */
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

async function lastSave(page: Page): Promise<ProfileSave> {
  const all = await calls(page, 'save_profile');
  return (all.at(-1)![1] as { save: ProfileSave }).save;
}

async function paste(target: Locator, text: string): Promise<void> {
  await target.evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    input.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

/** The tooltip of an element after hovering it. */
async function tooltipOf(page: Page, target: Locator): Promise<string> {
  await target.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  return (await tip.textContent()) ?? '';
}

/** Height and font of every element a selector finds inside `scope`. */
async function boxes(
  scope: Locator,
  selector: string,
): Promise<{ height: number; size: string; weight: string; text: string }[]> {
  return scope.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        height: Math.round(node.getBoundingClientRect().height),
        size: style.fontSize,
        weight: style.fontWeight,
        text: (node.textContent ?? '').trim().slice(0, 40),
      };
    }),
  );
}

/** Every id an aria-describedby, aria-labelledby or aria-controls inside `scope` names that
 *  is not in the page. */
async function dangling(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const missing: string[] = [];
    const attributes = ['aria-describedby', 'aria-labelledby', 'aria-controls'];
    for (const node of root.querySelectorAll(attributes.map((a) => `[${a}]`).join(', '))) {
      for (const attribute of attributes) {
        for (const id of (node.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
          if (document.getElementById(id) === null) {
            missing.push(`${node.getAttribute('data-testid') ?? node.tagName} ${attribute}=${id}`);
          }
        }
      }
    }
    return missing;
  });
}

// ------------------------------------------------------------------ the head

test('the head: the person on the first row, the quality, the Suchbegriffe, the actions', async ({
  page,
}) => {
  await profile(page);
  // The person first, the time of the last save; the file name only as the tooltip.
  await expect(page.getByTestId('profile-name')).toHaveText('Erika Beispiel');
  await expect(page.getByTestId('profile-role')).toHaveText('Interim Managerin Finanzen');
  await expect(page.getByTestId('profile-saved-at')).toHaveText('Gespeichert Mo 09:30');
  const head = page.getByTestId('profile-file');
  await expect(head).not.toContainText('KB');
  // Its first line sits on the first row of the window, like the sidebar's first entry.
  const first = page.locator('[data-testid="view-profile"] [data-first-row]').first();
  await expect(first).toContainText('Erika Beispiel');
  await expect(first.getByTestId('profile-check')).toBeVisible();
  expect(middle(await first.boundingBox())).toBe(
    middle(await page.getByTestId('nav-overview').boundingBox()),
  );
  // Well filled, but a value to check: said in place of "Vollständig"; a click goes there.
  await expect(badge(page)).toHaveCount(0);
  await expect(check(page)).toHaveText('1 Wert prüfen');
  // The Suchbegriffe only: the Schwerpunkte are said at their targets ("2/5").
  await expect(page.getByTestId('profile-understood')).toHaveText('42 Suchbegriffe');
  // The value the app could not read is said at its field, not in the head.
  await expect(page.getByTestId('profile-warning')).toHaveCount(0);
  // One main button and the menu of the rest.
  await expect(head.locator('.actions').getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('profile-update-cv')).toHaveText('Aus Lebenslauf aktualisieren');
  await expect(page.getByTestId('profile-more')).toHaveAccessibleName('Weitere Aktionen');
  await page.getByTestId('profile-more').click();
  await expect(page.getByTestId('menu').getByRole('menuitem')).toHaveText([
    'Andere Datei wählen',
    'Ordner öffnen',
    'Entfernen',
  ]);
  // Entfernen can be undone: no warning colour.
  await expect(page.getByTestId('menu-item-remove')).not.toHaveClass(/danger/);
  await page.getByTestId('menu-item-folder').click();
  expect((await calls(page, 'open_target')).at(-1)![1]).toEqual({
    target: { kind: 'profileDir' },
  });
  // With changes, what would replace or drop them waits and says why.
  await page.getByTestId('profile-title').fill('CFO');
  const update = page.getByTestId('profile-update-cv');
  await expect(update).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, update)).toBe('Erst speichern oder verwerfen.');
  await page.getByTestId('profile-more').click();
  for (const id of ['menu-item-pick', 'menu-item-remove']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
  }
});

test('the head and the first section keep the rhythm of all sections', async ({ page }) => {
  await profile(page);
  const head = (await page.getByTestId('profile-file').boundingBox())!;
  const person = (await page.getByTestId('section-person').boundingBox())!;
  const next = (await page.getByTestId('section-competences').boundingBox())!;
  expect(person.y - (head.y + head.height)).toBe(next.y - (person.y + person.height));
});

test('"n Werte prüfen" goes to the first value that does not read, in the order of the form', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-unreadable');
  await expect(check(page)).toHaveText(/\d+ Werte prüfen/);
  await check(page).click();
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  // The Schwerpunkte come first now: the competences stand before the Konditionen.
  const at = await focused.evaluate((node) =>
    node.closest('[data-field]')?.getAttribute('data-field'),
  );
  expect(at).toBe('focus');
});

// ------------------------------------------------------------------ the form as the table

test('the form in its order, each block with its sentence 4 px under its heading', async ({
  page,
}) => {
  await profile(page);
  const order = await page
    .locator('[data-testid="profile-form"] section[data-testid^="section-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(order).toEqual(SECTIONS);
  for (const id of ['person', 'competences', 'experience', 'languages', 'criteria', 'wishes']) {
    const section = page.getByTestId(`section-${id}`);
    const key = id as keyof typeof T.profile.sectionHint;
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(T.profile.section[key]);
    await expect(section.locator('.hint').first()).toHaveText(T.profile.sectionHint[key]);
    const gap = await section.evaluate((node) => {
      const hint = node.querySelector('.hint')!.getBoundingClientRect();
      const heading = node.querySelector('h2')!.parentElement!.getBoundingClientRect();
      return Math.round(hint.top - heading.bottom);
    });
    expect(gap, id).toBe(4);
  }
  // Said once: no other block claims to be needed.
  await expect(page.getByTestId('profile-form').getByText(/nötig/)).toHaveCount(1);
  // The languages have a block of their own; Verfügbar ab is a row of Konditionen.
  await expect(page.getByTestId('section-languages').getByTestId('languages')).toHaveCount(1);
  await expect(page.getByTestId('section-criteria').getByTestId('profile-available')).toBeVisible();
  await expect(page.getByTestId('section-availability')).toHaveCount(0);
});

test('the stored profile fills every field', async ({ page }) => {
  await profile(page);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  await expect(chips(page.getByTestId('profile-roles'))).toHaveText(['Interim CFO']);
  const rows = page.getByTestId('competence-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(1).getByTestId('competence-name')).toHaveValue('Controlling');
  await expect(rows.nth(1).getByTestId('competence-years')).toHaveValue('18');
  await expect(chips(rows.nth(1).getByTestId('competence-aliases'))).toHaveText([
    'Financial Controlling',
    'FP&A',
  ]);
  // Schwerpunkte are marked by their target, counted over the targets, said under the rows.
  await expect(rows.nth(1).getByTestId('competence-star')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.nth(0).getByTestId('competence-star')).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => marked(page))
    .toEqual(['Controlling', 'Konzernrechnungslegung nach IFRS']);
  await expect(page.getByTestId('focus-count')).toHaveText('2/5');
  await expect(page.getByTestId('focus-hint')).toHaveText(T.profile.field.focusHint);
  await expect(page.getByTestId('focus')).toHaveCount(0);
  const english = page.getByTestId('language-row').nth(1);
  await expect(english.getByRole('radio', { name: 'B2' })).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByTestId('profile-remote').getByRole('radio', { name: 'Überwiegend remote' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  await expect(page.getByTestId('profile-no-anue')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('profile-no-permanent')).toHaveAttribute('aria-checked', 'false');
  // Engine 16: the workload, the minimum duration and the exclusion words.
  await expect(page.getByTestId('profile-workload-min')).toHaveValue('3');
  await expect(page.getByTestId('profile-workload-max')).toHaveValue('5');
  await expect(page.getByTestId('profile-min-months')).toHaveValue('6');
  await expect(chips(page.getByTestId('profile-exclusion-words'))).toHaveText([
    'Werkstudent',
    'Praktikum',
  ]);
  // After Verfügbar ab, before the countries; the two days on one line.
  const y = async (id: string): Promise<number> => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('profile-workload-min')).toBeGreaterThan(await y('profile-available'));
  expect(await y('profile-exclusion-words')).toBeGreaterThan(await y('profile-workload-min'));
  expect(await y('profile-countries')).toBeGreaterThan(await y('profile-exclusion-words'));
  expect(await y('profile-workload-max')).toBe(await y('profile-workload-min'));
  // The value the app could not read is said at its field, with the mark of every error.
  await expect(page.getByTestId('section-criteria')).toContainText(
    'In der Datei stand „viel“, das ist keine Zahl.',
  );
  await expect(page.getByTestId('profile-remote-min')).toHaveAttribute('aria-invalid', 'true');
  // Nothing changed: nothing to save, and "Speichern" is the only primary of the view.
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(discard(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.btn.primary')).toHaveCount(1);
});

test('one name per field: the labels, their hints, units and neutral examples', async ({
  page,
}) => {
  await profile(page);
  const form = page.getByTestId('profile-form');
  for (const text of [
    'Die Rolle zählt für die Passung.',
    'Sie stützen die Passung, belegen aber keine Anforderung.',
    'Ab zehn Jahren bewertet die App Jobs für Einsteiger niedrig.',
    'Ohne Niveau rechnet die App mit B2.',
    'Remote-Anteil',
    'Mindest-Tagessatz',
    'Jobs ab',
    'Mindest-Jahresgehalt',
    'Mindest-Remote-Anteil',
    'Wünsche verschieben die Passung leicht, sie schließen nichts aus.',
    'Jobs mit diesen Wörtern im Titel oder Text werden ausgeschlossen.',
    'Beginnt ein Job früher, markiert die App ihn zum Prüfen.',
    'Nur bei klarem Wortlaut, sonst markiert die App den Job zum Prüfen.',
  ]) {
    await expect(form).toContainText(text);
  }
  // Konditionen and Wünsche stand side by side: no hint points from one to the other.
  await expect(form).not.toContainText('Den Mindest-Tagessatz legen die Konditionen fest.');
  // The unit stands beside its number field, not in the label.
  for (const [id, unit] of [
    ['profile-years', 'Jahre'],
    ['profile-wish-rate', '€'],
    ['profile-min-rate', '€'],
    ['profile-target-years', 'Jahren Erfahrung'],
    ['profile-min-salary', '€'],
    ['profile-remote-min', '%'],
    ['profile-min-months', 'Monate'],
  ] as const) {
    await expect(page.getByTestId(id)).toHaveAccessibleDescription(new RegExp(`${unit}$`));
  }
  await expect(form).not.toContainText('(€)');
  for (const gone of ['Auch genannt', 'Arbeitsort', 'Anderswo', 'Mindest-Erfahrung des Jobs']) {
    await expect(form).not.toContainText(gone);
  }
  // The column heads explain themselves; a level says what it means.
  const head = page.getByTestId('competences').locator('.head');
  expect(await tooltipOf(page, head.getByText('Synonyme'))).toBe(
    'Andere Wörter für dieselbe Kompetenz, auch englische.',
  );
  const levels = page.getByTestId('language-row').first().getByTestId('language-level');
  expect(await tooltipOf(page, levels.getByRole('radio', { name: 'C1' }))).toBe('Fließend');
  // The workload's two days are named for a screen reader, the unit beside the second.
  await expect(page.getByTestId('profile-workload-min')).toHaveAccessibleName('Auslastung von');
  await expect(page.getByTestId('profile-workload-max')).toHaveAccessibleName('Auslastung bis');
  await expect(page.getByTestId('profile-workload')).toContainText('Tage pro Woche');
});

test('neutral examples that fit any consultant, in both languages', async ({ page }) => {
  await create(page);
  const placeholder = (id: string, input = false): Locator =>
    input ? page.getByTestId(id).locator('input') : page.getByTestId(id);
  const expected: [string, boolean, string][] = [
    ['profile-name-field', false, 'Vor- und Nachname'],
    ['profile-title', false, 'z. B. Interim Manager'],
    ['competence-name', false, 'z. B. Projektleitung'],
    ['competence-aliases', true, 'Synonyme'],
    ['profile-keywords', true, 'z. B. Transformation'],
    ['profile-tools', true, 'z. B. Scrum'],
    ['profile-certificates', true, 'z. B. PMP'],
    ['profile-industries', true, 'z. B. Handel'],
    ['profile-regions', true, 'z. B. München'],
    ['profile-wish-industries', true, 'z. B. Energie'],
    ['profile-countries', true, 'Land suchen'],
  ];
  for (const [id, input, text] of expected) {
    await expect(placeholder(id, input), id).toHaveAttribute('placeholder', text);
  }
  await profile(page, '&scenario=no-profile&lang=en');
  await page.getByTestId('profile-create').click();
  await expect(page.getByTestId('profile-name-field')).toHaveAttribute(
    'placeholder',
    'First and last name',
  );
  await expect(page.getByTestId('competence-aliases').locator('input')).toHaveAttribute(
    'placeholder',
    'Synonyms',
  );
});

test('fields, chip fields and choices are 32 px, their labels 13/500, numbers one width', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('profile-available').getByRole('radio', { name: 'Ab Datum' }).click();
  const form = page.getByTestId('profile-form');
  const fields = await boxes(form, '.field.text');
  expect(fields.length).toBeGreaterThan(8);
  for (const box of fields) expect(box.height, box.text).toBe(32);
  // Chip fields of one line (every one of the demo profile), the synonyms included.
  const entries = await boxes(form, '.chip-input > .field.entry');
  expect(entries.length).toBeGreaterThan(8);
  for (const entry of entries) expect(entry.height, entry.text).toBe(32);
  const choices = await boxes(form, '[role="radiogroup"] button');
  expect(choices.length).toBeGreaterThan(10);
  for (const choice of choices) {
    expect(choice.height, choice.text).toBe(32);
    expect(choice.size, choice.text).toBe('14px');
  }
  // Every control label of a field and a choice (the switches are rows like in Einstellungen).
  const labels = [...(await boxes(form, 'label')), ...(await boxes(form, '.block > .label'))];
  expect(labels.length).toBeGreaterThan(15);
  for (const label of labels) {
    expect(label.size, label.text).toBe('13px');
    expect(label.weight, label.text).toBe('500');
  }
  // The main actions are 32 px, DACH is small.
  for (const id of ['profile-save', 'profile-discard', 'profile-update-cv', 'profile-more']) {
    await expect(page.getByTestId(id)).toHaveCSS('height', '32px');
  }
  await expect(page.getByTestId('profile-dach')).toHaveCSS('height', '28px');
  // Every number field has one width; the day of "Ab Datum" too.
  const widths = await Promise.all(
    [
      'profile-years',
      'profile-wish-rate',
      'profile-min-rate',
      'profile-target-years',
      'profile-min-salary',
      'profile-remote-min',
      'profile-min-months',
      'profile-date',
    ].map(async (id) => Math.round((await page.getByTestId(id).boundingBox())!.width)),
  );
  expect(new Set(widths).size, widths.join(' ')).toBe(1);
});

test('every reference of a field or switch names a text that is there', async ({ page }) => {
  await profile(page);
  const view = page.getByTestId('profile');
  expect(await dangling(view)).toEqual([]);
  // A field with a hint is described by it, one without none; a switch only by a hint.
  await expect(page.getByTestId('profile-name-field')).not.toHaveAttribute('aria-describedby', /./);
  await expect(page.getByTestId('profile-strengths').locator('input')).toHaveAccessibleDescription(
    'Sie stützen die Passung, belegen aber keine Anforderung.',
  );
  await expect(page.getByTestId('profile-no-anue')).not.toHaveAttribute('aria-describedby', /./);
  await expect(page.getByTestId('profile-no-permanent')).toHaveAccessibleDescription(
    'Nur bei klarem Wortlaut, sonst markiert die App den Job zum Prüfen.',
  );
  // An error takes the place of the missing hint, and is its description.
  await page.getByTestId('profile-min-rate').fill('250000');
  await save(page).click();
  await expect(page.getByTestId('profile-min-rate')).toHaveAccessibleDescription(
    /Höchstens 100\.000\./,
  );
  expect(await dangling(view)).toEqual([]);
  // The day, a new form and the values the app could not read.
  await page.getByTestId('profile-available').getByRole('radio', { name: 'Ab Datum' }).click();
  await page.getByTestId('profile-date').fill('1.13.2026');
  await page.getByTestId('profile-name-field').focus();
  await expect(page.getByTestId('profile-date')).toHaveAccessibleDescription(
    'Diesen Tag gibt es nicht.',
  );
  expect(await dangling(view)).toEqual([]);
  await create(page);
  expect(await dangling(page.getByTestId('profile'))).toEqual([]);
  await profile(page, '&scenario=profile-unreadable');
  expect(await dangling(page.getByTestId('profile'))).toEqual([]);
});

// ------------------------------------------------------------------ edit, save, discard

test('edit and discard: the form goes back to what is stored', async ({ page }) => {
  await profile(page);
  const title = page.getByTestId('profile-title');
  await title.fill('Interim CFO');
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-dach').click();
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await discard(page).click();
  await expect(title).toHaveValue('Interim Managerin Finanzen');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await saves(page)).toBe(0);
});

test('edit and save: both forms go to the backend, the change is confirmed', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-min-rate').fill('1.250');
  const keywords = page.getByTestId('profile-keywords').locator('input');
  await keywords.fill('Bilanzierung');
  await keywords.press('Enter');
  await page.getByTestId('profile-available').getByRole('radio', { name: 'Ab Datum' }).click();
  await page.getByTestId('profile-date').fill('1.11.2026');
  // Engine 16: either day may stay empty.
  await page.getByTestId('profile-workload-min').fill('2');
  await page.getByTestId('profile-workload-max').fill('');
  await page.getByTestId('profile-min-months').fill('12');
  const words = page.getByTestId('profile-exclusion-words');
  await words.getByRole('button', { name: 'Praktikum entfernen' }).click();
  await words.locator('input').fill('Trainee');
  await words.locator('input').press('Enter');
  await save(page).click();
  await expect(page.getByTestId('profile-saved')).toHaveText('Gespeichert, Jobs neu bewertet.');
  const sent = await lastSave(page);
  expect(sent.source).toBeNull();
  expect(sent.clear).toEqual([]);
  expect(sent.before.criteria.minDayRate).toBe(1100);
  expect(sent.after.criteria.minDayRate).toBe(1250);
  expect(sent.after.keywords).toEqual(['IFRS', 'HGB', 'Konzernabschluss', 'Bilanzierung']);
  expect(sent.after.criteria.available).toEqual({ kind: 'from', date: '2026-11-01' });
  expect(sent.before.criteria.workloadMinDays).toBe(3);
  expect(sent.after.criteria).toMatchObject({
    workloadMinDays: 2,
    workloadMaxDays: null,
    minMonths: 12,
    exclusionWords: ['Werkstudent', 'Trainee'],
  });
  // Saved: the form is the stored profile again.
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('profile-saved-at')).toBeVisible();
  await expect(page.getByTestId('profile-date')).toHaveValue('01.11.2026');
  await expect(page.getByTestId('profile-workload-max')).toHaveValue('');
});

test('the save bar says what is unsaved and what was saved, once', async ({ page }) => {
  await profile(page);
  const status = page.getByTestId('profile-save-status');
  await expect(status).toHaveText('');
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(status).toHaveText('Nicht gespeichert');
  await save(page).click();
  await expect(status).toHaveText('Gespeichert, Jobs neu bewertet.');
  // No toast over the bar, and the result goes with the next change.
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.getByTestId('profile-title').fill('Interim CFO und Controlling');
  await expect(status).toHaveText('Nicht gespeichert');
});

test('Speichern, Verwerfen and Übernehmen say why they wait', async ({ page }) => {
  await profile(page);
  for (const id of ['profile-save', 'profile-discard']) {
    const button = page.getByTestId(id);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(await tooltipOf(page, button)).toBe('Noch nichts geändert.');
  }
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await discard(page).click();
  // The steps with an AI: Übernehmen waits for the answer.
  await page.getByTestId('profile-update-cv').click();
  const take = page.getByTestId('paste-take');
  await expect(take).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, take)).toBe('Füge erst die Antwort der KI ein.');
});

test('a focused field is never hidden under the save bar', async ({ page }) => {
  await profile(page);
  const bar = page.getByTestId('profile-save-bar');
  for (const id of ['competence-add', 'profile-strengths', 'profile-keywords']) {
    const target =
      id === 'competence-add' ? page.getByTestId(id) : page.getByTestId(id).locator('input');
    await target.focus();
    await expect
      .poll(async () => {
        const [box, barBox] = [await target.boundingBox(), await bar.boundingBox()];
        return box!.y + box!.height <= barBox!.y;
      }, id)
      .toBe(true);
  }
});

test('leaving with unsaved changes asks once; cancel stays, discard leaves', async ({ page }) => {
  await profile(page);
  const name = page.getByTestId('profile-name-field');
  await name.fill('Erika Muster');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  // The heading says it: no sentence repeats it.
  await expect(dialog).toContainText('Änderungen speichern?');
  await expect(dialog.locator('p')).toHaveCount(0);
  await expect(dialog.getByRole('button')).toHaveText(['Speichern', 'Verwerfen', 'Abbrechen']);
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(name).toHaveValue('Erika Muster');
  await page.getByTestId('nav-settings').click();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  // Back in the profile: the stored value, no question on the next switch.
  await page.getByTestId('nav-profile').click();
  await expect(name).toHaveValue('Erika Beispiel');
  await page.getByTestId('nav-jobs').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
});

test('leaving with changes can save first, then it leaves', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-name-field').fill('Erika Muster');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('dialog-leave-profile').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  expect((await lastSave(page)).after.name).toBe('Erika Muster');
});

test('closing the window with unsaved changes asks; without any it closes at once', async ({
  page,
}) => {
  await profile(page);
  const closed = (): Promise<boolean> => page.evaluate(() => window.__harness.closed);
  const requestClose = (): Promise<void> => page.evaluate(() => window.__harness.requestClose());
  // Nothing unsaved: the backend knows, and the window closes without a question.
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(false);
  await requestClose();
  expect(await closed()).toBe(true);
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
  await page.evaluate(() => (window.__harness.closed = false));

  // A change: the page tells the backend, and closing asks first.
  await page.getByTestId('profile-name-field').fill('Erika Muster');
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(true);
  await requestClose();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText('Änderungen speichern?');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await closed()).toBe(false);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Muster');
  // Verwerfen: the change goes and the window closes.
  await requestClose();
  await dialog.getByRole('button', { name: 'Verwerfen' }).click();
  await expect.poll(closed).toBe(true);
  expect(await calls(page, 'close_window')).toHaveLength(1);
  expect(await saves(page)).toBe(0);
});

test('closing the window can save the changes first', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(true);
  await page.evaluate(() => window.__harness.requestClose());
  await page.getByTestId('dialog-leave-profile').getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(() => page.evaluate(() => window.__harness.closed)).toBe(true);
  expect((await lastSave(page)).after.title).toBe('Interim CFO');
});

// ------------------------------------------------------------------ keys

test('Enter in a field saves the form; lists and chips keep their Enter', async ({ page }) => {
  await profile(page);
  // Nothing changed: nothing to save.
  await page.getByTestId('profile-name-field').press('Enter');
  expect(await saves(page)).toBe(0);
  const cases: [string, string][] = [
    ['profile-name-field', 'Carla Exempel'],
    ['profile-title', 'Interim CFO'],
    ['profile-min-rate', '1.300'],
    ['profile-years', '21'],
  ];
  for (const [id, value] of cases) {
    const before = await saves(page);
    await page.getByTestId(id).fill(value);
    await page.getByTestId(id).press('Enter');
    await expect.poll(() => saves(page), id).toBe(before + 1);
    await expect(page.getByTestId('profile-saved')).toBeVisible();
  }
  // The day: Enter saves once it reads, and judges it when it does not.
  await page.getByTestId('profile-available').getByRole('radio', { name: 'Ab Datum' }).click();
  const date = page.getByTestId('profile-date');
  await date.fill('31.02.2026');
  await date.press('Enter');
  await expect(page.getByTestId('profile-date-error')).toHaveText('Diesen Tag gibt es nicht.');
  expect(await saves(page)).toBe(4);
  await date.fill('01.12.2026');
  await date.press('Enter');
  await expect.poll(() => saves(page)).toBe(5);
  // A chip field adds what was typed; a row goes to the next row.
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await expect(chips(page.getByTestId('profile-tools')).last()).toHaveText('Miro');
  await page.getByTestId('competence-name').first().press('Enter');
  await expect(page.getByTestId('competence-name').nth(1)).toBeFocused();
  expect(await saves(page)).toBe(5);
  // Ctrl+S (Cmd+S on macOS) stays the form's save from anywhere in it.
  await page.getByTestId('competence-name').nth(1).press('Control+s');
  await expect.poll(() => saves(page)).toBe(6);
});

test('Enter goes through the rows and never saves; on an empty last row it moves on', async ({
  page,
}) => {
  await profile(page);
  const names = page.getByTestId('competence-name');
  await names.nth(0).press('Enter');
  await expect(names.nth(1)).toBeFocused();
  // On the last row: Enter adds a row and puts the caret into it.
  await page.getByTestId('competence-years').nth(5).press('Enter');
  await expect(names).toHaveCount(7);
  await expect(names.nth(6)).toBeFocused();
  await names.nth(6).fill('Konzernabschluss');
  await page.getByTestId('competence-years').nth(6).fill('15');
  await page.getByTestId('competence-years').nth(6).press('Enter');
  await expect(names).toHaveCount(8);
  await expect(names.nth(7)).toBeFocused();
  // On an empty last row: the row goes and the caret moves on to the next field.
  await names.nth(7).press('Enter');
  await expect(names).toHaveCount(7);
  await expect(page.getByTestId('profile-strengths').locator('input')).toBeFocused();
  // Languages behave the same.
  const languages = page.getByTestId('language-name');
  await languages.nth(1).press('Enter');
  await expect(languages).toHaveCount(3);
  await expect(languages.nth(2)).toBeFocused();
  expect(await saves(page)).toBe(0);
  await languages.nth(2).fill('Spanisch');
  await languages.nth(2).press('Control+s');
  await expect(page.getByTestId('profile-saved')).toHaveText('Gespeichert, Jobs neu bewertet.');
  const sent = await lastSave(page);
  expect(sent.after.competences.map((row) => row.name)).toContain('Konzernabschluss');
  expect(sent.after.languages.map((row) => row.language)).toContain('Spanisch');
});

test('one choice is one Tab stop, the arrows choose, "Offen" clears it', async ({ page }) => {
  await profile(page);
  const row = page.getByTestId('language-row').first();
  const levels = row.getByTestId('language-level');
  await expect(levels).toHaveAttribute('role', 'radiogroup');
  const name = (await levels.locator('[aria-checked="true"]').textContent())!.trim();
  // Name, the chosen level, the x: three stops.
  await row.getByTestId('language-name').focus();
  await page.keyboard.press('Tab');
  await expect(levels.getByRole('radio', { name })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row.getByTestId('language-remove')).toBeFocused();
  // The arrows choose the next level, Home and End the ends.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowRight');
  const next = levels.locator('[aria-checked="true"]');
  await expect(next).toBeFocused();
  expect((await next.textContent())!.trim()).not.toBe(name);
  await page.keyboard.press('Home');
  await expect(levels.getByRole('radio', { name: 'A1' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(levels.getByRole('radio', { name: 'Muttersprache' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(levels.locator('[tabindex="0"]')).toHaveCount(1);
  // Space on the chosen level clears it; the group keeps one stop, the first.
  await page.keyboard.press('Space');
  await expect(levels.locator('[aria-checked="true"]')).toHaveCount(0);
  await expect(levels.locator('[tabindex="0"]')).toHaveText('A1');
  // A single choice of the form is left open by "Offen", which stays chosen when pressed.
  const remote = page.getByTestId('profile-remote');
  const look = await remote
    .getByRole('radio')
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute('aria-checked'), getComputedStyle(node).color]),
    );
  const on = look.filter(([checked]) => checked === 'true').map(([, color]) => color);
  expect(on).toHaveLength(1);
  expect(look.filter(([checked]) => checked === 'false').map(([, c]) => c)).not.toContain(on[0]);
  for (let i = 0; i < 2; i++) {
    await remote.getByRole('radio', { name: 'Offen' }).click();
    await expect(remote.getByRole('radio', { name: 'Offen' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  }
  await expect(remote.locator('[aria-checked="true"]')).toHaveCount(1);
  const available = page.getByTestId('profile-available');
  await available.getByRole('radio', { name: 'Sofort' }).click();
  await available.getByRole('radio', { name: 'Offen' }).click();
  await expect(available.getByRole('radio', { name: 'Offen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after.languages[0]!.level).toBeNull();
  expect(sent.after.wishes.remote).toBeNull();
  expect(sent.after.criteria.available).toEqual({ kind: 'unset' });
});

test('a button that goes hands its focus on', async ({ page }) => {
  await create(page);
  // DACH: the countries field.
  await page.getByTestId('profile-dach').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('profile-dach')).toHaveCount(0);
  await expect(countryInput(page)).toBeFocused();
  // A row's x: the row now in its place, else the one before, else the add button.
  const names = page.getByTestId('competence-name');
  await names.first().fill('Controlling');
  await page.getByTestId('competence-add').click();
  await names.nth(1).fill('Treasury');
  await page.getByTestId('competence-add').click();
  await names.nth(2).fill('Reporting');
  const remove = page.getByTestId('competence-remove');
  await remove.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(names).toHaveCount(2);
  await expect(names.nth(1)).toBeFocused();
  await expect(names.nth(1)).toHaveValue('Reporting');
  await remove.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(names.nth(0)).toBeFocused();
  await remove.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(names).toHaveCount(0);
  await expect(page.getByTestId('competence-add')).toBeFocused();
  await page.getByTestId('language-remove').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('language-name')).toHaveCount(0);
  await expect(page.getByTestId('language-add')).toBeFocused();
});

// ------------------------------------------------------------------ numbers and days

test('money is grouped like everywhere; cents and decimals count whole, and say so', async ({
  page,
}) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await expect(rate).toHaveValue('1.100');
  // Typed plain, grouped again when the field is left.
  await rate.fill('1250');
  await expect(rate).toHaveValue('1250');
  await page.getByTestId('profile-name-field').focus();
  await expect(rate).toHaveValue('1.250');
  await rate.fill('950,50');
  // Said once the field is left, not while typing.
  await expect(page.getByTestId('profile-min-rate-rounded')).toHaveCount(0);
  await page.getByTestId('profile-name-field').focus();
  await expect(rate).toHaveValue('950');
  await expect(page.getByTestId('profile-min-rate-rounded')).toHaveText(
    'Auf ganze Euro abgerundet.',
  );
  // A point works the same; a group of three digits stays a thousands separator.
  const wish = page.getByTestId('profile-wish-rate');
  await wish.fill('1.180.75');
  await page.getByTestId('profile-name-field').focus();
  await expect(wish).toHaveValue('1.180');
  await wish.fill('1,300');
  await expect(page.getByTestId('profile-wish-rate-rounded')).toHaveCount(0);
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after.criteria.minDayRate).toBe(950);
  expect(sent.after.wishes.dayRate).toBe(1300);
});

test('the day exists only for "Ab Datum", gets the caret and is judged when left or saved', async ({
  page,
}) => {
  await profile(page);
  const choices = page.getByTestId('profile-available');
  const date = page.getByTestId('profile-date');
  const error = page.getByTestId('profile-date-error');
  await choices.getByRole('radio', { name: 'Sofort' }).click();
  await expect(date).toHaveCount(0);
  await choices.getByRole('radio', { name: 'Ab Datum' }).click();
  await expect(date).toBeFocused();
  for (const character of '1.11.2026') {
    await page.keyboard.type(character);
    await expect(error).toHaveCount(0);
  }
  await page.keyboard.press('Tab');
  await expect(error).toHaveCount(0);
  // A day in the wrong form, said when the field is left.
  await date.fill('1.11.202');
  await expect(error).toHaveCount(0);
  await page.getByTestId('profile-name-field').focus();
  await expect(error).toHaveText('Gib das Datum im Format 01.11.2026 ein.');
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  // Typing again waits for the next judgement.
  await date.focus();
  await page.keyboard.type('6');
  await expect(error).toHaveCount(0);
  // Left empty, it waits for the save; a day the calendar does not have says so, once, and
  // nothing is saved.
  await date.fill('');
  await page.getByTestId('profile-name-field').focus();
  await expect(error).toHaveCount(0);
  await date.fill('31.02.2026');
  await save(page).click();
  await expect(date).toBeFocused();
  await expect(error).toHaveText('Diesen Tag gibt es nicht.');
  const said = (await page.locator('body').innerText()).split('Diesen Tag gibt es nicht.');
  expect(said).toHaveLength(2);
  await expect(page.getByTestId('profile-save-status')).toHaveText('Nicht gespeichert');
  expect(await saves(page)).toBe(0);
  // After "Verwerfen", the day chosen anew is judged anew.
  await discard(page).click();
  await expect(date).toHaveCount(0);
  await choices.getByRole('radio', { name: 'Ab Datum' }).click();
  await expect(date).toBeFocused();
  await expect(error).toHaveCount(0);
  // "Sofort" drops the day.
  await date.fill('1.11.2026');
  await choices.getByRole('radio', { name: 'Sofort' }).click();
  await expect(date).toHaveCount(0);
  await save(page).click();
  expect((await lastSave(page)).after.criteria.available).toEqual({ kind: 'now' });
  // In English.
  await profile(page, '&lang=en');
  await page.getByTestId('profile-available').getByRole('radio', { name: 'From a date' }).click();
  await page.getByTestId('profile-date').fill('31/02/2026');
  await page.getByTestId('profile-name-field').focus();
  await expect(error).toHaveText('This day does not exist.');
});

test('a value the backend refuses is said at its field, which gets the caret', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('250000');
  await save(page).click();
  await expect(field(page, 'minDayRate')).toContainText('Höchstens 100.000.');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(rate).toBeFocused();
  // The bar only says that nothing is saved; the reason is at the field.
  await expect(page.getByTestId('profile-save-status')).toHaveText('Nicht gespeichert');
  // The next change takes the mark away.
  await rate.fill('1200');
  await expect(rate).not.toHaveAttribute('aria-invalid', 'true');
  // A competence: its row is marked and gets the caret (counted without the empty rows).
  await page.getByTestId('competence-add').click();
  await page.getByTestId('competence-years').nth(3).fill('80');
  await save(page).click();
  expect((await lastSave(page)).after.competences[3]!.years).toBe(80);
  await expect(page.getByTestId('competence-error')).toHaveText('Höchstens 70.');
  const names = page.getByTestId('competence-name');
  await expect(names.nth(3)).toHaveAttribute('aria-invalid', 'true');
  await expect(names.nth(2)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(names.nth(3)).toBeFocused();
});

for (const [platform, query] of [
  ['Windows', WIN],
  ['macOS', MAC],
] as const) {
  test(`days the backend refuses are said at the workload (${platform})`, async ({ page }) => {
    await profile(page, query);
    const max = page.getByTestId('profile-workload-max');
    await max.fill('7');
    await save(page).click();
    await expect(field(page, 'workload')).toContainText('Höchstens 5.');
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await expect(max).toBeFocused();
    await expect(page.getByTestId('profile-save-status')).toHaveText('Nicht gespeichert');
    // The second day below the first has no limit, it says which way round.
    await page.getByTestId('profile-workload-min').fill('4');
    await max.fill('3');
    await expect(max).not.toHaveAttribute('aria-invalid', 'true');
    await save(page).click();
    await expect(field(page, 'workload')).toContainText('Der zweite Wert liegt unter dem ersten.');
    await expect(max).toBeFocused();
    expect(await saves(page)).toBe(2);
  });
}

test('a day far beyond the week and a duration too long reach the backend and are refused', async ({
  page,
}) => {
  await profile(page);
  const min = page.getByTestId('profile-workload-min');
  await min.fill('300');
  await save(page).click();
  await expect(field(page, 'workload')).toContainText('Höchstens 5.');
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  await expect(min).toBeFocused();
  expect((await lastSave(page)).after.criteria.workloadMinDays).toBe(300);
  await min.fill('4');
  const months = page.getByTestId('profile-min-months');
  await months.fill('200');
  await save(page).click();
  await expect(field(page, 'minMonths')).toContainText('Höchstens 120.');
  await expect(months).toHaveAttribute('aria-invalid', 'true');
  await expect(months).toBeFocused();
  await months.fill('9');
  await save(page).click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
  expect(await saves(page)).toBe(3);
  expect((await lastSave(page)).after.criteria).toMatchObject({
    workloadMinDays: 4,
    workloadMaxDays: 5,
    minMonths: 9,
  });
});

test('values that contradict each other say so quietly at the field', async ({ page }) => {
  await profile(page);
  const wish = field(page, 'wishDayRate');
  const target = field(page, 'targetYears');
  await expect(wish).not.toContainText(T.profile.field.belowMinRate);
  await page.getByTestId('profile-wish-rate').fill('1000');
  await expect(wish).toContainText(T.profile.field.belowMinRate);
  await expect(page.getByTestId('profile-wish-rate')).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('profile-min-rate').fill('900');
  await expect(wish).not.toContainText(T.profile.field.belowMinRate);
  // Jobs for more years than her experience.
  await expect(target).not.toContainText(T.profile.field.aboveExperience);
  await page.getByTestId('profile-target-years').fill('25');
  await expect(target).toContainText(T.profile.field.aboveExperience);
  await page.getByTestId('profile-years').fill('30');
  await expect(target).not.toContainText(T.profile.field.aboveExperience);
  // Quiet hints never hold a save back.
  await page.getByTestId('profile-target-years').fill('35');
  await save(page).click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
});

// ------------------------------------------------------------------ switches and Festanstellung

test('switches: only the switch switches, its text names and describes it; each row its line', async ({
  page,
}) => {
  await profile(page);
  const criteria = page.getByTestId('section-criteria');
  const cases = [
    { id: 'profile-remote-outside', label: 'Remote-Jobs im Ausland ausschließen', hint: null },
    { id: 'profile-no-anue', label: 'Zeitarbeit ausschließen', hint: null },
    {
      id: 'profile-no-permanent',
      label: 'Festanstellung ausschließen',
      hint: 'Nur bei klarem Wortlaut, sonst markiert die App den Job zum Prüfen.',
    },
  ];
  // Every row but the last has its hairline; the list has one above and one below.
  const lines = await criteria
    .locator('[data-setting-row]')
    .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).borderBottomWidth));
  expect(lines).toEqual(['1px', '1px', '0px']);
  for (const { id, label, hint } of cases) {
    const toggle = page.getByTestId(id);
    const before = await toggle.getAttribute('aria-checked');
    await criteria.getByText(label, { exact: true }).click();
    if (hint) await criteria.getByText(hint, { exact: true }).click();
    await expect(toggle, `${id} from its text`).toHaveAttribute('aria-checked', before!);
    await expect(toggle).toHaveAccessibleName(label);
    if (hint) await expect(toggle).toHaveAccessibleDescription(hint);
    await toggle.click();
    await expect(toggle, `${id} itself`).not.toHaveAttribute('aria-checked', before!);
  }
  // No text of the form is a label of a switch.
  const ids = await criteria.getByRole('switch').evaluateAll((nodes) => nodes.map((n) => n.id));
  for (const id of ids) await expect(page.locator(`label[for="${id}"]`)).toHaveCount(0);
});

test('the remote switch excludes, sits under the countries and needs one', async ({ page }) => {
  await profile(page);
  const toggle = page.getByTestId('profile-remote-outside');
  const box = async (node: Locator): Promise<{ y: number; height: number }> =>
    (await node.boundingBox())!;
  const list = await box(countries(page));
  expect((await box(toggle)).y).toBeGreaterThan(list.y + list.height);
  expect((await box(toggle)).y).toBeLessThan((await box(page.getByTestId('profile-no-anue'))).y);
  await expect(field(page, 'remoteOutside')).not.toContainText('Ausgeschaltet');
  // The file allows them: the switch that excludes is off; on, the save says "not allowed".
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await save(page).click();
  expect((await lastSave(page)).after.criteria.remoteOutside).toBe(false);
  // Without countries it has nothing to do: disabled, its tooltip says why.
  for (const name of ['Deutschland', 'Österreich']) {
    await countries(page)
      .getByRole('button', { name: `${name} entfernen` })
      .click();
  }
  await expect(toggle).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, toggle)).toBe('Wähle erst die Einsatzländer.');
});

test('Festanstellung: places first, the remote share waits for them; excluded, the block goes', async ({
  page,
}) => {
  await profile(page);
  const block = page.getByTestId('profile-permanent');
  const y = async (id: string): Promise<number> => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('profile-places')).toBeLessThan(await y('profile-min-salary'));
  expect(await y('profile-min-salary')).toBe(await y('profile-remote-min'));
  // A value of the file that does not read keeps the block, also while permanent roles are
  // excluded, so "1 Wert prüfen" leads to it.
  await page.getByTestId('profile-no-permanent').click();
  await expect(block).toBeVisible();
  await check(page).click();
  await expect(page.getByTestId('profile-remote-min')).toBeFocused();
  await field(page, 'permanentRemoteMin').getByTestId('value-remove').click();
  await expect(block).toHaveCount(0);
  await expect(page.getByTestId('profile-min-salary')).toHaveCount(0);
  await page.getByTestId('profile-no-permanent').click();
  // Without places the empty share waits and says for what.
  const share = page.getByTestId('profile-remote-min');
  await expect(share).toBeDisabled();
  await expect(field(page, 'permanentRemoteMin')).toContainText(T.profile.field.placesFirst);
  const places = page.getByTestId('profile-places').locator('input');
  await places.fill('Hamburg');
  await places.press('Enter');
  await expect(share).toBeEnabled();
  await expect(field(page, 'permanentRemoteMin')).toContainText(T.profile.field.remoteMinHint);
  await share.fill('50');
  // A share without places stays and says the dependency quietly, no red error.
  await page
    .getByTestId('profile-places')
    .getByRole('button', { name: 'Hamburg entfernen' })
    .click();
  await expect(share).toBeEnabled();
  await expect(share).not.toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, 'permanentRemoteMin')).toContainText(T.profile.field.placesFirst);
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.clear).toEqual(['permanentRemoteMin']);
  expect(sent.after.criteria.permanentRemoteMin).toBe(50);
  expect(sent.after.criteria.noAnue).toBe(true);
});

// ------------------------------------------------------------------ countries

test('the countries: search in both languages, Enter or a click, chips, DACH in one click', async ({
  page,
}) => {
  await profile(page);
  const input = countryInput(page);
  // German names, and any word of them: the chosen ones are not offered again.
  await input.fill('schw');
  await expect(options(page).getByRole('option')).toHaveText(['Schweden', 'Schweiz']);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  // Enter takes the first one.
  await input.press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweden']);
  await expect(input).toHaveValue('');
  await expect(options(page)).toBeHidden();
  // English names find the country too, named in the app's language; a click takes it.
  await input.fill('nether');
  await expect(options(page).getByRole('option')).toHaveText(['Niederlande']);
  await options(page).getByRole('option', { name: 'Niederlande' }).click();
  await expect(input).toBeFocused();
  // Accents do not matter.
  await input.fill('dane');
  await expect(options(page).getByRole('option')).toHaveText(['Dänemark']);
  await input.press('Escape');
  await expect(input).toHaveValue('');
  // A chip goes with its x; DACH brings back what is missing of the three, then goes.
  await countries(page).getByRole('button', { name: 'Österreich entfernen' }).click();
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Schweden', 'Niederlande']);
  await page.getByTestId('profile-dach').click();
  await expect(chips(countries(page))).toHaveText([
    'Deutschland',
    'Schweden',
    'Niederlande',
    'Österreich',
    'Schweiz',
  ]);
  await expect(page.getByTestId('profile-dach')).toHaveCount(0);
  await save(page).click();
  expect((await lastSave(page)).after.criteria.countries).toEqual(['DE', 'SE', 'NL', 'AT', 'CH']);
});

test('the countries: the arrows and the pointer move the one mark, Enter takes it', async ({
  page,
}) => {
  await profile(page);
  const input = countryInput(page);
  await input.fill('schw');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await input.fill('schw');
  await input.press('ArrowDown');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(chips(countries(page)).last()).toHaveText('Schweden');
  await input.fill('s');
  const all = options(page).getByRole('option');
  await expect(all.first()).toHaveAttribute('aria-selected', 'true');
  const third = all.nth(2);
  const name = (await third.textContent())!.trim();
  const box = (await third.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // The option under the pointer is the one mark, no second wash stays on the first.
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await expect(options(page).locator('[aria-selected="true"]')).toHaveCount(1);
  const washes = await all.evaluateAll((nodes) =>
    nodes.map((node) => getComputedStyle(node).backgroundColor),
  );
  expect(new Set(washes.filter((_, index) => index !== 2)).size).toBe(1);
  expect(washes[2]).not.toBe(washes[0]);
  await input.press('Enter');
  await expect(chips(countries(page)).last()).toHaveText(name);
});

test('the countries: other names find them, a chosen one or no country says so', async ({
  page,
}) => {
  await profile(page);
  const none = page.getByTestId('profile-countries-none');
  for (const text of ['Deutsch', 'Deutschland', 'Germany', 'Öster']) {
    await countryInput(page).fill(text);
    await expect(none, text).toHaveCount(0);
    await expect(options(page), text).toBeHidden();
  }
  for (const [text, name] of [
    ['UK', 'Großbritannien'],
    ['England', 'Großbritannien'],
    ['Britain', 'Großbritannien'],
    ['Holland', 'Niederlande'],
    ['United States', 'USA'],
    ['Vereinigte Staaten', 'USA'],
    ['Amerika', 'USA'],
    ['Czech Republic', 'Tschechien'],
  ] as const) {
    await countryInput(page).fill(text);
    await expect(options(page).getByRole('option'), text).toHaveText([name]);
    await expect(none, text).toHaveCount(0);
  }
  await countryInput(page).press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Tschechien']);
  // Text that names no country says so and is not taken; leaving with one match takes it.
  await countryInput(page).fill('Atlantis');
  await expect(none).toHaveText('Kein Land mit diesem Namen.');
  await expect(options(page)).toBeHidden();
  await countryInput(page).press('Enter');
  await page.getByTestId('profile-name-field').focus();
  await expect(chips(countries(page))).toHaveCount(3);
  await expect(countryInput(page)).toHaveValue('Atlantis');
  await countryInput(page).fill('Ital');
  await page.getByTestId('profile-name-field').focus();
  await expect(chips(countries(page)).last()).toHaveText('Italien');
  await expect(none).toHaveCount(0);
  // In English: English names, German ones still find them.
  await profile(page, '&lang=en');
  await expect(chips(countries(page))).toHaveText(['Germany', 'Austria']);
  await countryInput(page).fill('schweiz');
  await expect(options(page).getByRole('option')).toHaveText(['Switzerland']);
});

// ------------------------------------------------------------------ competences, chips, languages

test('at most five Schwerpunkte: the star says what a click does, a sixth waits', async ({
  page,
}) => {
  await profile(page);
  const stars = page.getByTestId('competence-star');
  // Like the favourite star of a job: its words follow its state.
  await expect(stars.nth(1)).toHaveAttribute('aria-label', 'Schwerpunkt entfernen');
  expect(await tooltipOf(page, stars.nth(1))).toBe('Schwerpunkt entfernen');
  await expect(stars.nth(0)).toHaveAttribute('aria-label', 'Als Schwerpunkt markieren');
  for (const index of [0, 3, 4]) await stars.nth(index).click();
  await expect.poll(() => marked(page)).toHaveLength(5);
  await expect(page.getByTestId('focus-count')).toHaveText('5/5');
  // The sixth target is off, its tooltip says why right at the pointer.
  await expect(stars.nth(5)).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, stars.nth(5))).toBe('Höchstens fünf Schwerpunkte.');
  await stars.nth(5).click({ force: true });
  await expect(stars.nth(5)).toHaveAttribute('aria-pressed', 'false');
  // Unstarring makes room; renaming a starred competence takes the Schwerpunkt along.
  await stars.nth(0).click();
  await expect(stars.nth(5)).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('competence-name').nth(1).fill('Konzerncontrolling');
  await expect.poll(async () => (await marked(page))[0]).toBe('Konzerncontrolling');
  await expect(page.getByTestId('focus-count')).toHaveText('4/5');
  // A row without a competence: its star waits, and says for what.
  await page.getByTestId('competence-add').click();
  const empty = page.getByTestId('competence-row').last().getByTestId('competence-star');
  await expect(empty).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, empty)).toBe('Trag erst eine Kompetenz ein.');
});

test('a file with seven Schwerpunkte: the first five are taken, saving works', async ({ page }) => {
  await profile(page, '&scenario=no-profile&file=focus');
  await page.getByTestId('profile-pick').click();
  await expect.poll(() => marked(page)).toHaveLength(5);
  await expect(page.getByTestId('focus-trimmed')).toHaveText(
    'Die Datei nennt 7 Schwerpunkte, übernommen sind die ersten fünf.',
  );
  await expect(page.getByTestId('focus-count')).toHaveText('5/5');
  await save(page).click();
  await expect(page.getByTestId('profile-saved')).toBeVisible();
  expect((await lastSave(page)).after.focus).toHaveLength(5);
});

test('chip field: Enter adds, a pasted list splits, x and Backspace remove, Esc drops', async ({
  page,
}) => {
  await profile(page);
  const tools = page.getByTestId('profile-tools');
  const input = tools.locator('input');
  await input.fill('Excel');
  await input.press('Enter');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'LucaNet', 'Power BI', 'Excel']);
  // The same value in another case is not added twice; the typed text goes.
  await input.fill('excel');
  await input.press('Enter');
  await expect(chips(tools)).toHaveCount(4);
  await expect(input).toHaveValue('');
  // A pasted list becomes one chip per entry.
  await input.focus();
  await paste(input, 'Tableau, Qlik\nJira');
  await expect(chips(tools)).toHaveCount(7);
  // Backspace in the empty field removes the last chip, x removes any.
  await input.press('Backspace');
  await expect(chips(tools)).toHaveCount(6);
  await tools.getByRole('button', { name: 'LucaNet entfernen' }).click();
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI', 'Excel', 'Tableau', 'Qlik']);
  // Esc drops what was typed; leaving the field adds it.
  await input.fill('Visio');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await input.fill('Miro');
  await page.getByTestId('profile-name-field').click();
  await expect(chips(tools).last()).toHaveText('Miro');
  await input.press('Control+s');
  await expect(page.getByTestId('profile-saved')).toHaveText('Gespeichert, Jobs neu bewertet.');
  expect((await lastSave(page)).after.tools).toEqual([
    'SAP S/4HANA',
    'Power BI',
    'Excel',
    'Tableau',
    'Qlik',
    'Miro',
  ]);
});

test('sentences keep their commas; a double click takes a chip back to edit it', async ({
  page,
}) => {
  await profile(page);
  const strengths = page.getByTestId('profile-strengths');
  const input = strengths.locator('input');
  await input.fill('Verbindet Zahlen, Menschen und Wandel');
  await input.press('Enter');
  await expect(chips(strengths)).toHaveText([
    'Aufbau von Konzernreportings in weniger als 100 Tagen',
    'Verbindet Zahlen, Menschen und Wandel',
  ]);
  // Pasted, only line breaks split a list of sentences.
  await input.focus();
  await paste(input, 'Führt Teams, auch remote\nSpricht die Sprache der Werke');
  await expect(chips(strengths)).toHaveCount(4);
  await expect(chips(strengths).nth(2)).toHaveText('Führt Teams, auch remote');
  // Degrees and certificates keep their commas too.
  const degrees = page.getByTestId('profile-degrees').locator('input');
  await degrees.fill('Master of Science, Wirtschaftsinformatik');
  await degrees.press('Enter');
  await expect(chips(page.getByTestId('profile-degrees')).last()).toHaveText(
    'Master of Science, Wirtschaftsinformatik',
  );
  // A double click on a chip puts its text back into the field, the rest stays.
  const tools = page.getByTestId('profile-tools');
  await chips(tools).nth(1).dblclick();
  await expect(tools.locator('input')).toBeFocused();
  await expect(tools.locator('input')).toHaveValue('LucaNet');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI']);
  await tools.locator('input').fill('LucaNet Financial');
  await tools.locator('input').press('Enter');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI', 'LucaNet Financial']);
});

test('the synonyms keep one line, "+n" names the rest, also narrow', async ({ page }) => {
  await profile(page);
  const aliases = page.getByTestId('competence-aliases').nth(1);
  const input = aliases.locator('input');
  await input.fill('Konzerncontrolling, Management Reporting, Unternehmensplanung, Forecasting');
  await input.press('Enter');
  // With the focus every chip shows (to remove or edit one).
  await expect(aliases.locator('.chip:not(.more):not(.spare)')).toHaveCount(6);
  await page.getByTestId('section-competences').getByRole('heading').click();
  await expect(aliases).toHaveCSS('height', '32px');
  const more = aliases.getByTestId('competence-aliases-more');
  await expect(more).toHaveText(/^\+\d$/);
  const hidden = Number((await more.textContent())!.trim().slice(1));
  await expect(aliases.locator('.chip.spare')).toHaveCount(hidden);
  expect(await tooltipOf(page, more)).toContain('Forecasting');
  await page.setViewportSize({ width: 480, height: 640 });
  await aliases.scrollIntoViewIfNeeded();
  expect(Math.round((await aliases.boundingBox())!.height)).toBe(32);
});

test('narrow, a language row keeps its levels under the name', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 600 });
  await profile(page);
  const row = page.getByTestId('language-row').first();
  const name = await row.getByTestId('language-name').boundingBox();
  const levels = await row.getByTestId('language-level').boundingBox();
  expect(levels!.y).toBeGreaterThanOrEqual(name!.y + name!.height);
  // The alias fields keep a word inside when the column header is gone.
  await expect(page.getByTestId('competence-aliases').first().locator('input')).toHaveAttribute(
    'placeholder',
    'Synonyme',
  );
});

test('the language field suggests common languages in both names', async ({ page }) => {
  await profile(page);
  await page.getByTestId('language-add').click();
  const name = page.getByTestId('language-name').last();
  await name.fill('fran');
  const suggestions = page.getByTestId('language-name-options').last();
  await expect(suggestions.getByRole('option')).toHaveText(['Französisch']);
  await name.press('Enter');
  await expect(name).toHaveValue('Französisch');
  await expect(suggestions.getByRole('option')).toHaveCount(0);
  // Found by its English name too, taken in the app's language; any other text stays.
  await name.fill('Spanish');
  await expect(suggestions.getByRole('option')).toHaveText(['Spanisch']);
  await name.fill('Klingonisch');
  await expect(suggestions.getByRole('option')).toHaveCount(0);
  await expect(name).toHaveValue('Klingonisch');
});

// ------------------------------------------------------------------ the ways in

test('no profile: one sentence and the three ways in, the CV first', async ({ page }) => {
  await profile(page, '&scenario=no-profile');
  const empty = page.getByTestId('profile-empty');
  await expect(empty).toContainText('Noch kein Profil');
  await expect(empty).toContainText('Mit einem Profil zeigt jeder Job, wie gut er passt.');
  await expect(empty.getByRole('button')).toHaveText([
    'Aus Lebenslauf anlegen',
    'Profil anlegen',
    'Profildatei wählen',
  ]);
  await expect(empty.locator('.btn.primary')).toHaveText('Aus Lebenslauf anlegen');
});

test('a new form starts with one row each; the other ways stay at hand', async ({ page }) => {
  await create(page);
  await expect(page.getByTestId('profile-name')).toHaveText('Neues Profil');
  await expect(page.getByTestId('profile-name-field')).toBeFocused();
  // One empty row each: the table and the star show at once.
  await expect(page.getByTestId('competence-name')).toHaveCount(1);
  await expect(page.getByTestId('language-name')).toHaveCount(1);
  for (const id of ['competence-add', 'language-add']) {
    await expect(page.getByTestId(id)).toHaveClass(/secondary/);
    await expect(page.getByTestId(id).locator('svg')).toHaveCount(1);
  }
  // Without rows the add button starts at the edge of the card, not indented.
  await page.getByTestId('competence-remove').click();
  const [add, list] = [
    await page.getByTestId('competence-add').boundingBox(),
    await page.getByTestId('competences').boundingBox(),
  ];
  expect(Math.abs(add!.x - list!.x)).toBeLessThanOrEqual(1);
  // The other two ways in stay at hand (the file in the menu); nothing is read yet.
  await expect(page.getByTestId('profile-from-cv')).toBeVisible();
  await page.getByTestId('profile-more').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
  await page.getByTestId('profile-more').click();
  await expect(page.getByTestId('menu').getByRole('menuitem')).toHaveText(['Profildatei wählen']);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-replaces')).toHaveCount(0);
  await expect(page.getByTestId('section-understood')).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
});

test('create and save; the quality follows while typing, red only without any term', async ({
  page,
}) => {
  await create(page);
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-name-field').fill('Erika Beispiel');
  // Typed, the form says how it reads: nothing to score yet.
  await expect(badge(page)).toHaveText('Ohne Kompetenzen');
  await expect(badge(page).locator('.badge')).toHaveClass(/danger/);
  expect(await tooltipOf(page, badge(page).locator('.badge'))).toBe(T.profile.qualityText.empty);
  await expect(page.getByTestId('profile-save-status')).toHaveText('Nicht gespeichert');
  // Other terms without a competence: amber, the match stays rough.
  const keywords = page.getByTestId('profile-keywords').locator('input');
  await keywords.fill('Controlling');
  await keywords.press('Enter');
  await expect(badge(page)).toHaveText('Ohne Kompetenzen');
  await expect(badge(page).locator('.badge')).toHaveClass(/warning/);
  expect(await tooltipOf(page, badge(page).locator('.badge'))).toBe(T.profile.noRowsText);
  await page.getByTestId('competence-name').fill('Controlling');
  await page.getByTestId('competence-years').fill('18');
  await expect(badge(page)).toHaveText('Wenig Inhalt');
  // The thin profile is said once, in the head.
  await expect(page.getByTestId('section-competences')).not.toContainText(
    'Wenige Kompetenzen, die Passung bleibt grob.',
  );
  // An added row takes the caret; an empty one is not saved.
  await page.getByTestId('competence-add').click();
  await expect(page.getByTestId('competence-name').last()).toBeFocused();
  await page.getByTestId('language-name').last().fill('Englisch');
  await page.getByTestId('language-row').last().getByRole('radio', { name: 'C1' }).click();
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.source).toBe('{}');
  expect(sent.after.competences).toEqual([
    { name: 'Controlling', years: 18, aliases: [], origin: null },
  ]);
  expect(sent.after.languages).toEqual([{ language: 'Englisch', level: 'c1', origin: null }]);
  // A new profile allows remote roles abroad, as the engine reads a missing key.
  expect(sent.after.criteria.remoteOutside).toBe(true);
  await expect(page.getByTestId('profile-name')).toHaveText('Erika Beispiel');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
});

test('a chosen file fills the form for review; discarding keeps what was there', async ({
  page,
}) => {
  await profile(page, '&scenario=no-profile');
  await page.getByTestId('profile-pick').click();
  await expect(page.getByTestId('profile-name')).toHaveText('Profil aus einer Datei');
  await expect(page.getByTestId('profile-review')).toHaveText(
    'Prüfe die Angaben und speichere sie.',
  );
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  // What does not read is said before saving, at its field.
  await expect(field(page, 'minDayRate')).toContainText(
    'In der Datei stand „ab 900“, das ist keine Zahl.',
  );
  await expect(badge(page)).toHaveText('Wenig Inhalt');
  // An unchanged draft: the reading is its own, not stale.
  await expect(page.getByTestId('section-understood')).toContainText(
    T.profile.sectionHint.understood,
  );
  await page.getByTestId('profile-title').fill('Projektleiter');
  await expect(page.getByTestId('section-understood')).toContainText(T.profile.reading.stale);
  // A draft is unsaved as it is: saving is possible at once.
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await discard(page).click();
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  expect(await saves(page)).toBe(0);
  await page.getByTestId('profile-pick').click();
  await save(page).click();
  expect((await lastSave(page)).source).toBe('{"name": "Jonas Muster"}');
  await expect(page.getByTestId('profile-name')).toHaveText('Jonas Muster');
  // No profile was there: nothing replaced, no toast.
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('another file over the profile says it replaces it; Rückgängig brings the old one back', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('profile-more').click();
  await page.getByTestId('menu-item-pick').click();
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  await expect(page.getByTestId('profile-replaces')).toHaveText(T.profile.replacesStored);
  await expect(page.getByTestId('profile-review')).toHaveCount(0);
  await save(page).click();
  await expect(page.getByTestId('profile-name')).toHaveText('Jonas Muster');
  const toast = page.getByTestId('toast').filter({ hasText: T.profile.replaced });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('profile-name')).toHaveText('Erika Beispiel');
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  expect(await calls(page, 'restore_profile')).toHaveLength(1);
  expect(await page.evaluate(() => window.__harness.form()?.name)).toBe('Erika Beispiel');
});

test('remove goes at once and can be taken back; an undo that fails says so', async ({ page }) => {
  await profile(page);
  const remove = async (): Promise<Locator> => {
    await page.getByTestId('profile-more').click();
    await page.getByTestId('menu-item-remove').click();
    await expect(page.getByTestId('profile-empty')).toBeVisible();
    const toast = page.getByTestId('toast').filter({ hasText: 'Profil entfernt.' });
    await expect(toast).toBeVisible();
    return toast;
  };
  await expect(page.getByTestId('dialog-remove-profile')).toHaveCount(0);
  await (await remove()).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('profile-name')).toHaveText('Erika Beispiel');
  expect(await calls(page, 'remove_profile')).toHaveLength(1);
  expect(await calls(page, 'restore_profile')).toHaveLength(1);
  const toast = await remove();
  await failNext(page, 'restore_profile');
  await toast.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: T.profile.restoreFailed }),
  ).toBeVisible();
  await expect(page.getByTestId('profile-empty')).toBeVisible();
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
  // A new form says that saving replaces the file, and its folder stays at hand.
  await page.getByTestId('profile-create').click();
  await expect(page.getByTestId('profile-replaces')).toHaveText(
    'Ein neues Profil ersetzt die Datei.',
  );
  await page.getByTestId('profile-more').click();
  await expect(page.getByTestId('menu').getByRole('menuitem')).toHaveText([
    'Profildatei wählen',
    'Ordner öffnen',
  ]);
  await page.keyboard.press('Escape');
  // Untouched, "Verwerfen" goes back to the three ways in, and "Profil anlegen" takes the
  // focus; Esc too, while nothing is typed.
  await expect(discard(page)).not.toHaveAttribute('aria-disabled', 'true');
  await discard(page).click();
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('profile-create')).toBeFocused();
  await page.getByTestId('profile-create').click();
  await expect(page.getByTestId('profile-name-field')).toBeFocused();
  await page.getByTestId('profile-name-field').fill('Erika');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await page.getByTestId('profile-name-field').fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('profile-create')).toBeFocused();
});

// ------------------------------------------------------------------ from a CV

const ANSWER = [
  'Gern, hier ist das Profil.',
  '',
  '```json',
  JSON.stringify(
    {
      name: 'Carla Exempel',
      titel: 'Interim CFO',
      berufserfahrung_jahre: 30,
      ausbildung: [{ abschluss: 'Diplom-Kauffrau (Univ.)' }],
      kernkompetenzen: [
        { kompetenz: 'Controlling', jahre: 28, auch: ['FP&A'] },
        { kompetenz: 'Treasury', jahre: 15, auch: [] },
      ],
      schwerpunkte: ['Controlling'],
      methoden_tools: [{ name: 'SAP S/4HANA' }],
      zertifizierungen: [],
      branchen: [{ branche: 'Chemie' }],
      sprachen: [{ sprache: 'Englisch', niveau: 'C1' }],
      alleinstellungsmerkmale: [],
      keywords: ['IFRS'],
      stationen: [{ zeitraum: '01/2020 bis heute', rolle: 'CFO', schwerpunkte: ['Treasury'] }],
    },
    null,
    2,
  ),
  '```',
].join('\n');

test('from a CV: the prompt is copied, the pasted answer fills the form', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await profile(page, '&scenario=no-profile');
  await page.getByTestId('profile-from-cv').click();
  const card = page.getByTestId('profile-paste');
  await expect(card).toBeVisible();
  // Where the CV goes, in one sentence; the prompt can be read before it goes out.
  await expect(page.getByTestId('paste-privacy')).toHaveText(
    'Der Lebenslauf geht an die KI, die du nutzt.',
  );
  await expect(page.getByTestId('paste-prompt')).toHaveCount(0);
  await page.getByTestId('paste-preview').getByRole('button', { name: 'Prompt ansehen' }).click();
  await expect(page.getByTestId('paste-prompt')).toContainText('Bitte erstelle');
  await expect(card).toContainText('Füge ihn in eine KI ein und hänge den Lebenslauf an.');
  // The same words as the rest of the app: KI and Prompt, never Claude or Anfrage.
  await expect(card).not.toContainText('Claude');
  await expect(card).not.toContainText('Anfrage');
  if (browserName === 'chromium') {
    await expect(page.getByTestId('paste-copied')).toContainText('Der Prompt ist kopiert.');
    await expect(page.getByTestId('paste-copy')).toHaveText('Erneut kopieren');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Bitte erstelle');
  }
  expect((await calls(page, 'profile_prompt')).map((call) => call[1])).toContainEqual({
    update: false,
  });
  const take = page.getByTestId('paste-take');
  await expect(take).toHaveAttribute('aria-disabled', 'true');
  await expect(card).toContainText('Antwort der KI');
  await page.getByTestId('paste-answer').fill('Das kann ich leider nicht.');
  await take.click();
  await expect(card).toContainText('In der Antwort steht kein Profil.');
  // An answer the AI broke off says so.
  await page.getByTestId('paste-answer').fill(ANSWER.slice(0, 200));
  await take.click();
  await expect(card).toContainText('Die Antwort bricht mitten im Profil ab.');
  await page.getByTestId('paste-answer').fill(ANSWER);
  await take.click();
  await expect(page.getByTestId('profile-name')).toHaveText('Profil aus dem Lebenslauf');
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Carla Exempel');
  await expect(page.getByTestId('competence-name')).toHaveCount(2);
  await expect.poll(() => marked(page)).toEqual(['Controlling']);
  expect((await calls(page, 'parse_profile')).at(-1)![1]).toEqual({
    text: ANSWER,
    update: false,
  });
  // Criteria are the user's own: the form asks for them, the answer brings none.
  await expect(page.getByTestId('profile-min-rate')).toHaveValue('');
  await save(page).click();
  expect((await lastSave(page)).after.name).toBe('Carla Exempel');
});

test('from a CV: when the prompt could not be copied, the step says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await profile(page, '&scenario=no-profile');
  await page.getByTestId('profile-from-cv').click();
  await expect(page.getByTestId('paste-copied')).toContainText(
    'Der Prompt ließ sich nicht kopieren.',
  );
  await expect(page.getByTestId('paste-copy')).toHaveText('Prompt kopieren');
});

test('a country of an answer the app does not know stays and shows as it is', async ({ page }) => {
  await profile(page, '&scenario=no-profile');
  await page.getByTestId('profile-from-cv').click();
  const answer = JSON.stringify({
    name: 'Carla Exempel',
    kernkompetenzen: [{ kompetenz: 'Controlling', jahre: 20 }],
    harte_kriterien: { laender: ['DE', 'XK'] },
  });
  await page.getByTestId('paste-answer').fill(answer);
  await page.getByTestId('paste-take').click();
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'XK']);
  await save(page).click();
  expect((await lastSave(page)).after.criteria.countries).toEqual(['DE', 'XK']);
});

/** An answer for the stored profile: a role, more years in total and for Controlling, fewer
 *  for Konsolidierung, a new competence, a higher level for English. */
const UPDATE = JSON.stringify({
  name: 'Carla Exempel',
  titel: 'Interim CFO',
  berufserfahrung_jahre: 30,
  kernkompetenzen: [
    { kompetenz: 'Controlling', jahre: 28, auch: ['FP&A', 'Planung'] },
    { kompetenz: 'Konsolidierung', jahre: 5, auch: [] },
    { kompetenz: 'Treasury', jahre: 15, auch: [] },
  ],
  sprachen: [
    { sprache: 'Englisch', niveau: 'C1' },
    { sprache: 'Französisch', niveau: 'B1' },
  ],
  keywords: ['IFRS', 'Cash Management'],
  stationen: [{ zeitraum: '01/2020 bis heute', rolle: 'CFO', schwerpunkte: ['Treasury'] }],
});

test('"Aus Lebenslauf aktualisieren" fills gaps and adds, never overwrites; years take the higher', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('profile-update-cv').click();
  await expect(page.getByTestId('profile-paste')).toContainText('Aus Lebenslauf aktualisieren');
  // The update prompt (it carries the stored profile), loaded with the profile.
  await page.getByTestId('paste-preview').getByRole('button', { name: 'Prompt ansehen' }).click();
  await expect(page.getByTestId('paste-prompt')).toContainText('Bitte aktualisiere');
  expect((await calls(page, 'profile_prompt')).map((call) => call[1])).toContainEqual({
    update: true,
  });
  await page.getByTestId('paste-answer').fill(UPDATE);
  await page.getByTestId('paste-take').click();
  expect((await calls(page, 'parse_profile')).at(-1)![1]).toEqual({ text: UPDATE, update: true });
  await expect(page.getByTestId('profile-name')).toHaveText(T.profile.draft.update);
  await expect(page.getByTestId('profile-review')).toBeVisible();
  // What is set stays: the name, the role, the level, the Schwerpunkte, the criteria.
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  await expect(page.getByTestId('profile-title')).toHaveValue('Interim Managerin Finanzen');
  await expect(page.getByTestId('profile-min-rate')).toHaveValue('1.100');
  await expect
    .poll(() => marked(page))
    .toEqual(['Controlling', 'Konzernrechnungslegung nach IFRS']);
  // Years take the higher number; what is new is added.
  await expect(page.getByTestId('profile-years')).toHaveValue('30');
  const names = page.getByTestId('competence-name');
  await expect(names).toHaveCount(7);
  await expect(names.last()).toHaveValue('Treasury');
  // Nothing is saved by itself.
  expect(await saves(page)).toBe(0);
  await save(page).click();
  const sent = await lastSave(page);
  const row = (name: string) => sent.after.competences.find((each) => each.name === name)!;
  expect(row('Controlling')).toMatchObject({
    years: 28,
    aliases: ['Financial Controlling', 'FP&A', 'Planung'],
    origin: 1,
  });
  expect(row('Konsolidierung').years).toBe(11);
  expect(row('Treasury')).toMatchObject({ years: 15, origin: null });
  expect(sent.after.years).toBe(30);
  expect(sent.after.title).toBe('Interim Managerin Finanzen');
  expect(sent.after.languages.map((each) => [each.language, each.level])).toEqual([
    ['Deutsch', 'native'],
    ['Englisch', 'b2'],
    ['Französisch', 'b1'],
  ]);
  expect(sent.after.keywords).toEqual(['IFRS', 'HGB', 'Konzernabschluss', 'Cash Management']);
  // Saving writes into the stored profile, which now has the career stations of the answer.
  const source = JSON.parse(sent.source!) as Record<string, unknown>;
  expect(source.harte_kriterien).toEqual({ min_tagessatz: 1100 });
  expect(source.stationen).toEqual([
    { zeitraum: '01/2020 bis heute', rolle: 'CFO', schwerpunkte: ['Treasury'] },
  ]);
});

// ------------------------------------------------------------------ values that do not read

test('a thin profile marks its empty sections, and they follow the form', async ({ page }) => {
  await profile(page, '&scenario=profile-thin');
  await expect(badge(page)).toHaveText('Wenig Inhalt');
  // The quality is said once, in the head: the badge, its tooltip why.
  expect(await tooltipOf(page, badge(page).locator('.badge'))).toBe(
    'Wenige Kompetenzen, die Passung bleibt grob.',
  );
  await expect(page.getByTestId('section-competences')).not.toContainText('Wenige Kompetenzen');
  await expect(page.getByText('Das Profil nennt nur wenige Kompetenzen.')).toHaveCount(0);
  const experience = page.getByTestId('section-experience');
  await expect(experience).toContainText('Noch leer');
  // An empty optional block says so quietly (neutral, not amber).
  await expect(experience.locator('.badge')).toHaveClass(/neutral/);
  await expect(page.getByTestId('section-competences')).not.toContainText('Noch leer');
  // Filled while typing, the section is no longer empty; enough terms and it is complete.
  await page.getByTestId('profile-years').fill('12');
  await expect(experience).not.toContainText('Noch leer');
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('SAP, Excel');
  await tools.press('Enter');
  await expect(badge(page)).toHaveText('Vollständig');
});

test('every value that does not read is said at its field and can be removed', async ({ page }) => {
  await profile(page, '&scenario=profile-unreadable');
  await expect(check(page)).toHaveText(/\d+ Werte prüfen/);
  // A key the app does not read at all is named in the head as the file writes it, with the
  // folder to fix it.
  const warning = page.getByTestId('profile-warning');
  await expect(warning).toContainText('Die App liest „tagessatz_max“ in den Konditionen nicht.');
  await warning.getByRole('button', { name: 'Ordner öffnen' }).click();
  expect((await calls(page, 'open_target')).at(-1)![1]).toEqual({
    target: { kind: 'profileDir' },
  });
  const form = page.getByTestId('profile-form');
  for (const text of [
    'In der Datei stand „teuer“, das ist keine Zahl.',
    'In der Datei stand „Atlantis“, das kann die App nicht lesen.',
    'In der Datei stand „5“, das kann die App nicht lesen.',
    'In der Datei stand „vielleicht“, das kann die App nicht lesen.',
    'In der Datei stand „senior“, das ist keine Zahl.',
    'In der Datei stand „hoch“, das ist keine Zahl.',
    'In der Datei stand „[]“, das kann die App nicht lesen.',
    'In der Datei stand „bald“, das ist kein Datum.',
    '„Treasury“ steht nicht bei den Kompetenzen.',
    '„Head of“ nennt kein Fachgebiet.',
    'In der Datei stand „egal“, das kann die App nicht lesen.',
    'In der Datei stand „{}“, das kann die App nicht lesen.',
    'In der Datei stand „lang“, das ist keine Zahl.',
  ]) {
    await expect(form).toContainText(text);
  }
  // The workload's two days are one field: one message (the first), both marked.
  await expect(field(page, 'workload')).toContainText(
    'In der Datei stand „viel“, das ist keine Zahl.',
  );
  await expect(page.getByTestId('profile-workload-min')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('profile-workload-max')).toHaveAttribute('aria-invalid', 'true');
  // "Wert entfernen" ends the message line of a half-width field as of a full-width one.
  for (const name of ['minDayRate', 'regions']) {
    const scope = field(page, name);
    const action = (await scope.getByTestId('value-remove').boundingBox())!;
    const message = (await scope.locator('[role="alert"]').boundingBox())!;
    const box = (await scope.boundingBox())!;
    expect(Math.abs(action.x + action.width - (box.x + box.width)), name).toBeLessThan(2);
    expect(action.y, name).toBeLessThan(message.y + message.height / 2);
  }
  // One per field: eighteen fields, each with "Wert entfernen".
  const removes = form.getByTestId('value-remove');
  await expect(removes).toHaveCount(18);
  // A Schwerpunkt and a target role that do not count go from their list at once.
  await page.getByTestId('focus-unread').getByTestId('value-remove').click();
  await expect.poll(() => marked(page)).toEqual(['Controlling']);
  await page.getByTestId('roles-unread').getByTestId('value-remove').click();
  await expect(chips(page.getByTestId('profile-roles'))).toHaveText(['Interim CFO']);
  // A new value fixes a field as well.
  await page.getByTestId('profile-min-rate').fill('1000');
  await expect(form).not.toContainText('In der Datei stand „teuer“, das ist keine Zahl.');
  await page.getByTestId('profile-min-months').fill('6');
  await expect(field(page, 'minMonths')).not.toContainText('lang');
  // The workload's one "Wert entfernen" takes both days.
  await field(page, 'workload').getByTestId('value-remove').click();
  await expect(page.getByTestId('profile-workload-max')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  // The others go with "Wert entfernen"; then nothing is left to check.
  while ((await removes.count()) > 0) await removes.first().click();
  await expect(check(page)).toHaveCount(0);
  await expect(badge(page)).toHaveText('Vollständig');
  await save(page).click();
  const sent = await lastSave(page);
  expect([...sent.clear].sort()).toEqual(
    [
      'available',
      'contracts',
      'countries',
      'minSalary',
      'permanentPlaces',
      'permanentRemoteMin',
      'regions',
      'remote',
      'remoteOutside',
      'targetYears',
      'wishDayRate',
      'wishIndustries',
      'workloadMinDays',
      'workloadMaxDays',
      'exclusionWords',
    ].sort(),
  );
  expect(sent.after.focus).toEqual(['Controlling']);
  expect(sent.after.roles).toEqual(['Interim CFO']);
  expect(sent.after.criteria.minDayRate).toBe(1000);
  expect(sent.after.criteria.minMonths).toBe(6);
});

test('a refused day is said at the workload before a value of the file that does not read', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-unreadable');
  const workload = field(page, 'workload');
  const max = page.getByTestId('profile-workload-max');
  await expect(workload).toContainText('„viel“');
  await max.fill('7');
  await save(page).click();
  await expect(workload).toContainText('Höchstens 5.');
  await expect(workload).not.toContainText('„viel“');
  await expect(max).toHaveAttribute('aria-invalid', 'true');
  await expect(max).toBeFocused();
  expect((await lastSave(page)).after.criteria.workloadMaxDays).toBe(7);
});

// ------------------------------------------------------------------ what the app reads

test('how the app reads the profile: the Suchbegriffe, their parts, what the form lacks', async ({
  page,
}) => {
  await profile(page);
  const reading = page.getByTestId('section-understood');
  await expect(reading.getByRole('heading', { level: 2 })).toHaveText(
    'So liest die App dein Profil',
  );
  await expect(page.getByTestId('reading-list')).toContainText('Konzernabschluss nach HGB');
  await expect(page.getByTestId('reading-list')).toContainText('und 30 weitere');
  // Also what only the file holds, which explains the count.
  await expect(page.getByTestId('reading-sources')).toContainText('Kompetenzen 6');
  await expect(page.getByTestId('reading-sources')).toContainText('Stationen 27, nur in der Datei');
  await expect(page.getByTestId('reading-packs')).toHaveText('Finanzen · SAP');
  // What the form shows is not said twice: no conditions, years and degrees are in the form.
  await expect(reading).not.toContainText('Konditionen');
  await expect(page.getByTestId('reading-years')).toHaveCount(0);
  await expect(page.getByTestId('reading-degrees')).toHaveCount(0);
  // With the form's years empty, the years the app found show; with changes, the sentence
  // says that they are not in it yet.
  await page.getByTestId('profile-years').fill('');
  await expect(page.getByTestId('reading-years')).toHaveText('20 Jahre');
  await expect(reading).toContainText('Das gilt ohne die Änderungen.');
  await page
    .getByTestId('profile-degrees')
    .getByRole('button', { name: 'Diplom-Kauffrau (Univ.) entfernen' })
    .click();
  await expect(page.getByTestId('reading-degrees')).toHaveText('Diplom-Kauffrau (Univ.)');
});

// ------------------------------------------------------------------ the setup's way on

test('during setup the first save leads to the mailbox, or with one to the first fetch', async ({
  page,
}) => {
  // Without a mailbox: back to the setup page, no fetch that must fail.
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('first-profile-form').click();
  await page.getByTestId('competence-name').fill('Controlling');
  await save(page).click();
  const next = page.getByTestId('profile-next');
  await expect(next).toHaveText(T.profile.nextMailbox);
  await next.click();
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  expect(await calls(page, 'start_run')).toHaveLength(0);
  // With a mailbox: the first fetch starts once, also by the keyboard.
  await open(page, `${WIN}&scenario=mailbox-only`);
  await page.getByTestId('first-profile-form').click();
  await page.getByTestId('competence-name').fill('Controlling');
  await save(page).click();
  await expect(next).toHaveText(T.profile.next);
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  const started = (await calls(page, 'start_run')).map(
    ([, args]) => (args as { request: unknown }).request,
  );
  expect(started).toEqual([{ kind: 'fetch' }]);
});

// ------------------------------------------------------------------ "Zum Profil hinzufügen"

test('DS-3: two terms added in quick succession both reach the profile', async ({ page }) => {
  await open(page, `${WIN}&view=overview`);
  const keywords = (): Promise<string[]> =>
    page.evaluate(() => window.__harness.form()?.keywords ?? []);
  const start = await keywords();
  const musts = page.getByTestId('open-musts').getByTestId('open-must');
  await expect(musts.nth(1)).toBeVisible();
  const label = async (n: number): Promise<string> =>
    (await musts.nth(n).locator('.must-label').textContent())?.trim() ?? '';
  const [x, y] = [await label(0), await label(1)];
  // The second click comes before the first save is done: each save starts from the profile
  // the one before left.
  await musts.filter({ hasText: x }).getByTestId('add-must').click();
  await musts.filter({ hasText: y }).getByTestId('add-must').click();
  await expect.poll(keywords).toEqual([...start, x, y]);
  expect(await saves(page)).toBe(2);
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

test('baseline: from a CV', async ({ page, browserName }) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await profile(page, '&scenario=no-profile');
  await page.getByTestId('profile-from-cv').click();
  await expect(page.getByTestId('profile-paste')).toBeVisible();
  await page.getByTestId('paste-answer').fill(ANSWER.slice(0, 120));
  await expectShot(page, 'profile-paste');
});
