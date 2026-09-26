// The approved job row (user, 2026-09-26): title with star, portal tile and date on line 1,
// company and place on line 2, the ad's facts from the facts table (lib/facts.ts) with their
// icons on line 3, as many as fit whole. The order and the icons are the table's: the specs
// read the table itself (its keys, icons and reader rows) and compare the row with the
// reader's Konditionen instead of retyping them, so a fact that moves or takes another icon
// changes one entry only.

import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { ICONS, type IconMeaning } from '../../../ui/src/lib/icons';
import type { JobView } from '../../../ui/src/lib/ipc/types';
import { animationsDone, expect, open, test } from './fixtures';

/** The facts table (ui/src/lib/facts.ts) as its source states it: each entry's key, icon and
 *  reader row, in the table's order. */
const TABLE = readFileSync(new URL('../../../ui/src/lib/facts.ts', import.meta.url), 'utf8')
  .split('export const FACTS')[1]!
  .split('] as const')[0]!
  .split(/\{\s*key: /)
  .slice(1)
  .map((entry) => ({
    key: /^'(\w+)'/.exec(entry)![1]!,
    icon: /icon: '([\w-]+)'/.exec(entry)![1]!,
    term: /term: '(\w+)'/.exec(entry)?.[1] ?? null,
  }));
const entry = (key: string) => TABLE.find((fact) => fact.key === key);
/** The class of the Lucide glyph a fact's icon meaning draws (lib/icons.ts). */
const lucide = (key: string) => `lucide-${ICONS[entry(key)!.icon as IconMeaning]}`;

/** The facts a row shows are these (in any order), and they come in the table's order. */
function inTableOrder(keys: string[], members: string[]): void {
  const at = keys.map((key) => TABLE.findIndex((fact) => fact.key === key));
  expect(at).not.toContain(-1);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  expect([...keys].sort()).toEqual([...members].sort());
}

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

test('a row shows its facts in the order of the Konditionen, each value with the same icon', async ({
  page,
}) => {
  // One icon per meaning.
  expect(TABLE.length).toBeGreaterThan(5);
  expect(new Set(TABLE.map((fact) => fact.icon)).size).toBe(TABLE.length);
  await open(page, WIN);
  await everyJob(page);
  // A rate, a salary, a remote share, a hybrid and an on-site job without a share.
  for (const key of [
    'linkedin-4100200301',
    'linkedin-4100200303',
    'freelancermap-2801',
    'freelancermap-2804',
    'freelance-900413',
  ]) {
    const inRow = await shown(facts(page, key));
    expect(inRow.length, key).toBeGreaterThan(1);
    await openJob(page, key);
    const terms = page.getByTestId('criteria');
    const reader = await glyphs(terms, '.term-name svg');
    // Every row of the reader has its icon, no two the same.
    expect(
      reader.every((icon) => icon !== ''),
      key,
    ).toBe(true);
    expect(new Set(reader).size, key).toBe(reader.length);
    const rows = await terms
      .locator('[data-row]')
      .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.row ?? ''));
    // Each fact the reader has a row for: the row's icon is the icon of that reader row (a
    // hybrid job's building, a salary's euro), and they come in the reader's order.
    const at: number[] = [];
    for (const fact of inRow) {
      const term = entry(fact.key)?.term ?? null;
      if (term === null) continue;
      at.push(rows.indexOf(term));
      expect(await glyphs(terms.getByTestId(`term-${term}`), '.term-name svg'), key).toEqual([
        fact.icon,
      ]);
    }
    expect(at, key).not.toContain(-1);
    expect(at, key).toEqual([...at].sort((a, b) => a - b));
    // The contract leads, like the first row of the Konditionen.
    expect(inRow[0]!.icon, key).toBe(reader[0]);
  }
});

test('a start to be agreed and a salary read alike in the row and in the reader', async ({
  page,
}) => {
  await open(page, WIN);
  await everyJob(page);
  const start = facts(page, 'freelancermap-2804').locator('[data-fact="start"]');
  const words = (await start.textContent()) ?? '';
  expect(words).not.toBe('');
  await openJob(page, 'freelancermap-2804');
  const terms = page.getByTestId('criteria');
  await expect(terms.getByTestId('term-start').locator('.term-line')).toHaveText(words);
  // The ad says the same words (the engine reads "nach Absprache" as a start to be agreed).
  await expect(page.getByTestId('reader')).toContainText(`Start ${words}`);
  // A permanent job's salary: the reader's pay row names it, like the list row.
  const pay = await facts(page, 'linkedin-4100200303').locator('[data-fact="money"]').textContent();
  expect(pay).toMatch(/^95\.000\/Jahr$/);
  await openJob(page, 'linkedin-4100200303');
  const rate = terms.getByTestId('term-rate');
  await expect(rate.locator('.term-name')).toHaveText('Gehalt');
  await expect(rate.locator('.term-line')).toHaveText(/^\s*95\.000\s€\/Jahr\s*$/);
});

test('the pay stands in ink, the other facts are muted; a permanent job its salary a year', async ({
  page,
}) => {
  await open(page, WIN);
  await everyJob(page);
  const line = facts(page, 'freelancermap-2801');
  // Read in one go from the row as it stands (the list may still draw it anew).
  const colours = () =>
    row(page, 'freelancermap-2801').evaluate((node) => {
      const of = (selector: string) => {
        const part = node.querySelector(selector);
        return part === null ? '' : getComputedStyle(part).color;
      };
      const ink = of('.title');
      return {
        drawn: ink !== '',
        money: of('[data-fact="money"]') === ink,
        contract: of('[data-fact="contract"]') === ink,
        start: of('[data-fact="start"]') === of('[data-fact="contract"]'),
      };
    });
  await expect.poll(colours).toEqual({ drawn: true, money: true, contract: false, start: true });
  // The icon says euro: the amount has no sign of its own.
  await expect(line.locator('[data-fact="money"]')).toHaveText(/^1\.200\/Tag$/);
  // A permanent job: the salary a year where a freelance job has its day rate.
  const permanent = await shown(facts(page, 'linkedin-4100200303'));
  inTableOrder(
    permanent.map((fact) => fact.key),
    ['contract', 'money', 'start', 'remote'],
  );
  const salary = permanent.find((fact) => fact.key === 'money')!;
  expect(salary.text).toMatch(/^95\.000\/Jahr$/);
  expect(salary.icon).toBe(lucide('money'));
});

test('an ad that names nothing shows its contract and work mode, a row without any keeps its height', async ({
  page,
}) => {
  await open(page, WIN);
  // A preview: the contract and the work mode from the location, then its badge.
  const teaser = row(page, 'freelance-900411');
  inTableOrder(
    (await shown(teaser.getByTestId('row-facts'))).map((fact) => fact.key),
    ['contract', 'mode'],
  );
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
  const of = (list: Awaited<ReturnType<typeof shown>>, key: string) =>
    list.find((fact) => fact.key === key)!;
  const chf = { rate: 1000, currency: 'CHF', start: null, remoteFrom: null, remoteTo: null };
  await emit(chf);
  const foreign = await shown(line);
  // Its location says remote: without a share the row says so.
  inTableOrder(
    foreign.map((fact) => fact.key),
    ['contract', 'foreignMoney', 'remote'],
  );
  expect(of(foreign, 'foreignMoney').text).toMatch(/^1\.000\sCHF\/Tag$/);
  expect(of(foreign, 'foreignMoney').icon).not.toBe(lucide('money'));
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
  inTableOrder(
    hourly.map((fact) => fact.key),
    ['contract', 'money', 'workload', 'mode'],
  );
  expect(of(hourly, 'money').text).toMatch(/^95\/Std\.$/);
  expect(of(hourly, 'workload').text).toBe('3 Tage/Woche');
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
  inTableOrder(
    full.map((fact) => fact.key),
    ['contract', 'workload', 'mode'],
  );
  expect(of(full, 'workload').text).toBe('Vollzeit');
  expect(of(full, 'mode').icon).toBe(of(hourly, 'mode').icon);
  // The reader's pay row of a rate in another currency has the row's icon (not the euro).
  await emit(chf);
  await openJob(page, 'linkedin-4100200301');
  expect(await glyphs(page.getByTestId('term-rate'), '.term-name svg')).toEqual([
    of(foreign, 'foreignMoney').icon,
  ]);
});

for (const width of [480, 520, 960]) {
  test(`nothing is cut at ${width} px, a fact that does not fit steps out whole`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, WIN);
    await everyJob(page);
    // The facts are measured after the list is drawn (a resize observer): the report settles.
    const measure = () =>
      list(page).evaluate((node) => {
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
    let report = await measure();
    await expect.poll(async () => (report = await measure()).problems).toEqual([]);
    expect(report.rows).toBeGreaterThan(5);
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
  await expect.poll(() => glyphs(excluded, '.foot svg')).toEqual(['lucide-ban']);
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
  // On hover the tools take the place of star and date; the tile stays before them and names
  // the other portals in its tooltip.
  await job.hover();
  const tool = page.getByTestId('archive-freelancermap-2801');
  await expect(tool).toBeVisible();
  await animationsDone(page);
  const portal = job.locator('.portal');
  const at = (await portal.boundingBox())!;
  const tools = (await list(page)
    .locator('.job', { has: page.getByTestId('job-row-freelancermap-2801') })
    .locator('.tools')
    .boundingBox())!;
  expect(at.x + at.width).toBeLessThanOrEqual(tools.x);
  expect(await portal.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  await portal.hover();
  await expect(page.getByRole('tooltip')).toHaveText('freelancermap.de · auch auf linkedin.com');
  await expect(job.locator('.meta')).toHaveText(/Hanseatic Holding GmbH\s*·?\s*Hamburg/);
  await expect(job.locator('.meta .portal')).toHaveCount(0);
});
