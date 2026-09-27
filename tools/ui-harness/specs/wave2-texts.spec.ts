// Wave 2, texts: one word per thing and the words of the form (see docs/PLAN.md, glossary).

import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures';

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
