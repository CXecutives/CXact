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
//   nothing. The Menu key and Shift+F10 (Windows) open it at the field or the open row.
//   While a menu is open it takes every key (arrows, Home/End, the first letter, Enter and
//   Space, Esc, Tab closes), and a press outside, the window's blur, resizing or a scroll
//   outside it closes it; the left press that closes it does nothing else.
// - the middle button scrolls: pressed over a scroll area it starts the autoscroll of the
//   OS (WebView2 on Windows; macOS has none); anywhere else it does nothing; a middle
//   click never activates anything (no auxclick, no press, no new window). The back
//   button of the mouse, Alt+Left (Windows) and Cmd+[ or Cmd+Left (macOS, outside fields)
//   go back only where a view offers a way back (`onBack`: the reader in one column);
//   forward does nothing, and neither ever navigates the web view.
// - the wheel only scrolls, the area under the pointer: no field, switch or choice takes it.
//   Over an open menu only the menu scrolls; behind a modal dialog nothing scrolls. The one
//   non-passive wheel listener is attached only while it has to hold the wheel (Ctrl/Cmd
//   held, a menu or a modal dialog open), so plain scrolling never waits for the page.
// - a double click does nothing (in text that copies it selects a word, like everywhere)
// - no dragging of text, links or images (only the column handle and the window's drag
//   regions move)
// - text is selectable only in fields and where a user would copy it (`data-copy`: the ad
//   text, job title and facts, profile values, paths); Ctrl/Cmd+C copies such a selection
// - keys like in a native window: Tab and Shift+Tab move the focus (a disabled control is
//   passed, like a native one), Space presses the focused button, switch or radio, Enter a
//   button only; in a radio group (the segments) the arrows, Home and End choose. Inside a
//   field every character the keyboard layout types (AltGr on Windows, Option on macOS: @
//   is Option+L on a German Mac) and the editing keys of the OS (word and line moves,
//   delete word, Shift selection, Ctrl/Cmd+C/V/X/A/Z, redo) work. Enter saves and Esc
//   cancels a form or dialog; Ctrl+S (Cmd+S on macOS) saves the long Profil form from
//   anywhere in it.
// - a list with a reader (the Jobs view, `listKeys`) moves like a mail app: outside a field
//   ArrowUp/ArrowDown open the previous/next item, Home/End the first/last, Shift with them
//   extends the choice of items like Explorer and Mail (`extend`), Esc closes the open item
//   (in the search field Esc first clears the search), Space on the open item's row pages
//   through the reader (`reader`), and Ctrl+F (Cmd+F on macOS) goes to its search field from
//   anywhere. After a click into the reader (the focus nowhere) the arrows scroll it by a
//   line and Home/End to its top and end, like the message of a mail app; a click in the
//   list gives them back to the list.
//   Outside fields Ctrl+Z (Cmd+Z on macOS) takes back the last list action while it can
//   still be undone (`onUndo`; the macOS menu bar's Edit > Undo does the same), and PageUp,
//   PageDown, Space and Shift+Space scroll the pane that has the focus (or the one clicked
//   last) by a page, like a native window; with the focus nowhere the arrows scroll the
//   pane clicked last by a line and Home/End to its top and end (Einstellungen, Profil).
//   Key scrolling glides in one short tween (lib/motion/scroll.ts), never the engine's
//   smooth scroll. Ctrl+/ (Cmd+/ on macOS) opens the card of the keys (`help`). Every
//   shortcut of the app is a row of lib/input/keys.ts: the dispatch below asks the table
//   which row a key is (`is`, `matched`), so the keys, the card and the tooltips agree.
//   Everything else, including every WebView shortcut (reload, find, print, zoom,
//   devtools, caret browsing, Alt+Arrow back/forward), is swallowed.
// - a modal dialog holds the focus: Tab cycles inside it, Esc cancels it wherever the
//   focus is. Esc closes only the layer on top: the menu, then the dialog, then the
//   selection.
// - OS window and menu functions stay: Alt+F4 and Cmd+Q/W/M/H/, (Settings), Cmd+Option+H.
// - no Ctrl/Cmd+wheel zoom and no pinch zoom
// - no hover flicker while a list scrolls (`data-rests` and `data-still`, see onScroll)
// - Esc outside fields and dialogs clears what is selected (`escape`: the selection of
//   several jobs), like in a mail app

import type { Action } from 'svelte/action';
import { t } from '../i18n/t';
import { clipboardText, onMenuUndo, reportUiError } from '../ipc/api';
import { glideBy, glideTo } from '../motion/scroll';
import {
  fieldMenuUndoDelete,
  hasAutoscroll,
  keyConventions,
  keyLabel,
  type KeyConventions,
} from '../platform';
import { help } from '../state/help.svelte';
import { navigation, type ViewId } from '../state/navigation.svelte';
import {
  chooseEntry,
  closeMenu,
  firstEnabled,
  isItem,
  menuState,
  openMenu,
  type MenuEntry,
} from '../state/menu.svelte';
import { tokenMs, tokenPx } from '../tokens';
import { VIEWS } from '../views';
import { combo, keysOf, matched, type ShortcutAction } from './keys';

const FIELD = 'input, textarea, [contenteditable="true"], [contenteditable=""]';
/** Text a user would copy (selectable, Ctrl/Cmd+C). */
const COPY = '[data-copy]';
const DIALOG = 'dialog, [role="dialog"], [role="alertdialog"]';
/** An open modal dialog: it holds the focus. */
const MODAL = '[aria-modal="true"]';
const FORM = '[data-form-keys]';
const LIST = '[data-list-keys]';
/** Controls that Space presses. */
const PRESSABLE = 'button, [role="button"], [role="switch"], [role="radio"]';
/** Controls that Enter presses: buttons only. A switch or a radio toggles with Space, like the
 *  native ones; Enter there goes on to the form (its default action). */
const ENTER_PRESSES = 'button:not([role="switch"], [role="radio"]), [role="button"]';
/** The sidebar and the list's header: pressed, not focused (`data-press-only`). */
const PRESS_ONLY_ZONE = '[data-press-only]';
/** Controls a press does not focus: in the sidebar and the list's header. */
const PRESS_ONLY = '[data-press-only] :is(button, [role="button"], [role="tab"], [role="radio"])';
/** Buttons inside a field (show password, clear search): a press leaves the focus there. */
const KEEP_FOCUS = '[data-keep-focus]';
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
/** How far a held middle press may move and still leave the autoscroll on (a click). */
const AUTOSCROLL_SLOP = 4;
/** Back and forward (buttons 3 and 4). */
const BACK = 3;
/** The Cmd shortcuts of the macOS menu (Quit, Close, Minimize, Hide, Settings). WKWebView
 *  hands a key equivalent to the menu only if the page lets it through. Matched by the
 *  character, like macOS matches key equivalents (Cmd+Q stays Q on AZERTY). */
const MAC_MENU_KEYS = new Set(['q', 'w', 'm', 'h', ',']);

/** The nearest match from `target` up (a text node - the target of selectstart - counts
 *  as its parent element). */
/** The first key of a shortcut of the list (the same on both OS). */
function listKey(action: ShortcutAction): string {
  return keysOf(action, keyConventions()) ?? '';
}

/** Whether `event` is a key of the shortcut `action` on this OS (lib/input/keys.ts). */
const is = (event: KeyboardEvent, action: ShortcutAction): boolean =>
  combo(event, action, keyConventions()) !== null;

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
const isContextMenuKey = (event: KeyboardEvent): boolean => is(event, 'menu');

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
  /** Ctrl+S (Cmd+S on macOS) anywhere inside the form: saves a long form also where Enter
   *  means something else (the next row of a list, a chip). A form key like Enter and Esc,
   *  not an app shortcut (docs/PLAN.md, Decisions "Keys"). */
  shortcut?: () => void;
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

/** Ctrl+S or Cmd+S (the command key of the OS), without Alt or Shift. */
const isSaveShortcut = (event: KeyboardEvent): boolean => is(event, 'save');

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

export interface ListKeyHandlers {
  /** ArrowUp (-1) / ArrowDown (1): open the previous or next item. */
  step: (by: -1 | 1) => void;
  /** Home / End: open the first or the last item. */
  edge: (last: boolean) => void;
  /** Shift+ArrowUp/ArrowDown, Shift+Home/End: the choice of items reaches one further, or
   *  to the first or the last item. */
  extend?: (to: -1 | 1 | 'first' | 'last') => void;
  /** Esc: close the open item. */
  close: () => void;
  /** Ctrl+F (Cmd+F on macOS): the search field. */
  find: () => void;
  /** The scroll area of the open item: Space and Shift+Space on the open item's row page
   *  through it, like in a mail app (pressing the row again would change nothing), and after
   *  a click into it the arrows, Home and End scroll it. */
  reader?: () => HTMLElement | null;
  /** Single keys for the open item (or the chosen ones), like a mail app (LIST_KEYS). Never
   *  in a field. */
  act?: (action: ListAction) => void;
}

/**
 * The single keys of the job list as keyLabel writes them, read from the shortcuts table
 * (lib/input/keys.ts): the job's actions and its menu name them in their hints. `del` is Entf
 * on Windows, Backspace or Delete on macOS; Enter opens a row by the row's own button (the
 * handler leaves it alone).
 */
export const LIST_KEYS = {
  open: listKey('open'),
  archive: listKey('archive'),
  trash: listKey('trash'),
  star: listKey('star'),
  openAd: listKey('openAd'),
};

export type ListAction = Exclude<keyof typeof LIST_KEYS, 'open'>;

/** The shortcuts that act on the open item of a list (the other rows of the list move in it). */
const LIST_ACTIONS: ReadonlySet<ShortcutAction> = new Set<ListAction>([
  'archive',
  'trash',
  'star',
  'openAd',
]);

/** The fetch of the app (lib/input/keys.ts: F5 or Ctrl+R on Windows, Cmd+R or F5 on macOS). */
const isFetchKey = (event: KeyboardEvent): boolean => is(event, 'fetch');

let fetchHandler: (() => void) | null = null;

/** The fetch of the app (F5, Ctrl/Cmd+R); returns the function that removes it. */
export function onFetchKey(handler: () => void): () => void {
  fetchHandler = handler;
  return () => {
    if (fetchHandler === handler) fetchHandler = null;
  };
}

const lists = new Map<HTMLElement, ListKeyHandlers>();

/**
 * The keys of a list with a reader (the Jobs view): the one keydown handler below
 * dispatches to it while the focus is inside it or nowhere (a click on plain text leaves
 * the focus on the page).
 */
export const listKeys: Action<HTMLElement, ListKeyHandlers> = (node, handlers) => {
  lists.set(node, handlers);
  node.dataset.listKeys = '';
  return {
    update(next: ListKeyHandlers) {
      lists.set(node, next);
    },
    destroy() {
      lists.delete(node);
      delete node.dataset.listKeys;
    },
  };
};

/** A registered list the user sees (a view kept underneath another one is inert). */
function shownList(): ListKeyHandlers | null {
  for (const [node, handlers] of lists) {
    if (!node.isConnected || node.closest('[inert]') !== null) continue;
    if (node.getClientRects().length === 0 || getComputedStyle(node).visibility === 'hidden') {
      continue;
    }
    return handlers;
  }
  return null;
}

/** The list the key belongs to: the one around the focus, or the shown one without a focus
 *  or with the focus on a control above it (the sidebar, the list's header). */
function listFor(target: EventTarget | null): ListKeyHandlers | null {
  const node = closest(target, LIST);
  if (node instanceof HTMLElement) return lists.get(node) ?? null;
  return isNowhere(target) || closest(target, PRESS_ONLY_ZONE) !== null ? shownList() : null;
}

/** Ctrl+F or Cmd+F (the command key of the OS), without Alt or Shift. */
const isFindShortcut = (event: KeyboardEvent): boolean => is(event, 'search');

/** The keys that move in a list, a radio group or a pane. */
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** Arrows, Home, End and Esc outside a field; `true` if a list took the key. */
function dispatchListKey(event: KeyboardEvent): boolean {
  if (event.isComposing || hasModifier(event)) return false;
  // The arrows, Home and End of a radio group in a form are the group's; above the list
  // (the tabs, the segments) left and right are.
  const option = closest(event.target, '[role="radio"], [role="tab"]');
  const rowOnly = closest(option, PRESS_ONLY_ZONE) !== null;
  if (option !== null && MOVE_KEYS.has(event.key)) {
    if (!rowOnly || event.key === 'ArrowLeft' || event.key === 'ArrowRight') return false;
  }
  const list = listFor(event.target);
  if (list === null) return false;
  const hit = matched(event, 'list', keyConventions());
  if (hit !== null && LIST_ACTIONS.has(hit.action)) {
    if (list.act === undefined) return false;
    list.act(hit.action as ListAction);
    return true;
  }
  if (hit?.action === 'extend') return extendList(list, hit.combo);
  if (event.shiftKey) return false;
  if (readsReader(event, list)) return true;
  switch (hit?.combo) {
    case 'up':
      list.step(-1);
      return true;
    case 'down':
      list.step(1);
      return true;
    case 'home':
      list.edge(false);
      return true;
    case 'end':
      list.edge(true);
      return true;
    case 'esc':
      list.close();
      return true;
    default:
      return false;
  }
}

/** Shift with ArrowUp/ArrowDown, Home or End: the list's choice reaches further. */
function extendList(list: ListKeyHandlers, keys: string): boolean {
  const to = EXTEND_TO[keys];
  if (to === undefined || list.extend === undefined) return false;
  list.extend(to);
  return true;
}

/** The combos of the row "extend" (lib/input/keys.ts) and how far each reaches. */
const EXTEND_TO: Record<string, -1 | 1 | 'first' | 'last'> = {
  'shift+up': -1,
  'shift+down': 1,
  'shift+home': 'first',
  'shift+end': 'last',
};

/**
 * The focus is nowhere and the last left press was in the list's reader (the ad's text,
 * its head): the arrows scroll it by a line and Home/End to its top and end, like the
 * message of a mail app. `true` if the reader took the key.
 */
function readsReader(event: KeyboardEvent, list: ListKeyHandlers): boolean {
  if (!isNowhere(event.target) || !MOVE_KEYS.has(event.key)) return false;
  const pane = list.reader?.() ?? null;
  if (pane === null || lastPress === null || !pane.contains(lastPress)) return false;
  // A press on one of its buttons (the star, a move) leaves the keys with the list, like a
  // toolbar button of a mail app that takes no focus.
  if (closest(lastPress, `${PRESSABLE}, a[href]`) !== null) return false;
  return scrollByKey(pane, event.key);
}

/** The arrows, Home and End with the focus nowhere scroll the pane clicked last (a view
 *  without a list: Einstellungen, Profil). `true` if a pane took the key. */
function scrollsLine(event: KeyboardEvent): boolean {
  if (hasModifier(event) || event.shiftKey || !isNowhere(event.target)) return false;
  const pane = lastPane?.isConnected ? lastPane : null;
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

/** The focus is on no control (a click on plain text leaves it on the page). */
function isNowhere(target: EventTarget | null): boolean {
  return target === document.body || target === document.documentElement;
}

/** The arrows inside a radio group (the segments): the previous or the next option takes
 *  the focus and is chosen, wrapping at the ends, like native radio buttons; Home and End
 *  choose the first and the last. The group is one Tab stop (only the chosen option has
 *  tabindex 0). `true` if the group took the key. */
function dispatchRadioKey(event: KeyboardEvent): boolean {
  if (hasModifier(event) || event.shiftKey) return false;
  const option = closest(event.target, '[role="radio"], [role="tab"]');
  const role = option?.getAttribute('role') ?? null;
  const group =
    option?.closest(role === 'tab' ? '[role="tablist"]' : '[role="radiogroup"]') ?? null;
  // Above the job list (the tabs, the segments) only left and right choose: up, down, Home
  // and End belong to the list. A group in a form takes every arrow, Home and End.
  const rowOnly = role === 'tab' || closest(option, PRESS_ONLY_ZONE) !== null;
  const step =
    event.key === 'ArrowRight' || (!rowOnly && event.key === 'ArrowDown')
      ? 1
      : event.key === 'ArrowLeft' || (!rowOnly && event.key === 'ArrowUp')
        ? -1
        : 0;
  const edge = rowOnly ? null : event.key === 'Home' ? 0 : event.key === 'End' ? -1 : null;
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

/** The open modal dialog on top, if any. */
function topModal(): HTMLElement | null {
  const open = document.querySelectorAll<HTMLElement>(MODAL);
  return open.item(open.length - 1);
}

/** Tab and Shift+Tab cycle through the controls of the modal and never leave it. */
function cycleFocus(modal: HTMLElement, back: boolean): void {
  const items = [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.matches(':disabled') && node.getClientRects().length > 0,
  );
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
  /** Ctrl/Cmd+S: turn the typed text into chips as leaving the field would. */
  settle?: () => void;
}

const CHIPS = '[data-chip-keys]';
const chipFields = new WeakMap<Element, ChipKeyHandlers>();
/** A chip of a chip field whose chips can be edited, with its index (`data-chip`). */
const CHIP = '[data-chip]';
const EDITABLE_CHIPS = '[data-chip-edit]';
const chipEdits = new WeakMap<Element, (index: number) => void>();

/**
 * A chip field whose chips a double click takes back into its text for editing
 * (components/ChipInput.svelte): the chip carries its index in `data-chip`. `null`: its
 * chips are not edited (a double click selects a word of the value, like any copyable text).
 */
export const chipEdit: Action<HTMLElement, ((index: number) => void) | null> = (node, edit) => {
  const apply = (next: ((index: number) => void) | null): void => {
    if (next === null) {
      chipEdits.delete(node);
      delete node.dataset.chipEdit;
    } else {
      chipEdits.set(node, next);
      node.dataset.chipEdit = '';
    }
  };
  apply(edit);
  return {
    update: apply,
    destroy() {
      apply(null);
    },
  };
};

/** The second press of a double click on a chip that edits: no word gets selected first
 *  (the chip's value is copyable text, and the edit puts it into the field). */
function pressesEditableChip(event: MouseEvent): boolean {
  const chip = closest(event.target, CHIP);
  return event.detail >= 2 && chip !== null && chip.closest(EDITABLE_CHIPS) !== null;
}

/** A double click with the left button on an editable chip edits it; `true` if it did. */
function editChip(event: MouseEvent): boolean {
  if (event.button !== LEFT) return false;
  const chip = closest(event.target, CHIP);
  const field = chip === null ? null : chip.closest(EDITABLE_CHIPS);
  const edit = field === null ? undefined : chipEdits.get(field);
  const index = Number(chip instanceof HTMLElement ? chip.dataset.chip : NaN);
  if (edit === undefined || !Number.isInteger(index)) return false;
  edit(index);
  return true;
}

/**
 * The keys of a chip field (components/ChipInput.svelte): Enter adds, Backspace in the empty
 * field removes the last chip, Esc drops the typed text. What a chip field does not use
 * goes on to the form (Enter on an empty chip field saves it).
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
  // A menu and a modal dialog take the focus when they open: from then on the wheel is
  // held for them (onWheel).
  if (closest(node, MENU_LAYER) !== null) watchWheel('menu', true);
  if (closest(node, MODAL) !== null) watchWheel('modal', true);
  if (!keyboardFocus || !(node instanceof HTMLElement)) return;
  // After the engine's own scroll into view.
  requestAnimationFrame(() => keepInView(node));
}

function onKeyDown(event: KeyboardEvent): void {
  keyboardFocus = true;
  if (menuState.open !== null) {
    dispatchMenuKey(event);
    return;
  }
  if (event.ctrlKey || event.metaKey) guardZoom(true);
  if (isWindowShortcut(event)) return;
  const modal = topModal();
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
  if (isCopy(event)) return;
  if (isHelpKey(event)) {
    // The card of the keys, from anywhere (a field too); the same keys close it again.
    event.preventDefault();
    if (help.open) help.hide();
    else if (modal === null) help.show();
    return;
  }
  if (!inField(event.target) && (isBackKey(event) || isForwardKey(event))) {
    // Never the web view's history: back only where a view has a way back.
    event.preventDefault();
    if (isBackKey(event)) goBack();
    return;
  }
  // Shift+F10 and the Menu key (Windows) open the app's menu at the field, the selected
  // copyable text or the open item of the list; the page opens it, not the engine.
  if (isContextMenuKey(event)) {
    event.preventDefault();
    openMenuByKey(event.target);
    return;
  }
  if (isFetchKey(event)) {
    // Never the WebView's reload: the app fetches instead (outside dialogs).
    event.preventDefault();
    if (modal === null) fetchHandler?.();
    return;
  }
  const view = viewShortcut(event);
  if (view !== null) {
    // Ctrl/Cmd+1 to 4 and (Windows) Ctrl+, choose a view from anywhere, like the sidebar.
    event.preventDefault();
    if (modal === null) navigation.go(view);
    return;
  }
  if (isFindShortcut(event)) {
    // Never the WebView's find bar; a list with a search field takes it.
    event.preventDefault();
    if (modal === null) shownList()?.find();
    return;
  }
  if (isSaveShortcut(event)) {
    // Never the WebView's "save page"; a form that saves this way gets it, with the text
    // typed into a chip field taken in first (the caret stays where it is).
    event.preventDefault();
    const field = closest(event.target, CHIPS);
    if (field !== null) chipFields.get(field)?.settle?.();
    handlerFor(event.target, 'shortcut')?.();
    return;
  }
  if (inField(event.target)) {
    if (event.isComposing) return;
    if (!allowedInField(event)) {
      event.preventDefault();
      return;
    }
    if (dispatchChipKey(event)) return;
    // Esc that no form takes (a search that is empty already) closes the list's open item.
    if (dispatchFormKey(event) || event.key !== 'Escape' || modal !== null) return;
    if (closest(event.target, LIST) !== null) dispatchListKey(event);
    return;
  }
  if (modal === null && pagesReader(event)) return;
  if (isFocusMove(event) || pressesControl(event) || dispatchRadioKey(event)) return;
  event.preventDefault();
  if (isUndo(event)) {
    if (modal === null) undoLast();
    return;
  }
  if (modal === null && scrollsPage(event)) return;
  if (closest(event.target, `${FORM}, ${DIALOG}`) !== null && dispatchFormKey(event)) return;
  if (event.key === 'Escape' && !hasModifier(event) && escapes.length > 0) {
    escapes.at(-1)?.();
    return;
  }
  // A list takes its keys first (the Jobs view), else the pane clicked last scrolls.
  if (modal === null && !dispatchListKey(event)) scrollsLine(event);
}

/** The scroll area the user clicked in last (the page keys scroll it while the focus is
 *  nowhere, e.g. after a click on the ad's text). */
let lastPane: HTMLElement | null = null;
/** What the left button pressed last (after a press in the reader its keys scroll it). */
let lastPress: Element | null = null;
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

/** PageUp, PageDown, Space, Shift+Space: the focused (or last clicked) pane scrolls a page. */
function scrollsPage(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  const down = event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey);
  const up = event.key === 'PageUp' || (event.key === ' ' && event.shiftKey);
  if (!down && !up) return false;
  const pane =
    scrollAreaOf(event.target) ??
    (isNowhere(event.target) && lastPane?.isConnected ? lastPane : null);
  if (pane === null) return false;
  scrollByPage(pane, down);
  return true;
}

function scrollByPage(pane: HTMLElement, down: boolean): void {
  glideBy(pane, (down ? 1 : -1) * Math.round(pane.clientHeight * PAGE_SHARE));
}

/** Space or Shift+Space on the open item's row: its reader scrolls a page. */
function pagesReader(event: KeyboardEvent): boolean {
  if (event.key !== ' ' || hasModifier(event)) return false;
  const row = closest(event.target, '[aria-current="true"]');
  if (row === null || closest(row, LIST) === null) return false;
  const pane = listFor(event.target)?.reader?.() ?? null;
  if (pane === null || !pane.isConnected) return false;
  event.preventDefault();
  scrollByPage(pane, !event.shiftKey);
  return true;
}

/** What Ctrl/Cmd+Z takes back outside fields (the last list action, like Mail). */
const undos: (() => boolean)[] = [];

/** `onUndo(handler)`: Ctrl+Z (Cmd+Z on macOS) outside fields and dialogs runs the newest
 *  handler that has something to undo. Returns the unsubscribe function. */
export function onUndo(handler: () => boolean): () => void {
  undos.push(handler);
  return () => {
    const at = undos.indexOf(handler);
    if (at !== -1) undos.splice(at, 1);
  };
}

/** The newest undo that has something to take back runs; `true` if one did. */
function undoLast(): boolean {
  return [...undos].reverse().some((undo) => undo());
}

/**
 * Edit > Undo of the macOS menu bar (platform.rs: the item sends `menu-undo`): in a field
 * the field's own undo, elsewhere the app's (the last list action), like Cmd+Z; nothing
 * while a menu or a dialog is open.
 */
function undoFromMenu(): void {
  if (menuState.open !== null) return;
  const active = document.activeElement;
  if (inField(active)) {
    document.execCommand('undo');
    return;
  }
  if (topModal() === null) undoLast();
}

/** The ways back of the views (the reader in one column: its "Zurück"); the newest first. */
const backs: (() => boolean)[] = [];

/**
 * `onBack(handler)`: the mouse's back button, Alt+Left (Windows) and Cmd+[ or Cmd+Left
 * (macOS) outside fields run the newest handler that has a way back (it returns `true`
 * when it went back), like the Zurück of the view. Without one they do nothing; they never
 * navigate the web view. Returns the unsubscribe function.
 */
export function onBack(handler: () => boolean): () => void {
  backs.push(handler);
  return () => {
    const at = backs.indexOf(handler);
    if (at !== -1) backs.splice(at, 1);
  };
}

/** Go back where a view offers it (never behind a menu or a dialog); `true` if it did. */
function goBack(): boolean {
  if (menuState.open !== null || topModal() !== null) return false;
  return [...backs].reverse().some((back) => back());
}

/** The back key of the OS: Alt+Left on Windows; Cmd+[ or Cmd+Left on macOS. */
const isBackKey = (event: KeyboardEvent): boolean => is(event, 'back');

/** Alt+Right (Windows), Cmd+] or Cmd+Right (macOS): forward, which the app has not. */
function isForwardKey(event: KeyboardEvent): boolean {
  if (event.shiftKey) return false;
  if (keyConventions().back === 'alt') {
    return event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowRight';
  }
  return event.metaKey && !event.ctrlKey && (event.key === ']' || event.key === 'ArrowRight');
}

/** Ctrl+/ or Cmd+/ (any layout: the key that types a slash, or the one on the number pad):
 *  the card of the keys. */
const isHelpKey = (event: KeyboardEvent): boolean => is(event, 'help');

/** Ctrl+Z or Cmd+Z (the command key of the OS), without Alt or Shift. */
const isUndo = (event: KeyboardEvent): boolean => is(event, 'undo');

/** What Esc clears outside fields and dialogs; the newest first. */
const escapes: (() => void)[] = [];

/**
 * `use:escape={clear}`: while the node is mounted, Esc outside fields and dialogs calls
 * `clear` (the selection bar: Esc clears the selection). No listener of its own.
 */
export const escape: Action<HTMLElement, () => void> = (_node, handler) => {
  let current = handler;
  const call = (): void => current();
  escapes.push(call);
  return {
    update(next: () => void) {
      current = next;
    },
    destroy() {
      escapes.splice(escapes.indexOf(call), 1);
    },
  };
};

const prevent = (event: Event): void => event.preventDefault();

/** The Delete entry of a field's menu: the selection goes, as one step of the field's undo. */
function deleteSelection(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.focus();
  // The editing command keeps the step in the field's own undo (setRangeText would not).
  if (document.execCommand('delete')) return;
  field.setRangeText('', field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Text typed in as one step of the field's undo (a paste from the menu). */
function insertText(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  if (document.execCommand('insertText', false, text)) return;
  field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Put text on the clipboard (the engine's copy first, the clipboard API when it refuses). */
function copyOut(text: string): void {
  if (document.execCommand('copy')) return;
  navigator.clipboard.writeText(text).catch((error: unknown) => {
    reportUiError(`menu copy: ${String(error)}`, null, null);
  });
}

const SEPARATOR: MenuEntry = { kind: 'separator' };

/**
 * The menu of a text field, like the OS's own, its entries enabled by the field's state.
 * Windows: Undo | Cut, Copy, Paste, Delete | Select all; macOS has no undo and no delete
 * there (platform.ts). The menu takes the focus while it is open; an entry puts it back on
 * the field with the selection it had, then acts like the key would.
 */
function fieldMenu(field: HTMLInputElement | HTMLTextAreaElement): MenuEntry[] {
  // A right click in a field that is not focused focuses it (the commands act on it).
  if (document.activeElement !== field) field.focus();
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  const back = (): void => {
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end);
  };
  const editable = !field.readOnly && !field.disabled;
  const hidden = field instanceof HTMLInputElement && field.type === 'password';
  const selected = start !== end;
  const full = fieldMenuUndoDelete();
  const undo: MenuEntry[] = full
    ? [
        {
          id: 'undo',
          label: t.edit.undo,
          icon: 'undo',
          keys: keyLabel('mod+z'),
          // The engine keeps one undo history for the page.
          disabled: !(editable && canUndo()),
          run: () => {
            back();
            document.execCommand('undo');
          },
        },
        SEPARATOR,
      ]
    : [];
  const remove: MenuEntry[] = full
    ? [
        {
          id: 'delete',
          label: t.edit.delete,
          icon: 'delete',
          keys: keyLabel('del'),
          disabled: !(editable && selected),
          run: () => {
            back();
            deleteSelection(field);
          },
        },
      ]
    : [];
  const text = field.value.slice(start, end);
  return [
    ...undo,
    {
      id: 'cut',
      label: t.edit.cut,
      icon: 'cut',
      keys: keyLabel('mod+x'),
      disabled: !(editable && selected && !hidden),
      run: () => {
        back();
        if (document.execCommand('cut')) return;
        copyOut(text);
        deleteSelection(field);
      },
    },
    {
      id: 'copy',
      label: t.edit.copy,
      icon: 'copy',
      keys: keyLabel('mod+c'),
      disabled: !(selected && !hidden),
      run: () => {
        back();
        copyOut(text);
      },
    },
    {
      id: 'paste',
      label: t.edit.paste,
      icon: 'paste',
      keys: keyLabel('mod+v'),
      disabled: !editable,
      run: () => {
        back();
        void clipboardText().then((pasted) => {
          if (pasted === null || pasted === '' || !field.isConnected) return;
          back();
          insertText(field, pasted);
        });
      },
    },
    ...remove,
    SEPARATOR,
    {
      id: 'select-all',
      label: t.edit.selectAll,
      icon: 'selectAll',
      keys: keyLabel('mod+a'),
      disabled: field.value === '',
      run: () => {
        field.focus({ preventScroll: true });
        field.select();
      },
    },
  ];
}

/** The page has an edit to take back (greys out the Undo entry otherwise, like the OS). */
function canUndo(): boolean {
  try {
    return document.queryCommandEnabled('undo');
  } catch {
    return true;
  }
}

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

/** Open the menu of `host` at the pointer, or below the element itself from the keyboard. */
function openHostMenu(host: Element, at: { x: number; y: number } | null): void {
  const offer = menuHosts.get(host)?.() ?? null;
  if (offer === null || offer.entries.length === 0) return;
  openMenu({
    entries: offer.entries,
    label: offer.label,
    anchor:
      at === null
        ? { kind: 'below', rect: host.getBoundingClientRect(), align: 'start' }
        : { kind: 'point', ...at },
    fromKeyboard: at === null,
  });
}

/** The open item of the shown list (its row carries aria-current), for the Menu key. */
function openItem(): Element | null {
  const list = document.querySelector(LIST);
  return list?.querySelector(`${MENU_HOST}[aria-current="true"]`) ?? null;
}

/** The right click: the app's menu in fields, on selected copyable text and on elements that
 *  offer one, else nothing. From the keyboard (the Menu key, Shift+F10: no button) the menu
 *  opens below the field or the element, not at the pointer. */
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
          keys: keyLabel('mod+c'),
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
  const host = closest(event.target, MENU_HOST) ?? (keyboard ? openItem() : null);
  if (host !== null) openHostMenu(host, at);
}

/** Shift+F10 or the Menu key: the menu of the focused field, of the selected copyable text
 *  or of the open item of the list, below it (every engine alike, none opens its own). */
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
          keys: keyLabel('mod+c'),
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
  const host = closest(target, MENU_HOST) ?? openItem();
  if (host !== null) openHostMenu(host, null);
}

/** Ctrl/Cmd+1 to 4: the views in the sidebar's order (lib/views.ts); Ctrl+, the settings on
 *  Windows (the macOS menu has Cmd+, itself). Digits by their place, so every layout works. */
function viewShortcut(event: KeyboardEvent): ViewId | null {
  const os = keyConventions();
  const view = VIEWS.find((each) => combo(event, 'views', os) === each.keys);
  if (view !== undefined) return view.id;
  return is(event, 'settings') ? 'settings' : null;
}

/** Letters typed quickly one after the other pick the entry that starts with them. */
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
 *  click that dismisses a menu never reaches what lies under it), a right one opens the
 *  menu of what it lands on. */
function pressOutsideMenu(event: MouseEvent): boolean {
  if (menuState.open === null || closest(event.target, MENU_LAYER) !== null) return false;
  closeMenu();
  if (event.button === LEFT) {
    event.preventDefault();
    return true;
  }
  return false;
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
  if (closest(event.target, MENU_LAYER) === null) {
    closeMenu(false);
    return;
  }
  const menu = closest(event.target, '[role="menu"]');
  if (menu !== null && !scrollsInside(event, menu)) event.preventDefault();
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

/**
 * The middle button keeps its default over a scroll area (the autoscroll needs it), but a
 * press must not focus the control or the field under the pointer: after the default action
 * the focus goes back to where it was.
 */
function keepFocus(): void {
  const before = document.activeElement;
  setTimeout(() => {
    const now = document.activeElement;
    if (now === before || !(now instanceof HTMLElement)) return;
    now.blur();
    if (before instanceof HTMLElement && before !== document.body) before.focus();
  }, 0);
}

/**
 * The pressed look belongs to the left button. Both engines set `:active` (and Chromium
 * `:hover`) for any button in the hit test of the press, before a listener could cancel it,
 * and Chromium sets it again with the context menu after a right release. So while another
 * button is down, and until the pointer moves after it, :root carries `data-aux-press` and
 * every pressed rule waits for `:root:not([data-aux-press])` (core/tests/ui_contract.rs).
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
 * drag region (the title bar, the toolbar row) cancels it. The field stays focused for a
 * press inside it or its box (the chips, the clear button), on a button that keeps the caret
 * (`data-keep-focus`), on its own label, and on a scrollbar.
 */
function leaveField(event: MouseEvent): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !inField(field) || inField(event.target)) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target === null || closest(target, KEEP_FOCUS) !== null || onScrollbar(event)) return;
  const box = field instanceof HTMLTextAreaElement ? field : (field.parentElement ?? field);
  if (box.contains(target)) return;
  const label = target.closest('label');
  if (label !== null && label.control === field) return;
  field.blur();
}

let installed = false;

export function installInput(): void {
  if (installed) return;
  installed = true;
  const capture = { capture: true } as const;
  // The OS autoscroll a middle click starts (it runs until the next press): that press ends
  // it and nothing else, whichever button it is and wherever it lands, like Windows' own
  // scrolling. A middle press dragged and released scrolled while held and left no mode.
  let autoscroll = false;
  let swallow = false;
  let middleAt = { x: 0, y: 0 };
  const endSwallow = (): void => {
    swallow = false;
    auxPress(false);
  };

  document.addEventListener('contextmenu', onContextMenu, capture);
  document.addEventListener(
    'mousedown',
    (event) => {
      keyboardFocus = false;
      if (pressOutsideMenu(event)) {
        swallow = true;
        return;
      }
      if (autoscroll) {
        autoscroll = false;
        swallow = true;
        auxPress(true);
        event.preventDefault();
        return;
      }
      if (event.button === LEFT) {
        if (!otherButtonsDown(event)) auxPress(false);
        lastPane = scrollAreaOf(event.target);
        lastPress = event.target instanceof Element ? event.target : null;
        // A button inside a field (show password, clear) leaves the caret in the field.
        if (closest(event.target, KEEP_FOCUS) !== null || pressesEditableChip(event)) {
          event.preventDefault();
        } else {
          leaveField(event);
          // The sidebar and the list's header are pressed, not focused (like Mail and Finder
          // on both OS): the list keeps its keys after a click there.
          if (closest(event.target, PRESS_ONLY) !== null) event.preventDefault();
        }
        return;
      }
      auxPress(true);
      // The middle button starts the autoscroll over a scroll area; nothing else gets it.
      if (event.button === MIDDLE && middleScrolls(event.target)) {
        middleAt = { x: event.clientX, y: event.clientY };
        autoscroll = hasAutoscroll();
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
      if (event.button >= BACK) {
        event.preventDefault();
        if (event.button === BACK) goBack();
      }
      // Dragged with the middle button held: it scrolled while held, no mode is left.
      if (event.button === MIDDLE && autoscroll) {
        const moved = Math.hypot(event.clientX - middleAt.x, event.clientY - middleAt.y);
        if (moved > AUTOSCROLL_SLOP) autoscroll = false;
      }
      // Chromium ends its autoscroll with the next press and keeps that press to itself: only
      // the release arrives, and nothing is left to end.
      if (autoscroll && event.button !== MIDDLE) autoscroll = false;
      // The press that ended the autoscroll: its click (a left one) comes right after this
      // release in the same task; other buttons send none.
      if (swallow) {
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
      if (!otherButtonsDown(event) && !swallow) auxPress(false);
    },
    { capture: true, passive: true },
  );
  document.addEventListener('pointercancel', () => auxPress(false), capture);
  document.addEventListener('keydown', () => (autoscroll = false), capture);
  window.addEventListener('blur', () => (autoscroll = false));
  document.addEventListener(
    'auxclick',
    (event) => {
      if (event.button !== LEFT) event.preventDefault();
    },
    capture,
  );
  // Some engines (WebKit) still send `click` for the middle button: it never reaches a
  // control.
  document.addEventListener(
    'click',
    (event) => {
      if (swallow) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.button === LEFT) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    capture,
  );
  document.addEventListener(
    'dblclick',
    (event) => {
      if (editChip(event) || !selectable(event.target)) event.preventDefault();
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
  document.addEventListener(
    'keyup',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) guardZoom(false);
    },
    capture,
  );
  window.addEventListener('blur', () => {
    guardZoom(false);
    auxPress(false);
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
