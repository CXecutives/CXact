// The remaining backend pieces and their small UI ends: the excluded jobs counted per place
// (the section says its number in Archiv and Papierkorb before every page is there), the
// app's version in Wartung, Einstellungen opened at one portal from a job ("Anmeldung
// einrichten", with the way back) and the demo start, which never fetches.

import type { Page } from '@playwright/test';
import type { Place, Portal } from '../../../ui/src/lib/ipc/types';
import { animationsDone, calls, expect, open, test } from './fixtures';

const WIN = '?platform=windows';
// The open job's stage (the one on its way out has dropped its test id).
const stage = (page: Page) => page.getByTestId('stage');

/** Put jobs of the stub into another place before the page asks for the app state. */
async function movedAtStart(
  page: Page,
  keys: readonly (readonly [Portal, string])[],
  place: Place,
): Promise<void> {
  await page.addInitScript(
    ({ keys, place }) => {
      let harness: Window['__harness'] | undefined;
      Object.defineProperty(window, '__harness', {
        configurable: true,
        get: () => harness,
        set: (value: Window['__harness']) => {
          harness = value;
          // After the stub has built its jobs (the rest of its module), before app_state.
          queueMicrotask(() => {
            for (const [portal, id] of keys) {
              const job = value.job({ portal, id });
              if (job) value.emit({ type: 'jobUpdated', job: { ...job, place }, fresh: false });
            }
          });
        },
      });
    },
    { keys, place },
  );
}

/**
 * Jobs of `?scenario=many` (stub.ts manyJobs, every 17th from the 6th excluded): all 118
 * excluded ones and the first ten others. A page of 120 then holds the ten and 110 of the
 * excluded ones: the folded section ends the list before its last page.
 */
function excludedAndTen(): [Portal, string][] {
  const portals: Portal[] = ['linkedin', 'freelance', 'freelancermap'];
  const keys: [Portal, string][] = [];
  let others = 0;
  for (let i = 0; i < 2000; i += 1) {
    const excluded = i % 17 === 5;
    if (!excluded && others >= 10) continue;
    if (!excluded) others += 1;
    keys.push([portals[i % 3]!, String(100000 + i)]);
  }
  return keys;
}

for (const [place, tab] of [
  ['archive', 'place-archive'],
  ['trash', 'place-trash'],
] as const) {
  test(`the excluded jobs of the ${place} say their number before every page is there`, async ({
    page,
  }) => {
    await movedAtStart(page, excludedAndTen(), place);
    await open(page, `${WIN}&scenario=many`);
    await page.getByTestId(tab).click();
    const divider = page.getByTestId('excluded-divider');
    await expect(divider).toHaveText('Ausgeschlossen (118)');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
  });
}

test('Wartung names the version of the app, to copy', async ({ page }) => {
  await open(page, `${WIN}&view=settings`);
  const row = page.getByTestId('settings-care').getByTestId('version');
  await expect(row).toContainText('Version');
  await expect(row.locator('[data-copy]')).toHaveText('3.0.0');
});

test('Anmeldung einrichten opens Einstellungen at the portal, its sign-in focused, and leads back to the job', async ({
  page,
}) => {
  const title = 'SAP S/4HANA Finance Projektleitung';
  await open(page, WIN);
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  await page.getByTestId('job-list').getByTestId('job-row-freelance-900411').click();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(title);
  await animationsDone(page);
  await stage(page).getByTestId('set-up-sign-in').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('sign-in-freelance')).toBeFocused();
  await expect(page.getByTestId('portal-freelance')).toBeInViewport();
  const back = page.getByTestId('back-to-job');
  await expect(back).toHaveText('Zurück zum Job');
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(stage(page).getByTestId('reader-title')).toHaveText(title);
  // Read once: Einstellungen from the sidebar is the plain page again.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('view-settings')).toBeVisible();
  await expect(page.getByTestId('portal-freelance')).toBeVisible();
  await expect(page.getByTestId('back-to-job')).toHaveCount(0);
  await expect(page.getByTestId('sign-in-freelance')).not.toBeFocused();
});

test('the demo never fetches and says why; it keeps to its own folders', async ({ page }) => {
  await open(page, `${WIN}&scenario=demo`);
  const fetch = page.getByTestId('fetch');
  await expect(fetch).toHaveAttribute('aria-disabled', 'true');
  await fetch.hover();
  await expect(page.getByRole('tooltip')).toHaveText('In der Demo geht das nicht.');
  await page.mouse.move(0, 0);
  await page.keyboard.press('F5');
  await page.waitForTimeout(200);
  expect(await calls(page, 'start_run')).toEqual([]);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('demo-note')).toHaveText(
    'Demo mit Beispieldaten, ohne Postfach und Portale.',
  );
  for (const id of [
    'full-mailbox',
    'mailbox-change',
    'mailbox-remove',
    'workspace-change',
    'reset',
  ]) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
  }
  // What stays in its own folders still works: the text files, the report.
  await expect(page.getByTestId('txt-rewrite')).not.toHaveAttribute('aria-disabled', 'true');
});
