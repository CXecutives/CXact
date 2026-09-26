// The app's keyboard shortcuts, once: the table that lib/input/input.ts dispatches from, that
// the card of the keys (Ctrl/Cmd+/, features/shell/KeysHelp.svelte) and the card in
// Einstellungen list (features/shared/KeyList.svelte, `keyGroups`) and that a button's
// tooltip names (Button `keys`). A row says what the key does, where it works (everywhere, or
// in the job list while it is shown), its name on the cards (a word of the catalog,
// `keysHelp`) and its keys on this OS as the combos of platform.ts keyLabel ('mod+f', 'e',
// 'del'); the first combo is the one the cards and a tooltip show, and a key the OS does not
// have (the Menu key on macOS) is left out. The keys of the four views come from
// lib/views.ts. A key is one row; what differs between the OS is platform.ts (keyConventions).

import { t } from '../i18n/t';
import { keyConventions, keyLabel, type KeyConventions } from '../platform';
import { VIEWS } from '../views';

export type ShortcutAction =
  | 'views'
  | 'settings'
  | 'undo'
  | 'menu'
  | 'back'
  | 'help'
  | 'save'
  | 'fetch'
  | 'search'
  | 'open'
  | 'step'
  | 'edge'
  | 'extend'
  | 'archive'
  | 'trash'
  | 'star'
  | 'openAd'
  | 'close';

/** Where a key works: everywhere (outside a field unless it says so), or in the job list
 *  while it is shown. */
export type ShortcutScope = 'everywhere' | 'list';

export interface Shortcut {
  action: ShortcutAction;
  scope: ShortcutScope;
  /** Its name on the card; null: not listed (a second way to a listed key, a form's key). */
  label: (() => string) | null;
  /** Its keys on this OS, the one to show first; none: the OS has no such key. */
  keys: (os: KeyConventions) => readonly string[];
  /** How the card writes them: the first (F5), the first two (↑ ↓), or the first and the
   *  last (Strg+1 bis Strg+4). */
  shows: 'first' | 'pair' | 'range';
}

export const SHORTCUTS: readonly Shortcut[] = [
  {
    action: 'views',
    scope: 'everywhere',
    label: () => t.keysHelp.views,
    keys: () => VIEWS.map((view) => view.keys),
    shows: 'range',
  },
  // Ctrl+, opens Einstellungen on Windows; the macOS menu has Cmd+, itself.
  {
    action: 'settings',
    scope: 'everywhere',
    label: null,
    keys: (os) => (os.settingsKey ? ['mod+,'] : []),
    shows: 'first',
  },
  // Fetching works in every view (App.svelte registers it).
  {
    action: 'fetch',
    scope: 'everywhere',
    label: () => t.keysHelp.fetch,
    keys: (os) => os.fetchKeys,
    shows: 'first',
  },
  {
    action: 'undo',
    scope: 'everywhere',
    label: () => t.keysHelp.undo,
    keys: () => ['mod+z'],
    shows: 'first',
  },
  {
    action: 'menu',
    scope: 'everywhere',
    label: () => t.keysHelp.menu,
    keys: (os) => (os.contextMenuKey ? ['shift+f10', 'menukey'] : []),
    shows: 'first',
  },
  {
    action: 'back',
    scope: 'everywhere',
    label: () => t.keysHelp.back,
    keys: (os) => os.backKeys,
    shows: 'first',
  },
  {
    action: 'help',
    scope: 'everywhere',
    label: () => t.keysHelp.help,
    keys: () => ['mod+/'],
    shows: 'first',
  },
  // Saves the form around the focus (the Profil), from its fields too.
  { action: 'save', scope: 'everywhere', label: null, keys: () => ['mod+s'], shows: 'first' },
  // Searching works where the job list is shown.
  {
    action: 'search',
    scope: 'list',
    label: () => t.keysHelp.search,
    keys: () => ['mod+f'],
    shows: 'first',
  },
  {
    action: 'step',
    scope: 'list',
    label: () => t.keysHelp.step,
    keys: () => ['up', 'down'],
    shows: 'pair',
  },
  {
    action: 'edge',
    scope: 'list',
    label: () => t.keysHelp.edge,
    keys: () => ['home', 'end'],
    shows: 'pair',
  },
  {
    action: 'extend',
    scope: 'list',
    label: () => t.keysHelp.extend,
    keys: () => ['shift+up', 'shift+down', 'shift+home', 'shift+end'],
    shows: 'pair',
  },
  // Enter opens a row by the row's own button; its menu names the key.
  { action: 'open', scope: 'list', label: null, keys: () => ['enter'], shows: 'first' },
  {
    action: 'archive',
    scope: 'list',
    label: () => t.keysHelp.archive,
    keys: () => ['e'],
    shows: 'first',
  },
  {
    action: 'trash',
    scope: 'list',
    label: () => t.keysHelp.trash,
    keys: () => ['del'],
    shows: 'first',
  },
  {
    action: 'star',
    scope: 'list',
    label: () => t.keysHelp.star,
    keys: () => ['s'],
    shows: 'first',
  },
  {
    action: 'openAd',
    scope: 'list',
    label: () => t.keysHelp.openAd,
    keys: () => ['o'],
    shows: 'first',
  },
  {
    action: 'close',
    scope: 'list',
    label: () => t.keysHelp.closeJob,
    keys: () => ['esc'],
    shows: 'first',
  },
];

/** The row of `action`. */
export function shortcut(action: ShortcutAction): Shortcut {
  const found = SHORTCUTS.find((row) => row.action === action);
  if (found === undefined) throw new Error(`no shortcut ${action}`);
  return found;
}

/** The first key of `action` on this OS (a button's tooltip names it), or null. */
export function keysOf(action: ShortcutAction, os: KeyConventions): string | null {
  return shortcut(action).keys(os)[0] ?? null;
}

/** The KeyboardEvent keys of the named keys of a combo. */
const NAMED: Readonly<Record<string, readonly string[]>> = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  home: ['Home'],
  end: ['End'],
  esc: ['Escape'],
  enter: ['Enter'],
  f5: ['F5'],
  f10: ['F10'],
  /** The Menu key of a Windows keyboard. */
  menukey: ['ContextMenu'],
};

/** A printed symbol: the layout may need Shift (and on macOS Option) to type it ("/" is
 *  Shift+7 on a German keyboard, "[" Option+5 on a German Mac). */
const isSymbol = (key: string): boolean => key.length === 1 && !/[a-z0-9]/.test(key);

function keyIs(event: KeyboardEvent, key: string, os: KeyConventions): boolean {
  if (key === 'del') return os.deleteKeys.includes(event.key);
  // Digits by their place on the keyboard, so every layout works.
  if (/^\d$/.test(key)) return event.code === `Digit${key}`;
  if (key === '/')
    return event.key === '/' || event.code === 'Slash' || event.code === 'NumpadDivide';
  const named = NAMED[key];
  if (named !== undefined) return named.includes(event.key);
  return event.key.toLowerCase() === key;
}

/**
 * Whether `event` is the key `combo` ('mod+shift+z', 'f5', 'del', 'e', 'up', 'mod+1',
 * 'mod+/'): exactly its modifiers (`mod` is the command key of the OS, Ctrl or Cmd), except
 * the Shift (and on macOS the Option) a symbol needs on the layout.
 */
export function pressed(event: KeyboardEvent, combo: string, os: KeyConventions): boolean {
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  const other = os.command === 'metaKey' ? 'ctrlKey' : 'metaKey';
  if (event[os.command] !== mods.has('mod') || event[other]) return false;
  const symbol = isSymbol(key);
  if (event.altKey !== mods.has('alt') && !(symbol && os.optionTypes)) return false;
  if (event.shiftKey !== mods.has('shift') && !symbol) return false;
  return keyIs(event, key, os);
}

/** The combo of `action` that `event` is (on this OS), or null. */
export function combo(
  event: KeyboardEvent,
  action: ShortcutAction,
  os: KeyConventions,
): string | null {
  return (
    shortcut(action)
      .keys(os)
      .find((keys) => pressed(event, keys, os)) ?? null
  );
}

/** The row of `scope` that `event` is, with the combo it matched, or null. */
export function matched(
  event: KeyboardEvent,
  scope: ShortcutScope,
  os: KeyConventions,
): { action: ShortcutAction; combo: string } | null {
  for (const row of SHORTCUTS) {
    if (row.scope !== scope) continue;
    const keys = row.keys(os).find((each) => pressed(event, each, os));
    if (keys !== undefined) return { action: row.action, combo: keys };
  }
  return null;
}

/** A row of a card of the keys: what the key does and the key as the OS writes it. */
export interface KeyRow {
  id: ShortcutAction;
  label: string;
  keys: string;
}

export interface KeyGroup {
  id: ShortcutScope;
  heading: string;
  rows: KeyRow[];
}

/** How a card writes a row's keys: the first, the first two, or first to last. */
function written(row: Shortcut, os: KeyConventions): string {
  const keys = row.keys(os).map(keyLabel);
  if (row.shows === 'range') return t.keysHelp.range(keys[0] ?? '', keys.at(-1) ?? '');
  if (row.shows === 'pair') return keys.slice(0, 2).join(' ');
  return keys[0] ?? '';
}

/** The listed keys by where they work, in the language of the moment (read it in a
 *  `$derived`): the cards of the keys render it. */
export function keyGroups(): KeyGroup[] {
  const os = keyConventions();
  const rows = (scope: ShortcutScope): KeyRow[] =>
    SHORTCUTS.filter(
      (row) => row.scope === scope && row.label !== null && row.keys(os).length > 0,
    ).map((row) => ({ id: row.action, label: row.label?.() ?? '', keys: written(row, os) }));
  return [
    { id: 'everywhere', heading: t.keysHelp.everywhere, rows: rows('everywhere') },
    { id: 'list', heading: t.keysHelp.list, rows: rows('list') },
  ];
}
