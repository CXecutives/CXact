// Final UI round, track F (forms): the Profil blocks in their order, one size per role
// (fields, chip fields and choices 32 px, control labels 13/500), the head's menu, "Offen"
// of a single choice, the remote switch that excludes, Einstellungen without the fetch at
// start and with the keys, and the setup page that opens the CV steps.

import type { Locator, Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';

const WIN = '?platform=windows';

async function profile(page: Page, scenario = 'default'): Promise<void> {
  await open(page, `${WIN}&scenario=${scenario}`);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
}

async function settings(page: Page, query = WIN): Promise<void> {
  await open(page, query);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
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

test('forms-final: the Profil blocks run Person, Konditionen, Kompetenzen ... So liest', async ({
  page,
}) => {
  await profile(page);
  const order = await page
    .locator('[data-testid="profile-form"] section[data-testid^="section-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(order).toEqual([
    'section-person',
    'section-criteria',
    'section-competences',
    'section-experience',
    'section-languages',
    'section-wishes',
    'section-understood',
  ]);
  const criteria = page.getByTestId('section-criteria');
  await expect(criteria.getByRole('heading', { level: 2 })).toHaveText('Konditionen');
  // Verfügbar ab is a row of Konditionen, no block of its own.
  await expect(criteria.getByTestId('profile-available')).toBeVisible();
  await expect(page.getByTestId('section-availability')).toHaveCount(0);
  // "So liest die App dein Profil" is a heading and a card, open like every block.
  const reading = page.getByTestId('section-understood');
  await expect(reading.getByRole('heading', { level: 2 })).toHaveText(
    'So liest die App dein Profil',
  );
  await expect(reading.getByTestId('reading-list')).toBeVisible();
  await expect(reading).toContainText('Suchbegriffe');
  await expect(page.getByTestId('profile-understood')).toHaveText(
    /^\d+ Suchbegriffe · 2 Schwerpunkte$/,
  );
});

test('forms-final: fields, chip fields and choices are 32 px, their labels 13/500', async ({
  page,
}) => {
  await profile(page);
  const form = page.getByTestId('profile-form');
  const fields = await boxes(form, '.field.text');
  expect(fields.length).toBeGreaterThan(8);
  for (const field of fields) expect(field.height, field.text).toBe(32);
  // Chip fields of one line (every one of the demo profile), the synonyms included.
  const chips = await boxes(form, '.chip-input > .field.entry');
  expect(chips.length).toBeGreaterThan(8);
  for (const chip of chips) expect(chip.height, chip.text).toBe(32);
  const choices = await boxes(form, '[role="radiogroup"] button');
  expect(choices.length).toBeGreaterThan(10);
  for (const choice of choices) {
    expect(choice.height, choice.text).toBe(32);
    expect(choice.size, choice.text).toBe('14px');
  }
  // Every control label: a field's, a switch's, a choice's.
  const labels = [
    ...(await boxes(form, 'label')),
    ...(await boxes(form, '[data-toggle-row] .label')),
    ...(await boxes(form, '.block > .label')),
  ];
  expect(labels.length).toBeGreaterThan(15);
  for (const label of labels) {
    expect(label.size, label.text).toBe('13px');
    expect(label.weight, label.text).toBe('500');
  }
  // The answer of the CV steps has the 14 px of a field; the main actions are 32 px.
  for (const id of ['profile-save', 'profile-discard', 'profile-update-cv', 'profile-more']) {
    await expect(page.getByTestId(id)).toHaveCSS('height', '32px');
  }
  await expect(page.getByTestId('profile-dach')).toHaveCSS('height', '28px');
});

test('forms-final: the head has one main button and the menu of the rest', async ({ page }) => {
  await profile(page);
  const head = page.getByTestId('profile-file');
  await expect(head.locator('.actions').getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('profile-update-cv')).toHaveText('Aus Lebenslauf aktualisieren');
  await expect(page.getByTestId('profile-more')).toHaveAccessibleName('Weitere Aktionen');
  await page.getByTestId('profile-more').click();
  const menu = page.getByTestId('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Andere Datei wählen',
    'Ordner öffnen',
    'Entfernen',
  ]);
  // Entfernen needs no question: the profile goes, the toast takes it back.
  await page.getByTestId('menu-item-remove').click();
  await expect(page.getByTestId('dialog-remove-profile')).toHaveCount(0);
  expect(await calls(page, 'remove_profile')).toHaveLength(1);
  await expect(page.getByTestId('toasts')).toContainText('Profil entfernt.');
  await page.getByTestId('toasts').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
});

test('forms-final: "n Werte prüfen" goes to the first value that does not read', async ({
  page,
}) => {
  await profile(page, 'profile-unreadable');
  const check = page.getByTestId('profile-check');
  await expect(check).toHaveText(/\d+ Werte prüfen/);
  await check.click();
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  const field = await focused.evaluate((node) =>
    node.closest('[data-field]')?.getAttribute('data-field'),
  );
  expect(field).toBe('minDayRate');
});

test('forms-final: "Offen" clears a single choice', async ({ page }) => {
  await profile(page);
  const remote = page.getByTestId('profile-remote');
  await expect(remote.getByRole('radio', { name: 'Überwiegend remote' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await remote.getByRole('radio', { name: 'Offen' }).click();
  await expect(remote.getByRole('radio', { name: 'Offen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(remote.locator('[aria-checked="true"]')).toHaveCount(1);
  // Pressing the chosen one again keeps it (radios never clear themselves).
  await remote.getByRole('radio', { name: 'Offen' }).click();
  await expect(remote.getByRole('radio', { name: 'Offen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const available = page.getByTestId('profile-available');
  await available.getByRole('radio', { name: 'Sofort' }).click();
  await available.getByRole('radio', { name: 'Offen' }).click();
  await expect(available.getByRole('radio', { name: 'Offen' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByTestId('profile-save').click();
  const [, args] = (await calls(page, 'save_profile')).at(-1)!;
  const after = (args as { save: { after: { wishes: { remote: unknown } } } }).save.after;
  expect(after.wishes.remote).toBeNull();
});

test('forms-final: the remote switch excludes when it is on', async ({ page }) => {
  await profile(page);
  const row = page.locator('[data-field="remoteOutside"]');
  await expect(row).toContainText('Remote-Jobs im Ausland ausschließen');
  await expect(row).not.toContainText('Ausgeschaltet');
  // The demo profile allows them (the file's "allowed"): the switch is off.
  const toggle = page.getByTestId('profile-remote-outside');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('profile-save').click();
  const [, args] = (await calls(page, 'save_profile')).at(-1)!;
  const after = (args as { save: { after: { criteria: { remoteOutside: boolean } } } }).save.after;
  expect(after.criteria.remoteOutside).toBe(false);
});

test('forms-final: Einstellungen fetch nothing at start and list the keys', async ({ page }) => {
  await settings(page);
  await expect(page.getByTestId('toggle-auto-fetch')).toHaveCount(0);
  await expect(page.getByTestId('settings')).not.toContainText('Beim Start abrufen');
  await expect(page.getByTestId('settings-fetch').getByRole('switch')).toHaveCount(2);
  // "Alle Alert-Mails abrufen" is part of the Postfach.
  await expect(page.getByTestId('settings-mailbox').getByTestId('full-mailbox')).toBeVisible();
  const keys = page.getByTestId('settings-keys');
  await expect(keys.getByRole('heading', { level: 2 })).toHaveText('Tastenkürzel');
  await expect(keys.locator('dd')).toHaveCount(13);
  await expect(keys.locator('dd').first()).toHaveText('Strg+1');
  await expect(keys.locator('dd').last()).toHaveText('F5');
  // The row buttons are 28 px, none of the page is 36.
  const heights = await page
    .getByTestId('settings')
    .locator('button:not([role="switch"]):not([role="radio"])')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(heights.filter((height) => height > 32)).toEqual([]);
});

test('forms-final: macOS writes the keys with its symbols', async ({ page }) => {
  await settings(page, '?platform=macos');
  await expect(page.getByTestId('settings-keys').locator('dd').first()).toHaveText('⌘1');
});

test('forms-final: step 2 of the setup opens the CV steps, "Selbst ausfüllen" the form', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  const step = page.getByTestId('step-profile');
  await expect(step.getByTestId('first-profile')).toHaveText('Aus Lebenslauf anlegen');
  await step.getByTestId('first-profile').click();
  const paste = page.getByTestId('profile-paste');
  await expect(paste).toBeVisible();
  await expect(paste.getByRole('heading', { level: 2 })).toHaveText('Aus Lebenslauf anlegen');
  await expect(page.getByTestId('paste-cancel')).toHaveText('Schließen');
  await page.getByTestId('paste-cancel').click();
  await page.getByTestId('nav-jobs').click();
  await page.getByTestId('first-profile-form').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
});

test('forms-final: a failed first fetch keeps the setup page and says why', async ({ page }) => {
  await open(page, `${WIN}&scenario=first-fetch-failed`);
  const step = page.getByTestId('step-fetch');
  await expect(step).toContainText('30 Tage');
  await expect(step.getByTestId('first-fetch-failed')).toBeVisible();
  // Abrufen again completes and ends the setup.
  await step.getByTestId('first-fetch').click();
  await expect(page.getByTestId('first-run')).toHaveCount(0, { timeout: 15_000 });
});

test('forms-final: the synonyms keep one line, "+n" names the rest', async ({ page }) => {
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
  await more.hover();
  await expect(page.getByRole('tooltip')).toContainText('Forecasting');
});

test('forms-final: the language field suggests common languages in both names', async ({
  page,
}) => {
  await profile(page);
  await page.getByTestId('language-add').click();
  const field = page.getByTestId('language-name').last();
  await field.fill('fran');
  const options = page.getByTestId('language-name-options').last();
  await expect(options.getByRole('option')).toHaveText(['Französisch']);
  await field.press('Enter');
  await expect(field).toHaveValue('Französisch');
  await expect(options.getByRole('option')).toHaveCount(0);
  // Found by its English name too, taken in the app's language; any other text stays.
  await field.fill('Spanish');
  await expect(options.getByRole('option')).toHaveText(['Spanisch']);
  await field.fill('Klingonisch');
  await expect(options.getByRole('option')).toHaveCount(0);
  await expect(field).toHaveValue('Klingonisch');
});

// The toasts above the save bar: shell-final.spec.ts (the stack measures the bar).

test('forms-final: "Weiter zum ersten Abruf" starts the fetch', async ({ page }) => {
  await open(page, `${WIN}&scenario=mailbox-only`);
  await page.getByTestId('first-profile-form').click();
  await page.getByTestId('competence-name').fill('Controlling');
  await page.getByTestId('profile-save').click();
  await page.getByTestId('profile-next').click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  const started = (await calls(page, 'start_run')).map(
    ([, args]) => (args as { request: unknown }).request,
  );
  expect(started).toEqual([{ kind: 'fetch' }]);
});
