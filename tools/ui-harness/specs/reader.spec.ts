// The reader, one structure top to bottom (ui/src/features/jobs/reader-sections.ts): the head
// with the must count said once, the actions and their "…" menu, the exclusion box with every
// reason, the Konditionen (terms.ts: only the ad's side, the verdict with its reason, the order
// and icons of the facts table), the Anforderungen with the way of a missing must into the
// profile, the ad whose passages link both ways, and the special cases (preview, details to
// come, no profile, offline, trash). At the end what the reader's rounds of fixes carried
// around it (one column, the run card, the focus).
//
// The stub's demo profile: a minimum day rate of 1.100 € and a wish of 1.200 €, mostly remote,
// three to five days a week for at least six months, 15 years of experience, no temporary
// agency work.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, open, runFinished, settle, test } from './fixtures';

const WIN = '?platform=windows';
const list = (page: Page) => page.getByTestId('job-list');
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const facet = (page: Page, name: string) =>
  page.getByTestId('facet').getByRole('radio', { name: new RegExp(name) });
// The open job's stage (the one on its way out has dropped its test id).
const stage = (page: Page) => page.getByTestId('stage');
const terms = (page: Page) => stage(page).getByTestId('criteria');
const term = (page: Page, key: string) => terms(page).getByTestId(`term-${key}`);

/** The rows of the Konditionen in the order of the facts table (lib/facts.ts). */
const ROWS = [
  'Vertragsart',
  'Tagessatz',
  'Start',
  'Laufzeit',
  'Auslastung',
  'Remote',
  'Ort',
  'Erfahrung',
];
const VERDICTS = ['', 'passt', 'passt teilweise', 'passt nicht', 'prüfen', 'offen'];

/** Opens a job from "Alle" and waits until the reader shows it. */
async function show(page: Page, key: string): Promise<void> {
  const target = row(page, key);
  // An excluded job lies in the folded section at the end of the list.
  if ((await target.count()) === 0) await page.getByTestId('excluded-divider').click();
  await target.click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await target.locator('.title').innerText(),
  );
  await animationsDone(page);
}

async function openJob(page: Page, key: string, query = WIN): Promise<void> {
  await open(page, query);
  await facet(page, 'Alle|All').click();
  await show(page, key);
}

async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((token) => {
    const probe = document.createElement('span');
    probe.style.setProperty('color', `var(${token})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

const words = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The value and the verdict of a row of the Konditionen. */
async function cell(page: Page, key: string): Promise<[string, string]> {
  const target = term(page, key);
  const verdict = target.locator('.verdict');
  return [
    words(await target.locator('.term-line').textContent()),
    (await verdict.count()) === 0 ? '' : words(await verdict.textContent()),
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

test.describe('the head and the match', () => {
  test('title, company and place, portal and time, the other portal as plain words', async ({
    page,
  }) => {
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-facts')).toHaveText(
      'Hanseatic Holding GmbH · Hamburg',
    );
    const source = stage(page).getByTestId('reader-source');
    await expect(source).toContainText('freelancermap');
    await expect(source).toContainText('vor 2 Stunden');
    // The time names the exact moment in its tooltip.
    expect(await tip(page, stage(page).getByTestId('reader-when'))).toMatch(
      /^Alert-Mail vom 24\.09\.2026 um \d\d:\d\d$/,
    );
    // "auch auf …" says where else the job was announced; it opens nothing (the other portal's
    // ad is not known, "Anzeige öffnen" opens this one).
    const also = stage(page).getByTestId('also-linkedin');
    await expect(also).toHaveText('auch auf linkedin.com');
    await expect(source.getByRole('button')).toHaveCount(0);
    // The ring stands beside the band line, the must count beside the band, once.
    await expect(stage(page).getByTestId('band')).toHaveText('Hohe Passung');
    await expect(stage(page).getByTestId('must')).toHaveText('4 von 4 Pflichtpunkten erfüllt');
    const text = (await stage(page).getByTestId('reader').innerText()) ?? '';
    expect(text.split('Pflichtpunkten erfüllt').length - 1).toBe(1);
    await expect(stage(page).getByTestId('requirements')).toHaveCount(0);
    const ring = (await stage(page).getByTestId('reader-ring').boundingBox())!;
    const band = (await stage(page).getByTestId('band').boundingBox())!;
    const lines = (await stage(page).locator('.match .lines').boundingBox())!;
    expect(lines.x).toBeGreaterThanOrEqual(ring.x + ring.width);
    expect(band.y).toBeGreaterThanOrEqual(ring.y - 1);
    expect(band.y + band.height).toBeLessThanOrEqual(ring.y + ring.height + 1);
  });

  test('opening a job fills the ring, its number stands at once', async ({ page }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
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
    await expect(stage(page).getByTestId('reader-ring')).toContainText('91');
    await page.waitForTimeout(600);
    const seen = await page.evaluate(() => (window as unknown as { __ring: string[] }).__ring);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['91']));
  });

  test('the text is said once: a preview, few requirements, a text too short', async ({ page }) => {
    // A score from a preview: one quiet line; the way to the sign-in stands with the ad's note.
    await openJob(page, 'freelance-900411');
    await expect(stage(page).getByTestId('preliminary')).toHaveText('Vorläufig, nur Vorschau');
    await expect(stage(page).getByTestId('set-up-sign-in')).toHaveCount(1);
    await expect(stage(page).getByTestId('detail-note')).toHaveText(
      'Ohne Anmeldung zeigt freelance.de nur eine Vorschau.',
    );
    await expect(stage(page).getByTestId('reader')).not.toContainText('Anriss');
    // A full text with few clear requirements: the head says it, the lists do not.
    await show(page, 'freelancermap-2804');
    await expect(stage(page).getByTestId('low-evidence')).toHaveText(
      'Die Anzeige nennt wenige klare Anforderungen, die Passung bleibt grob.',
    );
    await expect(stage(page).getByTestId('why')).not.toContainText('wenige klare');
    // Too little text to score: muted, not the colour of a low score, and why.
    await show(page, 'freelancermap-2806');
    const band = stage(page).getByTestId('band');
    await expect(band).toHaveText('Nicht bewertbar');
    await expect(band).toHaveCSS('color', await tokenColour(page, '--text-muted'));
    await expect(stage(page).getByTestId('unscorable')).toHaveText(
      'Zu wenig Text für eine Bewertung.',
    );
    // The preview's note leads to the sign-in in Einstellungen.
    await show(page, 'freelance-900411');
    await stage(page).getByTestId('set-up-sign-in').click();
    await expect(page.getByTestId('view-settings')).toBeVisible();
  });

  test('an ad the app never read: scored once it is there, no Konditionen, "Details holen"', async ({
    page,
  }) => {
    await openJob(page, 'linkedin-4100200302');
    const band = stage(page).getByTestId('band');
    await expect(band).toHaveText('Wird bewertet, sobald die Anzeige da ist');
    await expect(band).toHaveCSS('color', await tokenColour(page, '--text-muted'));
    // What an unread ad says is not known: no table, no "offen".
    await expect(stage(page).getByTestId('terms')).toHaveCount(0);
    await expect(stage(page).getByTestId('reader')).not.toContainText('offen');
    await expect(stage(page).getByTestId('detail-note')).toHaveText('Die Anzeige fehlt noch.');
    const fetch = stage(page).getByTestId('fetch-details');
    await expect(fetch).toHaveText('Details holen');
    await fetch.click();
    expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
      kind: 'details',
      keys: [{ portal: 'linkedin', id: '4100200302' }],
    });
    // Details that could not be fetched: no table either.
    await show(page, 'freelancermap-2805');
    await expect(stage(page).getByTestId('terms')).toHaveCount(0);
  });

  test('a closed ad says so like its badge, when the app last looked in the tooltip', async ({
    page,
  }) => {
    await openJob(page, 'linkedin-4100200304');
    const line = stage(page).getByTestId('offline-line');
    await expect(line).toHaveText('Keine Bewerbung mehr möglich');
    expect(await tip(page, line.locator('span'))).toMatch(/^Zuletzt geprüft /);
    // The trash says what the trash says; its own actions stay named, the menu has no trash.
    await row(page, 'freelancermap-2803').hover();
    await page.getByTestId('trash-freelancermap-2803').click();
    await page.waitForTimeout(550);
    await page.getByTestId('place-trash').click();
    await settle(page);
    await show(page, 'freelancermap-2803');
    await expect(stage(page).getByTestId('place-line')).toHaveText(
      'Im Papierkorb, wird in 30 Tagen endgültig gelöscht',
    );
    // Where the labels do not fit the row (WebKit keeps the room of its scrollbar), they are
    // icon buttons with the same names.
    await expect(stage(page).getByTestId('reader-restore')).toHaveAccessibleName(
      'Wiederherstellen',
    );
    await expect(stage(page).getByTestId('reader-purge')).toHaveAccessibleName('Endgültig löschen');
    await stage(page).getByTestId('reader-more').click();
    await expect(page.getByTestId('menu-item-trash')).toHaveCount(0);
  });
});

test.describe('the actions', () => {
  test('the ad strongest, Favorit and Archivieren labelled, the rest in "…"', async ({ page }) => {
    await openJob(page, 'freelancermap-2801');
    const actions = stage(page).getByTestId('reader-actions');
    expect(
      await actions
        .locator('.btn')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid'))),
    ).toEqual(['open-ad', 'reader-pin', 'reader-archive', 'reader-more']);
    await expect(actions.getByTestId('open-ad')).toHaveText('Anzeige öffnen');
    await expect(actions.getByTestId('open-ad')).toHaveClass(/secondary/);
    await expect(actions.getByTestId('reader-pin')).toHaveText('Favorit');
    await expect(actions.getByTestId('reader-archive')).toHaveText('Archivieren');
    for (const id of ['reader-pin', 'reader-archive', 'reader-more']) {
      await expect(actions.getByTestId(id)).toHaveClass(/ghost/);
    }
    // The "…" menu: the alert mail, the prompt and the trash with its key; nothing removed.
    await actions.getByTestId('reader-more').click();
    const menu = page.getByTestId('menu');
    await expect(menu).toBeVisible();
    expect(
      await menu
        .locator('[data-testid^="menu-item-"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid'))),
    ).toEqual(['menu-item-mail', 'menu-item-prompt', 'menu-item-trash']);
    await expect(menu.getByTestId('menu-item-mail')).toContainText('Alert-Mail öffnen');
    await expect(menu.getByTestId('menu-item-prompt')).toContainText('KI-Prompt kopieren');
    await expect(menu.getByTestId('menu-item-trash')).toContainText('In den Papierkorb');
    await expect(menu.getByTestId('menu-item-trash').locator('.keys')).toHaveText('Entf');
    await expect(menu).not.toContainText('ungelesen');
    await menu.getByTestId('menu-item-mail').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'gmail', key: { portal: 'freelancermap', id: '2801' } },
    });
    // From the keyboard: the first entry is active at once, the focus comes back after it.
    await actions.getByTestId('reader-more').focus();
    await page.keyboard.press('Enter');
    await expect(menu.getByTestId('menu-item-mail')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(actions.getByTestId('reader-more')).toBeFocused();
    // "Anzeige öffnen" opens this portal's ad.
    await actions.getByTestId('open-ad').click();
    expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
      target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
    });
    // In den Papierkorb: the job goes, the next one opens.
    await page.waitForTimeout(550);
    await actions.getByTestId('reader-more').click();
    await page.getByTestId('menu-item-trash').click();
    expect((await calls(page, 'move_jobs')).at(-1)?.[1]).toEqual({
      keys: [{ portal: 'freelancermap', id: '2801' }],
      to: 'trash',
    });
    await expect(row(page, 'freelancermap-2801')).toHaveCount(0);
    // One line, also at the narrowest window (the labels step back to icons).
    for (const size of [
      { width: 1360, height: 900 },
      { width: 480, height: 360 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () =>
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
            ),
        )
        .toBe(1);
    }
  });

  for (const width of [900, 960, 1000, 1100]) {
    test(`the action row stays one line at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, WIN);
      await facet(page, 'Alle').click();
      await rows(page).first().click();
      // The buttons differ in height: one line is one axis.
      const middle = async (id: string): Promise<number> => {
        const box = await page.getByTestId(id).boundingBox();
        return box === null ? -1 : Math.round(box.y + box.height / 2);
      };
      await expect
        .poll(async () => (await middle('reader-more')) === (await middle('open-ad')))
        .toBe(true);
    });
  }

  test('icon-only buttons draw 16 px glyphs and their tooltips name the key', async ({ page }) => {
    await openJob(page, 'freelancermap-2802');
    // Close names Esc (beside the list, where the reader has its close).
    expect(await tooltipOf(page, stage(page).getByTestId('reader-close'))).toEqual([
      'Schließen',
      'Esc',
    ]);
    // Where the labels do not fit, the actions are icons that name their keys.
    await page.setViewportSize({ width: 480, height: 360 });
    const archive = stage(page).getByTestId('reader-archive');
    await expect(archive).toHaveClass(/icon-only/);
    const size = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--icon-sm').trim(),
    );
    const glyph = (await archive.locator('.icon').boundingBox())!;
    expect(`${glyph.width}px`).toBe(size);
    expect(await tooltipOf(page, archive)).toEqual(['Archivieren', 'E']);
    // The star is named like the row's.
    const pin = stage(page).getByTestId('reader-pin');
    await expect(pin).toHaveAccessibleName('Als Favorit markieren');
    expect(await tooltipOf(page, pin)).toEqual(['Als Favorit markieren', 'S']);
  });

  test('closing a job from the reader hands the focus to its row', async ({ page }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
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

  test('archiving from the reader keeps the focus on Archivieren of the next job', async ({
    page,
  }) => {
    await open(page, WIN);
    await facet(page, 'Alle').click();
    await rows(page).first().click();
    const first = await page.getByTestId('reader-title').textContent();
    await page.getByTestId('reader-archive').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('reader-title')).not.toHaveText(first ?? '');
    await expect(page.getByTestId('reader-archive')).toBeFocused();
  });
});

test.describe('the exclusion', () => {
  test('a calm box with every reason, its passage, include anyway and back', async ({ page }) => {
    await openJob(page, 'freelance-900412');
    const box = stage(page).getByTestId('exclusion-box');
    // Every violation once, in its own words: the agency work and the junior role.
    await expect(box.getByTestId('exclusion')).toHaveText([
      'Die Anzeige nennt Zeitarbeit.',
      'Der Job verlangt 3 Jahre Erfahrung, das Profil zielt auf 15 Jahre.',
    ]);
    // Not again among the requirements.
    await expect(stage(page).getByTestId('why')).not.toContainText('Zeitarbeit');
    await expect(stage(page).getByTestId('why')).not.toContainText('Ausgeschlossen');
    // Calm: no red wash behind it.
    const wash = await box.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(wash).toBe(await tokenColour(page, '--surface-muted'));
    expect(wash).not.toBe(await tokenColour(page, '--danger-soft'));
    // The passage that excludes the job is red, never the green of the contract type.
    const passage = page.getByTestId('ad-text').locator('mark', {
      hasText: 'Arbeitnehmerüberlassung',
    });
    await expect(passage).toHaveClass(/violation/);
    await box.getByTestId('show-in-ad').first().click();
    // The pointer steps aside: a passage that scrolls under it would take the light.
    await page.mouse.move(0, 0);
    await expect(page.locator('mark.active').first()).toContainText('Arbeitnehmerüberlassung');
    await expect(page.locator('mark.active').first()).toBeInViewport();
    // The contract row carries the verdict.
    expect(await cell(page, 'contract')).toEqual(['Zeitarbeit', 'passt nicht']);
    // Include it anyway: the reasons stay, the box says so quietly, the focus is on the way back.
    await box.getByTestId('override').click();
    await expect(box.getByTestId('overridden')).toHaveText('Manuell einbezogen');
    await expect(box.getByTestId('exclusion')).toHaveCount(2);
    await expect(stage(page).getByTestId('override-undo')).toBeFocused();
    // The engine's verdict stays: the row still does not fit.
    expect(await cell(page, 'contract')).toEqual(['Zeitarbeit', 'passt nicht']);
    // The user's own mark is no empty row among the reasons.
    const empty = await stage(page)
      .getByTestId('why')
      .locator('li')
      .evaluateAll(
        (items) => items.filter((item) => (item.textContent ?? '').trim() === '').length,
      );
    expect(empty).toBe(0);
    // Back, from the keyboard too: the focus goes to "Trotzdem einbeziehen", never the page.
    await page.keyboard.press('Enter');
    await expect(stage(page).getByTestId('override')).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test('an exclusion word says the word and shows the sentence that names it', async ({ page }) => {
    await openJob(page, 'freelancermap-2807');
    await expect(row(page, 'freelancermap-2807')).toContainText('Ausschlusswort');
    const box = stage(page).getByTestId('exclusion-box');
    await expect(box.getByTestId('exclusion')).toHaveText(
      '„Werkstudent“ steht auf deiner Liste der Ausschlusswörter.',
    );
    await expect(stage(page).getByTestId('why')).not.toContainText('Liste der Ausschlusswörter');
    await box.getByTestId('show-in-ad').click();
    await page.mouse.move(0, 0);
    const active = page.locator('mark.active');
    await expect
      .poll(async () => (await active.allTextContents()).join(''))
      .toBe(
        'Für Elbufer Handel GmbH suchen wir Unterstützung als Werkstudent Controlling (m/w/d) in Hamburg.',
      );
    await expect(active.first()).toBeInViewport();
  });
});

test.describe('Konditionen', () => {
  test('the rows of the facts table with their icons, the ad side only, verdicts in words', async ({
    page,
  }) => {
    await openJob(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText('Konditionen');
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
    // Each row has the icon of its fact, the same as in the list row.
    expect(await terms(page).locator('.term-name .icon').count()).toBe(ROWS.length);
    const glyph = (scope: Locator) =>
      scope
        .locator('.icon')
        .first()
        .evaluate((node) => node.innerHTML);
    expect(await glyph(term(page, 'rate'))).toBe(
      await glyph(row(page, 'freelancermap-2801').locator('[data-fact="money"]')),
    );
    // Only what the ad says: no line of the profile under a value.
    await expect(stage(page).locator('.term-profile')).toHaveCount(0);
    await expect(terms(page)).not.toContainText('Minimum');
    await expect(terms(page)).not.toContainText('Wunsch');
    expect(await cell(page, 'contract')).toEqual(['Interim', 'passt']);
    expect(await cell(page, 'rate')).toEqual(['1.200 €/Tag', 'passt']);
    expect(await cell(page, 'start')).toEqual(['ab sofort', 'passt']);
    expect(await cell(page, 'duration')).toEqual(['6 Monate', 'passt']);
    // The ad says nothing of its workload: "offen", and no verdict repeats it.
    expect(await cell(page, 'workload')).toEqual(['offen', '']);
    expect(await cell(page, 'remote')).toEqual(['60 % remote', 'passt']);
    expect(await cell(page, 'place')).toEqual(['Hamburg', 'passt']);
    expect(await cell(page, 'experience')).toEqual(['15 Jahre', 'passt']);
    // A verdict names the reason that decided it.
    expect(await tip(page, term(page, 'rate').locator('.verdict'))).toBe(
      'Der Tagessatz von 1.200 € erreicht den Wunsch von 1.200 €.',
    );
    for (const key of [
      'freelancermap-2802',
      'freelance-900412',
      'linkedin-4100200303',
      'freelance-900411',
      'linkedin-4100200305',
      'freelancermap-2803',
      'freelancermap-2804',
      'freelance-900413',
    ]) {
      await show(page, key);
      await expect(terms(page)).not.toContainText('genannt');
      for (const each of await terms(page).locator('.term').all()) {
        const verdict = words(await each.locator('.verdict').textContent());
        const value = words(await each.locator('.term-line').textContent());
        expect(VERDICTS, `${key} ${value}`).toContain(verdict);
        // "Start offen · offen" says nothing twice.
        if (value === 'offen') expect(verdict, key).toBe('');
      }
    }
  });

  test('a permanent job: its salary, no end, a type the engine only infers', async ({ page }) => {
    await openJob(page, 'linkedin-4100200303');
    const names = await terms(page).locator('.term-name').allInnerTexts();
    expect(names[1]).toBe('Gehalt');
    expect((await cell(page, 'rate'))[0]).toMatch(/^95\.000 €\/Jahr$/);
    expect(await cell(page, 'duration')).toEqual(['unbefristet', '']);
    expect(await cell(page, 'contract')).toEqual(['Festanstellung vermutet', 'prüfen']);
    // Required years without a passage are an estimate.
    expect(await cell(page, 'experience')).toEqual(['5 Jahre geschätzt', 'prüfen']);
  });

  test('"passt teilweise" for a limit or a wish missed, in amber, with its reason', async ({
    page,
  }) => {
    // Three months against the profile's six; ten years for a senior role (the profile brings
    // more); a day rate the ad leaves open.
    await openJob(page, 'freelancermap-2802');
    expect(await cell(page, 'duration')).toEqual(['3 Monate', 'passt teilweise']);
    expect(await tip(page, term(page, 'duration').locator('.verdict'))).toBe(
      'Die Laufzeit von 3 Monaten liegt unter dem Minimum von 6 Monaten.',
    );
    expect(await cell(page, 'experience')).toEqual(['10 Jahre', 'passt teilweise']);
    expect(await tip(page, term(page, 'experience').locator('.verdict'))).toBe(
      'Gesucht sind 10 Jahre Erfahrung, das Profil bringt deutlich mehr mit.',
    );
    expect(await cell(page, 'rate')).toEqual(['nach Absprache', 'offen']);
    expect(await cell(page, 'workload')).toEqual(['Vollzeit', 'passt']);
    // No share stated: the work mode in the words of a share.
    expect(await cell(page, 'remote')).toEqual(['voll remote', '']);
    // Said in the row, not again among the points to check.
    await expect(stage(page).getByTestId('why')).not.toContainText('liegt unter dem Minimum');
    // The passage says the same.
    const passage = page.getByTestId('ad-text').locator('mark', { hasText: 'Laufzeit 3 Monate' });
    expect(await tip(page, passage)).toBe('Laufzeit · passt teilweise');
    // Two days a week against three to five; a day rate just under the wish.
    await show(page, 'freelance-900413');
    expect(await cell(page, 'workload')).toEqual(['2 Tage pro Woche', 'passt teilweise']);
    expect(await tip(page, term(page, 'workload').locator('.verdict'))).toBe(
      'Die Anzeige nennt 2 Tage pro Woche, das Profil sucht mindestens 3 Tage pro Woche.',
    );
    expect(await cell(page, 'rate')).toEqual(['1.150 €/Tag', 'passt teilweise']);
    // The value marks the passage that states it.
    await term(page, 'workload').locator('button.chip').click();
    await page.mouse.move(0, 0);
    await expect(page.locator('mark.active').first()).toContainText('Einsatz an 2 Tagen pro Woche');
    await expect(stage(page).getByTestId('why')).not.toContainText('Tage pro Woche');
    // Within the profile: a fit. A start to be agreed is unclear: to check.
    await show(page, 'freelancermap-2804');
    expect(await cell(page, 'workload')).toEqual(['3 Tage pro Woche', 'passt']);
    expect(await cell(page, 'duration')).toEqual(['12 Monate', 'passt']);
    expect(await cell(page, 'start')).toEqual(['nach Absprache', 'prüfen']);
    // The colours: a part fit amber (the mid match), a check navy, a fit green, a misfit red.
    const colour = (name: string) =>
      terms(page)
        .locator('.verdict', { hasText: new RegExp(`^${name}$`) })
        .first()
        .evaluate((node) => getComputedStyle(node).color);
    expect(await colour('prüfen')).toBe(await tokenColour(page, '--info'));
    expect(await colour('passt')).toBe(await tokenColour(page, '--success-strong'));
    await show(page, 'freelance-900413');
    expect(await colour('passt teilweise')).toBe(await tokenColour(page, '--score-mid-text'));
    await show(page, 'freelance-900412');
    expect(await colour('passt nicht')).toBe(await tokenColour(page, '--danger-strong'));
  });

  test('a value with a passage is underlined dotted and jumps; a plain value is plain', async ({
    page,
  }) => {
    await openJob(page, 'freelancermap-2801');
    const rate = term(page, 'rate');
    await expect(rate.locator('button.chip .chip-label')).toHaveCSS(
      'text-decoration-style',
      'dotted',
    );
    const workload = term(page, 'workload');
    await expect(workload.locator('button')).toHaveCount(0);
    await expect(workload.locator('.plain')).toHaveCSS('text-decoration-line', 'none');
    await rate.locator('button.chip').click();
    await page.mouse.move(0, 0);
    await expect(page.locator('mark.active').first()).toContainText('Tagessatz 1.200');
    await expect(page.locator('mark.active').first()).toBeInViewport();
  });

  test('without a profile: the ad side without verdicts, no ring, no requirements', async ({
    page,
  }) => {
    await open(page, `${WIN}&scenario=no-profile`);
    await show(page, 'freelancermap-2801');
    await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
    expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
    await expect(terms(page).locator('.verdict')).toHaveCount(0);
    const columns = await terms(page).evaluate(
      (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(2);
    await expect(stage(page).getByTestId('why')).toHaveCount(0);
  });

  test('in English: the row Workload and its verdict', async ({ page }) => {
    await openJob(page, 'freelance-900413', `${WIN}&lang=en`);
    expect(await terms(page).locator('.term-name').allInnerTexts()).toContain('Workload');
    expect(await cell(page, 'workload')).toEqual(['2 days a week', 'partly fits']);
  });
});

test.describe('Anforderungen and the ad', () => {
  test('a missing must once, in its group, into the profile and back', async ({ page }) => {
    await openJob(page, 'freelancermap-2802');
    const why = stage(page).getByTestId('why');
    await expect(why.locator('h2')).toHaveText('Anforderungen');
    // The groups carry no counts; the must count stands in the head only.
    for (const sub of await why.locator('.sub').allInnerTexts()) expect(sub).not.toMatch(/\d/);
    await expect(why).not.toContainText('Pflicht');
    const missing = why.getByTestId('reasons-open').locator('li', {
      hasText: 'Branchenerfahrung Energie',
    });
    await expect(missing).toHaveCount(1);
    await expect(stage(page).getByTestId('requirements')).toHaveCount(0);
    const add = missing.getByTestId('add-to-profile');
    await expect(add).toHaveText('Zum Profil hinzufügen');
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
    await expect(stage(page).getByTestId('add-to-profile')).toBeVisible();
    await page.getByTestId('nav-profile').click();
    await expect(page.getByTestId('profile-keywords')).not.toContainText(
      'Branchenerfahrung Energie',
    );
  });

  test('only Optional tagged, a missing must stands out, every mark says its state', async ({
    page,
  }) => {
    await openJob(page, 'freelancermap-2803');
    const why = stage(page).getByTestId('why');
    // Untagged is Pflicht: the only tag is "Optional".
    expect(new Set(await why.locator('.badge').allInnerTexts())).toEqual(new Set(['Optional']));
    const open = why.getByTestId('reasons-open');
    const must = open.locator('li[data-weight="must"] .reason').first();
    const nice = open.locator('li[data-weight="nice"] .reason').first();
    await expect(must).toHaveClass(/strong/);
    await expect(nice).toHaveClass(/quiet/);
    const weight = (target: typeof must) =>
      target
        .locator('.label')
        .first()
        .evaluate((node) => Number(getComputedStyle(node).fontWeight));
    expect(await weight(must)).toBeGreaterThan(await weight(nice));
    // Every state mark says its word under the pointer (a half circle alone was not understood).
    const marks = why.locator('.reason .icon[aria-label]');
    const count = Math.min(await marks.count(), 4);
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const mark = marks.nth(index);
      const word = (await mark.getAttribute('aria-label'))!;
      expect(['Erfüllt', 'Teilweise erfüllt', 'Nicht im Profil', 'Prüfen']).toContain(word);
      expect(await tip(page, mark)).toBe(word);
    }
    // "Passt zu" only where the profile's words differ from the requirement's own.
    await show(page, 'freelancermap-2801');
    const met = stage(page).getByTestId('reasons-met');
    await expect(
      met.locator('li', { hasText: 'Interim-Management im Mittelstand' }),
    ).not.toContainText('im Profil');
    await expect(met.locator('li', { hasText: 'Reporting nach IFRS' })).toContainText(
      'Passt zu „Konzernrechnungslegung nach IFRS“ im Profil.',
    );
  });

  test('the ad and its reasons link both ways: tooltips on passages, hover lights, click scrolls', async ({
    page,
  }) => {
    await openJob(page, 'freelancermap-2801');
    const text = page.getByTestId('ad-text');
    const mark = text.locator('mark', { hasText: 'Reporting nach IFRS' });
    await mark.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await mark.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Erfüllt · Pflicht');
    const reason = stage(page)
      .getByTestId('reasons-met')
      .locator('li', { hasText: 'Reporting nach IFRS' })
      .locator('.reason');
    await expect(reason).toHaveClass(/active/);
    await page.mouse.move(0, 0);
    // An optional one says so; a passage of the terms names its row and verdict.
    expect(
      await tip(page, text.locator('mark', { hasText: 'Französisch in Wort und Schrift' })),
    ).toBe('Nicht im Profil · Optional');
    expect(await tip(page, text.locator('mark', { hasText: 'Tagessatz 1.200' }))).toBe(
      'Tagessatz · passt',
    );
    // Every passage has a tooltip.
    const count = await text.locator('mark').count();
    expect(count).toBeGreaterThan(5);
    for (let index = 0; index < count; index += 1) {
      expect(await tip(page, text.locator('mark').nth(index))).toMatch(/\S/);
    }
    // A click on a passage scrolls to its reason; the reason jumps back to its passage.
    await stage(page).evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    await page.waitForTimeout(250);
    await mark.click();
    await expect(reason).toBeInViewport();
    await expect(reason).toHaveClass(/active/);
    await page.waitForTimeout(400);
    await reason.click();
    await page.mouse.move(0, 0);
    await expect(page.locator('mark.active').first()).toContainText('Reporting nach IFRS');
    await expect(page.locator('mark.active').first()).toBeInViewport();
    // An ad that names the rate only as to be agreed: open, and the place fits.
    await show(page, 'freelancermap-2802');
    expect(await tip(page, text.locator('mark', { hasText: 'Tagessatz nach Absprache' }))).toBe(
      'Tagessatz · offen',
    );
    expect(await tip(page, text.locator('mark', { hasText: 'Berlin' }))).toBe('Ort · passt');
  });

  test('the facts copy as one line with their dots', async ({ page }) => {
    await openJob(page, 'freelancermap-2801');
    const copied = await stage(page)
      .locator('.head .facts')
      .evaluate((line) => {
        const selection = window.getSelection();
        selection?.selectAllChildren(line);
        return selection?.toString() ?? '';
      });
    expect(copied).not.toContain('\n');
    expect(copied).toMatch(/\S · \S/);
  });
});

// Carried over from the reader's rounds of fixes: the column, the run card and the trash
// around the reader.
test.describe('around the reader', () => {
  test('one column: choosing several jobs keeps the list, its bar acts on them', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 683, height: 700 });
    await open(page, WIN);
    await facet(page, 'Alle').click();
    await rows(page)
      .nth(0)
      .click({ modifiers: ['Control'] });
    await rows(page)
      .nth(2)
      .click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-bar')).toContainText('3 ausgewählt');
    const scroll = page.getByTestId('list-scroll');
    await expect(scroll).toBeVisible();
    expect((await scroll.boundingBox())?.width ?? 0).toBeGreaterThan(600);
    await expect(page.getByTestId('selection-pane')).toBeHidden();
    await rows(page)
      .nth(1)
      .click({ modifiers: ['Control'] });
    await expect(page.getByTestId('selection-bar')).toContainText('2 ausgewählt');
    await expect(scroll).toBeVisible();
    expect(await calls(page, 'job_detail')).toEqual([]);
  });

  test('one column: the header stays on top while the list scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 560 });
    await open(page, WIN);
    await facet(page, 'Alle').click();
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
    await facet(page, 'Alle').click();
    // The order is in the funnel's menu.
    await page.getByTestId('filter').click();
    await page.getByTestId('menu-item-newest').click();
    await row(page, 'linkedin-100006').click();
    await expect(page.getByTestId('reader-title')).toHaveText('Finance Manager 7');
    await page.getByTestId('filter').click();
    await page.getByTestId('menu-item-match').click();
    await expect(page.getByTestId('menu')).toHaveCount(0);
    await page.getByTestId('search').fill('Finance Manager');
    await expect(facet(page, 'Alle')).toContainText('500');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('reader-title')).toHaveText('Finance Manager 7');
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
