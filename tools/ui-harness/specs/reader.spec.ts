// The reader, one structure top to bottom (ui/src/features/jobs/reader-sections.ts): the title,
// the ring or the ban of an excluded job, the four actions and their "…" menu per place, the
// Jobdetails (the order and icons of lib/facts.ts, "/" for what the ad does not say, quiet
// notes, verdicts as icons whose tooltip is the reason), the Anforderungen (only requirements,
// a quiet count, "+" for a missing term), the ad as plain text with its one note and its
// passages tinted under the pointer, and the switch between two jobs. At the end what the
// reader's rounds of fixes carried around it (one column, the run card, the focus).
//
// The stub's demo profile: a minimum day rate of 1.100 € and a wish of 1.200 €, mostly remote,
// three to five days a week for at least six months, jobs that ask 15 years of experience or
// more, no temporary agency work. The page's clock stands at 24.09.2026 09:30.

import type { Locator, Page } from '@playwright/test';
import { DEMO, demoScore } from './demo';
import { calls, expect, open, runFinished, settle, test } from './fixtures';
import {
  chooseSort,
  lastQuery,
  openJob,
  openPlace,
  row,
  rows,
  settleMoves,
  stage,
  stubList,
  T,
  tokenColour,
  viaMenu,
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
  'Arbeitsmodell',
  'Vertragsart',
  'Tagessatz',
  'Start',
  'Laufzeit',
  'Auslastung',
  'Erfahrung',
  'Bewerbungsfrist',
  'Kontakt',
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

/** "…" of the open job: its entries (ids), then closed again. */
async function more(page: Page): Promise<string[]> {
  const { ids } = await moreMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
  return ids;
}

/** The moves the row of `key` shows under the pointer. */
async function toolsOf(page: Page, key: string): Promise<string[]> {
  await row(page, key).hover();
  const tools = page
    .getByTestId('job-list')
    .locator('.job', { has: page.getByTestId(`job-row-${key}`) })
    .locator('[data-testid^="tool-"]');
  await expect(tools.first()).toBeVisible();
  const ids = await tools.evaluateAll((all) =>
    all.map((tool) => (tool.getAttribute('data-testid') ?? '').slice(5)),
  );
  await page.mouse.move(0, 0);
  return ids;
}

/** The "…" of a job that just left the list opens nothing. */
async function moreOpensNothing(page: Page): Promise<void> {
  await stage(page).getByTestId('reader-more').click();
  await expect(page.getByTestId('menu')).toHaveCount(0);
  for (const id of ['archive', 'unarchive', 'trash', 'restore', 'purge']) {
    await expect(page.getByTestId(`menu-item-${id}`)).toHaveCount(0);
  }
}

/** Every job's details take this long to load (0: at once). */
async function slowDetails(page: Page, ms: number): Promise<void> {
  await page.evaluate((delay) => (window.__harness.detailDelay = delay), ms);
}

test.describe('the head and the match', () => {
  test('the title, then the ring with its band, then the buttons; the rest in Jobdetails', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    // No line of company, place, portal or day under the title: the Jobdetails have them.
    for (const id of ['reader-where', 'reader-company', 'reader-place', 'reader-source']) {
      await expect(stage(page).getByTestId(id)).toHaveCount(0);
    }
    const top = async (id: string): Promise<number> =>
      (await stage(page).getByTestId(id).boundingBox())!.y;
    expect(await top('reader-title')).toBeLessThan(await top('reader-match'));
    expect(await top('reader-match')).toBeLessThan(await top('reader-actions'));
    expect(await top('reader-actions')).toBeLessThan(await top('terms'));
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    expect(await cell(page, 'portal')).toEqual(['freelancermap.de, linkedin.com', '']);
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
    expect((await cell(page, 'place'))[0]).toBe('München');
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

  test('"Warum diese Zahl?": the ring opens what moved the score, Esc or a press outside closes it', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const ring = stage(page).getByTestId('reader-ring');
    const popover = page.getByTestId('menu');
    // A button named by its match; its tooltip says what it opens.
    await expect(ring).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(ring).toHaveAttribute('aria-expanded', 'false');
    expect(await tip(page, ring)).toBe(T.score.why);
    await ring.click();
    await expect(popover).toHaveAttribute('role', 'dialog');
    await expect(popover).toHaveAccessibleName(T.score.why);
    await expect(ring).toHaveAttribute('aria-expanded', 'true');
    // The engine's lines in their order, each with the icon of its verdict: here the musts,
    // the optional ones, the Schwerpunkte, the target role and the wishes.
    const factors = DEMO.details['freelancermap:2801']!.match!.factors;
    const lines = popover.locator('[data-testid^="menu-line-"]');
    expect(
      await lines.evaluateAll((all) => all.map((line) => line.getAttribute('data-testid'))),
    ).toEqual(factors.map((factor) => `menu-line-${factor.code}`));
    expect(factors.length).toBeGreaterThanOrEqual(3);
    expect(factors.length).toBeLessThanOrEqual(5);
    const musts = factors[0]!.params;
    await expect(lines.first()).toHaveText(
      T.score.factor.musts(Number(musts.met), Number(musts.partial), Number(musts.total)),
    );
    await expect(popover.getByTestId('menu-line-targetRole')).toHaveText(
      T.score.factor.role('Interim CFO', true),
    );
    const icon = (id: string) => popover.getByTestId(`menu-line-${id}`).locator('.reason > .icon');
    await expect(icon('targetRole')).toHaveCSS('color', await tokenColour(page, '--verdict-met'));
    // Nothing in it is chosen; Esc closes it.
    await expect(popover.locator('[role^="menuitem"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(ring).toHaveAttribute('aria-expanded', 'false');
    // From the keyboard: Enter opens it, Esc gives the focus back to the ring.
    await ring.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(ring).toBeFocused();
    // A press outside closes it.
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(popover).toHaveCount(0);
  });

  test('a cap and a permanent role say why the number stays low; no number, no button', async ({
    page,
  }) => {
    const line = (id: string) => page.getByTestId('menu').getByTestId(`menu-line-${id}`);
    // Several musts open: the cap is the last line, in the colour of a verdict not met.
    await openAt(page, 'freelancermap-2803');
    await stage(page).getByTestId('reader-ring').click();
    const cap = DEMO.details['freelancermap:2803']!.match!.factors.at(-1)!;
    expect(cap.code).toBe('cap');
    await expect(line('cap')).toHaveText(
      T.score.factor.cap(T.score.factor.capWhy.severalOpen, Number(cap.params.max)),
    );
    await expect(line('cap').locator('.reason > .icon')).toHaveCSS(
      'color',
      await tokenColour(page, '--verdict-unmet'),
    );
    await page.keyboard.press('Escape');
    // A permanent role.
    await openJob(page, 'linkedin-4100200303');
    await stage(page).getByTestId('reader-ring').click();
    await expect(line('permanent')).toHaveText(T.score.factor.permanent);
    await page.keyboard.press('Escape');
    // A ring without a number is no button.
    await openJob(page, 'freelancermap-2806');
    const ring = stage(page).getByTestId('reader-ring');
    await expect(ring).toHaveAttribute('role', 'img');
    await expect(ring).not.toHaveAttribute('aria-haspopup');
  });

  test('every line of "Warum diese Zahl?" is short, without colons or a full stop', async () => {
    const f = T.score.factor;
    const all = [
      f.musts(4, 2, 6),
      f.musts(1, 0, 1),
      f.nice(1, 2),
      f.focus(0, 3),
      f.focus(2, 3),
      f.focus(1, 1),
      f.role('Interim CFO', true),
      f.role('Interim CFO', false),
      f.noRole,
      f.wishesUp,
      f.wishesDown,
      ...Object.values(f.evidence),
      f.permanent,
      ...Object.values(f.capWhy).map((why) => f.cap(why, 40)),
    ];
    for (const words of all) expect(words, words).toMatch(/^[^:.!]+$/);
    expect(f.musts(4, 2, 6)).toBe('4 von 6 Pflichtanforderungen erfüllt, 2 teilweise');
    expect(f.cap(f.capWhy.formal, 40)).toBe('Formale Pflicht offen, deshalb höchstens 40');
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
    expect(menu.ids).toEqual(['unarchive', 'trash']);
    expect(menu.labels).toEqual([T.actions.unarchive, T.actions.trash]);
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

  test('the "…" names the moves of the place like the row, per place', async ({ page }) => {
    // Opening a job waits for every animation, the toast's of each move too.
    test.setTimeout(60_000);
    await open(page, WIN);
    // Two jobs in the Papierkorb (one toast: the moves merge).
    for (const key of ['freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    const places = [
      { place: 'inbox', key: 'freelancermap-2802', moves: ['archive', 'trash'] },
      { place: 'archive', key: 'linkedin-4100200306', moves: ['unarchive', 'trash'] },
      { place: 'trash', key: 'freelancermap-2803', moves: ['restore', 'purge'] },
    ] as const;
    for (const { place, key, moves } of places) {
      await openPlace(page, place);
      await openJob(page, key);
      expect(await more(page), place).toEqual([...moves]);
      expect(await toolsOf(page, key), place).toEqual([...moves]);
    }
    // An excluded job: "Trotzdem bewerten" before the moves of its place.
    await openPlace(page, 'inbox');
    const { excluded } = await stubList(page);
    await openJob(page, excluded[0]!);
    expect(await more(page)).toEqual(['include', 'archive', 'trash']);
  });

  test('a job that just moved away offers no moves while the next one loads', async ({ page }) => {
    // Opening a job waits for every animation, the toast's of each move too.
    test.setTimeout(60_000);
    await open(page, WIN);
    const best = 'Interim CFO für Familienunternehmen';
    // Löschen of the open job in the Eingang: while the next one loads the reader shows the
    // job that went to the Papierkorb, and its "…" never offers the moves of the Papierkorb
    // here.
    await openJob(page, 'freelancermap-2801');
    await settleMoves(page);
    await slowDetails(page, 1500);
    await moreMenu(page);
    await choose(page, 'trash');
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    await moreOpensNothing(page);
    // The next job of the Eingang: the Eingang's moves.
    await expect(stage(page).getByTestId('reader-title')).not.toHaveText(best, { timeout: 5000 });
    await slowDetails(page, 0);
    await settleMoves(page);
    expect(await more(page)).toEqual(['archive', 'trash']);
    // Rückgängig brings it back and opens it again: the Eingang's moves again.
    await page.getByTestId('toast-action').click();
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    await settleMoves(page);
    expect(await more(page)).toEqual(['archive', 'trash']);
    // Wiederherstellen of the open job in the Papierkorb: the same while the next one loads.
    await open(page, WIN);
    for (const key of ['freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
      await settleMoves(page);
    }
    await openPlace(page, 'trash');
    await openJob(page, 'freelancermap-2803');
    const next = await row(page, 'freelancermap-2804').locator('.title').innerText();
    await slowDetails(page, 1500);
    await moreMenu(page);
    await choose(page, 'restore');
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await moreOpensNothing(page);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(next, { timeout: 5000 });
    await slowDetails(page, 0);
    await settleMoves(page);
    expect(await more(page)).toEqual(['restore', 'purge']);
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
    await expect(page.getByTestId('toast').last()).toContainText('Prompt kopiert');
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
    const ban = stage(page).getByTestId('reader-ban').locator('svg');
    await expect(ban).toHaveCount(1);
    // The ban at the ring's size, where the ring of every other job stands.
    const size = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ring-md')),
    );
    expect(Math.round((await ban.boundingBox())!.width)).toBe(size);
    await expect(stage(page).getByTestId('band')).toHaveText('Ausgeschlossen');
    // Its first violation, once, from the profile's side; no box, no way into the ad.
    await expect(stage(page).getByTestId('exclusion')).toHaveText(
      T.reader.criterion.noAnue.exclusion,
    );
    await expect(stage(page).getByTestId('exclusion-box')).toHaveCount(0);
    await expect(stage(page).getByTestId('show-in-ad')).toHaveCount(0);
    // The rows that exclude it wear the ban, their tooltip says what the ad states.
    expect(await cell(page, 'contract')).toEqual(['Zeitarbeit', 'violated']);
    expect(await cell(page, 'experience')).toEqual([
      `3 Jahre ${T.reader.yearsBelow(15)}`,
      'violated',
    ]);
    for (const key of ['contract', 'experience']) {
      const verdict = term(page, key).getByTestId('verdict').locator('.reason');
      await expect(verdict).toHaveAttribute('data-kind', 'violation');
      await expect(verdict).toHaveAttribute('aria-label', T.score.excluded);
    }
    expect(await verdictTip(page, 'contract')).toBe(T.reason.code.anue);
    await expect(why(page)).not.toContainText('Zeitarbeit');
    // Trotzdem bewerten: its real match, a toast that takes it back, and the way back in "…".
    // The same entries in the same order as the row's menu (one table, actions.ts).
    let menu = await moreMenu(page);
    expect(menu.ids).toEqual(['include', 'archive', 'trash']);
    expect(menu.labels[0]).toBe(T.actions.include);
    await choose(page, 'include');
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelance', id: '900412' },
      include: true,
    });
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText(T.toast.included);
    await expect(toast.getByTestId('toast-action')).toHaveText('Rückgängig');
    await expect(stage(page).getByTestId('reader-ring')).toBeVisible();
    await expect(stage(page).getByTestId('reader-ban')).toHaveCount(0);
    menu = await moreMenu(page);
    expect(menu.ids).toEqual(['exclude', 'archive', 'trash']);
    expect(menu.labels[0]).toBe(T.actions.exclude);
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
    // No row judges an exclusion word: the head says the word.
    await expect(stage(page).getByTestId('exclusion')).toHaveText(
      T.reason.code.exclusionWord({ word: 'Werkstudent' }),
    );
    await expect(why(page)).not.toContainText('Ausschlusswörter');
  });

  test('a country outside the profile: the head says it from the profile, the row the place', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200305');
    await expect(stage(page).getByTestId('exclusion')).toHaveText(
      T.reader.criterion.countries.exclusion,
    );
    const tip = await verdictTip(page, 'place');
    expect(tip).toBe(T.reason.code.country({ allowed: 'DE, AT' }));
    expect(tip).not.toBe(T.reader.criterion.countries.exclusion);
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
    // The day rate with how it stands to the profile's minimum of 1.100 €.
    expect(await cell(page, 'rate')).toEqual([
      words(`1.200 €/Tag ${T.reader.versusMinimum(9)}`),
      'met',
    ]);
    expect(await cell(page, 'start')).toEqual(['ab sofort', 'met']);
    expect(await cell(page, 'duration')).toEqual(['6 Monate', 'met']);
    // The ad says nothing of its workload, and nothing judges it.
    expect(await cell(page, 'workload')).toEqual(['/', '']);
    expect(await cell(page, 'portal')).toEqual(['freelancermap.de, linkedin.com', '']);
    // The day of the alert mail in the list row's words.
    expect(await cell(page, 'received')).toEqual(['07:30', '']);
    // Verdicts are icons (no words), the reason that decided one in its tooltip; one no
    // reason decided names itself.
    await expect(terms(page)).not.toContainText('passt');
    expect(await verdictTip(page, 'rate')).toBe(
      'Der Tagessatz von 1.200 € erreicht den Wunsch von 1.200 €.',
    );
    await expect(term(page, 'rate').getByTestId('verdict').locator('.reason')).toHaveAttribute(
      'aria-label',
      'Erfüllt',
    );
    for (const key of ['contract', 'start', 'duration']) {
      expect(await verdictTip(page, key), key).toBe(T.reader.verdict.met);
    }
  });

  test('the verdicts in the colours of the rings, muted, the ban where a row excludes the job', async ({
    page,
  }) => {
    const icon = (page: Page, key: string) =>
      term(page, key).getByTestId('verdict').locator('.reason > .icon');
    const look = async (page: Page, key: string): Promise<[string, string]> => [
      await icon(page, key).evaluate((node) => getComputedStyle(node).color),
      await icon(page, key).evaluate(
        (node) => node.querySelector('svg')?.getAttribute('class') ?? '',
      ),
    ];
    await openAt(page, 'freelancermap-2804');
    const met = await look(page, 'workload');
    const unknown = await look(page, 'start');
    expect(await cell(page, 'start')).toEqual(['nach Absprache', 'unknown']);
    expect(met[0]).toBe(await tokenColour(page, '--verdict-met'));
    expect(unknown[0]).toBe(await tokenColour(page, '--text-muted'));
    await openJob(page, 'freelance-900413');
    const partial = await look(page, 'workload');
    expect(partial[0]).toBe(await tokenColour(page, '--verdict-partial'));
    // Met in part: the amber minus in a circle.
    expect(partial[1]).toContain('lucide-circle-minus');
    await openJob(page, 'freelance-900412');
    const excludes = await look(page, 'contract');
    expect(excludes[0]).toBe(await tokenColour(page, '--verdict-unmet'));
    expect(excludes[1]).toContain('lucide-ban');
    // One glyph per verdict.
    expect(new Set([met[1], unknown[1], partial[1], excludes[1]]).size).toBe(4);
  });

  test('the verdicts stand right after the widest judged value, in the requirements metrics', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const boxes = await terms(page).evaluate((list) =>
      [...list.querySelectorAll('li')].map((li) => {
        const line = li.querySelector('.term-line')!;
        return {
          key: li.getAttribute('data-row'),
          value: line.getBoundingClientRect().right,
          span: getComputedStyle(line).gridColumnEnd,
          verdict:
            li.querySelector('[data-testid="verdict"]')?.getBoundingClientRect().left ?? null,
        };
      }),
    );
    const judged = boxes.filter((box) => box.verdict !== null);
    const column = judged[0]!.verdict!;
    expect(new Set(judged.map((box) => Math.round(box.verdict!))).size).toBe(1);
    const widest = Math.max(...judged.map((box) => box.value));
    const gap = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-24')),
    );
    expect(Math.round(column - widest)).toBeLessThanOrEqual(gap);
    // A value without a verdict (the company, the portals) takes the verdict's column too, so
    // it never pushes the verdicts away.
    for (const box of boxes) expect(box.span, box.key ?? '').toBe(box.verdict ? 'auto' : '-1');
    // One metric with the requirements: their text and their icon gap.
    const [termFont, termGap] = await terms(page)
      .locator('.term-name')
      .first()
      .evaluate((node) => [getComputedStyle(node).fontSize, getComputedStyle(node).columnGap]);
    const [reasonFont, reasonGap] = await why(page)
      .locator('.reason')
      .first()
      .evaluate((node) => [getComputedStyle(node).fontSize, getComputedStyle(node).columnGap]);
    expect([termFont, termGap]).toEqual([reasonFont, reasonGap]);
  });

  test('Bewerbungsfrist and Kontakt: red within a week, the e-mail writes a mail, the rest copies', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const danger = await tokenColour(page, '--danger-strong');
    const colour = (key: string) =>
      term(page, key)
        .locator('.value')
        .first()
        .evaluate((node) => getComputedStyle(node).color);
    expect(await cell(page, 'deadline')).toEqual(['15.10.', '']);
    expect(await colour('deadline')).not.toBe(danger);
    // Name, e-mail and phone one under the other; the name and the phone copy.
    await expect(term(page, 'contact').locator('.parts > *')).toHaveText([
      'Julia Brandt',
      'julia.brandt@hanseatic.example',
      '+49 40 5550 1234',
    ]);
    const parts = term(page, 'contact').locator('.value');
    await expect(parts).toHaveText(['Julia Brandt', '+49 40 5550 1234']);
    for (const part of await parts.all()) await expect(part).toHaveAttribute('data-copy', '');
    await expect(term(page, 'contact').getByTestId('verdict')).toHaveCount(0);
    // The e-mail is a link: a new mail to it in the mail program, one line high.
    const mail = term(page, 'contact').getByTestId('contact-mail');
    await expect(mail).toHaveClass(/link/);
    await mail.click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'contactMail', key: { portal: 'freelancermap', id: '2801' } },
    });
    const [name, phone] = await parts.evaluateAll((all) =>
      all.map((node) => node.getBoundingClientRect()),
    );
    expect(Math.abs(phone!.top - name!.top - 2 * name!.height)).toBeLessThanOrEqual(1);
    // Four days ahead: red. An e-mail address alone is the contact.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'deadline')).toEqual(['28.09.', '']);
    expect(await colour('deadline')).toBe(danger);
    await expect(term(page, 'contact').getByTestId('contact-mail')).toHaveText(
      'jobs@gruenwerk.example',
    );
    // An ad that names neither.
    await openJob(page, 'freelancermap-2804');
    expect(await cell(page, 'deadline')).toEqual(['/', '']);
    expect(await cell(page, 'contact')).toEqual(['/', '']);
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
    // Near the wish, 5 % over the minimum.
    expect(await cell(page, 'rate')).toEqual([
      words(`1.150 €/Tag ${T.reader.versusMinimum(5)}`),
      'partial',
    ]);
    expect(await cell(page, 'mode')).toEqual(['Vor Ort', 'partial']);
    expect(await cell(page, 'place')).toEqual(['München', 'partial']);
    // A limit missed is met in part; a rate to be agreed has nothing to judge, nor a note.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'duration')).toEqual(['3 Monate', 'partial']);
    expect(await verdictTip(page, 'duration')).toBe(
      'Die Laufzeit von 3 Monaten liegt unter dem Minimum von 6 Monaten.',
    );
    expect(await cell(page, 'rate')).toEqual(['nach Absprache', '']);
    expect(await cell(page, 'workload')).toEqual(['Vollzeit', 'met']);
    // One case in the row: "Voll remote" like "Vor Ort" and "Hybrid".
    expect(await cell(page, 'mode')).toEqual([T.facts.mode.remote, 'met']);
    expect(T.facts.mode.remote).toBe('Voll remote');
    // A hybrid job without a share: its mode in the one set of words.
    await openJob(page, 'linkedin-4100200302');
    expect((await cell(page, 'mode'))[0]).toBe('Hybrid');
    // Said in the rows, not again among the requirements.
    await openJob(page, 'freelancermap-2802');
    await expect(why(page)).not.toContainText('liegt unter dem Minimum');
  });

  test('Erfahrung judges the years, the requirement that names them keeps its skill', async ({
    page,
  }) => {
    // The years the ad asks are the profile's target: the row is met. The requirement is met
    // in part (its Controlling only in general): it says so among the Anforderungen.
    await openAt(page, 'freelancermap-2801');
    expect(await cell(page, 'experience')).toEqual(['15 Jahre', 'met']);
    expect(await verdictTip(page, 'experience')).toBe(T.reader.verdict.met);
    await expect(why(page).getByTestId('reasons-partial')).toContainText(
      'Mindestens 15 Jahre Berufserfahrung im Controlling',
    );
    // Ten years for a profile that looks for 15 or more: met in part, the note says which
    // way; the requirement's own field the profile lacks stands under "Nicht erfüllt".
    await openJob(page, 'linkedin-4100200304');
    expect(await cell(page, 'experience')).toEqual([
      `10 Jahre ${T.reader.yearsBelow(15)}`,
      'partial',
    ]);
    expect(await verdictTip(page, 'experience')).toBe(
      T.reason.code.overqualified({ years: 10, target: 15 }),
    );
    await expect(why(page).getByTestId('reasons-open')).toContainText(
      'Mindestens 10 Jahre Berufserfahrung im Rechnungswesen',
    );
  });

  test('a permanent job: its salary, no end, the contract met', async ({ page }) => {
    await openAt(page, 'linkedin-4100200303');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names[4]).toBe('Gehalt');
    expect(await cell(page, 'rate')).toEqual(['95.000 €/Jahr', '']);
    expect(await cell(page, 'duration')).toEqual(['unbefristet', '']);
    // The ad states the type and the profile takes permanent jobs: met, not "unklar".
    expect(await cell(page, 'contract')).toEqual(['Festanstellung', 'met']);
    expect(await cell(page, 'experience')).toEqual(['/', '']);
  });

  test('an ad the app never read in full shows only what it knows', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(['Unternehmen', 'Ort', 'Arbeitsmodell', 'Portal', 'Eingegangen']);
    await expect(terms(page)).not.toContainText('/');
    // A preview: no "/" claims the ad says nothing.
    await openJob(page, 'freelance-900411');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual([
      'Unternehmen',
      'Ort',
      'Arbeitsmodell',
      'Vertragsart',
      'Portal',
      'Eingegangen',
    ]);
    await expect(terms(page).locator('.value.missing')).toHaveCount(0);
  });

  test('a job the engine could not score shows no verdicts', async ({ page }) => {
    await openAt(page, 'freelancermap-2806');
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.none);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    await expect(why(page)).toHaveCount(0);
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
    expect(titles).toEqual(['Erfüllt 5', 'Teilweise erfüllt 2', 'Nicht erfüllt 1']);
    // No title, wish or Schwerpunkt, no line of the profile's words.
    for (const said of ['Wunschrolle', 'Schwerpunkt', 'Tagessatz', 'im Profil']) {
      await expect(why(page)).not.toContainText(said);
    }
    // The icons of the verdicts; a group's heading is not said again under the pointer.
    for (const [kind, token] of [
      ['met', '--verdict-met'],
      ['partial', '--verdict-partial'],
      ['open', '--verdict-unmet'],
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

  test('a missing must that is a term goes into its field of the profile with "+", a sentence has none', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2802');
    const missing = why(page).getByTestId('reasons-open').locator('li', {
      hasText: 'Branchenerfahrung Energie',
    });
    await expect(missing).toHaveCount(1);
    // The "+" names the term and the field it goes into: the industry "Energie".
    const add = missing.getByTestId('add-to-profile');
    await expect(add).toHaveAccessibleName(T.reader.addTo.industry('Energie'));
    expect(await tip(page, add)).toBe(T.reader.addTo.industry('Energie'));
    // An optional one has none.
    await expect(
      why(page)
        .getByTestId('reasons-open')
        .locator('li', { hasText: 'Französisch' })
        .getByTestId('add-to-profile'),
    ).toHaveCount(0);
    await add.click();
    // A quiet tick takes the place of the "+", no word; the toast says it, with the term
    // alone (without the ad's "Branchenerfahrung").
    const added = missing.getByTestId('added');
    await expect(added).toHaveAttribute('aria-label', T.reader.added);
    await expect(added.locator('svg')).toHaveCount(1);
    await expect(added).toHaveText('');
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText(T.reader.addedToProfile('Energie'));
    // The term is among the profile's industries, saved; not among its keywords.
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-industries')).toContainText('Energie');
    await expect(page.getByTestId('profile-industries')).not.toContainText('Branchenerfahrung');
    await expect(page.getByTestId('profile-keywords')).not.toContainText('Energie');
    await expect(page.getByTestId('profile-save-bar')).toHaveCount(0);
    // The toast takes it back.
    await page.getByTestId('nav-jobs').click();
    await page.getByTestId('toast').last().getByTestId('toast-action').click();
    await expect(missing.getByTestId('add-to-profile')).toBeVisible();
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-industries')).not.toContainText('Energie');
    // The other bullets lose their lead words too, and go into their own field: the tool
    // "Anaplan" into the tools.
    await page.getByTestId('nav-jobs').click();
    const anaplan = why(page).getByTestId('reasons-open').locator('li', {
      hasText: 'Kenntnisse in Anaplan',
    });
    await expect(anaplan.getByTestId('add-to-profile')).toHaveAccessibleName(
      T.reader.addTo.tool('Anaplan'),
    );
    await anaplan.getByTestId('add-to-profile').click();
    await expect(page.getByTestId('toast').last()).toContainText(
      T.reader.addedToProfile('Anaplan'),
    );
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-tools')).toContainText('Anaplan');
    await expect(page.getByTestId('profile-keywords')).not.toContainText('Anaplan');
    // A requirement the ad words as a sentence cannot go into the profile.
    await page.getByTestId('nav-jobs').click();
    await openJob(page, 'freelancermap-2804');
    const sentence = why(page).getByTestId('reasons-open').locator('li').first();
    await expect(sentence).toContainText('Kenntnisse in Anaplan helfen dabei');
    await expect(sentence.getByTestId('add-to-profile')).toHaveCount(0);
  });
});

test.describe('the ad', () => {
  /** The words of the passages that are tinted now. */
  const lit = (page: Page): Promise<string[]> =>
    stage(page)
      .getByTestId('ad-text')
      .locator('mark.lit')
      .evaluateAll((all) => all.map((mark) => mark.textContent ?? ''));

  /** Longer than the reader rests after a scroll before a hover counts again. */
  const REST = 300;

  /** Whether a node stands whole in the window. */
  const isInViewport = (target: Locator): Promise<boolean> =>
    target.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    });

  /** Move the pointer onto a node (twice: only a pointer that moves counts). */
  async function pointAt(page: Page, target: Locator): Promise<void> {
    // Into view first, and a hover waits until the reader rests after a scroll.
    if (!(await target.isVisible()) || !(await isInViewport(target))) {
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(REST);
    }
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
  }

  test('plain text, its passages untinted until a row or a requirement is hovered', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const text = stage(page).getByTestId('ad-text');
    await expect(text).toContainText('Reporting nach IFRS');
    await expect(text).toHaveAttribute('data-copy', '');
    // No underline, no colour, no tooltip, nothing to press.
    const mark = text.locator('mark').first();
    expect(
      await mark.evaluate((node) => [
        getComputedStyle(node).textDecorationLine,
        getComputedStyle(node).backgroundColor,
      ]),
    ).toEqual(['none', 'rgba(0, 0, 0, 0)']);
    await expect(stage(page).locator('.jump, button.chip, button.reason')).toHaveCount(0);
    await expect(stage(page).getByTestId('detail-note')).toHaveCount(0);
    expect(await lit(page)).toEqual([]);
  });

  test('hovering tints the passages, leaving takes them away, a click brings them and flashes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 700 });
    await openAt(page, 'freelancermap-2801');
    const soft = await tokenColour(page, '--info-soft');
    // A row of the Jobdetails: its passage in the ad takes the soft tint.
    await pointAt(page, term(page, 'rate'));
    await expect.poll(() => lit(page)).toEqual(['Tagessatz 1.200 €, Einsatz zu 60 % remote.']);
    const tinted = stage(page).getByTestId('ad-text').locator('mark.lit');
    await expect(tinted).toHaveCSS('background-color', soft);
    // Away from it: gone.
    await pointAt(page, stage(page).getByTestId('terms').locator('h2'));
    await expect.poll(() => lit(page)).toEqual([]);
    // A requirement.
    await pointAt(page, why(page).locator('li', { hasText: 'Reporting nach IFRS' }));
    await expect.poll(() => lit(page)).toEqual(['Reporting nach IFRS']);
    // A click on a row brings its passage into view and flashes it once.
    const pane = stage(page).getByTestId('ad-text');
    await term(page, 'experience').click();
    const flash = pane.locator('mark.flash');
    await expect(flash).toHaveText('Mindestens 15 Jahre Berufserfahrung im Controlling');
    await expect(flash).toBeInViewport();
    await expect(flash).toHaveCount(0);
    // A row without passages does nothing.
    await pointAt(page, term(page, 'company'));
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => lit(page)).toEqual([]);
    await expect(pane.locator('mark.flash')).toHaveCount(0);
  });

  test('no tint stays after the pointer moved across several rows, nor while it scrolls', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const items = (): Promise<string[]> =>
      stage(page)
        .getByTestId('ad-text')
        .locator('mark.lit')
        .evaluateAll((all) => all.map((mark) => mark.getAttribute('data-items') ?? ''));
    for (const key of ['contract', 'rate', 'start', 'duration', 'experience']) {
      await pointAt(page, term(page, key));
      // Only the passages of the row under the pointer.
      await expect
        .poll(async () => {
          const now = await items();
          return now.length > 0 && now.every((item) => item.split(' ').includes(`row:${key}`));
        }, key)
        .toBe(true);
    }
    await pointAt(page, stage(page).getByTestId('reader-title'));
    await expect.poll(() => lit(page)).toEqual([]);
    // The reader scrolls under a still pointer: the row that comes under it takes no tint.
    await pointAt(page, term(page, 'rate'));
    await expect.poll(async () => (await lit(page)).length).toBeGreaterThan(0);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => lit(page)).toEqual([]);
    await page.waitForTimeout(400);
    expect(await lit(page)).toEqual([]);
  });

  test('the ad in its structure: headings, lists without their glyphs, paragraphs', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const text = stage(page).getByTestId('ad-text');
    const headings = text.getByTestId('ad-heading');
    await expect(headings).toHaveText(['Ihre Aufgaben', 'Ihr Profil', 'Wünschenswert', 'Rahmen']);
    // Small and bold: the text's size, a heavier weight.
    const [weight, size] = await headings
      .first()
      .evaluate((node) => [getComputedStyle(node).fontWeight, getComputedStyle(node).fontSize]);
    expect(Number(weight)).toBeGreaterThanOrEqual(600);
    expect(size).toBe(await text.evaluate((node) => getComputedStyle(node).fontSize));
    // The bullets are an indented list; the ad's glyphs are gone.
    const items = text.getByTestId('ad-item');
    await expect(items).toHaveCount(10);
    await expect(items.first()).toHaveText('Führung eines Teams von sechs Personen');
    expect(await items.first().evaluate((node) => getComputedStyle(node).display)).toBe(
      'list-item',
    );
    const indent = async (target: Locator): Promise<number> => (await target.boundingBox())!.x;
    expect(await indent(items.first())).toBeGreaterThan(await indent(headings.first()));
    expect(await text.innerText()).not.toContain('•');
    // A line with a date is no heading, whatever its first word.
    await expect(text.locator('p').last()).toContainText('Bewerbungsfrist 15.10.2026');
    // One text to copy, its passages where they were.
    await expect(text).toHaveAttribute('data-copy', '');
    await expect(text.locator('mark[data-items]').first()).toBeAttached();
  });

  test('the words of the list search stand marked in the ad while the search is on', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const search = page.getByTestId('search');
    // Words the job is found by: each in the ad, case aside.
    await search.fill('interim cfo');
    await expect(rows(page)).toHaveCount(1);
    const hits = stage(page).getByTestId('ad-text').locator('mark.hit');
    await expect(hits).toHaveText(['Interim', 'CFO', 'Interim', 'Interim']);
    await expect(hits.first()).toHaveCSS(
      'background-color',
      await tokenColour(page, '--mark-search'),
    );
    await search.fill('');
    await expect(hits).toHaveCount(0);
  });

  test('a preview says so once, here, with the way to its sign-in', async ({ page }) => {
    await openAt(page, 'freelance-900411');
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.adNote.teaser);
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text.split('Vorschau').length - 1).toBe(1);
    await expect(stage(page).getByTestId('preliminary')).toHaveCount(0);
    // The same height as the reader's other buttons.
    const signIn = stage(page).getByTestId('set-up-sign-in');
    expect((await signIn.boundingBox())!.height).toBe(
      (await stage(page).getByTestId('reader-more').boundingBox())!.height,
    );
    await signIn.click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
    // Einstellungen at the row of freelance.de: in view, its sign-in focused, the row lit up
    // once in the soft tint, then settled.
    const portalRow = page.getByTestId('portal-freelance');
    await expect(portalRow).toBeInViewport();
    await expect(page.getByTestId('sign-in-freelance')).toBeFocused();
    await expect(portalRow).toHaveAttribute('data-flash', 'on');
    await expect(portalRow).toHaveCSS('background-color', await tokenColour(page, '--info-soft'));
    await expect(portalRow).not.toHaveAttribute('data-flash');
    await expect(portalRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('a missing ad: "Anzeige laden" loads it, meanwhile it is being loaded', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.missing);
    const load = stage(page).getByTestId('load-ad');
    await expect(load).toHaveText('Anzeige laden');
    const height = (await note.locator('..').boundingBox())!.height;
    await load.click();
    expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
      kind: 'details',
      keys: [{ portal: 'linkedin', id: '4100200302' }],
    });
    // A spinner where the note's icon stood, the line as high as before.
    await expect(note).toHaveText(T.reader.adNote.loading);
    await expect(note.locator('.spinner')).toHaveCount(1);
    await expect(load).toHaveCount(0);
    expect((await note.locator('..').boundingBox())!.height).toBe(height);
    // Once the ad is there, its note goes.
    await runFinished(page);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
    await expect(stage(page).getByTestId('detail-note')).toHaveCount(0);
    // An ad that could not be fetched is not being loaded while nothing loads it.
    await openJob(page, 'freelancermap-2805');
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.adNote.missing);
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
  });

  test('what arrives later fades in: the ad, its rows, its requirements', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    // Every frame from the click on: the lowest opacity the requirements showed.
    await page.evaluate(() => {
      const seen = { least: 2 };
      (window as unknown as { __fade: typeof seen }).__fade = seen;
      const until = performance.now() + 4000;
      const look = (): void => {
        const why = document.querySelector<HTMLElement>('[data-testid="why"]');
        if (why) seen.least = Math.min(seen.least, Number(getComputedStyle(why).opacity));
        if (performance.now() < until) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await stage(page).getByTestId('load-ad').click();
    await expect(why(page)).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);
    const seen = await page.evaluate(
      () => (window as unknown as { __fade: { least: number } }).__fade,
    );
    expect(seen.least).toBeLessThan(1);
  });

  test('a closed ad says so in the ad section as a warning, nothing in the head', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200304');
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.closed);
    await expect(note).toHaveClass(/warning/);
    await expect(stage(page).locator('.head')).not.toContainText('Bewerbung');
  });

  test('an ad no longer online: its button says so and still opens it, the Jobdetails once', async ({
    page,
  }) => {
    // Closed: since the day the app read the closed page.
    await openAt(page, 'linkedin-4100200304');
    const openAd = stage(page).getByTestId('open-ad');
    await expect(openAd).toHaveText(T.reader.openOffline);
    await openAd.click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'linkedin', id: '4100200304' } },
    });
    const note = term(page, 'portal').locator('.term-note');
    await expect(note).toHaveText(new RegExp(`^${T.reader.offlineSince('\\d\\d\\.\\d\\d\\.')}$`));
    await expect(terms(page).getByText(T.reader.offline, { exact: false })).toHaveCount(1);
    // Gone, the day unknown.
    await page.evaluate(() => window.__harness.gone({ portal: 'linkedin', id: '4100200302' }));
    await openJob(page, 'linkedin-4100200302');
    await expect(stage(page).getByTestId('open-ad')).toHaveText(T.reader.openOffline);
    await expect(term(page, 'portal').locator('.term-note')).toHaveText(T.reader.offline);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.adNote.gone);
    // An ad that is online says nothing of it.
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('open-ad')).toHaveText(T.reader.open);
    await expect(term(page, 'portal').locator('.term-note')).toHaveCount(0);
  });

  test('every note of the ad is one short sentence', async () => {
    for (const note of Object.values(T.reader.adNote)) expect(note).toMatch(/^[^.]+\.$/);
    expect(T.reader.adNote.missing).not.toContain('Anzeige');
  });
});

test('while a job loads, the reader stands in its shape as placeholders', async ({ page }) => {
  await open(page, WIN);
  await settle(page);
  await slowDetails(page, 1500);
  await row(page, 'freelancermap-2801').click();
  const skeleton = stage(page).getByTestId('reader-skeleton');
  await expect(skeleton).toBeVisible();
  // The title, the ring, the actions, rows of the Jobdetails and lines of the ad.
  await expect(skeleton.getByTestId('skeleton-title')).toBeVisible();
  await expect(skeleton.locator('.skeleton.circle')).toHaveCount(1);
  expect(await skeleton.getByTestId('skeleton-row').count()).toBeGreaterThanOrEqual(4);
  expect(await skeleton.getByTestId('skeleton-line').count()).toBeGreaterThanOrEqual(4);
  const placeholder = (await skeleton.getByTestId('skeleton-title').boundingBox())!;
  // The job takes its place: its title starts where the placeholder's did.
  await expect(stage(page).getByTestId('reader-title')).toBeVisible({ timeout: 5000 });
  await expect(stage(page).getByTestId('reader-skeleton')).toHaveCount(0);
  const title = (await stage(page).getByTestId('reader-title').boundingBox())!;
  expect(Math.abs(placeholder.x - title.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(placeholder.y - title.y)).toBeLessThanOrEqual(8);
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
    await chooseSort(page, 'newest');
    const key = { portal: 'linkedin', id: '100006' } as const;
    const title = (await page.evaluate((k) => window.__harness.job(k), key))!.title;
    await row(page, 'linkedin-100006').click();
    await expect(page.getByTestId('reader-title')).toHaveText(title);
    await chooseSort(page, 'match');
    // Its title without the number: every fourth job of the scenario is a hit.
    const search = title.replace(/ \d+$/, '');
    await page.getByTestId('search').fill(search);
    await expect.poll(async () => (await lastQuery(page))?.search).toBe(search);
    await page.waitForTimeout(400);
    await expect(page.getByTestId('reader-title')).toHaveText(title);
  });

  test('an empty trash shows one empty state in the list, the reader nothing beside it', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=empty`);
    await page.getByTestId('place-trash').click();
    await expect(page.getByTestId('empty-place-trash')).toHaveText(T.place.empty.trash);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
  });

  test('a locked Excel file is written again without reading the mailbox', async ({ page }) => {
    await open(page, `${WIN}&tick=15&export=locked`);
    await page.getByTestId('fetch').click();
    await runFinished(page);
    const note = page.getByTestId('run-problem');
    await expect(note).toContainText(T.run.exportFailed.overviewLocked);
    await note.getByTestId('run-retry').click();
    await runFinished(page);
    const started = await calls(page, 'start_run');
    expect((started.at(-1)?.[1] as { request: unknown }).request).toEqual({ kind: 'rescore' });
    // Still locked: the line says it once more, once.
    await expect(page.getByTestId('run-problem')).toHaveCount(1);
    await expect(page.getByTestId('run-problem')).toContainText(T.run.exportFailed.overviewLocked);
  });

  test('files that could not be written are no green success elsewhere', async ({ page }) => {
    await open(page, `${WIN}&tick=15&export=locked`);
    await page.getByTestId('fetch').click();
    await page.getByTestId('nav-settings').click();
    await runFinished(page);
    const toast = page.getByTestId('toast');
    await expect(toast.getByTestId('toast-text')).toHaveText(/./);
    await expect(toast).not.toHaveClass(/success/);
    // The run line has the way; the toast leads there.
    await expect(toast.getByTestId('toast-action')).toHaveText(T.toast.show);
    await toast.getByTestId('toast-action').click();
    await expect(page.getByTestId('run-problem')).toContainText(T.run.exportFailed.overviewLocked);
  });
});
