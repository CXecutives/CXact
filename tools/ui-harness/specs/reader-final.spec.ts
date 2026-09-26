// The reader of the final UI round: the head, the actions and their "…" menu, the exclusion
// box, the requirements with "Zum Profil hinzufügen", the fixed terms table, the two-way link
// between the ad's passages and their reasons, and the special cases (preview, details to
// come, no profile, offline, trash).

import type { Page } from '@playwright/test';
import { calls, expect, open, settle, test } from './fixtures';

const WIN = '?platform=windows';
const list = (page: Page) => page.getByTestId('job-list');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const facet = (page: Page, name: string) =>
  page.getByTestId('facet').getByRole('radio', { name: new RegExp(name) });
// The open job's stage (the one on its way out has dropped its test id).
const stage = (page: Page) => page.getByTestId('stage');
const terms = (page: Page) => stage(page).getByTestId('criteria');

const ROWS = ['Vertragsart', 'Tagessatz', 'Start', 'Laufzeit', 'Remote', 'Ort', 'Erfahrung'];
const VERDICTS = ['', 'passt', 'passt nicht', 'prüfen', 'offen'];

/** Opens a job from "Alle" and waits until the reader shows it. */
async function show(page: Page, key: string): Promise<void> {
  const target = row(page, key);
  // An excluded job lies in the folded section at the end of the list.
  if ((await target.count()) === 0) await page.getByTestId('excluded-divider').click();
  await target.click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(
    await target.locator('.title').innerText(),
  );
}

async function openJob(page: Page, key: string, query = WIN): Promise<void> {
  await open(page, query);
  await facet(page, 'Alle').click();
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

/** The value and the verdict of every row of the terms table. */
async function cells(page: Page): Promise<{ name: string; value: string; verdict: string }[]> {
  return terms(page)
    .locator('.term')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        name: row.querySelector('.term-name')?.textContent?.trim() ?? '',
        value: row.querySelector('.term-line')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        verdict: row.querySelector('.verdict')?.textContent?.trim() ?? '',
      })),
    );
}

test('the head: title, company and place, then portal, time and the other portal as a link', async ({
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
  await stage(page).getByTestId('reader-when').hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^Alert-Mail vom 24\.09\.2026 um \d\d:\d\d$/);
  await page.mouse.move(0, 0);
  // "auch auf …" opens the ad.
  const also = stage(page).getByTestId('also-linkedin');
  await expect(also).toHaveText('auch auf linkedin.com');
  await also.click();
  expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
    target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
  });
  // The ring stands beside the band line; its number stands at once.
  await expect(stage(page).getByTestId('band')).toHaveText('Hohe Passung');
  await expect(stage(page).getByTestId('must')).toHaveText('4 von 4 Pflicht erfüllt');
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

test('the actions: the ad strongest, Favorit and Archivieren labelled, the rest in "…"', async ({
  page,
}) => {
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
  // Not in the title line any more.
  await expect(stage(page).locator('.title-line [data-testid="reader-archive"]')).toHaveCount(0);
  // The "…" menu: the alert mail, the prompt, unread, the trash, with their keys.
  await actions.getByTestId('reader-more').click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  expect(
    await menu
      .locator('[data-testid^="menu-item-"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-testid'))),
  ).toEqual(['menu-item-mail', 'menu-item-prompt', 'menu-item-unread', 'menu-item-trash']);
  await expect(menu.getByTestId('menu-item-mail')).toContainText('Alert-Mail öffnen');
  await expect(menu.getByTestId('menu-item-prompt')).toContainText('KI-Prompt kopieren');
  await expect(menu.getByTestId('menu-item-unread')).toContainText('Als ungelesen markieren');
  await expect(menu.getByTestId('menu-item-unread').locator('.keys')).toHaveText('U');
  await expect(menu.getByTestId('menu-item-trash')).toContainText('In den Papierkorb');
  await expect(menu.getByTestId('menu-item-trash').locator('.keys')).toHaveText('Entf');
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
  await actions.getByTestId('reader-more').click();
  await page.getByTestId('menu-item-unread').click();
  expect((await calls(page, 'mark_unread')).at(-1)?.[1]).toEqual({
    keys: [{ portal: 'freelancermap', id: '2801' }],
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
              new Set([...node.children].map((child) => child.getBoundingClientRect().top)).size,
          ),
      )
      .toBe(1);
  }
});

test('an excluded job: a calm box, its passage, include anyway and back, the focus follows', async ({
  page,
}) => {
  await openJob(page, 'freelance-900412');
  const box = stage(page).getByTestId('exclusion-box');
  await expect(box.getByTestId('exclusion')).toHaveText(
    'Die Anzeige nennt Arbeitnehmerüberlassung.',
  );
  // Calm: no red wash behind it.
  const wash = await box.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(wash).toBe(await tokenColour(page, '--surface-muted'));
  expect(wash).not.toBe(await tokenColour(page, '--danger-soft'));
  await box.getByTestId('show-in-ad').click();
  // The pointer steps aside: a passage that scrolls under it would take the light.
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active').first()).toContainText('Arbeitnehmerüberlassung');
  await expect(page.locator('mark.active').first()).toBeInViewport();
  // The contract row carries the verdict; no row is named after the agency work.
  const contract = terms(page).getByTestId('term-contract');
  await expect(contract.locator('.term-line')).toHaveText('Zeitarbeit');
  await expect(contract.locator('.verdict')).toHaveText('passt nicht');
  await expect(terms(page)).not.toContainText('Arbeitnehmerüberlassung');
  // Include it anyway: the box says so, the focus is on the button that took the place.
  await box.getByTestId('override').click();
  await expect(box.getByTestId('overridden')).toHaveText('Manuell einbezogen');
  await expect(stage(page).getByTestId('override-undo')).toBeFocused();
  // The engine's verdict stays: the row still does not fit.
  await expect(contract.locator('.verdict')).toHaveText('passt nicht');
  // The user's own mark is no empty row among the reasons.
  const empty = await stage(page)
    .getByTestId('why')
    .locator('li')
    .evaluateAll((items) => items.filter((item) => (item.textContent ?? '').trim() === '').length);
  expect(empty).toBe(0);
  // Back, from the keyboard too: the focus goes to "Trotzdem einbeziehen", never to the page.
  await page.keyboard.press('Enter');
  await expect(stage(page).getByTestId('override')).toBeFocused();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  await expect(box.getByTestId('exclusion')).toBeVisible();
});

test('Anforderungen: the must line, the optional ones missing, a missing must into the profile', async ({
  page,
}) => {
  await openJob(page, 'freelancermap-2802');
  const block = stage(page).getByTestId('requirements');
  await expect(block.locator('h2')).toHaveText('Anforderungen');
  await expect(block.getByTestId('requirements-line')).toHaveText(
    '3 von 4 Pflicht erfüllt · 1 optional fehlt',
  );
  const missing = block.getByTestId('missing-musts');
  await expect(missing).toContainText('Branchenerfahrung Energie');
  await missing.getByTestId('add-to-profile').click();
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
  await expect(page.getByTestId('profile-keywords')).not.toContainText('Branchenerfahrung Energie');
});

test('Konditionen: fixed rows in a fixed order, verdicts in words, never "genannt"', async ({
  page,
}) => {
  await openJob(page, 'freelancermap-2801');
  await expect(stage(page).getByTestId('terms').locator('h2')).toHaveText('Konditionen');
  expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
  // The profile's wishes stand in their rows, not in a block of their own.
  const rate = terms(page).getByTestId('term-rate');
  await expect(rate.locator('.term-line')).toHaveText('1.200 €/Tag');
  await expect(rate.locator('.term-profile')).toHaveText('Minimum 1.100 €, Wunsch 1.200 €');
  await expect(terms(page).getByTestId('term-remote').locator('.term-profile')).toHaveText(
    'Wunsch überwiegend remote',
  );
  await expect(terms(page).getByTestId('term-place').locator('.term-line')).toHaveText('Hamburg');
  await expect(stage(page).getByTestId('wishes')).toHaveCount(0);
  for (const key of [
    'freelancermap-2801',
    'freelancermap-2802',
    'freelance-900412',
    'linkedin-4100200303',
    'freelance-900411',
    'linkedin-4100200305',
    'freelancermap-2803',
  ]) {
    await show(page, key);
    // A permanent job that states its salary names its pay row so.
    const names = key === 'linkedin-4100200303' ? ROWS.with(1, 'Gehalt') : ROWS;
    expect(await terms(page).locator('.term-name').allInnerTexts(), key).toEqual(names);
    await expect(terms(page)).not.toContainText('genannt');
    for (const cell of await cells(page)) {
      expect(VERDICTS, `${key} ${cell.name}`).toContain(cell.verdict);
      // "Start offen · offen" says nothing twice.
      if (cell.value === 'offen') expect(cell.verdict, `${key} ${cell.name}`).toBe('');
    }
  }
  // A permanent job the engine only infers: the type, a quiet "vermutet", a check.
  await show(page, 'linkedin-4100200303');
  const contract = terms(page).getByTestId('term-contract');
  await expect(contract.locator('.term-line')).toHaveText('Festanstellung vermutet');
  await expect(contract.locator('.verdict')).toHaveText('prüfen');
  // Required years without a passage are an estimate.
  const years = terms(page).getByTestId('term-experience');
  await expect(years.locator('.term-line')).toHaveText('5 Jahre geschätzt');
  await expect(years.locator('.verdict')).toHaveText('prüfen');
  // The colours: a check is navy, never amber; a fit green, a misfit red.
  const verdictColour = (name: string) =>
    terms(page)
      .locator('.verdict', { hasText: new RegExp(`^${name}$`) })
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  expect(await verdictColour('prüfen')).toBe(await tokenColour(page, '--info'));
  expect(await verdictColour('prüfen')).not.toBe(await tokenColour(page, '--warning-strong'));
  expect(await verdictColour('passt')).toBe(await tokenColour(page, '--success-strong'));
  await show(page, 'freelance-900412');
  expect(await verdictColour('passt nicht')).toBe(await tokenColour(page, '--danger-strong'));
});

test('a value with a passage is underlined dotted and jumps; a plain value is plain', async ({
  page,
}) => {
  await openJob(page, 'freelancermap-2801');
  const rate = terms(page).getByTestId('term-rate');
  await expect(rate.locator('button.chip .chip-label')).toHaveCSS(
    'text-decoration-style',
    'dotted',
  );
  const duration = terms(page).getByTestId('term-duration');
  await expect(duration.locator('button')).toHaveCount(0);
  await expect(duration.locator('.plain')).toHaveCSS('text-decoration-line', 'none');
  await rate.locator('button.chip').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active').first()).toContainText('Tagessatz 1.200');
  await expect(page.locator('mark.active').first()).toBeInViewport();
});

test('Anforderungen im Detail: only Optional tagged, a missing must stands out, words on marks', async ({
  page,
}) => {
  await openJob(page, 'freelancermap-2803');
  const why = stage(page).getByTestId('why');
  await expect(why.locator('h2')).toHaveText('Anforderungen im Detail');
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
  // Every state mark says its word under the pointer.
  const marks = why.locator('.reason .icon[aria-label]');
  const words = new Set(
    await marks.evaluateAll((all) => all.map((m) => m.getAttribute('aria-label') ?? '')),
  );
  for (const word of words) {
    expect(['Erfüllt', 'Teilweise erfüllt', 'Nicht im Profil', 'Prüfen']).toContain(word);
  }
  const first = marks.first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await first.hover();
  await expect(page.getByRole('tooltip')).toHaveText((await first.getAttribute('aria-label'))!);
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
  // An optional one says so; a passage of the terms names its row and verdict.
  await page.mouse.move(0, 0);
  const optional = text.locator('mark', { hasText: 'Französisch in Wort und Schrift' });
  await optional.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Nicht im Profil · Optional');
  await page.mouse.move(0, 0);
  const rate = text.locator('mark', { hasText: 'Tagessatz 1.200' });
  await rate.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Tagessatz · passt');
  await page.mouse.move(0, 0);
  // Every passage has a tooltip.
  const count = await text.locator('mark').count();
  expect(count).toBeGreaterThan(5);
  for (let index = 0; index < count; index += 1) {
    const each = text.locator('mark').nth(index);
    await each.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await each.hover();
    await expect(page.getByRole('tooltip')).toHaveText(/\S/);
    await page.mouse.move(0, 0);
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
});

test('a preview: one line under the band leads to the sign-in in Einstellungen', async ({
  page,
}) => {
  await openJob(page, 'freelance-900411');
  const line = stage(page).getByTestId('preliminary');
  await expect(line).toContainText('Vorläufig, nur Vorschau');
  await expect(line.getByTestId('set-up-sign-in')).toHaveText('Anmeldung einrichten');
  await expect(stage(page).getByTestId('set-up-sign-in')).toHaveCount(1);
  await expect(stage(page).getByTestId('detail-note')).toHaveText(
    'Ohne Anmeldung zeigt freelance.de nur eine Vorschau.',
  );
  await expect(stage(page).getByTestId('reader')).not.toContainText('Anriss');
  await line.getByTestId('set-up-sign-in').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
});

test('details to come: scored once the ad is there, the note fetches it now', async ({ page }) => {
  await openJob(page, 'linkedin-4100200302');
  await expect(stage(page).getByTestId('band')).toHaveText(
    'Wird bewertet, sobald die Anzeige da ist',
  );
  await expect(stage(page).getByTestId('band')).toHaveCSS(
    'color',
    await tokenColour(page, '--text-muted'),
  );
  await expect(stage(page).getByTestId('detail-note')).toHaveText('Die Anzeige fehlt noch.');
  const fetch = stage(page).getByTestId('fetch-details');
  await expect(fetch).toHaveText('Jetzt holen');
  await fetch.click();
  expect(((await calls(page, 'start_run'))[0]?.[1] as { request: unknown }).request).toEqual({
    kind: 'details',
    keys: [{ portal: 'linkedin', id: '4100200302' }],
  });
});

test('unscored bands are muted, not the colour of a low score', async ({ page }) => {
  await openJob(page, 'freelancermap-2806');
  const band = stage(page).getByTestId('band');
  await expect(band).toHaveText('Nicht bewertbar');
  await expect(band).toHaveCSS('color', await tokenColour(page, '--text-muted'));
});

test('without a profile: the terms without their verdicts, no ring', async ({ page }) => {
  await open(page, `${WIN}&scenario=no-profile`);
  await show(page, 'freelancermap-2801');
  await expect(stage(page).getByTestId('reader-ring')).toHaveCount(0);
  expect(await terms(page).locator('.term-name').allInnerTexts()).toEqual(ROWS);
  await expect(terms(page).locator('.verdict')).toHaveCount(0);
  const columns = await terms(page).evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
  );
  expect(columns).toBe(2);
  await expect(stage(page).getByTestId('requirements')).toHaveCount(0);
});

test('an offline ad says since when; the trash says what the trash says', async ({ page }) => {
  await openJob(page, 'linkedin-4100200304');
  await expect(stage(page).getByTestId('offline-line')).toHaveText(
    /^Anzeige offline seit \d\d\.\d\d\.\d{4}$/,
  );
  await row(page, 'freelancermap-2803').hover();
  await page.getByTestId('trash-freelancermap-2803').click();
  await page.waitForTimeout(550);
  await page.getByTestId('place-trash').click();
  await settle(page);
  await show(page, 'freelancermap-2803');
  await expect(stage(page).getByTestId('place-line')).toHaveText(
    'Im Papierkorb, wird in 30 Tagen endgültig gelöscht',
  );
  // The trash's own actions stay labelled; the menu has no trash of its own.
  await expect(stage(page).getByTestId('reader-restore')).toHaveText('Wiederherstellen');
  await expect(stage(page).getByTestId('reader-purge')).toHaveText('Endgültig löschen');
  await stage(page).getByTestId('reader-more').click();
  await expect(page.getByTestId('menu-item-trash')).toHaveCount(0);
  await expect(page.getByTestId('menu-item-unread')).toHaveCount(0);
});
