// The Profil view against the stub, in one spec: the head (the title and the CV button, which
// opens the file dialog at once), the card that says what is still missing (the rows stay calm,
// only the setup marks them), the form as the table of sections.ts lays it out (six groups on
// one page, each field a row with its label beside it, the info symbols at their places), the
// rows of entries with their add button, the two ways in, the CV and its failures, saving by
// itself, leaving and closing, values that hold the save, refused values, a quiet hint where
// values contradict each other, and that no field takes the caret by itself. The stub's demo
// profile looks for Interim CFO roles in Germany and Austria (projects and permanent roles),
// from 1 September 2026, and is complete.

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { bandOf } from '../../../ui/src/lib/ipc/types/bands';
import { MAX_YEARS } from '../../../ui/src/lib/ipc/types/profile';
import {
  animationsDone,
  calls,
  expect,
  expectShot,
  open,
  runFinished,
  settle,
  test,
} from './fixtures';
import { adder, chooseWay, failNext, fillRequired, stubList, T, WIN } from './helpers';

/** A country's German name (the catalog keeps them by code). */
const country = (code: string): string => T.profile.country[code] ?? code;
const AT = country('AT');
const BE = country('BE');
const CH = country('CH');
const DE = country('DE');
const LANGUAGE = T.profile.languageName;

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

/** A moment longer than a changed control waits before it saves (--save-delay). */
const T_SAVE = 400;
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
/** Chooses an option of a select of the form. */
async function choose(page: Page, testid: string, option: string): Promise<void> {
  await page.getByTestId(testid).click();
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}
/** Takes the caret out of the field that holds it: what it holds saves now. */
const leaveField = (page: Page): Promise<void> =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
/** Waits until the last save sent holds these values (the form saves by itself, often more
 *  than once on the way). */
async function savedWith(page: Page, values: Partial<ProfileSave['after']>): Promise<void> {
  await expect
    .poll(async () => {
      const last = (await calls(page, 'save_profile')).at(-1);
      return last ? (last[1] as { save: ProfileSave }).save.after : null;
    })
    .toMatchObject(values);
}
/** Waits until the last save is done and the form holds nothing unsaved. */
const allSaved = (page: Page): Promise<void> =>
  expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(false);
/** The profile as it is stored. */
const stored = (page: Page) => page.evaluate(() => window.__harness.form());
/** The fields that hold the caret: only a press on a field puts it there. */
const caret = (page: Page): Locator => page.locator('input:focus, textarea:focus');
/** The rows marked as required and still empty: none on the Profil page, whose card says it. */
const marked = (page: Page): Promise<string[]> =>
  page
    .locator('[data-missing]')
    .evaluateAll((all) => all.map((cell) => cell.getAttribute('data-field') ?? ''));
/** The card that says what is still missing. */
const missingCard = (page: Page): Locator => page.getByTestId('profile-missing');
/** "Aus Lebenslauf ausfüllen": the file dialog of the CV, at once. */
async function pickCv(page: Page): Promise<void> {
  await page.getByTestId('profile-from-cv').click();
}
/** The names of an item list's rows (`competences`, `languages`). */
const names = (page: Page, list: 'competences' | 'languages'): Locator =>
  page.getByTestId(list).locator('[data-copy]');

/** The toast that says what the rescore of a save moved (nothing is said otherwise). */
const savedToast = (page: Page): Locator => page.getByTestId('toast');

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

test('the title Profil with "Aus Lebenslauf ausfüllen" on its line, nothing more with a change', async ({
  page,
}) => {
  await profile(page);
  // The page's title (design round 7), its one action at the end of its line.
  await expect(page.getByTestId('profile-heading')).toHaveText(T.nav.profile);
  const head = page.getByTestId('profile-head');
  const cv = page.getByTestId('profile-from-cv');
  await expect(cv).toHaveText(T.profile.fromCv);
  await expect(head.getByRole('button')).toHaveCount(1);
  // A complete profile: nothing to say.
  await expect(missingCard(page)).toHaveCount(0);
  await page.getByTestId('profile-wish-rate').fill('1.250');
  await expect(head.getByRole('button')).toHaveCount(1);
});
test('no button of the page carries an ellipsis', async ({ page }) => {
  const buttons = (): Promise<string[]> => page.getByRole('button').allInnerTexts();
  await profile(page);
  await expect(page.getByTestId('competences-add-button')).toBeVisible();
  for (const words of await buttons()) expect(words).not.toMatch(/…|\.\.\./);
  await profile(page, '&scenario=no-profile');
  await expect(page.getByTestId('new-profile-ways')).toBeVisible();
  for (const words of await buttons()) expect(words).not.toMatch(/…|\.\.\./);
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
      ['project permanent temporary', words.contracts],
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
      await expect(label(scope.locator(`[data-field="${name}"]`)), name).toHaveText(text);
    }
  }
  // Kompetenzen and Sprachen: a group each, whose rows are the entries.
  for (const list of ['competences', 'languages'] as const) {
    await expect(field(page, list).getByTestId(`section-${list}`)).toBeVisible();
    await expect(field(page, list).getByTestId(list)).toBeVisible();
  }
  // A number carries its unit inside; every short control has one width.
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.unit.day);
  await expect(field(page, 'minSalary')).toContainText(T.profile.unit.year);
  await expect(field(page, 'years')).toContainText(T.profile.unit.years);
  const box = (id: string): Promise<DOMRect> =>
    page.getByTestId(id).evaluate((input) => input.closest('.field')!.getBoundingClientRect());
  expect((await box('profile-wish-rate')).width).toBe(170);
  expect((await box('profile-years')).width).toBe(170);
  expect((await box('profile-date')).width).toBe(170);
  const workMode = await page.getByTestId('profile-work-mode').boundingBox();
  expect(workMode?.width).toBe(170);
  // The label in its column of 188, 24 before the control, centred on a single line.
  const name = await label(field(page, 'dayRateWish')).evaluate((node) =>
    node.getBoundingClientRect(),
  );
  const control = await box('profile-wish-rate');
  expect(Math.round(control.left - name.left)).toBe(188 + 24);
  expect(
    Math.abs(name.top + name.height / 2 - (control.top + control.height / 2)),
  ).toBeLessThanOrEqual(1);
  // Every value's control stands in that one column, in the rows of the lists too.
  const lefts = await page.evaluate(() =>
    [
      'profile-roles',
      'profile-contracts',
      'profile-wish-rate',
      'profile-work-mode',
      'profile-years',
      'competence-years',
      'language-level',
      'profile-exclusion-words',
    ].map((id) => {
      const inner = document.querySelector(`[data-testid="${id}"]`)!;
      const edge = inner.matches('input') ? inner.closest('.field')! : inner;
      return Math.round(edge.getBoundingClientRect().left);
    }),
  );
  expect(new Set(lefts).size, lefts.join(' ')).toBe(1);
  // The placeholders and the add buttons say what to do.
  await expect(roles(page).locator('input')).toHaveAttribute('placeholder', words.rolesPlaceholder);
  await expect(countryInput(page)).toHaveAttribute('placeholder', words.countriesPlaceholder);
  await expect(page.getByTestId('competences-add')).toHaveText(words.competenceAdd);
  await expect(page.getByTestId('languages-add')).toHaveText(words.languageAdd);
  await expect(await adder(page, 'competence')).toHaveAttribute('placeholder', words.competence);
  await expect(await adder(page, 'language')).toHaveAttribute('placeholder', words.language);
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

test('a row is 62 high, its control 16 under the line, its hairline from the text; a message only grows it downward', async ({
  page,
}) => {
  await profile(page);
  await animationsDone(page);
  /** How high a row is and how far under its line the control stands (a field's box, not its
   *  input). */
  const measure = (row: Locator, control: string) =>
    row.evaluate((node, id) => {
      const inner = node.querySelector(`[data-testid="${id}"]`)!;
      const edge = inner.matches('input') ? inner.closest('.field')! : inner;
      const box = node.getBoundingClientRect();
      return { height: box.height, under: edge.getBoundingClientRect().top - box.top };
    }, control);
  const rows: [Locator, string][] = [
    [field(page, 'dayRateWish'), 'profile-wish-rate'],
    [field(page, 'workMode'), 'profile-work-mode'],
    [field(page, 'available'), 'profile-date'],
    [page.getByTestId('competences-item').first(), 'competence-years'],
    [page.getByTestId('languages-item').first(), 'language-level'],
    [page.getByTestId('languages-add'), 'languages-add-button'],
  ];
  for (const [row, control] of rows) {
    expect(await measure(row, control), control).toEqual({ height: 62, under: 16 });
  }
  // The hairline between rows starts where the row's words do.
  for (const [row, name] of [
    [field(page, 'dayRateMin'), '.label'],
    [page.getByTestId('languages-item').nth(1), '.name'],
  ] as const) {
    const { line, text } = await row.evaluate((node, css) => {
      const box = node.getBoundingClientRect();
      return {
        line: Number.parseFloat(getComputedStyle(node, '::before').left),
        text: node.querySelector(css)!.getBoundingClientRect().left - box.left,
      };
    }, name);
    expect(line, name).toBe(text);
  }
  // A message stands under the control: nothing above it moves, only the row grows.
  const row = field(page, 'dayRateWish');
  const wish = page.getByTestId('profile-wish-rate');
  const [rowBefore, wishBefore] = [await row.boundingBox(), await wish.boundingBox()];
  await wish.fill('0');
  await expect(row).toContainText(T.profile.field.atLeast(1));
  const rowAfter = await row.boundingBox();
  expect(rowAfter!.y).toBe(rowBefore!.y);
  expect(rowAfter!.height).toBeGreaterThan(rowBefore!.height);
  expect((await wish.boundingBox())!.y).toBe(wishBefore!.y);
});

test('the × of a list hangs past the edge of the fields above it by its margin, as every quiet tool', async ({
  page,
}) => {
  await profile(page);
  const edge = (await page.getByTestId('profile-certificates').boundingBox())!;
  /** Where the box ends without what it hangs out: the glyph's end for the eye. */
  const end = (button: Locator): Promise<number> =>
    button.evaluate(
      (node) =>
        node.getBoundingClientRect().right + Number.parseFloat(getComputedStyle(node).marginRight),
    );
  for (const list of ['competences', 'languages'] as const) {
    expect(await end(page.getByTestId(`${list}-remove`).first()), list).toBe(edge.x + edge.width);
    // The × of the row that adds, on the same line.
    await page.getByTestId(`${list}-add-button`).click();
    expect(await end(page.getByTestId(`${list}-draft-close`)), list).toBe(edge.x + edge.width);
  }
});

/** The middle of the first line of a text. */
const firstLineMiddle = (text: Locator): Promise<number> =>
  text.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const line = range.getClientRects()[0]!;
    return line.top + line.height / 2;
  });

test('a name of a list stands on the line of its field, a wrapped one too, which grows downward', async ({
  page,
}) => {
  await profile(page);
  await animationsDone(page);
  const rows = page.getByTestId('competences-item');
  const wrapped = rows.filter({ hasText: 'Konzernrechnungslegung nach IFRS' });
  for (const row of [rows.first(), wrapped]) {
    const field = await row.getByTestId('competence-years').boundingBox();
    const middle = field!.y + field!.height / 2;
    expect(Math.abs((await firstLineMiddle(row.locator('.name'))) - middle)).toBeLessThanOrEqual(1);
    // The × on the same line.
    const remove = await row.getByTestId('competences-remove').boundingBox();
    expect(remove!.y + remove!.height / 2).toBe(middle);
  }
  // Two lines, while a name of one keeps the row of every field.
  const line = await wrapped.locator('.name').evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].length;
  });
  expect(line).toBe(2);
  expect((await rows.first().boundingBox())!.height).toBe(62);
  expect((await wrapped.boundingBox())!.height).toBeGreaterThan(62);
});

test('in a narrow box the rows of a list keep the measure of every row', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await animationsDone(page);
  const row = async (node: Locator, words: string, control: string) =>
    node.evaluate(
      (each, [text, inner]) => {
        const box = each.getBoundingClientRect();
        const name = each.querySelector(text!)!.getBoundingClientRect();
        const field = each.querySelector(`[data-testid="${inner}"]`)!;
        const edge = (field.closest('.field') ?? field).getBoundingClientRect();
        return {
          height: box.height,
          nameTop: name.top - box.top,
          nameHeight: name.height,
          gap: edge.top - name.bottom,
        };
      },
      [words, control],
    );
  const field_ = await row(field(page, 'years'), '.label', 'profile-years');
  expect(
    await row(page.getByTestId('competences-item').first(), '.name', 'competence-years'),
  ).toEqual(field_);
  expect(await row(page.getByTestId('languages-item').first(), '.name', 'language-level')).toEqual(
    field_,
  );
});

test('a tag field with one line of chips is as high as any field, its row like any row', async ({
  page,
}) => {
  await profile(page);
  for (const name of ['roles', 'regions', 'degrees'] as const) {
    const box = await page.getByTestId(`profile-${name}`).boundingBox();
    expect(box!.height, `${name}: one line of chips`).toBe(30);
    expect((await field(page, name).boundingBox())!.height, `${name}: its row`).toBe(62);
  }
});

test('a placeholder that does not fit beside the chips takes a line of its own, never cut', async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 700 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const cut = (): Promise<string[]> =>
    page
      .getByTestId('profile-form')
      .locator('.sizer')
      .evaluateAll((all) =>
        all
          .filter((sizer) => sizer.scrollWidth > sizer.clientWidth)
          .map((sizer) => sizer.getAttribute('data-placeholder') ?? ''),
      );
  expect(await cut()).toEqual([]);
  const industries = page.getByTestId('profile-industries');
  const chip = await chips(industries).first().boundingBox();
  const input = await industries.locator('input').boundingBox();
  expect(input!.y).toBeGreaterThan(chip!.y + chip!.height);
  // Where it fits, it stays beside them: one line, as high as any field.
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect.poll(cut).toEqual([]);
  await expect.poll(async () => (await industries.boundingBox())!.height).toBe(30);
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
  await expect(page.getByTestId('profile-min-salary')).toHaveAttribute(
    'placeholder',
    T.profile.field.minSalaryPlaceholder,
  );
  await expect(page.getByTestId('profile-work-mode')).toHaveText(T.profile.workMode.remote);
  await expect(chips(countries(page))).toHaveText([DE, AT]);
  await expect(chips(page.getByTestId('profile-regions'))).toHaveText(['Hamburg']);
  await expect(page.getByTestId('profile-date')).toHaveValue('01.09.2026');
  await expect(page.getByTestId('profile-workload')).toHaveText(T.profile.workload.any);
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
  await expect(names(page, 'languages')).toHaveText([LANGUAGE.de, LANGUAGE.en]);
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
  await leaveField(page);
  await savedWith(page, { permanent: false, temporary: true, minSalary: 90000 });
  // Once that save's rescore is done.
  await runFinished(page);
  // Without both the salary is not kept; the last chosen type stays and says why.
  await contract(page, 'temporary').click();
  await contract(page, 'project').click();
  await expect(contract(page, 'project')).toHaveAttribute('aria-checked', 'true');
  expect(await tooltipOf(page, contract(page, 'project'))).toBe(T.profile.field.keepOneContract);
  await savedWith(page, { project: true, temporary: false, minSalary: null });
});

test('the day rates fold without Projekt und Interim; a 0 out of sight holds no save', async ({
  page,
}) => {
  await profile(page);
  const wish = page.getByTestId('profile-wish-rate');
  const least = page.getByTestId('profile-min-rate');
  await contract(page, 'project').click();
  await expect(wish).toHaveCount(0);
  await expect(least).toHaveCount(0);
  await savedWith(page, { project: false });
  await allSaved(page);
  await contract(page, 'project').click();
  await expect(wish).toHaveValue('1.200');
  await expect(least).toHaveValue('1.100');
  await savedWith(page, { project: true });
  await allSaved(page);
  // In sight a 0 holds the save, said at its field; out of sight it holds nothing.
  const before = await saves(page);
  await wish.fill('0');
  await leaveField(page);
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.atLeast(1));
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(before);
  await contract(page, 'project').click();
  await expect(wish).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.project).toBe(false);
  await expect(page.getByTestId('profile-from-cv')).not.toHaveAttribute('aria-disabled', 'true');
});

test('a day rate too large out of sight holds no save either', async ({ page }) => {
  await profile(page);
  const wish = page.getByTestId('profile-wish-rate');
  await wish.fill('200000');
  await leaveField(page);
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.atMost(100000));
  await contract(page, 'project').click();
  await expect(wish).toHaveCount(0);
  // Nothing on the page can be wrong now: it saves, and goes on saving.
  await expect.poll(async () => (await stored(page))?.project).toBe(false);
  await expect(page.getByTestId('profile-save-error')).toHaveCount(0);
  await contract(page, 'temporary').click();
  await expect.poll(async () => (await stored(page))?.temporary).toBe(true);
  // It never went: what is stored comes back with the row, nothing to say.
  const sent = await calls(page, 'save_profile');
  expect(sent.map(([, args]) => (args as { save: ProfileSave }).save.after.dayRateWish)).toEqual(
    sent.map(() => 1200),
  );
  await contract(page, 'project').click();
  await expect(wish).toHaveValue('1.200');
  await expect(field(page, 'dayRateWish')).not.toContainText(T.profile.field.atMost(100000));
  await contract(page, 'project').click();
  await expect(wish).toHaveCount(0);
  // And nothing out of sight asks on the way out.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
});

test('a salary too large out of sight holds no save either, and is not kept like core', async ({
  page,
}) => {
  await profile(page);
  const salary = page.getByTestId('profile-min-salary');
  await salary.fill('20000000');
  await leaveField(page);
  await expect(field(page, 'minSalary')).toContainText(T.profile.field.atMost(10000000));
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(0);
  // Without Festanstellung and Zeitarbeit it is out of sight: the form saves, without a salary.
  await contract(page, 'permanent').click();
  await expect(salary).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.permanent).toBe(false);
  expect((await stored(page))?.minSalary).toBeNull();
  await expect(page.getByTestId('profile-save-error')).toHaveCount(0);
  await allSaved(page);
  // Back with its contract type: empty, nothing to say.
  await contract(page, 'permanent').click();
  await expect(salary).toHaveValue('');
  await expect(field(page, 'minSalary')).not.toContainText(T.profile.field.atMost(10000000));
});

test('the rates; a wish under the minimum says so quietly under the wish', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-wish-rate').fill('900');
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.belowMinRate);
  await expect(field(page, 'dayRateMin').getByTestId('info-tip')).toHaveCount(1);
  await page.getByTestId('profile-wish-rate').fill('1.300');
  await expect(field(page, 'dayRateWish')).not.toContainText(T.profile.field.belowMinRate);
});

test('Arbeitsmodell, Verfügbar, Auslastung and Mindestlaufzeit are selects; the chosen option carries the tick', async ({
  page,
}) => {
  await profile(page);
  for (const id of [
    'profile-work-mode',
    'profile-available',
    'profile-workload',
    'profile-min-months',
  ]) {
    await expect(page.getByTestId(id)).toHaveRole('combobox');
  }
  const listed = page.getByRole('listbox').getByRole('option');
  await page.getByTestId('profile-work-mode').click();
  await expect(listed).toHaveText(Object.values(T.profile.workMode));
  // The one tick stands on the chosen option.
  const chosen = page.getByRole('listbox').getByRole('option', { selected: true });
  await expect(chosen).toHaveText(T.profile.workMode.remote);
  await expect(chosen.locator('.tick')).toHaveCount(1);
  await expect(page.getByRole('listbox').locator('.tick')).toHaveCount(1);
  await listed.filter({ hasText: T.profile.workMode.hybrid }).click();
  await choose(page, 'profile-available', T.profile.availability.now);
  await page.getByTestId('profile-workload').click();
  await expect(listed).toHaveText(Object.values(T.profile.workload));
  await listed.filter({ hasText: T.profile.workload.fulltime }).click();
  await page.getByTestId('profile-min-months').click();
  await expect(listed).toHaveText(Object.values(T.profile.minMonths));
  await listed.filter({ hasText: T.profile.minMonths[12] }).click();
  await expect(page.getByTestId('profile-min-months')).toHaveText(T.profile.minMonths[12]);
  await savedWith(page, {
    workMode: 'hybrid',
    available: { kind: 'now' },
    workload: 'fulltime',
    minMonths: 12,
  });
});
test('Länder: the focus opens no list, typing narrows, a new profile starts with Deutschland', async ({
  page,
}) => {
  await profile(page);
  await countryInput(page).focus();
  // Like every tag field the focus opens no list and there are no suggestions (owner,
  // 2026-10-28); typing lists the countries not chosen yet.
  const listed = options(page).getByRole('option');
  await expect(listed).toHaveCount(0);
  // By either name, Enter takes the first match.
  await countryInput(page).fill(BE.slice(0, 4));
  await expect(listed).toHaveText([BE]);
  await countryInput(page).fill(T.profile.countryEnglish.ES ?? '');
  await expect(listed).toHaveText([country('ES')]);
  await countryInput(page).fill(CH);
  await countryInput(page).press('Enter');
  await expect(chips(countries(page))).toHaveText([DE, AT, CH]);
  await expect(listed).toHaveCount(0);
  await countryInput(page).fill('Atlantis');
  await expect(page.getByTestId('profile-countries-none')).toHaveText(T.profile.field.countryNone);
  await countryInput(page).fill('');
  await leaveField(page);
  await savedWith(page, { countries: ['DE', 'AT', 'CH'] });
  // A new profile starts with Deutschland.
  await create(page);
  await expect(chips(countries(page))).toHaveText([DE]);
});

test('Regionen suggest the regions of Germany, Austria and Switzerland; typed text stays', async ({
  page,
}) => {
  await profile(page);
  const input = page.getByTestId('profile-regions').locator('input');
  const region = T.profile.regionNames.find((name) => name.startsWith('Ober'))!;
  await input.fill('Ober');
  const hints = page.getByTestId('profile-regions-suggestions').getByRole('option');
  await expect(hints).toContainText([region]);
  await hints.filter({ hasText: region }).click();
  await input.fill('Rheinhessen');
  await input.press('Enter');
  await expect(chips(page.getByTestId('profile-regions'))).toHaveText([
    'Hamburg',
    region,
    'Rheinhessen',
  ]);
});

test('Branchen: plain names, no star; only the × removes', async ({ page }) => {
  await profile(page);
  const industries = page.getByTestId('profile-industries');
  const input = industries.locator('input');
  const remove = (name: string): Locator =>
    industries.getByRole('button', { name: T.chips.remove(name) });
  // A chip is its name and its ×, nothing beside them.
  const chip = industries.locator('.chip').first();
  await expect(chip.getByRole('button')).toHaveCount(1);
  await expect(chip).toHaveText('Maschinenbau');
  // Its words are no button: a press on them removes nothing.
  await chip.locator('.text').click();
  await expect(chips(industries)).toHaveCount(3);
  // Typed and Enter, the caret stays in the field; a press on a × removes that chip and the
  // caret goes: it saves.
  await input.fill('Energie');
  await input.press('Enter');
  await expect(input).toBeFocused();
  await remove('Automotive').click();
  await expect(chips(industries)).toHaveText(['Maschinenbau', 'Chemie', 'Energie']);
  await expect(caret(page)).toHaveCount(0);
  await savedWith(page, { industries: ['Maschinenbau', 'Chemie', 'Energie'] });
});

test('a press on a × with the caret in its field at the foot of the view removes the chip', async ({
  page,
}) => {
  await profile(page);
  const industries = page.getByTestId('profile-industries');
  const input = industries.locator('input');
  await input.fill('Energie');
  await input.press('Enter');
  await expect(chips(industries)).toHaveCount(4);
  // Where a window ends: the field's last line, with the caret, just above the view's foot.
  await input.evaluate((node) => {
    const view = document.querySelector<HTMLElement>('[data-testid="view-profile"]')!;
    const foot = view.getBoundingClientRect().bottom;
    view.scrollTop += node.getBoundingClientRect().bottom - foot + 20;
  });
  // A press as the pointer does it: where the × stands, nothing moves under it.
  const view = page.getByTestId('view-profile');
  const scrolled = await view.evaluate((node) => node.scrollTop);
  const x = await industries
    .getByRole('button', { name: T.chips.remove('Automotive') })
    .boundingBox();
  await page.mouse.click(x!.x + x!.width / 2, x!.y + x!.height / 2);
  await expect(chips(industries)).toHaveText(['Maschinenbau', 'Chemie', 'Energie']);
  expect(await view.evaluate((node) => node.scrollTop)).toBe(scrolled);
});

test('Sprachen: rows, the level a select of A1 to C2, the button brings a closed list', async ({
  page,
}) => {
  await profile(page);
  const level = (index: number) => page.getByTestId('language-level').nth(index);
  // The field opens no list on focus; typing lists the languages not chosen yet.
  const input = await adder(page, 'language');
  const listed = page.getByTestId('language-add-options').getByRole('option');
  await expect(listed).toHaveCount(0);
  await input.fill(LANGUAGE.fr.slice(0, 5));
  await expect(listed).toHaveText([LANGUAGE.fr]);
  // Enter takes the first, which starts at B2, and the field stays ready.
  await page.keyboard.press('Enter');
  await expect(names(page, 'languages')).toHaveText([LANGUAGE.de, LANGUAGE.en, LANGUAGE.fr]);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(level(2)).toHaveText(T.profile.level.B2);
  // Esc on the empty field: its button is back.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('languages-add-button')).toBeVisible();
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
  await (await adder(page, 'language')).fill(LANGUAGE.sv.slice(0, 6));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  // The x of a row removes it ("Entfernen").
  await page.getByTestId('languages-remove').first().click();
  await savedWith(page, {
    languages: [
      { language: LANGUAGE.en, level: 'B2' },
      { language: LANGUAGE.fr, level: 'A2' },
      { language: LANGUAGE.sv, level: 'B2' },
    ],
  });
});

test('the keys in a name field: Tab goes on to its ×, Esc gives the focus to the button', async ({
  page,
}) => {
  await open(page, '?view=profile');
  await page.getByTestId('competences-add-button').click();
  const field = page.locator('[data-testid="competence-add"] input');
  await field.click();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('competences-draft-close')).toBeFocused();
  // Leaving the row with nothing typed turns it back into the button.
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('competences-add-button')).toBeVisible();
  await page.getByTestId('competences-add-button').click();
  await field.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('competences-add-button')).toBeFocused();
});

test('the × of a name field takes back what was typed: no new row', async ({ page }) => {
  await profile(page);
  const close = async (list: 'competence' | 'language', typed: string): Promise<void> => {
    const input = await adder(page, list);
    await input.fill(typed);
    await page.getByTestId(`${list}s-draft-close`).click();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId(`${list}s-add-button`)).toBeVisible();
    await expect(caret(page)).toHaveCount(0);
  };
  await close('competence', 'Konzernabschluss');
  await expect(names(page, 'competences')).toHaveCount(6);
  await expect(names(page, 'competences')).not.toContainText(['Konzernabschluss']);
  await close('language', LANGUAGE.fr);
  await expect(names(page, 'languages')).toHaveText([LANGUAGE.de, LANGUAGE.en]);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(0);
});

test('Esc in a name field drops what was typed, the next one brings the button back', async ({
  page,
}) => {
  await profile(page);
  const input = await adder(page, 'competence');
  await input.fill('Konzernabschluss');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId('competences-add-button')).toBeVisible();
  await expect(names(page, 'competences')).toHaveCount(6);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(0);
});

test('a long tag field folds to two lines without the focus; the focus or its button shows all', async ({
  page,
}) => {
  await profile(page);
  const tools = page.getByTestId('profile-tools');
  const input = tools.locator('input');
  const more = page.getByTestId('profile-tools-more');
  const added = Array.from({ length: 24 }, (_, index) => `Werkzeug ${index}`);
  const all = (await chips(tools).count()) + added.length;
  // A typed list becomes chips; while the caret stands in the field all of them show.
  await input.fill(added.join(', '));
  await input.press('Enter');
  await expect(chips(tools)).toHaveCount(all);
  await expect(more).toHaveCount(0);
  await leaveField(page);
  await expect(more).toBeVisible();
  const shown = await chips(tools).count();
  expect(shown).toBeLessThan(all);
  await expect(more).toHaveText(T.profile.field.moreChips(all - shown));
  await expect.poll(async () => (await stored(page))?.tools).toEqual(expect.arrayContaining(added));
  // The focus unfolds it, leaving folds it again.
  await input.focus();
  await expect(chips(tools)).toHaveCount(all);
  await leaveField(page);
  await expect(more).toBeVisible();
  // Its button unfolds it for good.
  await more.click();
  await expect(chips(tools)).toHaveCount(all);
  await expect(more).toHaveCount(0);
});

test('a competence whose years are too large says so under its row and holds the save', async ({
  page,
}) => {
  await profile(page);
  const years = page.getByTestId('competence-years');
  const rows = page.getByTestId('competences-item');
  const error = page.getByTestId('competences-error');
  await years.nth(2).fill(String(MAX_YEARS + 1));
  await expect(error).toHaveCount(1);
  await expect(rows.nth(2).getByTestId('competences-error')).toHaveText(
    T.profile.field.atMost(MAX_YEARS),
  );
  await expect(years.nth(2)).toHaveAttribute('aria-invalid', 'true');
  await expect(years.nth(1)).not.toHaveAttribute('aria-invalid', 'true');
  await leaveField(page);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(0);
  await years.nth(2).fill('7');
  await expect(error).toHaveCount(0);
  await leaveField(page);
  expect((await lastSave(page)).after.competences[2]?.years).toBe(7);
});

test('a competence the backend refuses is said under its row, until it changes', async ({
  page,
}) => {
  await profile(page);
  await refuseNext(page, { field: 'competences', row: 1, max: null });
  await page.getByTestId('competence-years').nth(1).fill('9');
  await leaveField(page);
  const items = page.getByTestId('competences-item');
  await expect(items.nth(1).getByTestId('competences-error')).toHaveText(T.profile.field.refused);
  await expect(page.getByTestId('competence-years').nth(1)).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('competences-remove').nth(1).click();
  await expect(page.getByTestId('competences-error')).toHaveCount(0);
  await expect.poll(async () => (await stored(page))?.competences.length).toBe(5);
});

test('a language the backend refuses is said under its row', async ({ page }) => {
  await profile(page);
  await refuseNext(page, { field: 'languages', row: 1, max: null });
  await page.getByTestId('language-level').nth(1).click();
  await page.getByRole('listbox').getByRole('option', { name: T.profile.level.C1 }).click();
  const items = page.getByTestId('languages-item');
  const levels = page.getByTestId('language-level');
  await expect(items.nth(1).getByTestId('languages-error')).toHaveText(T.profile.field.refused);
  await expect(levels.nth(1)).toHaveAttribute('aria-invalid', 'true');
  await expect(levels.first()).not.toHaveAttribute('aria-invalid', 'true');
  // Changed, the error goes and it saves.
  await levels.nth(1).click();
  await page.getByRole('listbox').getByRole('option', { name: T.profile.level.C2 }).click();
  await expect(page.getByTestId('languages-error')).toHaveCount(0);
  await expect(levels.nth(1)).not.toHaveAttribute('aria-invalid', 'true');
  await expect.poll(async () => (await stored(page))?.languages[1]?.level).toBe('C2');
});

test('a refusal of a whole list is said under its last row', async ({ page }) => {
  await profile(page);
  await refuseNext(page, { field: 'languages', row: null, max: null });
  await page.getByTestId('language-level').first().click();
  await page.getByRole('listbox').getByRole('option', { name: T.profile.level.C1 }).click();
  const error = page.getByTestId('languages-error');
  await expect(error).toHaveText(T.profile.field.refused);
  const [add, under] = [
    await page.getByTestId('languages-add').boundingBox(),
    await error.boundingBox(),
  ];
  expect(under!.y).toBeGreaterThanOrEqual(add!.y + add!.height);
  await expect(page.getByTestId('languages-item').getByTestId('languages-error')).toHaveCount(0);
});

// ------------------------------------------------------------------ what is still open

test('what is missing: the card names it and the rows stay calm; a gap never holds a save', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-incomplete');
  const card = missingCard(page);
  const words = T.profile.field;
  await expect(card).toContainText(T.profile.missing.heading(2));
  await expect(card).toContainText(T.profile.missing.fields([words.roles, words.languages]));
  await expect(page.getByTestId('profile-missing-go')).toHaveText(T.profile.missing.action);
  // Only the setup marks rows: here none, its label as calm as any.
  expect(await marked(page)).toEqual([]);
  const open = await label(field(page, 'roles')).evaluate((node) => getComputedStyle(node).color);
  const ink = await label(field(page, 'tools')).evaluate((node) => getComputedStyle(node).color);
  expect(open).toBe(ink);
  // A gap never holds the save, and the rows stay calm after it.
  await contract(page, 'temporary').click();
  await lastSave(page);
  expect(await marked(page)).toEqual([]);
  await expect(card).toContainText(T.profile.missing.heading(2));
  // Its button brings the first up under the top bar, no caret in it and no mark on it.
  const input = roles(page).locator('input');
  const barEnd = async (): Promise<number> => {
    const bar = await page.getByTestId('title-bar').boundingBox();
    return bar!.y + bar!.height;
  };
  const above = (await field(page, 'roles').boundingBox())!.y;
  await page.getByTestId('profile-missing-go').click();
  await expect.poll(async () => (await field(page, 'roles').boundingBox())!.y).toBeLessThan(above);
  await expect(input).toBeInViewport();
  await expect(page.getByTestId('profile-heading')).not.toBeInViewport();
  expect((await field(page, 'roles').boundingBox())!.y).toBeGreaterThanOrEqual(await barEnd());
  await expect(input).not.toBeFocused();
  await expect(caret(page)).toHaveCount(0);
  expect(await marked(page)).toEqual([]);
  // Filled, the card drops it at once.
  await input.fill('Interim CFO');
  await input.press('Enter');
  await expect(card).toContainText(T.profile.missing.heading(1));
  await expect(card).toContainText(T.profile.missing.fields([words.languages]));
  await expect(card).not.toContainText(words.roles);
  // The next press brings up what is left.
  await page.getByTestId('profile-missing-go').click();
  await expect(page.getByTestId('section-languages')).toBeInViewport();
  await expect(caret(page)).toHaveCount(0);
  await (await adder(page, 'language')).fill(LANGUAGE.de);
  await page.keyboard.press('Enter');
  await expect(card).toHaveCount(0);
  expect(await marked(page)).toEqual([]);
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
  await expect(names(page, 'languages')).toHaveText([LANGUAGE.de, LANGUAGE.en]);
  // Nothing required is open any more.
  await expect(missingCard(page)).toHaveCount(0);
});
test('"Aus Lebenslauf ausfüllen" waits while a value is wrong', async ({ page }) => {
  await profile(page);
  const cv = page.getByTestId('profile-from-cv');
  const rate = page.getByTestId('profile-wish-rate');
  await rate.fill('0');
  await expect(cv).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, cv)).toBe(T.profile.fixFirst(T.profile.field.dayRateWish));
  await rate.fill('1.250');
  await expect(cv).not.toHaveAttribute('aria-disabled', 'true');
});

test('no evaluation left today: the CV buttons say so ahead of the click, a drop is not taken', async ({
  page,
}) => {
  await profile(page, '&cv=used');
  const cv = page.getByTestId('profile-from-cv');
  await expect(cv).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, cv)).toBe(T.profile.cvError.limit);
  await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
  await expect(page.getByTestId('profile')).not.toHaveClass(/\bover\b/);
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
  const view = page.getByTestId('profile');
  // A file over the page: its dashed edge, gone with the drop.
  await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
  await expect(view).toHaveClass(/\bover\b/);
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expect(view).not.toHaveClass(/\bover\b/);
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.filled })).toBeVisible();
  expect((await calls(page, 'profile_from_cv')).at(-1)?.[1]).toEqual({ dropped: true });
  // While a value is wrong the drop waits like the button, and says why.
  await page.getByTestId('profile-wish-rate').fill('0');
  await page.evaluate(() => window.__harness.fire('tauri://drag-enter', { paths: [] }));
  await expect(view).not.toHaveClass(/\bover\b/);
  await page.evaluate(() =>
    window.__harness.fire('tauri://drag-drop', { paths: ['C:/Users/demo/Lebenslauf.pdf'] }),
  );
  await expect(page.getByTestId('profile-save-error')).toHaveText(
    T.profile.fixFirst(T.profile.field.dayRateWish),
  );
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
});
test('Selbst ausfüllen: the empty form calm and without a caret, Esc back while untouched; a change stores it', async ({
  page,
}) => {
  await create(page);
  await expect(caret(page)).toHaveCount(0);
  // Core is asked what the new form still lacks; on the Profil page no row says it.
  await expect.poll(async () => (await calls(page, 'profile_missing')).length).toBeGreaterThan(0);
  expect(await marked(page)).toEqual([]);
  await expect(names(page, 'competences')).toHaveCount(0);
  await expect(names(page, 'languages')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await chooseWay(page, 'empty');
  await fillRequired(page);
  await leaveField(page);
  await savedWith(page, {
    roles: ['Interim CFO'],
    project: true,
    permanent: false,
    temporary: false,
    countries: ['DE'],
    competences: [{ name: 'Controlling', years: null }],
    languages: [{ language: LANGUAGE.de, level: 'B2' }],
  });
  // Stored now: Esc stays, and nothing is missing.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await expect(missingCard(page)).toHaveCount(0);
});

test('a first change stores the new form: from then on the card says what it still lacks', async ({
  page,
}) => {
  await create(page);
  const words = T.profile.field;
  await roles(page).locator('input').fill('Interim CFO');
  await roles(page).locator('input').press('Enter');
  await leaveField(page);
  await savedWith(page, { roles: ['Interim CFO'] });
  await expect(missingCard(page)).toContainText(T.profile.missing.heading(2));
  await expect(missingCard(page)).toContainText(
    T.profile.missing.fields([words.competences, words.languages]),
  );
  expect(await marked(page)).toEqual([]);
});

test('a profile edited into broken JSON says so and where, with its folder', async ({ page }) => {
  await profile(page, '&scenario=profile-broken');
  const empty = page.getByTestId('profile-empty');
  await expect(page.getByTestId('profile-heading')).toHaveText(T.profile.unreadable);
  await expect(empty).toContainText(
    `${T.error.text('invalid', { reason: 'profileNotJson', line: 12, column: 3 })} ${T.profile.replaces}`,
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

test('a change saves by itself: a control a moment after it changed, a text field when it is left', async ({
  page,
}) => {
  await profile(page);
  expect(await saves(page)).toBe(0);
  // A control: nothing to press.
  await contract(page, 'temporary').click();
  expect((await lastSave(page)).after.temporary).toBe(true);
  await choose(page, 'profile-work-mode', T.profile.workMode.hybrid);
  expect((await lastSave(page)).after.workMode).toBe('hybrid');
  // A text field: not while it is typed in, once it is left.
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('1.250');
  const before = await saves(page);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(before);
  await leaveField(page);
  const sent = await lastSave(page);
  expect(sent.before.dayRateMin).toBe(1100);
  expect(sent.after.dayRateMin).toBe(1250);
  // A tag field, and the day, written as the backend keeps it.
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Bilanzierung');
  await tools.press('Enter');
  await leaveField(page);
  expect((await lastSave(page)).after.tools.at(-1)).toBe('Bilanzierung');
  const date = page.getByTestId('profile-date');
  await date.fill('1.11.2026');
  await leaveField(page);
  expect((await lastSave(page)).after.available).toEqual({ kind: 'from', date: '01.11.2026' });
  await expect(date).toHaveValue('01.11.2026');
  // Nothing asks and nothing is said.
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('what changes while a save is under way stays and goes next', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('1.250');
  await leaveField(page);
  await lastSave(page);
  // At once, while the state is loaded again after that save.
  const years = page.getByTestId('profile-years');
  await years.fill('21');
  await leaveField(page);
  await savedWith(page, { dayRateMin: 1250, years: 21 });
  await expect(rate).toHaveValue('1.250');
  await expect(years).toHaveValue('21');
});

test('a change taken back while its save is under way stays and goes next', async ({ page }) => {
  // Every answer takes a moment here, so the second press comes while the first still saves.
  await profile(page, '&scenario=slow');
  const available = (): Promise<unknown> => stored(page).then((form) => form?.available);
  const date = page.getByTestId('profile-date');
  await choose(page, 'profile-available', T.profile.availability.now);
  await expect(date).toHaveCount(0);
  await lastSave(page);
  await choose(page, 'profile-available', T.profile.availability.from);
  await expect(date).toHaveValue('01.09.2026');
  // That save arrives; what was chosen meanwhile stays in the form and goes next.
  await expect.poll(available).toEqual({ kind: 'now' });
  await expect.poll(available).toEqual({ kind: 'from', date: '01.09.2026' });
  await expect(page.getByTestId('profile-available')).toHaveText(T.profile.availability.from);
  await expect(date).toHaveValue('01.09.2026');
});

test('a change taken back while its save is under way goes along on the way out', async ({
  page,
}) => {
  await profile(page, '&scenario=slow');
  const available = (): Promise<unknown> => stored(page).then((form) => form?.available);
  await choose(page, 'profile-available', T.profile.availability.now);
  await lastSave(page);
  await choose(page, 'profile-available', T.profile.availability.from);
  // Nothing differs from what was handed out, yet the way waits for that save and saves after it.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect.poll(() => saves(page)).toBe(2);
  await expect.poll(available).toEqual({ kind: 'from', date: '01.09.2026' });
  await expect(page.getByTestId('dialog-leave-profile')).toHaveCount(0);
});

test('a change taken back while its save is under way goes along when the window closes', async ({
  page,
}) => {
  await profile(page, '&scenario=slow');
  const available = (): Promise<unknown> => stored(page).then((form) => form?.available);
  await choose(page, 'profile-available', T.profile.availability.now);
  await lastSave(page);
  await choose(page, 'profile-available', T.profile.availability.from);
  // The window asks the page only once the page has told it that it holds a change.
  await expect.poll(() => page.evaluate(() => window.__harness.unsaved)).toBe(true);
  await page.evaluate(() => window.__harness.requestClose());
  await expect.poll(() => page.evaluate(() => window.__harness.closed)).toBe(true);
  // It closed only after both saves, and till then the page never said it held nothing.
  expect(await saves(page)).toBe(2);
  await expect.poll(available).toEqual({ kind: 'from', date: '01.09.2026' });
  const all = await calls(page);
  const names = all.map(([name]) => name);
  const between = all.slice(names.indexOf('save_profile'), names.lastIndexOf('save_profile'));
  expect(between).not.toContainEqual(['set_unsaved', { on: false }]);
});

test('what changes while the way out saves goes along', async ({ page }) => {
  await profile(page, '&scenario=slow');
  await contract(page, 'temporary').click();
  await page.getByTestId('nav-settings').click();
  await lastSave(page);
  // That save is under way and the page still stands.
  await contract(page, 'permanent').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  const form = await stored(page);
  expect([form?.temporary, form?.permanent]).toEqual([true, false]);
});

test('a save that fails says so under the head and goes again with the next change; leaving with it asks', async ({
  page,
}) => {
  await profile(page);
  const note = page.getByTestId('profile-save-error');
  await failNext(page, 'save_profile');
  await contract(page, 'temporary').click();
  await expect(note).toHaveText(T.error.text('db', {}));
  await expect(contract(page, 'temporary')).toHaveAttribute('aria-checked', 'true');
  expect((await stored(page))?.temporary).toBe(false);
  // Not by itself: with the next change, which goes along with it.
  await contract(page, 'permanent').click();
  await expect.poll(async () => (await stored(page))?.permanent).toBe(false);
  expect((await stored(page))?.temporary).toBe(true);
  await expect(note).toHaveCount(0);
  await allSaved(page);
  // Leaving with a save that fails asks, and Verwerfen goes back to what is stored.
  await failNext(page, 'save_profile');
  const years = page.getByTestId('profile-years');
  await years.fill('33');
  await page.getByTestId('nav-settings').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(T.profile.leaveHeading);
  await expect(dialog).toContainText(T.profile.leaveFailed);
  await dialog.getByRole('button', { name: T.profile.discard }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await expect(years).toHaveValue('20');
});

test('no field takes the caret by itself', async ({ page }) => {
  await profile(page);
  await expect(caret(page)).toHaveCount(0);
  await choose(page, 'profile-available', T.profile.availability.now);
  await lastSave(page);
  await allSaved(page);
  await choose(page, 'profile-available', T.profile.availability.from);
  await expect(page.getByTestId('profile-date')).toBeVisible();
  await expect(caret(page)).toHaveCount(0);
  // Not after the plus, not after its row's × and not after the × of a row or a chip.
  for (const list of ['competence', 'language'] as const) {
    await page.getByTestId(`${list}s-add-button`).click();
    await expect(page.getByTestId(`${list}-add`).locator('input')).toBeVisible();
    await expect(caret(page)).toHaveCount(0);
    await page.getByTestId(`${list}s-draft-close`).click();
    await expect(page.getByTestId(`${list}s-add-button`)).toBeVisible();
    await expect(caret(page)).toHaveCount(0);
    await page.getByTestId(`${list}s-remove`).first().click();
    await expect(caret(page)).toHaveCount(0);
  }
  await page.getByTestId('profile-tools').locator('[data-remove]').first().click();
  await expect(caret(page)).toHaveCount(0);
  // Nor on the keyboard's way: the plus keeps its row, Tab goes on to the field.
  const add = page.getByTestId('languages-add-button');
  await add.focus();
  await page.keyboard.press('Enter');
  const input = page.getByTestId('language-add').locator('input');
  await expect(input).toBeVisible();
  await expect(caret(page)).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
});

test('a save says nothing unless its rescore moved jobs; a first profile says what moved', async ({
  page,
}) => {
  // The demo profile saved again moves no job: nothing is said.
  await profile(page);
  const rate = page.getByTestId('profile-wish-rate');
  await rate.fill('1.250');
  await leaveField(page);
  await lastSave(page);
  await runFinished(page);
  await page.waitForTimeout(2 * T_SAVE);
  await expect(savedToast(page)).toHaveCount(0);
  // A first profile scores the jobs of Aktuell: the toast says what moved, in the demo's numbers.
  await create(page);
  await roles(page).locator('input').fill('Interim CFO');
  await roles(page).locator('input').press('Enter');
  await leaveField(page);
  await lastSave(page);
  const { jobs } = await stubList(page);
  const high = jobs.filter(
    (job) => job.match?.status === 'scored' && bandOf(job.match.score) === 'high',
  ).length;
  const excluded = jobs.filter((job) => job.match?.status === 'excluded').length;
  expect(high + excluded).toBeGreaterThan(0);
  await expect(savedToast(page).getByTestId('toast-text')).toHaveText(
    T.profile.savedEffect(high, excluded),
  );
});

test('the toast of a save says only the parts its rescore moved', async ({ page }) => {
  await profile(page);
  // The rescores end as the test says: the stub's own stays at its start.
  await page.evaluate(() => (window.__harness.holdAfter = 0));
  const years = page.getByTestId('profile-years');
  const moved: [number, number][] = [
    [2, 0],
    [0, 1],
    [2, 1],
    [-1, 0],
    [0, -3],
    [1, -1],
  ];
  for (const [index, [high, excluded]] of moved.entries()) {
    await years.fill(String(30 + index));
    await leaveField(page);
    await lastSave(page);
    await page.evaluate(
      (delta) => {
        window.__harness.emit({ type: 'started', kind: 'rescore' });
        window.__harness.emit({
          type: 'finished',
          summary: {
            kind: 'rescore',
            outcome: { kind: 'completed' },
            mail: null,
            score: { delta },
          },
        } as never);
      },
      {
        highBefore: 10,
        highAfter: 10 + high,
        excludedBefore: 10,
        excludedAfter: 10 + excluded,
      },
    );
    await expect
      .poll(() => page.getByTestId('toast-text').allInnerTexts())
      .toContain(T.profile.savedEffect(high, excluded));
    await allSaved(page);
  }
});

test('a value too large is said at its field and holds the save', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('200000');
  // Drawn as every refused value is: the red sentence under the control.
  await expect(field(page, 'dayRateMin').getByRole('alert')).toHaveText(
    T.profile.field.atMost(100000),
  );
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await rate.press('Enter');
  await leaveField(page);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(0);
  // A 0 is no rate a job could meet.
  await rate.fill('0');
  await expect(field(page, 'dayRateMin')).toContainText(T.profile.field.atLeast(1));
  await rate.fill('1.300');
  await leaveField(page);
  await expect.poll(() => saves(page)).toBe(1);
});

test('a value the backend refuses is said at its field, no caret, not tried again by itself', async ({
  page,
}) => {
  await profile(page);
  const years = page.getByTestId('profile-years');
  await years.fill('25');
  await refuseNext(page, { field: 'years', row: null, max: 70 });
  await leaveField(page);
  await expect(field(page, 'years')).toContainText(T.profile.field.atMost(70));
  await expect(years).not.toBeFocused();
  const before = await saves(page);
  await page.waitForTimeout(2 * T_SAVE);
  expect(await saves(page)).toBe(before);
  // Changed, the error goes and it saves.
  await years.fill('24');
  await leaveField(page);
  await expect(field(page, 'years')).not.toContainText(T.profile.field.atMost(70));
  await savedWith(page, { years: 24 });
});

test('leaving saves first; a value that is wrong asks once, Abbrechen stays, Verwerfen leaves', async ({
  page,
}) => {
  await profile(page);
  const wish = page.getByTestId('profile-wish-rate');
  // A change in a field: saved on the way out, nothing asked.
  await wish.fill('1.300');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  expect((await lastSave(page)).after.dayRateWish).toBe(1300);
  await page.getByTestId('nav-profile').click();
  await expect(wish).toHaveValue('1.300');
  // A value that is wrong cannot be saved: it asks.
  await wish.fill('0');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toContainText(T.profile.leaveHeading);
  await expect(dialog).toContainText(T.profile.leaveWrong(T.profile.field.dayRateWish));
  await dialog.getByRole('button', { name: T.common.cancel }).click();
  await expect(page.getByTestId('view-profile')).toBeVisible();
  await expect(wish).toHaveValue('0');
  // Staying: said at its field, which is in view, and no caret goes there by itself.
  await expect(field(page, 'dayRateWish')).toContainText(T.profile.field.atLeast(1));
  await expect(wish).toBeInViewport();
  await expect(caret(page)).toHaveCount(0);
  await page.getByTestId('nav-settings').click();
  await dialog.getByRole('button', { name: T.profile.discard }).click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await page.getByTestId('nav-profile').click();
  await expect(wish).toHaveValue('1.300');
});

test('closing the window saves first; a value that is wrong asks; without any it closes at once', async ({
  page,
}) => {
  await profile(page);
  const closed = (): Promise<boolean> => page.evaluate(() => window.__harness.closed);
  const requestClose = (): Promise<void> => page.evaluate(() => window.__harness.requestClose());
  // The window asks the page only once the page has told it that it holds a change.
  const unsaved = (): Promise<boolean> => page.evaluate(() => window.__harness.unsaved);
  await expect.poll(unsaved).toBe(false);
  await requestClose();
  await expect.poll(closed).toBe(true);
  await page.evaluate(() => (window.__harness.closed = false));
  // A value that is wrong: it asks.
  const wish = page.getByTestId('profile-wish-rate');
  await wish.fill('0');
  await expect.poll(unsaved).toBe(true);
  await requestClose();
  const dialog = page.getByTestId('dialog-leave-profile');
  await dialog.getByRole('button', { name: T.common.cancel }).click();
  expect(await closed()).toBe(false);
  await requestClose();
  await dialog.getByRole('button', { name: T.profile.discard }).click();
  await expect.poll(closed).toBe(true);
  // A change in a field: saved, then closed.
  await profile(page);
  await wish.fill('1.300');
  await expect.poll(unsaved).toBe(true);
  await requestClose();
  await expect.poll(closed).toBe(true);
  expect((await lastSave(page)).after.dayRateWish).toBe(1300);
});

// ------------------------------------------------------------------ keys

test('Enter in a field saves at once; lists and chips keep their Enter', async ({ page }) => {
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
    await expect.poll(() => saves(page), id).toBeGreaterThan(before);
  }
  // The day: Enter judges it while it does not read.
  const date = page.getByTestId('profile-date');
  await date.fill('31.02.2026');
  await date.press('Enter');
  await expect(field(page, 'available')).toContainText(T.profile.field.dateImpossible);
  await date.fill('01.12.2026');
  await date.press('Enter');
  await savedWith(page, { available: { kind: 'from', date: '01.12.2026' } });
  // A tag field and a list's name field take what was typed.
  const tools = page.getByTestId('profile-tools').locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await expect(chips(page.getByTestId('profile-tools')).last()).toHaveText('Miro');
  const name = await adder(page, 'competence');
  await name.fill('Treasury');
  await name.press('Enter');
  await expect(names(page, 'competences').last()).toHaveText('Treasury');
});

test('Kompetenzen: rows; the button brings a name field that suggests, a name comes once, the x removes', async ({
  page,
}) => {
  await profile(page);
  const list = names(page, 'competences');
  await expect(list).toHaveCount(6);
  // The button, no field standing open; pressed, its row is the field, the x takes it back.
  const button = page.getByTestId('competences-add-button');
  const input = page.getByTestId('competence-add').locator('input');
  await expect(button).toHaveText(T.profile.field.competenceAdd);
  await expect(input).toHaveCount(0);
  await button.click();
  await expect(button).toHaveCount(0);
  await expect(input).toHaveAttribute('placeholder', T.profile.field.competence);
  await page.getByTestId('competences-draft-close').click();
  await expect(input).toHaveCount(0);
  await expect(button).toBeVisible();
  // Typed and Enter: a new row at the end with no years yet, the field empty again.
  await (await adder(page, 'competence')).fill('Konzernabschluss');
  await input.press('Enter');
  await expect(list).toHaveCount(7);
  await expect(list.last()).toHaveText('Konzernabschluss');
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('competence-years').last()).toHaveValue('');
  // A name that is there already (in any case) comes once.
  await input.fill('controlling');
  await input.press('Enter');
  await expect(list).toHaveCount(7);
  // The engine's words from the first character; a click takes one.
  await input.fill('T');
  const hints = page.getByTestId('competence-add-suggestions').getByRole('option');
  await expect(hints.first()).toBeVisible();
  const term = (await hints.first().textContent())!.trim();
  await hints.first().click();
  await expect(list.last()).toHaveText(term);
  // Left empty, the field turns back into the button.
  await leaveField(page);
  await expect(input).toHaveCount(0);
  await expect(button).toBeVisible();
  // The years of a row, and its x ("Entfernen").
  await page.getByTestId('competence-years').nth(6).fill('4');
  const remove = page.getByTestId('competences-remove').first();
  expect(await tooltipOf(page, remove)).toBe(T.common.remove);
  await remove.click();
  await expect(list.first()).toHaveText('Controlling');
  await expect
    .poll(async () => {
      const last = (await calls(page, 'save_profile')).at(-1);
      return (last?.[1] as { save: ProfileSave } | undefined)?.save.after.competences;
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Konzernabschluss', years: 4 }),
        expect.objectContaining({ name: term }),
      ]),
    );
  const sent = (await lastSave(page)).after.competences;
  expect(sent.map((row) => row.name)).not.toContain('Interim Management');
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
  await leaveField(page);
  await savedWith(page, { dayRateMin: 950 });
});

test('a note, a hint and an error stand equally far under a number field', async ({ page }) => {
  await profile(page);
  const wish = page.getByTestId('profile-wish-rate');
  const row = field(page, 'dayRateWish');
  /** How far a line stands under the field's own box. */
  const under = async (line: Locator): Promise<number> => {
    const edge = await wish.evaluate((input) => input.closest('.field')!.getBoundingClientRect());
    return (await line.boundingBox())!.y - edge.bottom;
  };
  await wish.fill('1.250,50');
  await leaveField(page);
  const note = await under(page.getByTestId('profile-wish-rate-rounded'));
  await wish.fill('900');
  await leaveField(page);
  await expect(row).toContainText(T.profile.field.belowMinRate);
  expect(await under(row.locator('.hint'))).toBe(note);
  await wish.fill('0');
  expect(await under(row.getByRole('alert'))).toBe(note);
});

test('one year reads as one, in a competence and in Berufserfahrung', async ({ page }) => {
  await profile(page);
  expect(T.profile.unitOf('years', 1)).not.toBe(T.profile.unitOf('years', 2));
  for (const input of [
    page.getByTestId('profile-years'),
    page.getByTestId('competence-years').first(),
  ]) {
    const unit = input.locator('xpath=..').locator('.suffix');
    await input.fill('1');
    await expect(unit).toHaveText(T.profile.unitOf('years', 1));
    await input.fill('12');
    await expect(unit).toHaveText(T.profile.unitOf('years', 12));
    await input.fill('');
    await expect(unit).toHaveText(T.profile.unit.years);
  }
});

test('the day exists only for "Ab Datum", takes no caret and is judged when left', async ({
  page,
}) => {
  await profile(page);
  const date = page.getByTestId('profile-date');
  const day = field(page, 'available');
  await choose(page, 'profile-available', T.profile.availability.now);
  await expect(date).toHaveCount(0);
  // "Sofort" saves by itself; "Ab Datum" comes once that is done (a choice taken back while
  // its save is under way has its own test).
  await savedWith(page, { available: { kind: 'now' } });
  await allSaved(page);
  await choose(page, 'profile-available', T.profile.availability.from);
  await expect(date).toBeVisible();
  await expect(date).not.toBeFocused();
  // Just chosen it says nothing yet.
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  await date.fill('1.11.202');
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  await page.getByTestId('profile-years').focus();
  await expect(day).toContainText(T.profile.field.dateInvalid);
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await date.fill('20.11.2026');
  await page.getByTestId('profile-years').focus();
  await expect(day).not.toContainText(T.profile.field.dateInvalid);
  // Typed only: no calendar beside it.
  await expect(date).toHaveAttribute('placeholder', T.profile.field.datePlaceholder);
  await leaveField(page);
  await savedWith(page, { available: { kind: 'from', date: '20.11.2026' } });
});

test('a number field shows no letter: after the digits, over a selection, in the middle', async ({
  page,
}) => {
  await profile(page);
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
