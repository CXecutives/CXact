// The reader of the Jobs view: the parts of the former jobs.spec.ts, wave1-jobs.spec.ts and
// asks-rings-bar.spec.ts about the open job (moved unchanged when the list area was
// consolidated in list.spec.ts; the reader package consolidates this file later). The steps
// that chose the old "Alle" segment are gone: the inbox is one list now.

import type { Locator, Page } from '@playwright/test';
import { calls, expect, expectShot, NOW, open, runFinished, settle, test } from './fixtures';

const WIN = '?platform=windows';
const DAY = 86_400_000;
const SIZES = ['sm', 'md', 'lg'] as const;
const RINGS = [
  'full',
  'high',
  'mid',
  'low',
  'excluded',
  'unscorable',
  'provisional',
  'pending',
  'none',
] as const;
const list = (page: Page) => page.getByTestId('job-list');
const rows = (page: Page) => page.getByTestId('job-rows').locator('[data-testid^="job-row-"]');
const excludedRows = (page: Page) =>
  page.getByTestId('excluded-rows').locator('[data-testid^="job-row-"]');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
/** The best scored job of the stub (91); by match the job still without a score stands
 *  above it. */
const BEST = 'freelancermap-2801';

/** A row's tool: it exists while the pointer is on the row. */
async function tool(page: Page, id: string, key: string): Promise<void> {
  await row(page, key).hover();
  await page.getByTestId(`${id}-${key}`).click();
}

/** After a move the list ignores clicks for a moment (the row under the pointer changed). */
async function settleMoves(page: Page): Promise<void> {
  await page.waitForTimeout(550);
}

/** A colour token as the engine computes it. */
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

async function windowInactive(page: Page, inactive: boolean): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset['window'] = value ? 'inactive' : 'active';
  }, inactive);
}

/** How a ring is drawn, apart from the colour of its value. */
async function look(page: Page, testid: string): Promise<Record<string, string>> {
  return page.getByTestId(testid).evaluate((ring) => {
    const style = (selector: string): CSSStyleDeclaration | null => {
      const node = ring.querySelector(selector);
      return node ? getComputedStyle(node) : null;
    };
    const track = style('.track');
    const value = style('.value');
    const disc = style('.disc');
    const centre = style('.center');
    return {
      track: `${track?.stroke} ${track?.strokeWidth} ${track?.strokeDasharray}`,
      value: `${value?.strokeWidth} ${value?.strokeDasharray} ${value?.strokeLinecap}`,
      disc: disc?.fill ?? '',
      centre: `${centre?.color} ${centre?.font}`,
    };
  });
}

/** The dash pattern of the circles a ring draws as its track. */
async function trackDashes(page: Page, testid: string): Promise<string[]> {
  return page.getByTestId(testid).evaluate((ring) => {
    const circles = [ring.querySelector('.track')!];
    // The list ring that waits draws its track on the layer that breathes.
    if (ring.matches('.sm.pending')) circles.push(ring.querySelector('.wait .arc')!);
    return circles.map((circle) => getComputedStyle(circle).strokeDasharray);
  });
}

/** One frame of what the page shows while something loads. */
interface Frame {
  /** Milliseconds since the press (or since the page started). */
  t: number;
  overview: boolean;
  /** How visible the first placeholder shape is (its opacity times its ancestors'). */
  shape: number | null;
  done: boolean;
}

/**
 * Records every frame from now on (`fromPress`: from the next pointer press) until `done`
 * matches: whether the day overview is there, how visible the first shape of `shapes` is.
 */
function recordFrames(options: { shapes: string; done: string; fromPress: boolean }): void {
  const frames: Frame[] = [];
  (window as unknown as { __frames: Frame[] }).__frames = frames;
  let start: number | null = options.fromPress ? null : performance.now();
  if (options.fromPress) {
    document.addEventListener('pointerdown', () => (start ??= performance.now()), true);
  }
  const visible = (node: Element | null): number | null => {
    if (node === null) return null;
    let value = 1;
    for (let at: Element | null = node; at !== null; at = at.parentElement) {
      value *= Number(getComputedStyle(at).opacity);
    }
    return value;
  };
  const tick = (): void => {
    const done = document.querySelector(options.done) !== null;
    if (start !== null) {
      frames.push({
        t: performance.now() - start,
        overview: document.querySelector('[data-testid="place-reader"]') !== null,
        shape: visible(document.querySelector(options.shapes)),
        done,
      });
    }
    if (!done) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const framesOf = (page: Page): Promise<Frame[]> =>
  page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

test.describe('placeholders wait once', () => {
  test('a slow job keeps the overview, then its placeholder is there at once', async ({ page }) => {
    await open(page, WIN);
    await page.evaluate(() => (window.__harness.detailDelay = 1500));
    await page.evaluate(recordFrames, {
      shapes: '[data-testid="reader-skeleton"] .skeleton',
      done: '[data-testid="reader-title"]',
      fromPress: true,
    });
    await rows(page).first().click();
    await expect(page.getByTestId('reader-title')).toBeVisible({ timeout: 5000 });
    const frames = await framesOf(page);
    const first = frames.findIndex((frame) => frame.shape !== null);
    expect(first).toBeGreaterThan(0);
    // Until the placeholder comes, the overview stays (the pane never goes blank).
    expect(frames[first]!.t).toBeGreaterThanOrEqual(250);
    expect(frames.slice(0, first).every((frame) => frame.overview)).toBe(true);
    // And once it comes, it is visible after its fade (no second wait of 300 ms; some room for
    // a loaded machine).
    const later = frames.find((frame) => frame.shape !== null && frame.t >= frames[first]!.t + 250);
    expect(later?.shape ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  test('a slow list shows its placeholder rows whole at once', async ({ page }) => {
    await page.addInitScript(recordFrames, {
      shapes: '[data-testid="list-skeleton"] .skeleton',
      done: '[data-testid="job-rows"]',
      fromPress: false,
    });
    await open(page, `${WIN}&scenario=slow`);
    await expect(rows(page).first()).toBeVisible({ timeout: 10_000 });
    const frames = await framesOf(page);
    const first = frames.find((frame) => frame.shape !== null);
    expect(first).toBeDefined();
    const later = frames.find((frame) => frame.shape !== null && frame.t >= first!.t + 250);
    expect(later?.shape ?? 0).toBeGreaterThanOrEqual(0.9);
  });
});

test('core workflow: fetch, rings fill, open the best job, reasons light the ad', async ({
  page,
}) => {
  await open(page, `${WIN}&tick=30`);
  await page.getByTestId('fetch').click();
  await expect(page.getByTestId('run-running')).toBeVisible();
  await expect(page.getByTestId('cancel-run')).toBeVisible();
  await runFinished(page);
  await expect(page.getByTestId('run-finished')).toBeVisible();
  await expect(page.getByTestId('fetch')).toBeVisible();
  // The report and the folder have one place: the Übersicht, not the run card.
  await expect(page.getByRole('button', { name: 'Ordner öffnen' })).toHaveCount(0);
  // A history line copies like "Kopieren" does: the time, a space, the text.
  await page.getByTestId('run-history').getByRole('button').first().click();
  const line = await page.getByTestId('run-card').locator('.history li').first().textContent();
  expect(line?.trim()).toMatch(/^\d{2}:\d{2} \S/);

  // The new job with the best score is scored live and sorted to the top of the scored jobs
  // once finished; the job still without a score stands above them (by match it is first).
  await expect(rows(page).first()).toHaveAttribute('data-testid', 'job-row-linkedin-4100200302');
  const top = rows(page).nth(1);
  await expect(top).toHaveAttribute('data-testid', 'job-row-freelancermap-2801');
  await expect(row(page, 'linkedin-4100200399').getByRole('img').first()).toHaveAttribute(
    'aria-label',
    /Passung 88/,
  );

  await top.click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('band')).toHaveText('Hohe Passung');
  await expect(page.getByTestId('must')).toHaveText('4 von 4 Pflicht erfüllt');
  // Its ad states every criterion of the profile, and meets it: one quiet line with the terms.
  await expect(page.getByTestId('criteria')).toBeVisible();
  await expect(page.getByTestId('criteria')).toContainText('Interim');
  await expect(page.getByTestId('criteria')).not.toContainText('passt nicht');
  // The click marks the job read; wait until the list and the reader have taken that in (a
  // slow machine would otherwise re-render the reader under the pointer).
  await expect(top.locator('.title')).not.toHaveClass(/unread/);
  await expect(page.locator('.ad mark').first()).toBeAttached();
  await settle(page);

  const reason = page.getByTestId('reasons-met').getByRole('button').first();
  await reason.hover();
  // The evidence stands under the point, quiet (no tooltip needed to trust it).
  await expect(page.getByTestId('reasons-met').getByTestId('evidence').first()).toContainText(
    'im Profil',
  );
  await expect(page.locator('mark.active')).toHaveCount(1);
  // A click scrolls the passage into view (smooth; retried until it has arrived).
  await expect(async () => {
    await reason.click();
    await expect(page.locator('mark.active')).toBeInViewport({ timeout: 2000 });
  }).toPass({ timeout: 10_000 });

  await page.getByTestId('open-ad').click();
  const opened = await calls(page, 'open_target');
  expect(opened.at(-1)?.[1]).toEqual({
    target: { kind: 'jobUrl', key: { portal: 'freelancermap', id: '2801' } },
  });
});

test('excluded jobs sit grey behind the divider and explain themselves', async ({ page }) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  const excludedRow = excludedRows(page).first();
  await expect(excludedRow).toContainText('Arbeitnehmerüberlassung');
  await excludedRow.click();
  // The reason stands in the box under the band, said once (no repeated violation).
  await expect(page.getByTestId('band')).toHaveText('Ausgeschlossen');
  const because = await page.getByTestId('exclusion').innerText();
  await expect(page.getByTestId('reader').getByText(because, { exact: true })).toHaveCount(1);
  // The one contract row carries the verdict on the agency work, no row is named after it.
  const contract = page.getByTestId('criteria').getByTestId('term-contract');
  await expect(contract.locator('.term-line')).toHaveText('Zeitarbeit');
  await expect(contract.locator('.verdict')).toHaveText('passt nicht');
  await expect(page.getByTestId('criteria')).not.toContainText('Arbeitnehmerüberlassung');
});

test('a job that cannot be scored says why, once', async ({ page }) => {
  await open(page, WIN);
  await row(page, 'freelancermap-2806').click();
  await expect(page.getByTestId('band')).toHaveText('Nicht bewertbar');
  await expect(page.getByTestId('unscorable')).toHaveText('Zu wenig Text für eine Bewertung.');
  // The short-text note of the ad does not say it a second time.
  await expect(page.getByText('Die Anzeige ist sehr kurz.')).toHaveCount(0);
  await expect(page.getByTestId('why')).toHaveCount(0);
});

test('the reader summary agrees with the listed must requirements', async ({ page }) => {
  await open(page, WIN);
  // The window mounts a few rows per frame: wait until it is complete.
  await expect
    .poll(async () => {
      const before = await rows(page).count();
      await settle(page);
      return before > 6 && before === (await rows(page).count());
    })
    .toBe(true);
  const keys = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  let checked = 0;
  for (const key of keys) {
    const row = page.getByTestId('job-rows').getByTestId(key!);
    await row.click();
    // Wait until the reader shows this job (a slow machine would still show the last one).
    await expect(page.getByTestId('reader-title')).toHaveText(
      await row.locator('.title').innerText(),
    );
    await expect(page.getByTestId('reader')).toHaveCount(1);
    const must = page.getByTestId('must');
    if ((await must.count()) === 0) continue;
    const text = await must.innerText();
    const numbers = text.match(/^(\d+) von (\d+)/);
    if (numbers === null) continue;
    const [met, total] = [Number(numbers[1]), Number(numbers[2])];
    const listed = await page.getByTestId('why').evaluate((why) => {
      // Muss is the default and carries no badge, except on an open one (it stands out
      // there); Kann always does.
      const kind = (li: Element): string =>
        li.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '';
      const musts = [...why.querySelectorAll('li[data-weight="must"]')];
      if (
        musts.some((li) => li.querySelector('.badge') !== null && kind(li) !== 'Nicht im Profil')
      ) {
        return null;
      }
      return {
        met: musts.filter((li) => kind(li) === 'Erfüllt').length,
        partial: musts.filter((li) => kind(li) === 'Teilweise erfüllt').length,
        all: musts.length,
      };
    });
    if (listed === null) throw new Error(`${key}: a must requirement carries a badge`);
    expect(listed.met, `${key}: ${text}`).toBe(met);
    expect(listed.all, `${key}: ${text}`).toBe(total);
    expect(text.includes('teilweise'), `${key}: ${text}`).toBe(listed.partial > 0);
    checked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(8);
});

test('rows and reader say the same in short words; dead ends lead on', async ({ page }) => {
  // The excluded section open, as a user who opened it once finds it.
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  // An excluded row names its reason in short words, the day rate carries its unit.
  await expect(excludedRows(page).first().locator('.foot')).toHaveText('Arbeitnehmerüberlassung');
  await expect(row(page, 'freelancermap-2801').getByTestId('row-facts')).toContainText('1.200/Tag');
  // The reader's terms: duration and remote share like the row, not the work mode; the date
  // like the row with the exact moment in its tooltip.
  await row(page, 'freelancermap-2801').click();
  const terms = page.getByTestId('stage').getByTestId('criteria');
  await expect(terms.getByTestId('term-duration')).toContainText('6 Monate');
  await expect(terms.getByTestId('term-remote')).toContainText('60 % remote');
  await expect(terms).not.toContainText('Hybrid');
  await expect(page.getByTestId('stage').locator('header.head')).not.toContainText('2026');
  // A preview names its portal and leads to the sign-in in Einstellungen.
  await row(page, 'freelance-900411').click();
  await expect(page.getByTestId('detail-note')).toContainText(
    'Ohne Anmeldung zeigt freelance.de nur eine Vorschau.',
  );
  await page.getByTestId('set-up-sign-in').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
});

test('without a profile the prompt says why it cannot work', async ({ page }) => {
  await open(page, `${WIN}&scenario=no-profile`);
  await rows(page).first().click();
  // A menu opened while the new job still settles closes with its first scroll.
  await expect(page.getByTestId('reader-title')).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByTestId('reader-more').click();
  await expect(page.getByTestId('menu-item-prompt')).toHaveAttribute('aria-disabled', 'true');
});

test('details and pins: teaser note, fetch details, pin star', async ({ page }) => {
  await open(page, WIN);
  // A teaser needs the sign-in: without it no "Details holen" that could not work.
  await row(page, 'freelance-900411').click();
  await expect(page.getByTestId('detail-note')).toContainText('Vorschau');
  await expect(page.getByTestId('fetch-details')).toHaveCount(0);
  // A job whose details are still missing fetches them, from the note on the missing text.
  await row(page, 'linkedin-4100200302').click();
  await expect(page.getByTestId('fetch-details')).toHaveCount(1);
  await expect(
    page.getByTestId('detail-note').locator('xpath=..').getByTestId('fetch-details'),
  ).toBeVisible();
  await page.getByTestId('fetch-details').click();
  const started = await calls(page, 'start_run');
  expect((started[0]?.[1] as { request: unknown }).request).toEqual({
    kind: 'details',
    keys: [{ portal: 'linkedin', id: '4100200302' }],
  });
  await runFinished(page);
  await row(page, 'freelance-900411').click();
  await page.getByTestId('reader-pin').click();
  await expect(page.getByTestId('reader-pin')).toHaveAttribute('aria-pressed', 'true');
  // The row shows the star at rest (its tools only exist under the pointer).
  await expect(row(page, 'freelance-900411').getByRole('img', { name: 'Favorit' })).toBeVisible();
});

test('the close button in the reader leads back to the day overview', async ({ page }) => {
  await open(page, WIN);
  const first = rows(page).first();
  await first.click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect(page.getByTestId('place-reader')).toHaveCount(0);
  await page.getByTestId('reader-close').click();
  await expect(page.getByTestId('place-reader')).toBeVisible();
  await expect(page.getByTestId('reader')).toHaveCount(0);
  await expect(first).not.toHaveAttribute('aria-current', 'true');
  // Below 900 px the view's back button does it; the close button steps aside.
  await first.click();
  await page.setViewportSize({ width: 780, height: 560 });
  await expect(page.getByTestId('reader-close')).toBeHidden();
  await expect(page.getByTestId('back')).toBeVisible();
});

test('switching jobs: never blank, the old text stays put, the new job starts at the top', async ({
  page,
}) => {
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  // The number stands at once: wait until the day overview's stage has left too.
  await expect(page.locator('[data-testid="reader-pane"] .stage[aria-hidden="true"]')).toHaveCount(
    0,
  );
  const top = await page.getByTestId('stage').evaluate((node) => {
    node.scrollTo({ top: 400 });
    return node.scrollTop;
  });
  expect(top).toBeGreaterThan(0);
  // Every frame from the click on: some stage shows content, no test id exists twice, and a
  // still picture of the old job (while there is one) keeps the old scroll position.
  await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="reader-pane"]')!;
    const w = window as unknown as { __frames: [boolean, number, number][] };
    w.__frames = [];
    const sample = (): void => {
      const stages = [...pane.querySelectorAll<HTMLElement>('.stage')];
      const still = stages.find((node) => node.getAttribute('aria-hidden') === 'true');
      w.__frames.push([
        stages.some((node) => (node.textContent ?? '').trim() !== ''),
        document.querySelectorAll('[data-testid="reader"]').length,
        still?.scrollTop ?? -1,
      ]);
      if (w.__frames.length < 40) requestAnimationFrame(sample);
    };
    // From the press on (a busy machine may take a while before the click comes).
    document.addEventListener('pointerdown', () => requestAnimationFrame(sample), {
      capture: true,
      once: true,
    });
  });
  // The row below the best job (the first row is the job still without a score).
  const next = rows(page).nth(2);
  await next.click();
  await expect(page.getByTestId('reader-title')).toHaveText(
    await next.locator('.title').innerText(),
  );
  await page.waitForFunction(
    () => (window as unknown as { __frames: unknown[] }).__frames.length >= 40,
  );
  const frames = await page.evaluate(
    () => (window as unknown as { __frames: [boolean, number, number][] }).__frames,
  );
  expect(frames.every(([filled]) => filled)).toBe(true);
  expect(frames.every(([, readers]) => readers <= 1)).toBe(true);
  const stills = frames.map(([, , still]) => still).filter((still) => still >= 0);
  expect(stills.length).toBeGreaterThan(0);
  expect(stills.every((still) => still === top)).toBe(true);
  expect(await page.getByTestId('stage').evaluate((node) => node.scrollTop)).toBe(0);
});

test('the reader: a compact bar once the actions scroll away, a jump flashes its passage', async ({
  page,
}) => {
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  const bar = page.getByTestId('reader-compact');
  await expect(bar).toHaveCSS('opacity', '0');
  await expect(bar).toHaveAttribute('inert', '');
  const stage = page.getByTestId('stage');
  await stage.evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await expect(bar).toHaveCSS('opacity', '1');
  await expect(bar).not.toHaveAttribute('inert');
  await expect(bar).toContainText('Interim CFO für Familienunternehmen');
  // The same tools in the same order as the title line (open first).
  expect(
    await bar.locator('.btn').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid'))),
  ).toEqual(['compact-open', 'compact-archive', 'compact-trash', 'compact-pin', 'compact-close']);
  const pinned = await page.getByTestId('reader-pin').getAttribute('aria-pressed');
  // A pointer click where the bar is (a locator click would first scroll the pin into view
  // past the stage's scroll padding, and the bar would leave).
  const pin = (await bar.getByTestId('compact-pin').boundingBox())!;
  await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2);
  await expect(page.getByTestId('reader-pin')).not.toHaveAttribute('aria-pressed', pinned ?? '');
  await stage.evaluate((node) => node.scrollTo({ top: 0 }));
  await expect(bar).toHaveCSS('opacity', '0');

  // A reason that jumps to its passage makes the passage flash once it has arrived.
  await page.evaluate(() => {
    const w = window as unknown as { __flashes: string[] };
    w.__flashes = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const mark = record.target as Element;
        if (mark.classList.contains('flash')) w.__flashes.push(mark.getAttribute('data-reason')!);
      }
    }).observe(document.querySelector('[data-testid="ad-text"]')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  await settle(page);
  await page.getByTestId('reasons-met').getByRole('button').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes))
    .not.toEqual([]);
  await expect(page.locator('mark.flash')).toHaveCount(0);
});

test('the reader: one row of actions, archive opens the next job, undo, a prompt', async ({
  page,
  browserName,
}) => {
  await open(page, WIN);
  // The best job: the first row is the one still without a score (by match it is first).
  const first = rows(page).nth(1);
  await first.click();
  await expect(page.getByTestId('reader')).toBeVisible();
  // Open the ad (the strongest), the favourite and the move labelled, the rest in "…".
  const actions = page.getByTestId('stage').getByTestId('reader-actions');
  expect(
    await actions.evaluate((row) =>
      [...row.querySelectorAll('.btn')].map((button) => button.getAttribute('data-testid')),
    ),
  ).toEqual(['open-ad', 'reader-pin', 'reader-archive', 'reader-more']);
  await expect(actions.locator('.btn.secondary')).toHaveCount(1);
  await expect(page.getByTestId('applied')).toHaveCount(0);
  await expect(page.getByTestId('note')).toHaveCount(0);
  // The action row stays one line, the labels whole in the usual reader.
  const actionTops = async (): Promise<number> =>
    actions.evaluate(
      (row) => new Set([...row.children].map((child) => child.getBoundingClientRect().top)).size,
    );
  expect(await actionTops()).toBe(1);
  await expect(page.getByTestId('reader-archive')).toHaveText('Archivieren');
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByTestId('reader-archive')).toHaveText('Archivieren');
  expect(await actionTops()).toBe(1);
  // A prompt for any AI chat, from the "…" menu.
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await page.getByTestId('reader-more').click();
  await page.getByTestId('menu-item-prompt').click();
  await expect(page.getByTestId('toast').last()).toContainText('Prompt kopiert.');
  await page.waitForTimeout(550);
  // Archivieren folds the row away and opens the next job; a double click archives one.
  const title = await page.getByTestId('reader-title').innerText();
  const next = await rows(page).nth(2).locator('.title').innerText();
  await page.getByTestId('reader-archive').dblclick();
  await expect(page.getByTestId('reader-title')).toHaveText(next);
  expect(await calls(page, 'move_jobs')).toHaveLength(1);
  await expect(page.getByTestId('toast').last()).toContainText(`„${title}“ archiviert.`);
  await expect(page.getByTestId('job-list').getByText(title, { exact: true })).toHaveCount(0);
  await page.getByTestId('toast').last().getByTestId('toast-action').click();
  await expect(page.getByTestId('job-list').getByText(title, { exact: true })).toHaveCount(1);
});

test('PageDown, Space and PageUp scroll the reader after a click in its text', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  const stage = page.getByTestId('stage');
  const top = (): Promise<number> => stage.evaluate((node) => node.scrollTop);
  await page.getByTestId('reader-title').click();
  await page.keyboard.press('PageDown');
  await expect.poll(top).toBeGreaterThan(200);
  const after = await top();
  await page.keyboard.press(' ');
  await expect.poll(top).toBeGreaterThan(after);
  await page.keyboard.press('PageUp');
  await expect.poll(top).toBeLessThan(after + 10);
});

test('the terms show the ad value and jump to it; wishes stand in their rows; rows show facts', async ({
  page,
}) => {
  await open(page, WIN);
  // The row's key facts from the ad, in the order of the facts table.
  await expect(row(page, 'freelancermap-2801').getByTestId('row-facts')).toHaveText(
    /Interim.*1\.200\/Tag.*ab sofort.*6 Monate.*60\s%\sremote/,
  );
  await row(page, 'freelancermap-2801').click();
  // The wish stands in the row of the rate, beside the minimum.
  await expect(page.getByTestId('criteria').getByTestId('term-rate')).toContainText(
    'Wunsch 1.200 €',
  );
  await expect(page.getByTestId('wishes')).toHaveCount(0);
  // An ad that leaves the rate and the start open.
  await row(page, 'freelancermap-2802').click();
  const criteria = page.getByTestId('stage').getByTestId('criteria');
  // A value the ad states, a term it leaves open (neutral, not ticked).
  await expect(criteria.getByTestId('term-place').locator('.term-line')).toHaveText('Berlin');
  const rate = criteria.getByTestId('term-rate');
  await expect(rate.locator('.term-line')).toHaveText('nach Absprache');
  await expect(rate.locator('.verdict')).toHaveText('offen');
  const start = criteria.getByTestId('term-start');
  await expect(start.locator('.term-line')).toHaveText('offen');
  await expect(start.locator('.verdict')).toHaveText('');
  // A click marks the passage that states it.
  await rate.getByRole('button').click();
  await page.mouse.move(0, 0);
  await expect(page.locator('mark.active')).toContainText('Tagessatz nach Absprache');
  // A job whose ad meets every criterion shows the same table, every verdict a fit.
  await row(page, 'linkedin-4100200301').click();
  await expect(page.getByTestId('criteria')).toContainText('Bremen');
  await expect(page.getByTestId('criteria')).not.toContainText('passt nicht');
});

test('reduced motion: rings show their value at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91', { timeout: 300 });
});

test('baseline: jobs with the reader', async ({ page }) => {
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  await expectShot(page, 'jobs-reader');
});

test('baseline: an excluded job', async ({ page }) => {
  await open(page, WIN);
  await excludedRows(page).first().click();
  await expect(page.getByTestId('exclusion')).toBeVisible();
  await expectShot(page, 'jobs-excluded');
});

test('baseline: a job at the minimum size 480 x 360', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  await open(page, WIN);
  await row(page, BEST).click();
  await expect(page.getByTestId('reader-ring')).toContainText('91');
  await expectShot(page, 'jobs-min-reader');
});

test('deleting for good waits for a run in the reader too', async ({ page }) => {
  await open(page, WIN);
  await tool(page, 'trash', 'freelancermap-2803');
  await page.getByTestId('place-trash').click();
  await settle(page);
  await row(page, 'freelancermap-2803').click();
  const purge = page.getByTestId('reader-purge');
  await expect(purge).toBeVisible();
  await expect(purge).not.toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => (window.__harness.holdAfter = 1));
  await page.getByTestId('fetch').click();
  await expect(purge).toHaveAttribute('aria-disabled', 'true');
  await purge.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/Abruf/);
  await purge.click({ force: true });
  await expect(page.getByTestId('dialog-purge')).toBeHidden();
  expect(await calls(page, 'purge_jobs')).toEqual([]);
  await page.evaluate(() => (window.__harness.holdAfter = null));
  await runFinished(page);
  await expect(purge).not.toHaveAttribute('aria-disabled', 'true');
});

test('a detail state has one tone in the row, the reader and the run card', async ({ page }) => {
  await open(page, WIN);
  const key = { portal: 'freelancermap', id: '2805' } as const;
  const job = await page.evaluate((k) => window.__harness.job(k), key);
  await page.evaluate(
    (base) =>
      window.__harness.emit({
        type: 'jobUpdated',
        job: { ...base, detail: { kind: 'unfetchable' } },
        fresh: false,
      }),
    job!,
  );
  const badge = row(page, 'freelancermap-2805').locator('.badge');
  await expect(badge).toHaveText('Nicht erreichbar');
  await expect(badge).toHaveClass(/warning/);
  await row(page, 'freelancermap-2805').click();
  await expect(page.getByTestId('detail-note')).toHaveClass(/warning/);
  // A details run that found an ad gone says it as a warning, like the row and the reader.
  await page.evaluate(() => {
    const at = new Date(Date.now()).toISOString();
    window.__harness.emit({ type: 'started', kind: 'details' });
    window.__harness.emit({
      type: 'finished',
      summary: {
        run: 60,
        kind: 'details',
        outcome: { kind: 'completed' },
        dryRun: false,
        startedAt: at,
        finishedAt: at,
        scan: null,
        perPortal: [
          {
            portal: 'freelancermap',
            new: 0,
            known: 0,
            dup: 0,
            fetched: 0,
            failed: 1,
            gone: 1,
            skipped: 0,
            stopped: null,
          },
        ],
        newJobs: null,
        score: null,
        export: null,
        emptyAlerts: [],
      },
    });
  });
  await expect(page.getByTestId('details-gone')).toHaveClass(/warning/);
  await expect(page.getByTestId('details-failed')).toHaveClass(/warning/);
});

test('cut words in a row and in the compact bar show in full in a tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 });
  await open(page, `${WIN}&lang=en`);
  // The compact bar of a reader scrolled past its actions: a cut title shows in full.
  const title = 'Interim CFO for a family business with a focus on restructuring and financing';
  const job = await page.evaluate((key) => window.__harness.job(key), {
    portal: 'linkedin',
    id: '4100200301',
  } as const);
  await page.evaluate(
    ([base, long]) =>
      window.__harness.emit({ type: 'jobUpdated', job: { ...base, title: long }, fresh: false }),
    [job!, title] as const,
  );
  await row(page, 'linkedin-4100200301').click();
  await expect(page.getByTestId('reader-title')).toHaveText(title);
  await page.getByTestId('stage').evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  const bar = page.getByTestId('reader-compact');
  await expect(bar).toHaveCSS('opacity', '1');
  const compact = bar.locator('.compact-title');
  expect(await compact.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await compact.hover();
  await expect(page.getByRole('tooltip')).toHaveText(title);
});

for (const { width, height } of [
  { width: 480, height: 360 },
  { width: 510, height: 700 },
]) {
  test(`the reader's action row stays one line at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await open(page, WIN);
    await rows(page).first().click();
    const top = async (id: string): Promise<number> =>
      (await page.getByTestId(id).boundingBox())?.y ?? -1;
    await expect
      .poll(async () => {
        const ad = await top('open-ad');
        return ad >= 0 && (await top('reader-archive')) === ad && (await top('reader-more')) === ad;
      })
      .toBe(true);
    // An icon button names itself in its tooltip ("…" always, the others where they shrink).
    await page.getByTestId('reader-more').hover();
    await expect(page.getByRole('tooltip')).toHaveText('Weitere Aktionen');
  });
}

test('the terms table: name, value and verdict in one type size, a word for each verdict', async ({
  page,
}) => {
  await open(page, WIN);
  const size = (target: Locator): Promise<string> =>
    target.evaluate((node) => getComputedStyle(node).fontSize);
  await row(page, 'freelancermap-2801').click();
  const table = page.getByTestId('stage').getByTestId('criteria');
  await expect(table).toBeVisible();
  const name = await size(table.locator('.term-name').first());
  expect(await size(table.locator('.term-value .chip').first())).toBe(name);
  expect(await size(table.locator('.verdict').first())).toBe(name);
  // A verdict is a word, never a mark to decode.
  const verdicts = await table
    .locator('.verdict')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  for (const verdict of verdicts) {
    expect(['', 'passt', 'passt nicht', 'prüfen', 'offen']).toContain(verdict);
  }
});

test('the compact bar is for the pointer: Tab reaches each tool once', async ({ page }) => {
  // A low window, so the ad scrolls its actions away in every engine.
  await page.setViewportSize({ width: 1360, height: 560 });
  await open(page, WIN);
  const opened = row(page, 'linkedin-4100200301');
  await opened.click();
  const bar = page.getByTestId('reader-compact');
  // Scroll to the end once the ad is there (it arrives after the head).
  await expect
    .poll(async () => {
      await page.getByTestId('stage').evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
      return bar.evaluate((node) => getComputedStyle(node).opacity);
    })
    .toBe('1');
  const tabIndexes = await bar
    .locator('button')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).tabIndex));
  expect(tabIndexes.length).toBeGreaterThan(3);
  expect(tabIndexes.every((index) => index === -1)).toBe(true);
  await opened.focus();
  const walk: string[] = [];
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    walk.push(
      await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.dataset.testid ?? '',
      ),
    );
  }
  expect(walk.filter((id) => id.startsWith('compact-'))).toEqual([]);
  expect(walk.filter((id) => id === 'reader-archive')).toHaveLength(1);
});

test('the trash says in how many days a job goes, following the clock', async ({ page }) => {
  await open(page, WIN);
  await tool(page, 'trash', 'freelancermap-2803');
  await settleMoves(page);
  await page.getByTestId('place-trash').click();
  await settle(page);
  await row(page, 'freelancermap-2803').click();
  const line = page.getByTestId('place-line');
  await expect(line).toHaveText('Im Papierkorb, wird in 30 Tagen endgültig gelöscht');
  const later = async (days: number): Promise<void> => {
    await page.clock.setFixedTime(new Date(NOW.getTime() + days * DAY));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  };
  await later(27);
  await expect(line).toHaveText('Im Papierkorb, wird in 3 Tagen endgültig gelöscht');
  await later(29.5);
  await expect(line).toHaveText('Im Papierkorb, wird in 1 Tag endgültig gelöscht');
  await later(30);
  await expect(line).toHaveText('Im Papierkorb, wird bald endgültig gelöscht');
});

test('a copy of the facts starts with the first fact', async ({ page }) => {
  await open(page, WIN);
  const copy = (target: Locator): Promise<string> =>
    target.evaluate((line) => {
      const selection = window.getSelection();
      selection?.selectAllChildren(line);
      return selection?.toString() ?? '';
    });
  await row(page, 'freelancermap-2801').click();
  // The open job's stage (the one on its way out has dropped its test id).
  const head = page.getByTestId('stage').locator('.head .facts');
  await expect.poll(() => copy(head)).toMatch(/^\S/);
  const facts = await copy(head);
  expect(facts).toMatch(/\S · \S/);
});

test('every ring has one solid track in every state and size; the centre and the arc say the state', async ({
  page,
}) => {
  await open(page, `?gallery`);
  await page.getByTestId('gallery-rings').scrollIntoViewIfNeeded();
  for (const size of SIZES) {
    for (const id of RINGS) {
      const dashes = await trackDashes(page, `ring-${id}-${size}`);
      expect(dashes.length, `${id} ${size}`).toBeGreaterThan(0);
      for (const dash of dashes) expect(dash, `${id} ${size}`).toBe('none');
    }
    // Scored and provisional look exactly alike (the band and the digits too); only their
    // names differ.
    expect(await look(page, `ring-provisional-${size}`)).toEqual(
      await look(page, `ring-mid-${size}`),
    );
    await expect(page.getByTestId(`ring-provisional-${size}`)).toHaveAttribute(
      'aria-label',
      /vorläufig/,
    );
    // Not scored yet: the plain track and an empty centre, no arc.
    const none = page.getByTestId(`ring-none-${size}`);
    await expect(none).toHaveText('');
    await expect(none.locator('.value, .wait')).toHaveCount(0);
    expect((await look(page, `ring-none-${size}`)).track).toBe(
      (await look(page, `ring-unscorable-${size}`)).track,
    );
  }
  // Waiting: in the reader a quarter arc turns on the track, in the list the track breathes.
  const pending = (size: string) =>
    page.getByTestId(`ring-pending-${size}`).evaluate((ring) => {
      const layer = ring.querySelector('.wait')!;
      const arc = getComputedStyle(layer.querySelector('.arc')!);
      return { name: getComputedStyle(layer).animationName, dashes: arc.strokeDasharray };
    });
  expect(await pending('md')).toEqual({
    name: 'spin',
    dashes: expect.stringMatching(/^25(px)?,? 75(px)?$/),
  });
  expect(await pending('sm')).toEqual({ name: 'breathe', dashes: 'none' });
  // On the wash of a selected row every track is warm and solid; grey with the window.
  const tracks = () =>
    page
      .getByTestId('ring-wash')
      .locator('.ring:not(.excluded, .pending) .track')
      .evaluateAll((circles) =>
        circles.map(
          (circle) =>
            `${getComputedStyle(circle).stroke} ${getComputedStyle(circle).strokeDasharray}`,
        ),
      );
  const warm = await tokenColour(page, '--ring-track-selected');
  expect(new Set(await tracks())).toEqual(new Set([`${warm} none`]));
  await windowInactive(page, true);
  const grey = await tokenColour(page, '--ring-track-inactive');
  await expect.poll(async () => new Set(await tracks())).toEqual(new Set([`${grey} none`]));
});

test('rings in the list and the reader: solid when selected, inactive or waiting', async ({
  page,
}) => {
  await open(page, WIN);
  await settle(page);
  const list = page.getByTestId('job-list');
  // No ring of the list draws a dashed track.
  const dashes = await list
    .locator('.ring .track')
    .evaluateAll((circles) => circles.map((circle) => getComputedStyle(circle).strokeDasharray));
  expect(dashes.length).toBeGreaterThan(10);
  expect(new Set(dashes)).toEqual(new Set(['none']));
  // A score from a teaser rings like any other; the badge says it.
  const teaser = list.locator('.job', { has: page.getByTestId('job-row-freelance-900411') });
  const scored = list.locator('.job', { has: page.getByTestId('job-row-freelancermap-2802') });
  await expect(teaser.locator('.ring')).toHaveClass(/provisional/);
  await expect(teaser).toContainText('Nur Vorschau');
  const lookOf = (row: typeof teaser) =>
    row.locator('.ring').evaluate((ring) => {
      const track = getComputedStyle(ring.querySelector('.track')!);
      const disc = getComputedStyle(ring.querySelector('.disc')!);
      return `${track.stroke} ${track.strokeDasharray} ${disc.fill}`;
    });
  expect(await lookOf(teaser)).toBe(await lookOf(scored));
  // Not scored yet: the track with an empty centre.
  const none = list.locator('.job', { has: page.getByTestId('job-row-linkedin-4100200302') });
  await expect(none.locator('.ring')).toHaveClass(/none/);
  await expect(none.locator('.ring .center')).toHaveText('');
  // Selected: the track turns warm; while the window is in the back, grey like the wash.
  await page.getByTestId('job-row-freelance-900411').click();
  const trackOf = () =>
    teaser.locator('.ring .track').evaluate((circle) => getComputedStyle(circle).stroke);
  await expect.poll(trackOf).toBe(await tokenColour(page, '--ring-track-selected'));
  await windowInactive(page, true);
  await expect.poll(trackOf).toBe(await tokenColour(page, '--ring-track-inactive'));
  await windowInactive(page, false);
  // The reader's ring of that job: provisional, drawn like any score.
  const reader = page.getByTestId('reader-ring');
  await expect(reader).toHaveClass(/provisional/);
  await expect(reader.locator('.track')).toHaveCSS('stroke-dasharray', 'none');
});
