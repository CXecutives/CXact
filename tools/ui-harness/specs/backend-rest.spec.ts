// The remaining backend pieces and their small UI ends: the excluded jobs counted per place
// (the section says its number in Archiv and Papierkorb before every page is there).

import type { Page } from '@playwright/test';
import type { Place, Portal } from '../../../ui/src/lib/ipc/types';
import { expect, open, test } from './fixtures';

const WIN = '?platform=windows';

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
