// DS-3: terms added to the profile from the reader ("Zum Profil hinzufügen"), and their undos,
// each save the form as the view showed it. The store applies each change to the list it
// holds now (core's `profile::form::rebase`, which the stub mirrors): an undo takes out its
// own term only.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
import { openJob } from './helpers';

const keywords = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__harness.form()?.keywords ?? []);

test('DS-3: add two terms, undo the first, then the second; each undo takes out its own term only', async ({
  page,
}) => {
  await open(page, '?platform=windows');
  const start = await keywords(page);
  await openJob(page, 'freelancermap-2802');
  const adds = page.getByTestId('reader').getByTestId('add-to-profile');
  await expect(adds.nth(1)).toBeVisible();
  const saves = async (): Promise<number> => (await calls(page, 'save_profile')).length;
  /** The term the last save added (the keywords now, less the ones before). */
  const added = async (before: string[]): Promise<string> =>
    (await keywords(page)).find((word) => !before.includes(word)) ?? '';

  await adds.nth(0).click();
  await expect.poll(saves).toBe(1);
  const x = await added(start);
  // The first one says "Hinzugefügt" now: the next button is the other term's.
  await adds.nth(0).click();
  await expect.poll(saves).toBe(2);
  const y = await added([...start, x]);
  expect(x).not.toBe('');
  expect(y).not.toBe('');
  expect(await keywords(page)).toEqual([...start, x, y]);
  const toast = (term: string) => page.getByTestId('toast').filter({ hasText: term });

  // Undo the first: the second stays.
  await toast(x).getByTestId('toast-action').click();
  await expect.poll(saves).toBe(3);
  await expect.poll(() => keywords(page)).toEqual([...start, y]);

  // Undo the second: the first does not come back.
  await toast(y).getByTestId('toast-action').click();
  await expect.poll(saves).toBe(4);
  await expect.poll(() => keywords(page)).toEqual(start);
});
