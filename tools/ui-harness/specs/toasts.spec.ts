// The toasts (components/Toast.svelte, lib/state/toasts.svelte.ts) on the sheet of the
// surfaces (`?sheet=surfaces`): no close button (decision 8, 2026-10-24), a plain toast
// without a sign, and the pointer on a toast stops its time. The look is not pinned here.

import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures';

async function sheet(page: Page): Promise<void> {
  await open(page, '?sheet=surfaces');
  await expect(page.getByTestId('sheet-surfaces')).toBeVisible();
}

test('a toast has no close button; a plain one has no sign', async ({ page }) => {
  await open(page, '?sheet=surfaces&toasts');
  const toasts = page.getByTestId('toast');
  await expect(toasts).toHaveCount(3);
  // Only the toasts' own buttons (Rückgängig, Zeigen), never one that closes it.
  for (const toast of await toasts.all()) {
    await expect(toast.getByRole('button')).toHaveCount(
      (await toast.getByTestId('toast-action').count()) > 0 ? 1 : 0,
    );
  }
  const plain = page.locator('[data-testid="toast"][data-kind="plain"]');
  await expect(plain).toHaveText('2 Jobs passen jetzt besser');
  await expect(plain.locator('svg')).toHaveCount(0);
});

test('the pointer on a toast stops its time; it goes once the pointer leaves', async ({ page }) => {
  await sheet(page);
  await page.getByRole('button', { name: 'Toasts zeigen' }).click();
  const plain = page.locator('[data-testid="toast"][data-kind="plain"]');
  await expect(plain).toBeVisible();
  await plain.hover();
  // Longer than the 4 s of a plain toast.
  await page.waitForTimeout(4500);
  await expect(plain).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(plain).toHaveCount(0, { timeout: 6000 });
});

test('a toast is one height with or without its link; its sign is 16', async ({ page }) => {
  await open(page, '?sheet=surfaces&toasts');
  const plain = page.locator('[data-testid="toast"][data-kind="plain"]');
  const undo = page.locator('[data-testid="toast"][data-kind="success"]');
  await expect(undo.getByTestId('toast-action')).toBeVisible();
  const [without, withLink] = await Promise.all([plain.boundingBox(), undo.boundingBox()]);
  expect(without!.height).toBe(withLink!.height);
  const sign = await undo.locator('svg').first().boundingBox();
  expect(sign!.width).toBe(16);
});

test('the keyboard in a toast stops its time; it goes once the focus leaves', async ({ page }) => {
  await sheet(page);
  await page.getByRole('button', { name: 'Toasts zeigen' }).click();
  const undo = page.locator('[data-testid="toast"][data-kind="success"]');
  await undo.getByTestId('toast-action').focus();
  // Every toast waits, the plain one too, past its 4 s.
  const plain = page.locator('[data-testid="toast"][data-kind="plain"]');
  await page.waitForTimeout(4500);
  await expect(plain).toBeVisible();
  await page.getByRole('button', { name: 'Toasts zeigen' }).focus();
  await expect(plain).toHaveCount(0, { timeout: 6000 });
});
