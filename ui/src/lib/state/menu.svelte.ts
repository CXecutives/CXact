// The app's own menus: one menu at a time, drawn by components/Menu.svelte in the app layer.
// A right click (lib/input/input.ts), a menu button (MenuButton) or a "…" button opens it;
// the OS never draws a menu of ours (a native popup could hang the window, and it looked
// different on every OS). Keys, the press outside, the window's blur, resizing and scrolling
// are handled in input.ts, which closes the menu through `closeMenu`.

import type { IconMeaning } from '$lib/icons';
import { popoverDelay } from '$lib/motion/motion';
import type { ReasonKind } from '$lib/ipc/types';

/** One entry of a menu: an action, a thin line between groups, a group's small heading
 *  (muted, never active: the arrows and the type-ahead pass over it), or a line that only
 *  tells (a popover of such lines is no menu: the reader's "Warum diese Zahl?"). */
export type MenuEntry = MenuItem | { kind: 'separator' } | MenuHeading | MenuLine;

export interface MenuHeading {
  kind: 'heading';
  label: string;
}

/** A line of words after the icon of its verdict (components/ReasonItem); never active. */
export interface MenuLine {
  kind: 'line';
  /** Stable id (test ids `menu-line-<id>`). */
  id: string;
  label: string;
  verdict: ReasonKind;
}

export interface MenuItem {
  kind?: 'item';
  /** Stable id (test ids `menu-item-<id>`, the type-ahead reads the label). */
  id: string;
  label: string;
  icon?: IconMeaning | null;
  /** A choice of a group (the sort): a check mark before the chosen one (a radio item). */
  checked?: boolean | null;
  /** A switch of its own (Nur neue): a checkbox item, the check mark while `checked`. */
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
  /** Opened by the pointer resting on this anchor (the reader's ring): the popover takes no
   *  focus, a press on its anchor keeps it, the pointer leaving both closes it. */
  hover?: HTMLElement;
}

interface MenuState {
  open: (MenuSpec & { id: number; returnFocus: HTMLElement | null }) | null;
  /** The active entry (hovered or chosen by keys); -1: none. */
  active: number;
}

export const menuState: MenuState = $state({ open: null, active: -1 });

let nextId = 1;

export const isItem = (entry: MenuEntry): entry is MenuItem =>
  entry.kind !== 'separator' && entry.kind !== 'heading' && entry.kind !== 'line';

/** A popover that only tells (its every entry a line): a dialog, not a menu. */
export const tellsOnly = (entries: readonly MenuEntry[]): boolean =>
  entries.length > 0 && entries.every((entry) => entry.kind === 'line');

let leaving: ReturnType<typeof setTimeout> | undefined;

/** The pointer left a hover popover or its anchor: it closes unless the pointer is back on
 *  one of them within --delay-popover (crossing the gap between them). */
export function leaveHover(): void {
  clearTimeout(leaving);
  if (menuState.open?.hover === undefined) return;
  leaving = setTimeout(() => {
    if (menuState.open?.hover !== undefined) closeMenu(false);
  }, popoverDelay());
}

/** The pointer is back on a hover popover or its anchor: it stays. */
export function stayHover(): void {
  clearTimeout(leaving);
}

/** Open a menu (a menu already open closes first, without giving its focus back). */
export function openMenu(spec: MenuSpec): void {
  clearTimeout(leaving);
  const previous = menuState.open;
  const focused = document.activeElement;
  const returnFocus =
    previous?.returnFocus ??
    (focused instanceof HTMLElement && focused !== document.body ? focused : null);
  previous?.onclose?.();
  const first = spec.fromKeyboard === true ? firstEnabled(spec.entries, 0, 1) : -1;
  menuState.open = { ...spec, id: nextId++, returnFocus };
  menuState.active = first;
}

/** Close the open menu; `restore` gives the focus back to where it was before. */
export function closeMenu(restore = true): void {
  const open = menuState.open;
  if (open === null) return;
  clearTimeout(leaving);
  menuState.open = null;
  menuState.active = -1;
  open.onclose?.();
  if (restore && open.returnFocus?.isConnected) open.returnFocus.focus({ preventScroll: true });
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
