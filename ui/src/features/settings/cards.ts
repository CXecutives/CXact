// Einstellungen as data: the cards in their order (Postfach, Portale, Export, Darstellung,
// Daten), each with its heading and its rows, and every button of a row. SettingsView.svelte
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
import type { AppState, Language, OpenTarget, Palette, SettingsPatch } from '$lib/ipc/types';

/** What a row reads: the catalog of the moment and the app state. */
export type Text = (t: Catalog, state: AppState) => string;

/** What a locked button asks: the state, and what holds the app now. */
export interface Lock {
  state: AppState;
  t: Catalog;
  /** A run goes (a fetch or a rescore). */
  running: boolean;
  /** Why a run holds the app ("Ein Abruf läuft gerade."). */
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

/** Why the dry run or the demo refuse to hand out or take in data: theirs is nobody's. */
const realOnly = ({ state, t }: Lock): string | null =>
  state.demo ? t.error.text('demo', {}) : state.dryRun ? t.error.text('dryRun', {}) : null;

/** Why the dry run or the demo refuse a change of what is outside their own data, and why a
 *  run holds it. */
const ownOnly = (lock: Lock): string | null =>
  realOnly(lock) ?? (lock.running ? lock.busyText : null);

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
  excelOpen: {
    label: (t) => t.common.open,
    icon: 'excel',
    open: { kind: 'excel' },
    locked: ({ state, t }) => (state.settings.excelExists ? null : t.settings.excelMissing),
  },
  csvOpen: {
    label: (t) => t.common.open,
    icon: 'document',
    open: { kind: 'csv' },
    locked: ({ state, t }) => (state.settings.csvExists ? null : t.settings.csvMissing),
  },
  // Opens the list of the copies; the restore can be undone.
  backupRestore: {
    label: (t) => t.settings.backupAction,
    icon: 'backup',
    locked: ownOnly,
  },
  // All the data in one file where she chooses (never the app password); it only reads, so
  // a run may go on.
  dataExport: {
    label: (t) => t.settings.exportAction,
    icon: 'saveFile',
    locked: realOnly,
  },
  // Asks first what the file replaces, then the file is chosen.
  dataImport: {
    label: (t) => t.settings.importAction,
    icon: 'pickFile',
    locked: ownOnly,
  },
  logsOpen: {
    label: (t) => t.common.open,
    icon: 'folder',
    open: { kind: 'logDir' },
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
export type CommandId = 'folderChange' | 'backupRestore' | 'dataExport' | 'dataImport' | 'reset';

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
  actions: readonly ActionId[];
  toggle?: Switch;
}

export type Row = ChoiceRow<Palette> | ChoiceRow<Language> | ActionsRow;

/** A card: its rows, and for the mailbox and the portals a block of their own (the mailbox
 *  has no rows of its own). */
export interface CardSpec {
  id: string;
  heading: Text;
  block?: 'mailbox' | 'portals';
  rows: readonly Row[];
}

/** A whole patch of the settings from what changes (everything else `null`: unchanged). */
export const settingsPatch = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  fetchRange: null,
  exportExcel: null,
  exportCsv: null,
  language: null,
  palette: null,
  ...change,
});

const palette: ChoiceRow<Palette> = {
  kind: 'choice',
  id: 'palette',
  label: (t) => t.settings.palette,
  options: ['coast', 'light', 'dark'],
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

export const CARDS: readonly CardSpec[] = [
  { id: 'mailbox', heading: (t) => t.settings.mailbox, block: 'mailbox', rows: [] },
  { id: 'portals', heading: (t) => t.settings.portals, block: 'portals', rows: [] },
  {
    id: 'export',
    heading: (t) => t.settings.export,
    rows: [
      {
        kind: 'actions',
        id: 'folder',
        label: (t) => t.settings.folder,
        path: (state) => state.settings.workspace,
        actions: ['folderChange', 'folderOpen'],
      },
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
  { id: 'look', heading: (t) => t.settings.look, rows: [palette, language] },
  {
    id: 'data',
    heading: (t) => t.settings.data,
    rows: [
      {
        kind: 'actions',
        id: 'backup',
        label: (t) => t.settings.backup,
        actions: ['backupRestore'],
      },
      // Taking the data along: one file out, and in again (on this or another computer).
      {
        kind: 'actions',
        id: 'export-data',
        label: (t) => t.settings.exportData,
        actions: ['dataExport'],
      },
      {
        kind: 'actions',
        id: 'import-data',
        label: (t) => t.settings.importData,
        actions: ['dataImport'],
      },
      { kind: 'actions', id: 'logs', label: (t) => t.settings.logs, actions: ['logsOpen'] },
      // The one action that deletes for good, last; what it deletes is said in its dialog.
      { kind: 'actions', id: 'reset-all', label: (t) => t.settings.reset, actions: ['reset'] },
    ],
  },
];
