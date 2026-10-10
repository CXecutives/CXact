// The reader, one structure top to bottom (ui/src/features/jobs/reader-sections.ts): the title,
// the ring or the ban of an excluded job, the four actions and their "…" menu per place, the
// Jobdetails (the order and icons of lib/facts.ts, "/" for what the ad does not say, the value
// and the verdict only, an icon whose tooltip says why), the Anforderungen (only requirements,
// a quiet count, "+" for a missing term, each icon saying why), the ad as plain text with its
// one note (nothing in it
// marked by the rows above), and the switch between two jobs. At the end what the
// reader's rounds of fixes carried around it (one column, the run card, the focus).
//
// The stub's demo profile: a minimum day rate of 1.100 € and a wish of 1.200 €, mostly remote,
// three to five days a week for at least six months, 20 years of experience (Controlling 18),
// no temporary agency work. The page's clock stands at 24.09.2026 09:30.

import type { Locator, Page } from '@playwright/test';
import { demoScore } from './demo';
import { calls, expect, open, runFinished, settle, test } from './fixtures';
import {
  chooseSort,
  failNext,
  listed,
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
  'Gefunden',
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

/** The moves beside the head's x (their ids, their names), the x not among them. */
async function headTools(page: Page): Promise<{ ids: string[]; labels: string[] }> {
  const tools = stage(page)
    .locator('[data-testid="reader-head"] .actions .btn')
    .and(page.locator(':not([data-testid="reader-close"])'));
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

/** The moves of a job that just left the list are off (they would be the new place's). */
async function movesOff(page: Page): Promise<void> {
  const tools = stage(page)
    .locator('[data-testid="reader-head"] .actions .btn')
    .and(page.locator(':not([data-testid="reader-close"])'));
  for (const tool of await tools.all()) {
    await expect(tool).toHaveAttribute('aria-disabled', 'true');
  }
}

/** Every job's details take this long to load (0: at once). */
async function slowDetails(page: Page, ms: number): Promise<void> {
  await page.evaluate((delay) => (window.__harness.detailDelay = delay), ms);
}

test.describe('the head and the match', () => {
  test('the title and its line, then the ring with its band, then the buttons; the rest in Jobdetails', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    // Under the title the job at a glance, like its row (design round 7): company, place, pay.
    await expect(stage(page).getByTestId('reader-company')).toHaveText('Hanseatic Holding GmbH');
    await expect(stage(page).getByTestId('reader-place')).toHaveText('Hamburg');
    for (const id of ['reader-where', 'reader-source']) {
      await expect(stage(page).getByTestId(id)).toHaveCount(0);
    }
    const top = async (id: string): Promise<number> =>
      (await stage(page).getByTestId(id).boundingBox())!.y;
    expect(await top('reader-title')).toBeLessThan(await top('reader-match'));
    expect(await top('reader-match')).toBeLessThan(await top('reader-actions'));
    expect(await top('reader-actions')).toBeLessThan(await top('terms'));
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    // How and when it came: the moment it came into CXact ends the row.
    expect(await cell(page, 'portal')).toEqual([
      `${T.reader.foundBoth('freelancermap.de')}, auch auf linkedin.com, 08:24`,
      '',
    ]);
    // Nothing is joined by a dot, no line says where the job lies, no second bar follows.
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text).not.toContain('·');
    // No info symbol beside the band (user, 2026-10-10): the band says it.
    await expect(stage(page).getByTestId('band-info')).toHaveCount(0);
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

  test('a job without a score: no ring, its state box with its own button, no other buttons', async ({
    page,
  }) => {
    // An ad still to come: no ring, the box with "Anzeige laden", no buttons that show it.
    await openAt(page, 'linkedin-4100200302');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    await expect(stage(page).getByTestId('band')).toHaveCount(0);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.missing);
    await expect(stage(page).getByTestId('load-ad')).toBeVisible();
    await expect(stage(page).getByTestId('reader-actions')).toHaveCount(0);
    await expect(stage(page).getByTestId('band-info')).toHaveCount(0);
    // One too short to score: no ring, the short note as its box, the buttons of its text.
    await openJob(page, 'freelancermap-2806');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    await expect(stage(page).getByTestId('short-note')).toHaveText(T.reader.short);
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

  test('the "×" closes the job at every width; in one column it and Zurück lead back', async ({
    page,
  }) => {
    // Wide: the job view stays and asks for a job (user, 2026-09-29).
    await openAt(page, 'freelancermap-2801');
    const close = stage(page).getByTestId('reader-close');
    await expect(close).toBeVisible();
    await expect(close).toHaveAccessibleName('Schließen');
    await close.click();
    await expect(page.getByTestId('place-reader')).toBeVisible();
    await expect(page.locator('[data-open]')).toHaveCount(0);
    // Its empty state stands in the middle of the job view, like every other empty state.
    const middle = async (id: string): Promise<number> => {
      const box = (await page.getByTestId(id).boundingBox())!;
      return box.y + box.height / 2;
    };
    expect(
      Math.abs((await middle('place-reader')) - (await middle('reader-pane'))),
    ).toBeLessThanOrEqual(2);
    // One column: the × and Zurück lead back to the list; the top bar keeps the job view's
    // button, which closes the job there too, and is dimmed without one.
    await page.setViewportSize({ width: 683, height: 700 });
    await openAt(page, 'freelancermap-2801');
    await expect(page.getByTestId('toggle-reader')).toBeEnabled();
    await stage(page).getByTestId('reader-close').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
    await expect(page.getByTestId('toggle-reader')).toBeDisabled();
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('history-back').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
    await row(page, 'freelancermap-2801').click();
    await page.getByTestId('toggle-reader').click();
    await expect(row(page, 'freelancermap-2801')).toBeVisible();
  });
});

test.describe('the actions', () => {
  test('three buttons alike in one order with their glyphs, the moves of the place beside the x', async ({
    page,
  }) => {
    // A wide window: every button with its words.
    await page.setViewportSize({ width: 1800, height: 900 });
    await openAt(page, 'freelancermap-2801');
    const actions = stage(page).getByTestId('reader-actions');
    const buttons = actions.locator('.btn');
    expect(
      await buttons.evaluateAll((all) => all.map((button) => button.getAttribute('data-testid'))),
    ).toEqual(['open-ad', 'reader-mail', 'reader-prompt']);
    await expect(actions.getByTestId('reader-mail')).toHaveText('Alert-Mail öffnen');
    await expect(actions.getByTestId('open-ad')).toHaveText('Anzeige öffnen');
    await expect(actions.getByTestId('reader-prompt')).toHaveText(T.actions.prompt);
    expect(T.actions.prompt).toBe('Prompt für KI-Bewertung');
    // One variant and one height for all three, each with the glyph of its meaning.
    const looks = await buttons.evaluateAll((all) =>
      all.map((button) => `${button.className.includes('secondary')} ${button.clientHeight}`),
    );
    expect(new Set(looks).size).toBe(1);
    expect(looks[0]).toMatch(/^true /);
    expect(
      await buttons.evaluateAll((all) =>
        all.map((button) => button.querySelector('[data-icon]')?.getAttribute('data-icon')),
      ),
    ).toEqual(['external', 'alertMail', 'copy']);
    // The moves of Aktuell beside the x, quiet like it (no frame, user 2026-10-01), in
    // one row and one size with it; no "…" menu.
    const tools = await headTools(page);
    expect(tools.ids).toEqual(['archive', 'trash']);
    expect(tools.labels).toEqual(['Archivieren', 'Löschen']);
    await expect(stage(page).getByTestId('reader-more')).toHaveCount(0);
    const close = stage(page).getByTestId('reader-close');
    // Löschen only moves the job into the Papierkorb: grey like Archivieren.
    await expect(stage(page).getByTestId('reader-trash')).not.toHaveCSS(
      'color',
      await tokenColour(page, '--danger-strong'),
    );
    for (const id of ['reader-archive', 'reader-trash']) {
      const tool = stage(page).getByTestId(id);
      await expect(tool).toHaveClass(/ghost/);
      await expect(tool).toHaveCSS(
        'border-top-width',
        await close.evaluate((node) => getComputedStyle(node).borderTopWidth),
      );
      const [box, x] = [(await tool.boundingBox())!, (await close.boundingBox())!];
      expect(box.height).toBe(x.height);
      expect(box.y).toBe(x.y);
      expect(box.x).toBeLessThan(x.x);
    }
    // The alert mail and the ad open outside.
    await actions.getByTestId('reader-mail').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'gmail', key: { portal: 'freelancermap', id: '2801' } },
    });
    await actions.getByTestId('open-ad').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
    });
    // Löschen: the job goes to the trash, the next one opens.
    await page.waitForTimeout(550);
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

  test('the action row keeps its words; where they do not fit, it wraps', async ({ page }) => {
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
      { width: 1000, height: 800 },
      { width: 900, height: 800 },
      { width: 480, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await openAt(page, 'freelancermap-2801');
      // Never only an icon: every button keeps its words.
      await expect(stage(page).getByTestId('reader-actions').locator('.icon-only')).toHaveCount(0);
      if (size.width === 1360) await expect.poll(lines).toBe(1);
      else expect(await lines()).toBeLessThanOrEqual(2);
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
    await settleMoves(page);
    await openPlace(page, 'trash');
    await openJob(page, 'linkedin-4100200306');
    tools = await headTools(page);
    expect(tools.ids).toEqual(['restore', 'purge']);
    expect(tools.labels).toEqual(['Wiederherstellen', 'Endgültig löschen']);
    await choose(page, 'purge');
    const dialog = page.getByTestId('dialog-purge');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Endgültig löschen' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
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
      await settleMoves(page);
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

  test('a job that just moved away offers no moves while the next one loads', async ({ page }) => {
    // Opening a job waits for every animation, the toast's of each move too.
    test.setTimeout(60_000);
    await open(page, WIN);
    const best = 'Interim CFO für Familienunternehmen';
    // Löschen of the open job in Aktuell: while the next one loads the reader shows the
    // job that went to the Papierkorb, and its moves are off (never the Papierkorb's here).
    await openJob(page, 'freelancermap-2801');
    await settleMoves(page);
    await slowDetails(page, 1500);
    await choose(page, 'trash');
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    await movesOff(page);
    // The next job of Aktuell: Aktuell's moves.
    await expect(stage(page).getByTestId('reader-title')).not.toHaveText(best, { timeout: 5000 });
    await slowDetails(page, 0);
    await settleMoves(page);
    expect(await moves(page)).toEqual(['archive', 'trash']);
    // Rückgängig brings it back and opens it again: Aktuell's moves again.
    await page.getByTestId('toast-action').click();
    await expect(stage(page).getByTestId('reader-title')).toHaveText(best);
    await settleMoves(page);
    expect(await moves(page)).toEqual(['archive', 'trash']);
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
    await choose(page, 'restore');
    await expect(row(page, 'freelancermap-2803')).toHaveCount(0);
    await movesOff(page);
    await expect(stage(page).getByTestId('reader-title')).toHaveText(next, { timeout: 5000 });
    await slowDetails(page, 0);
    await settleMoves(page);
    expect(await moves(page)).toEqual(['restore', 'purge']);
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
    await expect(page.getByTestId('toast').last()).toContainText(
      'Der Prompt ließ sich nicht kopieren.',
    );
    await expect(stage(page).getByTestId('reader-error')).toHaveCount(0);
  });

  test('hiding the job view closes its job; a job chosen shows it again', async ({ page }) => {
    await open(page, WIN);
    await row(page, 'freelancermap-2801').click();
    const toggle = page.getByTestId('toggle-reader');
    await toggle.click();
    await expect(page.getByTestId('reader-pane')).toHaveCount(0);
    await expect(page.locator('[data-open]')).toHaveCount(0);
    // The list takes the whole width, the top bar's line goes with the job view.
    await expect(page.getByTestId('title-bar-seam')).toHaveCount(0);
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
    await page.waitForTimeout(550);
    await page.getByTestId('reader-archive').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-archive')).toBeFocused();
  });
});

test.describe('an excluded job', () => {
  test('the ban instead of the ring, why in one sentence, scored anyway and back', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900412');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    // One bordered box: the ban, Ausgeschlossen, why and Trotzdem bewerten at its end.
    const box = stage(page).getByTestId('exclusion-box');
    await expect(box.getByTestId('reader-ban').locator('svg')).toHaveCount(1);
    await expect(box.getByTestId('reader-include')).toBeVisible();
    await expect(stage(page).getByTestId('band')).toHaveText('Ausgeschlossen');
    // Its first violation, once, from the profile's side; no way into the ad.
    await expect(stage(page).getByTestId('exclusion')).toHaveText(T.reader.criterion.noAnue);
    await expect(stage(page).getByTestId('show-in-ad')).toHaveCount(0);
    // The head says why: no verdicts in the rows and no Anforderungen (user, 2026-10-03).
    expect(await cell(page, 'contract')).toEqual(['Zeitarbeit', '']);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    expect(await cell(page, 'experience')).toEqual(['3 Jahre', '']);
    await expect(why(page)).toHaveCount(0);
    // The ban and the word in the red of a danger, on the neutral box of every state.
    await expect(box.getByTestId('reader-ban')).toHaveCSS(
      'color',
      await tokenColour(page, '--ban'),
    );
    await expect(stage(page).getByTestId('band')).toHaveCSS(
      'color',
      await tokenColour(page, '--ban'),
    );
    await expect(box).toHaveCSS('background-color', await tokenColour(page, '--surface-muted'));
    // Trotzdem bewerten (with its plus): its real match and a toast that takes it back. No
    // other button while it is excluded (user, 2026-10-10); the head has the moves of its
    // place.
    const include = stage(page).getByTestId('reader-include');
    await expect(include).toHaveText(T.actions.include);
    await expect(include.locator('[data-icon]')).toHaveAttribute('data-icon', 'add');
    await expect(stage(page).getByTestId('reader-actions')).toHaveCount(0);
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
    await expect(toast.getByTestId('toast-action')).toHaveText('Rückgängig');
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
  test('the rows in their order with an icon each; a row the ad says nothing of only with a verdict', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText('Jobdetails');
    // The ad says nothing of its workload and nothing judges it: no row "–".
    const shown = ROWS.filter((name) => name !== 'Auslastung');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(shown);
    expect(await terms(page).locator('.term-name .icon svg').count()).toBe(shown.length);
    expect(await cell(page, 'company')).toEqual(['Hanseatic Holding GmbH', '']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'met']);
    expect(await cell(page, 'mode')).toEqual(['60 % remote', 'met']);
    expect(await cell(page, 'contract')).toEqual(['Interim', 'met']);
    // The value and the verdict only: how it stands to the minimum is the tooltip's.
    expect(await cell(page, 'rate')).toEqual(['1.200 €/Tag', 'met']);
    expect(await cell(page, 'start')).toEqual(['ab sofort', 'met']);
    expect(await cell(page, 'duration')).toEqual(['6 Monate', 'met']);
    await expect(term(page, 'workload')).toHaveCount(0);
    // How and when it came: the moment it came into CXact ends the row, quietly.
    expect(await cell(page, 'portal')).toEqual([
      `${T.reader.foundBoth('freelancermap.de')}, auch auf linkedin.com, 08:24`,
      '',
    ]);
    await expect(term(page, 'portal').locator('.value')).toHaveClass(/quiet/);
    // No row "Eingegangen" (user, 2026-10-01): the moment stands in "Gefunden".
    await expect(term(page, 'received')).toHaveCount(0);
    // Verdicts are icons (no words), why in their tooltip: the reason that decided one (the
    // wish met), else why its criterion is met.
    await expect(terms(page)).not.toContainText('passt');
    await expect(terms(page)).not.toContainText('Minimum');
    await expect(term(page, 'rate').getByTestId('verdict').locator('.reason')).toHaveAttribute(
      'aria-label',
      'Erfüllt',
    );
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
    // One glyph per verdict.
    expect(new Set([met[1], unknown[1], partial[1]]).size).toBe(3);
  });

  test('the verdicts stand in one column between the names and the values, in the requirements metrics', async ({
    page,
  }) => {
    await openAt(page, 'freelancermap-2801');
    const boxes = await terms(page).evaluate((list) =>
      [...list.querySelectorAll('li.term')].map((li) => {
        const line = li.querySelector('.term-line')!;
        return {
          key: li.getAttribute('data-row'),
          start: line.getBoundingClientRect().left,
          verdict:
            li.querySelector('[data-testid="verdict"]')?.getBoundingClientRect().left ?? null,
        };
      }),
    );
    // One column for every verdict, before every value: the values start on one line too,
    // with or without a verdict (the names are the same for every job, so nothing moves).
    const judged = boxes.filter((box) => box.verdict !== null);
    expect(new Set(judged.map((box) => Math.round(box.verdict!))).size).toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box.start))).size).toBe(1);
    expect(Math.round(judged[0]!.verdict!)).toBeLessThan(Math.round(boxes[0]!.start));
    // A job without a score keeps the verdicts' column: its values start at the same place.
    const starts = (): Promise<number[]> =>
      terms(page)
        .locator('.term-line')
        .evaluateAll((all) => all.map((node) => Math.round(node.getBoundingClientRect().left)));
    const scored = await starts();
    await openJob(page, 'freelancermap-2806');
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    expect(new Set(await starts())).toEqual(new Set([scored[0]]));
    await openJob(page, 'freelancermap-2801');
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
    // In the type of the name and the phone around it.
    const size = (node: Element) => getComputedStyle(node).fontSize;
    expect(await mail.evaluate(size)).toBe(await parts.first().evaluate(size));
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
    // An ad that names neither: nothing judges them, so no rows.
    await openJob(page, 'freelancermap-2804');
    await expect(term(page, 'deadline')).toHaveCount(0);
    await expect(term(page, 'contact')).toHaveCount(0);
  });

  test('one form per fact: a start date, a workload, pay near the wish, the work mode', async ({
    page,
  }) => {
    await openAt(page, 'freelance-900413');
    expect(await cell(page, 'start')).toEqual(['ab 01.11.', 'met']);
    expect(await cell(page, 'workload')).toEqual(['2 Tage/Woche', 'partial']);
    // Above the minimum, near the wish: met in part, and the tooltip names the wish.
    expect(await cell(page, 'rate')).toEqual(['1.150 €/Tag', 'partial']);
    expect(await cell(page, 'mode')).toEqual(['Vor Ort', 'partial']);
    expect(await cell(page, 'place')).toEqual(['München', 'partial']);
    // A limit missed is met in part; a rate to be agreed has nothing to judge, nor a note.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'duration')).toEqual(['3 Monate', 'partial']);
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

  test('Erfahrung says what its requirement says among the Anforderungen', async ({ page }) => {
    // 15 years of Controlling against the profile's 18, the requirement met in part for its
    // skill: the row and the Anforderungen say the same.
    await openAt(page, 'freelancermap-2801');
    expect(await cell(page, 'experience')).toEqual(['15 Jahre', 'partial']);
    await expect(why(page).getByTestId('reasons-partial')).toContainText(
      'Mindestens 15 Jahre Berufserfahrung im Controlling',
    );
    // Ten years of a field the profile does not name: nothing judges the years (no icon),
    // the requirement stands under "Nicht erfüllt" and says why.
    await openJob(page, 'linkedin-4100200304');
    expect(await cell(page, 'experience')).toEqual(['10 Jahre', '']);
    const open = why(page).getByTestId('reasons-open');
    await expect(open).toContainText('Mindestens 10 Jahre Berufserfahrung im Rechnungswesen');
    // A working student job: its level by its word; it is excluded, so no verdict.
    await openJob(page, 'freelancermap-2807');
    expect(await cell(page, 'experience')).toEqual([T.facts.level('student')!, '']);
  });

  test('no verdict icon has a tooltip, in the Jobdetails and among the Anforderungen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await openAt(page, 'freelancermap-2801');
    for (const key of ['freelancermap-2801', 'freelance-900413', 'linkedin-4100200304']) {
      await openJob(page, key);
      const icons = stage(page).locator('[data-testid="verdict"] .reason');
      const count = await icons.count();
      expect(count, key).toBeGreaterThan(1);
      // The Anforderungen: the group's heading says the verdict, no tooltip on the icon.
      const requirement = stage(page).locator('[data-testid="why"] [data-testid="reason"]').first();
      if ((await requirement.count()) > 0) {
        await requirement.scrollIntoViewIfNeeded();
        await requirement.hover();
        await page.waitForTimeout(700);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
      }
      // The Jobdetails' icons neither (user, 2026-09-28): their place says enough.
      const icon = icons.first();
      await icon.scrollIntoViewIfNeeded();
      await icon.hover();
      await page.waitForTimeout(700);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.mouse.move(0, 0);
    }
  });

  test('pay and duration as the ad states them, the tooltip by the amount the rule compares', async ({
    page,
  }) => {
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
    // An hourly rate: per hour in the row, what it makes a day in the tooltip; weeks stay
    // weeks, and a range of months shows both ends.
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
    expect(names[4]).toBe('Gehalt');
    expect(await cell(page, 'rate')).toEqual(['95.000 €/Jahr', '']);
    expect(await cell(page, 'duration')).toEqual(['unbefristet', '']);
    // The ad states the type and the profile takes permanent jobs: met, not "unklar".
    expect(await cell(page, 'contract')).toEqual(['Festanstellung', 'met']);
    // The ad names no experience and nothing judges it: no row.
    await expect(term(page, 'experience')).toHaveCount(0);
  });

  test('an ad the app never read in full shows only what it knows', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(['Unternehmen', 'Ort', 'Arbeitsmodell', 'Gefunden']);
    // Its way and its source: the alert mail of LinkedIn.
    const [found] = await cell(page, 'portal');
    expect(found).toMatch(/^Alert-Mail von linkedin\.com, \S/);
    await expect(terms(page)).not.toContainText('/');
    // A preview: no "/" claims the ad says nothing.
    await openJob(page, 'freelance-900411');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual([
      'Unternehmen',
      'Ort',
      'Arbeitsmodell',
      'Vertragsart',
      'Gefunden',
    ]);
    await expect(terms(page).locator('.value.missing')).toHaveCount(0);
  });

  test('a job the engine could not score shows no verdicts', async ({ page }) => {
    await openAt(page, 'freelancermap-2806');
    await expect(stage(page).getByTestId('short-note')).toHaveText(T.reader.short);
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    await expect(why(page)).toHaveCount(0);
  });

  test('without a profile: the values without verdicts, no ring, no requirements', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-match')).toHaveCount(0);
    // Without verdicts no row says "–": what the ad states, and how it came.
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names).toEqual(ROWS.filter((name) => names.includes(name)));
    expect(names).toEqual(expect.arrayContaining(['Unternehmen', 'Gefunden']));
    await expect(terms(page).locator('.value.missing')).toHaveCount(0);

    await expect(terms(page).getByTestId('verdict')).toHaveCount(0);
    const columns = await terms(page).evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(2);
    await expect(why(page)).toHaveCount(0);
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
    // Untagged is Pflicht: the only tag is the quiet word "optional", no pill, and only on a
    // requirement that is not met.
    expect(new Set(await why(page).locator('.optional').allInnerTexts())).toEqual(
      new Set([T.reason.optional]),
    );
    await expect(why(page).getByTestId('reasons-met').locator('.optional')).toHaveCount(0);
    await expect(why(page).locator('.optional').first()).toHaveCSS(
      'color',
      await tokenColour(page, '--text-subtle'),
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
    // A quiet check takes the place of the red cross and the "+" goes, no word: one icon on
    // the row. The toast says it, with the term alone (without the ad's "Branchenerfahrung").
    const added = missing.getByTestId('reason-settled');
    await expect(added).toHaveAttribute('aria-label', T.reader.added);
    await expect(added.locator('svg')).toHaveCount(1);
    await expect(added).toHaveText('');
    await expect(missing.getByTestId('add-to-profile')).toHaveCount(0);
    await expect(missing.locator('svg')).toHaveCount(1);
    await expect(added).toHaveCSS('color', await tokenColour(page, '--text-subtle'));
    const toast = page.getByTestId('toast').last();
    await expect(toast).toContainText(T.reader.addedToProfile('Energie'));
    // The term is among the profile's industries, saved; not among its keywords.
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-industries')).toContainText('Energie');
    await expect(page.getByTestId('profile-industries')).not.toContainText('Branchenerfahrung');
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
    // A requirement the ad words as a sentence cannot go into the profile.
    await page.getByTestId('nav-jobs').click();
    await openJob(page, 'freelancermap-2804');
    const sentence = why(page).getByTestId('reasons-open').locator('li').first();
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
    // Small and bold: the text's size, a heavier weight.
    const [weight, size] = await headings
      .first()
      .evaluate((node) => [getComputedStyle(node).fontWeight, getComputedStyle(node).fontSize]);
    expect(Number(weight)).toBeGreaterThanOrEqual(480);
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
    await expect(hits.first()).toHaveCSS(
      'background-color',
      await tokenColour(page, '--mark-search'),
    );
    await search.fill('');
    await expect(hits).toHaveCount(0);
  });

  test('a preview says so once, here, with its sign-in right there', async ({ page }) => {
    await openAt(page, 'freelance-900411');
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.teaser);
    // Like every info notice: its sign navy, its words ink, in the box under the head.
    const box = stage(page).getByTestId('reader-state');
    await expect(note).toHaveCSS('color', await tokenColour(page, '--text'));
    await expect(box.locator('svg').first()).toHaveCSS('color', await tokenColour(page, '--info'));
    const text = await stage(page).getByTestId('reader').innerText();
    expect(text.split('Vorschau').length - 1).toBe(1);
    await expect(stage(page).getByTestId('preliminary')).toHaveCount(0);
    // "Anmelden", as high as the reader's other buttons.
    const signIn = stage(page).getByTestId('reader-sign-in');
    await expect(signIn).toHaveText(T.settings.signIn);
    expect((await signIn.boundingBox())!.height).toBe(
      (await stage(page).getByTestId('open-ad').boundingBox())!.height,
    );
    // A sign-in that fails says so; the job stays.
    await failNext(page, 'portal_login');
    await signIn.click();
    await expect(page.getByTestId('toast-text')).toHaveText('Die Datenbank meldet einen Fehler.');
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

  test('a missing ad: "Anzeige laden" loads it, meanwhile it is being loaded', async ({ page }) => {
    await openAt(page, 'linkedin-4100200302', `${WIN}&tick=400`);
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.missing);
    const load = stage(page).getByTestId('load-ad');
    await expect(load).toHaveText('Anzeige laden');
    const box = stage(page).getByTestId('reader-state');
    const height = (await box.boundingBox())!.height;
    await load.click();
    expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
      kind: 'details',
      keys: [{ portal: 'linkedin', id: '4100200302' }],
    });
    // A spinner where the box's sign stood, the box as high as before.
    await expect(note).toHaveText(T.reader.adNote.loading);
    await expect(box.locator('.spinner')).toHaveCount(1);
    await expect(load).toHaveCount(0);
    expect((await box.boundingBox())!.height).toBe(height);
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

  test('a closed ad says so in the state box as a warning, nothing in the title', async ({
    page,
  }) => {
    await openAt(page, 'linkedin-4100200304');
    const note = stage(page).getByTestId('detail-note');
    await expect(note).toHaveText(T.reader.adNote.closed);
    await expect(stage(page).getByTestId('reader-state')).toHaveClass(/warning/);
    await expect(stage(page).locator('.head')).not.toContainText('Bewerbung');
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
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.adNote.closed);
    await expect(term(page, 'portal').locator('.term-note')).toHaveCount(0);
    // Gone before its text came: only the sentence, no button (nothing of it to show).
    await page.evaluate(() => window.__harness.gone({ portal: 'linkedin', id: '4100200302' }));
    await openJob(page, 'linkedin-4100200302');
    await expect(stage(page).getByTestId('open-ad')).toHaveCount(0);
    await expect(term(page, 'portal').locator('.term-note')).toHaveCount(0);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(T.reader.adNote.gone);
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

test('switching jobs puts the new one in place at once: nothing fades, nothing flashes', async ({
  page,
}) => {
  await openAt(page, 'freelancermap-2801');
  // Every frame from the click on: the stages there and how opaque they are.
  await page.evaluate(() => {
    const seen = { frames: [] as string[] };
    (window as unknown as { __stages: typeof seen }).__stages = seen;
    const until = performance.now() + 700;
    const look = (): void => {
      const all = [...document.querySelectorAll('.stage')];
      seen.frames.push(all.map((stage) => getComputedStyle(stage).opacity).join(' '));
      if (performance.now() < until) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await row(page, 'freelancermap-2802').click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText('Interim Head of Finance');
  await page.waitForTimeout(700);
  const seen = await page.evaluate(
    () => (window as unknown as { __stages: { frames: string[] } }).__stages,
  );
  // One stage in every frame, always opaque: never two, never a blank pane.
  expect(new Set(seen.frames)).toEqual(new Set(['1']));
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
    await open(page, `${WIN}&scenario=empty`);
    await page.getByTestId('place-trash').click();
    await expect(page.getByTestId('empty-place-trash')).toHaveText(T.place.empty.trash);
    await expect(page.getByTestId('place-reader')).toHaveCount(0);
  });
});
