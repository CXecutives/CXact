// DS-3: terms added to the profile from the Übersicht, and their undos, each save the form as
// the view showed it. The store applies each change to the list it holds now (core's
// `profile::form::rebase`, which the stub mirrors): an undo takes out its own term only.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';

const keywords = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__harness.form()?.keywords ?? []);

test('DS-3: add two terms, undo the first, then the second; each undo takes out its own term only', async ({
  page,
}) => {
  await open(page, '?platform=windows&view=overview');
  const start = await keywords(page);
  const block = page.getByTestId('open-musts');
  const musts = block.getByTestId('open-must');
  await expect(musts.nth(1)).toBeVisible();
  const label = async (n: number): Promise<string> =>
    (await musts.nth(n).locator('.must-label').textContent())?.trim() ?? '';
  const x = await label(0);
  const y = await label(1);
  expect(x).not.toBe('');
  expect(y).not.toBe('');
  expect(start).not.toContain(x);
  expect(start).not.toContain(y);
  const saves = async (): Promise<number> => (await calls(page, 'save_profile')).length;
  const toast = (term: string) => page.getByTestId('toast').filter({ hasText: `„${term}“` });

  await musts.filter({ hasText: x }).getByTestId('add-must').click();
  await expect(toast(x)).toBeVisible();
  await musts.filter({ hasText: y }).getByTestId('add-must').click();
  await expect(toast(y)).toBeVisible();
  await expect.poll(saves).toBe(2);
  expect(await keywords(page)).toEqual([...start, x, y]);

  // Undo the first: the second stays.
  await toast(x).getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(saves).toBe(3);
  await expect.poll(() => keywords(page)).toEqual([...start, y]);

  // Undo the second: the first does not come back.
  await toast(y).getByRole('button', { name: 'Rückgängig' }).click();
  await expect.poll(saves).toBe(4);
  await expect.poll(() => keywords(page)).toEqual(start);
});
