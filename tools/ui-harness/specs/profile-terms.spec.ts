// DS-3: terms added to the profile from the reader ("+" beside a missing must, each into the
// field it belongs to), and their undos, each save the profile as it is stored when its turn
// comes (the saves go one after the other): an undo takes out its own term only.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';
import { openJob } from './helpers';

/** Every term the stored profile names in the fields a "+" puts one into. */
const terms = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const form = window.__harness.form();
    if (!form) return [];
    return [
      ...form.competences.map((row) => row.name),
      ...form.tools,
      ...form.industries,
      ...form.certificates,
      ...form.degrees,
      ...form.languages.map((row) => row.language),
    ];
  });

test('DS-3: add two terms, undo the first, then the second; each undo takes out its own term only', async ({
  page,
}) => {
  await open(page, '?platform=windows');
  const start = await terms(page);
  await openJob(page, 'freelancermap-2802');
  const adds = page.getByTestId('reader').getByTestId('add-to-profile');
  await expect(adds.nth(1)).toBeVisible();
  const saves = async (): Promise<number> => (await calls(page, 'save_profile')).length;
  /** The term the last save added (the terms now, less the ones before). */
  const added = async (before: string[]): Promise<string> =>
    (await terms(page)).find((word) => !before.includes(word)) ?? '';
  const sorted = (list: string[]): string[] => [...list].sort();

  await adds.nth(0).click();
  await expect.poll(saves).toBe(1);
  const x = await added(start);
  // The first one says "Hinzugefügt" now: the next button is the other term's.
  await adds.nth(0).click();
  await expect.poll(saves).toBe(2);
  const y = await added([...start, x]);
  expect(x).not.toBe('');
  expect(y).not.toBe('');
  expect(sorted(await terms(page))).toEqual(sorted([...start, x, y]));
  const toast = (term: string) => page.getByTestId('toast').filter({ hasText: term });

  // Undo the first: the second stays.
  await toast(x).getByTestId('toast-action').click();
  await expect.poll(saves).toBe(3);
  await expect.poll(async () => sorted(await terms(page))).toEqual(sorted([...start, y]));

  // Undo the second: the first does not come back.
  await toast(y).getByTestId('toast-action').click();
  await expect.poll(saves).toBe(4);
  await expect.poll(async () => sorted(await terms(page))).toEqual(sorted(start));
});
