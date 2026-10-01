// Einstellungen as data: the cards in their order (Suche, Postfach, Export, Darstellung,
// Daten; by the fetch's two ways, user decision 2026-10-01), each with its heading and its rows, and every button of a row. SettingsView.svelte
// renders this list and nothing else, so adding, moving or removing a setting is one entry
// here (docs/CHANGING.md). Texts are read from the catalog where they render
// (`(t) => t.settings.…`), so they follow the language.
//
// Rules the list keeps (docs/PLAN.md, Einstellungen): a switch or a choice moves at once and
// is its own answer; every text button of a row is the same outlined button (secondary, 28
// px), whether it changes the row's value or opens something, and the ones that lose
// something for good are red (`warns`: Zurücksetzen, like Entfernen of the mailbox); a
// locked button says why (`locked`); the reset stands alone on the last row.

import type { IconName } from '$components/Icon.svelte';
import type { Catalog } from '$lib/i18n/de';
import type { AppState, Language, OpenTarget, Palette, SettingsPatch, Way } from '$lib/ipc/types';

/** What a row reads: the catalog of the moment and the app state. */
export type Text = (t: Catalog, state: AppState) => string;

/** What a locked button asks: the state, and what holds the app now. */
export interface Lock {
  state: AppState;
  t: Catalog;
  /** A run goes (a fetch or a rescore). */
  running: boolean;
  /** Why a run holds the app, by its kind ("Gerade läuft schon ein Abruf."). */
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

/** Why the dry run or the demo refuse a change of what is outside their own data. */
const ownOnly = ({ state, t, running, busyText }: Lock): string | null =>
  state.demo
    ? t.error.text('demo', {})
    : state.dryRun
      ? t.error.text('dryRun', {})
      : running
        ? busyText
        : null;

export const ACTIONS = {
  folderChange: {
    label: (t) => t.common.change,
    icon: 'edit',
    locked: ownOnly,
  },
  folderOpen: {
    label: (t) => t.common.open,
    icon: 'folder',
    open: { kind: 'workspace' },
  },
  // A file opens while its switch is on: the backend writes it fresh before it opens (also
  // the first time); switched off the app writes none, and the row says how to get it.
  excelOpen: {
    label: (t) => t.common.open,
    icon: 'excel',
    open: { kind: 'excel' },
    locked: ({ state, t }) => (state.exportExcel ? null : t.settings.excelOff),
  },
  csvOpen: {
    label: (t) => t.common.open,
    icon: 'document',
    open: { kind: 'csv' },
    locked: ({ state, t }) => (state.exportCsv ? null : t.settings.csvOff),
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

/** A switch of a row: on or off at once (the state is patched before the save). */
export interface Switch {
  id: string;
  on: (state: AppState) => boolean;
  patch: (on: boolean) => Partial<SettingsPatch>;
  /** The state as it will be (the switch follows before the answer). */
  set: (state: AppState, on: boolean) => void;
}

/** One of a few, side by side (Segmented): the page follows at once, the save after. */
export interface ChoiceRow<Id extends string = string> {
  kind: 'choice';
  id: string;
  label: Text;
  options: readonly Id[];
  name(t: Catalog, id: Id): string;
  value(state: AppState): Id;
  patch(id: Id): Partial<SettingsPatch>;
  /** The state as it will be. */
  set(state: AppState, id: Id): void;
}

/** A row with its buttons at the end, and a switch after them. */
export interface ActionsRow {
  kind: 'actions';
  id: string;
  label: Text;
  /** A value under the label to copy (a path). */
  path?: (state: AppState) => string;
  /** One short sentence under the label (what its switch does). */
  hint?: Text;
  actions: readonly ActionId[];
  toggle?: Switch;
}

export type Row = ChoiceRow<Palette> | ChoiceRow<Language> | ActionsRow;

/** A card: its rows, and for the two ways of the fetch a block of their own: Suche its
 *  sources, Postfach the connection and under it the sources of its alert mails. */
export interface CardSpec {
  id: string;
  heading: Text;
  block?: Sources;
  rows: readonly Row[];
  /** Kept but not shown for now (a card that may come back). */
  hidden?: boolean;
}

/** The cards of the sources, by how a source brings its jobs (`PortalState.way`). */
export type Sources = 'search' | 'mailbox';
export const sourcesOf = (way: Way): Sources => (way === 'search' ? 'search' : 'mailbox');

/** A whole patch of the settings from what changes (everything else `null`: unchanged). */
export const settingsPatch = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  exportExcel: null,
  exportCsv: null,
  fetchMail: null,
  fetchSearch: null,
  language: null,
  palette: null,
  ...change,
});

const palette: ChoiceRow<Palette> = {
  kind: 'choice',
  id: 'palette',
  label: (t) => t.settings.palette,
  options: ['cxact', 'light', 'dark'],
  name: (t, id) => t.settings.paletteName[id],
  value: (state) => state.palette,
  patch: (id) => ({ palette: id }),
  set: (state, id) => void (state.palette = id),
};

const language: ChoiceRow<Language> = {
  kind: 'choice',
  id: 'language',
  label: (t) => t.settings.language,
  options: ['de', 'en'],
  name: (t, id) => t.settings.languageName[id],
  value: (state) => state.language,
  patch: (id) => ({ language: id }),
  set: (state, id) => void (state.language = id),
};

/** Cards hidden for now (user, 2026-09-30), their code kept; the backend holds their
 *  choices at the defaults (core settings::LOOK_SHOWN and EXPORT_SHOWN): Darstellung (the
 *  app is CXact and German) and the Excel and CSV switches (no file is written). */
const LOOK_SHOWN = false;
const EXPORT_SHOWN = false;

/** The work folder (the profiles, and the overviews while they are written). */
const folder: ActionsRow = {
  kind: 'actions',
  id: 'folder',
  label: (t) => t.settings.folder,
  path: (state) => state.settings.workspace,
  actions: ['folderChange', 'folderOpen'],
};

export const CARDS: readonly CardSpec[] = [
  { id: 'search', heading: (t) => t.settings.search, block: 'search', rows: [] },
  { id: 'mailbox', heading: (t) => t.settings.mailbox, block: 'mailbox', rows: [] },
  {
    id: 'export',
    heading: (t) => t.settings.export,
    hidden: !EXPORT_SHOWN,
    rows: [
      ...(EXPORT_SHOWN ? [folder] : []),
      {
        kind: 'actions',
        id: 'excel',
        label: (t) => t.settings.excel,
        actions: ['excelOpen'],
        toggle: {
          id: 'exportExcel',
          on: (state) => state.exportExcel,
          patch: (on) => ({ exportExcel: on }),
          set: (state, on) => void (state.exportExcel = on),
        },
      },
      {
        kind: 'actions',
        id: 'csv',
        label: (t) => t.settings.csv,
        actions: ['csvOpen'],
        toggle: {
          id: 'exportCsv',
          on: (state) => state.exportCsv,
          patch: (on) => ({ exportCsv: on }),
          set: (state, on) => void (state.exportCsv = on),
        },
      },
    ],
  },
  { id: 'look', heading: (t) => t.settings.look, rows: [palette, language], hidden: !LOOK_SHOWN },
  {
    id: 'data',
    heading: (t) => t.settings.data,
    rows: [
      // The one action that deletes for good; what it deletes is said in its dialog (user
      // decision 2026-09-27: no Sicherung and no Protokoll rows here).
      // The work folder stands here while the export is hidden.
      ...(EXPORT_SHOWN ? [] : [folder]),
      { kind: 'actions', id: 'reset-all', label: (t) => t.settings.reset, actions: ['reset'] },
    ],
  },
];
