// The Profil view against the stub, in one spec: the head on the first row (a status when
// there is one, the actions), the form as the table of sections.ts lays it out (the sections
// in their order, each field with its words, sizes and controls), the three ways in, the save
// bar that shows only while something changed, saving (answered by a toast), discarding,
// leaving and closing with unsaved changes, drafts from a file or an AI's answer (an update
// fills gaps and adds, it never overwrites), values of the file that do not read, values that
// hold the save, refused values, quiet hints where values contradict each other, deleting and
// replacing with undo, and the setup's way on. The stub's demo
// profile works three to five days a week for at least six months, excludes "Werkstudent"
// and "Praktikum" and reads cleanly; the scenario profile-remote-unread has one value that
// does not read (the minimum remote share of permanent roles).

import type { Locator, Page } from '@playwright/test';
import type { ProfileSave } from '../../../ui/src/lib/ipc/types';
import { DEMO, demoScore } from './demo';
import { calls, expect, expectShot, open, runFinished, settle, test } from './fixtures';
import {
  chooseWay,
  failNext,
  MAC,
  row,
  showTab as show,
  T,
  tokenPx,
  tokenValue,
  WIN,
} from './helpers';

/** The Profil view: `query` after the Windows platform (`&scenario=…`), or a whole query. */
async function profile(page: Page, query = ''): Promise<void> {
  read.delete(page);
  await open(page, query.startsWith('?') ? query : `${WIN}${query}`);
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible();
}

/** A new form from the empty state ("Neues Profil", then "Leer anfangen"). */
async function create(page: Page, scenario = 'no-profile'): Promise<void> {
  await profile(page, `&scenario=${scenario}`);
  await chooseWay(page, 'empty');
  await expect(page.getByTestId('profile-form')).toBeVisible();
}

const save = (page: Page): Locator => page.getByTestId('profile-save');
const discard = (page: Page): Locator => page.getByTestId('profile-discard');
const chips = (field: Locator): Locator => field.locator('.chip .text');
const bar = (page: Page): Locator => page.getByTestId('profile-save-bar');
const check = (page: Page): Locator => page.getByTestId('profile-check');
const field = (page: Page, name: string): Locator => page.locator(`[data-field="${name}"]`);
const countries = (page: Page): Locator => page.getByTestId('profile-countries');
const countryInput = (page: Page): Locator => countries(page).locator('input');
const options = (page: Page): Locator => page.getByTestId('profile-countries-options');
const saves = async (page: Page): Promise<number> => (await calls(page, 'save_profile')).length;
/** The chevron after the title that opens the menu of the profiles. */
const switcher = (page: Page): Locator => page.getByTestId('profile-switcher');
/** The title of the view: the active profile's name. */
const heading = (page: Page): Locator => page.getByTestId('profile-heading');
/** The other profiles of the demo's work folder, by their roles (the stub's 2 and 3). */
const OTHERS = DEMO.profiles.slice(0, 2).map((other) => other.profile.form!.title);
const middle = (box: { y: number; height: number } | null): number => box!.y + box!.height / 2;

/** The sections of the form, in order (on the tabs Suche, Können, Erfahrung, Ausschlüsse). */
const SECTIONS = [
  'section-wishes',
  'section-competences',
  'section-experience',
  'section-criteria',
  'section-permanent',
];

/** The toast that answers a save (with what its rescore changed, when it did). */
const savedToast = (page: Page): Locator =>
  page.getByTestId('toast').filter({ hasText: T.profile.saved.replace(/\.$/, '') });

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

/** How many saves of the page a test has read (the next read waits for a newer one). */
const read = new WeakMap<Page, number>();

/** The save the last action sent, once it has reached the stub (a save starts a moment
 *  after its click). */
async function lastSave(page: Page): Promise<ProfileSave> {
  const before = read.get(page) ?? 0;
  await expect.poll(() => saves(page)).toBeGreaterThan(before);
  const all = await calls(page, 'save_profile');
  read.set(page, all.length);
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
    // Only what is shown (the Profil shows one tab at a time).
    nodes
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => {
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

test('the head: the name as the title with its menu and a status only when needed', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-remote-unread');
  const head = page.getByTestId('profile-head');
  // The title names the profile by its role (the page's heading, text a user would copy); no
  // person, file, time of saving, quality or count above the form.
  const role = DEMO.profile.form!.title;
  await expect(heading(page)).toHaveText(role);
  await expect(head.getByRole('heading', { level: 1 })).toHaveText(role);
  await expect(heading(page)).toHaveAttribute('data-copy', '');
  // A quiet chevron right after the name opens the menu (a small ghost icon button).
  await expect(switcher(page)).toHaveAccessibleName(T.profile.profiles);
  await expect(switcher(page)).toHaveAttribute('aria-haspopup', 'menu');
  await expect(switcher(page)).toHaveClass(/ghost/);
  await expect(switcher(page)).toHaveCSS('height', `${await tokenPx(page, '--control-sm')}px`);
  const name = (await heading(page).boundingBox())!;
  const chevron = (await switcher(page).boundingBox())!;
  expect(chevron.x - (name.x + name.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(middle(chevron) - middle(name))).toBeLessThanOrEqual(1);
  for (const gone of ['Erika Beispiel', 'Gespeichert', 'Vollständig']) {
    await expect(head).not.toContainText(gone);
  }
  for (const id of ['profile-name', 'profile-role', 'profile-saved-at', 'profile-understood']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
  await expect(page.getByTestId('profile-quality')).toHaveCount(0);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  // A value to check: the status on the first row of the window, like the sidebar's first
  // entry; a click goes there.
  await expect(check(page)).toHaveText('1 Wert prüfen');
  // As high as the other buttons of the row (29 px).
  await expect(check(page)).toHaveCSS('height', `${await tokenPx(page, '--control-field')}px`);
  const first = page.locator('[data-testid="view-profile"] [data-first-row]').first();
  await expect(first.getByTestId('profile-check')).toBeVisible();
  expect(middle(await first.boundingBox())).toBe(
    middle(await page.getByTestId('nav-jobs').boundingBox()),
  );
  await expect(page.getByTestId('profile-warning')).toHaveCount(0);
  // No button beside the title: everything lives in the switcher's menu (no "…" menu).
  await expect(head.getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('profile-more')).toHaveCount(0);
  await switcher(page).click();
  const menu = page.getByTestId('menu');
  await expect(menu).toHaveAccessibleName(T.profile.profiles);
  await expect(menu.getByRole('menuitemradio')).toHaveText([role, ...OTHERS]);
  await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveText(role);
  // "Neues Profil" (its dialog holds the ways), then what can be done with this one.
  await expect(menu.getByRole('menuitem')).toHaveText([
    T.profile.newProfile,
    T.profile.duplicate,
    T.profile.rename,
    T.profile.remove,
  ]);
  await expect(menu.getByRole('separator')).toHaveCount(3);
  // "Löschen" loses the profile: it is red.
  await expect(page.getByTestId('menu-item-remove')).toHaveClass(/danger/);
  await page.keyboard.press('Escape');
  // With changes, the deletion that would drop them waits.
  await page.getByTestId('profile-title').fill('CFO');
  await switcher(page).click();
  await expect(page.getByTestId('menu-item-remove')).toHaveAttribute('aria-disabled', 'true');
  // Without a value to check (the demo reads cleanly) the head holds the title and its
  // chevron only.
  await page.keyboard.press('Escape');
  await profile(page);
  await expect(check(page)).toHaveCount(0);
  await expect(page.getByTestId('profile-head').getByRole('button')).toHaveCount(1);
  await profile(page, '&scenario=profile-thin');
  await expect(check(page)).toHaveCount(0);
  await expect(page.getByTestId('profile-head').getByRole('button')).toHaveCount(1);
});

test('a long name ends in an ellipsis; the chevron keeps the line of the title', async ({
  page,
}) => {
  // A narrower window: the longest name the field takes (80 characters) runs past the title.
  await page.setViewportSize({ width: 1100, height: 800 });
  await profile(page);
  const long = 'Interim Managerin Finanzen, Controlling, Treasury und Restrukturierung im gehobe';
  await switcher(page).click();
  await page.getByTestId('menu-item-rename').click();
  await page.getByTestId('profile-rename').fill(long);
  await page.keyboard.press('Enter');
  await expect(heading(page)).toHaveText(long);
  const clipped = await heading(page).evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(clipped).toBe(true);
  await expect(heading(page)).toHaveCSS('text-overflow', 'ellipsis');
  const chevron = (await switcher(page).boundingBox())!;
  expect(Math.abs(middle(chevron) - middle(await heading(page).boundingBox()))).toBeLessThanOrEqual(
    1,
  );
});

test("the head starts on the edge of the sections; the title is the page's", async ({ page }) => {
  await profile(page);
  const section = (await page.getByTestId('section-wishes').boundingBox())!;
  const left = (await heading(page).boundingBox())!;
  expect(Math.round(left.x)).toBe(Math.round(section.x));
  // The title is the page's: 26 px in the heading colour, like the reader's job title.
  await expect(heading(page)).toHaveCSS('font-size', `${await tokenPx(page, '--font-2xl')}px`);
});

test('the page ends with room under the last section; the save bar never covers it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await profile(page);
  const view = page.getByTestId('view-profile');
  const last = page.getByTestId('section-permanent');
  /** At the end of the page: the room under the last section, and above the bar. */
  const end = async (): Promise<{ window: number; bar: number | null }> => {
    await view.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }));
    return view.evaluate((node) => {
      const section = node.querySelector('[data-testid="section-permanent"]')!;
      const bottom = section.getBoundingClientRect().bottom;
      const bar = node.querySelector('[data-testid="profile-save-bar"]');
      return {
        window: Math.round(node.getBoundingClientRect().bottom - bottom),
        bar: bar === null ? null : Math.round(bar.getBoundingClientRect().top - bottom),
      };
    });
  };
  await show(page, last);
  // The end of the page never sits on the window's edge (--page-end).
  expect(await end()).toEqual({ window: 96, bar: null });
  // With a change, the last section still scrolls fully above the save bar, with room.
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(bar(page)).toBeVisible();
  await expect.poll(async () => (await end()).bar).toBeGreaterThanOrEqual(32);
});

test('the head, the tabs and the first card keep their rhythm', async ({ page }) => {
  await profile(page);
  const box = async (id: string): Promise<{ y: number; height: number }> =>
    (await page.getByTestId(id).boundingBox())!;
  const head = await box('profile-head');
  const tabs = await box('profile-tabs');
  const first = await box('section-wishes');
  // 32 under the head like every block of the page, the first card 24 under the tabs.
  expect(Math.round(tabs.y - (head.y + head.height))).toBe(32);
  expect(Math.round(first.y - (tabs.y + tabs.height))).toBe(24);
});

test('"n Werte prüfen" goes to the first value that does not read, in the order of the form', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-unreadable');
  await expect(check(page)).toHaveText(/\d+ Werte prüfen/);
  await check(page).click();
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  // The Wünsche come first now (user decision 2026-09-27): the wished roles lead.
  const at = await focused.evaluate((node) =>
    node.closest('[data-field]')?.getAttribute('data-field'),
  );
  expect(at).toBe('roles');
});

// ------------------------------------------------------------------ the form as the table

test('the form on four tabs, one at a time; Ausschlüsse and Festanstellung say what they do', async ({
  page,
}) => {
  await profile(page);
  const order = await page
    .locator('[data-testid="profile-form"] section[data-testid^="section-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  expect(order).toEqual(SECTIONS);
  const tabs = page.getByTestId('profile-tabs').getByRole('tab');
  await expect(tabs).toHaveText(Object.values(T.profile.tab));
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  // One tab shows: Suche first, the others wait.
  await expect(page.getByTestId('section-wishes')).toBeVisible();
  await expect(page.getByTestId('section-competences')).toBeHidden();
  // The first section of a tab goes without a heading (the tab names it); Festanstellung
  // after Bedingungen keeps its own, with its sentence 4 px under it.
  for (const id of ['wishes', 'competences', 'experience', 'criteria'] as const) {
    await expect(page.getByTestId(`section-${id}`).locator('h2')).toHaveCount(0);
  }
  await show(page, page.getByTestId('section-criteria'));
  const criteria = page.getByTestId('section-criteria');
  await expect(criteria.locator(':scope > .hint')).toHaveText(T.profile.sectionHint.criteria!);
  const permanent = page.getByTestId('section-permanent');
  await expect(permanent.getByRole('heading', { level: 2 })).toHaveText(
    T.profile.section.permanent,
  );
  await expect(permanent.locator(':scope > .hint')).toHaveText(T.profile.sectionHint.permanent!);
  const gap = await permanent.evaluate((node) => {
    const text = node.querySelector(':scope > .hint')!.getBoundingClientRect();
    const heading = node.querySelector('h2')!.parentElement!.getBoundingClientRect();
    return Math.round(text.top - heading.bottom);
  });
  expect(gap).toBe(4);
  // No "So liest die App dein Profil".
  await expect(page.getByTestId('section-understood')).toHaveCount(0);
  await expect(page.getByTestId('profile-form')).not.toContainText('So liest die App');
  // The languages are a qualification (Erfahrung); the start date stands with the search.
  await expect(page.getByTestId('section-experience').getByTestId('languages')).toHaveCount(1);
  await expect(page.getByTestId('section-wishes').getByTestId('profile-available')).toHaveCount(1);
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
  await expect(english.getByTestId('language-level')).toHaveText('B2');
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
  // On the tab Suche: the roles, the rates, the regions beside the countries, the start,
  // then the days a week and the duration (checked, never an exclusion).
  const y = async (id: string): Promise<number> => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('profile-min-rate')).toBe(await y('profile-wish-rate'));
  expect(await y('profile-countries')).toBeGreaterThan(await y('profile-roles'));
  expect(await y('profile-available')).toBeGreaterThan(await y('profile-countries'));
  expect(await y('profile-workload-min')).toBeGreaterThan(await y('profile-available'));
  expect(await y('profile-workload-max')).toBe(await y('profile-workload-min'));
  // The demo reads cleanly: its remote share of permanent roles is a number, nothing to check.
  await expect(page.getByTestId('profile-remote-min')).toHaveValue('60');
  await expect(page.getByTestId('profile-remote-min')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(check(page)).toHaveCount(0);
  // Nothing changed: no save bar, and no primary in the view.
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.btn.primary')).toHaveCount(0);
  // A value the app could not read is said at its field, with the mark of every error.
  await profile(page, '&scenario=profile-remote-unread');
  await expect(page.getByTestId('section-permanent')).toContainText(
    'In der Datei stand „viel“, das ist keine Zahl.',
  );
  await expect(page.getByTestId('profile-remote-min')).toHaveAttribute('aria-invalid', 'true');
  await expect(bar(page)).toHaveCount(0);
});

test('Suchbegriffe: the roles and Schwerpunkte until changed, then as written', async ({
  page,
}) => {
  await profile(page);
  const terms = page.getByTestId('profile-search-terms');
  // Under the wished roles, with the sentence what they are for.
  const y = async (id: string): Promise<number> => (await page.getByTestId(id).boundingBox())!.y;
  expect(await y('profile-search-terms')).toBeGreaterThan(await y('profile-roles'));
  await expect(chips(terms)).toHaveText([
    'Interim CFO',
    'Controlling',
    'Konzernrechnungslegung nach IFRS',
  ]);
  // None stored: they are the app's proposal, dashed and said so (user 2026-10-01).
  await expect(field(page, 'searchTerms')).toContainText(T.profile.field.searchTermsProposed);
  await expect(terms.locator('.chip').first()).toHaveCSS('outline-style', 'dashed');
  // Untouched they are no change; one more is, and it is saved as written: the consultant's
  // own from then on, solid, with the sentence what they are for.
  await expect(bar(page)).toHaveCount(0);
  await terms.locator('input').fill('SAP FI/CO');
  await terms.locator('input').press('Enter');
  await expect(field(page, 'searchTerms')).toContainText(T.profile.field.searchTermsHint);
  await expect(terms.locator('.chip').first()).toHaveCSS('outline-style', 'none');
  await save(page).click();
  expect((await lastSave(page)).after.searchTerms).toEqual([
    'Interim CFO',
    'Controlling',
    'Konzernrechnungslegung nach IFRS',
    'SAP FI/CO',
  ]);
});

test('one name per field: the labels, the few hints, units and neutral examples', async ({
  page,
}) => {
  await profile(page);
  const form = page.getByTestId('profile-form');
  for (const text of [
    'Remote-Anteil',
    'Mindesttagessatz',
    'Mindestjahresgehalt',
    'Mindest-Remote-Anteil',
    T.profile.sectionHint.criteria!,
    T.profile.field.minRateHint,
    T.profile.field.focusHint,
  ]) {
    await expect(form).toContainText(text);
  }
  // Only what prevents a mistake is said: no sentence explains the obvious.
  for (const gone of [
    'Die Rolle zählt für die Passung.',
    'Sie stützen die Passung',
    'Ab zehn Jahren',
    'Ohne Niveau rechnet die App mit B2.',
    'markiert die App',
    'Jobs mit diesen Wörtern',
    'Nur dieser Block ist nötig',
    'Jobs ab',
    'DACH',
    'Konditionen',
    'Verlangte Erfahrung ab',
    // The years a job asks for are judged against Berufserfahrung: no target of its own.
    'Mindestens verlangte Erfahrung',
    'Mindest-Tagessatz',
    'Mindest-Jahresgehalt',
    'Ab Datum',
  ]) {
    await expect(form).not.toContainText(gone);
  }
  // The unit stands beside its number field, not in the label.
  for (const [id, unit] of [
    ['profile-years', 'Jahre'],
    ['profile-wish-rate', '€'],
    ['profile-min-rate', '€'],
    ['profile-min-salary', '€'],
    ['profile-remote-min', '%'],
    ['profile-min-months', 'Monate'],
  ] as const) {
    await expect(page.getByTestId(id)).toHaveAccessibleDescription(new RegExp(`${unit}$`));
  }
  await expect(form).not.toContainText('(€)');
  // The column heads say it themselves: no tooltip on them.
  const head = (await show(page, page.getByTestId('competences'))).locator('.head');
  await head.getByText('Synonyme').hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // The workload's two days are named for a screen reader, the unit beside the second.
  await page.getByTestId('profile-tab-search').click();
  await expect(page.getByTestId('profile-workload-min')).toHaveAccessibleName('Auslastung von');
  await expect(page.getByTestId('profile-workload-max')).toHaveAccessibleName('Auslastung bis');
  await expect(page.getByTestId('profile-workload')).toContainText('Tage pro Woche');
  // Verfügbar ab: "Sofort" and "Datum" read on from the label (ab sofort, ab Datum); no
  // "Offen" (the engine scores it like "Sofort", user decision 2026-10-01).
  await expect(page.getByTestId('profile-available').getByRole('radio')).toHaveText([
    'Sofort',
    'Datum',
  ]);
  // The remote wish in the words of the jobs.
  await expect(page.getByTestId('profile-remote').getByRole('radio')).toHaveText([
    T.profile.field.open,
    'Voll remote',
    'Überwiegend remote',
    'Hybrid',
    'Vor Ort',
  ]);
});

test('neutral examples that fit any consultant, in both languages', async ({ page }) => {
  await create(page);
  const placeholder = (id: string, input = false): Locator =>
    input ? page.getByTestId(id).locator('input') : page.getByTestId(id);
  const expected: [string, boolean, string][] = [
    ['competence-name', false, 'z. B. Projektleitung'],
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
  // No field repeats the name of its column.
  const aliases = page.getByTestId('competence-aliases').first().locator('input');
  await show(page, aliases);
  await expect(aliases).not.toHaveAttribute('placeholder', /./);
  // Narrow, the synonyms stand under the competence without their column head: their field
  // names itself.
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(aliases).toHaveAttribute('placeholder', T.profile.field.aliases);
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(aliases).not.toHaveAttribute('placeholder', /./);
  await profile(page, '&scenario=no-profile&lang=en');
  await chooseWay(page, 'empty');
  // Name and role are fields with their labels: no placeholder repeats them.
  await expect(page.getByTestId('profile-name-field')).not.toHaveAttribute('placeholder', /./);
  await expect(page.getByTestId('profile-title')).not.toHaveAttribute('placeholder', /./);
});

test('fields, chip fields and choices one height (as in Einstellungen), labels small and medium', async ({
  page,
}) => {
  await profile(page);
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: 'Datum', exact: true })
    .click();
  await page.getByTestId('profile-title').fill('Interim CFO');
  const form = page.getByTestId('profile-form');
  /** What a selector finds on every tab, each shown in turn. */
  const everywhere = async (selector: string): Promise<Awaited<ReturnType<typeof boxes>>> => {
    const found: Awaited<ReturnType<typeof boxes>> = [];
    for (const tab of Object.keys(T.profile.tab)) {
      await page.getByTestId(`profile-tab-${tab}`).click();
      await expect(page.getByTestId(`profile-panel-${tab}`)).toBeVisible();
      found.push(...(await boxes(form, selector)));
    }
    await page.getByTestId('profile-tab-search').click();
    return found;
  };
  const fields = await everywhere('.field.text');
  expect(fields.length).toBeGreaterThan(8);
  for (const box of fields)
    expect(box.height, box.text).toBe(await tokenPx(page, '--control-field'));
  // Chip fields of one line (every one of the demo profile), the synonyms included.
  const entries = await everywhere('.chip-input > .field.entry');
  expect(entries.length).toBeGreaterThan(8);
  for (const entry of entries)
    expect(entry.height, entry.text).toBe(await tokenPx(page, '--control-field'));
  // One choice component for every choice: the segments, as high as a field like every
  // choice of the app (Einstellungen too), with the 11.5 px text of a small button.
  const groups = await everywhere('[role="radiogroup"]');
  expect(groups.length).toBe(2);
  for (const group of groups)
    expect(group.height, group.text).toBe(await tokenPx(page, '--control-field'));
  const choices = await everywhere('[role="radiogroup"] [role="radio"]');
  for (const choice of choices)
    expect(choice.size, choice.text).toBe(`${await tokenPx(page, '--font-sm')}px`);
  await expect(form.locator('.segmented')).toHaveCount(2);
  // Every control label of a field and a choice (the switches are rows like in Einstellungen).
  const labels = [...(await everywhere('label')), ...(await everywhere('.block > .label'))];
  expect(labels.length).toBeGreaterThan(15);
  for (const label of labels) {
    expect(label.size, label.text).toBe(`${await tokenPx(page, '--font-sm')}px`);
    expect(label.weight, label.text).toBe(await tokenValue(page, '--weight-medium'));
  }
  // The main actions are 29 px; the chevron of the title is a small icon button.
  for (const id of ['profile-save', 'profile-discard']) {
    await expect(page.getByTestId(id)).toHaveCSS(
      'height',
      `${await tokenPx(page, '--control-field')}px`,
    );
  }
  await expect(switcher(page)).toHaveCSS('height', `${await tokenPx(page, '--control-sm')}px`);
  // Every number field has one width; the day of "Datum" too, as high as the choice beside
  // it, the calendar's button beside the field (not inside it, user 2026-10-01).
  const dayField = page.getByTestId('profile-date').locator('xpath=..');
  await expect(dayField.getByTestId('profile-date-calendar')).toHaveCount(0);
  const [day, choice, button] = await Promise.all([
    dayField.boundingBox(),
    page.getByTestId('profile-available').boundingBox(),
    page.getByTestId('profile-date-calendar').boundingBox(),
  ]);
  expect(day!.height).toBe(choice!.height);
  expect(middle(day)).toBe(middle(choice));
  expect(button!.x).toBeGreaterThanOrEqual(day!.x + day!.width);
  expect(Math.abs(middle(button) - middle(day))).toBeLessThanOrEqual(1);
  const widths: number[] = [];
  for (const id of [
    'profile-wish-rate',
    'profile-min-rate',
    'profile-min-months',
    'profile-date',
    'profile-years',
    'profile-min-salary',
    'profile-remote-min',
  ]) {
    const number = await show(page, page.getByTestId(id));
    widths.push(Math.round((await number.locator('xpath=..').boundingBox())!.width));
  }
  expect(new Set(widths).size, widths.join(' ')).toBe(1);
});

test('every reference of a field or switch names a text that is there', async ({ page }) => {
  await profile(page);
  const view = page.getByTestId('profile');
  expect(await dangling(view)).toEqual([]);
  // A field without a hint is described by nothing; a switch neither.
  await expect(page.getByTestId('profile-name-field')).not.toHaveAttribute('aria-describedby', /./);
  await expect(page.getByTestId('profile-strengths').locator('input')).not.toHaveAttribute(
    'aria-describedby',
    /./,
  );
  await expect(page.getByTestId('profile-no-permanent')).not.toHaveAttribute(
    'aria-describedby',
    /./,
  );
  // An error takes the place of the missing hint, and is its description.
  await page.getByTestId('profile-min-rate').fill('250000');
  await expect(page.getByTestId('profile-min-rate')).toHaveAccessibleDescription(
    /Höchstens 100\.000\./,
  );
  expect(await dangling(view)).toEqual([]);
  // The day, a new form and the values the app could not read.
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: 'Datum', exact: true })
    .click();
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

test('edit and discard: the form goes back to what is stored, the bar leaves', async ({ page }) => {
  await profile(page);
  const title = page.getByTestId('profile-title');
  await expect(bar(page)).toHaveCount(0);
  await title.fill('Interim CFO');
  await expect(bar(page)).toBeVisible();
  await countryInput(page).fill('Schweiz');
  await countryInput(page).press('Enter');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await discard(page).click();
  await expect(title).toHaveValue('Interim Managerin Finanzen');
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Österreich']);
  await expect(bar(page)).toHaveCount(0);
  expect(await saves(page)).toBe(0);
});

test('edit and save: both forms go to the backend, the change is confirmed', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-min-rate').fill('1.250');
  const keywords = (await show(page, page.getByTestId('profile-keywords'))).locator('input');
  await keywords.fill('Bilanzierung');
  await keywords.press('Enter');
  await page.getByTestId('profile-tab-search').click();
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: 'Datum', exact: true })
    .click();
  await page.getByTestId('profile-date').fill('1.11.2026');
  // Engine 16: either day may stay empty.
  await page.getByTestId('profile-workload-min').fill('2');
  await page.getByTestId('profile-workload-max').fill('');
  await page.getByTestId('profile-min-months').fill('12');
  const words = await show(page, page.getByTestId('profile-exclusion-words'));
  await words.getByRole('button', { name: 'Praktikum entfernen' }).click();
  await words.locator('input').fill('Trainee');
  await words.locator('input').press('Enter');
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
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
  // Saved: the form is the stored profile again, the bar has gone.
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByTestId('profile-date')).toHaveValue('01.11.2026');
  await expect(page.getByTestId('profile-workload-max')).toHaveValue('');
});

test('the save bar shows only while something changed; a toast answers the save', async ({
  page,
}) => {
  await profile(page);
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(bar(page)).toBeVisible();
  // No word about what is unsaved: the bar itself says it.
  await expect(bar(page)).toHaveText(/^\s*(Speichern\s*Verwerfen|Verwerfen\s*Speichern)\s*$/);
  // Back to what is stored: the bar goes again.
  await page.getByTestId('profile-title').fill('Interim Managerin Finanzen');
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('profile-title').fill('Interim CFO');
  await save(page).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(savedToast(page)).toHaveCount(1);
  await expect(page.getByTestId('profile-save-status')).toHaveCount(0);
});

test('the toast of a save says what the rescore changed, only the parts that did', async ({
  page,
}) => {
  // The demo profile saved again moves no job: the toast says only that it is saved.
  await profile(page);
  await page.getByTestId('profile-title').fill('Interim CFO');
  await save(page).click();
  await expect(savedToast(page).getByTestId('toast-text')).toHaveText(T.profile.saved);
  // A first profile scores the jobs of Aktuell: the ones now high and the excluded ones.
  await create(page);
  await (await show(page, page.getByTestId('competence-name'))).fill('Controlling');
  await save(page).click();
  // Once the save reached the stub, the jobs carry their scores.
  await lastSave(page);
  const { counts } = await page.evaluate(() => window.__harness.list({ place: 'inbox' }));
  const high = (
    await page.evaluate(() => window.__harness.list({ place: 'inbox', bands: ['high'] }))
  ).counts.inbox;
  expect(high).toBeGreaterThan(0);
  expect(counts.excluded).toBeGreaterThan(0);
  const said = T.profile.savedEffect(high, counts.excluded);
  expect(said).toBe(
    `Profil gespeichert, ${high} Jobs jetzt mit hoher Übereinstimmung, ${counts.excluded} ausgeschlossen`,
  );
  await expect(savedToast(page).getByTestId('toast-text')).toHaveText(said);
  // Only what changed, fewer as well as more; alone the excluded ones name the jobs.
  expect(T.profile.savedEffect(0, 1)).toBe('Profil gespeichert, 1 Job ausgeschlossen');
  expect(T.profile.savedEffect(-2, -1)).toBe(
    'Profil gespeichert, 2 Jobs nicht mehr mit hoher Übereinstimmung, 1 nicht mehr ausgeschlossen',
  );
  expect(T.profile.savedEffect(0, 0)).toBe(T.profile.saved);
});

test('a value that is wrong holds the save and says why', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-min-months').fill('200');
  // Said at once at its field, marked, and Speichern waits and says why.
  await expect(field(page, 'minMonths')).toContainText('Höchstens 120.');
  await expect(page.getByTestId('profile-min-months')).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await tooltipOf(page, save(page))).toBe(T.profile.fixFirst);
  await save(page).click({ force: true });
  await page.getByTestId('profile-min-months').press('Enter');
  expect(await saves(page)).toBe(0);
  // Put right, it saves.
  await page.getByTestId('profile-min-months').fill('9');
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  await save(page).click();
  await expect.poll(() => saves(page)).toBe(1);
});

test('a focused field is never hidden under the save bar', async ({ page }) => {
  await profile(page);
  await page.getByTestId('profile-title').fill('Interim CFO');
  const saveBar = bar(page);
  await show(page, page.getByTestId('competence-add'));
  for (const id of ['competence-add', 'profile-strengths', 'profile-keywords']) {
    const target =
      id === 'competence-add' ? page.getByTestId(id) : page.getByTestId(id).locator('input');
    await target.focus();
    await expect
      .poll(async () => {
        const [box, barBox] = [await target.boundingBox(), await saveBar.boundingBox()];
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
    if (id === 'profile-years') await show(page, page.getByTestId(id));
    await page.getByTestId(id).fill(value);
    await page.getByTestId(id).press('Enter');
    await expect.poll(() => saves(page), id).toBe(before + 1);
    await expect(bar(page)).toHaveCount(0);
  }
  // The day: Enter saves once it reads, and judges it when it does not.
  await page.getByTestId('profile-tab-search').click();
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: 'Datum', exact: true })
    .click();
  const date = page.getByTestId('profile-date');
  await date.fill('31.02.2026');
  await date.press('Enter');
  await expect(page.getByTestId('profile-date-error')).toHaveText('Diesen Tag gibt es nicht.');
  expect(await saves(page)).toBe(4);
  await date.fill('01.12.2026');
  await date.press('Enter');
  await expect.poll(() => saves(page)).toBe(5);
  // A chip field adds what was typed; a row goes to the next row.
  const tools = (await show(page, page.getByTestId('profile-tools'))).locator('input');
  await tools.fill('Miro');
  await tools.press('Enter');
  await expect(chips(page.getByTestId('profile-tools')).last()).toHaveText('Miro');
  await page.getByTestId('competence-name').first().press('Enter');
  await expect(page.getByTestId('competence-name').nth(1)).toBeFocused();
  expect(await saves(page)).toBe(5);
  // The app has no save key of its own: Ctrl+S saves nothing.
  await page.getByTestId('competence-name').nth(1).press('Control+s');
  await page.waitForTimeout(200);
  expect(await saves(page)).toBe(5);
});

test('Enter goes through the rows and never saves; on an empty last row it moves on', async ({
  page,
}) => {
  await profile(page);
  const names = await show(page, page.getByTestId('competence-name'));
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
  await expect(page.getByTestId('profile-tools').locator('input')).toBeFocused();
  // Languages behave the same.
  const languages = await show(page, page.getByTestId('language-name'));
  await languages.nth(1).press('Enter');
  await expect(languages).toHaveCount(3);
  await expect(languages.nth(2)).toBeFocused();
  expect(await saves(page)).toBe(0);
  await languages.nth(2).fill('Spanisch');
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.after.competences.map((row) => row.name)).toContain('Konzernabschluss');
  expect(sent.after.languages.map((row) => row.language)).toContain('Spanisch');
});

test('one choice is one Tab stop, the arrows choose, "Egal" clears it; the level is a menu', async ({
  page,
}) => {
  await profile(page);
  // The remote wish: one stop, the chosen option; the arrows, Home and End choose.
  const remote = page.getByTestId('profile-remote');
  await expect(remote).toHaveAttribute('role', 'radiogroup');
  await expect(remote.locator('[tabindex="0"]')).toHaveCount(1);
  await remote.getByRole('radio', { name: 'Überwiegend remote' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(remote.getByRole('radio', { name: 'Hybrid' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(remote.getByRole('radio', { name: T.profile.field.open })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('End');
  await expect(remote.getByRole('radio', { name: 'Vor Ort' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // "Egal" wishes none and stays chosen when pressed again.
  for (let i = 0; i < 2; i++) {
    await remote.getByRole('radio', { name: T.profile.field.open }).click();
    await expect(remote.getByRole('radio', { name: T.profile.field.open })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  }
  await expect(remote.locator('[aria-checked="true"]')).toHaveCount(1);
  const available = page.getByTestId('profile-available');
  await available.getByRole('radio', { name: 'Datum' }).click();
  await available.getByRole('radio', { name: 'Sofort' }).click();
  await expect(available.getByRole('radio', { name: 'Sofort' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  // The level of a language: a menu of the levels, no "Offen" (without one the engine
  // assumes B2, so a row without one shows B2).
  const row = (await show(page, page.getByTestId('language-row'))).first();
  const level = row.getByTestId('language-level');
  // A field with the level; only its chevron is the button (user 2026-10-01).
  const opener = row.getByTestId('language-level-open');
  await expect(opener).toHaveAttribute('aria-haspopup', 'menu');
  // Name, the level, the x: three stops.
  await row.getByTestId('language-name').focus();
  await page.keyboard.press('Tab');
  await expect(opener).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row.getByTestId('language-remove')).toBeFocused();
  // A click on the level's words opens nothing; the chevron does.
  await level.locator('.value').click();
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await opener.click();
  const menu = page.getByTestId('menu');
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2',
    'Muttersprache',
  ]);
  await expect(page.getByTestId('menu-item-none')).toHaveCount(0);
  await page.getByTestId('menu-item-c1').click();
  await expect(level).toHaveText('C1');
  // A new row starts at B2.
  await page.getByTestId('language-add').click();
  await expect(page.getByTestId('language-level').last()).toHaveText('B2');
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after.languages[0]!.level).toBe('c1');
  expect(sent.after.wishes.remote).toBeNull();
  expect(sent.after.criteria.available).toEqual({ kind: 'now' });
});

/** What has the focus: a field (a caret shows), a button by its accessible name, or none. */
const focusOf = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'none';
    if (active.matches('input, textarea')) return 'field';
    return active.getAttribute('aria-label') ?? active.textContent?.trim() ?? '?';
  });

test('removing a row: a click drops the focus, the keyboard goes on to the next x', async ({
  page,
}) => {
  await create(page);
  const names = await show(page, page.getByTestId('competence-name'));
  const remove = page.getByTestId('competence-remove');
  for (const [at, name] of ['Controlling', 'Treasury', 'Reporting', 'Tax'].entries()) {
    if (at > 0) await page.getByTestId('competence-add').click();
    await names.nth(at).fill(name);
  }
  // A click on an x: the row goes, no caret and no ring anywhere.
  await remove.nth(3).click();
  await expect(names).toHaveCount(3);
  expect(await focusOf(page)).toBe('none');
  // Enter or Space on a focused x: the next row's x, the previous one after the last, then
  // the add button; never a field.
  await remove.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(names).toHaveCount(2);
  await expect(names.nth(1)).toHaveValue('Reporting');
  await expect(remove.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(names).toHaveCount(1);
  await expect(remove.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(names).toHaveCount(0);
  await expect(page.getByTestId('competence-add')).toBeFocused();
  // The languages alike.
  const languages = await show(page, page.getByTestId('language-name'));
  await languages.first().fill('Englisch');
  await page.getByTestId('language-add').click();
  await languages.nth(1).fill('Deutsch');
  await page.getByTestId('language-remove').first().click();
  await expect(languages).toHaveCount(1);
  expect(await focusOf(page)).toBe('none');
  await page.getByTestId('language-remove').focus();
  await page.keyboard.press('Enter');
  await expect(languages).toHaveCount(0);
  await expect(page.getByTestId('language-add')).toBeFocused();
});

test('removing a chip: a click ends the caret, Backspace and Delete go on to the next x', async ({
  page,
}) => {
  await profile(page);
  const tools = await show(page, page.getByTestId('profile-tools'));
  const input = tools.locator('input');
  const x = (name: string): Locator => tools.getByRole('button', { name: T.chips.remove(name) });
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'LucaNet', 'Power BI']);
  // With the caret in the field, a click on an x removes its chip and ends the caret.
  await input.click();
  await x('LucaNet').click();
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI']);
  expect(await focusOf(page)).toBe('none');
  // Backspace in the empty field: the last chip goes, the x before it takes the focus (with
  // its ring), the caret leaves the field.
  await input.fill('Excel, Jira, Miro');
  await input.press('Enter');
  await input.press('Backspace');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI', 'Excel', 'Jira']);
  await expect(x('Jira')).toBeFocused();
  expect(await x('Jira').evaluate((node) => node.matches(':focus-visible'))).toBe(true);
  // On a focused x Backspace, Delete, Enter and Space remove its chip: the next x, the
  // previous one after the last.
  await page.keyboard.press('Backspace');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI', 'Excel']);
  await expect(x('Excel')).toBeFocused();
  await x('SAP S/4HANA').focus();
  await page.keyboard.press('Delete');
  await expect(chips(tools)).toHaveText(['Power BI', 'Excel']);
  await expect(x('Power BI')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(chips(tools)).toHaveText(['Excel']);
  await expect(x('Excel')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chips(tools)).toHaveCount(0);
  expect(await focusOf(page)).not.toBe('field');
  // Backspace in the field of its only chip: the chip goes, the caret stays where it was.
  await input.fill('Excel');
  await input.press('Enter');
  await input.press('Backspace');
  await expect(chips(tools)).toHaveCount(0);
  await expect(input).toBeFocused();
});

test('the one-line synonyms stay open while the keyboard removes their chips', async ({ page }) => {
  await profile(page);
  const aliases = (await show(page, page.getByTestId('competence-aliases'))).nth(1);
  const input = aliases.locator('input');
  await input.fill('Konzerncontrolling, Management Reporting, Unternehmensplanung, Forecasting');
  await input.press('Enter');
  await input.press('Backspace');
  // The focus on an x of the field: every chip shows, none spare.
  const focused = aliases.locator('.remove:focus');
  await expect(focused).toHaveCount(1);
  await expect(aliases.locator('.chip.spare')).toHaveCount(0);
  await expect(focused).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(aliases.locator('.remove:focus')).toBeVisible();
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

test('a calendar beside the day offers one, by the keys too; typing still works', async ({
  page,
}) => {
  await profile(page);
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: T.profile.availability.from, exact: true })
    .click();
  const date = page.getByTestId('profile-date');
  const button = page.getByTestId('profile-date-calendar');
  const popover = page.getByTestId('profile-date-calendar-popover');
  const month = page.getByTestId('profile-date-calendar-month');
  const day = (iso: string): Locator => popover.locator(`[data-day="${iso}"]`);
  // Without a day it opens on today's month (the clock stands on 24 September 2026), the
  // week from Monday, the focus on today.
  await date.fill('');
  await button.click();
  await expect(popover).toBeVisible();
  await expect(month).toHaveText(`${T.calendar.months[8]} 2026`);
  await expect(popover.getByRole('columnheader')).toHaveText(T.calendar.weekdays);
  await expect(day('2026-09-24')).toBeFocused();
  await expect(day('2026-09-24')).toHaveAttribute('aria-current', 'date');
  // 1 September 2026 is a Tuesday: the second cell of the first week.
  const first = popover.getByRole('row').nth(1).getByRole('gridcell');
  await expect(first.nth(0).locator('button')).toHaveCount(0);
  await expect(first.nth(1)).toHaveText('1');
  // The arrows a day or a week, End the week's end, PageDown a month on.
  await page.keyboard.press('ArrowRight');
  await expect(day('2026-09-25')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(day('2026-10-02')).toBeFocused();
  await expect(month).toHaveText(`${T.calendar.months[9]} 2026`);
  await page.keyboard.press('PageUp');
  await expect(day('2026-09-02')).toBeFocused();
  await page.keyboard.press('End');
  await expect(day('2026-09-06')).toBeFocused();
  // Enter takes the day into the field in its form; the focus goes back to the button.
  await page.keyboard.press('Enter');
  await expect(popover).toHaveCount(0);
  await expect(date).toHaveValue('06.09.2026');
  await expect(button).toBeFocused();
  // Typing still works, and the calendar opens on the typed day, chosen.
  await date.fill('1.11.2026');
  await button.click();
  await expect(month).toHaveText(`${T.calendar.months[10]} 2026`);
  await expect(day('2026-11-01')).toBeFocused();
  await expect(day('2026-11-01')).toHaveClass(/chosen/);
  // Its buttons turn the month; Esc closes and gives the focus back.
  await page.getByTestId('profile-date-calendar-next').click();
  await expect(month).toHaveText(`${T.calendar.months[11]} 2026`);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(bar(page)).toBeVisible();
  // A click elsewhere closes it too; a click on a day takes it.
  await button.click();
  await page.getByTestId('profile-name-field').click();
  await expect(popover).toHaveCount(0);
  await button.click();
  await day('2026-11-15').click();
  await expect(date).toHaveValue('15.11.2026');
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.after.criteria.available).toEqual({ kind: 'from', date: '2026-11-15' });
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
  await choices.getByRole('radio', { name: 'Datum', exact: true }).click();
  await expect(date).toBeFocused();
  // The demo profile is available from a day already: type a new one.
  await date.fill('');
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
  await expect(error).toHaveText('Diesen Tag gibt es nicht.');
  const said = (await page.locator('body').innerText()).split('Diesen Tag gibt es nicht.');
  expect(said).toHaveLength(2);
  // The day holds the save until it reads.
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await saves(page)).toBe(0);
  // After "Verwerfen" the stored day is back (the demo profile is available from a day), and
  // a day chosen anew is judged anew.
  await discard(page).click();
  await expect(error).toHaveCount(0);
  await choices.getByRole('radio', { name: 'Sofort' }).click();
  await expect(date).toHaveCount(0);
  await choices.getByRole('radio', { name: 'Datum', exact: true }).click();
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
  await page
    .getByTestId('profile-available')
    .getByRole('radio', { name: 'Date', exact: true })
    .click();
  await page.getByTestId('profile-date').fill('31/02/2026');
  await page.getByTestId('profile-name-field').focus();
  await expect(error).toHaveText('This date does not exist.');
});

test('a value too large is said at once, stays with its error and holds the save', async ({
  page,
}) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('250000');
  await expect(field(page, 'minDayRate')).toContainText('Höchstens 100.000.');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  // Another change leaves it marked; the save waits and gives the field the caret.
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-title').press('Enter');
  await expect(rate).toBeFocused();
  expect(await saves(page)).toBe(0);
  // Put right, the mark goes.
  await rate.fill('1200');
  await expect(rate).not.toHaveAttribute('aria-invalid', 'true');
  // A competence: its row is marked (counted without the empty rows).
  await (await show(page, page.getByTestId('competence-add'))).click();
  await page.getByTestId('competence-years').nth(3).fill('80');
  await expect(page.getByTestId('competence-error')).toHaveText('Höchstens 70.');
  const names = page.getByTestId('competence-name');
  await expect(names.nth(3)).toHaveAttribute('aria-invalid', 'true');
  await expect(names.nth(2)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await saves(page)).toBe(0);
});

test('a typed 0 is refused where at least 1 counts and holds the save', async ({ page }) => {
  await profile(page);
  for (const [id, name] of [
    ['profile-min-rate', 'minDayRate'],
    ['profile-wish-rate', 'wishDayRate'],
    ['profile-min-months', 'minMonths'],
  ] as const) {
    const input = page.getByTestId(id);
    await input.fill('0');
    await expect(field(page, name), name).toContainText(T.profile.field.atLeast(1));
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
    await input.fill('1');
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  }
  // A day of the workload alike; Enter to save gives it the caret.
  const min = page.getByTestId('profile-workload-min');
  await min.fill('0');
  await expect(field(page, 'workload')).toContainText(T.profile.field.atLeast(1));
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('profile-title').press('Enter');
  await expect(min).toBeFocused();
  expect(await saves(page)).toBe(0);
});

test('a value the backend refuses is said at its field, which gets the caret', async ({ page }) => {
  await profile(page);
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('1300');
  await refuseNext(page, { field: 'minDayRate', row: null, max: 1200 });
  await save(page).click();
  await expect(field(page, 'minDayRate')).toContainText('Höchstens 1.200.');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(rate).toBeFocused();
  // It holds the save while that value stands, also when another field changes.
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('profile-title').fill('Interim CFO');
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  // A new value takes the mark away.
  await rate.fill('1200');
  await expect(rate).not.toHaveAttribute('aria-invalid', 'true');
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
});

for (const [platform, query] of [
  ['Windows', WIN],
  ['macOS', MAC],
] as const) {
  test(`days that do not fit are said at the workload at once (${platform})`, async ({ page }) => {
    await profile(page, query);
    const max = page.getByTestId('profile-workload-max');
    await max.fill('7');
    await expect(field(page, 'workload')).toContainText('Höchstens 5.');
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
    // The second day below the first says which way round.
    await page.getByTestId('profile-workload-min').fill('4');
    await max.fill('3');
    await expect(field(page, 'workload')).toContainText('Der zweite Wert liegt unter dem ersten.');
    await expect(max).toHaveAttribute('aria-invalid', 'true');
    await max.fill('5');
    await expect(max).not.toHaveAttribute('aria-invalid', 'true');
    await save(page).click();
    expect(await saves(page)).toBe(1);
  });
}

test('a day far beyond the week and a duration too long hold the save until put right', async ({
  page,
}) => {
  await profile(page);
  const min = page.getByTestId('profile-workload-min');
  await min.fill('300');
  await expect(field(page, 'workload')).toContainText('Höchstens 5.');
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  await min.fill('4');
  const months = page.getByTestId('profile-min-months');
  await months.fill('200');
  await expect(field(page, 'minMonths')).toContainText('Höchstens 120.');
  await expect(months).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
  await months.fill('9');
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  expect(await saves(page)).toBe(1);
  expect((await lastSave(page)).after.criteria).toMatchObject({
    workloadMinDays: 4,
    workloadMaxDays: 5,
    minMonths: 9,
  });
});

test('values that contradict each other say so quietly at the field', async ({ page }) => {
  await profile(page);
  const wish = field(page, 'wishDayRate');
  await expect(wish).not.toContainText(T.profile.field.belowMinRate);
  await page.getByTestId('profile-wish-rate').fill('1000');
  await expect(wish).toContainText(T.profile.field.belowMinRate);
  await expect(page.getByTestId('profile-wish-rate')).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('profile-min-rate').fill('900');
  await expect(wish).not.toContainText(T.profile.field.belowMinRate);
  // Quiet hints never hold a save back.
  await page.getByTestId('profile-wish-rate').fill('800');
  await expect(wish).toContainText(T.profile.field.belowMinRate);
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
});

// ------------------------------------------------------------------ switches and Festanstellung

test('switches: only the switch switches, its text names and describes it; each row its line', async ({
  page,
}) => {
  await profile(page);
  const cases = [
    {
      section: 'wishes',
      id: 'profile-remote-outside',
      label: 'Remote-Jobs im Ausland ausschließen',
    },
    { section: 'criteria', id: 'profile-no-anue', label: 'Zeitarbeit ausschließen' },
    { section: 'criteria', id: 'profile-no-permanent', label: 'Festanstellung ausschließen' },
  ];
  // Every row but the last has its hairline; the list has one above and one below.
  const lines = (id: string): Promise<string[]> =>
    page
      .getByTestId(`section-${id}`)
      .locator('[data-setting-row]')
      .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).borderBottomWidth));
  expect(await lines('wishes')).toEqual(['0px']);
  expect(await lines('criteria')).toEqual(['1px', '0px']);
  for (const { section, id, label } of cases) {
    const scope = await show(page, page.getByTestId(`section-${section}`));
    const toggle = page.getByTestId(id);
    const before = await toggle.getAttribute('aria-checked');
    await scope.getByText(label, { exact: true }).click();
    await expect(toggle, `${id} from its text`).toHaveAttribute('aria-checked', before!);
    await expect(toggle).toHaveAccessibleName(label);
    await toggle.click();
    await expect(toggle, `${id} itself`).not.toHaveAttribute('aria-checked', before!);
  }
  // No text of the form is a label of a switch.
  const ids = await page
    .getByTestId('profile-form')
    .getByRole('switch', { includeHidden: true })
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  expect(ids).toHaveLength(3);
  for (const id of ids) await expect(page.locator(`label[for="${id}"]`)).toHaveCount(0);
});

test('the remote switch excludes, sits under the countries and needs one', async ({ page }) => {
  await profile(page);
  const toggle = page.getByTestId('profile-remote-outside');
  const box = async (node: Locator): Promise<{ y: number; height: number }> =>
    (await node.boundingBox())!;
  const list = await box(countries(page));
  expect((await box(toggle)).y).toBeGreaterThan(list.y + list.height);
  expect((await box(toggle)).y).toBeLessThan((await box(page.getByTestId('profile-remote'))).y);
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

test('excluding permanent roles folds their block away and back', async ({ page }) => {
  await profile(page);
  await (await show(page, page.getByTestId('profile-no-permanent'))).click();
  await expect(page.getByTestId('section-permanent')).toHaveCount(0);
  await page.getByTestId('profile-no-permanent').click();
  await expect(page.getByTestId('section-permanent')).toBeVisible();
  // Back in its place, the last section: 32 above it as above every section, once it has
  // unfolded.
  const gap = async (): Promise<number> => {
    const [criteria, permanent] = await Promise.all([
      page.getByTestId('section-criteria').boundingBox(),
      page.getByTestId('section-permanent').boundingBox(),
    ]);
    return Math.round(permanent!.y - (criteria!.y + criteria!.height));
  };
  await expect.poll(gap).toBe(32);
});

test('Festanstellung: places first, the remote share comes with them; excluded, the block goes', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-remote-unread');
  const block = await show(page, page.getByTestId('section-permanent'));
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
  // Without places there is no empty share; it comes with the first place.
  const share = page.getByTestId('profile-remote-min');
  await expect(share).toHaveCount(0);
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

test('the countries: search in both languages, Enter or a click, chips', async ({ page }) => {
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
  // A chip goes with its x; no button adds a group of countries.
  await countries(page).getByRole('button', { name: 'Österreich entfernen' }).click();
  await expect(chips(countries(page))).toHaveText(['Deutschland', 'Schweden', 'Niederlande']);
  await expect(page.getByTestId('profile-dach')).toHaveCount(0);
  await save(page).click();
  expect((await lastSave(page)).after.criteria.countries).toEqual(['DE', 'SE', 'NL']);
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
  // Once it stands still (the save bar that came with the first change may move the view).
  await third.hover();
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
  await show(page, page.getByTestId('competence-star'));
  const stars = page.getByTestId('competence-star');
  // The star, a glyph made to be filled: outlined, filled while marked.
  await expect(stars.nth(1).locator('[data-icon]')).toHaveAttribute('data-icon', 'star');
  const fill = (index: number): Promise<string> =>
    stars
      .nth(index)
      .locator('svg')
      .evaluate((node) => getComputedStyle(node).fill);
  expect(await fill(1)).not.toBe('none');
  expect(await fill(0)).toBe('none');
  // Its words follow its state.
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
  await chooseWay(page, 'file');
  await expect.poll(() => marked(page)).toHaveLength(5);
  await expect(page.getByTestId('focus-trimmed')).toHaveText(
    'Übernommen sind die ersten fünf Schwerpunkte.',
  );
  await expect(page.getByTestId('focus-count')).toHaveText('5/5');
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  expect((await lastSave(page)).after.focus).toHaveLength(5);
});

test('chip field: Enter adds, a pasted list splits, x and Backspace remove, Esc drops', async ({
  page,
}) => {
  await profile(page);
  await show(page, page.getByTestId('profile-tools'));
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
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
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
  await show(page, page.getByTestId('profile-strengths'));
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
  const degrees = (await show(page, page.getByTestId('profile-degrees'))).locator('input');
  await degrees.fill('Master of Science, Wirtschaftsinformatik');
  await degrees.press('Enter');
  await expect(chips(page.getByTestId('profile-degrees')).last()).toHaveText(
    'Master of Science, Wirtschaftsinformatik',
  );
  // A double click on a chip puts its text back into the field, the rest stays.
  const tools = await show(page, page.getByTestId('profile-tools'));
  await chips(tools).nth(1).dblclick();
  await expect(tools.locator('input')).toBeFocused();
  await expect(tools.locator('input')).toHaveValue('LucaNet');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI']);
  await tools.locator('input').fill('LucaNet Financial');
  await tools.locator('input').press('Enter');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA', 'Power BI', 'LucaNet Financial']);
});

test('a long competence reads whole: its column is wider than the synonyms', async ({ page }) => {
  await profile(page);
  await show(page, page.getByTestId('competence-row'));
  const row = page.getByTestId('competence-row').nth(2);
  const name = row.getByTestId('competence-name');
  await expect(name).toHaveValue('Konzernrechnungslegung nach IFRS');
  expect(
    await name.evaluate((input: HTMLInputElement) => input.scrollWidth <= input.clientWidth),
  ).toBe(true);
  const [own, aliases] = await Promise.all([
    name.boundingBox(),
    row.getByTestId('competence-aliases').boundingBox(),
  ]);
  expect(own!.width).toBeGreaterThan(aliases!.width);
});

test('the synonyms keep one line, "+n" names the rest, also narrow', async ({ page }) => {
  await profile(page);
  await show(page, page.getByTestId('competence-aliases'));
  const aliases = page.getByTestId('competence-aliases').nth(1);
  const input = aliases.locator('input');
  await input.fill('Konzerncontrolling, Management Reporting, Unternehmensplanung, Forecasting');
  await input.press('Enter');
  // With the focus every chip shows (to remove or edit one).
  await expect(aliases.locator('.chip:not(.more):not(.spare)')).toHaveCount(6);
  await heading(page).click();
  await expect(aliases).toHaveCSS('height', `${await tokenPx(page, '--control-field')}px`);
  const more = aliases.getByTestId('competence-aliases-more');
  await expect(more).toHaveText(/^\+\d$/);
  const hidden = Number((await more.textContent())!.trim().slice(1));
  await expect(aliases.locator('.chip.spare')).toHaveCount(hidden);
  expect(await tooltipOf(page, more)).toContain('Forecasting');
  await page.setViewportSize({ width: 480, height: 640 });
  await aliases.scrollIntoViewIfNeeded();
  expect(Math.round((await aliases.boundingBox())!.height)).toBe(
    await tokenPx(page, '--control-field'),
  );
});

test('the language rows line up: the level like a select, one width; the x needs no tooltip', async ({
  page,
}) => {
  await profile(page);
  // Their columns are named over the rows like the competences'.
  await show(page, page.getByTestId('languages'));
  const heads = page.getByTestId('languages').locator('.head > span');
  await expect(heads).toHaveText([T.profile.field.language, T.profile.field.level, '']);
  const [head, first] = await Promise.all([
    heads.nth(1).boundingBox(),
    page.getByTestId('language-level').first().boundingBox(),
  ]);
  expect(Math.round(head!.x)).toBe(Math.round(first!.x));
  // The level is a field in a row of fields: framed and as high as the field, in one column
  // whatever its word, so the fields and the levels of all rows line up; only its chevron
  // is a button.
  const rows = page.getByTestId('language-row');
  await expect(rows.nth(0).getByTestId('language-level')).toHaveText('Muttersprache');
  await expect(rows.nth(1).getByTestId('language-level')).toHaveText('B2');
  const boxesOf = (testid: string): Promise<{ x: number; width: number; height: number }[]> =>
    rows.getByTestId(testid).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: Math.round(box.x),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }),
    );
  const levels = await boxesOf('language-level');
  const names = await boxesOf('language-name');
  expect(new Set(levels.map((box) => `${box.x} ${box.width} ${box.height}`)).size).toBe(1);
  expect(new Set(names.map((box) => `${box.x} ${box.width}`)).size).toBe(1);
  expect(levels[0]!.height).toBe(await tokenPx(page, '--control-field'));
  await expect(rows.nth(0).getByTestId('language-level')).toHaveClass(/select/);
  const opener = (await rows.nth(0).getByTestId('language-level-open').boundingBox())!;
  expect(opener.x + opener.width).toBeLessThanOrEqual(levels[0]!.x + levels[0]!.width);
  expect(opener.width).toBeLessThan(levels[0]!.width / 2);
  // Narrow, a row keeps its level beside the name.
  await page.setViewportSize({ width: 480, height: 600 });
  const row = page.getByTestId('language-row').first();
  await row.scrollIntoViewIfNeeded();
  const name = (await row.getByTestId('language-name').boundingBox())!;
  const level = (await row.getByTestId('language-level').boundingBox())!;
  expect(Math.abs(middle(level) - middle(name))).toBeLessThan(2);
  // The x of a row is obvious: no tooltip, its name for a screen reader.
  const remove = row.getByTestId('language-remove');
  await expect(remove).toHaveAccessibleName(/entfernen$/);
  await remove.hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await (await show(page, page.getByTestId('competence-remove'))).first().hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('the language field suggests common languages in both names', async ({ page }) => {
  await profile(page);
  await show(page, page.getByTestId('language-add'));
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

test('language names follow the UI language; the profile keeps them in German', async ({
  page,
}) => {
  const values = (): Promise<string[]> =>
    page
      .getByTestId('language-name')
      .evaluateAll((all) => all.map((input) => (input as HTMLInputElement).value));
  for (const [query, shown, english, spanish] of [
    ['', ['Deutsch', 'Englisch'], 'Englisch', 'Spanisch'],
    ['&lang=en', ['German', 'English'], 'English', 'Spanish'],
  ] as const) {
    await profile(page, query);
    // The demo profile keeps "Deutsch" and "Englisch": the rows name them in the UI's words.
    expect(await values()).toEqual(shown);
    await (await show(page, page.getByTestId('language-add'))).click();
    const name = page.getByTestId('language-name').last();
    const suggestions = page.getByTestId('language-name-options').last();
    // Typing towards a language suggests it in the UI's words, found by either name.
    await name.fill('Englis');
    await expect(suggestions.getByRole('option')).toHaveText([english]);
    await name.fill('Spani');
    await expect(suggestions.getByRole('option')).toHaveText([spanish]);
    await name.press('Enter');
    await expect(name).toHaveValue(spanish);
    // A name in the other language stays as typed while the field has the focus, then shows
    // in the UI's words.
    await name.fill(spanish === 'Spanisch' ? 'spanish' : 'spanisch');
    await expect(name).toHaveValue(spanish === 'Spanisch' ? 'spanish' : 'spanisch');
    await page.keyboard.press('Tab');
    await expect(name).toHaveValue(spanish);
    await save(page).click();
    const sent = await lastSave(page);
    expect(sent.after.languages.map((row) => row.language)).toEqual([
      'Deutsch',
      'Englisch',
      'Spanisch',
    ]);
  }
});

// ------------------------------------------------------------------ the ways in

test('no profile: the start page, its three ways each with its own button, no dialog', async ({
  page,
}) => {
  await profile(page, '&scenario=no-profile');
  const empty = page.getByTestId('profile-empty');
  await expect(page.getByTestId('profile-start-heading')).toHaveText(T.profile.newProfile);
  await expect(empty).toContainText(T.profile.noneText);
  // Each way with what it does and its button (none of them the primary: none is the one
  // way on).
  const ways = page.getByTestId('new-profile-ways').locator('[data-setting-row]');
  await expect(ways).toHaveCount(3);
  for (const [at, label] of Object.values(T.profile.way).entries()) {
    await expect(ways.nth(at)).toContainText(label);
  }
  // Leer anfangen, Aus Datei laden, Aus dem Lebenslauf (user decision 2026-10-01): one button
  // each; the prompt has the AI hand over the file that "Datei hochladen" loads.
  await expect(ways.nth(0).getByRole('button')).toHaveText(T.profile.startEmpty);
  await expect(ways.nth(1).getByRole('button')).toHaveText(T.profile.pickFile);
  await expect(ways.nth(2)).toContainText(T.profile.cvPrompt);
  await expect(ways.nth(2).getByRole('button')).toHaveText(T.profile.copyPrompt);
  await expect(empty.locator('.btn.primary')).toHaveCount(0);
  await expect(page.getByTestId('profile-start-cancel')).toHaveCount(0);
  expect(await calls(page, 'pick_profile')).toHaveLength(0);
});

test('Neues Profil from the menu: the start page beside the profile, Abbrechen goes back', async ({
  page,
}) => {
  await profile(page);
  await switcher(page).click();
  await page.getByTestId('menu-item-new').click();
  await expect(page.getByTestId('profile-start-heading')).toHaveText(T.profile.newProfile);
  await page.getByTestId('profile-start-cancel').click();
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await switcher(page).click();
  await page.getByTestId('menu-item-new').click();
  await chooseWay(page, 'empty');
  await expect(heading(page)).toHaveText(T.profile.newProfile);
  await expect(page.getByTestId('profile-roles').locator('input')).toBeFocused();
});

test('a new form starts with one row each', async ({ page }) => {
  await create(page);
  // It opens on Suche with the caret in the wished roles.
  await expect(page.getByTestId('profile-roles').locator('input')).toBeFocused();
  // Nothing typed yet: nothing to save.
  await expect(bar(page)).toHaveCount(0);
  // One empty row each: the table and the star show at once.
  await show(page, page.getByTestId('competence-name'));
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
  // Without a profile there is no switcher yet, and nothing is read.
  await expect(switcher(page)).toHaveCount(0);
  await expect(page.getByTestId('profile-more')).toHaveCount(0);
  await expect(page.getByTestId('profile-replaces')).toHaveCount(0);
});

test('a competence suggests the words of the engine; nothing replaces what was typed', async ({
  page,
}) => {
  await create(page);
  await show(page, page.getByTestId('competence-name'));
  const name = page.getByTestId('competence-name');
  const list = page.getByTestId('competence-name-suggestions');
  const items = list.getByRole('option');
  // From the second character: terms that start with it or have a word that does.
  await name.fill('C');
  await expect(items).toHaveCount(0);
  await name.fill('Contr');
  await expect(items.first()).toBeVisible();
  await expect(items).toContainText(['Controlling']);
  for (const text of await items.allTextContents()) {
    expect(
      text
        .toLowerCase()
        .split(/[\s\-/]+/)
        .some((word) => word.startsWith('contr')),
    ).toBe(true);
  }
  await expect(name).toHaveAttribute('role', 'combobox');
  await expect(name).toHaveAttribute('aria-expanded', 'true');
  // Nothing is marked: Enter keeps what was typed (and goes on like every Enter of a row).
  await expect(list.locator('[aria-selected="true"]')).toHaveCount(0);
  await name.press('Enter');
  await expect(name.first()).toHaveValue('Contr');
  await name.first().fill('Contr');
  // The arrows mark one, Enter takes it; the list is gone until the next character.
  await name.first().press('ArrowDown');
  const first = (await items.first().textContent())!.trim();
  await expect(items.first()).toHaveAttribute('aria-selected', 'true');
  await expect(name.first()).toHaveAttribute('aria-activedescendant', /hints-0$/);
  await name.first().press('Enter');
  await expect(name.first()).toHaveValue(first);
  await expect(list.first()).toBeHidden();
  // Esc closes the list and keeps the text; a click takes a term.
  await name.first().fill('Treas');
  await expect(items).toContainText(['Treasury']);
  await name.first().press('Escape');
  await expect(list.first()).toBeHidden();
  await expect(name.first()).toHaveValue('Treas');
  await name.first().press('Backspace');
  await list.first().getByRole('option', { name: 'Treasury', exact: true }).click();
  await expect(name.first()).toHaveValue('Treasury');
  await expect(name.first()).toBeFocused();
});

test('synonyms, tools and industries suggest their words as chips; typed text stays', async ({
  page,
}) => {
  await create(page);
  await show(page, page.getByTestId('competence-name'));
  await page.getByTestId('competence-name').fill('Controlling');
  // A synonym: a click takes the term as a chip.
  const aliases = page.getByTestId('competence-aliases');
  const aliasInput = aliases.locator('input');
  await aliasInput.fill('Power');
  const aliasList = page.getByTestId('competence-aliases-suggestions');
  await aliasList.getByRole('option', { name: 'Power BI', exact: true }).click();
  await expect(chips(aliases)).toHaveText(['Power BI']);
  await expect(aliasInput).toHaveValue('');
  // Enter without a mark takes the typed text; with the arrows the marked term.
  await aliasInput.fill('Reporting Pack');
  await aliasInput.press('Enter');
  await expect(chips(aliases)).toHaveText(['Power BI', 'Reporting Pack']);
  // A term that is a chip already is not suggested again.
  await aliasInput.fill('Power B');
  await expect(aliasList.getByRole('option', { name: 'Power BI', exact: true })).toHaveCount(0);
  await aliasInput.fill('');
  const tools = page.getByTestId('profile-tools');
  await tools.locator('input').fill('SAP S/4');
  await tools.locator('input').press('ArrowDown');
  await tools.locator('input').press('Enter');
  await expect(chips(tools)).toHaveText(['SAP S/4HANA']);
  // The industries suggest industries, not skills.
  const industries = await show(page, page.getByTestId('profile-industries'));
  await industries.locator('input').fill('Maschin');
  const industryList = page.getByTestId('profile-industries-suggestions');
  await expect(industryList.getByRole('option')).toContainText(['Maschinenbau']);
  await industries.locator('input').fill('Controll');
  await expect(industryList.getByRole('option')).toHaveCount(0);
  // Esc closes the list first, the second Esc drops the text.
  await industries.locator('input').fill('Maschin');
  await industries.locator('input').press('Escape');
  await expect(industryList).toBeHidden();
  await expect(industries.locator('input')).toHaveValue('Maschin');
  await industries.locator('input').press('Escape');
  await expect(industries.locator('input')).toHaveValue('');
  // The words are asked once.
  expect(await calls(page, 'vocabulary')).toHaveLength(1);
});

test('create and save: an empty row is not saved; the level comes from its menu', async ({
  page,
}) => {
  await create(page);
  await page.getByTestId('profile-name-field').fill('Erika Beispiel');
  await expect(bar(page)).toBeVisible();
  // The tab of the one block the profile needs carries an amber dot while it is empty.
  const skills = page.getByTestId('profile-tab-skills');
  await expect(skills.locator('.mark.warning')).toHaveCount(1);
  await expect(page.getByTestId('profile-tabs').locator('.mark')).toHaveCount(1);
  await show(page, page.getByTestId('section-competences'));
  await page.getByTestId('competence-name').fill('Controlling');
  await page.getByTestId('competence-years').fill('18');
  await expect(skills.locator('.mark')).toHaveCount(0);
  // An added row takes the caret; an empty one is not saved.
  await page.getByTestId('competence-add').click();
  await expect(page.getByTestId('competence-name').last()).toBeFocused();
  await (await show(page, page.getByTestId('language-name'))).last().fill('Englisch');
  await page.getByTestId('language-row').last().getByTestId('language-level-open').click();
  await page.getByTestId('menu-item-c1').click();
  await save(page).click();
  const sent = await lastSave(page);
  expect(sent.source).toBe('{}');
  expect(sent.after.competences).toEqual([
    { name: 'Controlling', years: 18, aliases: [], origin: null },
  ]);
  expect(sent.after.languages).toEqual([{ language: 'Englisch', level: 'c1', origin: null }]);
  // A new profile allows remote roles abroad, as the engine reads a missing key.
  expect(sent.after.criteria.remoteOutside).toBe(true);
  await expect(savedToast(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('a chosen file fills the form for review; discarding keeps what was there', async ({
  page,
}) => {
  await profile(page, '&scenario=no-profile');
  await chooseWay(page, 'file');
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  // No sentence asks to review: the save bar is there, the draft is unsaved as it is.
  await expect(page.getByTestId('profile-review')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(save(page)).not.toHaveAttribute('aria-disabled', 'true');
  // What does not read is said before saving, at its field.
  await expect(field(page, 'minDayRate')).toContainText(
    'In der Datei stand „ab 900“, das ist keine Zahl.',
  );
  await discard(page).click();
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  expect(await saves(page)).toBe(0);
  await chooseWay(page, 'file');
  await save(page).click();
  expect((await lastSave(page)).source).toBe('{"name": "Jonas Muster"}');
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  // No profile was there: nothing replaced, the save's toast only.
  await expect(savedToast(page)).toBeVisible();
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.replaced })).toHaveCount(0);
});

test('a file over a profile that does not read replaces it; Rückgängig brings it back', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-broken');
  await chooseWay(page, 'file');
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Jonas Muster');
  await expect(page.getByTestId('profile-replaces')).toHaveText(T.profile.replacesStored);
  await expect(page.getByTestId('profile-review')).toHaveCount(0);
  await save(page).click();
  const toast = page.getByTestId('toast').filter({ hasText: T.profile.replaced });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: T.common.undo }).click();
  await expect(page.getByTestId('profile-empty')).toContainText(T.profile.unreadable);
  expect((await calls(page, 'restore_profile')).at(-1)![1]).toEqual({ id: null });
});

test('"Profil löschen" asks naming the profile; the toast names the active one, Rückgängig brings it back', async ({
  page,
}) => {
  await profile(page);
  const role = DEMO.profile.form!.title;
  const ask = async (): Promise<Locator> => {
    await switcher(page).click();
    await page.getByTestId('menu-item-remove').click();
    const dialog = page.getByTestId('dialog-remove-profile');
    await expect(dialog.getByRole('heading')).toHaveText(T.profile.removeHeading(role));
    await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.profile.removeConfirm);
    return dialog;
  };
  const removed = (): Locator =>
    page.getByTestId('toast').filter({ hasText: T.profile.removedNow(OTHERS[0]!) });
  const undo = (): Locator => removed().getByRole('button', { name: T.common.undo });
  // Cancel keeps the profile.
  await (await ask()).getByTestId('dialog-cancel').click();
  expect(await calls(page, 'delete_profile')).toHaveLength(0);
  await (await ask()).getByTestId('dialog-confirm').click();
  expect((await calls(page, 'delete_profile')).at(-1)![1]).toEqual({ id: 1 });
  // Without one active before it, the next profile is active and in the form; the toast
  // names it.
  await expect(heading(page)).toHaveText(OTHERS[0]!);
  await expect(removed()).toBeVisible();
  await expect(page.getByTestId('profile-name-field')).toHaveValue(
    DEMO.profiles[0]!.profile.form!.name,
  );
  await undo().click();
  await expect(heading(page)).toHaveText(role);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  expect((await calls(page, 'restore_profile')).at(-1)![1]).toEqual({ id: 1 });
  // An undo that fails says so.
  await (await ask()).getByTestId('dialog-confirm').click();
  await expect(heading(page)).toHaveText(OTHERS[0]!);
  await failNext(page, 'restore_profile');
  await undo().click();
  await expect(
    page.getByTestId('toast').filter({ hasText: T.profile.restoreFailed }),
  ).toBeVisible();
  await expect(heading(page)).toHaveText(OTHERS[0]!);
});

test('the last profile deleted leaves the ways in', async ({ page }) => {
  await profile(page);
  const dialog = page.getByTestId('dialog-remove-profile');
  for (const left of [2, 1, 0]) {
    await switcher(page).click();
    await page.getByTestId('menu-item-remove').click();
    await dialog.getByTestId('dialog-confirm').click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => window.__harness.form() !== null)).toBe(left > 0);
  }
  await expect(page.getByTestId('profile-empty')).toContainText(T.profile.newProfile);
  await expect(switcher(page)).toHaveCount(0);
});

test('a deleted profile gives the place back to the one active before it', async ({ page }) => {
  await profile(page);
  const role = DEMO.profile.form!.title;
  // From the first to the third: deleting the third goes back to the first, not the second.
  await switcher(page).click();
  await page.getByTestId('menu-item-profile-3').click();
  await expect(heading(page)).toHaveText(OTHERS[1]!);
  await switcher(page).click();
  await page.getByTestId('menu-item-remove').click();
  await page.getByTestId('dialog-remove-profile').getByTestId('dialog-confirm').click();
  await expect(heading(page)).toHaveText(role);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  await expect(
    page.getByTestId('toast').filter({ hasText: T.profile.removedNow(role) }),
  ).toBeVisible();
});

// ------------------------------------------------------------------ several profiles

test('the switcher lists every profile; a switch scores the jobs with the new one', async ({
  page,
}) => {
  await open(page, WIN);
  // A job's ring in the list with the demo profile.
  const key = 'freelancermap-2801';
  const ring = row(page, key).locator('.ring .center');
  await expect(ring).toHaveText(String(demoScore(key)));
  await page.getByTestId('nav-profile').click();
  await switcher(page).click();
  await page.getByTestId('menu-item-profile-2').click();
  await expect(heading(page)).toHaveText(OTHERS[0]!);
  expect((await calls(page, 'switch_profile')).at(-1)![1]).toEqual({ id: 2 });
  await expect(page.getByTestId('toast').filter({ hasText: T.profile.switched })).toBeVisible();
  // The form shows the new profile.
  await expect(page.getByTestId('profile-name-field')).toHaveValue(
    DEMO.profiles[0]!.profile.form!.name,
  );
  // The list scores with it: the engine's match of that profile.
  await page.getByTestId('nav-jobs').click();
  const other = DEMO.profiles[0]!.matches['freelancermap:2801']!;
  expect(other.score).not.toBe(demoScore(key));
  await expect(ring).toHaveText(String(other.score));
  // Back to the first one: its scores again, and the check at it.
  await page.getByTestId('nav-profile').click();
  await switcher(page).click();
  await expect(page.getByTestId('menu-item-profile-2')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('menu-item-profile-1').click();
  await expect(heading(page)).toHaveText(DEMO.profile.form!.title);
  await page.getByTestId('nav-jobs').click();
  await expect(ring).toHaveText(String(demoScore(key)));
});

test('Neues Profil, Profil duplizieren, Umbenennen and Aus Datei laden', async ({ page }) => {
  await profile(page);
  const role = DEMO.profile.form!.title;
  const copy = T.profile.copyName(role);
  // A copy of the active profile, named as a copy, active now; the toast names it.
  await switcher(page).click();
  await page.getByTestId('menu-item-duplicate').click();
  await expect(heading(page)).toHaveText(copy);
  expect((await calls(page, 'duplicate_profile')).at(-1)![1]).toEqual({ id: 1, name: copy });
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Beispiel');
  await expect(
    page.getByTestId('toast').filter({ hasText: T.profile.duplicated(copy) }),
  ).toBeVisible();
  // Umbenennen turns the title into a field with the name selected; Esc keeps the name.
  await switcher(page).click();
  await page.getByTestId('menu-item-rename').click();
  const name = page.getByTestId('profile-rename');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue(copy);
  expect(
    await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
  ).toEqual([0, copy.length]);
  await page.keyboard.type('Anders');
  await page.keyboard.press('Escape');
  await expect(name).toHaveCount(0);
  await expect(heading(page)).toHaveText(copy);
  expect(await calls(page, 'rename_profile')).toHaveLength(0);
  // Enter renames.
  await switcher(page).click();
  await page.getByTestId('menu-item-rename').click();
  await page.keyboard.type('Finanzen Süd');
  await page.keyboard.press('Enter');
  await expect(name).toHaveCount(0);
  await expect(heading(page)).toHaveText('Finanzen Süd');
  expect((await calls(page, 'rename_profile')).at(-1)![1]).toEqual({ id: 4, name: 'Finanzen Süd' });
  // The name is text a user would copy, and only Umbenennen changes it.
  await expect(heading(page)).toHaveAttribute('data-copy', '');
  // Neues Profil is an empty draft: the title says so, the caret goes into its first field,
  // nothing is written. Verwerfen goes back to the active profile as it was.
  const names = page.getByTestId('profile-name-field');
  await switcher(page).click();
  await page.getByTestId('menu-item-new').click();
  await chooseWay(page, 'empty');
  await expect(heading(page)).toHaveText(T.profile.newProfile);
  await expect(names).toHaveValue('');
  await expect(page.getByTestId('profile-roles').locator('input')).toBeFocused();
  await names.fill('Erika Neu');
  await discard(page).click();
  await expect(heading(page)).toHaveText('Finanzen Süd');
  await expect(names).toHaveValue('Erika Beispiel');
  expect(await calls(page, 'create_profile')).toHaveLength(0);
  await switcher(page).click();
  await expect(page.getByTestId('menu').getByRole('menuitemradio')).toHaveText([
    role,
    ...OTHERS,
    'Finanzen Süd',
  ]);
  // Saved, it becomes a new profile beside the others, active now, named by its role; the
  // toast names it.
  await page.getByTestId('menu-item-new').click();
  await chooseWay(page, 'empty');
  await names.fill('Erika Neu');
  await page.getByTestId('profile-title').fill('Interim CFO');
  await save(page).click();
  await expect(heading(page)).toHaveText('Interim CFO');
  expect(await calls(page, 'create_profile')).toHaveLength(1);
  expect((await lastSave(page)).after.name).toBe('Erika Neu');
  await expect(
    page.getByTestId('toast').filter({ hasText: T.profile.created('Interim CFO') }),
  ).toBeVisible();
  await switcher(page).click();
  await expect(page.getByTestId('menu').getByRole('menuitemradio')).toHaveText([
    role,
    ...OTHERS,
    'Finanzen Süd',
    'Interim CFO',
  ]);
  // Aus Datei laden puts the file into the form for review, as a new profile (it replaces
  // nothing); Speichern adds it.
  await page.getByTestId('menu-item-new').click();
  await chooseWay(page, 'file');
  await expect(names).toHaveValue('Jonas Muster');
  await expect(heading(page)).toHaveText(T.profile.newProfile);
  await expect(page.getByTestId('profile-replaces')).toHaveCount(0);
  expect(await calls(page, 'load_profile')).toHaveLength(0);
  await save(page).click();
  await expect(heading(page)).toHaveText(T.profile.numbered(6));
  expect(await calls(page, 'create_profile')).toHaveLength(2);
  await expect(names).toHaveValue('Jonas Muster');
});

test('a new profile whose save fails is not left behind', async ({ page }) => {
  await profile(page);
  await switcher(page).click();
  await page.getByTestId('menu-item-new').click();
  await chooseWay(page, 'empty');
  await page.getByTestId('profile-name-field').fill('Erika Neu');
  await failNext(page, 'save_profile');
  await save(page).click();
  await expect(page.getByTestId('profile-save-error')).toBeVisible();
  // The profile made for it goes again; the one active before is active, the draft stays.
  expect(await calls(page, 'delete_profile')).toHaveLength(1);
  await expect(heading(page)).toHaveText(T.profile.newProfile);
  await expect(page.getByTestId('profile-name-field')).toHaveValue('Erika Neu');
  await discard(page).click();
  await expect(heading(page)).toHaveText(DEMO.profile.form!.title);
  await switcher(page).click();
  await expect(page.getByTestId('menu').getByRole('menuitemradio')).toHaveText([
    DEMO.profile.form!.title,
    ...OTHERS,
  ]);
});

test('another profile with unsaved changes asks first', async ({ page }) => {
  await profile(page);
  const dialog = page.getByTestId('dialog-leave-profile');
  const choose = async (id: number): Promise<void> => {
    await switcher(page).click();
    await page.getByTestId(`menu-item-profile-${id}`).click();
    await expect(dialog.getByRole('heading')).toHaveText(T.profile.leaveHeading);
  };
  await page.getByTestId('profile-title').fill('CFO');
  // Abbrechen keeps the changes and the profile.
  await choose(2);
  await dialog.getByTestId('dialog-cancel').click();
  await expect(page.getByTestId('profile-title')).toHaveValue('CFO');
  expect(await calls(page, 'switch_profile')).toHaveLength(0);
  // Verwerfen drops them and switches.
  await choose(2);
  await dialog.getByTestId('dialog-alt').click();
  await expect(heading(page)).toHaveText(OTHERS[0]!);
  expect(await saves(page)).toBe(0);
  // Speichern saves them first, then switches; the saved profile goes by its new role.
  await page.getByTestId('profile-title').fill('SAP Lead');
  await choose(1);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(heading(page)).toHaveText(DEMO.profile.form!.title);
  expect(await saves(page)).toBe(1);
  expect((await lastSave(page)).after.title).toBe('SAP Lead');
  await switcher(page).click();
  await expect(page.getByTestId('menu').getByRole('menuitemradio')).toHaveText([
    DEMO.profile.form!.title,
    'SAP Lead',
    OTHERS[1]!,
  ]);
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
  // A new form says that saving replaces the file; the switcher stays at hand with the
  // other profiles and the way to a new one.
  await chooseWay(page, 'empty');
  await expect(page.getByTestId('profile-replaces')).toHaveText(
    'Ein neues Profil ersetzt die Datei.',
  );
  await switcher(page).click();
  for (const id of ['menu-item-profile-2', 'menu-item-new']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  // Untouched, Esc goes back to the three ways in, and the first one takes the focus.
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId('profile-name-field').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('new-profile-empty')).toBeFocused();
  await chooseWay(page, 'empty');
  await expect(page.getByTestId('profile-roles').locator('input')).toBeFocused();
  await page.getByTestId('profile-name-field').fill('Erika');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-form')).toBeVisible();
  await page.getByTestId('profile-name-field').fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('new-profile-empty')).toBeFocused();
});

// ------------------------------------------------------------------ the prompt for an AI

test('"Aus dem Lebenslauf": the prompt copied, which has the AI hand over the file', async ({
  page,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await profile(page, '&scenario=no-profile');
  const ways = page.getByTestId('new-profile-ways');
  // The button says it is copied for a moment.
  const copy = ways.getByTestId('new-profile-copy');
  await expect(copy).toHaveText(T.profile.copyPrompt);
  await copy.click();
  await expect(copy).toHaveText(T.profile.copied);
  expect(await calls(page, 'profile_prompt')).toHaveLength(1);
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      'Du kennst meine Job-Alert-App nicht.',
    );
  }
  await expect(copy).toHaveText(T.profile.copyPrompt);
  // Nothing to paste back: the file comes with "Datei hochladen".
  await expect(ways.getByTestId('new-profile-paste')).toHaveCount(0);
  expect(await calls(page, 'save_profile')).toHaveLength(0);
});

test('a clipboard the platform refuses: said at the prompt', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: () => Promise.reject(new Error('denied')),
        readText: () => Promise.reject(new Error('denied')),
      },
    });
  });
  await profile(page, '&scenario=no-profile');
  const ways = page.getByTestId('new-profile-ways');
  await ways.getByTestId('new-profile-copy').click();
  await expect(ways.getByTestId('new-profile-error')).toHaveText(T.profile.promptNotCopied);
});

// ------------------------------------------------------------------ values that do not read

test('a thin profile: no badge in the head, a tab says what it needs, a titled block its emptiness', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-thin');
  // No quality badge in the head and no sentence about it.
  await expect(page.getByTestId('profile-quality')).toHaveCount(0);
  await expect(page.getByText('Das Profil nennt nur wenige Kompetenzen.')).toHaveCount(0);
  // The first block of a tab has no heading and no "Noch leer" (the tab names it); the
  // thin profile names competences, so no tab waits for its first value.
  for (const id of ['wishes', 'competences', 'experience', 'criteria']) {
    await expect(page.getByTestId(`section-${id}`)).not.toContainText(T.profile.empty);
  }
  await expect(page.getByTestId('profile-tabs').locator('.mark')).toHaveCount(0);
});

test('every value that does not read is said at its field and can be removed', async ({ page }) => {
  await profile(page, '&scenario=profile-unreadable');
  // As many as the form says: one per field, the workload's two days one (the retired
  // target years are read and ignored, not named).
  await expect(check(page)).toHaveText(T.profile.check(17));
  // A key the app does not read at all is named in the head as the file writes it, with the
  // folder to fix it.
  const warning = page.getByTestId('profile-warning');
  await expect(warning).toContainText('Die App liest „tagessatz_max“ in den Bedingungen nicht.');
  // Its button is centred on the sentence's first line.
  const [line, button] = await warning.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('.text')!);
    const first = range.getClientRects()[0]!;
    const box = node.querySelector('button')!.getBoundingClientRect();
    return [(first.top + first.bottom) / 2, (box.top + box.bottom) / 2];
  });
  expect(Math.abs(line! - button!)).toBeLessThanOrEqual(1);
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
  // "Wert entfernen" ends the message line at the end of the field's width everywhere: a
  // full-width field, an entry of a list, a choice narrower than its field (Remote-Anteil),
  // a day, and the half-width fields.
  for (const name of [
    'minDayRate',
    'regions',
    'roles',
    'remote',
    'available',
    'workload',
    'minMonths',
  ]) {
    const scope = field(page, name);
    const action = (await scope.getByTestId('value-remove').boundingBox())!;
    const message = (await scope.locator('[role="alert"]').boundingBox())!;
    const box = (await scope.boundingBox())!;
    expect(Math.abs(action.x + action.width - (box.x + box.width)), name).toBeLessThan(2);
    expect(action.y, name).toBeLessThan(message.y + message.height / 2);
  }
  // One per field: seventeen fields, each with "Wert entfernen".
  const removes = form.getByTestId('value-remove');
  await expect(removes).toHaveCount(17);
  // A Schwerpunkt and a target role that do not count go from their list at once.
  await (await show(page, page.getByTestId('focus-unread'))).getByTestId('value-remove').click();
  await expect.poll(() => marked(page)).toEqual(['Controlling']);
  await (await show(page, page.getByTestId('roles-unread'))).getByTestId('value-remove').click();
  await expect(chips(page.getByTestId('profile-roles'))).toHaveText(['Interim CFO']);
  // A new value fixes a field as well.
  await page.getByTestId('profile-min-rate').fill('1000');
  await expect(form).not.toContainText('In der Datei stand „teuer“, das ist keine Zahl.');
  await page.getByTestId('profile-min-months').fill('6');
  await expect(field(page, 'minMonths')).not.toContainText('lang');
  // The workload's one "Wert entfernen" takes both days, and one value to check.
  const before = Number((await check(page).textContent())!.replace(/\D/g, ''));
  await field(page, 'workload').getByTestId('value-remove').click();
  await expect(check(page)).toHaveText(T.profile.check(before - 1));
  await expect(page.getByTestId('profile-workload-max')).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );
  // The others go with "Wert entfernen" (the remote share of Festanstellung without places
  // fades away with its value); then nothing is left to check.
  for (let left = await removes.count(); left > 0; left -= 1) {
    await (await show(page, removes.first())).click();
    await expect(removes).toHaveCount(left - 1);
  }
  await expect(check(page)).toHaveCount(0);
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

test('a day that does not fit is said at the workload before a value of the file', async ({
  page,
}) => {
  await profile(page, '&scenario=profile-unreadable');
  const workload = field(page, 'workload');
  const max = page.getByTestId('profile-workload-max');
  await expect(workload).toContainText('„viel“');
  await max.fill('7');
  await expect(workload).toContainText('Höchstens 5.');
  await expect(workload).not.toContainText('„viel“');
  await expect(max).toHaveAttribute('aria-invalid', 'true');
  await expect(save(page)).toHaveAttribute('aria-disabled', 'true');
});

// ------------------------------------------------------------------ the setup's way on

test('during setup the toast of the first save leads to the mailbox, or to the first fetch', async ({
  page,
}) => {
  // Without a mailbox: back to the setup page, no fetch that must fail.
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('first-profile').click();
  await chooseWay(page, 'empty');
  await show(page, page.getByTestId('competence-name'));
  await page.getByTestId('competence-name').fill('Controlling');
  await save(page).click();
  const next = savedToast(page).getByTestId('toast-action');
  await expect(next).toHaveText(T.profile.nextMailbox);
  await next.click();
  await expect(page.getByTestId('view-first-run')).toBeVisible();
  expect(await calls(page, 'start_run')).toHaveLength(0);
  // With a mailbox: the first fetch starts once.
  await open(page, `${WIN}&scenario=mailbox-only`);
  await page.getByTestId('first-profile').click();
  await chooseWay(page, 'empty');
  await (await show(page, page.getByTestId('competence-name'))).fill('Controlling');
  await save(page).click();
  await expect(next).toHaveText(T.profile.next);
  await next.click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  const started = (await calls(page, 'start_run')).map(
    ([, args]) => (args as { request: unknown }).request,
  );
  expect(started).toEqual([{ kind: 'fetch' }]);
});

// ------------------------------------------------------------------ the block "Häufig verlangt"

const asked = (page: Page): Locator => page.getByTestId('asked');
/** The terms of the rows "Häufig verlangt", in their order. */
const askedWords = (page: Page): Promise<string[]> =>
  page
    .getByTestId('asked-term')
    .evaluateAll((all) => all.map((term) => term.getAttribute('data-term') ?? ''));
/** The button of a term. */
const askedRow = (page: Page, term: string): Locator =>
  page.locator(`[data-testid="asked-term"][data-term="${term}"]`);

/** The demo jobs whose reader names `term` as the term of an open requirement (core's
 *  `params.term`: "Anaplan" of "Kenntnisse in Anaplan"). */
const askingJobs = (term: string): number =>
  Object.values(DEMO.details).filter((detail) =>
    detail.match?.reasons.some((reason) => reason.kind === 'open' && reason.params.term === term),
  ).length;

test('"Häufig verlangt" under its field: the terms the jobs ask for, each where it goes', async ({
  page,
}) => {
  await profile(page);
  // One question for all the fields.
  await show(page, asked(page).first());
  expect(await calls(page, 'asked_terms')).toHaveLength(1);
  // Under the tools, above the next field, like its hint.
  const tools = page.locator('[data-field="tools"]');
  const block = tools.getByTestId('asked');
  await expect(block).toHaveAttribute('data-for', 'tool');
  await expect(block).toContainText(T.profile.asked);
  const field = (await tools.getByTestId('profile-tools').boundingBox())!;
  const own = (await block.boundingBox())!;
  const next = (await page.getByTestId('profile-keywords').boundingBox())!;
  expect(own.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(next.y).toBeGreaterThan(own.y + own.height);
  // The terms, not the ads' phrases: "Kenntnisse in Anaplan" is the tool "Anaplan",
  // "Branchenerfahrung Energie" the industry "Energie", "Erfahrung mit SAP Analytics Cloud"
  // the tool "SAP Analytics Cloud"; each under its own field, once.
  const words = await askedWords(page);
  expect(words.length).toBeGreaterThan(0);
  expect(words.length).toBeLessThanOrEqual(8);
  expect(new Set(words).size).toBe(words.length);
  for (const lead of ['Kenntnisse', 'Erfahrung', 'Branchenerfahrung']) {
    expect(words.join(' ')).not.toContain(lead);
  }
  for (const [term, kind, key] of [
    ['Energie', 'industry', 'industries'],
    ['SAP Analytics Cloud', 'tool', 'tools'],
    ['Anaplan', 'tool', 'tools'],
  ] as const) {
    const row = askedRow(page, term);
    await expect(row).toHaveCount(1);
    await show(page, row);
    await expect(page.locator(`[data-field="${key}"] [data-for="${kind}"]`)).toContainText(term);
    // Its button: the term, and quietly how many demo jobs ask for it (of Aktuell and
    // the Archiv, recent).
    const add = row.getByTestId('asked-add');
    await expect(add).toHaveAccessibleName(new RegExp(`^${term}`));
    const count = Number(await add.locator('.count').textContent());
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(askingJobs(term));
  }
  // The most asked first in every row; none the profile names.
  for (const row of await asked(page).all()) {
    const counts = await row
      .locator('.count')
      .evaluateAll((all) => all.map((each) => Number(each.textContent)));
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  }
  const stored = (await page.evaluate(() => window.__harness.form()))!;
  const names = [
    ...stored.competences.flatMap((c) => [c.name, ...c.aliases]),
    ...stored.tools,
    ...stored.industries,
    ...stored.keywords,
  ].map((name) => name.toLowerCase());
  for (const term of words) expect(names).not.toContain(term.toLowerCase());
});

test('"Hinzufügen" puts the term into its field, an unsaved change like any other', async ({
  page,
}) => {
  await profile(page);
  await show(page, page.getByTestId('profile-tools'));
  const tools = chips(page.getByTestId('profile-tools'));
  const industries = chips(page.getByTestId('profile-industries'));
  await expect(bar(page)).toHaveCount(0);
  // A tool goes to the tools, and its row folds away.
  await askedRow(page, 'Anaplan').getByTestId('asked-add').click();
  await expect(tools.last()).toHaveText('Anaplan');
  await expect(askedRow(page, 'Anaplan')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  expect(await saves(page)).toBe(0);
  // Discarded: it leaves the tools, the term is asked again.
  await discard(page).click();
  await expect(tools).not.toContainText(['Anaplan']);
  await expect(askedRow(page, 'Anaplan')).toHaveCount(1);
  // An industry goes to the industries; saved, both go to the backend in their fields.
  await (await show(page, askedRow(page, 'Energie'))).getByTestId('asked-add').click();
  await expect(industries.last()).toHaveText('Energie');
  await (await show(page, askedRow(page, 'Anaplan'))).getByTestId('asked-add').click();
  const before = (await calls(page, 'asked_terms')).length;
  await save(page).click();
  await expect(savedToast(page)).toBeVisible();
  const sent = await lastSave(page);
  expect(sent.after.tools).toContain('Anaplan');
  expect(sent.after.industries).toContain('Energie');
  expect(sent.after.competences.map((row) => row.name)).not.toContain('Anaplan');
  expect(sent.before.tools).not.toContain('Anaplan');
  await expect.poll(async () => (await calls(page, 'asked_terms')).length).toBeGreaterThan(before);
  expect(await askedWords(page)).not.toContain('Anaplan');
  expect(await askedWords(page)).not.toContain('Energie');
});

test('a row goes with its last term; a focused term hands the focus on, then to its field', async ({
  page,
}) => {
  await profile(page);
  const block = await show(page, page.locator('[data-field="tools"]').getByTestId('asked'));
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
  // Every term of the row is a tool now.
  const named = await chips(page.getByTestId('profile-tools')).allTextContents();
  for (const term of words) expect(named).toContain(term);
  await expect(bar(page)).toBeVisible();
});

test('the rows ask again after a fetch', async ({ page }) => {
  await profile(page);
  await show(page, asked(page).first());
  const before = (await calls(page, 'asked_terms')).length;
  await page.evaluate(() => window.__harness.appRun('fetch'));
  await runFinished(page);
  await expect.poll(async () => (await calls(page, 'asked_terms')).length).toBeGreaterThan(before);
  await show(page, asked(page).first());
});

test('without an answer the rows stay away', async ({ page }) => {
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
