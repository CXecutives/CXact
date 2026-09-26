// Wave 2, texts: one word per thing and the words of the form (see docs/PLAN.md, glossary).

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';

const WIN = '?platform=windows';
const row = (page: Page, key: string) => page.getByTestId('job-list').getByTestId(`job-row-${key}`);

test('the English reader says must-have in the line; only the optional ones carry a tag', async ({
  page,
}) => {
  await open(page, `${WIN}&lang=en`);
  await row(page, 'freelancermap-2802').click();
  const stage = page.getByTestId('stage');
  await expect(stage.getByTestId('must')).toContainText('must-haves met');
  await expect(
    stage.getByTestId('why').getByText('Optional', { exact: true }).first(),
  ).toBeVisible();
  await expect(stage.getByText('Must-have', { exact: true })).toHaveCount(0);
  await expect(stage.getByText('Required', { exact: true })).toHaveCount(0);
});

test('Einstellungen lists every file the app writes, the Bericht too', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  const files = page.getByTestId('settings-files');
  // Every file the app writes: Excel-Datei, Bericht (the HTML file), then text files.
  const overview = files.getByTestId('overview');
  await expect(overview).toContainText('Bericht');
  await overview.getByRole('button', { name: 'Öffnen', exact: true }).click();
  expect((await calls(page, 'open_target')).at(-1)?.[1]).toEqual({
    target: { kind: 'overview' },
  });
});
