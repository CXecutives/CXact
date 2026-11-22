// The core controls on their states sheet (`?sheet=controls`, tools/ui-harness/sheets/): one
// height per kind, one width while a button swaps (`sizeTo`) and for a pair (`--btn-min`), the
// select's keys with the focus kept on its button and the tick on its chosen option, a closed
// chip list that lists only what is typed, and a chip that rises in only when it is added.

import type { Locator, Page } from '@playwright/test';
import { expect, open, test } from './fixtures';
import { T, WIN } from './helpers';
import { px } from './scale';

const STATES = `${WIN}&sheet=controls`;

async function sheet(page: Page): Promise<Locator> {
  await open(page, STATES);
  const states = page.getByTestId('states-controls');
  await expect(states).toBeVisible();
  return states;
}

const width = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.width;
const height = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.height;

test('one height per kind: 30, the quiet glyph 28, a suggestion 32', async ({ page }) => {
  const states = await sheet(page);
  await expect
    .poll(() => height(states.getByRole('button', { name: T.toolbar.searchNow }).first()))
    .toBe(px('--control-field'));
  await expect
    .poll(() => height(states.getByRole('button', { name: T.edit.copy }).first()))
    .toBe(px('--control-field'));
  const quiet = states.locator('.btn.ghost.icon-only').first();
  expect(await height(quiet)).toBe(px('--control-icon'));
  expect(await width(quiet)).toBe(px('--control-icon'));
  expect(
    await height(states.getByRole('listbox', { name: 'Tools' }).getByRole('option').first()),
  ).toBe(px('--menu-row'));
  expect(await height(page.getByTestId('states-select'))).toBe(px('--control-field'));
  expect(await height(page.getByTestId('states-level'))).toBe(px('--control-field'));
  expect(await width(page.getByTestId('states-select'))).toBeGreaterThanOrEqual(150);
});

test('a button that swaps keeps one width, busy too; a pair has one least width', async ({
  page,
}) => {
  await sheet(page);
  const still = await width(page.getByTestId('states-cancel-still'));
  const search = page.getByTestId('states-search');
  expect(await width(search)).toBe(still);
  // The hidden copy reserves the width only: the name and the words stay its own.
  await expect(search).toHaveAccessibleName(T.toolbar.searchNow);
  await search.click();
  await expect(page.getByTestId('states-cancel')).toBeVisible();
  expect(await width(page.getByTestId('states-cancel'))).toBe(still);
  // Busy keeps the width of its words.
  const saving = page.getByTestId('states-saving');
  await expect(saving).toHaveAttribute('aria-busy', 'true');
  expect(await width(saving)).toBeGreaterThan(60);
  for (const button of await page.getByTestId('states-pair').getByRole('button').all()) {
    expect(await width(button)).toBeGreaterThanOrEqual(88);
  }
});

test('a select: the arrows open its list, the focus stays on its button; Enter, Esc', async ({
  page,
  browserName,
}) => {
  await sheet(page);
  const select = page.getByTestId('states-select');
  await expect(select).toHaveText('Gmail');
  await select.focus();
  await page.keyboard.press('ArrowDown');
  const list = page.getByRole('listbox', { name: T.settings.providerLabel });
  await expect(list).toBeVisible();
  await expect(select).toBeFocused();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  // The chosen option is active and carries the one tick of the list.
  const chosen = list.getByRole('option', { name: 'Gmail' });
  await expect(chosen).toHaveAttribute('aria-selected', 'true');
  await expect(select).toHaveAttribute('aria-activedescendant', (await chosen.getAttribute('id'))!);
  await expect(chosen.locator('.tick')).toHaveCount(1);
  await expect(list.locator('.tick')).toHaveCount(1);
  // Its box (the frame around the list) is at least as wide as its button.
  expect(await width(page.locator('[data-menu-layer] .frame'))).toBeGreaterThanOrEqual(
    await width(select),
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await expect(select).toHaveText('iCloud');
  await expect(select).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(select).toHaveText('iCloud');
  // The pointer: a click opens it, a click on an option chooses and the focus stays.
  await select.click();
  await list.getByRole('option', { name: 'GMX' }).click();
  await expect(select).toHaveText('GMX');
  // A click focuses a button on Windows, not on macOS (WebKit), as the OS does.
  if (browserName === 'chromium') await expect(select).toBeFocused();
  // A click on the button of the open list closes it.
  await select.click();
  await expect(list).toBeVisible();
  await select.click();
  await expect(list).toHaveCount(0);
  // In the open list Home, End and the first letters move, Space chooses, Tab closes it.
  const marked = async (name: string): Promise<void> => {
    const id = await list.getByRole('option', { name }).getAttribute('id');
    await expect(select).toHaveAttribute('aria-activedescendant', id!);
  };
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await expect(list).toBeVisible();
  await page.keyboard.press('End');
  await marked('WEB.DE');
  await page.keyboard.press('Home');
  await marked('Gmail');
  await page.keyboard.type('ic');
  await marked('iCloud');
  await page.keyboard.press(' ');
  await expect(list).toHaveCount(0);
  await expect(select).toHaveText('iCloud');
  await expect(select).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(list).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(list).toHaveCount(0);
  await expect(select).toHaveText('iCloud');
});

test('a radio list: the chosen row carries the one tick; a click and the arrows choose', async ({
  page,
}) => {
  await sheet(page);
  // The first one is live, the other shows a row under the pointer.
  const group = page.getByRole('radiogroup', { name: 'Sicherungen' }).first();
  const radios = group.getByRole('radio');
  const chosenAlone = async (index: number): Promise<void> => {
    await expect(radios.nth(index)).toHaveAttribute('aria-checked', 'true');
    await expect(group.locator('[aria-checked="true"]')).toHaveCount(1);
    await expect(radios.nth(index).locator('svg')).toHaveCount(1);
    await expect(group.locator('svg')).toHaveCount(1);
  };
  await chosenAlone(0);
  await radios.nth(1).click();
  await chosenAlone(1);
  await radios.nth(1).focus();
  await page.keyboard.press('ArrowDown');
  await chosenAlone(2);
});

test('a closed chip list opens no list on focus, narrows by any name, refuses other text', async ({
  page,
}) => {
  await sheet(page);
  const field = page.getByTestId('states-countries');
  const input = field.locator('input');
  const options = page.getByTestId('states-countries-options').getByRole('option');
  const chips = field.locator('[data-chip] .text');
  const none = page.getByTestId('states-countries-none');
  await input.focus();
  // No list and nothing marked: Enter takes nothing.
  await expect(input).toBeFocused();
  await expect(options).toHaveCount(0);
  await expect(input).not.toHaveAttribute('aria-activedescendant', /./);
  await page.keyboard.press('Enter');
  await expect(chips).toHaveText(['Deutschland', 'Österreich']);
  // By its English name, the first match marked.
  await input.fill('swi');
  await expect(options).toHaveText(['Schweiz']);
  await expect(input).toHaveAttribute(
    'aria-activedescendant',
    (await options.first().getAttribute('id'))!,
  );
  await page.keyboard.press('Enter');
  await expect(chips).toHaveText(['Deutschland', 'Österreich', 'Schweiz']);
  await expect(input).toHaveValue('');
  // A chosen one leaves the list, and its name says nothing.
  await input.fill('swi');
  await expect(options).toHaveCount(0);
  await expect(none).toHaveCount(0);
  // Text outside the list stays in the field and says so.
  await input.fill('Atlantis');
  await expect(none).toHaveText(T.profile.field.countryNone);
  await page.keyboard.press('Enter');
  await expect(field.locator('[data-chip]')).toHaveCount(3);
  await expect(input).toHaveValue('Atlantis');
  // Esc closes the list, then drops the text.
  await input.fill('Bel');
  await expect(options).toHaveText(['Belgien']);
  await expect(none).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
  await expect(input).toHaveValue('Bel');
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
});

test('only an added chip rises; the x says Entfernen and is hit 24 px wide', async ({ page }) => {
  await sheet(page);
  const field = page.getByTestId('states-countries');
  const moving = (): Promise<string[]> =>
    field
      .locator('[data-chip]')
      .evaluateAll((chips) =>
        chips
          .filter((chip) => chip.getAnimations().length > 0)
          .map((chip) => chip.textContent?.trim() ?? ''),
      );
  // Nothing moves when the page is drawn.
  expect(await moving()).toEqual([]);
  await field.locator('input').fill('Belg');
  await page.keyboard.press('Enter');
  await expect.poll(moving).toEqual(['Belgien']);
  await expect.poll(moving).toEqual([]);
  // Removing one draws the others again: none of them rises.
  await field.getByRole('button', { name: T.chips.remove('Österreich') }).click();
  await expect(field.locator('[data-chip]')).toHaveCount(2);
  expect(await moving()).toEqual([]);
  const remove = field.locator('.remove').first();
  await remove.scrollIntoViewIfNeeded();
  const box = (await remove.boundingBox())!;
  expect(box.width).toBe(16);
  await page.mouse.move(box.x - 3, box.y + box.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText(T.common.remove);
});

test('the tooltip: 6 px round, 12 px words in 500, no edge; the info symbol hit 24 px wide', async ({
  page,
}) => {
  await sheet(page);
  const info = page.getByTestId('states-info');
  await info.scrollIntoViewIfNeeded();
  const box = (await info.boundingBox())!;
  expect(box.width).toBe(14);
  await page.mouse.move(box.x + box.width + 4, box.y + box.height / 2);
  const bubble = page.getByRole('tooltip').locator('div').first();
  await expect(bubble).toHaveText('Welche Verträge du annimmst.');
  const look = await bubble.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.borderRadius, style.fontSize, style.fontWeight, style.borderTopWidth];
  });
  expect(look).toEqual(['6px', '12px', '500', '0px']);
  // Below its anchor.
  expect((await bubble.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
});
