// The app's own menus: one menu at a time, drawn by components/Menu.svelte in the app layer.
// A right click (lib/input/input.ts), a menu button (the list's funnel) or a select's list
// (components/Select.svelte, `listbox`) opens it;
// the OS never draws a menu of ours (a native popup could hang the window, and it looked
// different on every OS). Keys, the press outside, the window's blur, resizing and scrolling
// are handled in input.ts, which closes the menu through `closeMenu`.

import type { IconMeaning } from '$lib/icons';

/** One entry of a menu: an action, a thin line between groups, or a group's small heading
 *  (muted, never active: the arrows and the type-ahead pass over it). */
export type MenuEntry = MenuItem | { kind: 'separator' } | MenuHeading;

export interface MenuHeading {
  kind: 'heading';
  label: string;
}

export interface MenuItem {
  kind?: 'item';
  /** Stable id (test ids `menu-item-<id>`, the type-ahead reads the label). */
  id: string;
  label: string;
  icon?: IconMeaning | null;
  /** A choice of a group (the sort, a select's options): the chosen one is a track row with
   *  navy words, no tick (a radio item, an option). */
  checked?: boolean | null;
  /** A switch of its own (Nur neue): a checkbox item, the tick while `checked`. */
  toggle?: boolean;
  disabled?: boolean;
  /** Why a disabled entry cannot be chosen (its tooltip). */
  reason?: string | null;
  /** It deletes (Löschen, Endgültig löschen): red, on a red wash while active. */
  danger?: boolean;
  /** A choice that keeps the menu open (the funnel's groups: several are set in one go, the
   *  check marks move with each choice). */
  stays?: boolean;
  run: () => void;
}

/** Where the menu opens: at a point (a right click) or below an element (a menu button). */
export type MenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'below'; rect: DOMRect; align: 'start' | 'end' };

export interface MenuSpec {
  entries: readonly MenuEntry[];
  anchor: MenuAnchor;
  /** The accessible name of the menu ("Sortierung", "Job"). */
  label: string;
  /** Opened from the keyboard: the first entry is active at once (like the OS). */
  fromKeyboard?: boolean;
  /** Called after the menu closed (the menu button's pressed look ends). */
  onclose?: () => void;
  /** The entries anew after a choice that keeps the menu open (`stays`) ran. */
  refresh?: () => readonly MenuEntry[];
  /** The list of a select: a listbox of options at least as wide as its button, at most
   *  --menu-max-height high, and the focus stays on the button (its aria-activedescendant). */
  listbox?: boolean;
  /** The entry active when it opens (a select's chosen option). */
  active?: number;
}

interface MenuState {
  open: (MenuSpec & { id: number; returnFocus: HTMLElement | null }) | null;
  /** The active entry (hovered or chosen by keys); -1: none. */
  active: number;
}

export const menuState: MenuState = $state({ open: null, active: -1 });

let nextId = 1;

/** Told each time a menu opens: input.ts, which forgets the letters typed in the last one and
 *  has to hold the wheel for it (a select's list takes no focus that could say so). */
let opened: (() => void) | null = null;

export function onMenuOpened(handler: () => void): void {
  opened = handler;
}

/** Told each time a menu has closed and given back its focus, if it does: input.ts, where what
 *  leaving a field does waits for that. */
let closed: (() => void) | null = null;

export function onMenuClosed(handler: () => void): void {
  closed = handler;
}

export const isItem = (entry: MenuEntry): entry is MenuItem =>
  entry.kind !== 'separator' && entry.kind !== 'heading';

/** Open a menu (a menu already open closes first, without giving its focus back). */
export function openMenu(spec: MenuSpec): void {
  const previous = menuState.open;
  const focused = document.activeElement;
  const returnFocus =
    previous?.returnFocus ??
    (focused instanceof HTMLElement && focused !== document.body ? focused : null);
  previous?.onclose?.();
  const first = spec.active ?? (spec.fromKeyboard === true ? firstEnabled(spec.entries, 0, 1) : -1);
  menuState.open = { ...spec, id: nextId++, returnFocus };
  menuState.active = first;
  opened?.();
}

/** The element ids of a menu and of its entries (a select's aria-controls and
 *  aria-activedescendant). */
export const menuId = (menu: number): string => `menu-${menu}`;
export const menuItemId = (menu: number, index: number): string => `menu-${menu}-${index}`;

/** Close the open menu; `restore` gives the focus back to where it was before. */
export function closeMenu(restore = true): void {
  const open = menuState.open;
  if (open === null) return;
  menuState.open = null;
  menuState.active = -1;
  open.onclose?.();
  if (restore && open.returnFocus?.isConnected) open.returnFocus.focus({ preventScroll: true });
  closed?.();
}

/** Run an entry (enabled only): the menu closes first, the focus goes back, then it runs. A
 *  choice that keeps the menu open runs in it, and the menu shows its entries anew. */
export function chooseEntry(index: number): void {
  const open = menuState.open;
  const entry = open?.entries[index];
  if (open == null || entry === undefined || !isItem(entry) || entry.disabled === true) return;
  if (entry.stays === true) {
    entry.run();
    if (menuState.open?.id === open.id && open.refresh) menuState.open.entries = open.refresh();
    return;
  }
  closeMenu();
  entry.run();
}

/** The next enabled entry from `from` in `step` direction (wrapping), -1 without one. */
export function firstEnabled(entries: readonly MenuEntry[], from: number, step: 1 | -1): number {
  const count = entries.length;
  for (let n = 0; n < count; n += 1) {
    const index = (((from + n * step) % count) + count) % count;
    const entry = entries[index];
    if (entry !== undefined && isItem(entry) && entry.disabled !== true) return index;
  }
  return -1;
}
