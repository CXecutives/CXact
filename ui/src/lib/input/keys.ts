// The app's keys, once: the card of the keys (Ctrl/Cmd+/, features/shell/KeysHelp.svelte)
// and the card in Einstellungen both render this list (features/shared/KeyList.svelte). What
// a key does is a word of the catalog (`keysHelp`), the key is named as the OS names it
// (platform.ts `keyLabel`); a key the OS does not have (the Menu key on macOS) is left out.
// A key of "Überall" works in every view (registered in App.svelte or lib/input/input.ts),
// one of "In der Jobliste" only there. Adding or removing a key here is one entry.

import { t } from '../i18n/t';
import { keyConventions, keyLabel } from '../platform';

type Words = typeof t.keysHelp;

export interface KeyRow {
  id: string;
  /** What the key does. */
  label: string;
  /** The key as the OS writes it ("Strg+F", "⌘F"). */
  keys: string;
}

export interface KeyGroup {
  id: 'everywhere' | 'list';
  heading: string;
  rows: KeyRow[];
}

interface Entry {
  id: string;
  label: (k: Words) => string;
  keys: () => string;
  /** Only where the OS has the key. */
  when?: () => boolean;
}

const mac = (): boolean => keyConventions().command === 'metaKey';

const EVERYWHERE: readonly Entry[] = [
  {
    id: 'views',
    label: (k) => k.views,
    keys: () => t.keysHelp.range(keyLabel('mod+1'), keyLabel('mod+4')),
  },
  { id: 'fetch', label: (k) => k.fetch, keys: () => (mac() ? keyLabel('mod+r') : 'F5') },
  { id: 'undo', label: (k) => k.undo, keys: () => keyLabel('mod+z') },
  {
    id: 'menu',
    label: (k) => k.menu,
    keys: () => keyLabel('shift+f10'),
    when: () => keyConventions().contextMenuKey,
  },
  {
    id: 'back',
    label: (k) => k.back,
    keys: () => keyLabel(keyConventions().back === 'alt' ? 'alt+left' : 'mod+['),
  },
  { id: 'help', label: (k) => k.help, keys: () => keyLabel('mod+/') },
];

const LIST: readonly Entry[] = [
  { id: 'search', label: (k) => k.search, keys: () => keyLabel('mod+f') },
  {
    id: 'step',
    label: (k) => k.step,
    keys: () => `${keyLabel('up')} ${keyLabel('down')}`,
  },
  {
    id: 'edge',
    label: (k) => k.edge,
    keys: () => `${keyLabel('home')} ${keyLabel('end')}`,
  },
  {
    id: 'extend',
    label: (k) => k.extend,
    keys: () => `${keyLabel('shift+up')} ${keyLabel('shift+down')}`,
  },
  { id: 'archive', label: (k) => k.archive, keys: () => 'E' },
  { id: 'trash', label: (k) => k.trash, keys: () => keyLabel('del') },
  { id: 'star', label: (k) => k.star, keys: () => 'S' },
  { id: 'openAd', label: (k) => k.openAd, keys: () => 'O' },
  { id: 'close', label: (k) => k.closeJob, keys: () => keyLabel('esc') },
];

const rows = (entries: readonly Entry[]): KeyRow[] =>
  entries
    .filter((entry) => entry.when?.() ?? true)
    .map((entry) => ({ id: entry.id, label: entry.label(t.keysHelp), keys: entry.keys() }));

/** The groups of keys in the language of the moment (read it in a `$derived`). */
export function keyGroups(): KeyGroup[] {
  return [
    { id: 'everywhere', heading: t.keysHelp.everywhere, rows: rows(EVERYWHERE) },
    { id: 'list', heading: t.keysHelp.list, rows: rows(LIST) },
  ];
}
