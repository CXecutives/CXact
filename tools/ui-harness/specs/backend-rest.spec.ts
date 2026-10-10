// The remaining backend pieces and their small UI ends: the excluded jobs counted per place
// (the section says its number in Archiv and Papierkorb before every page is there).

import type { Page } from '@playwright/test';
import type { JobView, Place, Portal } from '../../../ui/src/lib/ipc/types';
import { expect, open, test } from './fixtures';

const WIN = '?platform=windows';

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
    await expect(divider.locator('.count')).toHaveText('500');
    await expect(divider).toHaveAttribute('aria-expanded', 'false');
  });
}
