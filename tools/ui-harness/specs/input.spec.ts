// The input policy of lib/input/input.ts, in one place: like a native app. Controls react to
// the left button only, the middle button scrolls scroll areas (and its autoscroll's end
// presses nothing), the wheel scrolls what lies under the pointer, text a user would copy
// selects and copies. Keys: Tab moves the focus, Space presses controls and Enter buttons;
// fields take every character of the keyboard layout (AltGr, Option) and the editing keys of
// the OS; dialogs hold the focus; the app has no shortcuts of its own, and a menu names no
// keys; everything else is swallowed.

import type { Locator, Page } from '@playwright/test';
import { animationsDone, calls, expect, open, settle, test } from './fixtures';
import { adder, chooseFilter, failNext, reveal, T } from './helpers';

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

/** What `menuEntries` reads for an entry that is off. */
const off = (label: string): string => `${label} (aus)`;

/** No entry of the open menu names a key: each says its words and nothing else. */
async function expectNoKeys(page: Page): Promise<void> {
  const more = await page
    .getByTestId('menu')
    .getByRole('menuitem')
    .evaluateAll((nodes) =>
      nodes
        .filter(
          (node) => node.textContent?.trim() !== node.querySelector('.label')?.textContent?.trim(),
        )
        .map((node) => node.textContent),
    );
  expect(more).toEqual([]);
}

/** A menu of the app is open (a job's, a field's, the filter's, a select's list). */
const menuOpen = (page: Page): Locator => page.locator('[data-menu-layer]');

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

/** A moment longer than a changed control waits before it saves (--save-delay). */
const T_SAVE = 400;

const saves = async (page: Page): Promise<number> => (await calls(page, 'save_profile')).length;

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
      // At rest no wheel listener that may cancel is attached (scrolling never waits for
      // the page); it is there only while Ctrl or Cmd is held, or a menu is open (below, the
      // right click in the field opens one).
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
    T.edit.undo,
    off(T.edit.cut),
    off(T.edit.copy),
    T.edit.paste,
    off(T.edit.delete),
    T.edit.selectAll,
  ]);
  await expect(menu.getByRole('separator')).toHaveCount(2);
  await expectNoKeys(page);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(search).toBeFocused();
  await search.evaluate((node: HTMLInputElement) => node.setSelectionRange(0, 7));
  await search.click({ button: 'right' });
  expect(await menuEntries(page)).toEqual([
    T.edit.undo,
    T.edit.cut,
    T.edit.copy,
    T.edit.paste,
    T.edit.delete,
    T.edit.selectAll,
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
  expect(await menuEntries(page)).toEqual([T.edit.copy]);
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
  // Its whole box, the corners and the room around the rows.
  const box = (await menuOpen(page).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
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
    T.edit.cut,
    T.edit.copy,
    T.edit.paste,
    T.edit.selectAll,
  ]);
  await expectNoKeys(page);
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
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-freelance'));
  await toggle.click({ button: 'right' });
  await toggle.click({ button: 'middle' });
  await page.waitForTimeout(300);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await focused()).not.toBe('toggle-enabled-freelance');
  const calls = await page.evaluate(() => window.__harness.calls.map(([name]) => name));
  expect(calls).not.toContain('save_settings');
  // Over a scroll area the middle click started the autoscroll of the engine (Windows
  // behaviour): the next click (on the source's name, which switches nothing) only ends it.
  // Then the left button works.
  await page.getByTestId('portal-freelance').getByText(T.portal.freelance).click();
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
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-freelance'));
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
  // A click on the magnifier, wherever it stands in the field.
  const magnifier = (await search.locator('xpath=..').locator('.lead').boundingBox())!;
  await page.mouse.click(magnifier.x + magnifier.width / 2, magnifier.y + magnifier.height / 2);
  await expect(search).toBeFocused();
});

test('the password eye and the search clear keep the caret in the field', async ({ page }) => {
  // The app password of the setup's Alert-Mails, the search of the list.
  await open(page, `${WIN}&scenario=setup-profile`);
  const password = page.getByTestId('mailbox-password');
  await password.fill('abcd efgh');
  await page.keyboard.press('End');
  const eye = page.getByRole('button', { name: T.field.reveal });
  await expect(eye).toHaveAttribute('tabindex', '-1');
  await eye.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toBeFocused();
  await page.keyboard.type('x');
  await expect(password).toHaveValue('abcd efghx');
  // A selection in the field stays as well.
  await password.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 5));
  await page.getByRole('button', { name: T.field.conceal }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(
    await password.evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd]),
  ).toEqual([2, 5]);
  await open(page, WIN);
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  const clear = page.getByRole('button', { name: T.field.clear });
  await expect(clear).toHaveAttribute('tabindex', '-1');
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
});

test('the password eye and the search clear bring no caret: only a press on the field does', async ({
  page,
}) => {
  await open(page, `${WIN}&scenario=setup-profile`);
  const password = page.getByTestId('mailbox-password');
  await password.fill('abcd efgh');
  await password.evaluate((node) => node.blur());
  await page.getByRole('button', { name: T.field.reveal }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).not.toBeFocused();
  await open(page, WIN);
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  await search.evaluate((node) => node.blur());
  await page.getByRole('button', { name: T.field.clear }).click();
  await expect(search).toHaveValue('');
  await expect(search).not.toBeFocused();
});

/** Einstellungen > Daten with the danger dialog of "Zurücksetzen"; its opener. */
async function resetDialog(page: Page): Promise<{ opener: Locator; dialog: Locator }> {
  await open(page, `${WIN}&view=settings`);
  const opener = await reveal(page, page.getByTestId('reset'));
  return { opener, dialog: page.getByTestId('dialog-reset') };
}

test('a dialog holds the focus: Tab cycles, a click on its text keeps Esc working', async ({
  page,
}) => {
  const { opener, dialog } = await resetDialog(page);
  // Opened from the keyboard: Enter presses the focused button.
  await opener.focus();
  await page.keyboard.press('Enter');
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

test('a dialog starts on its default button; Tab moves the focus to the other', async ({
  page,
}) => {
  const { opener, dialog } = await resetDialog(page);
  await opener.click();
  const cancel = dialog.getByTestId('dialog-cancel');
  const confirm = dialog.getByTestId('dialog-confirm');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a switch flips at once and slides back when its save fails', async ({ page }) => {
  // Every answer of the stub takes 900 ms here, the save then fails.
  await open(page, `${WIN}&scenario=slow&view=settings`);
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-linkedin'));
  const before = await toggle.getAttribute('aria-checked');
  const flipped = before === 'true' ? 'false' : 'true';
  await failNext(page, 'save_settings');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', flipped, { timeout: 300 });
  await expect(toggle).toHaveAttribute('aria-checked', before!, { timeout: 3000 });
});

test('the ad text, title and facts select and copy; the rest does not select', async ({
  page,
  browserName,
}) => {
  // A job with its full ad (by match the first row is one still without a score or ad).
  await page.getByTestId('job-row-freelancermap-2801').click();
  const text = page.getByTestId('ad-text');
  await expect(text).toBeVisible();
  // A drag across the ad text selects it, like in a document.
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
  // Title and facts select too; labels and what is no value do not (a drag over them selects
  // nothing). A drag from the first word to the last (a block's box runs on beside its words).
  const drag = async (target: Locator): Promise<string> => {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const box = (await target.boundingBox())!;
    const end = await target.evaluate((node) => {
      const words = document.createRange();
      words.selectNodeContents(node);
      return words.getBoundingClientRect().right;
    });
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(end - 2, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    return page.evaluate(() => getSelection()?.toString() ?? '');
  };
  await page.getByTestId('stage').evaluate((node) => node.scrollTo({ top: 0 }));
  const fact = page.getByTestId('term-company');
  expect((await drag(page.getByTestId('reader-title'))).length).toBeGreaterThan(5);
  expect((await drag(fact.locator('.value'))).length).toBeGreaterThan(2);
  expect(await drag(fact.locator('.term-name')), 'the label of a fact').toBe('');
  for (const id of ['band', 'reasons']) {
    expect(await drag(page.getByTestId(id)), id).toBe('');
  }
});

test("a drag along the job's title that runs on over its tools keeps what it selected", async ({
  page,
}) => {
  await page.getByTestId('job-row-freelancermap-2801').click();
  const title = page.getByTestId('reader-title');
  await expect(title).toBeVisible();
  const from = (await title.boundingBox())!;
  const tools = (await page.getByTestId('reader-tools').boundingBox())!;
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + 2, y);
  await page.mouse.down();
  // Along the title's first line, past its last word onto the tools at the line's end, like a
  // hand that overshoots: a native text view selects up to the end of the line.
  await page.mouse.move(tools.x + tools.width / 2, y, { steps: 8 });
  await page.mouse.up();
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
  expect(await selection(page)).toBe(await title.innerText());
  // Let go, the tools take the pointer again.
  await page.getByTestId('reader-archive').click();
  await expect.poll(async () => (await calls(page, 'move_jobs')).length).toBe(1);
});

test('a drag from a field goes on over the buttons: no hover look, no press', async ({ page }) => {
  await open(page, WIN);
  const fetch = page.getByTestId('fetch');
  const search = page.getByTestId('search');
  await search.fill('Controlling');
  const field = (await search.boundingBox())!;
  const box = (await fetch.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  const hovered = await look(fetch);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
  const atRest = await look(fetch);
  expect(hovered).not.toBe(atRest);
  // Over the button while the left button holds a press from the field: at rest, no press.
  await page.mouse.move(field.x + 20, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(200);
  expect(await look(fetch)).toBe(atRest);
  await page.mouse.up();
  expect(await calls(page, 'start_run')).toHaveLength(0);
  await page.waitForTimeout(200);
  // The pointer that rests there counts again once it moves.
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
  await expect.poll(() => look(fetch)).toBe(hovered);
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
// key scrolling reaches the end (at once under reduced motion).

test('the wheel over a switch changes nothing and scrolls the page', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=settings`);
  // The first source's switch, high on the page, which scrolls at this height.
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-hays'));
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
  const rate = page.getByTestId('profile-min-rate');
  await rate.fill('950');
  expect(await wheelOver(page, rate, 'view-profile')).toBeGreaterThan(0);
  await expect(rate).toHaveValue('950');
  // A choice (a select): the chosen option stays chosen, its list stays shut.
  const choice = page.getByTestId('profile-work-mode');
  const chosen = await choice.textContent();
  expect(await wheelOver(page, choice, 'view-profile', 120)).toBeGreaterThan(0);
  await expect(choice).toHaveText(chosen ?? '');
  await expect(menuOpen(page)).toHaveCount(0);
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
  // Esc closes it (a wheel beside it too: the press-outside test above).
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test("a select's open list takes the wheel like a menu: over it the page stays, beside it the list closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=profile`);
  await (await reveal(page, page.getByTestId('profile-work-mode'))).click();
  const list = page.getByTestId('menu');
  await expect(list).toBeVisible();
  const before = await scrollTop(page, 'view-profile');
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(300);
  await expect(list).toBeVisible();
  expect(await scrollTop(page, 'view-profile')).toBe(before);
  // Beside it the wheel scrolls the page: the list, which would stay behind in the air, closes.
  await page.mouse.move(box.x + box.width + 60, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect(list).toHaveCount(0);
});

test('behind a modal dialog nothing scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // Leaving with a value that is wrong (too large, it holds the save) asks in a dialog over
  // the view.
  await page.getByTestId('profile-wish-rate').fill('200.000');
  await page.getByTestId('nav-jobs').click();
  const dialog = page.getByTestId('dialog-leave-profile');
  await expect(dialog).toBeVisible();
  await settle(page);
  // The view behind could go either way from here.
  const before = await page
    .getByTestId('view-profile')
    .evaluate((node) => (node.scrollTop = Math.min(100, node.scrollHeight - node.clientHeight)));
  expect(before).toBeGreaterThan(0);
  // Over the scrim, away from the card.
  await page.mouse.move(300, 60);
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  expect(await scrollTop(page, 'view-profile')).toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a right click where nothing offers a menu does nothing', async ({ page }) => {
  await open(page, `${WIN}&view=settings`);
  // A source's name: plain text, no field, nothing to copy.
  const name = page.getByTestId('portal-hays').getByText(T.portal.hays);
  await name.click({ button: 'right' });
  await page.waitForTimeout(150);
  await expect(page.getByTestId('menu')).toHaveCount(0);
  expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  // A select: its list is the left button's, the right one neither opens nor focuses it.
  await open(page, `${WIN}&view=profile`);
  const choice = await reveal(page, page.getByTestId('profile-work-mode'));
  await choice.click({ button: 'right' });
  await page.waitForTimeout(150);
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(choice).not.toBeFocused();
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
  await page.getByTestId('job-list').getByTestId('job-row-freelancermap-2801').click();
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
    [
      '[data-testid^="job-row-"]',
      '[data-testid="nav-jobs"] svg',
      '[data-testid="place-archive"] .label',
    ].map((css) => {
      const node = document.querySelector(css)!;
      const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      return event.defaultPrevented;
    }),
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

test('the page keys scroll to the end; under reduced motion they jump', async ({ page }) => {
  // Low enough that Einstellungen scrolls far (a page and more: End goes to its end).
  await page.setViewportSize({ width: 1100, height: 400 });
  const room = (): Promise<number> =>
    page.getByTestId('view-settings').evaluate((node) => node.scrollHeight - node.clientHeight);
  const name = (): Locator => page.getByTestId('settings-portals').locator('h2');
  // Reduced motion: at once.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, `${WIN}&view=settings`);
  // A click on plain text: the focus is nowhere, the keys scroll the pane clicked last.
  await name().click();
  await page.keyboard.press('End');
  expect(await room()).toBeGreaterThan(200);
  expect(await scrollTop(page, 'view-settings')).toBe(await room());
  // Otherwise the same end, reached by a short glide.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, `${WIN}&view=settings`);
  await name().click();
  await page.keyboard.press('End');
  await expect.poll(() => scrollTop(page, 'view-settings')).toBe(await room());
});

test('the page keys scroll the Profil too: a click on plain text leaves no caret', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, `${WIN}&view=profile`);
  const view = page.getByTestId('view-profile');
  await view.locator('#profile-section-job-heading').click();
  const room = await view.evaluate((node) => node.scrollHeight - node.clientHeight);
  expect(room).toBeGreaterThan(200);
  await page.keyboard.press('End');
  await expect.poll(() => scrollTop(page, 'view-profile')).toBe(room);
  await page.keyboard.press('Home');
  await expect.poll(() => scrollTop(page, 'view-profile')).toBe(0);
});

test('what only holds the focus counts as nowhere: the page keys scroll, Enter and Esc reach its form', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 400 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  /** End and Home go to the ends of the view, an arrow a line down. */
  const scrolls = async (pane: string): Promise<void> => {
    const room = await page
      .getByTestId(pane)
      .evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(room).toBeGreaterThan(0);
    await page.keyboard.press('End');
    await expect.poll(() => scrollTop(page, pane)).toBe(room);
    await page.keyboard.press('Home');
    await expect.poll(() => scrollTop(page, pane)).toBe(0);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => scrollTop(page, pane)).toBeGreaterThan(0);
  };
  // The Profil as it opens, before any press: its root holds the focus.
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeFocused();
  await scrolls('view-profile');
  // A step of the setup: its heading.
  await open(page, `${WIN}&scenario=setup-profile`);
  await expect(page.getByTestId('first-heading')).toBeFocused();
  await scrolls('view-first-run');
  const form = page.getByTestId('mailbox-form');
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert').first()).toBeVisible();
  // The mailbox form of Einstellungen: its box.
  await open(page, `${WIN}&view=settings`);
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  await expect(form).toBeVisible();
  await scrolls('view-settings');
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
});

test('with the focus on nothing Enter and Esc go to the form pressed last, and to no other', async ({
  page,
}) => {
  const alerts = page.getByTestId('mailbox-form').getByRole('alert');
  // Plain text of the setup's step: the focus leaves its heading and rests on nothing.
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.getByTestId('first-lead').click();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(alerts.first()).toBeVisible();
  // The top bar is no part of it: the keys reach nothing.
  await open(page, `${WIN}&scenario=setup-profile`);
  await page.mouse.click(700, 10);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  await expect(alerts).toHaveCount(0);
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
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
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
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-freelance'));
  await expect(toggle).toBeVisible();
  const before = await toggle.getAttribute('aria-checked');
  for (const button of ['right', 'middle'] as const) {
    const { hover, held } = await heldLook(page, toggle, button);
    expect(held).toBe(hover);
  }
  await expect(toggle).toHaveAttribute('aria-checked', before!);
});

test('a click beside a focused field ends its focus', async ({ page }) => {
  await open(page, `${WIN}&view=profile`);
  const field = page.getByTestId('profile-years');
  const label = page.locator(`label[for="${await field.getAttribute('id')}"]`);
  // Measured where the field stands now (a click on the heading may scroll the page).
  const at = async (target: typeof field, dx: (box: { width: number }) => number) => {
    const box = (await target.boundingBox())!;
    await page.mouse.click(box.x + dx(box), box.y + box.height / 2);
  };
  const beside: [string, () => Promise<void>][] = [
    ['the empty part of the label line', () => at(label, (box) => box.width + 8)],
    [
      'the heading',
      () => page.getByTestId('section-experience').getByRole('heading').first().click(),
    ],
    ['the empty area to the right', () => at(field.locator('xpath=..'), (box) => box.width + 24)],
  ];
  for (const [where, click] of beside) {
    await field.click();
    await expect(field).toBeFocused();
    await click();
    await expect(field, where).not.toBeFocused();
  }
  // The words of its own label still lead into the field.
  await field.click();
  await at(label, () => 4);
  await expect(field).toBeFocused();
  // The empty part of a chip field, after its first line of chips, keeps its caret.
  const tools = page.getByTestId('profile-tools');
  const input = tools.locator('input');
  await input.click();
  const chipBox = (await tools.boundingBox())!;
  await page.mouse.click(chipBox.x + chipBox.width - 6, chipBox.y + 3);
  await expect(input).toBeFocused();
});

test('a press on the free part of a tag field is a press like any other: the caret goes in, a menu closes', async ({
  page,
}) => {
  await open(page, '?view=profile');
  await page.getByTestId('profile-work-mode').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  // The field's own box: the strip above its line, around its input.
  const regions = page.getByTestId('profile-regions');
  const box = (await regions.boundingBox())!;
  // The press that closes a menu presses nothing else.
  await page.mouse.click(box.x + box.width - 6, box.y + 1);
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await expect(regions.locator('input')).not.toBeFocused();
  await page.mouse.click(box.x + box.width - 6, box.y + 1);
  await expect(regions.locator('input')).toBeFocused();
});

test('a press on the strip around a button in a field keeps the caret there', async ({ page }) => {
  await open(page, '?scenario=setup-profile');
  const password = page.getByTestId('mailbox-password');
  await password.click();
  const eye = page.getByRole('button', { name: T.field.reveal });
  const box = (await eye.boundingBox())!;
  await page.mouse.click(box.x + box.width + 1, box.y + box.height / 2);
  await expect(password).toBeFocused();
});

test('a press on the unit inside a number field lands in the field', async ({ page }) => {
  await open(page, `${WIN}&view=profile`);
  // Inside the field's edge, at its right end: a press there is a press on the field, like one
  // on the magnifier of the search. A field of the form, a competence's in its row.
  for (const [id, words] of [
    ['profile-wish-rate', T.profile.unit.day],
    ['competence-years', T.profile.unit.years],
  ] as const) {
    const field = await reveal(page, page.getByTestId(id).first());
    const unit = field.locator('xpath=..').getByText(words);
    const box = (await unit.boundingBox())!;
    await field.click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field, 'it keeps the caret it has').toBeFocused();
    await field.evaluate((node) => node.blur());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(field, 'it takes the caret').toBeFocused();
    // At the end of the text, as a press beyond a native field's text puts it.
    await page.keyboard.type('1');
    expect((await field.inputValue()).replace(/\D/g, '').endsWith('1')).toBe(true);
    // The right button there opens the field's menu too.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(page.getByTestId('menu-item-select-all')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
  }
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

test('Enter presses buttons only; Space toggles a switch and a checkbox', async ({ page }) => {
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  const toggle = await reveal(page, page.getByTestId('toggle-enabled-freelance'));
  const before = await toggle.getAttribute('aria-checked');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(toggle).toHaveAttribute('aria-checked', before!);
  await page.keyboard.press('Space');
  await expect(toggle).not.toHaveAttribute('aria-checked', before!);
  // A contract type of the Profil.
  await page.getByTestId('nav-profile').click();
  const check = await reveal(page, page.getByTestId('contract-temporary'));
  const state = await check.getAttribute('aria-checked');
  await check.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await expect(check).toHaveAttribute('aria-checked', state!);
  await page.keyboard.press('Space');
  await expect(check).not.toHaveAttribute('aria-checked', state!);
});

test('a radio group is one Tab stop and the arrows choose', async ({ page }) => {
  // The backups of a start whose data cannot load, the app's radio list.
  await open(page, `${WIN}&scenario=load-failed`);
  await page.getByTestId('restore-backup').click();
  const group = page.getByTestId('backup-list');
  await expect(group).toBeVisible();
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
  // Left from the first option wraps to the last; Home and End go to the ends.
  await radios.first().click();
  await radios.first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(radios.last()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(radios.first()).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  await expect(radios.last()).toHaveAttribute('aria-checked', 'true');
  await expect(radios.last()).toBeFocused();
  // Enter goes on to the dialog around it: the chosen copy is restored.
  const chosen = await radios.last().getAttribute('data-id');
  await page.keyboard.press('Enter');
  await expect(group).toHaveCount(0);
  expect((await calls(page, 'restore_backup')).map(([, args]) => args)).toEqual([{ id: chosen }]);
});

test('the middle button stays out of dialogs and fields', async ({ page }) => {
  const { opener, dialog } = await resetDialog(page);
  await opener.click();
  await expect(dialog).toBeVisible();
  const prevented = await page.evaluate(() => {
    const scrim = document.querySelector('[aria-modal="true"]')!.parentElement!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    scrim.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  // A real middle click on the backdrop: Esc then still answers the dialog.
  await page.mouse.click(8, 200, { button: 'middle' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // A middle click on a field in a scrolling view does not focus it.
  await open(page, `${WIN}&view=profile`);
  const field = page.getByTestId('profile-years');
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

test('a field menu switches Undo off while there is nothing to undo', async ({ page }) => {
  await open(page, WIN);
  const search = page.getByTestId('search');
  const undo = page.getByTestId('menu-item-undo');
  await search.click({ button: 'right' });
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  // The other entries stay on.
  await expect(page.getByTestId('menu-item-paste')).not.toHaveAttribute('aria-disabled', 'true');
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
    if (gap !== null && (gap.above < 0 || gap.below < 0)) cut.push(JSON.stringify(gap));
  }
  expect(cut).toEqual([]);
});

/* ------------------------------------------------------------- The end of the autoscroll */

// The press that ends the OS autoscroll ends only the autoscroll: it presses nothing,
// whichever button it is, like the native scrolling of Windows.

/** The long list, once it scrolls: a middle press before that starts no autoscroll, and the next
 *  one would. */
async function openLongList(page: Page): Promise<void> {
  await open(page, '?platform=windows&scenario=many');
  await expect
    .poll(() =>
      page.getByTestId('list-scroll').evaluate((node) => node.scrollHeight > node.clientHeight),
    )
    .toBe(true);
}

test('the click that ends the autoscroll presses nothing; a dragged middle press leaves no mode', async ({
  page,
  browserName,
}) => {
  // The autoscroll is Windows' (WebView2, a Chromium): WebKit has none to end.
  test.skip(browserName === 'webkit', 'no autoscroll in WebKit');
  await openLongList(page);
  const archive = page.getByTestId('place-archive');
  // The pane: the list itself grows with each page it loads, far below the window.
  const list = (await page.getByTestId('list-scroll').boundingBox())!;
  const inList = { x: list.x + list.width / 2, y: list.y + list.height / 2 };
  // A middle click in the list: the autoscroll runs until the next press.
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await archive.click();
  await expect(archive).not.toHaveAttribute('aria-current', 'page');
  // The next click is an ordinary one again.
  await archive.click();
  await expect(archive).toHaveAttribute('aria-current', 'page');
  // Held and dragged, the middle button scrolled while held: no mode is left.
  const inbox = page.getByTestId('place-inbox');
  await page.mouse.move(inList.x, inList.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(inList.x, inList.y + 60, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await inbox.click();
  await expect(inbox).toHaveAttribute('aria-current', 'page');
});

/** A middle click in the long list: the autoscroll runs until the next press or key. */
async function startAutoscroll(page: Page): Promise<void> {
  await openLongList(page);
  const list = (await page.getByTestId('list-scroll').boundingBox())!;
  await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
}

test('a key that ends the autoscroll leaves no mode: the next click is an ordinary one', async ({
  page,
}) => {
  await startAutoscroll(page);
  await page.keyboard.press('Escape');
  const archive = page.getByTestId('place-archive');
  await archive.click();
  await expect(archive).toHaveAttribute('aria-current', 'page');
});

test('a second middle click that ends the autoscroll leaves no mode either', async ({ page }) => {
  await startAutoscroll(page);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  const archive = page.getByTestId('place-archive');
  await archive.click();
  await expect(archive).toHaveAttribute('aria-current', 'page');
});

/* ------------------------------------------- Mouse buttons and the wheel, every kind of control */

// The rule of every control (user decision 2026-09-27): it acts on the left button only. A
// right click opens the app's menu where there is one (a job row, a field, copyable text) and
// does nothing else; a middle click activates nothing; the wheel only scrolls and never
// changes a value.

/** Ends a middle press's autoscroll (Windows, over a scroll area): the next press only ends
 *  it. A press on the list header's empty band does nothing else. */
async function endAutoscroll(page: Page): Promise<void> {
  const header = (await page.getByTestId('list-header').boundingBox())!;
  await page.mouse.click(header.x + header.width - 6, header.y + header.height - 4);
  await page.mouse.move(4, 4);
}

test('a right click on a job row opens its menu: the row is not opened, chosen or focused', async ({
  page,
}) => {
  await open(page, WIN);
  const row = rows(page).nth(1);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(150);
  await page.mouse.up({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
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
    page.getByTestId('fetch'),
    page.getByTestId('filter'),
    page.getByTestId('nav-settings'),
  ];
  for (const target of targets) {
    await target.click({ button: 'right' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), String(target)).toHaveCount(0);
    await expect(target).not.toBeFocused();
  }
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('view-jobs')).toBeVisible();
  // The reader's tools (the ring opens on hover: reader.spec.ts).
  await rows(page).first().click();
  for (const id of ['reader-archive', 'reader-trash']) {
    await page.getByTestId(id).click({ button: 'right' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), id).toHaveCount(0);
    await expect(page.getByTestId(id)).not.toBeFocused();
  }
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
});

test("a middle click activates nothing: a place, the fetch, the funnel, a row tool, the reader's", async ({
  page,
}) => {
  await open(page, WIN);
  // In the sidebar and the list's head (no scroll area there: no autoscroll either).
  for (const id of ['place-archive', 'filter', 'fetch']) {
    await page.getByTestId(id).click({ button: 'middle' });
    await page.waitForTimeout(100);
    await expect(menuOpen(page), id).toHaveCount(0);
  }
  await expect(page.getByTestId('place-inbox')).toHaveAttribute('aria-current', 'page');
  expect(await calls(page, 'start_run')).toHaveLength(0);
  // A row's tool: the job stays where it is.
  const row = rows(page).nth(1);
  await row.hover();
  await page.getByTestId('tool-archive').click({ button: 'middle' });
  await endAutoscroll(page);
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
  await expect(page.getByTestId('reader')).toHaveCount(0);
  // The reader's tools (the ring opens on hover: reader.spec.ts).
  await rows(page).first().click();
  for (const id of ['reader-archive', 'reader-trash']) {
    await page.getByTestId(id).click({ button: 'middle' });
    await endAutoscroll(page);
    await expect(menuOpen(page), id).toHaveCount(0);
  }
  expect(await calls(page, 'move_jobs')).toHaveLength(0);
  await expect(page.getByTestId('reader')).toBeVisible();
});

test('a middle click activates nothing in the Profil: a choice, a chip x, a suggestion, a level', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  const view = page.getByTestId('view-profile');
  /** Ends the autoscroll with a press on the Profil's first plain heading. */
  const end = async (): Promise<void> => {
    await view.locator('#profile-section-job-heading').click();
  };
  // A choice (a select): its list stays shut, the chosen option stays chosen.
  const choice = page.getByTestId('profile-work-mode');
  const chosen = await choice.textContent();
  await choice.click({ button: 'middle' });
  await end();
  await expect(menuOpen(page)).toHaveCount(0);
  await expect(choice).toHaveText(chosen ?? '');
  // A contract type (a checkbox) stays as it is.
  const contract = page.getByTestId('contract-temporary');
  const state = await contract.getAttribute('aria-checked');
  await contract.click({ button: 'middle' });
  await end();
  await expect(contract).toHaveAttribute('aria-checked', state!);
  // A chip's x while text is typed in its field: the chip stays, the typed text stays typed
  // and keeps the caret (the focus the press moved comes back unseen).
  const tools = await reveal(page, page.getByTestId('profile-tools'));
  const input = tools.locator('input');
  const before = await tools.locator('.chip .text').allTextContents();
  await input.fill('Visio');
  await tools.locator('.remove').first().click({ button: 'middle' });
  await page.waitForTimeout(100);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Visio');
  expect(await tools.locator('.chip .text').allTextContents()).toEqual(before);
  // The press that ends its autoscroll only ends it (the engine keeps a key to itself until
  // then): the caret is still in the field, and the next press leaves it.
  await end();
  await expect(input).toBeFocused();
  await input.fill('');
  await end();
  await expect(input).not.toBeFocused();
  // A suggestion of the engine's words takes nothing.
  await reveal(page, page.getByTestId('competences-add'));
  const name = await adder(page, 'competence');
  await name.fill('Contr');
  const hints = page.getByTestId('competence-add-suggestions');
  await expect(hints.getByRole('option').first()).toBeVisible();
  await hints.getByRole('option').first().click({ button: 'middle' });
  await hints.getByRole('option').first().click({ button: 'right' });
  await page.waitForTimeout(100);
  await expect(name).toHaveValue('Contr');
  await expect(name).toBeFocused();
  await expect(menuOpen(page)).toHaveCount(0);
  // Taken out again: left with text in it, the field would make it a row.
  await name.fill('');
  await end();
  // A language's level (its select) opens no menu.
  await (
    await reveal(page, page.getByTestId('language-level'))
  )
    .first()
    .click({ button: 'middle' });
  await end();
  await expect(menuOpen(page)).toHaveCount(0);
  // Mindestlaufzeit (a select) neither.
  await (await reveal(page, page.getByTestId('profile-min-months'))).click({ button: 'middle' });
  await end();
  await expect(menuOpen(page)).toHaveCount(0);
  // Nothing changed: a change would have saved by now.
  await page.waitForTimeout(T_SAVE);
  expect(await saves(page)).toBe(0);
});

test('the wheel over a date field, a level and the filter menu changes nothing', async ({
  page,
}) => {
  // Low enough that the page scrolls far.
  await page.setViewportSize({ width: 1100, height: 420 });
  await open(page, `${WIN}&view=profile`);
  await expect(page.getByTestId('profile-form')).toBeVisible();
  // The demo's profile is free from a day on: the day's field stands beside the choice.
  await expect(page.getByTestId('profile-available')).toHaveText(T.profile.availability.from);
  const date = page.getByTestId('profile-date');
  await date.fill('01.11.2026');
  await page.getByTestId('view-profile').locator('#profile-section-job-heading').click();
  // The field left, its new day saves: the one save of this test.
  await expect.poll(() => saves(page)).toBe(1);
  expect(await wheelOver(page, date, 'view-profile')).not.toBe(0);
  await expect(date).toHaveValue('01.11.2026');
  // A language's level (a select), from the page's end the wheel goes up.
  const level = (await reveal(page, page.getByTestId('language-level'))).first();
  await page
    .getByTestId('view-profile')
    .evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'instant' }));
  const shown = await level.textContent();
  expect(await wheelOver(page, level, 'view-profile', -120)).not.toBe(0);
  await expect(level).toHaveText(shown ?? '');
  await expect(menuOpen(page)).toHaveCount(0);
  await page.waitForTimeout(T_SAVE);
  expect(await saves(page)).toBe(1);
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

/* ============================================================== what the audit found */

const selection = (page: Page): Promise<string> =>
  page.evaluate(() => getSelection()?.toString().trim() ?? '');

test('a text selection goes with a press beside it, like in a native text view', async ({
  page,
}) => {
  await page.getByTestId('job-row-freelancermap-2801').click();
  const title = page.getByTestId('reader-title');
  await expect(title).toBeVisible();
  const stage = (await page.getByTestId('stage').boundingBox())!;
  // Each press on something that is no text of its own: the sidebar, the top bar, the
  // reader's margin, a button, a label of the job's facts.
  const presses: [string, () => Promise<void>][] = [
    ['sidebar', () => page.mouse.click(60, 600)],
    ['top bar', () => page.mouse.click(700, 10)],
    ['reader margin', () => page.mouse.click(stage.x + 16, stage.y + 300)],
    ['button', () => page.getByTestId('toggle-sidebar').click()],
    ['label', () => page.getByTestId('term-company').locator('.term-name').click()],
  ];
  for (const [what, press] of presses) {
    await title.dblclick();
    expect(await selection(page), `${what}: a word was selected`).not.toBe('');
    await press();
    expect(await selection(page), what).toBe('');
  }
  // A press on copyable text starts a selection of its own, it does not just clear one.
  await title.dblclick();
  await page.getByTestId('term-company').locator('.value').dblclick();
  expect(await selection(page)).not.toBe('');
});

test('the sentence of a failure selects and copies, wherever it is said', async ({ page }) => {
  /** A double click on the sentence selects a word of it (a line that is a block wider than
   *  its words: on its first words, not on the room after them). */
  const selects = async (sentence: Locator, atStart = false): Promise<void> => {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await sentence.dblclick(atStart ? { position: { x: 12, y: 8 } } : {});
    expect(await selection(page)).not.toBe('');
  };
  // A job that did not load (the empty state of a failure, in the reader).
  await failNext(page, 'job_detail');
  await page.getByTestId('job-row-freelancermap-2801').click();
  await expect(page.getByTestId('reader-error')).toBeVisible();
  await selects(page.getByTestId('reader-error').locator('.text'));
  // A move that failed (the notice under the list's header) and an undo that failed (a toast).
  await failNext(page, 'move_jobs');
  await page.getByTestId('job-row-freelancermap-2802').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await selects(page.getByTestId('header-error').locator('.text'));
  await page.waitForTimeout(550);
  await page.getByTestId('job-row-freelancermap-2803').click({ button: 'right' });
  await page.getByTestId('menu-item-archive').click();
  await failNext(page, 'move_back');
  await page.getByTestId('toast-action').click();
  await selects(
    page
      .getByTestId('toast')
      .filter({ hasText: T.error.text('db', {}) })
      .locator('.text'),
  );
  // A field's message and a portal's failed switch, in Einstellungen.
  await page.getByTestId('nav-settings').click();
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  await page.getByTestId('mailbox-save').click();
  await selects(page.getByTestId('mailbox-form').locator('[role="alert"] [data-copy]'), true);
  await failNext(page, 'save_settings');
  await (await reveal(page, page.getByTestId('toggle-enabled-hays'))).click();
  await selects(page.getByTestId('portal-error'), true);
});

test('a press on the app menu keeps the selection its Copy needs', async ({
  page,
  browserName,
}) => {
  await page.getByTestId('job-row-freelancermap-2801').click();
  const title = page.getByTestId('reader-title');
  await title.dblclick();
  const word = await selection(page);
  await title.click({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  // Only Chromium lets a page read the clipboard.
  const reads = browserName === 'chromium';
  if (reads) await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('menu-item-copy').click();
  await expect(page.getByTestId('menu')).toHaveCount(0);
  expect(await selection(page)).toBe(word);
  if (reads) {
    expect((await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe(word);
  }
  // The menu of something else leaves the selection alone as well.
  await rows(page).nth(1).click({ button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  expect(await selection(page)).toBe(word);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu')).toHaveCount(0);
  expect(await selection(page)).toBe(word);
});

test('Ctrl+A selects the copyable block pressed last, never the page', async ({ page }) => {
  await page.getByTestId('job-row-freelancermap-2801').click();
  const ad = page.getByTestId('ad-text');
  await expect(ad).toBeVisible();
  await ad.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = (await ad.boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + 6);
  await page.keyboard.press('Control+a');
  const words = (text: string): string => text.replace(/\s+/g, ' ').trim();
  expect(words(await selection(page))).toBe(words(await ad.innerText()));
  // After a press elsewhere there is nothing to select: the key does nothing.
  await page.mouse.click(60, 600);
  expect(await selection(page)).toBe('');
  await page.keyboard.press('Control+a');
  expect(await selection(page)).toBe('');
  // The alert mail CXact kept, read in its dialog (a mailbox without a Gmail link): its text
  // selects whole too, with the dialog's own button holding the focus.
  await page.evaluate(() => {
    window.__harness.editDetail = (detail) => ({
      ...detail,
      mail: { ...detail.mail, gmailUrl: null },
    });
  });
  await page.getByTestId('job-row-freelancermap-2802').click();
  await page.getByTestId('job-row-freelancermap-2801').click();
  await page.getByTestId('reader-mail').click();
  const mail = page.getByTestId('mail-text');
  await expect(mail).toBeVisible();
  await mail.click();
  await page.keyboard.press('Control+a');
  expect(words(await selection(page))).toBe(words(await mail.innerText()));
});

test('the mouse buttons go back and forward like Zurück and Vor', async ({ page }) => {
  const press = (button: number): Promise<void> =>
    page.evaluate((button) => {
      const init = { bubbles: true, cancelable: true, button };
      document.body.dispatchEvent(new MouseEvent('mousedown', init));
      document.body.dispatchEvent(new MouseEvent('mouseup', init));
    }, button);
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await press(3);
  await expect(page.getByTestId('reader')).toHaveCount(0);
  await press(4);
  await expect(page.getByTestId('reader')).toBeVisible();
  // Nothing ahead any more: forward does nothing.
  await press(4);
  await page.waitForTimeout(200);
  await expect(page.getByTestId('reader')).toBeVisible();
});

test('Tab goes round: from the last control to the first, Shift+Tab the other way', async ({
  page,
}) => {
  const where = (): Promise<number> =>
    page.evaluate(() => {
      const seen = ((window as unknown as { tabbed?: Element[] }).tabbed ??= []);
      const node = document.activeElement;
      if (node === null || node === document.body) return -1;
      if (!seen.includes(node)) seen.push(node);
      return seen.indexOf(node);
    });
  // Forward from the first control until the first comes again: the page itself never has the
  // focus on the way.
  await page.keyboard.press('Tab');
  expect(await where()).toBe(0);
  let steps = 0;
  for (; steps < 400; steps += 1) {
    await page.keyboard.press('Tab');
    const at = await where();
    expect(at, `after ${steps + 1} tabs`).not.toBe(-1);
    if (at === 0) break;
  }
  expect(steps).toBeLessThan(400);
  // Back from the first control: the last one, not the page.
  await page.keyboard.press('Shift+Tab');
  const last = await where();
  expect(last).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  expect(await where()).toBe(0);
});

/* ---------------------------------------------- the second click of a double click */

/** A double click as a person makes it, with the pointer at rest: `gap` ms from the first
 *  release to the second press, so what the first click did has taken its place. */
async function clickTwice(page: Page, target: Locator, gap = 200): Promise<void> {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ clickCount: 1 });
  await page.mouse.up({ clickCount: 1 });
  await page.waitForTimeout(gap);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

/** The commands of a job opened or read: none when no job was pressed. */
const opened = async (page: Page): Promise<string[]> =>
  (await calls(page))
    .map(([name]) => name)
    .filter((name) => ['job_detail', 'mark_read', 'open_target'].includes(name));

for (const gap of [200, 350]) {
  test(`a double click on a row's tool moves its job, the row that slid under it opens nothing (${gap} ms)`, async ({
    page,
  }) => {
    await open(page, WIN);
    const first = rows(page).first();
    const moved = page.getByTestId((await first.getAttribute('data-testid'))!);
    await first.hover();
    await clickTwice(page, page.getByTestId('tool-archive'), gap);
    await expect(moved).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(await calls(page, 'move_jobs')).toHaveLength(1);
    expect(await opened(page)).toEqual([]);
  });
}

test('a double click on Filter zurücksetzen resets it, the list that came under it opens nothing', async ({
  page,
}) => {
  await open(page, WIN);
  await chooseFilter(page, 'portal-hays');
  await expect(rows(page)).toHaveCount(0);
  await clickTwice(page, page.getByTestId('filter-reset'));
  await expect(rows(page).first()).toBeVisible();
  await page.waitForTimeout(100);
  expect(await opened(page)).toEqual([]);
});

test('a double click on an entry of a menu chooses it once, the row under it opens nothing', async ({
  page,
}) => {
  await open(page, WIN);
  await rows(page).first().click({ button: 'right' });
  await clickTwice(page, page.getByTestId('menu-item-open-ad'));
  await expect(page.getByTestId('menu')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(await opened(page)).toEqual(['open_target']);
});

test('a real double click on one row still opens its job and its ad, and on text selects a word', async ({
  page,
}) => {
  await open(page, WIN);
  await clickTwice(page, rows(page).first());
  await expect(page.getByTestId('reader')).toBeVisible();
  await expect.poll(async () => (await calls(page, 'open_target')).length).toBe(1);
  await clickTwice(page, page.locator('[data-testid="reader"] [data-copy]').first());
  expect((await selection(page)).trim()).not.toBe('');
});

test("a double click on a row's x removes that row, never the next one that slid under it", async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile`);
  const remove = page.getByTestId('competences-remove');
  for (const gap of [200, 300]) {
    const count = await remove.count();
    await reveal(page, remove.first());
    await clickTwice(page, remove.first(), gap);
    await expect(remove).toHaveCount(count - 1);
    await page.waitForTimeout(300);
    await expect(remove).toHaveCount(count - 1);
  }
});

test('a double click on an option chooses it, the select that lies under it stays closed', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile`);
  const select = await reveal(page, page.getByTestId('profile-work-mode'));
  await select.click();
  await clickTwice(page, page.getByTestId('menu-item-onsite'));
  await expect(select).toHaveText(T.profile.workMode.onsite);
  await page.waitForTimeout(100);
  await expect(page.getByTestId('menu')).toHaveCount(0);
});

test('a double click on what opens a dialog or a menu leaves it open', async ({ page }) => {
  const { opener, dialog } = await resetDialog(page);
  await clickTwice(page, opener);
  await page.waitForTimeout(100);
  await expect(dialog).toBeVisible();
  // The mailbox's Entfernen too.
  await open(page, `${WIN}&view=settings`);
  await clickTwice(page, await reveal(page, page.getByTestId('mailbox-remove')));
  await page.waitForTimeout(100);
  await expect(page.getByTestId('dialog-remove-mailbox')).toBeVisible();
  // The funnel's menu and the list of a select: the second press closes neither.
  await open(page, WIN);
  await clickTwice(page, page.getByTestId('filter'));
  await page.waitForTimeout(100);
  await expect(page.getByTestId('menu')).toBeVisible();
  await open(page, `${WIN}&view=profile`);
  await clickTwice(page, await reveal(page, page.getByTestId('profile-work-mode')));
  await page.waitForTimeout(100);
  await expect(page.getByTestId('menu')).toBeVisible();
  // Endgültig löschen in the job view of the Papierkorb.
  await open(page, WIN);
  await page.getByTestId('place-trash').click();
  await rows(page).first().click();
  await clickTwice(page, page.getByTestId('reader-purge'));
  await page.waitForTimeout(100);
  await expect(page.getByTestId('dialog-purge')).toBeVisible();
});

test('the second press of a double click puts no caret into the field that came under it', async ({
  page,
}) => {
  const caret = page.locator('input:focus, textarea:focus');
  // The add button of a list turns into its name field under the pointer.
  await open(page, `${WIN}&view=profile`);
  const add = await reveal(page, page.getByTestId('competences-add-button'));
  await clickTwice(page, add);
  await expect(page.getByTestId('competence-add').locator('input')).toBeVisible();
  await page.waitForTimeout(100);
  await expect(caret).toHaveCount(0);
  // A tile of the setup goes on to the form, whose fields lie under the pointer.
  await open(page, `${WIN}&scenario=first-run`);
  await page.getByTestId('first-next').click();
  await clickTwice(page, page.getByTestId('way-self'));
  await expect(page.getByTestId('first-step')).toHaveAttribute('data-step', 'profile');
  await page.waitForTimeout(100);
  await expect(caret).toHaveCount(0);
});

test('a real double click selects its word in the ad of a job the app opened itself', async ({
  page,
}) => {
  // The job that takes the archived one's place is read with this very click.
  await open(page, WIN);
  const next = await rows(page).nth(1).locator('.title').innerText();
  await rows(page).first().click();
  await page.getByTestId('reader-archive').click();
  const words = page.getByTestId('reader-title');
  await expect(words).toHaveText(next);
  await animationsDone(page);
  const read = (await calls(page, 'mark_read')).length;
  await clickTwice(page, words);
  expect((await selection(page)).trim()).not.toBe('');
  expect(await calls(page, 'mark_read')).toHaveLength(read + 1);
});

test('a double click beside an open menu only closes it, and on the button of a list does not open it again', async ({
  page,
}) => {
  await open(page, WIN);
  await page.getByTestId('filter').click();
  await clickTwice(page, rows(page).last());
  await page.waitForTimeout(100);
  await expect(page.getByTestId('menu')).toHaveCount(0);
  expect(await opened(page)).toEqual([]);
  await open(page, `${WIN}&view=profile`);
  const select = await reveal(page, page.getByTestId('profile-work-mode'));
  await select.click();
  await expect(page.getByTestId('menu')).toBeVisible();
  await clickTwice(page, select);
  await page.waitForTimeout(100);
  await expect(page.getByTestId('menu')).toHaveCount(0);
});

/* --------------------------------------------------------------------- a control's label */

/** The label a Field gives a control by its id. */
const labelOf = async (page: Page, control: Locator): Promise<Locator> =>
  page.locator(`label[for="${await control.getAttribute('id')}"]`);

test('a press on the name of a select opens nothing, on the name of a text field it places the caret', async ({
  page,
}) => {
  await open(page, `${WIN}&view=profile`);
  const list = page.getByTestId('menu');
  for (const id of ['profile-work-mode', 'profile-workload', 'profile-min-months']) {
    const select = await reveal(page, page.getByTestId(id));
    await (await labelOf(page, select)).click();
    await page.waitForTimeout(50);
    await expect(list, id).toHaveCount(0);
    // The name still names its button, and the button itself still opens its list.
    await expect(select).toHaveAccessibleName(await (await labelOf(page, select)).innerText());
    await select.click();
    await expect(list).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  }
  const field = await reveal(page, page.getByTestId('profile-min-rate'));
  await (await labelOf(page, field)).click();
  await expect(field).toBeFocused();
  // In Einstellungen the provider of the mailbox's form.
  await open(page, `${WIN}&view=settings`);
  await (await reveal(page, page.getByTestId('mailbox-change'))).click();
  const provider = page.getByTestId('mailbox-form').getByRole('combobox');
  await (await labelOf(page, provider)).click();
  await page.waitForTimeout(50);
  await expect(list).toHaveCount(0);
});

/* ------------------------------------------------------- the scroll keys, the focus nowhere */

/** The press leaves the focus nowhere and names no pane: the keys scroll the view's own. */
async function scrollsByKeys(page: Page, pane: Locator): Promise<void> {
  const top = (): Promise<number> => pane.evaluate((node) => node.scrollTop);
  await expect(page.locator('body')).toBeFocused();
  expect(await top()).toBe(0);
  let before = 0;
  for (const key of ['ArrowDown', 'PageDown', 'End']) {
    await page.keyboard.press(key);
    await expect.poll(top, key).toBeGreaterThan(before);
    // Its glide is over: the next key starts from where it went.
    await page.waitForTimeout(250);
    before = await top();
  }
  await page.keyboard.press('Home');
  await expect.poll(top).toBe(0);
  await expect(page.locator('body')).toBeFocused();
}

test('after a press on an entry of the sidebar the scroll keys scroll the view on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 600 });
  await open(page, WIN);
  await page.getByTestId('nav-settings').click();
  await scrollsByKeys(page, page.getByTestId('view-settings'));
  await page.getByTestId('nav-profile').click();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await scrollsByKeys(page, page.getByTestId('view-profile'));
  await open(page, `${WIN}&scenario=many`);
  await page.getByTestId('place-inbox').click();
  await scrollsByKeys(page, page.getByTestId('list-scroll'));
});

test('in one column the scroll keys scroll the job that stands in place of the list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await open(page, WIN);
  await rows(page).first().click();
  await expect(page.getByTestId('reader')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await scrollsByKeys(page, page.getByTestId('stage'));
});

test('the view on screen takes no scroll key from a field, a menu or a dialog', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1360, height: 600 });
  await open(page, `${WIN}&view=settings`);
  const pane = page.getByTestId('view-settings');
  const top = (): Promise<number> => pane.evaluate((node) => node.scrollTop);
  await page.getByTestId('nav-profile').click();
  await page.getByTestId('nav-settings').click();
  // A dialog: the page behind it stays where it is.
  await page.getByTestId('reset').evaluate((node) => (node as HTMLElement).click());
  await expect(page.getByTestId('dialog-reset')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  for (const key of ['ArrowDown', 'PageDown', 'End']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  expect(await top()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-reset')).toHaveCount(0);
  // A field: the arrows move its caret.
  await open(page, `${WIN}&view=profile`);
  const profile = page.getByTestId('view-profile');
  const field = await reveal(page, page.getByTestId('profile-min-rate'));
  await field.click();
  const at = await profile.evaluate((node) => node.scrollTop);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  await expect(field).toBeFocused();
  expect(await profile.evaluate((node) => node.scrollTop)).toBe(at);
  // A menu: the arrows move in its list, with the focus left nowhere (the list's funnel).
  await open(page, `${WIN}&scenario=many`);
  const list = page.getByTestId('list-scroll');
  await page.getByTestId('filter').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  for (const key of ['ArrowDown', 'End', 'Home', 'PageDown']) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  await expect(page.getByTestId('menu')).toBeVisible();
  expect(await list.evaluate((node) => node.scrollTop)).toBe(0);
});
