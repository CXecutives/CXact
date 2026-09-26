// The reader, one structure top to bottom (ui/src/features/jobs/reader-sections.ts): the head
// (company and place with their icons, the portals with the day), the ring or the ban of an
// excluded job, the four actions and their "…" menu per place, the Jobdetails (the order and
// icons of lib/facts.ts, "/" for what the ad does not say, verdicts as icons whose tooltip is
// the reason), the Anforderungen (only requirements, a quiet count, "+" for a missing term),
// the ad as plain text with its one note, and the switch between two jobs. At the end what the
// reader's rounds of fixes carried around it (one column, the run card, the focus).
//
// The stub's demo profile: a minimum day rate of 1.100 € and a wish of 1.200 €, mostly remote,
// three to five days a week for at least six months, 15 years of experience, no temporary
// agency work.

import type { Locator, Page } from '@playwright/test';
import { demoScore } from './demo';
import { calls, expect, open, runFinished, settle, test } from './fixtures';
import {
  chooseFilter,
  lastQuery,
  openJob,
  openPlace,
  row,
  rows,
  settleMoves,
  stage,
  tokenColour,
  WIN,
} from './helpers';

/** The score of the best job, the first row of the list (freelancermap-2801). */
const BEST = String(demoScore('freelancermap-2801'));

const terms = (page: Page) => stage(page).getByTestId('criteria');
const term = (page: Page, key: string) => terms(page).getByTestId(`term-${key}`);
const why = (page: Page) => stage(page).getByTestId('why');

/** The rows of the Jobdetails in the order of the facts table (lib/facts.ts). */
const ROWS = [
  'Unternehmen',
  'Ort',
  'Arbeitsort',
  'Vertragsart',
  'Tagessatz',
  'Start',
  'Laufzeit',
  'Auslastung',
  'Erfahrung',
  'Portal',
  'Eingegangen',
];

/** Start the app and open a job of the one list. */
async function openAt(page: Page, key: string, query = WIN): Promise<void> {
  await open(page, query);
  await openJob(page, key);
}

const words = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The value of a row of the Jobdetails and its verdict ('' without one). */
async function cell(page: Page, key: string): Promise<[string, string]> {
  const target = term(page, key);
  const verdict = target.getByTestId('verdict');
  return [
    words(await target.locator('.term-line').textContent()),
    (await verdict.count()) === 0 ? '' : ((await verdict.getAttribute('data-verdict')) ?? ''),
  ];
}

/** The tooltip of a node under the pointer: its title, and its second line (a key). */
async function tooltipOf(page: Page, target: Locator): Promise<[string, string]> {
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await target.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const hint = tooltip.locator('.hint');
  const second = (await hint.count()) === 0 ? '' : words(await hint.textContent());
  const all = words(await tooltip.textContent());
  await page.mouse.move(0, 0);
  return [second === '' ? all : all.slice(0, -second.length).trim(), second];
}

/** The title of the tooltip of a node under the pointer. */
const tip = async (page: Page, target: Locator): Promise<string> =>
  (await tooltipOf(page, target))[0];

/** The tooltip of a verdict's icon. */
const verdictTip = (page: Page, key: string): Promise<string> =>
  tip(page, term(page, key).getByTestId('verdict').locator('.reason'));

/** Open the "…" menu and name its entries (their ids, their words). */
async function moreMenu(page: Page): Promise<{ ids: string[]; labels: string[] }> {
  await stage(page).getByTestId('reader-more').click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  const items = menu.locator('[data-testid^="menu-item-"]');
  const ids = await items.evaluateAll((all) =>
    all.map((item) => (item.getAttribute('data-testid') ?? '').replace('menu-item-', '')),
  );
  const labels = (await items.allInnerTexts()).map(words);
  return { ids, labels };
}

/** Choose an entry of the open menu. */
async function choose(page: Page, id: string): Promise<void> {
  await page.getByTestId(`menu-item-${id}`).click();
}

test.describe('the head and the match', () => {
  test('title, company and place with their icons, the portals with the day, no dot', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const company = stage(page).getByTestId('reader-company');
    const place = stage(page).getByTestId('reader-place');
    await expect(company).toHaveText('Hanseatic Holding GmbH');
    await expect(place).toHaveText('Hamburg');
    await expect(company.locator('.icon svg')).toHaveCount(1);
    await expect(place.locator('.icon svg')).toHaveCount(1);
    // The portal's tile with its name and the day of the alert mail; the other portal that
    // announced it as a tile of its own.
    const own = stage(page).getByTestId('reader-portal-freelancermap');
    await expect(own.locator('.tile')).toHaveText('fm');
    await expect(own).toHaveText('fmfreelancermap.de, 24.09.');
    await expect(stage(page).getByTestId('reader-portal-linkedin')).toHaveText('inlinkedin.com');
    // Nothing is joined by a dot, no line says where the job lies, no second bar follows.
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text).not.toContain('·');
    await expect(stage(page).getByTestId('reader-compact')).toHaveCount(0);
    await expect(stage(page).getByTestId('place-line')).toHaveCount(0);
    // The ring beside its band, and no count line.
    await expect(stage(page).getByTestId('band')).toHaveText('Hohe Übereinstimmung');
    await expect(stage(page).getByTestId('must')).toHaveCount(0);
    expect(text).not.toContain('Pflicht');
    // Hollow: the track and the arc, nothing filled behind them.
    const fills = await stage(page)
      .getByTestId('reader-ring')
      .locator('circle')
      .evaluateAll((all) => all.map((circle) => getComputedStyle(circle).fill));
    expect(fills).toEqual(['none', 'none']);
    // The place without the work mode the portal appends to it.
    await openJob(page, 'freelance-900411');
    await expect(stage(page).getByTestId('reader-place')).toHaveText('München');
  });

  test('opening a job fills the ring, its number stands at once', async ({ page }) => {
    await open(page, WIN);
    await settle(page);
    // Every number the reader's ring shows, frame by frame, from before the click on.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __ring: string[] }).__ring = seen;
      const until = performance.now() + 1500;
      const look = (): void => {
        const center = document.querySelector('[data-testid="reader-ring"] .center');
        const text = center?.textContent?.trim() ?? '';
        if (text !== '') seen.push(text);
        if (performance.now() < until) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await row(page, 'freelancermap-2801').click();
    await expect(stage(page).getByTestId('reader-ring')).toContainText(BEST);
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => (window as unknown as { __ring: string[] }).__ring);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([BEST]));
  });

  test('every job without a score is one empty ring with a dash', async ({ page }) => {
    // An ad still to come, and one too short to score: the same ring, the same words.
    for (const key of ['linkedin-4100200302', 'freelancermap-2806']) {
      if (key === 'linkedin-4100200302') await openAt(page, key);
      else await openJob(page, key);
      const ring = stage(page).getByTestId('reader-ring');
      await expect(ring).toHaveText('–');
      await expect(ring).toHaveAttribute('aria-label', 'Noch nicht bewertet');
      const band = stage(page).getByTestId('band');
      await expect(band).toHaveText('Noch nicht bewertet');
      await expect(band).toHaveCSS('color', await tokenColour(page, '--text-muted'));
    }
    // The short text says so once, where the text is.
    await expect(stage(page).getByTestId('short-note')).toHaveText('Die Anzeige ist sehr kurz.');
  });

  test('the close "×" stands at the same place at every width, no way back besides', async ({
    page,
  }) => {
    for (const size of [
      { width: 1360, height: 900 },
      { width: 683, height: 700 },
    ]) {
      await page.setViewportSize(size);
      await openAt(page, 'freelancermap-2801');
      const close = stage(page).getByTestId('reader-close');
      await expect(close).toBeVisible();
      await expect(close).toHaveAccessibleName('Schließen');
      await expect(page.getByTestId('back')).toHaveCount(0);
      // At the end of the title's first line.
      const box = (await close.boundingBox())!;
      const title = (await stage(page).getByTestId('reader-title').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(title.x + title.width - 1);
      expect(box.y).toBeGreaterThanOrEqual(title.y - 1);
      expect(box.y).toBeLessThan(title.y + box.height);
      expect(await tooltipOf(page, close)).toEqual(['Schließen', '']);
    }
    // In one column it leads back to the list.
    await stage(page).getByTestId('reader-close').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
  });
});

test.describe('the actions', () => {
  test('four buttons alike in one order, the moves of the place in "…"', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    const actions = stage(page).getByTestId('reader-actions');
    const buttons = actions.locator('.btn');
    expect(
      await buttons.evaluateAll((all) => all.map((button) => button.getAttribute('data-testid'))),
    ).toEqual(['reader-mail', 'open-ad', 'reader-prompt', 'reader-more']);
    await expect(actions.getByTestId('reader-mail')).toHaveText('Alert-Mail öffnen');
    await expect(actions.getByTestId('open-ad')).toHaveText('Anzeige öffnen');
    await expect(actions.getByTestId('reader-prompt')).toHaveText('KI-Prompt kopieren');
    await expect(actions.getByTestId('reader-more')).toHaveAccessibleName('Weitere Aktionen');
    // One variant and one height for all four.
    const looks = await buttons.evaluateAll((all) =>
      all.map((button) => `${button.className.includes('secondary')} ${button.clientHeight}`),
    );
    expect(new Set(looks).size).toBe(1);
    expect(looks[0]).toMatch(/^true /);
    // The "…" menu of the inbox, without keys.
    const menu = await moreMenu(page);
    expect(menu.ids).toEqual(['archive', 'trash']);
    expect(menu.labels).toEqual(['Archivieren', 'Löschen']);
    await expect(page.getByTestId('menu').locator('.keys')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The alert mail and the ad open outside.
    await actions.getByTestId('reader-mail').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'gmail', key: { portal: 'freelancermap', id: '2801' } },
    });
    await actions.getByTestId('open-ad').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
    });
    // From the keyboard: the first entry is active at once, the focus comes back after it.
    await actions.getByTestId('reader-more').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu-item-archive')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(actions.getByTestId('reader-more')).toBeFocused();
    // Löschen: the job goes to the trash, the next one opens.
    await page.waitForTimeout(550);
    await moreMenu(page);
    await choose(page, 'trash');
    expect((await calls(page, 'move_jobs')).at(-1)?.[1]).toEqual({
      keys: [{ portal: 'freelancermap', id: '2801' }],
      to: 'trash',
    });
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).not.toHaveText(
      'Interim CFO für Familienunternehmen',
    );
  });

  test('the action row stays one line; where the words do not fit, icons name them', async ({
    page,
  }) => {
    const lines = () =>
      stage(page)
        .getByTestId('reader-actions')
        .evaluate(
          (node) =>
            new Set(
              [...node.children].map((child) => {
                const box = child.getBoundingClientRect();
                return Math.round(box.top + box.height / 2);
              }),
            ).size,
        );
    for (const size of [
      { width: 1360, height: 900 },
      { width: 900, height: 800 },
      { width: 480, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await openAt(page, 'freelancermap-2801');
      await expect.poll(lines).toBe(1);
    }
    const mail = stage(page).getByTestId('reader-mail');
    await expect(mail).toHaveClass(/icon-only/);
    expect(await tooltipOf(page, mail)).toEqual(['Alert-Mail öffnen', '']);
  });

  test('the "…" menu of the archive and of the trash, deleting for good asks first', async ({
    page,
  }) => {
    await open(page, WIN);
    await openPlace(page, 'archive');
    await openJob(page, 'linkedin-4100200306');
    let menu = await moreMenu(page);
    expect(menu.ids).toEqual(['toInbox', 'trash']);
    expect(menu.labels).toEqual(['Wiederherstellen', 'Löschen']);
    await choose(page, 'trash');
    await settleMoves(page);
    await openPlace(page, 'trash');
    await openJob(page, 'linkedin-4100200306');
    menu = await moreMenu(page);
    expect(menu.ids).toEqual(['restore', 'purge']);
    expect(menu.labels).toEqual(['Wiederherstellen', 'Endgültig löschen']);
    await choose(page, 'purge');
    const dialog = page.getByTestId('dialog-purge');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Endgültig löschen' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
    expect((await calls(page, 'purge_jobs')).at(-1)?.[1]).toEqual({
      keys: [{ portal: 'linkedin', id: '4100200306' }],
    });
  });

  test('copying the prompt says so in a toast, a refusing clipboard too', async ({
    page,
    browserName,
  }) => {
    if (browserName === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    await openAt(page, 'freelancermap-2801');
    await stage(page).getByTestId('reader-prompt').click();
    await expect(page.getByTestId('toast').last()).toContainText('Prompt kopiert.');
    expect((await calls(page, 'ai_prompt')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelancermap', id: '2801' },
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    await openAt(page, 'freelancermap-2801');
    await stage(page).getByTestId('reader-prompt').click();
    await expect(page.getByTestId('toast').last()).toContainText(
      'Der Prompt ließ sich nicht kopieren.',
    );
    await expect(stage(page).getByTestId('reader-error')).toHaveCount(0);
  });

  test('closing a job from the reader hands the focus to its row', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('reader-close').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('place-reader')).toBeVisible();
    await expect(row(page, 'freelancermap-2801')).toBeFocused();
    // Esc on one of the reader's buttons does the same.
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('open-ad').focus();
    await page.keyboard.press('Escape');
    await expect(row(page, 'freelancermap-2801')).toBeFocused();
  });

  test('archiving from "…" by the keyboard keeps the focus on "…" of the next job', async ({
    page,
  }) => {
    await open(page, WIN);
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.waitForTimeout(550);
    await page.getByTestId('reader-more').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu-item-archive')).toHaveClass(/active/);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-more')).toBeFocused();
  });
});

test.describe('an excluded job', () => {
  test('the ban instead of the ring, why in one sentence, scored anyway and back', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900412');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-ban').locator('svg')).toHaveCount(1);
    await expect(stage(page).getByTestId('band')).toHaveText('Ausgeschlossen');
    // Its first violation, once; no box, no way into the ad.
    await expect(stage(page).getByTestId('exclusion')).toHaveText('Die Anzeige nennt Zeitarbeit.');
    await expect(stage(page).getByTestId('exclusion-box')).toHaveCount(0);
    await expect(stage(page).getByTestId('show-in-ad')).toHaveCount(0);
    // The rows that exclude it are not met.
    expect(await cell(page, 'contract')).toEqual(['Zeitarbeit', 'violated']);
    expect(await cell(page, 'experience')).toEqual(['3 Jahre', 'violated']);
    await expect(why(page)).not.toContainText('Zeitarbeit');
    // Trotzdem bewerten: its real match, a toast that takes it back, and the way back in "…".
    let menu = await moreMenu(page);
    expect(menu.ids).toEqual(['archive', 'trash', 'override']);
    expect(menu.labels.at(-1)).toBe('Trotzdem bewerten');
    await choose(page, 'override');
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelance', id: '900412' },
      include: true,
    });
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText('Trotzdem bewertet.');
    await expect(toast.getByTestId('toast-action')).toHaveText('Rückgängig');
    await expect(stage(page).getByTestId('reader-ring')).toBeVisible();
    await expect(stage(page).getByTestId('reader-ban')).toHaveCount(0);
    menu = await moreMenu(page);
    expect(menu.ids).toEqual(['archive', 'trash', 'exclude']);
    expect(menu.labels.at(-1)).toBe('Wieder ausschließen');
    await page.keyboard.press('Escape');
    // The toast takes it back.
    await toast.getByTestId('toast-action').click();
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelance', id: '900412' },
      include: false,
    });
    await expect(stage(page).getByTestId('reader-ban')).toBeVisible();
  });

  test('an exclusion word says the word', async ({ page }) => {
    await openAt(page, 'freelancermap-2807');
    await expect(stage(page).getByTestId('exclusion')).toHaveText(
      '„Werkstudent“ steht auf deiner Liste der Ausschlusswörter.',
    );
    await expect(why(page)).not.toContainText('Liste der Ausschlusswörter');
  });
});

test.describe('Jobdetails', () => {
  test('the rows in their order with an icon each, "/" where the ad says nothing', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText('Jobdetails');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
    expect(await terms(page).locator('.term-name .icon svg').count()).toBe(ROWS.length);
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    expect(await cell(page, 'mode')).toEqual(['60 % remote', 'met']);
    expect(await cell(page, 'contract')).toEqual(['Interim', 'met']);
    expect(await cell(page, 'rate')).toEqual(['1.200 €/Tag', 'met']);
    expect(await cell(page, 'start')).toEqual(['ab sofort', 'met']);
    expect(await cell(page, 'duration')).toEqual(['6 Monate', 'met']);
    // The ad says nothing of its workload, and nothing judges it.
    expect(await cell(page, 'workload')).toEqual(['/', '']);
    expect(await cell(page, 'portal')).toEqual(['freelancermap.de, linkedin.com', '']);
    expect(await cell(page, 'received')).toEqual(['24.09.', '']);
    // Verdicts are icons (no words), the reason that decided one in its tooltip.
    await expect(terms(page)).not.toContainText('passt');
    expect(await verdictTip(page, 'rate')).toBe(
      'Der Tagessatz von 1.200 € erreicht den Wunsch von 1.200 €.',
    );
    await expect(term(page, 'rate').getByTestId('verdict').locator('.reason')).toHaveAttribute(
      'aria-label',
      'Erfüllt',
    );
    // Only what the ad says: no line of the profile under a value.
    await expect(terms(page)).not.toContainText('Minimum');
  });

  test('the four verdicts: green, amber, red, muted, each with its own icon', async ({ page }) => {
    const icon = (page: Page, key: string) =>
      term(page, key).getByTestId('verdict').locator('.reason > .icon');
    const look = async (page: Page, key: string): Promise<[string, string]> => [
      await icon(page, key).evaluate((node) => getComputedStyle(node).color),
      await icon(page, key).evaluate((node) => node.innerHTML),
    ];
    await openAt(page, 'freelancermap-2804');
    const met = await look(page, 'workload');
    const unknown = await look(page, 'start');
    expect(await cell(page, 'start')).toEqual(['nach Absprache', 'unknown']);
    expect(met[0]).toBe(await tokenColour(page, '--success-strong'));
    expect(unknown[0]).toBe(await tokenColour(page, '--text-muted'));
    await openJob(page, 'freelance-900413');
    const partial = await look(page, 'workload');
    expect(partial[0]).toBe(await tokenColour(page, '--warning-strong'));
    await openJob(page, 'freelance-900412');
    const violated = await look(page, 'contract');
    expect(violated[0]).toBe(await tokenColour(page, '--danger-strong'));
    // Four glyphs, one per verdict.
    expect(new Set([met[1], unknown[1], partial[1], violated[1]]).size).toBe(4);
  });

  test('one form per fact: a start date, a workload, pay near the wish, the work mode', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900413');
    expect(await cell(page, 'start')).toEqual(['ab 01.11.', 'met']);
    expect(await cell(page, 'workload')).toEqual(['2 Tage/Woche', 'partial']);
    expect(await verdictTip(page, 'workload')).toBe(
      'Die Anzeige nennt 2 Tage pro Woche, das Profil sucht mindestens 3 Tage pro Woche.',
    );
    expect(await cell(page, 'rate')).toEqual(['1.150 €/Tag', 'partial']);
    expect(await cell(page, 'mode')).toEqual(['Vor Ort', 'partial']);
    expect(await cell(page, 'place')).toEqual(['München', 'partial']);
    // A limit missed is met in part; a rate to be agreed has nothing to judge.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'duration')).toEqual(['3 Monate', 'partial']);
    expect(await verdictTip(page, 'duration')).toBe(
      'Die Laufzeit von 3 Monaten liegt unter dem Minimum von 6 Monaten.',
    );
    expect(await cell(page, 'rate')).toEqual(['nach Absprache', '']);
    expect(await cell(page, 'workload')).toEqual(['Vollzeit', 'met']);
    expect(await cell(page, 'mode')).toEqual(['voll remote', 'met']);
    // A hybrid job without a share: its mode in the one set of words.
    await openJob(page, 'linkedin-4100200302');
    expect((await cell(page, 'mode'))[0]).toBe('Hybrid');
    // Said in the rows, not again among the requirements.
    await openJob(page, 'freelancermap-2802');
    await expect(why(page)).not.toContainText('liegt unter dem Minimum');
  });

  test('Erfahrung and the requirement that names the years never disagree', async ({ page }) => {
    // The years the ad asks are the profile's target, but the requirement is met in part (its
    // Controlling only in general): the row says so, with the requirement's reason.
    await openAt(page, 'freelancermap-2801');
    expect(await cell(page, 'experience')).toEqual(['15 Jahre', 'partial']);
    expect(await verdictTip(page, 'experience')).toBe(
      '„Mindestens 15 Jahre Berufserfahrung im Controlling“ passt teilweise zu „Controlling“ im Profil.',
    );
    await expect(why(page)).not.toContainText('Mindestens 15 Jahre');
    // Ten years for a senior profile, in a field the profile lacks: not met, once.
    await openJob(page, 'linkedin-4100200304');
    expect(await cell(page, 'experience')).toEqual(['10 Jahre', 'violated']);
    expect(await verdictTip(page, 'experience')).toBe(
      '„Mindestens 10 Jahre Berufserfahrung im Rechnungswesen“ steht nicht im Profil.',
    );
    await expect(why(page)).not.toContainText('Mindestens 10 Jahre');
    // No requirement that names years stands among the Anforderungen of any job.
    for (const key of ['freelancermap-2802', 'linkedin-4100200301', 'freelance-900412']) {
      await openJob(page, key);
      await expect(why(page)).not.toContainText('Jahre Berufserfahrung');
    }
  });

  test('a permanent job: its salary, no end, the contract to check', async ({ page }) => {
    await openAt(page, 'linkedin-4100200303');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names[4]).toBe('Gehalt');
    expect(await cell(page, 'rate')).toEqual(['95.000 €/Jahr', '']);
    expect(await cell(page, 'duration')).toEqual(['unbefristet', '']);
    expect(await cell(page, 'contract')).toEqual(['Festanstellung', 'unknown']);
    expect(await cell(page, 'experience')).toEqual(['/', '']);
  });

  test('an ad the app never read shows only what it knows', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(['Unternehmen', 'Ort', 'Arbeitsort', 'Portal', 'Eingegangen']);
    await expect(terms(page)).not.toContainText('/');
  });

  test('without a profile: the values without verdicts, no ring, no requirements', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-match')).toHaveCount(0);
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    const columns = await terms(page).evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(2);
    await expect(why(page)).toHaveCount(0);
  });

  test('in English: the row Workload in the same form', async ({ page }) => {
    await openAt(page, 'freelance-900413', `${WIN}&lang=en`);
    await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText('Job details');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toContain('Workload');
    expect(await cell(page, 'workload')).toEqual(['2 days/week', 'partial']);
  });
});

test.describe('Anforderungen', () => {
  test('four groups with their icons and a quiet count, only requirements', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    await expect(why(page).locator('h2')).toHaveText('Anforderungen');
    const titles = (await why(page).locator('.sub').allInnerTexts()).map(words);
    expect(titles).toEqual(['Erfüllt 5', 'Teilweise erfüllt 1', 'Nicht erfüllt 1']);
    // No title, wish or Schwerpunkt, no line of the profile's words.
    for (const said of ['Wunschrolle', 'Schwerpunkt', 'Tagessatz', 'im Profil']) {
      await expect(why(page)).not.toContainText(said);
    }
    // The icons of the verdicts; a group's heading is not said again under the pointer.
    for (const [kind, token] of [
      ['met', '--success-strong'],
      ['partial', '--warning-strong'],
      ['open', '--danger-strong'],
    ] as const) {
      const icon = why(page).getByTestId(`reasons-${kind}`).locator('.reason > .icon').first();
      expect(await icon.evaluate((node) => getComputedStyle(node).color)).toBe(
        await tokenColour(page, token),
      );
    }
    const mark = why(page).locator('.reason > .icon').first();
    await mark.hover();
    await page.waitForTimeout(800);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // Untagged is Pflicht: the only tag is "Optional".
    expect(new Set(await why(page).locator('.badge').allInnerTexts())).toEqual(
      new Set(['Optional']),
    );
    // Only the groups a job has.
    await openJob(page, 'freelancermap-2804');
    await expect(why(page).locator('.sub')).toHaveText(['Nicht erfüllt 1']);
  });

  test('a missing must that is a term goes into the profile with "+", a sentence has none', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2802');
    const missing = why(page).getByTestId('reasons-open').locator('li', {
      hasText: 'Branchenerfahrung Energie',
    });
    await expect(missing).toHaveCount(1);
    const add = missing.getByTestId('add-to-profile');
    await expect(add).toHaveAccessibleName('Zum Profil hinzufügen');
    expect(await tip(page, add)).toBe('Zum Profil hinzufügen');
    // An optional one has none.
    await expect(
      why(page)
        .getByTestId('reasons-open')
        .locator('li', { hasText: 'Französisch' })
        .getByTestId('add-to-profile'),
    ).toHaveCount(0);
    await add.click();
    await expect(missing.getByTestId('added')).toHaveText('Hinzugefügt');
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText('„Branchenerfahrung Energie“ zum Profil hinzugefügt.');
    // The term is among the profile's keywords.
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-keywords')).toContainText('Branchenerfahrung Energie');
    // The toast takes it back.
    await page.getByTestId('nav-jobs').click();
    await page.getByTestId('toast').last().getByTestId('toast-action').click();
    await expect(missing.getByTestId('add-to-profile')).toBeVisible();
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-keywords')).not.toContainText(
      'Branchenerfahrung Energie',
    );
    // A requirement the ad words as a sentence cannot go into the profile.
    await page.getByTestId('nav-jobs').click();
    await openJob(page, 'freelancermap-2804');
    const sentence = why(page).getByTestId('reasons-open').locator('li').first();
    await expect(sentence).toContainText('Kenntnisse in Anaplan helfen dabei');
    await expect(sentence.getByTestId('add-to-profile')).toHaveCount(0);
  });
});

test.describe('the ad', () => {
  test('plain text: no marks, nothing to hover or jump to', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    const text = stage(page).getByTestId('ad-text');
    await expect(text).toContainText('Reporting nach IFRS');
    await expect(text).toHaveAttribute('data-copy', '');
    await expect(text.locator('mark')).toHaveCount(0);
    await expect(stage(page).locator('mark, .jump, button.chip, button.reason')).toHaveCount(0);
    await expect(stage(page).getByTestId('detail-note')).toHaveCount(0);
  });

  test('a preview says so once, here, with the way to its sign-in', async ({ page }) => {
    await openAt(page, 'freelance-900411');
    await expect(stage(page).getByTestId('detail-note')).toHaveText('Nur eine Vorschau');
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text.split('Vorschau').length - 1).toBe(1);
    await expect(stage(page).getByTestId('preliminary')).toHaveCount(0);
    await stage(page).getByTestId('set-up-sign-in').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
  });

  test('a missing ad: "Anzeige laden" loads it, meanwhile it is being loaded', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText('Anzeige fehlt');
    const load = stage(page).getByTestId('load-ad');
    await expect(load).toHaveText('Anzeige laden');
    await load.click();
    expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
      kind: 'details',
      keys: [{ portal: 'linkedin', id: '4100200302' }],
    });
    await expect(note).toHaveText('Anzeige wird geladen');
    await expect(load).toHaveCount(0);
    // An ad that could not be fetched says the same.
    await runFinished(page);
    await openJob(page, 'freelancermap-2805');
    await expect(stage(page).getByTestId('detail-note')).toHaveText('Anzeige fehlt');
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
  });

  test('a closed ad says so in the ad section, nothing in the head', async ({ page }) => {
    await openAt(page, 'linkedin-4100200304');
    await expect(stage(page).getByTestId('detail-note')).toHaveText('Keine Bewerbung mehr möglich');
    await expect(stage(page).locator('.head')).not.toContainText('Bewerbung');
  });
});

test('switching jobs fades the old one out before the new one comes in', async ({ page }) => {
  await openAt(page, 'freelancermap-2801');
  // Every frame from the click on: how many stages show at once, and whether two were there.
  await page.evaluate(() => {
    const seen = { most: 0, both: false };
    (window as unknown as { __stages: typeof seen }).__stages = seen;
    const until = performance.now() + 700;
    const look = (): void => {
      const all = [...document.querySelectorAll('.stage')];
      if (all.length > 1) seen.both = true;
      const shown = all.filter((stage) => Number(getComputedStyle(stage).opacity) > 0.02);
      seen.most = Math.max(seen.most, shown.length);
      if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await row(page, 'freelancermap-2802').click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText('Interim Head of Finance');
  await page.waitForTimeout(700);
  const seen = await page.evaluate(
    () => (window as unknown as { __stages: { most: number; both: boolean } }).__stages,
  );
  expect(seen.both).toBe(true);
  expect(seen.most).toBe(1);
});

// Carried over from the reader's rounds of fixes: the column, the run card and the trash
// around the reader.
test.describe('around the reader', () => {
  test('one column: the header stays on top while the list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 560 });
    await open(page, WIN);
    await page
      .getByTestId('list-scroll')
      .evaluate((node) => node.parentElement?.scrollTo({ top: 400 }));
    await expect(page.getByTestId('search')).toBeInViewport();
    await expect(page.getByTestId('fetch')).toBeInViewport();
    const search = await page.getByTestId('search').boundingBox();
    expect(search?.y ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('a search keeps the open job that is a hit beyond the loaded rows', async ({ page }) => {
    await open(page, `${WIN}&scenario=many`);
    // The order is in the funnel's menu.
    await chooseFilter(page, 'newest');
    const key = { portal: 'linkedin', id: '100006' } as const;
    const title = (await page.evaluate((k) => window.__harness.job(k), key))!.title;
    await row(page, 'linkedin-100006').click();
    await expect(page.getByTestId('reader-title')).toHaveText(title);
    await chooseFilter(page, 'match');
    // Its title without the number: every fourth job of the scenario is a hit.
    const search = title.replace(/ \d+$/, '');
    await page.getByTestId('search').fill(search);
    await expect.poll(async () => (await lastQuery(page))?.search).toBe(search);
    await page.waitForTimeout(400);
    await expect(page.getByTestId('reader-title')).toHaveText(title);
  });

  test('an empty trash shows one empty state, the reader only its sentence', async ({ page }) => {
    await open(page, `${WIN}&scenario=empty`);
    await page.getByTestId('place-trash').click();
    const note = page.getByTestId('place-reader');
    await expect(note).toContainText('30 Tage');
    await expect(note.locator('svg')).toHaveCount(0);
  });

  test('a locked Excel file is written again without reading the mailbox', async ({ page }) => {
    await open(page, `${WIN}&tick=15&export=locked`);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const note = page.getByTestId('export-failed');
    await expect(note).toHaveCount(1);
    await note.getByRole('button', { name: 'Erneut versuchen' }).click();
    await runFinished(page);
    const started = await calls(page, 'start_run');
    expect((started.at(-1)?.[1] as { request: unknown }).request).toEqual({ kind: 'rescore' });
    // Still locked: the card keeps its fetch and says it once.
    await expect(page.getByTestId('run-finished')).toContainText('Abruf fertig');
    await expect(page.getByTestId('export-failed')).toHaveCount(1);
  });

  test('files that could not be written are no green success elsewhere', async ({ page }) => {
    await open(page, `${WIN}&tick=15&export=locked`);
    await page.getByTestId('fetch').click();
    await page.getByTestId('nav-settings').click();
    await runFinished(page);
    const toast = page.getByTestId('toast');
    await expect(toast.getByTestId('toast-text')).toHaveText(
      'Abruf fertig, die Dateien sind nicht aktuell.',
    );
    await expect(toast).not.toHaveClass(/success/);
    // The run card has the way; the toast leads there.
    await expect(toast.getByTestId('toast-action')).toHaveText('Zeigen');
  });

  test('a pause during a run is a calm note', async ({ page }) => {
    await open(page, `${WIN}&scenario=running`);
    // Its portal's line counts down, calm; no warning.
    await expect(page.getByTestId('countdown-freelance')).not.toHaveClass(/warns/);
    await expect(page.getByTestId('pause-freelance')).toHaveCount(0);
  });
});
