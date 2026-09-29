// The input policy of lib/input/input.ts, in one place: like a native app. Controls react to
// the left button only, the middle button scrolls scroll areas (and its autoscroll's end
// presses nothing), the wheel scrolls what lies under the pointer, text a user would copy
// selects and copies. Keys: Tab moves the focus, Space presses controls and Enter buttons;
// fields take every character of the keyboard layout (AltGr, Option) and the editing keys of
// the OS; dialogs hold the focus; the app has no shortcuts of its own, and a menu names no
// keys; everything else is swallowed.

import type { Locator, Page } from '@playwright/test';
import { NOW, calls, expect, open, settle, test } from './fixtures';
import { tokenColour } from './helpers';

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

/** Characters of the Option (macOS) and AltGr (Windows) layer of German and other layouts. */
const LAYER = ['@', '€', '{', '}', '[', ']', '|', '~', '\\', 'µ', '²', 'ą'];

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

/**
 * Turns the wheel over the middle of an element, brought into view first (a filled field is
 * not always scrolled to: WebKit left it below the window, and the wheel went nowhere), and
 * resolves with how far the view `pane` scrolled, once it did: a busy machine handles the
 * wheel later than any fixed wait.
 */
async function wheelOver(page: Page, target: Locator, pane: string, dy = 240): Promise<number> {
  await target.scrollIntoViewIfNeeded();
  const before = await scrollTop(page, pane);
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, dy);
  await expect.poll(() => scrollTop(page, pane)).not.toBe(before);
  return (await scrollTop(page, pane)) - before;
}

const GALLERY = '?gallery&platform=windows';

/** What a pressed look changes: the colours and the scale of the control and its track. */
async function look(target: Locator): Promise<string> {
  return target.evaluate((node) => {
    const parts = [node, ...node.querySelectorAll('.track, .pill')];
    return parts
      .map((part) => {
        const style = getComputedStyle(part);
        return `${style.backgroundColor} ${style.color} ${style.transform}`;
      })
      .join(' | ');
  });
}

/** The look under the pointer at rest, and while the given button is held on it. */
async function heldLook(
  page: Page,
  target: Locator,
  button: 'right' | 'middle',
): Promise<{ hover: string; held: string; after: string }> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  const hover = await look(target);
  await page.mouse.down({ button });
  await page.waitForTimeout(200);
  const held = await look(target);
  await page.mouse.up({ button });
  await page.waitForTimeout(200);
  const after = await look(target);
  // Away, so the next control starts at rest (and a started autoscroll ends).
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
  return { hover, held, after };
}

/* -------------------------------------------------------- Buttons, fields, copy and keys */

// The input policy of lib/input/input.ts: like a native app. Controls react to the left
// button only, the middle button scrolls scroll areas, text a user would copy selects and
// copies. Keys: Tab moves the focus, Space presses controls and Enter buttons; fields take
// every character of the keyboard layout (AltGr, Option) and the editing keys of the OS;
// dialogs hold the focus; everything else is swallowed.

test.beforeEach(async ({ page }) => {
  await open(page, '?platform=windows');
});

test('right click, middle click and drag: what the page lets through', async ({ page }) => {
  // A list long enough to scroll: the middle button may start the autoscroll there.
  await page.setViewportSize({ width: 1360, height: 560 });
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
  // No entry names a key.
  await expect(menu.locator('.keys')).toHaveCount(0);
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

test('a press outside closes the menu and does nothing else; so do the wheel and the window', async ({
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
  // A scroll the app makes itself (the list keeping the open row in view) leaves it open; the
  // user's wheel outside it closes it.
  await search.fill('');
  await page.setViewportSize({ width: 1300, height: 480 });
  await search.click({ button: 'right' });
  await expect(menu).toBeVisible();
  const scroller = page.getByTestId('list-scroll');
  await scroller.evaluate((node) => node.scrollBy(0, 200));
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  await expect(menu).toBeVisible();
  // Beside the menu (it hangs from the search over the top of the list).
  const box = (await scroller.boundingBox())!;
  const open = (await menu.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, Math.max(open.y + open.height, box.y) + 24);
  await page.mouse.wheel(0, 200);
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

test("a field's menu on macOS: no undo and no delete, like the OS's own, no keys", async ({
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
  await expect(page.getByTestId('menu').locator('.keys')).toHaveCount(0);
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
  const toggle = page.getByTestId('toggle-enabled-freelance');
  await toggle.click({ button: 'right' });
  await toggle.click({ button: 'middle' });
  await page.waitForTimeout(300);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await focused()).not.toBe('toggle-enabled-freelance');
  const calls = await page.evaluate(() => window.__harness.calls.map(([name]) => name));
  expect(calls).not.toContain('save_settings');
  // Over a scroll area the middle click started the autoscroll of the engine (Windows
  // behaviour): the next click only ends it. Then the left button works.
  await page.getByTestId('settings-mailbox').getByRole('heading').click();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('keys outside fields: Tab moves, Enter and Space press, everything else is swallowed', async ({
  page,
}) => {
  const outside = await prevented(page, 'view', [
    // The app has no keys of its own: the former ones are swallowed like the web view's.
    ...['Enter', 'Escape', 'F3', 'F5', 'q', 'e', 'Delete', 'ArrowDown', ' '].map(plain),
    ['Ctrl+R', { key: 'r', ctrlKey: true }],
    ['Ctrl+F', { key: 'f', ctrlKey: true }],
    ['Ctrl+Z', { key: 'z', ctrlKey: true }],
    ['Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true }],
    ['Ctrl+/', { key: '/', ctrlKey: true }],
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
  const toggle = page.getByTestId('toggle-enabled-freelance');
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
  // A job with its full ad (by match the first row is one still without a score or ad).
  await page.getByTestId('job-row-freelancermap-2801').click();
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
  for (const id of ['band', 'reasons-met']) {
    expect(await drag(id), id).toBe('');
  }
});

test('native cursor: the arrow on controls, the text cursor on copyable text', async ({ page }) => {
  await expect(page.getByTestId('fetch')).toHaveCSS('cursor', 'default');
  await expect(page.getByTestId('nav-profile')).toHaveCSS('cursor', 'default');
  await page.getByTestId('job-row-freelancermap-2801').click();
  await expect(page.getByTestId('ad-text')).toHaveCSS('cursor', 'text');
});

/* ----------------------------- The wheel, the mouse buttons, the way back, key scrolling */

// Final round, shell track (input): the wheel and the mouse buttons do only what they should.
// The wheel never changes a value and scrolls what lies under the pointer; over an open menu
// only the menu scrolls, behind a modal dialog nothing does. A right click without a menu, a
// middle click on a button, a link-like button or a row do nothing; the back button and the
// back key go back only where a view has a way back; single list keys type in the search;
// key scrolling glides in one short tween (a jump under reduced motion).

test('the wheel over a switch changes nothing and scrolls the page', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  const toggle = page.getByTestId('toggle-enabled-freelance');
  const before = await toggle.getAttribute('aria-checked');
  expect(await wheelOver(page, toggle, 'view-settings')).toBeGreaterThan(0);
  await expect(toggle).toHaveAttribute('aria-checked', before ?? 'false');
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
  expect(
    await wheelOver(page, page.getByTestId('profile-min-rate').first(), 'view-profile'),
  ).toBeGreaterThan(0);
  await expect(rate).toHaveValue('950');
  // A choice (a radio group): the chosen option stays chosen.
  const group = page.locator('[data-testid="view-profile"] [role="radiogroup"]').first();
  const chosen = await group.locator('[aria-checked="true"]').allTextContents();
  expect(await wheelOver(page, group, 'view-profile', 120)).toBeGreaterThan(0);
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
  await page.getByTestId('reset').click();
  const dialog = page.getByTestId('dialog-reset');
  await expect(dialog).toBeVisible();
  await settle(page);
  const before = await scrollTop(page, 'view-settings');
  // Over the scrim, away from the card.
  await page.mouse.move(300, 60);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  expect(await scrollTop(page, 'view-settings')).toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
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
  // The middle press in the list, which scrolls, started the OS autoscroll: a click on the
  // empty reader ends it (and presses nothing).
  await page.getByTestId('reader-pane').click({ position: { x: 20, y: 5 } });
  // The ad's link (it opens the page outside the app on a left click only).
  await rows(page).first().click();
  const openAd = page.getByTestId('open-ad');
  await openAd.scrollIntoViewIfNeeded();
  await openAd.click({ button: 'middle' });
  await page.waitForTimeout(200);
  expect(await calls(page, 'open_target')).toHaveLength(0);
  expect(context.pages()).toHaveLength(pages);
});

test('the back button goes back like Zurück; forward and Alt+Left/Right do nothing', async ({
  page,
}) => {
  await open(page, WIN);
  const url = page.url();
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  const press = (button: number): Promise<void> =>
    page.evaluate((button) => {
      const init = { bubbles: true, cancelable: true, button };
      document.body.dispatchEvent(new MouseEvent('mousedown', init));
      document.body.dispatchEvent(new MouseEvent('mouseup', init));
    }, button);
  // The mouse's forward button (4) and Alt+Left/Right are no keys of the app.
  await press(4);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(200);
  expect(page.url()).toBe(url);
  await expect(page.getByTestId('reader')).toBeVisible();
  // Its back button (3) goes back a step: before the job none was open. The web view stays.
  await press(3);
  await expect(page.getByTestId('reader')).toHaveCount(0);
  expect(page.url()).toBe(url);
});

test('the back button closes the reader where it stands alone in one column', async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 560 });
  await open(page, WIN);
  await rows(page).first().click();
  const close = page.getByTestId('reader');
  await expect(close).toBeVisible();
  // Alt+Left is no key of the app: only the mouse's back button goes back.
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(200);
  await expect(close).toBeVisible();
  await page.evaluate(() => {
    const init = { bubbles: true, cancelable: true, button: 3 };
    document.body.dispatchEvent(new MouseEvent('mousedown', init));
    document.body.dispatchEvent(new MouseEvent('mouseup', init));
  });
  await expect(close).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
});

test('after a click a lone Shift, Ctrl or Alt shows no focus ring; Tab does', async ({ page }) => {
  await open(page, WIN);
  const row = page.locator('[data-testid^="job-row-"]').first();
  await row.click();
  const ring = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).boxShadow);
  for (const key of ['Shift', 'Control', 'Alt']) {
    await page.keyboard.press(key);
    expect(await ring(), key).not.toContain('inset');
  }
  // A key that moves the focus: the ring is the keyboard's again.
  await page.keyboard.press('Tab');
  await expect.poll(ring).not.toBe('none');
});

test('letters type inside the search field and act on no job', async ({ page }) => {
  await open(page, WIN);
  await rows(page).first().click();
  const search = page.getByTestId('search');
  await search.click();
  await page.keyboard.type('esub o');
  await expect(search).toHaveValue('esub o');
  for (const command of ['move_jobs', 'set_override', 'open_target']) {
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
  // Reduced motion: at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, `${WIN}&view=settings`);
  // A click on plain text: the focus is nowhere, the keys scroll the pane clicked last.
  await page.locator('[data-testid="view-settings"] h2').first().click();
  await page.keyboard.press('PageDown');
  expect(await scrollTop(page, 'view-settings')).toBeGreaterThan(300);
  // Otherwise one tween, seen on the page's own clock: it stands still from the key on and
  // goes a frame (16 ms) at a time. A busy machine drew no frame within the 180 ms, and a read
  // after the key came when the glide was over.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, `${WIN}&view=settings`);
  await page.locator('[data-testid="view-settings"] h2').first().click();
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(new Date(NOW.getTime() + 1000));
  const tops = [await scrollTop(page, 'view-settings')];
  await page.keyboard.press('PageDown');
  tops.push(await scrollTop(page, 'view-settings'));
  for (let frame = 1; frame <= 16; frame += 1) {
    await page.clock.runFor(16);
    tops.push(await scrollTop(page, 'view-settings'));
  }
  const end = tops.at(-1)!;
  expect(end).toBeGreaterThan(300);
  // Still until the next frame, then further in every frame of --dur-slow (frames 1 to 8 lie
  // well within its 180 ms, wherever the first frame falls), and at the end once it is over
  // (frame 13 on).
  expect(tops.slice(0, 2), String(tops)).toEqual([0, 0]);
  const way = tops.slice(2, 10);
  expect(
    way.every((top, at) => top > tops[at + 1]! && top < end),
    String(tops),
  ).toBe(true);
  expect(tops.slice(14), String(tops)).toEqual(tops.slice(14).map(() => end));
});

/* -------------------------------- Presses, radio groups, window menus, the focus in view */

// Final round, team T1 (input): only the left button presses, a click beside a field ends its
// focus, Enter presses buttons only, the arrows choose in a radio group, the middle button
// stays out of dialogs and fields, the keys of the Windows window menus reach the OS, and
// keyboard focus stays clear of the scroll edges.

test('the right and the middle button never press a control', async ({ page }) => {
  // Eight held presses, each waiting for the transitions to settle.
  test.setTimeout(60_000);
  await open(page, WIN);
  const targets = [
    page.getByTestId('fetch'),
    page.locator('[data-testid^="job-row-"]').first(),
    page.getByTestId('nav-settings'),
    page.getByTestId('place-archive'),
  ];
  for (const [at, target] of targets.entries()) {
    // A row answers the right button with its menu (checked in menu specs), not a press.
    for (const button of at === 1 ? (['middle'] as const) : (['right', 'middle'] as const)) {
      const { hover, held, after } = await heldLook(page, target, button);
      expect(held, `${button} held on ${String(target)}`).toBe(hover);
      expect(after).toBe(hover);
    }
    // A middle press in the list, which scrolls, starts the OS autoscroll: a click on the
    // empty reader ends it (and presses nothing).
    if (at === 1) await page.getByTestId('reader-pane').click({ position: { x: 20, y: 5 } });
  }
  expect(await calls(page, 'start_run')).toHaveLength(0);
  await expect(page.getByTestId('reader')).toHaveCount(0);
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  // The left button still presses.
  const fetch = page.getByTestId('fetch');
  const box = (await fetch.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  const hover = await look(fetch);
  await page.mouse.down();
  await page.waitForTimeout(200);
  expect(await look(fetch)).not.toBe(hover);
  await page.mouse.move(4, 4, { steps: 4 });
  await page.mouse.up();
  expect(await calls(page, 'start_run')).toHaveLength(0);
});

test('a switch held with the right button looks at rest and keeps its state', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  const toggle = page.getByTestId('toggle-enabled-freelance');
  await expect(toggle).toBeVisible();
  const before = await toggle.getAttribute('aria-checked');
  for (const button of ['right', 'middle'] as const) {
    const { hover, held } = await heldLook(page, toggle, button);
    expect(held).toBe(hover);
  }
  await expect(toggle).toHaveAttribute('aria-checked', before!);
});

test('a click beside a focused field ends its focus', async ({ page }) => {
  await open(page, GALLERY);
  const field = page.locator('#gallery-address');
  await field.scrollIntoViewIfNeeded();
  const box = (await field.boundingBox())!;
  const label = page.locator('label[for="gallery-address"]');
  const labelBox = (await label.boundingBox())!;
  const beside: [string, () => Promise<void>][] = [
    [
      'the empty part of the label line',
      () => page.mouse.click(box.x + box.width - 4, labelBox.y + labelBox.height / 2),
    ],
    ['the hint below', () => page.locator('#gallery-address-message').click()],
    ['the heading', () => page.getByTestId('gallery-inputs').getByRole('heading').first().click()],
    [
      'the empty area to the right',
      () => page.mouse.click(box.x + box.width + 24, box.y + box.height / 2),
    ],
  ];
  for (const [where, click] of beside) {
    await field.click();
    await expect(field).toBeFocused();
    await click();
    await expect(field, where).not.toBeFocused();
  }
  // The words of its own label still lead into the field.
  await field.click();
  await page.mouse.click(labelBox.x + 4, labelBox.y + labelBox.height / 2);
  await expect(field).toBeFocused();
  // The chips and the empty part of a chip field keep its caret.
  const chips = page.locator('#gallery-chips');
  await chips.click();
  const chipBox = (await page.getByTestId('gallery-chips').boundingBox())!;
  await page.mouse.click(chipBox.x + chipBox.width - 6, chipBox.y + chipBox.height / 2);
  await expect(chips).toBeFocused();
});

test('a press on the top bar (a drag region) ends the focus of a field', async ({ page }) => {
  // Tauri's drag script cancels the press on a drag region (the window moves instead):
  // stand in for it, after the input policy's own listener like in the app.
  await page.addInitScript(() => {
    document.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      // Like Tauri's script: only a press on the region itself (not on a field or a
      // button inside its row) moves the window.
      if (event.button === 0 && target?.hasAttribute('data-tauri-drag-region')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  });
  for (const os of ['?platform=macos', '?platform=windows']) {
    await open(page, os);
    const search = page.getByTestId('search');
    await search.click();
    await expect(search).toBeFocused();
    // The empty part of the bar (Windows keeps its buttons at the right end).
    const bar = (await page.getByTestId('title-bar').boundingBox())!;
    await page.mouse.click(bar.x + 200, bar.y + bar.height / 2);
    await expect(search).not.toBeFocused();
  }
});

test('Enter presses buttons only; Space toggles a switch', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  const toggle = page.getByTestId('toggle-enabled-freelance');
  const before = await toggle.getAttribute('aria-checked');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(toggle).toHaveAttribute('aria-checked', before!);
  await page.keyboard.press('Space');
  await expect(toggle).not.toHaveAttribute('aria-checked', before!);
});

test('a radio group is one Tab stop and the arrows choose', async ({ page }) => {
  await open(page, '?gallery&platform=windows');
  const group = page.getByTestId('segmented-facet');
  await group.scrollIntoViewIfNeeded();
  const radios = group.getByRole('radio');
  const count = await radios.count();
  expect(count).toBeGreaterThan(1);
  const stops = await radios.evaluateAll((nodes) =>
    nodes.map((node) => `${node.getAttribute('aria-checked')}:${(node as HTMLElement).tabIndex}`),
  );
  expect(stops.filter((stop) => stop.endsWith(':0'))).toEqual(['true:0']);
  const checked = radios.and(page.locator('[aria-checked="true"]'));
  const first = await checked.textContent();
  await checked.focus();
  await page.keyboard.press('ArrowRight');
  const now = group.locator('[aria-checked="true"]');
  await expect(now).not.toHaveText(first!);
  await expect(now).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(group.locator('[aria-checked="true"]')).toHaveText(first!);
  // Left from the first option wraps to the last.
  await radios.first().click();
  await radios.first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(radios.last()).toHaveAttribute('aria-checked', 'true');
});

test('the middle button stays out of dialogs and fields', async ({ page }) => {
  await open(page, GALLERY);
  await page.getByTestId('open-danger').click();
  const dialog = page.getByTestId('dialog-danger');
  await expect(dialog).toBeVisible();
  const prevented = await page.evaluate(() => {
    const scrim = document.querySelector('[aria-modal="true"]')!.parentElement!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    scrim.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  // A real middle click on the backdrop: Enter then still answers the dialog.
  await page.mouse.click(8, 200, { button: 'middle' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  // A middle click on a field in a scrolling view does not focus it.
  await page.mouse.click(4, 4);
  const field = page.locator('#gallery-address');
  await field.scrollIntoViewIfNeeded();
  await field.click({ button: 'middle' });
  await page.waitForTimeout(100);
  await expect(field).not.toBeFocused();
});

test("Windows: Alt+Space reaches the OS, Shift+F10 opens the app's menu", async ({ page }) => {
  await open(page, WIN);
  const results = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[data-testid="search"]')!;
    const button = document.querySelector<HTMLElement>('[data-testid="fetch"]')!;
    const press = (target: Element, init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const altSpace = { key: ' ', code: 'Space', altKey: true };
    const shiftF10 = { key: 'F10', code: 'F10', shiftKey: true };
    return {
      altSpaceBody: press(document.body, altSpace),
      altSpaceField: press(field, altSpace),
      altSpaceButton: press(button, altSpace),
      shiftF10Field: press(field, shiftF10),
      f10Field: press(field, { key: 'F10', code: 'F10' }),
    };
  });
  expect(results).toEqual({
    altSpaceBody: false,
    altSpaceField: false,
    altSpaceButton: false,
    shiftF10Field: true,
    f10Field: true,
  });
  await expect(page.getByTestId('menu')).toBeVisible();
});

test('a field menu greys out Undo while there is nothing to undo', async ({ page }) => {
  await open(page, WIN);
  const search = page.getByTestId('search');
  const undo = page.getByTestId('menu-item-undo');
  await search.click({ button: 'right' });
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await search.click();
  await page.keyboard.type('CFO');
  await search.click({ button: 'right' });
  await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
});

test('keyboard focus stays clear of the edges of its scroll area', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('nav-settings').focus();
  const cut: string[] = [];
  for (let stop = 0; stop < 30; stop += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const gap = await page.evaluate(() => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement)) return null;
      let pane = node.parentElement;
      while (
        pane &&
        !(
          /auto|scroll/.test(getComputedStyle(pane).overflowY) &&
          pane.scrollHeight > pane.clientHeight
        )
      ) {
        pane = pane.parentElement;
      }
      if (pane === null) return null;
      const box = node.getBoundingClientRect();
      const view = pane.getBoundingClientRect();
      const top = view.top + pane.clientTop;
      return {
        id: node.getAttribute('data-testid') ?? node.tagName,
        above: box.top - top,
        below: top + pane.clientHeight - box.bottom,
      };
    });
    if (gap !== null && (gap.above < 4 || gap.below < 4)) cut.push(JSON.stringify(gap));
  }
  expect(cut).toEqual([]);
});

/* ------------------------------------------------------------- The end of the autoscroll */

// The press that ends the OS autoscroll ends only the autoscroll: it presses nothing,
// whichever button it is, like the native scrolling of Windows.

test('the click that ends the autoscroll presses nothing; a dragged middle press leaves no mode', async ({
  page,
  browserName,
}) => {
  // The autoscroll is Windows' (WebView2, a Chromium): WebKit has none to end.
  test.skip(browserName === 'webkit', 'no autoscroll in WebKit');
  await open(page, '?platform=windows&scenario=many');
  const archive = page.getByTestId('place-archive');
  const list = (await page.getByTestId('job-list').boundingBox())!;
  const inList = { x: list.x + list.width / 2, y: list.y + list.height / 2 };
  // A middle click in the list: the autoscroll runs until the next press.
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await archive.click();
  await expect(archive).not.toHaveAttribute('aria-selected', 'true');
  // The next click is an ordinary one again.
  await archive.click();
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  // Held and dragged, the middle button scrolled while held: no mode is left.
  const inbox = page.getByTestId('place-inbox');
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(inList.x, inList.y + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await inbox.click();
  await expect(inbox).toHaveAttribute('aria-selected', 'true');
});

/* ------------------------------------------- Mouse buttons and the wheel, every kind of control */

// The rule of every control (user decision 2026-09-27): it acts on the left button only. A
// right click opens the app's menu where there is one (a job row, a field, copyable text) and
// does nothing else; a middle click activates nothing; the wheel only scrolls and never
// changes a value.

/** The background of an element now. */
const background = (target: Locator): Promise<string> =>
  target.evaluate((node) => getComputedStyle(node).backgroundColor);

/** A menu of the app is open (a job's, a field's, the filter's, a menu button's, the ring's
 *  "Warum diese Zahl?"). */
const menuOpen = (page: Page): Locator => page.locator('[data-menu-layer]');

/** Ends a middle press's autoscroll (Windows, over a scroll area): the next press only ends
 *  it. A press on the list header's empty band does nothing else. */
async function endAutoscroll(page: Page): Promise<void> {
  const header = (await page.getByTestId('list-header').boundingBox())!;
  await page.mouse.click(header.x + header.width - 6, header.y + header.height - 4);
  await page.mouse.move(4, 4);
}

test('a right click on a job row opens its menu: the row is not opened, chosen, focused or pressed', async ({
  page,
}) => {
  await open(page, WIN);
  const row = rows(page).nth(1);
  const pressed = await tokenColour(page, '--quiet-press');
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(150);
  expect(await background(row)).not.toBe(pressed);
  await page.mouse.up({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  expect(await background(row)).not.toBe(pressed);
  await expect(row).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menuOpen(page)).toHaveCount(0);
  await expect(row).not.toBeFocused();
  await expect(row).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('reader')).toHaveCount(0);
  expect(await calls(page, 'job_detail')).toHaveLength(0);
  // A right click on its tools: the job's menu too, no move.
  await row.hover();
  await page.getByTestId('tool-archive').click({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
});

test('a right click on any other control does nothing: no menu, no press, no focus', async ({
  page,
}) => {
  await open(page, WIN);
  const targets = [
    page.getByTestId('place-archive'),
    page.getByTestId('fetch-range'),
    page.getByTestId('filter'),
    page.getByTestId('nav-settings'),
  ];
  for (const target of targets) {
    await target.click({ button: 'right' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), String(target)).toHaveCount(0);
    await expect(target).not.toBeFocused();
  }
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('nav-jobs')).toHaveAttribute('aria-current', 'page');
  // The reader's "…" (the ring opens on hover: reader.spec.ts).
  await rows(page).first().click();
  for (const id of ['reader-more']) {
    await page.getByTestId(id).click({ button: 'right' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), id).toHaveCount(0);
    await expect(page.getByTestId(id)).not.toBeFocused();
  }
});

test('a middle click activates nothing: tabs, a menu button, the funnel, a row tool, the "…"', async ({
  page,
}) => {
  await open(page, WIN);
  // In the header (no scroll area there: no autoscroll either).
  for (const id of ['place-archive', 'fetch-range', 'filter']) {
    await page.getByTestId(id).click({ button: 'middle' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), id).toHaveCount(0);
  }
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-selected', 'true');
  // A row's tool: the job stays where it is.
  const row = rows(page).nth(1);
  await row.hover();
  await page.getByTestId('tool-archive').click({ button: 'middle' });
  await endAutoscroll(page);
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
  await expect(page.getByTestId('reader')).toHaveCount(0);
  // The reader's "…" (the ring opens on hover: reader.spec.ts).
  await rows(page).first().click();
  for (const id of ['reader-more']) {
    await page.getByTestId(id).click({ button: 'middle' });
    await endAutoscroll(page);
    await expect(menuOpen(page), id).toHaveCount(0);
  }
});

test('a middle click activates nothing in the Profil: a choice, a chip x, the calendar, a level', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const view = page.getByTestId('view-profile');
  /** Ends the autoscroll with a press on the Profil's plain heading. */
  const end = async (): Promise<void> => {
    await view.locator('h2').first().click();
  };
  // A choice (a radio group): the chosen option stays chosen.
  const group = page.getByTestId('profile-remote');
  const chosen = await group.locator('[aria-checked="true"]').allTextContents();
  await group.getByRole('radio').last().click({ button: 'middle' });
  await end();
  expect(await group.locator('[aria-checked="true"]').allTextContents()).toEqual(chosen);
  // A chip's x while text is typed in its field: the chip stays, the typed text stays typed
  // and keeps the caret (the focus the press moved comes back unseen).
  const tools = page.getByTestId('profile-tools');
  const input = tools.locator('input');
  const before = await tools.locator('.chip .text').allTextContents();
  await input.fill('Visio');
  await tools.locator('.remove').first().click({ button: 'middle' });
  await page.waitForTimeout(100);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Visio');
  expect(await tools.locator('.chip .text').allTextContents()).toEqual(before);
  await input.fill('');
  await end();
  // A suggestion of the engine's words takes nothing.
  const name = page.getByTestId('competence-name').first();
  await name.fill('Contr');
  const hints = page.getByTestId('competence-name-suggestions').first();
  await expect(hints.getByRole('option').first()).toBeVisible();
  await hints.getByRole('option').first().click({ button: 'middle' });
  await hints.getByRole('option').first().click({ button: 'right' });
  await page.waitForTimeout(100);
  await expect(name).toHaveValue('Contr');
  await expect(name).toBeFocused();
  await expect(menuOpen(page)).toHaveCount(0);
  await end();
  // A language's level (a menu button) opens no menu.
  await page.getByTestId('language-level').first().click({ button: 'middle' });
  await end();
  await expect(menuOpen(page)).toHaveCount(0);
  // Verfügbar ab: the calendar's button opens nothing, its days take nothing.
  const available = page.getByTestId('profile-available');
  await available.getByRole('radio').last().click();
  const calendar = page.getByTestId('profile-date-calendar');
  await calendar.click({ button: 'middle' });
  await end();
  await expect(page.getByTestId('profile-date-calendar-popover')).toHaveCount(0);
  await calendar.click();
  const popover = page.getByTestId('profile-date-calendar-popover');
  await expect(popover).toBeVisible();
  const date = page.getByTestId('profile-date');
  const typed = await date.inputValue();
  await popover.locator('[data-day]').nth(10).click({ button: 'middle' });
  await popover.locator('[data-day]').nth(11).click({ button: 'right' });
  await page.waitForTimeout(150);
  await expect(date).toHaveValue(typed);
  expect(await calls(page, 'save_profile')).toHaveLength(0);
});

test('the wheel over a date field, the calendar, a level and the filter menu changes nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const available = page.getByTestId('profile-available');
  await available.getByRole('radio').last().click();
  const date = page.getByTestId('profile-date');
  await date.fill('01.11.2026');
  await page.getByTestId('view-profile').locator('h2').first().click();
  expect(await wheelOver(page, date, 'view-profile')).not.toBe(0);
  await expect(date).toHaveValue('01.11.2026');
  // Over the calendar the page scrolls; its month stays.
  await page.getByTestId('profile-date-calendar').click();
  const popover = page.getByTestId('profile-date-calendar-popover');
  await expect(popover).toBeVisible();
  const month = await popover.textContent();
  expect(await wheelOver(page, popover, 'view-profile', 120)).not.toBe(0);
  await expect(popover).toBeVisible();
  expect(await popover.textContent()).toBe(month);
  await expect(date).toHaveValue('01.11.2026');
  await page.keyboard.press('Escape');
  // A language's level (a menu button); the languages end the page, so the wheel goes up.
  const level = page.getByTestId('language-level').first();
  const shown = await level.textContent();
  expect(await wheelOver(page, level, 'view-profile', -120)).not.toBe(0);
  await expect(level).toHaveText(shown ?? '');
  await expect(menuOpen(page)).toHaveCount(0);
  expect(await calls(page, 'save_profile')).toHaveLength(0);
  // The filter menu: nothing gets checked, the list stays as it was.
  await open(page, WIN);
  await page.getByTestId('filter').click();
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  const checked = await menu.locator('[aria-checked="true"]').allTextContents();
  const queries = (await calls(page, 'list_jobs')).length;
  const area = (await menu.boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
  expect(await menu.locator('[aria-checked="true"]').allTextContents()).toEqual(checked);
  expect(await calls(page, 'list_jobs')).toHaveLength(queries);
});
