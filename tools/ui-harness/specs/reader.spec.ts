// The job view, its cards top to bottom (ui/src/features/jobs/reader-sections.ts): the hero
// (the ring or the ban of an excluded job beside the title and its band, the moves of the
// place at the end of the title's first line, the state box, the buttons that show the job), the Jobdetails
// (the order of lib/facts.ts, the value and the verdict only, two columns), the Anforderungen
// (only requirements, "x von N erfüllt", one flat list, "+" for a missing term), the ad as
// plain text (nothing in it marked by the facts above), and the switch between two jobs. At
// the end what the job view's rounds of fixes carried around it (one column, the focus).
//
// The stub's demo profile: a minimum day rate of 1.100 € and a wish of 1.200 €, mostly remote,
// three to five days a week for at least six months, 20 years of experience (Controlling 18),
// no temporary agency work. The page's clock stands at 24.09.2026 09:30.

import type { Locator, Page } from '@playwright/test';
import { demoScore } from './demo';
import { animationsDone, calls, expect, open, runFinished, settle, test } from './fixtures';
import {
  chooseSort,
  failNext,
  listed,
  openJob,
  openPlace,
  row,
  rows,
  setToken,
  stage,
  stubList,
  T,
  viaMenu,
  WIN,
} from './helpers';

/** The score of the best job, the first row of the list (freelancermap-2801). */
const BEST = String(demoScore('freelancermap-2801'));

const terms = (page: Page) => stage(page).getByTestId('criteria');
const term = (page: Page, key: string) => terms(page).getByTestId(`term-${key}`);
const why = (page: Page) => stage(page).getByTestId('why');

/** The names of rows of the Jobdetails. */
const named = (...keys: (keyof typeof T.reader.term)[]): string[] =>
  keys.map((key) => T.reader.term[key]);

/** The rows of the Jobdetails in the order of the facts table (lib/facts.ts). */
const ROWS = named(
  'company',
  'place',
  'mode',
  'contract',
  'rate',
  'start',
  'duration',
  'workload',
  'experience',
  'deadline',
  'portal',
  'contact',
);

/** "Gefunden" of the best job: its portals, then the moment it came into CXact. */
const FOUND = `${T.reader.found([T.portal.freelancermap, T.portal.linkedin])}, 08:24`;

/** Start the app and open a job of the one list. */
async function openAt(page: Page, key: string, query = WIN): Promise<void> {
  await open(page, query);
  await openJob(page, key);
}

const words = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The value of a row of the Jobdetails and its verdict ('' without one); a row that fits
 *  carries no mark, one that does not fully fit its verdict's. */
async function cell(page: Page, key: string): Promise<[string, string]> {
  const target = term(page, key);
  const verdict = (await target.getAttribute('data-verdict')) ?? '';
  const mark = target.getByTestId('verdict');
  await expect(mark).toHaveCount(verdict === '' || verdict === 'met' ? 0 : 1);
  return [words(await target.locator('.term-line').textContent()), verdict];
}

/** The words of the tooltip of a node under the pointer. */
async function tip(page: Page, target: Locator): Promise<string> {
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await target.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const said = words(await tooltip.textContent());
  await page.mouse.move(0, 0);
  return said;
}

/** Where each line of a node's text ends, top to bottom (its box says nothing of that: a float
 *  beside the text lies inside it). */
function lineEnds(target: Locator): Promise<number[]> {
  return target.evaluate((node) => {
    const text = document.createRange();
    text.selectNodeContents(node);
    const lines = new Map<number, number>();
    for (const box of text.getClientRects()) {
      const top = Math.round(box.top);
      lines.set(top, Math.max(lines.get(top) ?? 0, box.right));
    }
    return [...lines.keys()].sort((a, b) => a - b).map((top) => lines.get(top)!);
  });
}

/** The moves of the head (their ids, their names). */
async function headTools(page: Page): Promise<{ ids: string[]; labels: string[] }> {
  const tools = stage(page).getByTestId('reader-tools').locator('.btn');
  await expect(tools.first()).toBeVisible();
  const ids = await tools.evaluateAll((all) =>
    all.map((tool) => (tool.getAttribute('data-testid') ?? '').replace('reader-', '')),
  );
  const labels = await tools.evaluateAll((all) =>
    all.map((tool) => tool.getAttribute('aria-label') ?? ''),
  );
  return { ids, labels };
}

/** The moves of the open job's head (ids). */
async function moves(page: Page): Promise<string[]> {
  return (await headTools(page)).ids;
}

/** A move of the open job's head. */
async function choose(page: Page, id: string): Promise<void> {
  await stage(page).getByTestId(`reader-${id}`).click();
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

/** The moves of a job on its way out take no press and keep their look (a look of their own would
 *  flicker for that moment). */
async function movesLocked(page: Page): Promise<void> {
  const sent = async (): Promise<number> =>
    (await calls(page)).filter(([name]) => /^(move|restore|purge)_jobs$/.test(name)).length;
  const before = await sent();
  const title = stage(page).getByTestId('reader-title');
  const shown = await title.innerText();
  const tools = stage(page).getByTestId('reader-tools').locator('.btn');
  await expect(tools).toHaveCount(2);
  for (const tool of await tools.all()) {
    expect(await tool.getAttribute('aria-disabled')).toBeNull();
    await tool.click();
  }
  // Still the same job: the presses went to its tools, not to the next job's.
  await expect(title).toHaveText(shown);
  expect(await sent()).toBe(before);
  await expect(page.getByTestId('dialog-purge')).toHaveCount(0);
}

/** Every job's details take this long to load (0: at once). */
async function slowDetails(page: Page, ms: number): Promise<void> {
  await page.evaluate((delay) => (window.__harness.detailDelay = delay), ms);
}

/** The job view keeps the job it shows while the next one loads, however long that takes, so a
 *  test can press in it (--delay-placeholder). */
const noPlaceholder = (page: Page): Promise<void> =>
  setToken(page, '--delay-placeholder', '60000ms');

test.describe('the head and the match', () => {
  test('the hero: the ring beside the title and its band, the buttons under a hairline; the rest in Jobdetails', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const hero = stage(page).getByTestId('reader-head');
    // Nothing under the title but its band (round 10): company and place are facts.
    for (const id of ['reader-company', 'reader-place', 'reader-where', 'reader-source']) {
      await expect(stage(page).getByTestId(id)).toHaveCount(0);
    }
    const box = async (id: string) => (await stage(page).getByTestId(id).boundingBox())!;
    const ring = await box('reader-ring');
    const title = await box('reader-title');
    const band = await box('band');
    const actions = await box('reader-actions');
    const facts = await box('terms');
    // The ring 60 at the left, the title beside it, the band under the title.
    expect(Math.round(ring.width)).toBe(60);
    expect(title.x).toBeGreaterThan(ring.x + ring.width);
    expect(band.y).toBeGreaterThan(title.y);
    expect(Math.abs(band.x - title.x)).toBeLessThan(1);
    // The buttons in the hero under the top, the Jobdetails in the next card.
    await expect(hero.getByTestId('reader-actions')).toBeVisible();
    expect(actions.y).toBeGreaterThan(ring.y + ring.height);
    expect(facts.y).toBeGreaterThan(actions.y + actions.height);
    // The title copies; the band says the ring's band in its colour step.
    await expect(stage(page).getByTestId('reader-title')).toHaveAttribute('data-copy', '');
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.band.high);
    await expect(stage(page).getByTestId('band')).toHaveClass(/\bd[89]\b/);
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    // Where and when it came: its portals, then the moment it came into CXact, in ink.
    expect(await cell(page, 'portal')).toEqual([FOUND, '']);
    await expect(term(page, 'portal').locator('.value')).toHaveCSS(
      'color',
      await term(page, 'company')
        .locator('.value')
        .evaluate((node) => getComputedStyle(node).color),
    );
    // Nothing is joined by a dot, no info symbol beside the band, no count line.
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text).not.toContain('·');
    await expect(stage(page).getByTestId('band-info')).toHaveCount(0);
    await expect(stage(page).getByTestId('must')).toHaveCount(0);
    expect(text).not.toContain('Pflicht');
    // The place without the work mode the portal appends to it.
    await openJob(page, 'freelance-900411');
    expect((await cell(page, 'place'))[0]).toBe('München');
  });

  test("the hero tools: quiet 28 px buttons centred on the title's first line, the title kept clear; no ×", async ({
    page,
  }) => {
    for (const key of ['freelancermap-2801', 'freelance-900412']) {
      await openAt(page, key);
      const hero = (await stage(page).getByTestId('reader-head').boundingBox())!;
      const heading = stage(page).getByTestId('reader-title');
      const title = (await heading.boundingBox())!;
      const line = await heading.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
      const tools = stage(page).getByTestId('reader-tools').locator('.btn');
      await expect(tools).toHaveCount(2);
      // The title's words end before the first of them.
      const ends = await lineEnds(heading);
      expect(ends.length, key).toBeGreaterThan(0);
      expect(ends[0]!, key).toBeLessThan((await tools.first().boundingBox())!.x);
      for (const tool of await tools.all()) {
        const at = (await tool.boundingBox())!;
        expect(Math.round(at.width)).toBe(28);
        expect(Math.round(at.height)).toBe(28);
        // Centred on the title's first line, wherever the ring puts it.
        expect(Math.abs(at.y + at.height / 2 - (title.y + line / 2)), key).toBeLessThan(1);
      }
      // 14 inside the card's edge.
      const last = (await tools.last().boundingBox())!;
      expect(Math.round(hero.x + hero.width - (last.x + last.width))).toBe(15);
      await expect(stage(page).getByTestId('reader-close')).toHaveCount(0);
    }
  });

  test('a title of many lines: the hero tools shorten its first line only', async ({ page }) => {
    await open(page, WIN);
    // Short words: every line of the title runs as far as its room lets it.
    const long = Array.from({ length: 60 }, () => 'Bau').join(' ');
    await page.evaluate((title) => {
      window.__harness.editDetail = (detail) => {
        detail.job.title = title;
        return detail;
      };
    }, long);
    await row(page, 'freelancermap-2801').click();
    const heading = stage(page).getByTestId('reader-title');
    await expect(heading).toHaveText(long);
    const tools = (await stage(page).getByTestId('reader-tools').boundingBox())!;
    const ends = await lineEnds(heading);
    expect(ends.length).toBeGreaterThan(2);
    expect(ends[0]!).toBeLessThanOrEqual(tools.x);
    for (const end of ends.slice(1, -1)) expect(end).toBeGreaterThan(tools.x);
  });

  test('the ring shows the score of the open job', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    await expect(stage(page).getByTestId('reader-ring')).toContainText(BEST);
  });

  test('a job without a score: the dash ring, its state box with its own button, then what its menu offers', async ({
    page,
  }) => {
    // An ad still to come: the dash, "Noch nicht bewertet", the box with "Anzeige laden" in the
    // hero, under it the buttons its menu offers too (the ad, no prompt), no ad card.
    await openAt(page, 'linkedin-4100200302');
    await expect(stage(page).getByTestId('reader-ring')).toHaveText('–');
    await expect(stage(page).getByTestId('band')).toHaveText(T.reader.unscored);
    await expect(stage(page).getByTestId('band')).toHaveClass(/quiet/);
    const box = stage(page).getByTestId('reader-head').getByTestId('reader-state');
    await expect(box.getByTestId('detail-note')).toHaveText(T.reader.state.missing);
    // No second line that says again what the band says.
    await expect(box.getByTestId('detail-text')).toHaveCount(0);
    await expect(box.getByTestId('load-ad')).toBeVisible();
    await expect(stage(page).getByTestId('open-ad')).toBeVisible();
    await expect(stage(page).getByTestId('reader-prompt')).toHaveCount(0);
    await expect(stage(page).getByTestId('ad')).toHaveCount(0);
    // One too short to score: "Nicht bewertbar", the short note as its box, the buttons of
    // its text.
    await openJob(page, 'freelancermap-2806');
    await expect(stage(page).getByTestId('reader-ring')).toHaveText('–');
    await expect(stage(page).getByTestId('band')).toHaveText(T.reader.unscorable);
    await expect(stage(page).getByTestId('short-note')).toHaveText(T.reader.state.short.heading);
    await expect(stage(page).getByTestId('open-ad')).toBeVisible();
    await expect(stage(page).getByTestId('reader-prompt')).toHaveCount(0);
  });
  test('the ring only shows: no popover of what moved the score (user 2026-10-01)', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const ring = stage(page).getByTestId('reader-ring');
    await expect(ring).toHaveAttribute('role', 'img');
    await expect(ring).not.toHaveAttribute('aria-haspopup');
    // Resting on it and clicking it open nothing.
    await ring.hover();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await ring.click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
  });

  test("in one column the top bar's job view button and Zurück lead back to the list", async ({
    page,
  }) => {
    // The top bar keeps the job view's button while a job stands in place of the list; it
    // closes the job and goes without one (decision 29).
    await page.setViewportSize({ width: 683, height: 700 });
    await openAt(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-close')).toHaveCount(0);
    await expect(page.getByTestId('toggle-reader')).toBeEnabled();
    await page.getByTestId('toggle-reader').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
    await expect(page.getByTestId('toggle-reader')).toHaveCount(0);
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('history-back').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('toggle-reader').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
  });
});

test.describe('the actions', () => {
  test('three buttons in one order, the moves of the place in the head', async ({ page }) => {
    // A wide window: every button with its words.
    await page.setViewportSize({ width: 1800, height: 900 });
    await openAt(page, 'freelancermap-2801');
    const actions = stage(page).getByTestId('reader-actions');
    const buttons = actions.locator('.btn');
    expect(
      await buttons.evaluateAll((all) => all.map((button) => button.getAttribute('data-testid'))),
    ).toEqual(['open-ad', 'reader-mail', 'reader-prompt']);
    await expect(actions.getByTestId('reader-mail')).toHaveText(T.actions.mail);
    await expect(actions.getByTestId('open-ad')).toHaveText(T.actions.openAd);
    await expect(actions.getByTestId('reader-prompt')).toHaveText(T.actions.prompt);
    expect(T.actions.prompt).toBe('Prompt für KI-Bewertung');
    // The moves of Aktuell; no "…" menu.
    const tools = await headTools(page);
    expect(tools.ids).toEqual(['archive', 'trash']);
    expect(tools.labels).toEqual([T.actions.archive, T.actions.trash]);
    await expect(stage(page).getByTestId('reader-more')).toHaveCount(0);
    // The alert mail and the ad open outside.
    await actions.getByTestId('reader-mail').click();
    await expect
      .poll(async () => (await calls(page, 'open_target')).at(-1)?.[1])
      .toEqual({ target: { kind: 'gmail', key: { portal: 'freelancermap', id: '2801' } } });
    await actions.getByTestId('open-ad').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
    });
    // In den Papierkorb legen: the job goes to the trash, the next one opens.
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

  test('the action row keeps its words and stays inside the reader at every width', async ({
    page,
  }) => {
    for (const size of [
      { width: 1360, height: 900 },
      { width: 1000, height: 800 },
      { width: 900, height: 800 },
      { width: 480, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await openAt(page, 'freelancermap-2801');
      const actions = stage(page).getByTestId('reader-actions');
      // Never only an icon: every button keeps its words.
      await expect(actions.locator('.icon-only')).toHaveCount(0);
      // Where the words do not fit, the row wraps: no button leaves the window.
      for (const button of await actions.locator('.btn').all()) {
        const box = (await button.boundingBox())!;
        expect(box.x, `${size.width} px`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${size.width} px`).toBeLessThanOrEqual(size.width);
      }
    }
  });
  test('the moves of the archive and of the trash, deleting for good asks first', async ({
    page,
  }) => {
    await open(page, WIN);
    await openPlace(page, 'archive');
    await openJob(page, 'linkedin-4100200306');
    let tools = await headTools(page);
    expect(tools.ids).toEqual(['unarchive', 'trash']);
    expect(tools.labels).toEqual([T.actions.unarchive, T.actions.trash]);
    await choose(page, 'trash');
    await openPlace(page, 'trash');
    await openJob(page, 'linkedin-4100200306');
    tools = await headTools(page);
    expect(tools.ids).toEqual(['restore', 'purge']);
    expect(tools.labels).toEqual([T.actions.restore, T.actions.purge]);
    const title = await stage(page).getByTestId('reader-title').innerText();
    await choose(page, 'purge');
    // The red dialog carries the danger and names the job.
    const dialog = page.getByTestId('dialog-purge');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText(T.reader.purgeHeading);
    await expect(dialog).toContainText(T.reader.purgeText(title));
    await expect(dialog.getByTestId('dialog-confirm')).toHaveText(T.reader.purgeConfirm);
    await dialog.getByTestId('dialog-confirm').click();
    expect((await calls(page, 'purge_jobs')).at(-1)?.[1]).toEqual({
      keys: [{ portal: 'linkedin', id: '4100200306' }],
    });
  });

  test('the head names the moves of the place like the row, per place', async ({ page }) => {
    // Opening a job waits for every animation, the toast's of each move too.
    test.setTimeout(60_000);
    await open(page, WIN);
    // Two jobs in the Papierkorb (one toast: the moves merge).
    for (const key of ['freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
    }
    const places = [
      { place: 'inbox', key: 'freelancermap-2802', ids: ['archive', 'trash'] },
      { place: 'archive', key: 'linkedin-4100200306', ids: ['unarchive', 'trash'] },
      { place: 'trash', key: 'freelancermap-2803', ids: ['restore', 'purge'] },
    ] as const;
    for (const { place, key, ids } of places) {
      await openPlace(page, place);
      await openJob(page, key);
      expect(await moves(page), place).toEqual([...ids]);
      expect(await toolsOf(page, key), place).toEqual([...ids]);
    }
    // An excluded job: the same moves.
    await openPlace(page, 'inbox');
    const { excluded } = await stubList(page);
    await openJob(page, excluded[0]!);
    expect(await moves(page)).toEqual(['archive', 'trash']);
  });

  test('a job that just moved away takes no press on its moves while the next one loads', async ({
    page,
  }) => {
    // Opening a job waits for every animation, the toast's of each move too.
    test.setTimeout(60_000);
    await noPlaceholder(page);
    await open(page, WIN);
    const best = 'Interim CFO für Familienunternehmen';
    // The open job of Aktuell into the trash: while the next one loads the reader shows the
    // job that went to the Papierkorb, and its moves do nothing (never the Papierkorb's here).
    await openJob(page, 'freelancermap-2801');
    await slowDetails(page, 4000);
    await choose(page, 'trash');
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    await movesLocked(page);
    // The next job of Aktuell: Aktuell's moves.
    await expect(stage(page).getByTestId('reader-title')).not.toHaveText(best, { timeout: 10000 });
    await slowDetails(page, 0);
    expect(await moves(page)).toEqual(['archive', 'trash']);
    // Rückgängig brings it back and opens it again: Aktuell's moves again.
    await page.getByTestId('toast-action').click();
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    expect(await moves(page)).toEqual(['archive', 'trash']);
    // Wiederherstellen of the open job in the Papierkorb: the same while the next one loads.
    await open(page, WIN);
    for (const key of ['freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
    }
    await openPlace(page, 'trash');
    await openJob(page, 'freelancermap-2803');
    const keys = await listed(page);
    const below = keys[keys.indexOf('freelancermap-2803') + 1]!;
    const next = await row(page, below).locator('.title').innerText();
    await slowDetails(page, 4000);
    await choose(page, 'restore');
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await movesLocked(page);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(next, { timeout: 10000 });
    await slowDetails(page, 0);
    expect(await moves(page)).toEqual(['restore', 'purge']);
  });

  test('a job deleted for good takes no press while the next one loads, and looks as it did', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await noPlaceholder(page);
    await open(page, WIN);
    for (const key of ['freelancermap-2803', 'freelancermap-2804']) {
      await viaMenu(page, 'trash', key);
    }
    await openPlace(page, 'trash');
    await openJob(page, 'freelancermap-2803');
    const title = stage(page).getByTestId('reader-title');
    const gone = await title.innerText();
    await slowDetails(page, 4000);
    await choose(page, 'purge');
    await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
    await expect(page.getByTestId('dialog-purge')).toHaveCount(0);
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await expect(title).toHaveText(gone);
    await movesLocked(page);
    // The buttons that show the job, on a job that is gone: no call either.
    await stage(page).getByTestId('open-ad').click();
    expect(await calls(page, 'open_target')).toHaveLength(0);
    // The next job has its tools again.
    await expect(title).not.toHaveText(gone, { timeout: 10000 });
    await slowDetails(page, 0);
    await choose(page, 'purge');
    await expect(page.getByTestId('dialog-purge')).toBeVisible();
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
    await expect(page.getByTestId('toast').last()).toContainText(T.toast.prompt);
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
    await expect(page.getByTestId('toast').last()).toContainText(T.reader.promptNotCopied);
    await expect(stage(page).getByTestId('reader-error')).toHaveCount(0);
  });

  test('hiding the job view closes its job; a job chosen shows it again', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    const toggle = page.getByTestId('toggle-reader');
    await toggle.click();
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    await expect(page.locator('[data-open]')).toHaveCount(0);
    await toggle.click();
    await expect(page.getByTestId('place-reader')).toBeVisible();
    await toggle.click();
    await row(page, 'freelancermap-2801').click();
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
  });

  test('archiving by the keyboard keeps the focus on Archivieren of the next job', async ({
    page,
  }) => {
    await open(page, WIN);
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.getByTestId('reader-archive').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-archive')).toBeFocused();
  });

  test('a click on a move hands nothing on: Space and Enter a moment later move no further job', async ({
    page,
  }) => {
    await open(page, WIN);
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.getByTestId('reader-archive').click();
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await page.waitForTimeout(550);
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await settle(page);
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
  });

  test('a click on Anzeige öffnen leaves nothing for Space to open again', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    await stage(page).getByTestId('open-ad').click();
    await page.keyboard.press('Space');
    await settle(page);
    expect(await calls(page, 'open_target')).toHaveLength(1);
  });

  test('every press of a key moves the next job, also right after a move', async ({ page }) => {
    await open(page, WIN);
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.getByTestId('reader-archive').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-archive')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await calls(page, 'move_jobs')).length).toBe(2);
  });

  test('a held key moves one job: its repeats run through nothing', async ({ page }) => {
    await open(page, WIN);
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.getByTestId('reader-archive').focus();
    await page.keyboard.down('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-archive')).toBeFocused();
    // Each repeat of the held key, further apart than a double click.
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await page.waitForTimeout(600);
      await page.keyboard.down('Enter');
    }
    await page.keyboard.up('Enter');
    await settle(page);
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
    // Space acts on its release, held or not.
    await page.keyboard.down(' ');
    await page.waitForTimeout(600);
    await page.keyboard.down(' ');
    await page.keyboard.up(' ');
    await settle(page);
    expect(await calls(page, 'move_jobs')).toHaveLength(2);
  });

  test('a click on another move right after a move counts; the second of a double click does not', async ({
    page,
  }) => {
    const title = page.getByTestId('reader-title');
    await open(page, WIN);
    await rows(page).first().click();
    const first = await title.textContent();
    await page.getByTestId('reader-archive').click();
    await expect(title).not.toHaveText(first ?? '');
    const second = await title.textContent();
    await page.getByTestId('reader-trash').click();
    await expect.poll(async () => (await calls(page, 'move_jobs')).length).toBe(2);
    await expect(title).not.toHaveText(second ?? '');
    const third = await title.textContent();
    // A double click at one spot takes one job, the second click comes on the next job's button.
    const archive = (await page.getByTestId('reader-archive').boundingBox())!;
    await page.mouse.click(archive.x + archive.width / 2, archive.y + archive.height / 2);
    await expect(title).not.toHaveText(third ?? '');
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await settle(page);
    expect(await calls(page, 'move_jobs')).toHaveLength(3);
  });

  test('a press on the buttons of the job view takes no focus, Tab still reaches them', async ({
    page,
  }) => {
    // Pressed and let go beside it: a press only, nothing acts.
    const press = async (button: Locator): Promise<void> => {
      await button.hover();
      await page.mouse.down();
      expect(await button.evaluate((node) => node === document.activeElement)).toBe(false);
      await page.mouse.move(1, 1);
      await page.mouse.up();
    };
    await openAt(page, 'linkedin-4100200302');
    await press(stage(page).getByTestId('reader-archive'));
    await press(stage(page).getByTestId('open-ad'));
    await press(stage(page).getByTestId('load-ad'));
    await openAt(page, 'freelancermap-2802');
    await press(stage(page).getByTestId('add-to-profile').first());
    await openAt(page, 'linkedin-4100200302');
    const reached: (string | undefined)[] = [];
    for (let tab = 0; tab < 40 && !reached.includes('load-ad'); tab += 1) {
      await page.keyboard.press('Tab');
      reached.push(
        await page.evaluate(() => (document.activeElement as HTMLElement).dataset['testid']),
      );
    }
    expect(reached).toEqual(expect.arrayContaining(['reader-archive', 'load-ad']));
  });
});

test.describe('an excluded job', () => {
  test('the ban instead of the ring, why in one sentence, scored anyway and back', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900412');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    // The ban in the ring's place, "Ausgeschlossen" in the ban red, the job's one red; a
    // neutral box with why and Trotzdem bewerten at its end, no line that says again it is
    // not scored.
    await expect(stage(page).getByTestId('reader-ban')).toBeVisible();
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.excluded);
    await expect(stage(page).getByTestId('band')).toHaveClass(/ban/);
    const box = stage(page).getByTestId('exclusion-box');
    await expect(box.locator('.text')).toHaveCount(0);
    await expect(box.getByTestId('reader-include')).toBeVisible();
    await expect(box).not.toHaveClass(/(^|\s)ban(\s|$)/);
    // Its first violation, once, from the profile's side; no way into the ad.
    await expect(stage(page).getByTestId('exclusion')).toHaveText(T.reader.criterion.noAnue);
    await expect(stage(page).getByTestId('show-in-ad')).toHaveCount(0);
    // The head says why: no verdicts in the rows and no Anforderungen (user, 2026-10-03).
    expect(await cell(page, 'contract')).toEqual([T.reader.contractKind.anue, '']);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    expect(await cell(page, 'experience')).toEqual([T.facts.years(3, null), '']);
    await expect(why(page)).toHaveCount(0);
    // Trotzdem bewerten (the plus): its real match and a toast that takes it back.
    // Under the box what its menu offers; the head has the moves of its place.
    const include = stage(page).getByTestId('reader-include');
    await expect(include).toHaveText(T.actions.include);
    await expect(include.locator('[data-icon="add"]')).toHaveCount(1);
    await expect(stage(page).getByTestId('reader-actions').getByTestId('open-ad')).toBeVisible();
    expect(await moves(page)).toEqual(['archive', 'trash']);
    // From the keyboard: the job counts, the focus moves to its first button.
    await include.focus();
    await page.keyboard.press('Enter');
    expect((await calls(page, 'set_override')).at(-1)?.[1]).toEqual({
      key: { portal: 'freelance', id: '900412' },
      include: true,
    });
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText(T.toast.included);
    await expect(toast.getByTestId('toast-action')).toHaveText(T.common.undo);
    await expect(stage(page).getByTestId('reader-ring')).toBeVisible();
    await expect(stage(page).getByTestId('reader-ban')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-include')).toHaveCount(0);
    await expect(stage(page).getByTestId('open-ad')).toBeFocused();
    // No "Wieder ausschließen" (hidden for now, user 2026-09-29): the moves of its place only.
    expect(await moves(page)).toEqual(['archive', 'trash']);
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
    await expect(why(page)).toHaveCount(0);
  });

  test('a country outside the profile: the head says it from the profile, the row the place', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200305');
    await expect(stage(page).getByTestId('exclusion')).toHaveText(T.reader.criterion.countries);
    expect(await cell(page, 'place')).toEqual(['Zürich', '']);
  });
});

test.describe('Jobdetails', () => {
  test('the rows in their order; a row the ad says nothing of only with a verdict', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText(T.reader.details);
    // The ad says nothing of its workload and nothing judges it: no row "–".
    const shown = ROWS.filter((name) => name !== T.reader.term.workload);
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(shown);
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    expect(await cell(page, 'mode')).toEqual([words(T.facts.remote(60, 60)), 'met']);
    expect(await cell(page, 'contract')).toEqual([T.reader.contractKind.interim, 'met']);
    // The value and the verdict only, no word of how it stands to the minimum.
    expect(await cell(page, 'rate')).toEqual([words(T.facts.pay(1200, 'day', null)), 'met']);
    expect(await cell(page, 'start')).toEqual([T.facts.now, 'met']);
    expect(await cell(page, 'duration')).toEqual([T.facts.duration(6, null, 'month'), 'met']);
    await expect(term(page, 'workload')).toHaveCount(0);
    // Where and when it came: its portals, then the moment it came into CXact.
    expect(await cell(page, 'portal')).toEqual([FOUND, '']);
    // No row "Eingegangen" (user, 2026-10-01): the moment stands in "Gefunden".
    await expect(term(page, 'received')).toHaveCount(0);
    // Verdicts are icons (no words) named by their verdict, and only where a fact does not
    // fully fit.
    await expect(terms(page)).not.toContainText('passt');
    await expect(terms(page)).not.toContainText('Minimum');
    await expect(term(page, 'rate').getByTestId('verdict')).toHaveCount(0);
    await expect(
      term(page, 'experience').getByTestId('verdict').locator('.reason'),
    ).toHaveAttribute('aria-label', T.reader.verdict.partial);
  });

  test('Bewerben bis and Kontakt: urgent within a week, the e-mail writes a mail, the rest copies', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const urgent = (key: string) => term(page, key).locator('.value').first();
    expect(await cell(page, 'deadline')).toEqual(['15.10.', '']);
    await expect(urgent('deadline')).not.toHaveClass(/urgent/);
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
    // The e-mail is a link: a new mail to it in the mail program.
    const mail = term(page, 'contact').getByTestId('contact-mail');
    await mail.click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'contactMail', key: { portal: 'freelancermap', id: '2801' } },
    });
    // Four days ahead: urgent. An e-mail address alone is the contact.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'deadline')).toEqual(['28.09.', '']);
    await expect(urgent('deadline')).toHaveClass(/urgent/);
    await expect(term(page, 'contact').getByTestId('contact-mail')).toHaveText(
      'jobs@gruenwerk.example',
    );
    // An ad that names neither: nothing judges them, so no rows.
    await openJob(page, 'freelancermap-2804');
    await expect(term(page, 'deadline')).toHaveCount(0);
    await expect(term(page, 'contact')).toHaveCount(0);
  });

  test('one form per fact: a start date, a workload, pay near the wish, the work mode', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900413');
    expect(await cell(page, 'start')).toEqual([T.facts.from('01.11.'), 'met']);
    expect(await cell(page, 'workload')).toEqual([T.facts.workload(40, 40), 'partial']);
    // Above the minimum, near the wish: met in part.
    expect(await cell(page, 'rate')).toEqual([words(T.facts.pay(1150, 'day', null)), 'partial']);
    expect(await cell(page, 'mode')).toEqual([T.facts.mode.onsite, 'partial']);
    expect(await cell(page, 'place')).toEqual(['München', 'partial']);
    // A limit missed is met in part; a rate to be agreed has nothing to judge, nor a note.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'duration')).toEqual([T.facts.duration(3, null, 'month'), 'partial']);
    expect(await cell(page, 'rate')).toEqual([T.facts.agreed, '']);
    expect(await cell(page, 'workload')).toEqual([T.facts.workload(100, 100), 'met']);
    // One case in the row: "Voll remote" like "Vor Ort" and "Hybrid".
    expect(await cell(page, 'mode')).toEqual([T.facts.mode.remote, 'met']);
    expect(T.facts.mode.remote).toBe('Voll remote');
    // A hybrid job without a share: its mode in the one set of words.
    await page.evaluate(() => {
      window.__harness.editDetail = (detail) => {
        detail.job.workMode = 'hybrid';
        const facts = detail.job.match?.facts;
        if (facts) Object.assign(facts, { remoteFrom: null, remoteTo: null });
        return detail;
      };
    });
    await openJob(page, 'freelancermap-2803');
    expect((await cell(page, 'mode'))[0]).toBe(T.facts.mode.hybrid);
    await page.evaluate(() => (window.__harness.editDetail = null));
    // Said in the rows, not again among the requirements.
    await openJob(page, 'freelancermap-2802');
    await expect(why(page)).not.toContainText(T.reason.code.duration({ months: 3, min: 6 }));
    // A start "nach Absprache" is unknown: the verdict says so.
    await openJob(page, 'freelancermap-2804');
    expect(await cell(page, 'start')).toEqual([T.facts.agreed, 'unknown']);
  });

  test('Erfahrung says what its requirement says among the Anforderungen', async ({ page }) => {
    // 15 years of Controlling against the profile's 18, the requirement met in part for its
    // skill: the row and the Anforderungen say the same.
    await openAt(page, 'freelancermap-2801');
    expect(await cell(page, 'experience')).toEqual([T.facts.years(15, null), 'partial']);
    await expect(
      why(page).locator('li[data-kind="partial"]', {
        hasText: 'Mindestens 15 Jahre Berufserfahrung im Controlling',
      }),
    ).toHaveCount(1);
    // Ten years of a field the profile does not name: nothing judges the years (no icon),
    // the requirement is not met and says why.
    await openJob(page, 'linkedin-4100200304');
    expect(await cell(page, 'experience')).toEqual([T.facts.years(10, null), '']);
    await expect(
      why(page).locator('li[data-kind="open"]', {
        hasText: 'Mindestens 10 Jahre Berufserfahrung im Rechnungswesen',
      }),
    ).toHaveCount(1);
    // A working student job: its level by its word; it is excluded, so no verdict.
    await openJob(page, 'freelancermap-2807');
    expect(await cell(page, 'experience')).toEqual([T.facts.level('student')!, '']);
  });

  test('the Anforderungen have no tooltip on their icons; the marks of the Jobdetails name their verdict', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await openAt(page, 'freelancermap-2801');
    for (const key of ['freelancermap-2801', 'freelance-900413', 'linkedin-4100200304']) {
      await openJob(page, key);
      const icons = stage(page).locator('[data-testid="verdict"] .reason');
      const count = await icons.count();
      expect(count, key).toBeGreaterThan(0);
      // The Anforderungen: one flat list, no tooltip on the icon.
      const requirement = stage(page).locator('[data-testid="why"] [data-testid="reason"]').first();
      await requirement.scrollIntoViewIfNeeded();
      await requirement.hover();
      await page.waitForTimeout(700);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      // The Jobdetails' marks show a glyph and no words: under the pointer each says its verdict.
      const icon = icons.first();
      await icon.scrollIntoViewIfNeeded();
      await icon.hover();
      await expect(page.getByRole('tooltip')).toHaveText(
        (await icon.getAttribute('aria-label')) ?? '',
      );
      await page.mouse.move(0, 0);
    }
  });

  test('pay and duration as the ad states them', async ({ page }) => {
    await open(page, WIN);
    /** The engine's facts and criterion params of an ad the demo does not have (core
     *  ad_facts and explain write them so), on the demo job opened next. */
    const edit = (
      facts: Record<string, unknown>,
      criteria: Record<string, Record<string, unknown>>,
    ): Promise<void> =>
      page.evaluate(
        ({ facts, criteria }) => {
          window.__harness.editDetail = (detail) => {
            const match = detail.job.match;
            if (match) match.facts = { ...match.facts, ...facts };
            for (const criterion of detail.match?.criteria ?? []) {
              Object.assign(criterion.params, criteria[criterion.code] ?? {});
            }
            // Without a wish the minimum says why the pay is met.
            if (detail.match) {
              detail.match.reasons = detail.match.reasons.filter(
                (reason) => reason.code !== 'dayRateWish',
              );
            }
            return detail;
          };
        },
        { facts, criteria },
      );
    // A range of day rates: both ends; its upper end meets the minimum of 1.100 €.
    await edit({ rate: 1200, rateFrom: 900 }, { minDayRate: { rate: 1200, from: 900 } });
    await openJob(page, 'freelancermap-2801');
    expect(await cell(page, 'rate')).toEqual([
      words(T.facts.payRange(900, 1200, 'day', null)),
      'met',
    ]);
    // An hourly rate: per hour in the row; weeks stay weeks, and a range of months shows both
    // ends.
    await edit(
      { rate: 150, hourly: true, months: null, weeks: 9 },
      { minDayRate: { rate: 150, hourly: true, perDay: 1200 }, duration: { weeks: 9 } },
    );
    await openJob(page, 'linkedin-4100200301');
    expect(await term(page, 'rate').locator('.term-name').innerText()).toBe(T.reader.hourlyName);
    expect((await cell(page, 'rate'))[0]).toBe(words(T.facts.pay(150, 'hour', null)));
    expect((await cell(page, 'duration'))[0]).toBe(T.facts.duration(9, null, 'week'));
    await edit({ months: 6, durationFrom: 3 }, {});
    await openJob(page, 'freelancermap-2802');
    expect((await cell(page, 'duration'))[0]).toBe(T.facts.duration(6, 3, 'month'));
    // A salary with its bonus, and one in another currency: its own money, never "€".
    await edit(
      { salary: 130000, salaryFrom: 120000, salaryBonus: 20 },
      { minSalary: { salary: 130000, from: 120000, bonus: 20, withBonus: 156000, min: 150000 } },
    );
    await openJob(page, 'linkedin-4100200303');
    const salary = (await cell(page, 'rate'))[0];
    expect(salary).toBe(words(T.facts.bonus(T.facts.payRange(120000, 130000, 'year', null), 20)));
    expect(T.reason.code.salary({ salary: 180000, currency: 'CHF', min: 150000 })).toBe(
      'Das Gehalt ist in CHF angegeben.',
    );
  });

  test('a permanent job: its salary, no end, the contract met', async ({ page }) => {
    await openAt(page, 'linkedin-4100200303');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names[4]).toBe(T.reader.salaryName);
    expect(await cell(page, 'rate')).toEqual([words(T.facts.pay(95000, 'year', null)), '']);
    expect(await cell(page, 'duration')).toEqual([T.facts.unlimited, '']);
    // The ad states the type and the profile takes permanent jobs: met, not "unklar".
    expect(await cell(page, 'contract')).toEqual([T.reader.contractKind.permanent, 'met']);
    // The ad names no experience and nothing judges it: no row.
    await expect(term(page, 'experience')).toHaveCount(0);
  });

  test('an ad the app never read in full shows only what it knows', async ({ page }) => {
    // Not loaded yet: what its mail said (round 10: Unternehmen, Ort, Gefunden).
    await openAt(page, 'linkedin-4100200302');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(named('company', 'place', 'portal'));
    // Its portal by its one name, and when it came.
    const [found] = await cell(page, 'portal');
    expect(found).toMatch(new RegExp(`^${T.portal.linkedin}, \\S`));
    // No dash claims the ad says nothing; a preview neither.
    await expect(terms(page)).not.toContainText(T.reader.missing);
    await openJob(page, 'freelance-900411');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(
      named('company', 'place', 'mode', 'contract', 'portal'),
    );
    await expect(terms(page).locator('.value.missing')).toHaveCount(0);
  });

  test('a job the engine could not score shows no verdicts', async ({ page }) => {
    await openAt(page, 'freelancermap-2806');
    await expect(stage(page).getByTestId('short-note')).toHaveText(T.reader.state.short.heading);
    await expect(stage(page).getByTestId('band')).toHaveText(T.reader.unscorable);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    await expect(why(page)).toHaveCount(0);
  });

  test('without a profile: the values without verdicts, the dash ring, no requirements', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-ring')).toHaveText('–');
    await expect(stage(page).getByTestId('band')).toHaveText(T.score.none);
    // Without verdicts no row says "–": what the ad states, and how it came.
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(ROWS.filter((name) => names.includes(name)));
    expect(names).toEqual(expect.arrayContaining(named('company', 'portal')));
    await expect(terms(page).locator('.value.missing')).toHaveCount(0);

    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    await expect(why(page)).toHaveCount(0);
  });
});

test.describe('Anforderungen', () => {
  test('one flat list in its order with "x von N erfüllt", only requirements', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    await expect(why(page).getByTestId('why-title')).toContainText(T.reader.why);
    await expect(why(page).locator('.count')).toHaveText(T.reader.metOf(5, 8));
    // Met first, then in part, then not met; within each a must before a nice one.
    const order = await why(page)
      .locator('li')
      .evaluateAll((all) =>
        all.map((li) => [(li as HTMLElement).dataset.kind, (li as HTMLElement).dataset.weight]),
      );
    expect(order.map(([kind]) => kind)).toEqual([
      ...Array<string>(5).fill('met'),
      'partial',
      'partial',
      'open',
    ]);
    const RANK: Record<string, number> = { must: 0, hard: 1, nice: 2, info: 3 };
    order.forEach(([kind, weight], at) => {
      const [before, beforeWeight] = order[at - 1] ?? [];
      if (kind === before) expect(RANK[weight!]).toBeGreaterThanOrEqual(RANK[beforeWeight!]!);
    });
    // Two columns: the second requirement beside the first.
    const tops = await why(page)
      .locator('li')
      .evaluateAll((all) => all.slice(0, 2).map((li) => li.getBoundingClientRect().top));
    expect(Math.abs(tops[0]! - tops[1]!)).toBeLessThan(1);
    // No title, wish or Schwerpunkt, no line of the profile's words.
    for (const said of ['Wunschrolle', 'Schwerpunkt', 'Tagessatz', 'im Profil']) {
      await expect(why(page)).not.toContainText(said);
    }
    // Untagged is Pflicht: the only tag is the quiet word "optional", and only on a
    // requirement that is not met.
    expect(new Set(await why(page).locator('.optional').allInnerTexts())).toEqual(
      new Set([T.reason.optional]),
    );
    await expect(why(page).locator('li[data-kind="met"] .optional')).toHaveCount(0);
    // Only what a job has.
    await openJob(page, 'freelancermap-2804');
    await expect(why(page).locator('.count')).toHaveText(T.reader.metOf(0, 1));
  });

  test('a job in the Papierkorb has no "+" into the profile: Wiederherstellen comes first', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2802');
    const missing = why(page).locator('li[data-kind="open"]');
    const adds = why(page).getByTestId('add-to-profile');
    await expect(adds.first()).toBeVisible();
    const open = await missing.count();
    await choose(page, 'trash');
    await expect(row(page, 'freelancermap-2802')).toHaveCount(0);
    await openPlace(page, 'trash');
    await openJob(page, 'freelancermap-2802');
    // The crosses stay, the "+" goes.
    await expect(missing).toHaveCount(open);
    await expect(adds).toHaveCount(0);
  });

  test('a missing must that is a term goes into its field of the profile with "+", a sentence has none', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2802');
    const missing = why(page).locator('li[data-kind="open"]', {
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
        .locator('li[data-kind="open"]', { hasText: 'Französisch' })
        .getByTestId('add-to-profile'),
    ).toHaveCount(0);
    await add.click();
    // A quiet check takes the place of the red cross and the "+" goes, no word: one icon on
    // the row. The toast says it, with the term alone (without the ad's "Branchenerfahrung").
    const added = missing.getByTestId('reason-settled');
    await expect(added).toHaveAttribute('aria-label', T.reader.added);
    await expect(added).toHaveText('');
    await expect(missing.getByTestId('add-to-profile')).toHaveCount(0);
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText(T.reader.addedToProfile('Energie'));
    // The term is among the profile's industries, saved at once; not among its keywords.
    const stored = () => page.evaluate(() => window.__harness.form());
    expect((await stored())?.industries).toContain('Energie');
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-industries')).toContainText('Energie');
    await expect(page.getByTestId('profile-industries')).not.toContainText('Branchenerfahrung');
    // The toast takes it back.
    await page.getByTestId('nav-jobs').click();
    await page
      .getByTestId('toast')
      .filter({ hasText: T.reader.addedToProfile('Energie') })
      .getByTestId('toast-action')
      .click();
    await expect(missing.getByTestId('add-to-profile')).toBeVisible();
    await expect.poll(async () => (await stored())?.industries).not.toContain('Energie');
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-industries')).not.toContainText('Energie');
    // The other bullets lose their lead words too, and go into their own field: the tool
    // "Anaplan" into the tools.
    await page.getByTestId('nav-jobs').click();
    const anaplan = why(page).locator('li[data-kind="open"]', {
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
    // A requirement the ad words as a sentence cannot go into the profile.
    await page.getByTestId('nav-jobs').click();
    await openJob(page, 'freelancermap-2804');
    const sentence = why(page).locator('li[data-kind="open"]').first();
    await expect(sentence).toContainText('Kenntnisse in Anaplan helfen dabei');
    await expect(sentence.getByTestId('add-to-profile')).toHaveCount(0);
  });
});

test.describe('the ad', () => {
  /** The reader's scroll position. */
  const readerTop = (page: Page): Promise<number> =>
    page.getByTestId('reader-pane').evaluate((pane) => {
      for (let node: Element | null = pane.querySelector('[data-testid="reader"]'); node;) {
        if (node.scrollHeight > node.clientHeight + 1) {
          const overflow = getComputedStyle(node).overflowY;
          if (/auto|scroll/.test(overflow)) return node.scrollTop;
        }
        node = node.parentElement;
      }
      return -1;
    });

  test('plain text: hovering or clicking a row or a requirement marks nothing in the ad', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 700 });
    await openAt(page, 'freelancermap-2801');
    const text = stage(page).getByTestId('ad-text');
    await expect(text).toContainText('Reporting nach IFRS');
    await expect(text).toHaveAttribute('data-copy', '');
    // No marks without a search: no underline, no colour, no tooltip, nothing to press.
    await expect(text.locator('mark')).toHaveCount(0);
    await expect(stage(page).locator('.jump, button.chip, button.reason, [data-item]')).toHaveCount(
      0,
    );
    await expect(stage(page).getByTestId('detail-note')).toHaveCount(0);
    // A row of the Jobdetails and a requirement under the pointer, then clicked: the ad keeps
    // its plain text and the reader stays where it is.
    const top = await readerTop(page);
    for (const target of [
      term(page, 'rate'),
      term(page, 'experience'),
      why(page).locator('li', { hasText: 'Reporting nach IFRS' }),
    ]) {
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.move(box.x + 8, box.y + box.height / 2);
      await page.waitForTimeout(200);
      await expect(text.locator('mark')).toHaveCount(0);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(250);
      await expect(text.locator('mark')).toHaveCount(0);
      expect(await readerTop(page)).toBe(top);
    }
  });

  test('the ad in its structure: headings, lists without their glyphs, paragraphs', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const text = stage(page).getByTestId('ad-text');
    const headings = text.getByTestId('ad-heading');
    await expect(headings).toHaveText(['Ihre Aufgaben', 'Ihr Profil', 'Wünschenswert', 'Rahmen']);
    // The bullets are a list; the ad's glyphs are gone.
    const items = text.getByTestId('ad-item');
    await expect(items).toHaveCount(10);
    await expect(items.first()).toHaveText('Führung eines Teams von sechs Personen');
    expect(await text.innerText()).not.toContain('•');
    // A line with a date is no heading, whatever its first word.
    await expect(text.locator('p').last()).toContainText('Bewerbungsfrist 15.10.2026');
    // One text to copy, nothing marked in it.
    await expect(text).toHaveAttribute('data-copy', '');
    await expect(text.locator('mark')).toHaveCount(0);
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
    await search.fill('');
    await expect(hits).toHaveCount(0);
  });

  test('the ad marks what the search found like the row: in any case, with or without accents', async ({
    page,
  }) => {
    await open(page, WIN);
    const search = page.getByTestId('search');
    const hits = stage(page).getByTestId('ad-text').locator('mark.hit');
    await search.fill('GESCHAFT');
    await expect.poll(() => listed(page)).toEqual(['freelancermap-2803']);
    await row(page, 'freelancermap-2803').click();
    await expect(row(page, 'freelancermap-2803').locator('mark')).toHaveText(['geschäft']);
    await expect(hits.first()).toHaveText(/geschäft/iu);
    await search.fill('Munchen');
    await expect.poll(() => listed(page)).toContain('freelance-900411');
    await row(page, 'freelance-900411').click();
    await expect(hits.first()).toHaveText('München');
  });

  test('a preview says so once, here, with its sign-in right there', async ({ page }) => {
    await openAt(page, 'freelance-900411');
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.teaser.heading);
    await expect(stage(page).getByTestId('detail-text')).toHaveText(T.reader.state.teaser.text);
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text.split('Vorschau').length - 1).toBe(1);
    await expect(stage(page).getByTestId('preliminary')).toHaveCount(0);
    const signIn = stage(page).getByTestId('reader-sign-in');
    await expect(signIn).toHaveText(T.settings.signIn);
    // A sign-in that fails says so; the job stays.
    await failNext(page, 'portal_login');
    await signIn.click();
    await expect(page.getByTestId('toast-text')).toHaveText(T.error.text('db', {}));
    // The sign-in window opens from here, the job stays, and the ad can be loaded now.
    await signIn.click();
    expect(await calls(page, 'portal_login')).toHaveLength(2);
    await expect(page.getByTestId('view-jobs')).toBeVisible();
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
    await expect(signIn).toHaveCount(0);
    // Einstellungen know it: freelance.de offers Abmelden.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('sign-out-freelance')).toBeVisible();
  });

  test('a preview of a portal that is off says so and offers no sign-in, also signed in', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900411');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('toggle-enabled-freelance').click();
    await page.getByTestId('nav-jobs').click();
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.teaser.heading);
    await expect(stage(page).getByTestId('detail-text')).toHaveText(
      T.reader.portalOff(T.portal.freelance),
    );
    await expect(stage(page).getByTestId('reader-sign-in')).toHaveCount(0);
    await expect(stage(page).getByTestId('load-ad')).toHaveCount(0);
    // Back on, its sign-in is the way on; signed in and off again the box says the same.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('toggle-enabled-freelance').click();
    await page.getByTestId('nav-jobs').click();
    await stage(page).getByTestId('reader-sign-in').click();
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('toggle-enabled-freelance').click();
    await page.getByTestId('nav-jobs').click();
    await expect(stage(page).getByTestId('detail-text')).toHaveText(
      T.reader.portalOff(T.portal.freelance),
    );
    await expect(stage(page).getByTestId('load-ad')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-sign-in')).toHaveCount(0);
  });

  test('a missing ad: "Anzeige laden" loads it, meanwhile it is being loaded', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.missing);
    const load = stage(page).getByTestId('load-ad');
    await expect(load).toHaveText(T.reader.fetchDetails);
    await load.click();
    expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
      kind: 'details',
      keys: [{ portal: 'linkedin', id: '4100200302' }],
    });
    // The box says it is being loaded, its spinner before the words; the button is gone.
    await expect(note).toHaveText(T.reader.state.loading);
    await expect(stage(page).getByTestId('detail-text')).toHaveCount(0);
    await expect(load).toHaveCount(0);
    // Once the ad is there, its note goes.
    await runFinished(page);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
    await expect(stage(page).getByTestId('detail-note')).toHaveCount(0);
    // An ad that could not be fetched is not being loaded while nothing loads it.
    await openJob(page, 'freelancermap-2805');
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.missing);
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
  });

  /** A job's row is pressed and its job view stands. */
  async function pressRow(page: Page, key: string): Promise<void> {
    await row(page, key).click();
    await expect(stage(page).getByTestId('reader-title')).toHaveText(
      await row(page, key).locator('.title').innerText(),
    );
  }

  test('back at a job whose ad is loading the box still says so, and no dead button stands', async ({
    page,
  }) => {
    const loading = 'linkedin-4100200302';
    await openAt(page, loading, `${WIN}&tick=15`);
    const note = stage(page).getByTestId('detail-note');
    await page.evaluate(() => (window.__harness.holdAfter = 3));
    await stage(page).getByTestId('load-ad').click();
    await expect(note).toHaveText(T.reader.state.loading);
    // Another job meanwhile: its own ad is not what loads, its button waits and says why.
    await pressRow(page, 'freelancermap-2805');
    await expect(note).toHaveText(T.reader.state.missing);
    await expect(stage(page).getByTestId('load-ad')).toHaveAttribute('aria-disabled', 'true');
    // Back: the same box as before, with its spinner.
    await pressRow(page, loading);
    await expect(note).toHaveText(T.reader.state.loading);
    await expect(stage(page).getByTestId('load-ad')).toHaveCount(0);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
    expect(await page.getByTestId('toast').count()).toBe(0);
  });

  test('back at a job whose load ends without the ad it says so once, a later run says nothing', async ({
    page,
  }) => {
    const loading = 'linkedin-4100200302';
    const toast = page.getByTestId('toast');
    await openAt(page, loading, `${WIN}&tick=15`);
    await page.evaluate(() => {
      window.__harness.detailsEnd = 'nothing';
      window.__harness.holdAfter = 3;
    });
    await stage(page).getByTestId('load-ad').click();
    await pressRow(page, 'freelancermap-2805');
    await pressRow(page, loading);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.loading);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(T.reader.state.notLoaded);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.missing);
    // A rescore the app starts by itself, once that toast has gone, is no answer to that press.
    await expect(toast).toHaveCount(0, { timeout: 8000 });
    await page.evaluate(() => window.__harness.appRun('rescore'));
    await runFinished(page);
    await page.waitForTimeout(100);
    expect(await toast.count()).toBe(0);
  });

  test('what arrives later shows: the ad, its rows, its requirements', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    await expect(why(page)).toHaveCount(0);
    await stage(page).getByTestId('load-ad').click();
    await expect(why(page)).toBeVisible({ timeout: 5000 });
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
  });

  test('a closed ad says so in the state box, nothing in the title', async ({ page }) => {
    await openAt(page, 'linkedin-4100200304');
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.closed.heading);
    await expect(stage(page).getByTestId('detail-text')).toHaveText(T.reader.state.closed.text);
    await expect(stage(page).getByTestId('reader-title')).not.toContainText(T.job.closed);
  });

  test('an ad no longer online: its text keeps "Anzeige öffnen", the state box says it', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200304');
    const openAd = stage(page).getByTestId('open-ad');
    await expect(openAd).toHaveText(T.actions.openAd);
    await openAd.click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'linkedin', id: '4100200304' } },
    });
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.closed.heading);
    await expect(term(page, 'portal').locator('.term-note')).toHaveCount(0);
    // Gone before its text came: the sentence, and its portal's page still opens, as from its
    // menu.
    await page.evaluate(() => window.__harness.gone({ portal: 'linkedin', id: '4100200302' }));
    await openJob(page, 'linkedin-4100200302');
    await expect(stage(page).getByTestId('open-ad')).toHaveText(T.actions.openAd);
    await expect(term(page, 'portal').locator('.term-note')).toHaveCount(0);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.state.gone.heading);
    await expect(stage(page).getByTestId('detail-text')).toHaveText(T.reader.state.goneEarly);
  });

  test('every line of a state box is one short sentence', async () => {
    const lines = Object.values(T.reader.state).flatMap((value) =>
      typeof value === 'string' ? [value] : [value.heading, value.text],
    );
    for (const line of lines) expect(line).toMatch(/^[^.]+\.$/);
  });
});

test('while a job loads, the reader stands in placeholders until the job takes their place', async ({
  page,
}) => {
  await open(page, WIN);
  await settle(page);
  await slowDetails(page, 1500);
  await row(page, 'freelancermap-2801').click();
  const skeleton = stage(page).getByTestId('reader-skeleton');
  await expect(skeleton).toBeVisible();
  // The job takes their place.
  await expect(stage(page).getByTestId('reader-title')).toBeVisible({ timeout: 5000 });
  await expect(stage(page).getByTestId('reader-skeleton')).toHaveCount(0);
});

test.describe('the cards', () => {
  test('on the page ground, 8 under the top bar, 28 from the sides, 12 apart, at most 760, the pane 40 longer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await openAt(page, 'freelancermap-2801');
    const reader = stage(page).getByTestId('reader');
    const ground = await reader.evaluate((node) => getComputedStyle(node).backgroundColor);
    const page_ = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--page)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    expect(ground).toBe(page_);
    const pane = (await reader.boundingBox())!;
    const cards = stage(page).locator('[data-card]');
    const boxes = await cards.evaluateAll((all) =>
      all.map((card) => {
        const box = card.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, bottom: box.bottom };
      }),
    );
    expect(boxes).toHaveLength(4);
    expect(Math.round(boxes[0]!.y - pane.y)).toBe(8);
    for (const box of boxes) expect(Math.round(box.width)).toBe(760);
    // Centred in the pane.
    const left = boxes[0]!.x - pane.x;
    const right = pane.x + pane.width - (boxes[0]!.x + boxes[0]!.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(9);
    for (let at = 1; at < boxes.length; at += 1) {
      expect(Math.round(boxes[at]!.y - boxes[at - 1]!.bottom)).toBe(12);
    }
    // The pane's scroll area ends 40 under the last card.
    const end = await stage(page).evaluate(
      (node) => node.getBoundingClientRect().top - node.scrollTop + node.scrollHeight,
    );
    expect(Math.round(end - boxes.at(-1)!.bottom)).toBe(40);
    // A narrow pane: 28 from its sides.
    await page.setViewportSize({ width: 1100, height: 800 });
    const narrow = (await reader.boundingBox())!;
    const hero = (await cards.first().boundingBox())!;
    expect(Math.round(hero.x - narrow.x)).toBe(28);
  });

  test('Jobdetails: two columns of label 96, value and verdict; one column in a narrow card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await openAt(page, 'freelancermap-2801');
    const company = (await term(page, 'company').boundingBox())!;
    const place = (await term(page, 'place').boundingBox())!;
    // Unternehmen and Ort side by side, the label 96 wide.
    expect(Math.abs(company.y - place.y)).toBeLessThan(1);
    expect(place.x).toBeGreaterThan(company.x + company.width);
    const label = (await term(page, 'company').locator('.term-name').boundingBox())!;
    expect(Math.round(label.width)).toBe(96);
    // The contact spans both columns.
    const contact = (await term(page, 'contact').boundingBox())!;
    expect(Math.round(contact.width)).toBe(Math.round(place.x + place.width - company.x));
    // A fact that fits has no mark; one that fits in part its mark 6 after its value, centred
    // on its line.
    await expect(term(page, 'place').getByTestId('verdict')).toHaveCount(0);
    const value = (await term(page, 'experience').locator('.value').boundingBox())!;
    const mark = (await term(page, 'experience').getByTestId('verdict').boundingBox())!;
    expect(Math.round(mark.x - (value.x + value.width))).toBe(6);
    expect(Math.abs(mark.y + mark.height / 2 - (value.y + value.height / 2))).toBeLessThan(1.5);
    // Hairlines between the rows only: one above each row but the first of each column, none
    // under the last.
    const hairlines = async (columns: number): Promise<void> => {
      const seen = await terms(page)
        .locator('li')
        .evaluateAll((all) =>
          all.map((li) => {
            const { borderTopWidth, borderBottomWidth } = getComputedStyle(li);
            return [borderTopWidth, borderBottomWidth];
          }),
        );
      expect(seen).toEqual(seen.map((_, at) => [at < columns ? '0px' : '1px', '0px']));
    };
    await hairlines(2);
    // A narrow window: one column.
    await page.setViewportSize({ width: 480, height: 360 });
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    // Once the window has settled (the sidebar folds away as it narrows).
    await expect
      .poll(async () => {
        const one = (await term(page, 'company').boundingBox())!;
        const two = (await term(page, 'place').boundingBox())!;
        return two.y > one.y + one.height - 1 && Math.abs(two.x - one.x) < 1;
      })
      .toBe(true);
    await hairlines(1);
    const reqs = await why(page)
      .locator('li')
      .evaluateAll((all) => all.slice(0, 2).map((li) => li.getBoundingClientRect().left));
    expect(Math.abs(reqs[0]! - reqs[1]!)).toBeLessThan(1);
  });

  test('a fact alone in its row spans it: its line runs the whole way, its value on its column', async ({
    page,
  }) => {
    // Jobs with an odd number of facts beside the contact, or without one.
    for (const key of ['linkedin-4100200302', 'freelance-900411', 'linkedin-4100200304']) {
      await openAt(page, key);
      const facts = await terms(page)
        .locator('li')
        .evaluateAll((all) =>
          all.map((li) => {
            const box = li.getBoundingClientRect();
            const value = li.querySelector('.term-line')!.getBoundingClientRect();
            return { top: box.top, left: box.left, right: box.right, value: value.left };
          }),
        );
      const list = (await terms(page).boundingBox())!;
      const lone = facts.filter((fact) => facts.filter((f) => f.top === fact.top).length === 1);
      expect(lone.length, key).toBeGreaterThan(0);
      for (const fact of lone) {
        expect(fact.left, key).toBe(list.x);
        expect(fact.right, key).toBe(list.x + list.width);
        expect(fact.value, key).toBe(facts[0]!.value);
      }
    }
  });

  test('a new job: its cards are there at once, nothing cascades or fades', async ({ page }) => {
    await open(page, WIN);
    await settle(page);
    // Every animation the cards' slots start.
    await page.evaluate(() => {
      const started: string[] = [];
      (window as unknown as { started: string[] }).started = started;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ) {
        if (this.classList.contains('slot')) started.push('slot');
        return original.apply(this, args);
      };
    });
    const started = (): Promise<string[]> =>
      page.evaluate(() => [...(window as unknown as { started: string[] }).started]);
    // The first job, then another one: every card stands at once.
    for (const key of ['freelancermap-2801', 'freelancermap-2802']) {
      await row(page, key).click();
      await expect(stage(page).getByTestId('reader-title')).toHaveText(
        await row(page, key).locator('.title').innerText(),
      );
      await page.waitForTimeout(300);
      expect(await started(), key).toEqual([]);
      await page.waitForTimeout(300);
    }
    // The same job loading again swaps at once.
    await stage(page).getByTestId('reader-title').click();
    await page.evaluate(() =>
      window.__harness.emit({
        type: 'jobUpdated',
        job: window.__harness.job({ portal: 'freelancermap', id: '2802' })!,
        fresh: false,
      }),
    );
    await page.waitForTimeout(300);
    expect(await started()).toEqual([]);
  });

  test('"Trotzdem bewerten": the box says the job is being scored until its match is there', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900412');
    await slowDetails(page, 1200);
    await stage(page).getByTestId('reader-include').click();
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.scoring);
    await expect(stage(page).getByTestId('reader-include')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-ring')).toBeVisible({ timeout: 5000 });
    await expect(note).toHaveCount(0);
  });
});

// Carried over from the reader's rounds of fixes: the column, the run card and the trash
// around the reader.
test.describe('around the reader', () => {
  test('one column: the header stays on top while the list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 560 });
    await open(page, WIN);
    // The list scrolls under the header (the column itself does not scroll).
    const scrolled = await page.getByTestId('list-scroll').evaluate((node) => {
      node.scrollTo({ top: 400 });
      return node.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
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
    // The list shows the search's answer, the open job's row among its first hits: the
    // search has judged the open job by then.
    const hits = (await stubList(page, { search })).active.slice(0, 2);
    await expect.poll(async () => (await listed(page)).slice(0, 2)).toEqual(hits);
    await expect(row(page, 'linkedin-100006')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('reader-title')).toHaveText(title);
  });

  test('an empty trash shows one empty state in the list, the reader nothing beside it', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=concept`);
    await page.getByTestId('place-trash').click();
    await expect(page.getByTestId('empty-all').locator('h3')).toHaveText(
      T.list.empty.trash.heading,
    );
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
  });
});

/* ============================================================== what the audit found */

test.describe('the job view keeps true', () => {
  /** The title a row shows. */
  const titleOf = (page: Page, key: string): Promise<string> =>
    row(page, key).locator('.title').innerText();

  test('a preview that is being loaded says so, like a missing ad', async ({ page }) => {
    await openAt(page, 'freelance-900411', `${WIN}&tick=400`);
    // Signed in, the preview can be loaded.
    await stage(page).getByTestId('reader-sign-in').click();
    const load = stage(page).getByTestId('load-ad');
    await load.click();
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.loading);
    await expect(load).toHaveCount(0);
    await runFinished(page);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
  });

  test('a load that ends without the ad says so once, and its box offers it again', async ({
    page,
  }) => {
    const toast = page.getByTestId('toast');
    const note = stage(page).getByTestId('detail-note');
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.detailsEnd = 'nothing'));
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(T.reader.state.notLoaded);
    await expect(note).toHaveText(T.reader.state.missing);
    await expect(stage(page).getByTestId('load-ad')).toBeEnabled();
    // A preview too.
    await openAt(page, 'freelance-900411', `${WIN}&tick=15`);
    await stage(page).getByTestId('reader-sign-in').click();
    await page.evaluate(() => (window.__harness.detailsEnd = 'nothing'));
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(T.reader.state.notLoaded);
    await expect(note).toHaveText(T.reader.state.teaser.heading);
  });

  /** "Anzeige laden" for a job the list does not hold: a search with more hits than a page that
   *  does not find it leaves it open. Resolves once the run has ended like `end`. */
  async function loadNotHeld(page: Page, end: 'nothing' | 'pages'): Promise<void> {
    await open(page, `${WIN}&scenario=many&tick=15`);
    // Its ad is still to come.
    await page.evaluate(() => {
      window.__harness.editDetail = (detail) => ({
        ...detail,
        text: null,
        job: { ...detail.job, detail: { kind: 'pending', retryAt: null } },
      });
    });
    const key = (await listed(page))[0]!;
    await row(page, key).click();
    const title = stage(page).getByTestId('reader-title');
    await expect(title).toBeVisible();
    const words = (await row(page, key).locator('.title').innerText()).startsWith('Reporting')
      ? 'Head of Finance'
      : 'Reporting';
    expect((await stubList(page, { search: words })).jobs.length).toBeGreaterThan(120);
    await page.getByTestId('search').fill(words);
    await expect(row(page, key)).toHaveCount(0);
    await expect(title).toBeVisible();
    await page.evaluate((how) => (window.__harness.detailsEnd = how), end);
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
  }

  test('a job the list does not hold says the same when a load brings no ad', async ({ page }) => {
    await loadNotHeld(page, 'nothing');
    await expect(page.getByTestId('toast')).toContainText(T.reader.state.notLoaded);
  });

  test('a job the list does not hold says nothing when the ad comes', async ({ page }) => {
    await loadNotHeld(page, 'pages');
    expect(await page.getByTestId('toast').count()).toBe(0);
  });

  test('a load that failed says why and no more; one that worked says nothing', async ({
    page,
  }) => {
    const toast = page.getByTestId('toast');
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=15`);
    await page.evaluate(() => (window.__harness.detailsEnd = 'failed'));
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(T.error.text('db', {}));
    // The ad comes: the job's row is as the run left it, its reader follows later.
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=15`);
    await slowDetails(page, 600);
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
    await expect(toast).toHaveCount(0);
    // A preview walks through to the loaded job.
    await openAt(page, 'freelance-900411', `${WIN}&tick=15`);
    await stage(page).getByTestId('reader-sign-in').click();
    await stage(page).getByTestId('load-ad').click();
    await runFinished(page);
    await expect(stage(page).getByTestId('reader-state')).toHaveCount(0);
    await expect(stage(page).getByTestId('ad-text')).toBeVisible();
    await expect(toast).toHaveCount(0);
  });

  test('a search says it loads the ad until it goes on to score', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=15`);
    const note = stage(page).getByTestId('detail-note');
    await page.evaluate(() => {
      window.__harness.holdAfter = 2;
      window.__harness.appRun('fetch');
    });
    await expect(note).toHaveText(T.reader.state.loading);
    // The ads are done, this one did not come.
    await page.evaluate(() =>
      window.__harness.emit({ type: 'progress', step: 'score', portal: null, done: 0, total: 3 }),
    );
    await expect(note).toHaveText(T.reader.state.missing);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
  });

  test('one column: a job that does not load has one Zurück, the top bar', async ({ page }) => {
    await page.setViewportSize({ width: 899, height: 800 });
    await open(page, WIN);
    const back = page.getByRole('button', { name: T.common.back });
    // While a slow job shows its placeholder.
    await slowDetails(page, 1500);
    await rows(page).first().click();
    await expect(stage(page).getByTestId('reader-skeleton')).toBeVisible();
    await expect(back).toHaveCount(1);
    await page.getByTestId('history-back').click();
    await expect(rows(page).first()).toBeVisible();
    // A job that fails: the top bar's closes it too.
    await slowDetails(page, 0);
    await failNext(page, 'job_detail');
    await rows(page).first().click();
    await expect(stage(page).getByTestId('reader-error')).toBeVisible();
    await expect(back).toHaveCount(1);
    await page.getByTestId('history-back').click();
    await expect(rows(page).first()).toBeVisible();
  });

  test('one column: a list that failed says so, also with a job open', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    // The job kept from the last start opens beside a list that does not load.
    await open(page, `${WIN}&scenario=list-error`);
    await expect(page.getByTestId('list-error')).toBeVisible();
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.getByTestId('list-error')).toBeVisible();
    await expect(page.getByRole('button', { name: T.common.retry })).toBeVisible();
  });

  test('the placeholder holds the place of the job: its cards stand where the job has its own', async ({
    page,
  }) => {
    await open(page, WIN);
    const cardTops = (): Promise<number[]> =>
      stage(page)
        .locator('[data-card]')
        .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top));
    await slowDetails(page, 900);
    await row(page, 'freelancermap-2801').click();
    await expect(stage(page).getByTestId('reader-skeleton')).toBeVisible();
    const [hero, second] = await cardTops();
    await expect(stage(page).getByTestId('reader-title')).toBeVisible();
    const job = await cardTops();
    expect(job[0]).toBe(hero);
    expect(job[1]).toBe(second);
  });

  test.describe('Zurück after Endgültig löschen walks what was shown', () => {
    const title = (page: Page): Locator => stage(page).getByTestId('reader-title');
    const named = (page: Page, key: string): Promise<string> =>
      row(page, key).locator('.title').innerText();
    /** The Papierkorb with a few jobs, its rows in their order. */
    const inTrash = async (page: Page): Promise<string[]> => {
      await open(page, WIN);
      for (const key of ['freelancermap-2802', 'freelancermap-2803']) {
        await viaMenu(page, 'trash', key);
        await expect(row(page, key)).toHaveCount(0);
      }
      await openPlace(page, 'trash');
      return listed(page);
    };
    const purgeOpen = async (page: Page): Promise<void> => {
      await choose(page, 'purge');
      await page.getByTestId('dialog-purge').getByTestId('dialog-confirm').click();
    };

    test('the row below opens: no empty step on the way back to the job before', async ({
      page,
    }) => {
      const [one, two, three] = await inTrash(page);
      const [first, third] = [await named(page, one!), await named(page, three!)];
      await openJob(page, one!);
      await openJob(page, two!);
      await purgeOpen(page);
      await expect(title(page)).toHaveText(third);
      await page.getByTestId('history-back').click();
      await expect(title(page)).toHaveText(first);
      await expect(page.getByTestId('place-reader')).toHaveCount(0);
      await page.getByTestId('history-forward').click();
      await expect(title(page)).toHaveText(third);
      await expect(page.getByTestId('history-forward')).toHaveAttribute('aria-disabled', 'true');
    });

    test('the row above opens, which stood open right before: no step shows it twice', async ({
      page,
    }) => {
      const [above, last] = (await inTrash(page)).slice(-2);
      const opened = await named(page, above!);
      await openJob(page, above!);
      await openJob(page, last!);
      await purgeOpen(page);
      await expect(title(page)).toHaveText(opened);
      // What was shown before that: the Papierkorb with no job.
      await page.getByTestId('history-back').click();
      await expect(page.getByTestId('place-reader')).toBeVisible();
      await page.getByTestId('history-forward').click();
      await expect(title(page)).toHaveText(opened);
      await expect(page.getByTestId('history-forward')).toHaveAttribute('aria-disabled', 'true');
    });
  });

  test('another job waiting for its page is not loaded by a details run of its own', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=15`);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.state.missing);
    // Ads load for some other job: this one is not in that run.
    await page.evaluate(() => {
      window.__harness.holdAfter = 2;
      window.__harness.appRun('details');
    });
    await page.waitForTimeout(300);
    await expect(note).toHaveText(T.reader.state.missing);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
    // A search loads what is still to come: this job is waiting for it.
    await page.evaluate(() => {
      window.__harness.holdAfter = 2;
      window.__harness.appRun('fetch');
    });
    await expect(note).toHaveText(T.reader.state.loading);
    await page.evaluate(() => (window.__harness.holdAfter = null));
    await runFinished(page);
  });

  test('a job that loads slowly shows the placeholder, not the job before with its tools', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    await slowDetails(page, 1500);
    await row(page, 'linkedin-4100200301').click();
    await expect(stage(page).getByTestId('reader-skeleton')).toBeVisible();
    await expect(stage(page).getByTestId('reader-title')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(
      await titleOf(page, 'linkedin-4100200301'),
      { timeout: 5000 },
    );
  });

  test('the contact e-mail copies like the name: a drag selects it, a click writes the mail', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const mail = term(page, 'contact').getByTestId('contact-mail');
    await mail.scrollIntoViewIfNeeded();
    const box = (await mail.boundingBox())!;
    const selected = (): Promise<string> =>
      page.evaluate(() => getSelection()?.toString().trim() ?? '');
    // From before its first letter, a narrow one, to after its last.
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(await selected()).toBe('julia.brandt@hanseatic.example');
    expect(await calls(page, 'open_target')).toHaveLength(0);
    // The app's own menu offers Copy on it, like on the name.
    await mail.click({ button: 'right' });
    await expect(page.getByTestId('menu-item-copy')).toBeVisible();
    await page.keyboard.press('Escape');
    // A click without a selection writes the mail.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'contactMail', key: { portal: 'freelancermap', id: '2801' } },
    });
  });

  test('the contact e-mail from the keyboard: Tab reaches it, Enter and Space write the mail', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const mail = term(page, 'contact').getByTestId('contact-mail');
    await mail.focus();
    await page.keyboard.press('Tab');
    await expect(mail).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(mail).toBeFocused();
    const writes = async (): Promise<number> => (await calls(page, 'open_target')).length;
    await page.keyboard.press('Enter');
    await expect.poll(writes).toBe(1);
    await page.keyboard.press('Space');
    await expect.poll(writes).toBe(2);
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'contactMail', key: { portal: 'freelancermap', id: '2801' } },
    });
    await expect(mail).toHaveCSS('outline-style', 'none');
  });

  test('a double click on a text button acts once', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    await stage(page).getByTestId('open-ad').dblclick();
    await term(page, 'contact').getByTestId('contact-mail').dblclick();
    await stage(page).getByTestId('reader-prompt').dblclick();
    await expect.poll(async () => (await calls(page, 'ai_prompt')).length).toBe(1);
    await page.waitForTimeout(300);
    const kinds = (await calls(page, 'open_target')).map(
      ([, args]) => (args as { target: { kind: string } }).target.kind,
    );
    expect(kinds).toEqual(['jobUrl', 'contactMail']);
    expect(await calls(page, 'ai_prompt')).toHaveLength(1);
  });

  test('the verdict mark beside a fact names itself under the pointer', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    const mark = term(page, 'experience').getByTestId('verdict');
    expect(await tip(page, mark)).toBe(T.reader.verdict.partial);
  });

  test('a retry shows no job before the one it loads', async ({ page }) => {
    await openAt(page, 'freelancermap-2801');
    await failNext(page, 'job_detail');
    await row(page, 'linkedin-4100200301').click();
    const failed = stage(page).getByTestId('reader-error');
    await expect(failed).toBeVisible();
    await slowDetails(page, 1000);
    await failed.getByRole('button', { name: T.common.retry }).click();
    await expect(stage(page).getByTestId('reader-title')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(
      await titleOf(page, 'linkedin-4100200301'),
      { timeout: 5000 },
    );
  });
});

test('a drag from the ad over the list lights up no row and brings no tools', async ({ page }) => {
  await openAt(page, 'freelancermap-2801');
  const text = stage(page).getByTestId('ad-text');
  const box = (await text.locator('p').first().boundingBox())!;
  const target = row(page, 'linkedin-4100200301');
  const over = (await target.boundingBox())!;
  const wash = (): Promise<string> =>
    target.evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.mouse.move(1, 1);
  await animationsDone(page);
  const rest = await wash();
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(over.x + over.width / 2, over.y + over.height / 2, { steps: 5 });
  await animationsDone(page);
  expect(await page.locator(':root').getAttribute('data-text-drag')).not.toBeNull();
  expect(await wash()).toBe(rest);
  await expect(target.locator('..').getByTestId('row-tools')).toHaveCount(0);
  // The selection went on over it, and after the release the row answers again.
  expect(await page.evaluate(() => getSelection()?.toString().length)).toBeGreaterThan(0);
  await page.mouse.up();
  await page.mouse.move(over.x + over.width / 2 + 1, over.y + over.height / 2);
  await expect(target.locator('..').getByTestId('row-tools')).toBeVisible();
});
