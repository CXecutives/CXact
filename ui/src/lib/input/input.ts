// Input policy: the app behaves like a native app, not like a web page.
//
// This is the only file with key, context-menu, auxiliary-button, wheel and gesture
// listeners (eslint + core/tests/ui_contract.rs). Installed once in main.ts.
//
// - controls react to the left button only: the right button never presses, focuses or
//   selects anything, and no control looks pressed under it (`data-aux-press`, see
//   auxPress). A left press beside a focused field ends its focus, also on a drag region
//   (`leaveField`). There is no browser context menu and no OS popup: the app's own menu
//   (components/Menu.svelte) appears where a native app has one: in a text field (Windows:
//   Undo | Cut, Copy, Paste, Delete | Select all; macOS: Cut, Copy, Paste | Select all;
//   each enabled by the field's state), on selected copyable text (Copy) and on an element
//   that offers its own (`contextMenu`: a job row). Everywhere else a right click does
//   nothing. The Menu key and Shift+F10 (Windows) open it at the field, the selection or
//   the focused element. While a menu is open it takes every key (arrows, Home/End, the
//   first letter, Enter and Space, Esc, Tab closes), and a press outside, the window's
//   blur, resizing or a scroll outside it closes it; the left press that closes it does
//   nothing else, nor does a second click after it. A menu names no keys.
// - the middle button scrolls: pressed over a scroll area it starts the autoscroll of the
//   OS (WebView2 on Windows; macOS has none); anywhere else it does nothing; a middle
//   click never activates anything (no auxclick, no press, no new window, no focus: the
//   focus its default moves comes back unseen, `keepFocus`). The back and forward
//   buttons of the mouse go back and forward only where a view offers a way (`onBack`,
//   `onForward`: Zurück and Vor), and neither ever navigates the web view.
// - the wheel only scrolls, the area under the pointer: no field, switch or choice takes it.
//   Over an open menu only the menu scrolls; behind a modal dialog nothing scrolls. The one
//   non-passive wheel listener is attached only while it has to hold the wheel (Ctrl/Cmd
//   held, a menu or a modal dialog open), so plain scrolling never waits for the page.
// - what is on its way off the screen (`data-locked`: a job's view until the next job has loaded)
//   takes no press and no key's press, with no look of its own, which would flicker for that
//   moment.
// - a double click does nothing (in text that copies it selects a word, like everywhere;
//   an element that offers `doubleClick` handles it: a job row opens its ad). Its second press
//   counts only on what the first pressed: on what the first click slid under the pointer (the
//   next row, a dialog's scrim, the select under a list) it presses nothing and a menu the
//   first click opened stays open (`pressesElsewhere`).
// - the name of a text field leads into it; the name of a button (a select) only names it
//   (`namesButton`)
// - no dragging of text, links or images (only the column handle and the window's drag
//   regions move)
// - text is selectable only in fields and where a user would copy it (`data-copy`: the ad
//   text, job title and facts, profile values, paths); Ctrl/Cmd+C copies such a selection,
//   and a drag that selects goes on over the controls as over the text (`textDrag`)
// - only the keys of the OS (user decision: the app has no shortcuts of its own): Tab and
//   Shift+Tab move the focus (a disabled control is passed, like a native one), Space
//   presses the focused button, switch or radio, Enter a button only, once for a held key; in
//   a radio group (the segments) and a row of tabs the arrows, Home and End choose; on a select
//   the arrows open its list (`selectKeys`). Inside a field every
//   character the keyboard layout types (AltGr on Windows, Option on macOS: @ is Option+L
//   on a German Mac) and the editing keys of the OS (word and line moves, delete word,
//   Shift selection, Ctrl/Cmd+C/V/X/A/Z, redo) work. Enter saves and Esc cancels a form or
//   dialog (with the focus nowhere the form pressed last). PageUp and PageDown scroll the pane
//   that has the focus (or the one clicked last, else the view's own, `data-key-pane`) by a page,
//   and with the focus nowhere (on no control, `isNowhere`) the arrows scroll that pane by a line
//   and Home/End to its top and end, like a native scroll view. Key scrolling glides in one
//   short tween (lib/motion/scroll.ts), never the engine's smooth scroll. Everything else,
//   including every WebView shortcut (reload, find, print, zoom, devtools, caret browsing,
//   Alt+Arrow back/forward), is swallowed.
// - a modal dialog holds the focus: Tab cycles inside it, Esc cancels it wherever the
//   focus is. Esc closes only the layer on top: a tooltip's bubble the user asked for (a click on
//   an info symbol, the keyboard's focus on its anchor; one under a passing pointer only goes along
//   with the key), the menu, then the dialog, then the sidebar that floats over the view in a
//   narrow window, whose button then takes the focus it held (`foldSidebar`); a left press beside
//   that sidebar (and beside its button, which folds it itself) folds it too, and still does what
//   it presses, and so does the keyboard's focus going on into the view (`onFocusIn`).
// - an × never puts a caret anywhere (`removeBy`): a click on it drops the focus; from the
//   keyboard (Enter, Space, Backspace or Delete on a focused ×) the next × of the same list takes
//   it, the previous one after the last. Backspace in a chip field removes the last chip and the
//   caret stays there, as in any field (owner, 2026-11-01).
// - OS window and menu functions stay: Alt+F4 and Cmd+Q/W/M/H/, (Settings), Cmd+Option+H.
// - no Ctrl/Cmd+wheel zoom and no pinch zoom
// - no hover flicker while a list scrolls (`data-rests` and `data-still`, see onScroll)
// - a row that slides under a pointer that did not move is not hovered by it: after a row's
//   tool took its row away, the next row shows its tools only once the pointer moves
//   (`hover`, `holdHover` of hold.ts); a press on a tooltip's anchor holds the same way, so
//   the button that takes the place of the one pressed shows no tooltip until the pointer moves
// - a tooltip's bubble goes on a press anywhere, a scroll of any pane and Esc (`onDismiss`)
// - what leaving a field does waits for the press that left it to land, and a window going to
//   the back leaves nothing (`afterPress`)

import type { Action } from 'svelte/action';
import { t } from '../i18n/t';
import { onMenuUndo } from '../ipc/api';
import { noteKey } from '../motion/pace';
import { glideBy, glideTo } from '../motion/scroll';
import { keyConventions, type KeyConventions } from '../platform';
import {
  chooseEntry,
  closeMenu,
  firstEnabled,
  isItem,
  menuState,
  onMenuOpened,
  openMenu,
  type MenuEntry,
} from '../state/menu.svelte';
import { shell } from '../state/shell.svelte';
import { tokenMs, tokenPx } from '../tokens';
import { copyOut, fieldMenu } from './fieldMenu';
import { pointerMoved } from './hold';

const FIELD = 'input, textarea, [contenteditable="true"], [contenteditable=""]';
/** Text a user would copy (selectable, Ctrl/Cmd+C). */
const COPY = '[data-copy]';
/** An open modal dialog: it holds the focus. */
const MODAL = '[aria-modal="true"]';
const FORM = '[data-form-keys]';
/** Controls that Space presses. */
const PRESSABLE = 'button, [role="button"], [role="switch"], [role="radio"]';
/** Controls that Enter presses: buttons only. A switch, a radio or a checkbox toggles with
 *  Space, like the native ones; Enter there goes on to the form (its default action). */
const ENTER_PRESSES =
  'button:not([role="switch"], [role="radio"], [role="checkbox"]), [role="button"]';
/** Controls a press does not focus: in the sidebar, the list's header and the job view's rows
 *  of buttons (`data-press-only`), like the toolbar of Mail and Finder. */
const PRESS_ONLY = '[data-press-only] :is(button, [role="button"], [role="tab"], [role="radio"])';
/** Buttons inside a field (show password, clear search): a press leaves the focus there. */
const KEEP_FOCUS = '[data-keep-focus]';
/** A field's own box: the free part of a tag field, the strip around a button in a field. */
const FIELD_BOX = '[data-field-box]';
/** What holds the focus and is no control, no caret and no ring: a form's root, a step's
 *  heading, the mailbox form's box. Every control that leaves the Tab order is a button. */
const FOCUS_HOLDER = '[tabindex="-1"]:not(button)';
/** What is on its way off the screen: no control in it is pressed. */
const LOCKED = '[data-locked]';
/** The sidebar floating over the view (App.svelte), its button in the top bar and the views. */
const FLOATING = '[data-peek]';
const SIDEBAR_BUTTON = '[data-testid="toggle-sidebar"]';
const VIEWS = 'main';
const FOCUSABLE = [
  'button:not([tabindex="-1"])',
  'input:not([tabindex="-1"])',
  'textarea:not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const CLIPBOARD_KEYS = new Set(['c', 'v', 'x', 'a', 'z']);
/** Caret moves and deletes native fields do with Ctrl (Windows) or Cmd (macOS), with or
 *  without Shift: by word, to the line or text start and end, delete a word or line. */
const EDITING_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Backspace',
  'Delete',
  'Insert',
]);
/** macOS text fields: Ctrl+A/E line start and end, B/F/N/P caret, D/H/K delete. */
const CONTROL_EDIT_KEYS = new Set(['a', 'e', 'b', 'f', 'n', 'p', 'd', 'h', 'k']);
const LEFT = 0;
const MIDDLE = 1;
/** How far a left press may move and still be a click, no drag over the text of a control. */
const CLICK_SLOP = 4;
/** Back and forward (buttons 3 and 4). */
const BACK = 3;
const FORWARD = 4;
/** The Cmd shortcuts of the macOS menu (Quit, Close, Minimize, Hide, Settings). WKWebView
 *  hands a key equivalent to the menu only if the page lets it through. Matched by the
 *  character, like macOS matches key equivalents (Cmd+Q stays Q on AZERTY). */
const MAC_MENU_KEYS = new Set(['q', 'w', 'm', 'h', ',']);

/** The nearest match from `target` up (a text node - the target of selectstart - counts
 *  as its parent element). */
function closest(target: EventTarget | null, selector: string): Element | null {
  const element = target instanceof Text ? target.parentElement : target;
  return element instanceof Element ? element.closest(selector) : null;
}

const inField = (target: EventTarget | null): boolean => closest(target, FIELD) !== null;
const selectable = (target: EventTarget | null): boolean =>
  inField(target) || closest(target, COPY) !== null;

/** Ctrl, Alt or Cmd (Shift alone makes no shortcut). */
const hasModifier = (event: KeyboardEvent): boolean =>
  event.ctrlKey || event.altKey || event.metaKey;

/** What dismisses a bubble that stands over the page: a press, a scroll, Esc. */
export type Dismissal = 'press' | 'scroll' | 'escape';

const dismissals = new Set<(cause: Dismissal, target: EventTarget | null) => boolean>();

/**
 * `onDismiss(handler)`: the tooltip's bubble (components/Tooltip.svelte) goes on a press
 * anywhere (with what was pressed), a scroll of any pane and Esc, like the tooltips of a native
 * app. `true` from the handler: that bubble was the layer on top, and Esc goes no further. Returns
 * the unsubscribe function.
 */
export function onDismiss(
  handler: (cause: Dismissal, target: EventTarget | null) => boolean,
): () => void {
  dismissals.add(handler);
  return () => dismissals.delete(handler);
}

/** `true` if what stood there takes the key alone. */
function dismiss(cause: Dismissal, target: EventTarget | null = null): boolean {
  let alone = false;
  for (const handler of dismissals) alone = handler(cause, target) || alone;
  return alone;
}

/** Ctrl/Cmd+C over a selection of copyable text. */
function isCopy(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'c') {
    return false;
  }
  return hasSelection();
}

/** Selected text (outside fields only copyable text can be selected). */
function hasSelection(): boolean {
  const selection = getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== '';
}

/** An element between `target` and the page that scrolls (the middle button scrolls it). A
 *  fixed layer (a dialog's backdrop, a toast, a tooltip) never scrolls with its DOM parent. */
function inScrollArea(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrollsY = /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollsX = /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) return true;
    if (style.position === 'fixed') return false;
  }
  return false;
}

/** The middle button scrolls here: over a scroll area, and while a modal dialog is open only
 *  inside it (the page behind it stays where it is). */
function middleScrolls(target: EventTarget | null): boolean {
  const modal = topModal();
  if (modal !== null && !(target instanceof Node && modal.contains(target))) return false;
  return inScrollArea(target);
}

function isWindowShortcut(event: KeyboardEvent): boolean {
  if (event.altKey && event.key === 'F4') return true;
  // Windows: Alt+Space opens the window's system menu (a cancelled key never reaches it).
  const plainAlt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if (plainAlt && event.code === 'Space' && keyConventions().systemMenuKey) return true;
  if (!event.metaKey || event.ctrlKey) return false;
  // Hide Others (Cmd+Option+H): Option changes the character, so the key itself counts.
  if (event.altKey) return event.code === 'KeyH';
  return MAC_MENU_KEYS.has(event.key.toLowerCase());
}

/** One printed character that no shortcut reports (a shortcut reports its plain letter or
 *  digit): @, €, {, |, ~, ą and so on. */
function isTypedCharacter(key: string): boolean {
  return [...key].length === 1 && !/^[a-z0-9]$/i.test(key);
}

/** A key typed with AltGr (Windows, where Ctrl+Alt works as AltGr too) or with Option
 *  (macOS: characters, dead keys, Option+Arrow and Option+Backspace by word). */
function typesWithAltGraph(event: KeyboardEvent, os: KeyConventions): boolean {
  if (event.getModifierState('AltGraph')) return true;
  if (os.optionTypes) return event.altKey && !event.ctrlKey && !event.metaKey;
  return event.ctrlKey && event.altKey && !event.metaKey && isTypedCharacter(event.key);
}

/** Shift+F10 alone or the Menu key: the context menu (Windows; a Mac keyboard has neither). */
function isContextMenuKey(event: KeyboardEvent): boolean {
  if (!keyConventions().contextMenuKey || event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

function allowedInField(event: KeyboardEvent): boolean {
  if (isContextMenuKey(event)) return true;
  // Function keys (F1-F12) reach the WebView (reload, caret browsing, devtools).
  if (/^F\d{1,2}$/.test(event.key)) return false;
  const os = keyConventions();
  if (typesWithAltGraph(event, os)) return true;
  // A plain Alt is the menu key on Windows, and Alt+Arrow navigates back and forward.
  if (event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return true;
  if (event.ctrlKey && event.metaKey) return false;
  const key = event.key.toLowerCase();
  // Copy, paste, cut, select all, undo; with Shift, Z redoes.
  if (CLIPBOARD_KEYS.has(key)) return true;
  if (event[os.command] && EDITING_KEYS.has(event.key)) return true;
  if (os.redoWithY && event.ctrlKey && key === 'y') return true;
  return os.controlEdits && event.ctrlKey && CONTROL_EDIT_KEYS.has(key);
}

export interface FormKeyHandlers {
  /** Enter inside a single-line field (or on the dialog itself: its default button). */
  save?: () => void;
  /** Esc anywhere inside the form. */
  cancel?: () => void;
}

const forms = new WeakMap<Element, FormKeyHandlers>();

/**
 * Enter = save, Esc = cancel for a form or dialog. No listener of its own: the one
 * keydown handler below dispatches to the nearest registered form that handles the key
 * (a search field that clears on Esc may sit inside a form that cancels on Esc).
 */
export const formKeys: Action<HTMLElement, FormKeyHandlers> = (node, handlers) => {
  forms.set(node, handlers);
  node.dataset.formKeys = '';
  return {
    update(next: FormKeyHandlers) {
      forms.set(node, next);
    },
    destroy() {
      forms.delete(node);
      delete node.dataset.formKeys;
    },
  };
};

function handlerFor(target: EventTarget | null, key: keyof FormKeyHandlers): (() => void) | null {
  for (let form = closest(target, FORM); form !== null; form = closest(form.parentElement, FORM)) {
    const handler = forms.get(form)?.[key];
    if (handler) return handler;
  }
  return null;
}

/** Enter and Esc for the nearest form that handles them; `true` if one did. */
function dispatchFormKey(event: KeyboardEvent, target: EventTarget | null = event.target): boolean {
  if (event.isComposing || hasModifier(event)) return false;
  let handler: (() => void) | null = null;
  if (event.key === 'Escape') {
    handler = handlerFor(target, 'cancel');
  } else if (event.key === 'Enter') {
    // Enter on a button presses that button; in a text area it starts a new line.
    if (closest(target, 'textarea') !== null || pressedByEnter(target)) {
      return false;
    }
    handler = handlerFor(target, 'save');
  }
  if (handler === null) return false;
  event.preventDefault();
  handler();
  return true;
}

/** The arrows, Home and End with the focus nowhere scroll the pane around what holds the focus,
 *  the pane clicked last or the view's own (the reader, Einstellungen, Profil), like a native
 *  scroll view. `true` if a pane took the key. */
function scrollsLine(event: KeyboardEvent): boolean {
  if (hasModifier(event) || event.shiftKey || !isNowhere(event.target)) return false;
  const pane = keyPane(event.target);
  return pane !== null && scrollByKey(pane, event.key);
}

/** ArrowUp/ArrowDown scroll `pane` by a line, Home/End to its top or end (one short glide
 *  each, lib/motion/scroll.ts). */
function scrollByKey(pane: HTMLElement, key: string): boolean {
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    glideBy(pane, (key === 'ArrowDown' ? 1 : -1) * tokenPx('--scroll-line'));
    return true;
  }
  if (key === 'Home' || key === 'End') {
    glideTo(pane, key === 'End' ? pane.scrollHeight : 0);
    return true;
  }
  return false;
}

/** The focus is on no control: on the page (a click on plain text leaves it there) or on what
 *  only holds it for the keys of a form (Enter and Esc reach the form from there). */
function isNowhere(target: EventTarget | null): boolean {
  if (target === document.body || target === document.documentElement) return true;
  return target instanceof Element && target.matches(FOCUS_HOLDER);
}

/** The arrows inside a radio group (the segments) or a row of tabs: the previous or the next
 *  option takes the focus and is chosen, wrapping at the ends, like native radio buttons and
 *  tabs; Home and End choose the first and the last. A row of tabs goes left and right only.
 *  The group is one Tab stop (only the chosen option has tabindex 0). `true` if the group
 *  took the key. */
function dispatchRadioKey(event: KeyboardEvent): boolean {
  if (hasModifier(event) || event.shiftKey) return false;
  const option = closest(event.target, '[role="radio"], [role="tab"]');
  const role = option?.getAttribute('role') ?? null;
  const group =
    option?.closest(role === 'tab' ? '[role="tablist"]' : '[role="radiogroup"]') ?? null;
  const tabs = role === 'tab';
  const step =
    event.key === 'ArrowRight' || (!tabs && event.key === 'ArrowDown')
      ? 1
      : event.key === 'ArrowLeft' || (!tabs && event.key === 'ArrowUp')
        ? -1
        : 0;
  const edge = event.key === 'Home' ? 0 : event.key === 'End' ? -1 : null;
  if ((step === 0 && edge === null) || option === null || group === null) return false;
  const options = [...group.querySelectorAll<HTMLElement>(`[role="${role}"]`)].filter(
    (node) => node.getAttribute('aria-disabled') !== 'true' && !node.matches(':disabled'),
  );
  const at = options.indexOf(option as HTMLElement);
  const next =
    edge === null ? options[(at + step + options.length) % options.length] : options.at(edge);
  event.preventDefault();
  if (next === undefined || next === option) return true;
  next.focus();
  next.click();
  return true;
}

const SELECTS = '[data-select-keys]';
const selects = new WeakMap<Element, () => void>();

/**
 * The button of a select (components/Select.svelte): ArrowDown and ArrowUp (with Alt too)
 * open its list, like a popup button of the OS; Enter and Space press it like any button,
 * which opens it as well. While the list is open the menu takes every key (dispatchMenuKey).
 */
export const selectKeys: Action<HTMLElement, () => void> = (node, open) => {
  selects.set(node, open);
  node.dataset.selectKeys = '';
  return {
    update(next: () => void) {
      selects.set(node, next);
    },
    destroy() {
      selects.delete(node);
      delete node.dataset.selectKeys;
    },
  };
};

/** The arrows on a select's button open its list; `true` if one did. */
function dispatchSelectKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  const node = closest(event.target, SELECTS);
  const open = node === null ? undefined : selects.get(node);
  if (open === undefined) return false;
  event.preventDefault();
  open();
  return true;
}

const isFocusMove = (event: KeyboardEvent): boolean => event.key === 'Tab' && !hasModifier(event);

/** The focused control is a button that Enter presses (not a switch or a radio). */
function pressedByEnter(target: EventTarget | null): boolean {
  const control = closest(target, PRESSABLE);
  return control !== null && control.matches(ENTER_PRESSES);
}

/** Space presses the focused button, switch or radio, Enter only a button (the engine
 *  clicks it). */
const pressesControl = (event: KeyboardEvent): boolean =>
  !hasModifier(event) &&
  ((event.key === ' ' && closest(event.target, PRESSABLE) !== null) ||
    (event.key === 'Enter' && pressedByEnter(event.target)));

/** The engine clicks a native button on its key. What is a button by its role only (a link
 *  that selects like text, components/TextLink.svelte) is clicked here. A held key presses once:
 *  its repeats press nothing further (a held Enter would run through a list). */
function pressByRole(event: KeyboardEvent): void {
  if (event.repeat) event.preventDefault();
  const control = closest(event.target, PRESSABLE);
  if (control instanceof HTMLButtonElement || !(control instanceof HTMLElement)) return;
  event.preventDefault();
  if (!event.repeat) control.click();
}

/** The open modal dialog on top, if any. */
function topModal(): HTMLElement | null {
  const open = document.querySelectorAll<HTMLElement>(MODAL);
  return open.item(open.length - 1);
}

/** Cancels every modal dialog that stands open, as Esc would (a question that something more
 *  urgent overrules: the window's close). A dialog that is busy keeps standing. */
export function cancelDialogs(): void {
  for (const modal of document.querySelectorAll<HTMLElement>(MODAL)) {
    forms.get(modal)?.cancel?.();
  }
}

/** The controls Tab visits inside `root`, in order: a disabled one and one out of sight are
 *  passed. */
function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.matches(':disabled') && node.getClientRects().length > 0,
  );
}

/**
 * Tab on the last control goes to the first and Shift+Tab on the first to the last, like the
 * controls of a native window: the focus never leaves for the page itself, where it would
 * rest on nothing for one press. `true` if it wrapped (the key is then taken).
 */
function wrapFocus(back: boolean): boolean {
  const items = tabbables(document);
  const active = document.activeElement;
  if (items.length === 0 || active !== items[back ? 0 : items.length - 1]) return false;
  items[back ? items.length - 1 : 0]?.focus();
  return true;
}

/** Tab and Shift+Tab cycle through the controls of the modal and never leave it. */
function cycleFocus(modal: HTMLElement, back: boolean): void {
  const items = tabbables(modal);
  if (items.length === 0) {
    modal.focus();
    return;
  }
  const active = document.activeElement;
  const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const step = back ? -1 : 1;
  const next =
    at === -1 ? (back ? items.length - 1 : 0) : (at + step + items.length) % items.length;
  items[next]?.focus();
}

export interface ChipKeyHandlers {
  /** Enter: turn the typed text into chips; `true` if there was text. */
  commit: () => boolean;
  /** Backspace in an empty field: remove the last chip; `true` if one went. */
  removeLast: () => boolean;
  /** Esc: drop the typed text; `true` if there was some. */
  clear: () => boolean;
  /** ArrowDown/ArrowUp: move the highlight of the field's suggestions; `true` if it moved. */
  step?: (by: -1 | 1) => boolean;
}

const CHIPS = '[data-chip-keys]';
const chipFields = new WeakMap<Element, ChipKeyHandlers>();
/** A chip of a chip field, with its index (`data-chip`). */
const CHIP = '[data-chip]';

/**
 * The keys of a chip field (components/ChipInput.svelte): Enter adds, Backspace in the empty
 * field removes the last chip, Esc drops the typed text. What a chip field does not use
 * goes on to the form (Enter on an empty chip field saves it). A field with a list under it
 * wraps its handlers in `withList`.
 */
export const chipKeys: Action<HTMLElement, ChipKeyHandlers> = (node, handlers) => {
  chipFields.set(node, handlers);
  node.dataset.chipKeys = '';
  return {
    update(next: ChipKeyHandlers) {
      chipFields.set(node, next);
    },
    destroy() {
      chipFields.delete(node);
      delete node.dataset.chipKeys;
    },
  };
};

/**
 * A list under a field (its suggestions or its options, components/Suggestions.svelte) with
 * one mark, read live (getters): the arrows move the mark through the rows, wrapping, and
 * with `none` past the ends to no mark (the typed text stays what Enter takes); Enter takes
 * the marked row, Esc closes the list. While no row shows, the keys go on to `field`.
 */
export interface MarkedList {
  /** The rows shown (0: no list). */
  readonly count: number;
  /** The marked row, -1 for none. */
  readonly mark: number;
  /** The arrows may leave every row unmarked. */
  readonly none: boolean;
  setMark: (index: number) => void;
  take: (index: number) => void;
  close: () => void;
}

/** The mark after an arrow: the next row, wrapping (with `none` through no mark). */
function nextMark(mark: number, by: -1 | 1, count: number, none: boolean): number {
  if (none) {
    const next = mark + by;
    return next < -1 ? count - 1 : next >= count ? -1 : next;
  }
  if (mark < 0) return by > 0 ? 0 : count - 1;
  return (mark + by + count) % count;
}

/** The keys of a field with a list under it, the field's own `field` while no row shows. */
export function withList(list: MarkedList, field: ChipKeyHandlers): ChipKeyHandlers {
  return {
    commit: () => {
      if (list.count === 0 || list.mark < 0) return field.commit();
      list.take(list.mark);
      return true;
    },
    removeLast: () => field.removeLast(),
    clear: () => {
      if (list.count === 0) return field.clear();
      list.close();
      return true;
    },
    step: (by) => {
      if (list.count === 0) return field.step?.(by) ?? false;
      list.setMark(nextMark(list.mark, by, list.count, list.none));
      return true;
    },
  };
}

function dispatchChipKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const field = closest(event.target, CHIPS);
  const handlers = field === null ? undefined : chipFields.get(field);
  if (handlers === undefined) return false;
  const handled =
    event.key === 'Enter'
      ? handlers.commit()
      : event.key === 'Backspace'
        ? handlers.removeLast()
        : event.key === 'Escape'
          ? handlers.clear()
          : event.key === 'ArrowDown'
            ? (handlers.step?.(1) ?? false)
            : event.key === 'ArrowUp'
              ? (handlers.step?.(-1) ?? false)
              : false;
  if (handled) event.preventDefault();
  return handled;
}

/** The focus moves by the keyboard (Tab, the arrows, a key that opens something) until the
 *  next press of a mouse button. */
let keyboardFocus = false;

/** The keyboard moves the focus now: what held it hands it on when it goes; a click moves none. */
export const byKeyboard = (): boolean => keyboardFocus;

/** The sidebar floating over the view folds by the keyboard: the focus it held goes to its button
 *  (with the sidebar away the button stands for it, as in `focusPlace`), never to the page. */
export function foldSidebar(): void {
  if (keyboardFocus && closest(document.activeElement, FLOATING) !== null) {
    document.querySelector<HTMLElement>(SIDEBAR_BUTTON)?.focus();
  }
  shell.fold();
}

/** A list whose items a button removes: the chips of a chip field, the rows of the
 *  competences and the languages, the notes of values that do not read. */
const REMOVE_LIST = '[data-removes]';
/** A remove button of such a list, or the slot that holds it. */
const REMOVE = '[data-remove]';
/** Where the keyboard's focus goes once a list has no remove button left (its add button, or
 *  the slot that holds it). */
const REMOVE_FALLBACK = '[data-remove-fallback]';

/** The button a remove slot holds (or the slot itself when it is the button). */
const buttonIn = (slot: Element): HTMLElement | null =>
  slot.matches('button') ? (slot as HTMLElement) : slot.querySelector<HTMLElement>('button');

/** The remove buttons of `list` in order, not those of a list inside it. */
function removeButtons(list: Element): Element[] {
  return [...list.querySelectorAll(REMOVE)].filter((slot) => slot.closest(REMOVE_LIST) === list);
}

/**
 * The one rule of a remove button (a chip's, a row's, a value's): `remove` takes its item away,
 * and no caret appears anywhere. Removed with the mouse, the focus is simply dropped, without a
 * ring: the button's own, or the caret a press on a chip's × left in its field. Removed with the
 * keyboard (Enter, Space, Backspace or Delete on a focused ×), the next remove button of the same
 * list (`data-removes`) takes the focus, the previous one after the last, else the list's
 * `data-remove-fallback` (its add button); never a text field. It moves there before the item
 * goes, so it never drops to the page on the way (a chip field keeps its chips open). With none
 * of them the focus stays where it was.
 */
export function removeBy(button: EventTarget | null, remove: () => void): void {
  const slot = closest(button, REMOVE);
  const list = slot?.closest(REMOVE_LIST) ?? null;
  if (!keyboardFocus) {
    remove();
    const active = document.activeElement;
    if (active instanceof HTMLElement && (inField(active) || list?.contains(active) === true)) {
      active.blur();
    }
    return;
  }
  const slots = list === null ? [] : removeButtons(list);
  const at = slot === null ? -1 : slots.indexOf(slot);
  const next =
    at === -1 ? null : (slots[at + 1] ?? slots[at - 1] ?? list?.querySelector(REMOVE_FALLBACK));
  if (next) buttonIn(next)?.focus();
  remove();
}

/** Backspace or Delete on the focused × of a chip presses it (it removes the chip, like
 *  Backspace in its field removes the last one); `true` if it did. The × is the chip's
 *  remove button, or the button inside the slot that holds it (a filter chip). */
function removesByKey(event: KeyboardEvent): boolean {
  if (hasModifier(event) || event.shiftKey) return false;
  if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return false;
  if (target.closest(REMOVE) === null || target.closest(CHIP) === null) return false;
  event.preventDefault();
  target.click();
  return true;
}

/**
 * A control the keyboard focuses stays clear of its scroll area's edges with its ring and a
 * gap (--space-8), below a sticky band too (the area's scroll-padding). The engines scroll a
 * focused control only until it touches the edge, and WebKit ignores scroll-margin there.
 */
function keepInView(node: HTMLElement): void {
  const pane = scrollAreaOf(node.parentElement);
  if (pane === null || !node.isConnected) return;
  const clear = tokenPx('--space-8');
  const style = getComputedStyle(pane);
  const view = pane.getBoundingClientRect();
  const top = view.top + pane.clientTop + (Number.parseFloat(style.scrollPaddingTop) || 0);
  const bottom =
    view.top +
    pane.clientTop +
    pane.clientHeight -
    (Number.parseFloat(style.scrollPaddingBottom) || 0);
  const box = node.getBoundingClientRect();
  const above = top - (box.top - clear);
  const below = box.bottom + clear - bottom;
  if (above > 0) pane.scrollTop -= above;
  else if (below > 0) pane.scrollTop += Math.min(below, box.top - clear - top);
}

function onFocusIn(event: FocusEvent): void {
  const node = event.target;
  // A modal dialog takes the focus when it opens: from then on the wheel is held for it
  // (onWheel).
  if (closest(node, MODAL) !== null) watchWheel('modal', true);
  // The floating sidebar would lie over what holds the focus now: it folds as for a press beside
  // it. Not for the top bar, whose buttons the Tab order crosses on the way to its entries.
  if (keyboardFocus && shell.peek && closest(node, VIEWS) !== null) shell.fold();
  // What only holds the focus is no control, and may be taller than the area.
  if (!keyboardFocus || !(node instanceof HTMLElement) || isNowhere(node)) return;
  // After the engine's own scroll into view.
  requestAnimationFrame(() => keepInView(node));
}

function onKeyDown(event: KeyboardEvent): void {
  keyboardFocus = true;
  // A held key is fast browsing: an open meanwhile plays no motion (lib/motion/pace).
  noteKey(event.repeat);
  if (event.key === 'Escape' && dismiss('escape')) {
    event.preventDefault();
    return;
  }
  if (menuState.open !== null) {
    dispatchMenuKey(event);
    return;
  }
  if (event.ctrlKey || event.metaKey) guardZoom(true);
  if (isWindowShortcut(event)) return;
  const modal = topModal();
  if (modal === null && event.key === 'Escape' && shell.peek) {
    event.preventDefault();
    foldSidebar();
    return;
  }
  if (modal !== null) {
    if (isFocusMove(event)) {
      event.preventDefault();
      cycleFocus(modal, event.shiftKey);
      return;
    }
    if (!(event.target instanceof Node) || !modal.contains(event.target)) {
      // The focus is behind the dialog: Esc and Enter still answer the dialog.
      dispatchFormKey(event, modal);
      event.preventDefault();
      return;
    }
  }
  if (modal === null && isFocusMove(event) && wrapFocus(event.shiftKey)) {
    event.preventDefault();
    return;
  }
  if (isCopy(event)) return;
  // Shift+F10 and the Menu key (Windows) open the app's menu at the field, the selected
  // copyable text or the focused element; the page opens it, not the engine.
  if (isContextMenuKey(event)) {
    event.preventDefault();
    openMenuByKey(event.target);
    return;
  }
  if (inField(event.target)) {
    if (event.isComposing) return;
    if (!allowedInField(event)) {
      event.preventDefault();
      return;
    }
    if (dispatchChipKey(event)) return;
    dispatchFormKey(event);
    return;
  }
  if (isFocusMove(event)) return;
  if (pressesControl(event)) {
    pressByRole(event);
    return;
  }
  if (dispatchRadioKey(event) || dispatchSelectKey(event)) return;
  if (removesByKey(event)) return;
  if (selectsAll(event)) return;
  // Everything else is the app's or nothing: never a shortcut of the web view (reload,
  // find, print, zoom, history).
  event.preventDefault();
  if (modal === null && scrollsPage(event)) return;
  if (dispatchFormKey(event)) return;
  if (isNowhere(event.target) && lastForm?.isConnected && dispatchFormKey(event, lastForm)) return;
  if (modal === null) scrollsLine(event);
}

/** The scroll area the user clicked in last (the page keys scroll it while the focus is
 *  nowhere, e.g. after a click on the ad's text). */
let lastPane: HTMLElement | null = null;
/** The form the user pressed in last (null: the last press was elsewhere): with the focus
 *  nowhere Enter and Esc go to it. A press on plain text focuses nothing, and in WebKit a press
 *  on a button neither (a Verbinden begun by its button stays stoppable by Esc). */
let lastForm: Element | null = null;
/** The copyable block the user pressed last (null: the last press was elsewhere). */
let lastCopy: Element | null = null;
/** Where the last left press went down. */
let pressedAt: { x: number; y: number } | null = null;
/** The left button is held since a press in selectable text. */
let pressedInText = false;
/** What the first press of a click went down on (null: it closed a menu, it pressed nothing). */
let firstPress: Element | null = null;

/** The control a press lands on, not the words or the glyph in it; else the element itself. */
const pressedOn = (target: EventTarget | null): Element | null =>
  closest(target, `${PRESSABLE}, ${FIELD}`) ?? closest(target, '*');

/**
 * The second press of a double click that lands on anything but what the first one pressed:
 * what the first click did slid it under the pointer, and it was never meant. It presses
 * nothing, so every control is safe from it without a check of its own. Two presses on one row
 * or one word are a real double click, and a control's own check (Button) keeps those apart.
 */
const pressesElsewhere = (event: MouseEvent): boolean =>
  event.button === LEFT &&
  event.detail > 1 &&
  (firstPress?.isConnected !== true || pressedOn(event.target) !== firstPress);

/** The pointer moved further from the last left press than a click may. */
const movedFromPress = (event: MouseEvent): boolean =>
  pressedAt !== null &&
  Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > CLICK_SLOP;

/**
 * The click that ends a drag: the pointer moved from its press to its release (a drag over
 * the text of a control, the contact's e-mail, selects the text and is no click on the
 * control). A keyboard's click has no press.
 */
export const wasDragged = (event: MouseEvent): boolean =>
  event.detail !== 0 && movedFromPress(event);

/**
 * A press in selectable text that drags selects text, and nothing else: while it does, :root
 * carries `data-text-drag` and the controls give the pointer through (base.css). So none looks
 * hovered, and none stands in the selection's way: over a control before the text in the DOM
 * (the job's tools float before its title) the engines would take it back to the text's start.
 */
function textDrag(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.textDrag = '';
  else if (root.dataset.textDrag !== undefined) delete root.dataset.textDrag;
}

/** The left button let go, also where the release itself never came. */
function endTextPress(): void {
  pressedInText = false;
  textDrag(false);
}

/**
 * Ctrl/Cmd+A beside a field selects the copyable block pressed last (the ad's text, an alert
 * mail) whole, like Select All in a document; with none pressed it does nothing, the page is
 * never selected. `true` if the key was for it.
 */
function selectsAll(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey || !event[keyConventions().command]) return false;
  if (event.key.toLowerCase() !== 'a') return false;
  event.preventDefault();
  if (lastCopy?.isConnected) getSelection()?.selectAllChildren(lastCopy);
  return true;
}
/** A page is this much of the pane (a line of the last page stays in view). */
const PAGE_SHARE = 0.9;

function scrollAreaOf(target: EventTarget | null): HTMLElement | null {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (/auto|scroll/.test(overflow) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** The panes of the view on screen (App's view, the Jobs view's list and job). */
const VIEW_PANE = '[data-key-pane]';

/** The pane the page keys scroll: the one around the focus, with the focus nowhere else the one
 *  clicked last that still scrolls, else the first of the view on screen that does. A menu and a
 *  dialog have taken their keys before, a field keeps its own. */
function keyPane(target: EventTarget | null): HTMLElement | null {
  const around = scrollAreaOf(target);
  if (around !== null || !isNowhere(target)) return around;
  for (const pane of [lastPane, ...document.querySelectorAll(VIEW_PANE)]) {
    const area = scrollAreaOf(pane);
    if (area !== null) return area;
  }
  return null;
}

/** PageUp and PageDown: the focused (or last clicked) pane scrolls a page. */
function scrollsPage(event: KeyboardEvent): boolean {
  if (hasModifier(event)) return false;
  const down = event.key === 'PageDown';
  if (!down && event.key !== 'PageUp') return false;
  const pane = keyPane(event.target);
  if (pane === null) return false;
  glideBy(pane, (down ? 1 : -1) * Math.round(pane.clientHeight * PAGE_SHARE));
  return true;
}

/**
 * Edit > Undo of the macOS menu bar (platform.rs: the item sends `menu-undo`): the field's
 * own undo, like Cmd+Z in it; nothing outside a field or while a menu or a dialog is open.
 */
function undoFromMenu(): void {
  if (menuState.open !== null) return;
  if (inField(document.activeElement)) document.execCommand('undo');
}

/** The ways back and forward of the views (Zurück and Vor); the newest first. */
const backs: (() => boolean)[] = [];
const forwards: (() => boolean)[] = [];

function subscribe(ways: (() => boolean)[], handler: () => boolean): () => void {
  ways.push(handler);
  return () => {
    const at = ways.indexOf(handler);
    if (at !== -1) ways.splice(at, 1);
  };
}

/**
 * `onBack(handler)`: the mouse's back button runs the newest handler that has a way back (it
 * returns `true` when it went back), like the Zurück of the view. Without one it does
 * nothing; it never navigates the web view. Returns the unsubscribe function.
 */
export const onBack = (handler: () => boolean): (() => void) => subscribe(backs, handler);

/** `onForward(handler)`: the same for the mouse's forward button, like the Vor of the top bar. */
export const onForward = (handler: () => boolean): (() => void) => subscribe(forwards, handler);

/** Go back or forward where a view offers it (never behind a menu or a dialog); `true` if it
 *  did. */
function go(ways: readonly (() => boolean)[]): boolean {
  if (menuState.open !== null || topModal() !== null) return false;
  return [...ways].reverse().some((way) => way());
}

const prevent = (event: Event): void => event.preventDefault();

/** Copyable text under the pointer that is part of the current selection. */
function selectedCopy(target: EventTarget | null): boolean {
  const copy = closest(target, COPY);
  const selection = getSelection();
  if (copy === null || selection === null || selection.isCollapsed) return false;
  return selection.toString().trim() !== '' && selection.containsNode(copy, true);
}

/** What an element offers on a right click (a job row: open, archive, ...). */
export interface ContextMenu {
  label: string;
  entries: readonly MenuEntry[];
  /** Called once the menu has closed (a job row keeps its tools while its menu is open). */
  onclose?: () => void;
}

const MENU_HOST = '[data-context-menu]';
const MENU_LAYER = '[data-menu-layer]';
const menuHosts = new WeakMap<Element, () => ContextMenu | null>();

/**
 * `use:contextMenu={() => ({ label, entries })}`: a right click on the element (or the Menu
 * key while it is the open item of a list) opens the app's menu with these entries; null
 * offers none. No listener of its own.
 */
export const contextMenu: Action<HTMLElement, (() => ContextMenu | null) | null> = (
  node,
  offer,
) => {
  const set = (next: (() => ContextMenu | null) | null): void => {
    if (next === null) {
      menuHosts.delete(node);
      delete node.dataset.contextMenu;
    } else {
      menuHosts.set(node, next);
      node.dataset.contextMenu = '';
    }
  };
  set(offer);
  return {
    update: set,
    destroy: () => menuHosts.delete(node),
  };
};

const DOUBLE_HOST = '[data-double-click]';
const doubleHosts = new WeakMap<Element, () => void>();

/**
 * `use:doubleClick={() => ...}`: a double click with the left button on the element runs it
 * (a job row opens its ad); null offers none. No listener of its own: the one dblclick
 * handler below calls it.
 */
export const doubleClick: Action<HTMLElement, (() => void) | null> = (node, handler) => {
  const set = (next: (() => void) | null): void => {
    if (next === null) {
      doubleHosts.delete(node);
      delete node.dataset.doubleClick;
    } else {
      doubleHosts.set(node, next);
      node.dataset.doubleClick = '';
    }
  };
  set(handler);
  return {
    update: set,
    destroy: () => doubleHosts.delete(node),
  };
};

/** A left double click on an element that offers one (`doubleClick`); `true` if it ran. */
function runDouble(event: MouseEvent): boolean {
  if (event.button !== LEFT) return false;
  const host = closest(event.target, DOUBLE_HOST);
  const handler = host === null ? undefined : doubleHosts.get(host);
  if (handler === undefined) return false;
  handler();
  return true;
}

/**
 * `use:hover={(here) => ...}`: says when the mouse comes onto the element (`here` true) and
 * when it leaves it again (false); moves between its own children do not count. After
 * `holdHover` (hold.ts) an element the pointer did not move onto waits for the pointer to
 * move. Touch never hovers.
 */
export const hover: Action<HTMLElement, (here: boolean) => void> = (node, callback) => {
  let current = callback;
  let here = false;
  const enter = (event: PointerEvent): void => {
    if (here || event.pointerType === 'touch' || !pointerMoved(event)) return;
    here = true;
    current(true);
  };
  const leave = (): void => {
    if (!here) return;
    here = false;
    current(false);
  };
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointermove', enter, { passive: true });
  node.addEventListener('pointerleave', leave);
  return {
    update(next: (here: boolean) => void) {
      current = next;
    },
    destroy() {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointermove', enter);
      node.removeEventListener('pointerleave', leave);
    },
  };
};

/** Open the menu of `host` at the pointer, or below the element itself from the keyboard. */
function openHostMenu(host: Element, at: { x: number; y: number } | null): void {
  const offer = menuHosts.get(host)?.() ?? null;
  if (offer === null || offer.entries.length === 0) {
    offer?.onclose?.();
    return;
  }
  openMenu({
    entries: offer.entries,
    label: offer.label,
    ...(offer.onclose ? { onclose: offer.onclose } : {}),
    anchor:
      at === null
        ? { kind: 'below', rect: host.getBoundingClientRect(), align: 'start' }
        : { kind: 'point', ...at },
    fromKeyboard: at === null,
  });
}

/** The right click: the app's menu in fields, on selected copyable text and on elements that
 *  offer one, else nothing. From the keyboard (the Menu key, Shift+F10: no button) the menu
 *  opens below the field or the focused element, not at the pointer. */
function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  if (closest(event.target, MENU_LAYER) !== null) return;
  const modal = topModal();
  if (modal !== null && !(event.target instanceof Node && modal.contains(event.target))) return;
  // The engines send the menu key's event without a button (-1).
  const keyboard = event.button === -1;
  const at = keyboard ? null : { x: event.clientX, y: event.clientY };
  const field = closest(event.target, 'input, textarea');
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    openMenu({
      entries: fieldMenu(field),
      label: t.edit.menu,
      anchor:
        at === null
          ? { kind: 'below', rect: field.getBoundingClientRect(), align: 'start' }
          : { kind: 'point', ...at },
      fromKeyboard: keyboard,
    });
    return;
  }
  const selection = getSelection();
  if (selectedCopy(event.target) && selection !== null) {
    const text = selection.toString();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const box = range?.getBoundingClientRect() ?? null;
    openMenu({
      entries: [
        {
          id: 'copy',
          label: t.edit.copy,
          icon: 'copy',
          run: () => copyOut(text),
        },
      ],
      label: t.edit.menu,
      anchor:
        at !== null
          ? { kind: 'point', ...at }
          : box !== null
            ? { kind: 'below', rect: box, align: 'start' }
            : { kind: 'point', x: 0, y: 0 },
      fromKeyboard: keyboard,
    });
    return;
  }
  const host = closest(event.target, MENU_HOST);
  if (host !== null) openHostMenu(host, at);
}

/** Shift+F10 or the Menu key: the menu of the focused field, of the selected copyable text
 *  or of the focused element that offers one, below it (every engine alike, none opens its
 *  own). */
function openMenuByKey(target: EventTarget | null): void {
  const field = closest(target, 'input, textarea');
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    openMenu({
      entries: fieldMenu(field),
      label: t.edit.menu,
      anchor: { kind: 'below', rect: field.getBoundingClientRect(), align: 'start' },
      fromKeyboard: true,
    });
    return;
  }
  const selection = getSelection();
  const copy = selection?.anchorNode ? closest(selection.anchorNode, COPY) : null;
  if (selection !== null && copy !== null && selection.toString().trim() !== '') {
    const text = selection.toString();
    openMenu({
      entries: [
        {
          id: 'copy',
          label: t.edit.copy,
          icon: 'copy',
          run: () => copyOut(text),
        },
      ],
      label: t.edit.menu,
      anchor: {
        kind: 'below',
        rect: selection.getRangeAt(0).getBoundingClientRect(),
        align: 'start',
      },
      fromKeyboard: true,
    });
    return;
  }
  const host = closest(target, MENU_HOST);
  if (host !== null) openHostMenu(host, null);
}

/** Letters typed quickly one after the other pick the entry that starts with them; a menu that
 *  closed takes them along. */
let typed = '';
let typedAt = 0;
const TYPE_AHEAD_MS = 700;

/** The keys of an open menu: it takes every key while it is open. */
function dispatchMenuKey(event: KeyboardEvent): void {
  const open = menuState.open;
  if (open === null) return;
  const entries = open.entries;
  const move = (from: number, step: 1 | -1): void => {
    const next = firstEnabled(entries, from, step);
    if (next !== -1) menuState.active = next;
  };
  // Window shortcuts (Alt+F4, the macOS menu keys) still reach the OS.
  if (isWindowShortcut(event)) {
    closeMenu(false);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  switch (event.key) {
    case 'ArrowDown':
      move(menuState.active < 0 ? 0 : menuState.active + 1, 1);
      return;
    case 'ArrowUp':
      move(menuState.active < 0 ? entries.length - 1 : menuState.active - 1, -1);
      return;
    case 'Home':
      move(0, 1);
      return;
    case 'End':
      move(entries.length - 1, -1);
      return;
    case 'Enter':
    case ' ':
      if (menuState.active >= 0) chooseEntry(menuState.active);
      return;
    case 'Escape':
    case 'Tab':
    case 'ContextMenu':
    case 'Alt':
      closeMenu();
      return;
    default:
      break;
  }
  if (event.key.length !== 1 || hasModifier(event)) return;
  const now = event.timeStamp;
  const letter = event.key.toLowerCase();
  typed = now - typedAt < TYPE_AHEAD_MS ? typed + letter : letter;
  typedAt = now;
  const hit = entries.findIndex(
    (entry) =>
      isItem(entry) && entry.disabled !== true && entry.label.toLowerCase().startsWith(typed),
  );
  if (hit !== -1) menuState.active = hit;
}

/** A press outside the open menu closes it; a left one does nothing else (like the OS: the
 *  click that dismisses a menu never reaches what lies under it; `true`), a right one opens
 *  the menu of what it lands on. The second press of a double click closes nothing: what its
 *  first click opened stays open. */
function pressOutsideMenu(event: MouseEvent): boolean {
  if (menuState.open === null || closest(event.target, MENU_LAYER) !== null) return false;
  const left = event.button === LEFT;
  if (left && event.detail > 1) return false;
  closeMenu();
  return left;
}

/**
 * The wheel only scrolls, and only what it should. A wheel listener that may cancel is not
 * passive, and a page-wide one makes every scroll wait for the main thread, so it is
 * attached only while it has something to hold (`watchWheel`): Ctrl or Cmd is held
 * (Ctrl/Cmd+wheel would zoom; WebView2 turns its zoom off natively as well), a menu is open
 * (only the menu scrolls under the pointer, never the page behind it at the menu's ends)
 * or a modal dialog is open (only the dialog's own scroll areas scroll). Once none of it
 * holds any more, the next wheel event takes the listener off again.
 */
function onWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    return;
  }
  watchWheel('zoom', false);
  if (menuState.open !== null) {
    holdMenuWheel(event);
    return;
  }
  watchWheel('menu', false);
  const modal = topModal();
  if (modal !== null) {
    if (!scrollsInside(event, modal)) event.preventDefault();
    return;
  }
  watchWheel('modal', false);
}

type WheelReason = 'zoom' | 'menu' | 'modal';
const wheelReasons = new Set<WheelReason>();

function watchWheel(reason: WheelReason, on: boolean): void {
  const before = wheelReasons.size > 0;
  if (on) wheelReasons.add(reason);
  else wheelReasons.delete(reason);
  const after = wheelReasons.size > 0;
  if (before === after) return;
  if (after) document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  else document.removeEventListener('wheel', onWheel, { capture: true });
}

function guardZoom(on: boolean): void {
  watchWheel('zoom', on);
}

/** `node` scrolls further in the direction of the wheel (down or up, right or left). */
function scrollsToward(node: Element, event: WheelEvent): boolean {
  const style = getComputedStyle(node);
  if (event.deltaY !== 0 && /auto|scroll/.test(style.overflowY)) {
    const room = node.scrollHeight - node.clientHeight;
    if (event.deltaY > 0 ? node.scrollTop < room - 1 : node.scrollTop > 0) return true;
  }
  if (event.deltaX !== 0 && /auto|scroll/.test(style.overflowX)) {
    const room = node.scrollWidth - node.clientWidth;
    if (event.deltaX > 0 ? node.scrollLeft < room - 1 : node.scrollLeft > 0) return true;
  }
  return false;
}

/** The wheel over `layer` moves one of its own scroll areas (never anything behind it). */
function scrollsInside(event: WheelEvent, layer: Element): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !layer.contains(target)) return false;
  for (let node: Element | null = target; node !== null; node = node.parentElement) {
    if (scrollsToward(node, event)) return true;
    if (node === layer) break;
  }
  return false;
}

/** An open menu: the wheel over it scrolls only the menu. A wheel outside it is the user
 *  scrolling the page, which closes the menu; a scroll the app makes itself (the list keeping
 *  the open row in view) leaves it open. A press on a scrollbar closes it as any press outside. */
function holdMenuWheel(event: WheelEvent): void {
  const layer = closest(event.target, MENU_LAYER);
  if (layer === null) {
    closeMenu(false);
    return;
  }
  if (!scrollsInside(event, layer)) event.preventDefault();
}

/**
 * Hover stays still while a list scrolls: from the first scroll event until --scroll-idle
 * after the last one, an element marked `data-rests` (a list row) that is under the pointer,
 * or that the pointer meets while the content moves under it, carries `data-still`, and its
 * hover rules wait for `:not([data-still])`. Only the rows the pointer passes change: one
 * mark on :root restyled every row of a long list at the start and at the end of each
 * scroll (a long task with a few hundred rows). Passive listeners: they never delay a
 * scroll.
 */
let scrollIdle: ReturnType<typeof setTimeout> | undefined;
/** --scroll-idle, read once: reading a token inside the handler would force a style
 *  recalculation on every scroll event. */
let scrollIdleMs: number | null = null;
let scrolling = false;
/** The element under the pointer (the last `pointerover`); null once it left the window. */
let underPointer: Element | null = null;
/** The elements that rest until the scroll is over. */
const resting = new Set<HTMLElement>();
const RESTS = '[data-rests]';

/** Every element that rests while a list scrolls, from `target` outwards. */
function rest(target: Element | null): void {
  let node = target?.closest<HTMLElement>(RESTS) ?? null;
  while (node !== null) {
    if (!resting.has(node)) {
      node.dataset.still = '';
      resting.add(node);
    }
    node = node.parentElement?.closest<HTMLElement>(RESTS) ?? null;
  }
}

function scrollOver(): void {
  scrolling = false;
  for (const node of resting) delete node.dataset.still;
  resting.clear();
}

function onScroll(): void {
  dismiss('scroll');
  scrollIdleMs ??= tokenMs('--scroll-idle');
  if (!scrolling) {
    scrolling = true;
    rest(underPointer);
  }
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(scrollOver, scrollIdleMs);
}

function onPointerOver(event: PointerEvent): void {
  underPointer = event.target instanceof Element ? event.target : null;
  if (scrolling) rest(underPointer);
}

function onPointerOut(event: PointerEvent): void {
  if (event.relatedTarget === null) underPointer = null;
}

/** A middle press over a scroll area moved the focus and it is on its way back: no focus
 *  event reaches the page meanwhile (`keepFocus`). */
let holdingFocus = false;

/**
 * The middle button keeps its default over a scroll area (the autoscroll needs it), but a
 * press must not focus the control or the field under the pointer: after the default action
 * the focus goes back to where it was. Both engines move the focus on that default (onto a
 * chip's x, a day of the calendar, or off a field), so until it is back no focus event
 * reaches the page (`holdFocusEvents`): a chip field does not take its typed text as a chip,
 * the calendar does not close, a field does not judge its value.
 */
function keepFocus(): void {
  const before = document.activeElement;
  holdingFocus = true;
  setTimeout(() => {
    const now = document.activeElement;
    if (now !== before && now instanceof HTMLElement) {
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) {
        before.focus({ preventScroll: true });
      } else {
        now.blur();
      }
    }
    holdingFocus = false;
  }, 0);
}

/** The focus events of an element while a middle press's focus is on its way back (the
 *  window's own blur still counts). */
function holdFocusEvents(event: FocusEvent): void {
  if (holdingFocus && event.target !== window) event.stopImmediatePropagation();
}

/**
 * The pressed look belongs to the left button. Both engines set `:active` (and Chromium
 * `:hover`) for any button in the hit test of the press, before a listener could cancel it,
 * and Chromium sets it again with the context menu after a right release. So while another
 * button is down, and until the pointer moves after it, :root carries `data-aux-press` and
 * every pressed rule waits for `:root:not([data-aux-press])` (core/tests/ui_contract.rs). A left
 * press that presses nothing (it closes a menu, or a second press elsewhere) carries it too.
 */
function auxPress(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.auxPress = '';
  else if (root.dataset.auxPress !== undefined) delete root.dataset.auxPress;
}

/** Buttons other than the left one (the `buttons` bit mask without bit 0). */
const otherButtonsDown = (event: MouseEvent): boolean => (event.buttons & ~1) !== 0;

/** A press on a scroller's own scrollbar (Windows): it never takes the focus from a field. */
function onScrollbar(event: MouseEvent): boolean {
  const node = event.target;
  if (!(node instanceof HTMLElement) || node.clientWidth === 0) return false;
  const scrolls = node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth;
  // offsetX/Y count from the padding edge; the bar lies beyond the client box.
  return scrolls && (event.offsetX >= node.clientWidth || event.offsetY >= node.clientHeight);
}

/**
 * A left press beside the focused field ends its focus, like a click on the empty part of a
 * native window. The engine does that by itself only where the press keeps its default: a
 * drag region (the window's top bar) cancels it. The field stays focused for a press inside it
 * or its box (a chip's words, the clear button: the press gives up its default, which would take
 * the focus and start a selection there), on a button that keeps the caret (`data-keep-focus`),
 * on its own label, and on a scrollbar.
 */
function leaveField(event: MouseEvent): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !inField(field) || inField(event.target)) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target === null || closest(target, KEEP_FOCUS) !== null || onScrollbar(event)) return;
  if (field.closest(FIELD_BOX)?.contains(target) === true) {
    event.preventDefault();
    return;
  }
  const label = target.closest('label');
  if (label !== null && label.control === field) return;
  field.blur();
}

/** The name of a button (a select in a Field): it names it and presses nothing, like the caption
 *  of a native popup and every name beside a switch; a text field's name still leads into it. */
function namesButton(target: EventTarget | null): boolean {
  const label = closest(target, 'label');
  return label instanceof HTMLLabelElement && label.control instanceof HTMLButtonElement;
}

/** A left press on a field's own box is a press on the field: the caret goes in or stays. It
 *  stays a mouse press like any other, so it closes a menu and ends a selection as they do. */
function pressOnFieldBox(event: MouseEvent): boolean {
  const box = event.target;
  if (!(box instanceof Element) || !box.matches(FIELD_BOX)) return false;
  const input = box.querySelector('input') ?? box.parentElement?.querySelector('input');
  if (!input) return false;
  event.preventDefault();
  input.focus();
  return true;
}

/** What waits for the left press under way to land (`afterPress`); null: no press is down. */
let pressWaits: (() => void)[] | null = null;

/**
 * What leaving `field` does (a fold, a message, a chip that takes a line) moves rows, and rows
 * moved between press and release take the click from the control pressed. So `run` waits for
 * the left press that left the field, until its click comes (ahead of the control's handler) or
 * right after its release; without a press it runs at once. It does not run when `field` holds
 * the focus by then: a window going to the back leaves it there, nothing was left.
 */
export function afterPress(field: EventTarget | null, run: () => void): void {
  const left = (): void => {
    if (document.activeElement !== field) run();
  };
  if (pressWaits === null) left();
  else pressWaits.push(left);
}

/** The press has landed: what waited for it comes, in its order. */
function pressLanded(): void {
  if (pressWaits === null) return;
  const waiting = pressWaits;
  pressWaits = null;
  for (const run of waiting) run();
}

let installed = false;

export function installInput(): void {
  if (installed) return;
  installed = true;
  const capture = { capture: true } as const;
  // A press that presses nothing (it closes a menu, or it is a second press elsewhere): its
  // click and its double click go too, no control looks pressed under it.
  let swallow = false;
  const endSwallow = (): void => {
    swallow = false;
    auxPress(false);
  };

  // A menu starts without the letters typed in the last one, and from the moment it opens the
  // wheel is held for it (onWheel).
  onMenuOpened(() => {
    typed = '';
    watchWheel('menu', true);
  });
  document.addEventListener('contextmenu', onContextMenu, capture);
  document.addEventListener(
    'mousedown',
    (event) => {
      keyboardFocus = false;
      if (event.button === LEFT) {
        pressLanded();
        pressWaits = [];
      }
      dismiss('press', event.target);
      if (pressesElsewhere(event) || pressOutsideMenu(event)) {
        firstPress = null;
        swallow = true;
        auxPress(true);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.button === LEFT) {
        if (event.detail <= 1) firstPress = pressedOn(event.target);
        if (!otherButtonsDown(event)) auxPress(false);
        if (shell.peek && closest(event.target, `${FLOATING}, ${SIDEBAR_BUTTON}`) === null) {
          shell.fold();
        }
        lastPane = scrollAreaOf(event.target);
        lastForm = closest(event.target, FORM);
        lastCopy = closest(event.target, COPY);
        pressedAt = { x: event.clientX, y: event.clientY };
        pressedInText = selectable(event.target);
        // A button inside a field (show password, clear) leaves the caret in the field.
        const keepsFocus = closest(event.target, KEEP_FOCUS) !== null;
        // A press beside the selected text ends the selection, like in a native text view
        // (copyable text starts a new one; the app's menu with its Copy needs it, and a press
        // on a scrollbar is no press on the text's view). The caret a field keeps is the
        // page's selection too: taken away, Chromium reveals it on the release, the view jumps
        // and the click misses, and WebKit reads the field's caret at its start.
        if (
          !selectable(event.target) &&
          closest(event.target, MENU_LAYER) === null &&
          !onScrollbar(event) &&
          !(keepsFocus && inField(document.activeElement))
        ) {
          getSelection()?.removeAllRanges();
        }
        if (keepsFocus) {
          event.preventDefault();
        } else if (!pressOnFieldBox(event)) {
          leaveField(event);
          // What holds only buttons (the sidebar, the list's header, the job view's rows of
          // buttons) is pressed, not focused, like the toolbar of Mail and Finder on both OS.
          if (closest(event.target, PRESS_ONLY) !== null) event.preventDefault();
        }
        return;
      }
      auxPress(true);
      // The middle button starts the autoscroll over a scroll area; nothing else gets it. The
      // engine runs it (Windows; macOS has none) until the next press or key and keeps that
      // press or key to itself: only the release reaches the page, and no click. So the press
      // that ends it presses nothing, and nothing is left to end here.
      if (event.button === MIDDLE && middleScrolls(event.target)) {
        keepFocus();
        return;
      }
      event.preventDefault();
    },
    capture,
  );
  // Back/forward buttons: Chromium navigates on their release. Back goes back where a view
  // has a way back (`onBack`), forward does nothing.
  document.addEventListener(
    'mouseup',
    (event) => {
      if (event.button === LEFT) {
        endTextPress();
        setTimeout(pressLanded, 0);
      }
      if (event.button >= BACK) {
        event.preventDefault();
        if (event.button === BACK) go(backs);
        else if (event.button === FORWARD) go(forwards);
      }
      // A press that pressed nothing: its click (a left one) comes right after this release in
      // the same task; other buttons send none.
      if (swallow) {
        event.stopImmediatePropagation();
        if (event.button === LEFT) setTimeout(endSwallow, 0);
        else endSwallow();
      }
    },
    capture,
  );
  // The pressed look comes back once no other button is down and the pointer moved (a right
  // release in Chromium sets :active once more with the context menu, before any move).
  document.addEventListener(
    'pointermove',
    (event) => {
      // A move anywhere ends the hold on hover (hold.ts), so a pointer that left and comes
      // back to the very pixel it pressed finds the rows and the tooltips awake.
      pointerMoved(event);
      if (!otherButtonsDown(event) && !swallow) auxPress(false);
      // A release that went elsewhere (the window moved by its bar) was a release too.
      if ((event.buttons & 1) === 0) pressLanded();
      if (pressedInText) {
        if ((event.buttons & 1) === 0) endTextPress();
        else if (movedFromPress(event)) textDrag(true);
      }
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'pointercancel',
    () => {
      auxPress(false);
      endTextPress();
    },
    capture,
  );
  document.addEventListener(
    'auxclick',
    (event) => {
      if (event.button !== LEFT) event.preventDefault();
    },
    capture,
  );
  document.addEventListener('click', pressLanded, capture);
  // Some engines (WebKit) still send `click` for the middle button: it never reaches a
  // control.
  document.addEventListener(
    'click',
    (event) => {
      if (event.button === LEFT && !swallow && closest(event.target, LOCKED) === null) {
        if (namesButton(event.target)) event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    capture,
  );
  document.addEventListener(
    'dblclick',
    (event) => {
      if (swallow || runDouble(event) || !selectable(event.target)) {
        event.preventDefault();
      }
    },
    capture,
  );
  document.addEventListener('dragstart', prevent, capture);
  document.addEventListener(
    'selectstart',
    (event) => {
      if (!selectable(event.target)) event.preventDefault();
    },
    capture,
  );
  document.addEventListener('keydown', onKeyDown, capture);
  document.addEventListener('focusin', onFocusIn, { capture: true, passive: true });
  for (const type of ['focus', 'blur', 'focusin', 'focusout'] as const) {
    window.addEventListener(type, holdFocusEvents, capture);
  }
  document.addEventListener(
    'keyup',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) guardZoom(false);
    },
    capture,
  );
  window.addEventListener('blur', () => {
    pressLanded();
    guardZoom(false);
    endSwallow();
    endTextPress();
    closeMenu(false);
  });
  window.addEventListener('resize', () => closeMenu(false));
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('pointerover', onPointerOver, { capture: true, passive: true });
  document.addEventListener('pointerout', onPointerOut, { capture: true, passive: true });
  // Safari/WKWebView pinch zoom.
  document.addEventListener('gesturestart', prevent, capture);
  document.addEventListener('gesturechange', prevent, capture);
  // Edit > Undo of the macOS menu bar.
  onMenuUndo(undoFromMenu);
}

/** Attributes every text field gets (applied by the TextField component). */
export const FIELD_ATTRIBUTES = {
  spellcheck: false,
  autocorrect: 'off',
  autocapitalize: 'off',
  autocomplete: 'off',
} as const;
