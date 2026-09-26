// The input policy of lib/input/input.ts: like a native app. Controls react to the left
// button only, the middle button scrolls scroll areas, text a user would copy selects and
// copies. Keys: Tab moves the focus, Space presses controls and Enter buttons; fields take
// every character of the keyboard layout (AltGr, Option) and the editing keys of the OS;
// dialogs hold the focus; everything else is swallowed.

import type { Page } from '@playwright/test';
import { calls, expect, open, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await open(page, '?platform=windows');
});

test('right click, middle click and drag: what the page lets through', async ({ page }) => {
  // A list long enough to scroll: the middle button may start the autoscroll there.
  await page.setViewportSize({ width: 1360, height: 560 });
  await page.getByTestId('facet').getByRole('radio', { name: /Alle/ }).click();
  const result = await page.evaluate(() => {
    const field = document.body.appendChild(document.createElement('input'));
    const view = document.querySelector('[data-testid="view-jobs"]')!;
    const header = document.querySelector('[data-testid="list-header"]')!;
    const row = document.querySelector('[data-testid^="job-row-"]')!;
    const scroll = document.querySelector('[data-testid="list-scroll"]')!;
    const fire = (target: Element, event: Event): boolean => {
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const init = { bubbles: true, cancelable: true };
    const out = {
      scrolls: scroll.scrollHeight > scroll.clientHeight,
      contextmenu: fire(view, new MouseEvent('contextmenu', init)),
      contextmenuInField: fire(field, new MouseEvent('contextmenu', init)),
      middleDownOutsideScrollArea: fire(
        header,
        new MouseEvent('mousedown', { ...init, button: 1 }),
      ),
      middleDownOnListRow: fire(row, new MouseEvent('mousedown', { ...init, button: 1 })),
      rightDown: fire(row, new MouseEvent('mousedown', { ...init, button: 2 })),
      leftDown: fire(view, new MouseEvent('mousedown', { ...init, button: 0 })),
      backUp: fire(view, new MouseEvent('mouseup', { ...init, button: 3 })),
      auxclick: fire(row, new MouseEvent('auxclick', { ...init, button: 1 })),
      dragstart: fire(view, new Event('dragstart', init)),
      selectstart: fire(view, new Event('selectstart', init)),
      selectstartInField: fire(field, new Event('selectstart', init)),
      dblclick: fire(view, new MouseEvent('dblclick', init)),
      // At rest no wheel listener that may cancel is attached (scrolling never waits for
      // the page); it is there only while Ctrl or Cmd is held.
      ctrlWheelAtRest: fire(view, new WheelEvent('wheel', { ...init, ctrlKey: true, deltaY: 1 })),
      holdControl: fire(
        view,
        new KeyboardEvent('keydown', { ...init, key: 'Control', ctrlKey: true }),
      ),
      ctrlWheel: fire(view, new WheelEvent('wheel', { ...init, ctrlKey: true, deltaY: 100 })),
      releaseControl: fire(view, new KeyboardEvent('keyup', { ...init, key: 'Control' })),
      ctrlWheelReleased: fire(view, new WheelEvent('wheel', { ...init, ctrlKey: true, deltaY: 1 })),
      holdCommand: fire(
        view,
        new KeyboardEvent('keydown', { ...init, key: 'Meta', metaKey: true }),
      ),
      metaWheel: fire(view, new WheelEvent('wheel', { ...init, metaKey: true, deltaY: 100 })),
      plainWheel: fire(view, new WheelEvent('wheel', { ...init, deltaY: 100 })),
      metaWheelAfterPlain: fire(
        view,
        new WheelEvent('wheel', { ...init, metaKey: true, deltaY: 1 }),
      ),
    };
    field.remove();
    return out;
  });
  expect(result).toEqual({
    scrolls: true,
    contextmenu: true,
    contextmenuInField: true,
    middleDownOutsideScrollArea: true,
    middleDownOnListRow: false,
    rightDown: true,
    leftDown: false,
    backUp: true,
    auxclick: true,
    dragstart: true,
    selectstart: true,
    selectstartInField: false,
    dblclick: true,
    ctrlWheelAtRest: false,
    holdControl: true,
    ctrlWheel: true,
    releaseControl: false,
    ctrlWheelReleased: false,
    holdCommand: true,
    metaWheel: true,
    // A wheel without the modifier means it was released unseen: the watch ends.
    plainWheel: false,
    metaWheelAfterPlain: false,
  });
});

/** The entries of the open menu as the user reads them: "Text" or "Text (aus)". */
async function menuEntries(page: Page): Promise<string[]> {
  return page
    .getByTestId('menu')
    .getByRole('menuitem')
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          `${node.querySelector('.label')?.textContent ?? ''}${
            node.getAttribute('aria-disabled') === 'true' ? ' (aus)' : ''
          }`,
      ),
    );
}

test("the right click: the app's menu in fields and on selected copyable text, nowhere else", async ({
  page,
}) => {
  const menu = page.getByTestId('menu');
  // On a control or empty space: nothing, and the control is not pressed.
  await page.getByTestId('fetch').click({ button: 'right' });
  await page.getByTestId('view-jobs').click({ button: 'right', position: { x: 600, y: 600 } });
  await expect(menu).toHaveCount(0);
  expect(await calls(page, 'start_run')).toEqual([]);
  // In a field: the edit commands of Windows in their groups, enabled by the field's state;
  // the field takes the focus back when the menu closes.
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  await search.evaluate((node: HTMLInputElement) => {
    node.blur();
    node.setSelectionRange(0, 0);
  });
  await search.click({ button: 'right' });
  await expect(menu).toBeVisible();
  expect(await menuEntries(page)).toEqual([
    'Rückgängig',
    'Ausschneiden (aus)',
    'Kopieren (aus)',
    'Einfügen',
    'Löschen (aus)',
    'Alles auswählen',
  ]);
  await expect(menu.getByRole('separator')).toHaveCount(2);
  // The keys as Windows writes them, right and quiet.
  await expect(page.getByTestId('menu-item-cut').locator('.keys')).toHaveText('Strg+X');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 7));
  await search.click({ button: 'right' });
  expect(await menuEntries(page)).toEqual([
    'Rückgängig',
    'Ausschneiden',
    'Kopieren',
    'Einfügen',
    'Löschen',
    'Alles auswählen',
  ]);
  // Löschen takes the selection out, and Ctrl+Z brings it back (one step of the field).
  await page.getByTestId('menu-item-delete').click();
  await expect(menu).toHaveCount(0);
  await expect(search).toHaveValue('ling');
  await expect(search).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(search).toHaveValue('Controlling');
  // Einfügen types the clipboard's text where the caret is.
  await page.evaluate(() => (window.__harness.clipboard = 'Interim '));
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 0));
  await search.click({ button: 'right' });
  await page.getByTestId('menu-item-paste').click();
  await expect(search).toHaveValue('Interim Controlling');
  // Selected copyable text: Kopieren; the same text unselected: nothing (the list back in full
  // first: the search above filtered it).
  await search.fill('');
  await expect(page.locator('[data-testid^="job-row-"]').first()).toBeVisible();
  await page.locator('[data-testid^="job-row-"]').first().click();
  const title = page.getByTestId('reader-title');
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await title.click({ button: 'right' });
  await expect(menu).toHaveCount(0);
  await title.evaluate((node) => getSelection()?.selectAllChildren(node));
  await title.click({ button: 'right' });
  expect(await menuEntries(page)).toEqual(['Kopieren']);
});

test("the app's menu from the keyboard: Shift+F10, arrows, Enter, Esc, a letter", async ({
  page,
}) => {
  const menu = page.getByTestId('menu');
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 7));
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  // The first enabled entry is active at once, like the OS; the arrows skip what is off.
  const active = (): Promise<string | null> =>
    menu.evaluate((node) => {
      const id = node.getAttribute('aria-activedescendant');
      return id === null ? null : (document.getElementById(id)?.dataset.testid ?? null);
    });
  expect(await active()).toBe('menu-item-undo');
  await page.keyboard.press('ArrowDown');
  expect(await active()).toBe('menu-item-cut');
  await page.keyboard.press('End');
  expect(await active()).toBe('menu-item-select-all');
  await page.keyboard.press('ArrowDown');
  expect(await active()).toBe('menu-item-undo');
  // A letter picks the entry that starts with it.
  await page.keyboard.press('k');
  expect(await active()).toBe('menu-item-copy');
  // Esc closes the menu only; the field keeps its text and its focus.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Controlling');
  // Enter runs the active entry.
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  expect(
    await search.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([0, 11]);
});

test('a press outside closes the menu and does nothing else; so do a scroll and the window', async ({
  page,
}) => {
  const menu = page.getByTestId('menu');
  const search = page.getByTestId('search');
  await search.fill('CFO');
  await search.click({ button: 'right' });
  await expect(menu).toBeVisible();
  // The left press that closes it never reaches Abrufen under it.
  await page.getByTestId('fetch').click();
  await expect(menu).toHaveCount(0);
  expect(await calls(page, 'start_run')).toEqual([]);
  // A right press elsewhere closes it and opens the menu of what it lands on.
  await search.click({ button: 'right' });
  await page.getByTestId('view-jobs').click({ button: 'right', position: { x: 600, y: 600 } });
  await expect(menu).toHaveCount(0);
  // Resizing the window closes it.
  await search.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1300, height: 800 });
  await expect(menu).toHaveCount(0);
});

test('the menu stays inside the window: it flips at the right and the bottom edge', async ({
  page,
}) => {
  const menu = page.getByTestId('menu');
  const search = page.getByTestId('search');
  await search.fill('CFO');
  const size = page.viewportSize()!;
  // Opened near the bottom right corner (Shift+F10 in a field opens below it; a right click
  // opens at the pointer): the menu lies left of and above the pointer.
  await search.evaluate((node) => {
    const at = { clientX: innerWidth - 20, clientY: innerHeight - 20 };
    node.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at }),
    );
  });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(size.width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height - 8);
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
});

test("a field's menu on macOS: no undo and no delete, like the OS's own, keys as symbols", async ({
  page,
}) => {
  await open(page, '?platform=macos');
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 7));
  await search.click({ button: 'right' });
  expect(await menuEntries(page)).toEqual([
    'Ausschneiden',
    'Kopieren',
    'Einfügen',
    'Alles auswählen',
  ]);
  await expect(page.getByTestId('menu-item-copy').locator('.keys')).toHaveText('⌘C');
});

test('controls react to the left button only', async ({ page }) => {
  const focused = (): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  // Real middle and right clicks on a nav entry, a list row and a switch: nothing is pressed,
  // opened or focused.
  await page.getByTestId('nav-profile').click({ button: 'right' });
  await page.getByTestId('nav-settings').click({ button: 'middle' });
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  expect(await focused()).toBeNull();
  const row = page.locator('[data-testid^="job-row-"]').first();
  await row.click({ button: 'middle' });
  // A right click on a row opens its menu (the app's own) and opens nothing else.
  await row.click({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader')).toHaveCount(0);
  expect(await focused()).toBeNull();
  await page.getByTestId('nav-settings').click();
  const toggle = page.getByTestId('toggle-auto-archive');
  await toggle.click({ button: 'right' });
  await toggle.click({ button: 'middle' });
  await page.waitForTimeout(300);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await focused()).not.toBe('toggle-auto-archive');
  const calls = await page.evaluate(() => window.__harness.calls.map(([name]) => name));
  expect(calls).not.toContain('save_settings');
  // Over a scroll area the middle click started the autoscroll of the engine (Windows
  // behaviour): the next click only ends it. Then the left button works.
  await page.getByTestId('settings-mailbox').getByRole('heading').click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

/** The parts of a KeyboardEventInit the tests use (serialisable into the page). */
interface Key {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  modifierAltGraph?: boolean;
}

/**
 * Dispatch keydowns (each `[label, init]`) on a fresh field, the jobs view or the Abrufen
 * button and report which ones the page cancelled.
 */
async function prevented(
  page: Page,
  where: 'field' | 'view' | 'button',
  keys: [string, Key][],
): Promise<Record<string, boolean>> {
  return page.evaluate(
    ({ where, keys }) => {
      getSelection()?.removeAllRanges();
      const field = document.body.appendChild(document.createElement('input'));
      const target =
        where === 'field'
          ? field
          : where === 'button'
            ? document.querySelector('[data-testid="fetch"]')!
            : document.querySelector('[data-testid="view-jobs"]')!;
      const out: Record<string, boolean> = {};
      for (const [label, init] of keys) {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        out[label] = event.defaultPrevented;
      }
      field.remove();
      return out;
    },
    { where, keys },
  );
}

const plain = (key: string): [string, Key] => [key, { key }];

test('keys outside fields: Tab moves, Enter and Space press, everything else is swallowed', async ({
  page,
}) => {
  const outside = await prevented(page, 'view', [
    // F5 and Ctrl+R fetch (the app's own), so they stay out of this list of swallowed keys.
    ...['Enter', 'Escape', 'F3', 'q', 'ArrowDown', ' '].map(plain),
    ['Ctrl+P', { key: 'p', ctrlKey: true }],
    ['Ctrl+C without selection', { key: 'c', ctrlKey: true }],
    ['Alt+ArrowLeft', { key: 'ArrowLeft', altKey: true }],
    ['Ctrl+Tab', { key: 'Tab', ctrlKey: true }],
  ]);
  expect(Object.entries(outside).filter(([, cancelled]) => !cancelled)).toEqual([]);
  const moves = await prevented(page, 'view', [
    ['Tab', { key: 'Tab' }],
    ['Shift+Tab', { key: 'Tab', shiftKey: true }],
    ['Alt+F4', { key: 'F4', altKey: true }],
  ]);
  expect(moves).toEqual({ Tab: false, 'Shift+Tab': false, 'Alt+F4': false });
  // On a focused button Enter and Space press it (the engine clicks), like a native one.
  const onButton = await prevented(page, 'button', [
    ['Enter', { key: 'Enter' }],
    ['Space', { key: ' ' }],
    ['Tab', { key: 'Tab' }],
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }],
    ['r', { key: 'r' }],
  ]);
  expect(onButton).toEqual({ Enter: false, Space: false, Tab: false, 'Ctrl+Enter': true, r: true });
});

test('Tab from a field goes on through the controls, Enter and Space press them', async ({
  page,
}) => {
  const focused = (): Promise<string | null> =>
    page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  await page.getByTestId('search').focus();
  await page.keyboard.press('Tab');
  const first = await focused();
  expect(first).not.toBe('search');
  await page.keyboard.press('Tab');
  expect(await focused()).not.toBe(first);
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toBe(first);
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toBe('search');
  // Enter presses a focused nav entry, Space a focused switch (Enter does not toggle it).
  await page.getByTestId('nav-settings').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('view-settings')).toBeVisible();
  const toggle = page.getByTestId('toggle-auto-archive');
  const before = await toggle.getAttribute('aria-checked');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toHaveAttribute('aria-checked', before!);
});

test('fields keep typing, the clipboard keys and the editing keys; shortcuts stay out', async ({
  page,
}) => {
  const allowed = await prevented(page, 'field', [
    ...['a', 'Z', '@', 'Backspace', 'Delete', 'ArrowLeft', 'Home', 'End', 'Tab', 'Enter'].map(
      plain,
    ),
    ['Escape', { key: 'Escape' }],
    ['Shift+Home', { key: 'Home', shiftKey: true }],
    ...['c', 'v', 'x', 'a', 'z'].map((k): [string, Key] => [
      `Ctrl+${k}`,
      { key: k, ctrlKey: true },
    ]),
    ['Ctrl+Shift+Z', { key: 'Z', ctrlKey: true, shiftKey: true }],
  ]);
  expect(Object.entries(allowed).filter(([, cancelled]) => cancelled)).toEqual([]);
  const blocked = await prevented(page, 'field', [
    ['F5', { key: 'F5' }],
    ['F12', { key: 'F12' }],
    ['Ctrl+P', { key: 'p', ctrlKey: true }],
    ['Ctrl+F', { key: 'f', ctrlKey: true }],
    ['Ctrl++', { key: '+', ctrlKey: true }],
    ['Ctrl+Shift+I', { key: 'I', ctrlKey: true, shiftKey: true }],
  ]);
  expect(Object.entries(blocked).filter(([, cancelled]) => !cancelled)).toEqual([]);
});

/** Characters of the Option (macOS) and AltGr (Windows) layer of German and other layouts. */
const LAYER = ['@', '€', '{', '}', '[', ']', '|', '~', '\\', 'µ', '²', 'ą'];

test('Windows: AltGr (and Ctrl+Alt) characters type; Alt alone and Alt+Arrow do not', async ({
  page,
}) => {
  const typed = await prevented(page, 'field', [
    ...LAYER.map((key): [string, Key] => [
      `AltGr ${key}`,
      { key, ctrlKey: true, altKey: true, modifierAltGraph: true },
    ]),
    // Left Ctrl+Alt works as AltGr on Windows but does not report the AltGraph modifier.
    ...LAYER.map((key): [string, Key] => [`Ctrl+Alt ${key}`, { key, ctrlKey: true, altKey: true }]),
  ]);
  expect(Object.entries(typed).filter(([, cancelled]) => cancelled)).toEqual([]);
  const editing = await prevented(page, 'field', [
    ['Ctrl+ArrowLeft', { key: 'ArrowLeft', ctrlKey: true }],
    ['Ctrl+Shift+ArrowRight', { key: 'ArrowRight', ctrlKey: true, shiftKey: true }],
    ['Ctrl+Backspace', { key: 'Backspace', ctrlKey: true }],
    ['Ctrl+Delete', { key: 'Delete', ctrlKey: true }],
    ['Ctrl+Home', { key: 'Home', ctrlKey: true }],
    ['Ctrl+Shift+End', { key: 'End', ctrlKey: true, shiftKey: true }],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }],
  ]);
  expect(Object.entries(editing).filter(([, cancelled]) => cancelled)).toEqual([]);
  const blocked = await prevented(page, 'field', [
    ['Alt+d', { key: 'd', altKey: true }],
    ['Alt+ArrowLeft', { key: 'ArrowLeft', altKey: true }],
    ['Alt+ArrowRight', { key: 'ArrowRight', altKey: true }],
    ['Ctrl+Alt+d', { key: 'd', ctrlKey: true, altKey: true }],
    ['Cmd+ArrowLeft', { key: 'ArrowLeft', metaKey: true }],
    ['Ctrl+E', { key: 'e', ctrlKey: true }],
  ]);
  expect(Object.entries(blocked).filter(([, cancelled]) => !cancelled)).toEqual([]);
});

test('macOS: Option characters, dead keys and word moves type; Cmd editing keys work', async ({
  page,
}) => {
  await open(page, '?platform=macos');
  const typed = await prevented(page, 'field', [
    ...LAYER.map((key): [string, Key] => [`Option ${key}`, { key, altKey: true }]),
    ['Option+Shift 7 (backslash)', { key: '\\', altKey: true, shiftKey: true }],
    ['Option dead key', { key: 'Dead', altKey: true }],
    ['Option+ArrowLeft', { key: 'ArrowLeft', altKey: true }],
    ['Option+Shift+ArrowRight', { key: 'ArrowRight', altKey: true, shiftKey: true }],
    ['Option+Backspace', { key: 'Backspace', altKey: true }],
    ['Cmd+ArrowLeft', { key: 'ArrowLeft', metaKey: true }],
    ['Cmd+Shift+ArrowRight', { key: 'ArrowRight', metaKey: true, shiftKey: true }],
    ['Cmd+Backspace', { key: 'Backspace', metaKey: true }],
    ['Cmd+ArrowUp', { key: 'ArrowUp', metaKey: true }],
    ['Cmd+Shift+Z', { key: 'z', metaKey: true, shiftKey: true }],
    ...['c', 'v', 'x', 'a', 'z'].map((k): [string, Key] => [`Cmd+${k}`, { key: k, metaKey: true }]),
    ...['a', 'e', 'k'].map((k): [string, Key] => [`Ctrl+${k}`, { key: k, ctrlKey: true }]),
  ]);
  expect(Object.entries(typed).filter(([, cancelled]) => cancelled)).toEqual([]);
  const blocked = await prevented(page, 'field', [
    ['Cmd+P', { key: 'p', metaKey: true }],
    ['Cmd+F', { key: 'f', metaKey: true }],
    ['Cmd+R', { key: 'r', metaKey: true }],
    ['Cmd++', { key: '+', metaKey: true }],
    ['Cmd+Y', { key: 'y', metaKey: true }],
    ['Cmd+Option+I', { key: 'ˆ', code: 'KeyI', metaKey: true, altKey: true }],
    ['Ctrl+ArrowLeft', { key: 'ArrowLeft', ctrlKey: true }],
    ['F5', { key: 'F5' }],
  ]);
  expect(Object.entries(blocked).filter(([, cancelled]) => !cancelled)).toEqual([]);
});

test('macOS: the menu shortcuts reach the menu, in a field and outside (Cmd+, too)', async ({
  page,
}) => {
  await open(page, '?platform=macos');
  const menu: [string, Key][] = [
    ['Cmd+,', { key: ',', metaKey: true }],
    ['Cmd+Q', { key: 'q', metaKey: true }],
    ['Cmd+W', { key: 'w', metaKey: true }],
    ['Cmd+M', { key: 'm', metaKey: true }],
    ['Cmd+H', { key: 'h', metaKey: true }],
    ['Cmd+Option+H', { key: '˙', code: 'KeyH', metaKey: true, altKey: true }],
  ];
  for (const where of ['view', 'field'] as const) {
    const result = await prevented(page, where, menu);
    expect(
      Object.entries(result).filter(([, cancelled]) => cancelled),
      where,
    ).toEqual([]);
  }
});

test('the list search clears on Esc; a click on its magnifier lands in the field', async ({
  page,
}) => {
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  // An empty search passes Esc on (nothing happens, no error).
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await search.evaluate((node) => node.blur());
  const box = (await search.boundingBox())!;
  // The magnifier sits in the first 36 px of the box.
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await expect(search).toBeFocused();
});

test('the password eye and the search clear keep the caret in the field', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const section = page.getByTestId('gallery-inputs');
  const password = page.locator('#gallery-password');
  await password.click();
  await page.keyboard.press('End');
  const eye = section.getByRole('button', { name: 'Passwort zeigen' });
  await expect(eye).toHaveAttribute('tabindex', '-1');
  await eye.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toBeFocused();
  await page.keyboard.type('x');
  await expect(password).toHaveValue('abcd efghx');
  // Tab skips the eye: from the password field it leaves the field.
  await page.keyboard.press('Tab');
  await expect(section.getByRole('button', { name: 'Passwort verbergen' })).not.toBeFocused();
  const search = section.getByRole('textbox', { name: 'Jobs durchsuchen' }).first();
  await search.click();
  const clear = section.getByRole('button', { name: 'Suche leeren' });
  await expect(clear).toHaveAttribute('tabindex', '-1');
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
});

test('a dialog holds the focus: Tab cycles, a click on its text keeps Esc working', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  // Opened from the keyboard: Enter presses the focused button.
  const opener = page.getByTestId('open-danger');
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByTestId('dialog-danger');
  await expect(dialog).toBeVisible();
  const inside = (): Promise<boolean> =>
    dialog.evaluate((node) => node.contains(document.activeElement));
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await inside(), key).toBe(true);
  }
  // A click on the text keeps the focus in the dialog; Esc still closes it and the focus
  // goes back to the button that opened it.
  await dialog.getByRole('heading').click();
  expect(await inside()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  // Focus that slipped behind the dialog: Esc still answers the dialog.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a dialog starts on its default button, ringed only once the keyboard moves', async ({
  page,
}) => {
  await open(page, '?gallery&platform=windows');
  // Opened with the mouse: the focus is on the default button, without a ring.
  await page.getByTestId('open-danger').click();
  const dialog = page.getByTestId('dialog-danger');
  const cancel = dialog.getByTestId('dialog-cancel');
  const confirm = dialog.getByTestId('dialog-confirm');
  await expect(cancel).toBeFocused();
  const ring = (button: typeof cancel): Promise<string> =>
    button.evaluate((node) => getComputedStyle(node).boxShadow);
  const atOpen = await ring(cancel);
  // Tab moves the focus and shows the ring there; the default stays unmarked.
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  const focusRing = await ring(confirm);
  expect(atOpen).not.toBe(focusRing);
  expect(await ring(cancel)).toBe(atOpen);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a dialog shows the failure of its action inside and stays open', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  await page.getByTestId('open-danger').click();
  const dialog = page.getByTestId('dialog-danger');
  await dialog.getByTestId('dialog-confirm').focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByTestId('dialog-error')).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a switch flips at once and slides back when its save fails', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const toggle = page.getByTestId('toggle-fails');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  // At once, before the save answers (it takes 400 ms, then fails).
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 100 });
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 2000 });
});

test('the ad text, title and facts select and copy; the rest does not select', async ({
  page,
  browserName,
}) => {
  await page.locator('[data-testid^="job-row-"]').first().click();
  const text = page.getByTestId('ad-text');
  await expect(text).toBeVisible();
  // A drag across the ad text selects it, like in a document (in view, below the reader's
  // compact bar).
  await text.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, box.y + 40, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection()?.toString() ?? '');
  expect(selected.length).toBeGreaterThan(10);
  // Ctrl/Cmd+C goes through to the web view while there is a selection.
  const copyLetThrough = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('[data-testid="ad-text"]')!.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  expect(copyLetThrough).toBe(true);
  if (browserName === 'chromium') {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.keyboard.press('Control+c');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.trim()).toBe(selected.trim());
  }
  // Title and facts select too; controls and labels do not (a drag over them selects
  // nothing).
  const drag = async (id: string): Promise<string> => {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const target = (await page.getByTestId(id).boundingBox())!;
    await page.mouse.move(target.x + 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 2, target.y + target.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    return page.evaluate(() => getSelection()?.toString() ?? '');
  };
  await page.getByTestId('stage').evaluate((node) => node.scrollTo({ top: 0 }));
  expect((await drag('reader-title')).length).toBeGreaterThan(5);
  for (const id of ['band', 'must', 'reasons-met']) {
    expect(await drag(id), id).toBe('');
  }
});

test('native cursor: the arrow on controls, the text cursor on copyable text', async ({ page }) => {
  await expect(page.getByTestId('fetch')).toHaveCSS('cursor', 'default');
  await expect(page.getByTestId('nav-profile')).toHaveCSS('cursor', 'default');
  await page.locator('[data-testid^="job-row-"]').first().click();
  await expect(page.getByTestId('ad-text')).toHaveCSS('cursor', 'text');
});
