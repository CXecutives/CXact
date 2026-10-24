// The core controls on their states sheet (`?sheet=controls`, tools/ui-harness/sheets/): one
// height per kind, one width while a button swaps (`sizeTo`) and for a pair (`--btn-min`), the
// select's keys with the focus kept on its button, a closed chip list that opens on focus,
// and a chip that rises in only when it is added.

import type { Locator, Page } from '@playwright/test';
import { expect, open, test } from './fixtures';
import { T, WIN } from './helpers';

const STATES = `${WIN}&sheet=controls`;

async function sheet(page: Page): Promise<Locator> {
  await open(page, STATES);
  const states = page.getByTestId('states-controls');
  await expect(states).toBeVisible();
  return states;
}

const width = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.width;
const height = async (locator: Locator): Promise<number> => (await locator.boundingBox())!.height;

test('one height per kind: 30, the quiet glyph 28, a suggestion 26, a select inline 26', async ({
  page,
}) => {
  const states = await sheet(page);
  await expect
    .poll(() => height(states.getByRole('button', { name: 'Jobs suchen' }).first()))
    .toBe(30);
  await expect
    .poll(() => height(states.getByRole('button', { name: 'Kopieren' }).first()))
    .toBe(30);
  const quiet = states.locator('.btn.ghost.icon-only').first();
  expect(await height(quiet)).toBe(28);
  expect(await width(quiet)).toBe(28);
  expect(await height(states.locator('.btn.suggest').first())).toBe(26);
  expect(await height(page.getByTestId('states-select'))).toBe(30);
  expect(await height(page.getByTestId('states-level'))).toBe(26);
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
  await expect(search).toHaveAccessibleName('Jobs suchen');
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
}) => {
  await sheet(page);
  const select = page.getByTestId('states-select');
  await expect(select).toHaveText('Gmail');
  await select.focus();
  await page.keyboard.press('ArrowDown');
  const list = page.getByRole('listbox', { name: 'Anbieter' });
  await expect(list).toBeVisible();
  await expect(select).toBeFocused();
  await expect(select).toHaveAttribute('aria-expanded', 'true');
  // The chosen option is active and marked as chosen (the track, navy words, no tick).
  const chosen = list.getByRole('option', { name: 'Gmail' });
  await expect(chosen).toHaveAttribute('aria-selected', 'true');
  await expect(select).toHaveAttribute('aria-activedescendant', (await chosen.getAttribute('id'))!);
  await expect(chosen.locator('.icon')).toHaveCount(0);
  // At least as wide as its button.
  expect(await width(list)).toBeGreaterThanOrEqual(await width(select));
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
  await expect(select).toBeFocused();
  // A click on the button of the open list closes it.
  await select.click();
  await expect(list).toBeVisible();
  await select.click();
  await expect(list).toHaveCount(0);
});

test('a closed chip list opens on focus, narrows by any name, refuses other text', async ({
  page,
}) => {
  await sheet(page);
  const field = page.getByTestId('states-countries');
  const input = field.locator('input');
  const options = page.getByTestId('states-countries-options').getByRole('option');
  await input.focus();
  // Every country not chosen yet, nothing marked: Enter takes nothing.
  await expect(options).toHaveText(['Schweiz', 'Niederlande', 'Belgien', 'Luxemburg']);
  await expect(input).not.toHaveAttribute('aria-activedescendant', /./);
  // By its English name, the first match marked.
  await input.fill('swi');
  await expect(options).toHaveText(['Schweiz']);
  await page.keyboard.press('Enter');
  await expect(field.locator('[data-chip] .text')).toHaveText([
    'Deutschland',
    'Österreich',
    'Schweiz',
  ]);
  await expect(options).not.toContainText(['Schweiz']);
  // Text outside the list stays in the field and says so.
  await input.fill('Atlantis');
  await expect(page.getByTestId('states-countries-none')).toHaveText('Kein Land mit diesem Namen.');
  await page.keyboard.press('Enter');
  await expect(field.locator('[data-chip]')).toHaveCount(3);
  await expect(input).toHaveValue('Atlantis');
  // Esc closes the list, then drops the text.
  await input.fill('');
  await expect(options.first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
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
  await field.getByRole('button', { name: 'Österreich entfernen' }).click();
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
