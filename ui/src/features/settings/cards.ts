// Einstellungen as data: the cards in their order, each on its tab (Portale, Daten; user
// decision 2026-10-03) with its heading, its block and its rows, and every button of a row.
// SettingsView.svelte renders this list and nothing else, so adding, moving or removing a
// setting is one entry here (docs/CHANGING.md). Texts are read from the catalog where they
// render (`(t) => t.settings.…`).
//
// Rules the list keeps (docs/PLAN.md, Einstellungen): a switch moves at once and is its own
// answer; every text button of a row is the same outlined button (secondary, 28 px), whether
// it opens something or runs a command, and the ones that lose something for good are red
// (`warns`: Zurücksetzen, like Entfernen of the mailbox); a locked button says why
// (`locked`); the reset stands alone on its row. An info symbol only at "CXact sucht nach".

import type { IconName } from '$components/Icon.svelte';
import type { Catalog } from '$lib/i18n/de';
import type { AppState, OpenTarget, Way } from '$lib/ipc/types';
import type { SettingsTab } from '$lib/state/settings.svelte';

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
  profilesOpen: {
    label: (t) => t.common.openFolder,
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
export type CommandId = 'reset';

/** A row with its buttons at the end. */
export interface Row {
  id: string;
  label: Text;
  /** One sentence under the label. */
  hint?: Text;
  actions: readonly ActionId[];
}

/** What a card shows besides its rows: the terms of the search (SearchTerms), the portals
 *  the app searches, or the mailbox card with the portals of its alert mails under it. */
export type Block = 'terms' | 'search' | 'mailbox';
/** The portals' cards, by how a portal brings its jobs (`PortalState.way`). */
export type Portals = Exclude<Block, 'terms'>;
export const portalsOf = (way: Way): Portals => (way === 'search' ? 'search' : 'mailbox');

export interface CardSpec {
  id: string;
  tab: SettingsTab;
  /** Its heading above it (a card alone on its tab goes without: the tab names it). */
  heading?: Text;
  /** The one sentence of the info symbol beside the heading. */
  info?: Text;
  block?: Block;
  rows: readonly Row[];
  /** A quiet line under the card. */
  footnote?: Text;
}

export const CARDS: readonly CardSpec[] = [
  {
    id: 'terms',
    tab: 'portals',
    heading: (t) => t.settings.terms,
    info: (t) => t.settings.termsInfo,
    block: 'terms',
    rows: [],
  },
  { id: 'search', tab: 'portals', heading: (t) => t.settings.search, block: 'search', rows: [] },
  { id: 'mailbox', tab: 'portals', heading: (t) => t.settings.alerts, block: 'mailbox', rows: [] },
  {
    id: 'data',
    tab: 'data',
    rows: [
      {
        id: 'profiles',
        label: (t) => t.settings.profiles,
        hint: (t) => t.settings.profilesHint,
        actions: ['profilesOpen'],
      },
      // The one action that deletes for good; what it deletes is said in its dialog.
      {
        id: 'reset-all',
        label: (t) => t.settings.reset,
        hint: (t) => t.settings.resetHint,
        actions: ['reset'],
      },
    ],
    footnote: (t, state) => t.settings.version(state.version),
  },
];
