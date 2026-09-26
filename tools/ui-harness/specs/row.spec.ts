// The approved job row (user, 2026-09-26): title with star, portal tile and date on line 1,
// company and place on line 2, the ad's facts from the facts table (lib/facts.ts) with their
// icons on line 3, as many as fit whole. The order and the icons are the table's: the specs
// compare the row with the reader's Konditionen (read from the same table) instead of
// retyping it, so a fact that moves or takes another icon changes one entry only.

import type { Locator, Page } from '@playwright/test';
import type { JobView } from '../../../ui/src/lib/ipc/types';
import { animationsDone, expect, open, test } from './fixtures';

const WIN = '?platform=windows';
const list = (page: Page) => page.getByTestId('job-list');
const row = (page: Page, key: string) => list(page).getByTestId(`job-row-${key}`);
const facts = (page: Page, key: string) => row(page, key).getByTestId('row-facts');

/** Every job of the inbox in one list (the switch Neu | Alle, while there is one). */
async function everyJob(page: Page): Promise<void> {
  const all = page.getByTestId('facet').getByRole('radio', { name: /Alle/ });
  if ((await all.count()) > 0) await all.click();
}

/** The name of a Lucide glyph from its svg (`lucide-euro`). */
const glyphs = (scope: Locator, selector: string): Promise<string[]> =>
  scope
    .locator(selector)
    .evaluateAll((svgs) =>
      svgs.map(
        (svg) =>
          [...svg.classList].find((name) => name.startsWith('lucide-') && name !== 'lucide-icon') ??
          '',
      ),
    );

/** The facts a row shows (not those that stepped out): key, words, icon. */
const shown = (line: Locator) =>
  line.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('.fact')]
      .filter((fact) => !fact.hasAttribute('data-out'))
      .map((fact) => ({
        key: fact.dataset.fact ?? '',
        text: fact.textContent ?? '',
        icon:
          [...(fact.querySelector('svg')?.classList ?? [])].find(
            (name) => name.startsWith('lucide-') && name !== 'lucide-icon',
          ) ?? '',
      })),
  );

async function openJob(page: Page, key: string): Promise<void> {
  await row(page, key).click();
  await expect(page.getByTestId('terms')).toBeVisible();
  await animationsDone(page);
}

test('a row shows its facts in the order of the Konditionen, each with the same icon', async ({
  page,
}) => {
  await open(page, WIN);
  await everyJob(page);
  for (const key of ['linkedin-4100200301', 'linkedin-4100200303', 'freelancermap-2801']) {
    const inRow = await shown(facts(page, key));
    expect(inRow.length, key).toBeGreaterThan(2);
    await openJob(page, key);
    const terms = page.getByTestId('criteria');
    const reader = await glyphs(terms, '.term-name svg');
    // Every row of the reader has its icon, no two the same (one icon per meaning).
    expect(
      reader.every((icon) => icon !== ''),
      key,
    ).toBe(true);
    expect(new Set(reader).size, key).toBe(reader.length);
    // The row's facts that have a row in the reader come in the reader's order, with its icons.
    const icons = inRow.map((fact) => fact.icon);
    expect(
      icons.filter((icon) => reader.includes(icon)),
      key,
    ).toEqual(reader.filter((icon) => icons.includes(icon)));
    // The contract leads, like the first row of the Konditionen.
    expect(inRow[0]!.icon, key).toBe(reader[0]);
  }
});

test('the pay stands in ink, the other facts are muted; a permanent job its salary a year', async ({
  page,
}) => {
  await open(page, WIN);
  await everyJob(page);
  const line = facts(page, 'freelancermap-2801');
  const colour = (fact: string) =>
    line.locator(`[data-fact="${fact}"]`).evaluate((node) => getComputedStyle(node).color);
  const ink = await row(page, 'freelancermap-2801')
    .locator('.title')
    .evaluate((node) => getComputedStyle(node).color);
  expect(await colour('money')).toBe(ink);
  expect(await colour('contract')).not.toBe(ink);
  expect(await colour('start')).toBe(await colour('contract'));
  // The icon says euro: the amount has no sign of its own.
  await expect(line.locator('[data-fact="money"]')).toHaveText(/^1\.200\/Tag$/);
  // A permanent job: the salary a year where a freelance job has its day rate.
  const permanent = await shown(facts(page, 'linkedin-4100200303'));
  expect(permanent.map((fact) => fact.key)).toEqual(['contract', 'money', 'start', 'remote']);
  expect(permanent[1]!.text).toMatch(/^95\.000\/Jahr$/);
  expect(permanent[1]!.icon).toBe('lucide-euro');
});

test('an ad that names nothing shows its contract and work mode, a row without any keeps its height', async ({
  page,
}) => {
  await open(page, WIN);
  // A preview: the contract and the work mode from the location, then its badge.
  const teaser = row(page, 'freelance-900411');
  expect((await shown(teaser.getByTestId('row-facts'))).map((fact) => fact.key)).toEqual([
    'contract',
    'mode',
  ]);
  const foot = teaser.locator('.foot');
  const badge = (await foot.locator('.badge').boundingBox())!;
  const last = (await teaser.locator('[data-fact="mode"]').boundingBox())!;
  // The badge follows the last fact shown (the gap of the line), not the far edge.
  expect(badge.x - (last.x + last.width)).toBeLessThan(12);
  // Not scored yet: the work mode alone.
  expect(
    (await shown(row(page, 'linkedin-4100200302').getByTestId('row-facts'))).map((f) => f.key),
  ).toEqual(['mode']);
  // Neither facts nor a location that says how: no line of facts, the row keeps its height.
  const key = { portal: 'linkedin', id: '4100200302' } as const;
  const job = (await page.evaluate((k) => window.__harness.job(k), key)) as JobView;
  await page.evaluate(
    (base) =>
      window.__harness.emit({
        type: 'jobUpdated',
        job: { ...base, workMode: null, detail: { kind: 'ok' } },
        fresh: false,
      }),
    job,
  );
  await expect(row(page, 'linkedin-4100200302').getByTestId('row-facts')).toHaveCount(0);
  expect(Math.round((await row(page, 'linkedin-4100200302').boundingBox())!.height)).toBe(86);
});

test('a fact the ad names in other ways: an hourly rate, another currency, the workload, on site', async ({
  page,
}) => {
  await open(page, WIN);
  const key = { portal: 'linkedin', id: '4100200301' } as const;
  const job = (await page.evaluate((k) => window.__harness.job(k), key)) as JobView;
  const emit = (next: Partial<NonNullable<JobView['match']>['facts']>, workMode = job.workMode) =>
    page.evaluate(
      ([base, next, mode]) =>
        window.__harness.emit({
          type: 'jobUpdated',
          job: {
            ...base,
            workMode: mode,
            match: { ...base.match!, facts: { ...base.match!.facts, ...next } },
          },
          fresh: false,
        }),
      [job, next, workMode] as const,
    );
  const line = facts(page, 'linkedin-4100200301');
  await emit({ rate: 1000, currency: 'CHF', start: null, remoteFrom: null, remoteTo: null });
  const foreign = await shown(line);
  // Its location says remote: without a share the row says so.
  expect(foreign.map((fact) => fact.key)).toEqual(['contract', 'foreignMoney', 'remote']);
  expect(foreign[1]!.text).toMatch(/^1\.000\sCHF\/Tag$/);
  expect(foreign[1]!.icon).not.toBe('lucide-euro');
  await emit({
    rate: 95,
    hourly: true,
    start: null,
    workloadFrom: 60,
    workloadTo: 60,
    remoteFrom: 0,
    remoteTo: 0,
  });
  const hourly = await shown(line);
  expect(hourly.map((fact) => fact.key)).toEqual(['contract', 'money', 'workload', 'mode']);
  expect(hourly[1]!.text).toMatch(/^95\/Std\.$/);
  expect(hourly[2]!.text).toBe('3 Tage/Woche');
  await emit(
    {
      rate: null,
      start: null,
      workloadFrom: 100,
      workloadTo: 100,
      remoteFrom: null,
      remoteTo: null,
    },
    'hybrid',
  );
  const full = await shown(line);
  expect(full.map((fact) => fact.key)).toEqual(['contract', 'workload', 'mode']);
  expect(full[1]!.text).toBe('Vollzeit');
  expect(full[2]!.icon).toBe(hourly[3]!.icon);
});

for (const width of [480, 520, 960]) {
  test(`nothing is cut at ${width} px, a fact that does not fit steps out whole`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, WIN);
    await everyJob(page);
    const report = await list(page).evaluate((node) => {
      const out = { rows: 0, stepped: 0, problems: [] as string[] };
      for (const line of node.querySelectorAll<HTMLElement>('[data-testid="row-facts"]')) {
        out.rows += 1;
        const foot = line.parentElement!.getBoundingClientRect();
        const edge = line.getBoundingClientRect();
        const name = line.closest('[data-testid^="job-row-"]')?.getAttribute('data-testid');
        for (const fact of line.querySelectorAll<HTMLElement>('.fact')) {
          const box = fact.getBoundingClientRect();
          if (fact.hasAttribute('data-out')) {
            out.stepped += 1;
            if (getComputedStyle(fact).visibility !== 'hidden') {
              out.problems.push(`${name}: ${fact.textContent} out but seen`);
            }
            continue;
          }
          if (box.right > edge.right + 0.5 || box.right > foot.right + 0.5) {
            out.problems.push(`${name}: ${fact.textContent} cut at the right`);
          }
          if (fact.scrollWidth > fact.clientWidth + 0.5) {
            out.problems.push(`${name}: ${fact.textContent} cut inside`);
          }
        }
        for (const badge of line.parentElement!.querySelectorAll('.badge')) {
          if (badge.getBoundingClientRect().right > foot.right + 0.5) {
            out.problems.push(`${name}: badge cut`);
          }
        }
      }
      return out;
    });
    expect(report.rows).toBeGreaterThan(5);
    expect(report.problems).toEqual([]);
    // The narrow list lets facts step out; the wide one shows more of them.
    if (width === 480) expect(report.stepped).toBeGreaterThan(0);
  });
}

test('while facts stepped out, the line names them all in its tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 900 });
  await open(page, WIN);
  const line = facts(page, 'freelancermap-2801');
  await expect(line.locator('[data-out]').first()).toBeAttached();
  const all = await line.locator('.fact').allTextContents();
  await line.hover();
  await expect(page.getByRole('tooltip')).toHaveText(all.join(' · '));
  // A line where everything fits has no tooltip.
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1600, height: 900 });
  const whole = facts(page, 'linkedin-4100200301');
  await expect(whole.locator('.fact')).not.toHaveCount(0);
  await expect(whole.locator('[data-out]')).toHaveCount(0);
  await whole.hover();
  await page.waitForTimeout(600);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('an excluded row says why with the ban icon instead of its facts', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jobs-excluded-open', '1'));
  await open(page, WIN);
  await everyJob(page);
  const excluded = page.getByTestId('excluded-rows').getByTestId('job-row-freelance-900412');
  await expect(excluded.getByTestId('row-facts')).toHaveCount(0);
  expect(await glyphs(excluded, '.foot svg')).toEqual(['lucide-ban']);
  // The ring has no mark of its own.
  await expect(excluded.locator('.ring svg.lucide-ban, .ring .lucide-ban')).toHaveCount(0);
});

test('the title line ends with star, portal tile and date; company and place below', async ({
  page,
}) => {
  await open(page, WIN);
  const job = row(page, 'freelancermap-2801');
  const box = async (selector: string) => (await job.locator(selector).first().boundingBox())!;
  const title = await box('.title');
  const star = await box('.mark');
  const tile = await box('.portal');
  const date = await box('.date');
  expect(star.x + star.width).toBeLessThanOrEqual(tile.x);
  expect(tile.x + tile.width).toBeLessThanOrEqual(date.x);
  for (const part of [star, tile, date]) {
    expect(Math.abs(part.y + part.height / 2 - (title.y + title.height / 2))).toBeLessThan(2);
  }
  await expect(job.locator('.portal')).toContainText('+1');
  await expect(job.locator('.meta')).toHaveText(/Hanseatic Holding GmbH\s*·?\s*Hamburg/);
  await expect(job.locator('.meta .portal')).toHaveCount(0);
});
