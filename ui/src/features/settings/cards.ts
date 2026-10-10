// Einstellungen as data: one page of groups in their order ("Luftige Gruppen"), each with its
// heading and its block or its rows, and every button of a row. SettingsView.svelte
// renders this list and nothing else, so adding, moving or removing a setting is one entry
// here (docs/CHANGING.md). Texts are read from the catalog where they render
// (`(t) => t.settings.…`).
//
// Rules the list keeps (docs/PLAN.md, Einstellungen): a switch moves at once and is its own
// answer; every text button of a row is the same outlined button with the glyph of its
// meaning, whether it opens something or runs a command, and the ones that lose something
// for good are red (`warns`: Zurücksetzen, like Entfernen of the mailbox); a locked button
// says why (`locked`).

import type { IconName } from '$components/Icon.svelte';
import type { Catalog } from '$lib/i18n/de';
import type { AppState, OpenTarget } from '$lib/ipc/types';

/** What a row reads: the catalog of the moment and the app state. */
export type Text = (t: Catalog, state: AppState) => string;

/** What a locked button asks: the state, and what holds the app now. */
export interface Lock {
  state: AppState;
  t: Catalog;
  /** A run goes (a fetch or a rescore). */
  running: boolean;
  /** Why a run holds the app, by its kind ("Gerade läuft schon eine Suche."). */
  busyText: string;
}

/** A button of a row (outlined, like every text button of the page). It opens a checked
 *  target (`open`), or runs the view's command of its id. */
export interface Action {
  label: Text;
  icon: IconName;
  /** Why it waits now, or null. */
  locked?: (lock: Lock) => string | null;
  open?: OpenTarget;
  warns?: boolean;
}

/** Why the dry run refuses a change of what is outside its own data, and a run holds it. */
export const ownOnly = ({ state, t, running, busyText }: Lock): string | null =>
  state.dryRun ? t.error.text('dryRun', {}) : running ? busyText : null;

export const ACTIONS = {
  // Another folder for the profile (the folder dialog; the profile comes along).
  folderChange: {
    label: (t) => t.common.change,
    icon: 'edit',
    locked: ownOnly,
  },
  folderOpen: {
    label: (t) => t.common.open,
    icon: 'folder',
    open: { kind: 'profileDir' },
  },
  // Deletes everything for good: the glyph of every deletion for good (removing the mailbox,
  // deleting a job for good).
  reset: {
    label: (t) => t.settings.resetAction,
    icon: 'trash',
    warns: true,
    locked: ownOnly,
  },
} satisfies Record<string, Action>;

export type ActionId = keyof typeof ACTIONS;
/** The buttons that run a command of the view (the others open a target). */
export type CommandId = 'folderChange' | 'reset';

/** A row: its tile, its label, under it its one sentence or a path to copy, its buttons at
 *  the end. */
export interface Row {
  id: string;
  tile: IconName;
  label: Text;
  hint?: Text;
  /** A path under the label, to copy. */
  path?: Text;
  actions: readonly ActionId[];
}

/** What a section shows besides rows: every portal (PortalRow), or the mailbox. */
export type Block = 'portals' | 'mailbox';

export interface SectionSpec {
  id: string;
  heading: Text;
  block?: Block;
  rows: readonly Row[];
}

export const SECTIONS: readonly SectionSpec[] = [
  {
    id: 'portals',
    heading: (t) => t.settings.portals,
    block: 'portals',
    rows: [],
  },
  {
    id: 'mailbox',
    heading: (t) => t.settings.mailbox,
    block: 'mailbox',
    rows: [],
  },
  {
    id: 'data',
    heading: (t) => t.settings.data,
    rows: [
      {
        id: 'folder',
        tile: 'folder',
        label: (t) => t.settings.folder,
        path: (_t, state) => state.settings.workspace,
        actions: ['folderChange', 'folderOpen'],
      },
      // The one action that deletes for good, last; what it deletes is said in its dialog too.
      {
        id: 'reset-all',
        tile: 'trash',
        label: (t) => t.settings.reset,
        hint: (t) => t.settings.resetHint,
        actions: ['reset'],
      },
    ],
  },
];
