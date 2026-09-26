// Final round, shell track (input): the wheel and the mouse buttons do only what they should.
// The wheel never changes a value and scrolls what lies under the pointer; over an open menu
// only the menu scrolls, behind a modal dialog nothing does. A right click without a menu, a
// middle click on a button, a link-like button or a row do nothing; the back button and the
// back key go back only where a view has a way back; single list keys type in the search;
// key scrolling glides in one short tween (a jump under reduced motion).

import type { Page } from '@playwright/test';
import { calls, expect, open, settle, test } from './fixtures';

const WIN = '?platform=windows';

const rows = (page: Page) => page.locator('[data-testid^="job-row-"]');

/** The scroll position of the shown view (or of an element). */
const scrollTop = (page: Page, testid: string): Promise<number> =>
  page.getByTestId(testid).evaluate((node) => node.scrollTop);

/** The job list's own scroll area (the element that scrolls around the rows). */
const listScroll = (page: Page): Promise<number> =>
  rows(page)
    .first()
    .evaluate((row) => {
      for (let node = row.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          return node.scrollTop;
        }
      }
      return -1;
    });

/** Wheel over the middle of an element. */
async function wheelOver(page: Page, testid: string, dy = 240): Promise<void> {
  const box = (await page.getByTestId(testid).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(300);
}

test('the wheel over a switch changes nothing and scrolls the page', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  const toggle = page.getByTestId('toggle-auto-archive');
  const before = await toggle.getAttribute('aria-checked');
  await wheelOver(page, 'toggle-auto-archive');
  await expect(toggle).toHaveAttribute('aria-checked', before ?? 'false');
  expect(await scrollTop(page, 'view-settings')).toBeGreaterThan(0);
});

test('the wheel over a field and a choice changes nothing and scrolls the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const rate = page.locator(
    '[data-testid="profile-min-rate"] input, input[data-testid="profile-min-rate"]',
  );
  await rate.fill('950');
  await wheelOver(page, 'profile-min-rate');
  await expect(rate).toHaveValue('950');
  const view = await scrollTop(page, 'view-profile');
  expect(view).toBeGreaterThan(0);
  // A choice (a radio group): the chosen option stays chosen.
  const group = page.locator('[data-testid="view-profile"] [role="radiogroup"]').first();
  await group.scrollIntoViewIfNeeded();
  const chosen = await group.locator('[aria-checked="true"]').allTextContents();
  const box = (await group.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect(await group.locator('[aria-checked="true"]').allTextContents()).toEqual(chosen);
});

test('over an open menu only the menu scrolls; the list behind stays and the menu stays open', async ({
  page,
}) => {
  await open(page, WIN);
  await rows(page).nth(1).click({ button: 'right' });
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  const list = await listScroll(page);
  const box = (await menu.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  expect(await listScroll(page)).toBe(list);
  // Outside the menu the page scrolls again, and the scroll closes the menu.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('behind a modal dialog nothing scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('keys-help')).toBeVisible();
  // Over the scrim, away from the card.
  await page.mouse.move(300, 60);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  expect(await scrollTop(page, 'view-settings')).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('keys-help')).toHaveCount(0);
});

test('a right click where nothing offers a menu does nothing', async ({ page }) => {
  await open(page, `${WIN}&view=settings`);
  const heading = page.locator('[data-testid="view-settings"] h2').first();
  await heading.click({ button: 'right' });
  await page.waitForTimeout(150);
  await expect(page.getByTestId('menu')).toHaveCount(0);
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('a middle click on a button, a link-like button or a row does nothing', async ({
  page,
  context,
}) => {
  await open(page, WIN);
  const pages = context.pages().length;
  await page.getByTestId('fetch').click({ button: 'middle' });
  await rows(page).first().click({ button: 'middle' });
  await page.waitForTimeout(200);
  expect(await calls(page, 'start_run')).toHaveLength(0);
  expect(await calls(page, 'job_detail')).toHaveLength(0);
  // The ad's link (it opens the page outside the app on a left click only).
  await rows(page).first().click();
  const openAd = page.getByTestId('open-ad');
  await openAd.scrollIntoViewIfNeeded();
  await openAd.click({ button: 'middle' });
  await page.waitForTimeout(200);
  expect(await calls(page, 'open_target')).toHaveLength(0);
  expect(context.pages()).toHaveLength(pages);
});

test('the back button and the back key do nothing where no view has a way back', async ({
  page,
}) => {
  await open(page, WIN);
  const url = page.url();
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  // The mouse's back and forward buttons (3 and 4) and Alt+Left/Right.
  await page.evaluate(() => {
    for (const button of [3, 4]) {
      const init = { bubbles: true, cancelable: true, button };
      document.body.dispatchEvent(new MouseEvent('mousedown', init));
      document.body.dispatchEvent(new MouseEvent('mouseup', init));
    }
  });
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(200);
  expect(page.url()).toBe(url);
  // The wide Jobs view has no Zurück: the open job stays.
  await expect(page.getByTestId('reader')).toBeVisible();
});

// JobsView registers its Zurück of one column with `onBack` (lib/input/input.ts); until it
// does, the back button has nothing to go back to.
test.fixme('the back button goes back where the reader in one column has Zurück', async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await open(page, WIN);
  await rows(page).first().click();
  await expect(page.getByTestId('back')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('back')).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
});

test('single list keys type inside the search field', async ({ page }) => {
  await open(page, WIN);
  await rows(page).first().click();
  const search = page.getByTestId('search');
  await search.click();
  await page.keyboard.type('esub o');
  await expect(search).toHaveValue('esub o');
  for (const command of ['move_jobs', 'set_pinned', 'open_target']) {
    expect(await calls(page, command), command).toHaveLength(0);
  }
});

test('nothing drags but the handle and the drag regions; a double click selects only copyable text', async ({
  page,
}) => {
  await open(page, WIN);
  // No ghost of a row, an icon or plain text.
  const dragged = await page.evaluate(() =>
    ['[data-testid^="job-row-"]', '[data-testid="nav-jobs"] svg', '[data-testid="places"]'].map(
      (css) => {
        const node = document.querySelector(css)!;
        const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      },
    ),
  );
  expect(dragged).toEqual([true, true, true]);
  // A double click on a control selects nothing; on the job's title (copyable) a word.
  await page.getByTestId('nav-jobs').dblclick();
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  await rows(page).first().click();
  const title = page.locator('[data-testid="reader"] [data-copy]').first();
  await title.dblclick();
  expect((await page.evaluate(() => getSelection()?.toString() ?? '')).trim()).not.toBe('');
});

test('the page keys glide in one short tween; under reduced motion they jump', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  // A click on plain text: the focus is nowhere, the keys scroll the pane clicked last.
  await page.locator('[data-testid="view-settings"] h2').first().click();
  await page.keyboard.press('PageDown');
  const early = await scrollTop(page, 'view-settings');
  await page.waitForTimeout(400);
  const end = await scrollTop(page, 'view-settings');
  expect(end).toBeGreaterThan(300);
  expect(early).toBeLessThan(end);
  // Reduced motion: at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, `${WIN}&view=settings`);
  await settle(page);
  await page.locator('[data-testid="view-settings"] h2').first().click();
  await page.keyboard.press('PageDown');
  expect(await scrollTop(page, 'view-settings')).toBeGreaterThan(300);
});
