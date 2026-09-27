// The remaining backend pieces and their small UI ends: the excluded jobs counted per place
// (the section says its number in Archiv and Papierkorb before every page is there), the
// best new jobs of the Übersicht while others wait for a score (by match those come first),
// the app's version in Wartung, Einstellungen opened at one portal from a job ("Anmeldung
// einrichten", with the way back) and the demo start, which has no profile, never fetches
// and says that it is the demo.

import type { Page } from '@playwright/test';
import type { JobView, Place, Portal } from '../../../ui/src/lib/ipc/types';
import { animationsDone, calls, expect, open, test } from './fixtures';

const WIN = '?platform=windows';
// The open job's stage (the one on its way out has dropped its test id).
const stage = (page: Page) => page.getByTestId('stage');

/** Change jobs of the stub (another place, no score yet) before the page asks for the app
 *  state. */
async function changedAtStart(
  page: Page,
  keys: readonly (readonly [Portal, string])[],
  patch: Partial<Pick<JobView, 'place' | 'match'>>,
): Promise<void> {
  await page.addInitScript(
    ({ keys, patch }) => {
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
              if (job) value.emit({ type: 'jobUpdated', job: { ...job, ...patch }, fresh: false });
            }
          });
        },
      });
    },
    { keys, patch },
  );
}

/** Put jobs of the stub into another place before the page asks for the app state. */
function movedAtStart(
  page: Page,
  keys: readonly (readonly [Portal, string])[],
  place: Place,
): Promise<void> {
  return changedAtStart(page, keys, { place });
}

/**
 * Jobs of `?scenario=many` (stub.ts manyJobs, every fourth from the fourth excluded): all 500
 * excluded ones and the first ten others. A page of 120 then holds the ten and 110 of the
 * excluded ones: the folded section ends the list before its last page.
 */
function excludedAndTen(): [Portal, string][] {
  const portals: Portal[] = ['linkedin', 'freelance', 'freelancermap'];
  const keys: [Portal, string][] = [];
  let others = 0;
  for (let i = 0; i < 2000; i += 1) {
    const excluded = i % 4 === 3;
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
    await expect(divider).toHaveText('Ausgeschlossen (500)');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
  });
}

test('Einstellungen names the version of the app under the last card, to copy', async ({
  page,
}) => {
  await open(page, `${WIN}&view=settings`);
  const line = page.getByTestId('version');
  await expect(line).toHaveText('Version 3.0.0');
  await expect(line).toHaveAttribute('data-copy', '');
});

test('Anmeldung einrichten opens Einstellungen at the portal, its sign-in focused, and leads back to the job', async ({
  page,
}) => {
  const title = 'SAP S/4HANA Finance Projektleitung';
  await open(page, WIN);
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
  // The job's row has the focus: the keys go on from the job, not from the top of the page.
  const row = page.getByTestId('job-list').getByTestId('job-row-freelance-900411');
  await expect(row).toBeFocused();
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
  for (const id of ['mailbox-change', 'mailbox-remove', 'folder-change', 'reset']) {
    await expect(page.getByTestId(id)).toHaveAttribute('aria-disabled', 'true');
  }
  // What stays in its own folders still works: the folder and the log open.
  await expect(page.getByTestId('folder-open')).not.toHaveAttribute('aria-disabled', 'true');
  // No portal either: the sign-in is off and says why.
  const signIn = page.getByTestId('sign-in-freelance');
  await expect(signIn).toHaveAttribute('aria-disabled', 'true');
  await signIn.hover();
  await expect(page.getByRole('tooltip')).toHaveText('In der Demo geht das nicht.');
});

test('the demo starts without a profile: nothing scored, the list by date, Profil offers a file', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=demo`);
  await expect(page.getByTestId('job-list').getByTestId('no-profile')).toBeVisible();
  const listed = await calls(page, 'list_jobs');
  expect(listed.at(-1)?.[1]).toMatchObject({ query: { sort: 'newest' } });
  await page.getByTestId('nav-profile').click();
  await expect(page.getByTestId('profile-empty')).toBeVisible();
  await expect(page.getByTestId('profile-pick')).toBeVisible();
});

test('the sidebar says it is the demo where the OS hides the window title', async ({ page }) => {
  // macOS hides the title: the sidebar's foot says it.
  await open(page, '?platform=macos&scenario=demo');
  await expect(page.getByTestId('sidebar').getByTestId('demo-mark')).toHaveText('Demo');
  await open(page, '?platform=macos');
  await expect(page.getByTestId('sidebar').getByTestId('nav-jobs')).toBeVisible();
  await expect(page.getByTestId('demo-mark')).toHaveCount(0);
  // Windows says it in its title bar ("CXact Demo"): the sidebar does not repeat it.
  await open(page, '?platform=windows&scenario=demo');
  await expect(page.getByTestId('sidebar').getByTestId('nav-jobs')).toBeVisible();
  await expect(page.getByTestId('demo-mark')).toHaveCount(0);
});
