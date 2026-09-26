// Einstellungen as data: the cards in their order, each with its heading and its rows, and
// every button of a row. SettingsView.svelte renders this list and nothing else, so adding,
// moving or removing a setting is one entry here (docs/CHANGING.md). Texts are read from
// the catalog where they render (`(t) => t.settings.…`), so they follow the language.
//
// Rules the list keeps (docs/PLAN.md, Einstellungen): a switch or a choice moves at once and
// is its own answer; the button that changes the row's own value is secondary (Ändern,
// Abrufen, Anmelden), the ones that open, reveal, write again or remove are ghost; a locked
// button says why (`locked`); only "Alles zurücksetzen" warns, alone on the last card.

import type { IconName } from '$components/Icon.svelte';
import type { Catalog } from '$lib/i18n/de';
import type { AppState, Language, OpenTarget, Palette, SettingsPatch } from '$lib/ipc/types';
import { AUTO_ARCHIVE_DAYS, AUTO_EMPTY_TRASH_DAYS } from '$lib/ipc/types/settings';

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
  /** The first fetch has not happened yet: the files do not exist. */
  beforeFirstFetch: boolean;
}

/** A button of a row. It opens a checked target (`open`), or runs the view's command of
 *  its id. */
export interface Action {
  label: Text;
  icon: IconName;
  variant: 'secondary' | 'ghost';
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

/** The dry run writes no file, and a run holds them. */
const filesHeld = ({ state, t, running, busyText }: Lock): string | null =>
  state.dryRun ? t.error.text('dryRun', {}) : running ? busyText : null;

export const ACTIONS = {
  workspaceChange: {
    label: (t) => t.common.change,
    icon: 'pencil',
    variant: 'secondary',
    locked: ownOnly,
  },
  workspaceOpen: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'workspace' },
  },
  excelOpen: {
    label: (t) => t.common.open,
    icon: 'file-spreadsheet',
    variant: 'ghost',
    open: { kind: 'excel' },
    locked: ({ state, t }) => (state.settings.excelExists ? null : t.settings.excelMissing),
  },
  excelReveal: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'excelInFolder' },
  },
  // Opening writes the report first, except in the dry run and while a run holds the files.
  overviewOpen: {
    label: (t) => t.common.open,
    icon: 'file-text',
    variant: 'ghost',
    open: { kind: 'overview' },
    locked: (lock) =>
      lock.beforeFirstFetch
        ? lock.t.settings.overviewLater
        : lock.state.settings.excelExists
          ? null
          : filesHeld(lock),
  },
  overviewReveal: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'overviewInFolder' },
  },
  txtRewrite: {
    label: (t) => t.settings.txtRewrite,
    icon: 'file-pen-line',
    variant: 'ghost',
    locked: (lock) => (lock.beforeFirstFetch ? lock.t.settings.txtLater : filesHeld(lock)),
  },
  txtReveal: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'txtDir' },
    locked: ({ state, t }) => (state.settings.txtFiles > 0 ? null : t.settings.txtNone),
  },
  // Can be undone (its toast writes them again): no dialog, no warning colour.
  txtClear: {
    label: (t) => t.settings.txtClear,
    icon: 'trash-2',
    variant: 'ghost',
    locked: (lock) =>
      filesHeld(lock) ?? (lock.state.settings.txtFiles > 0 ? null : lock.t.settings.txtNone),
  },
  logsOpen: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'logDir' },
  },
  dataOpen: {
    label: (t) => t.common.openFolder,
    icon: 'folder-open',
    variant: 'ghost',
    open: { kind: 'dataDir' },
  },
  // Opens the list of the copies; the restore asks first and can be undone.
  backupRestore: {
    label: (t) => t.settings.backupAction,
    icon: 'history',
    variant: 'ghost',
    locked: ownOnly,
  },
  reset: {
    label: (t) => t.settings.resetAction,
    icon: 'rotate-ccw',
    variant: 'ghost',
    warns: true,
    locked: ownOnly,
  },
} satisfies Record<string, Action>;

export type ActionId = keyof typeof ACTIONS;
/** The buttons that run a command of the view (the others open a target). */
export type CommandId = 'workspaceChange' | 'txtRewrite' | 'txtClear' | 'backupRestore' | 'reset';

/** A switch: on or off at once (the state is patched before the save). */
export interface SwitchRow {
  kind: 'switch';
  id: string;
  label: Text;
  hint: Text;
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

/** A row with its buttons at the end. */
export interface ActionsRow {
  kind: 'actions';
  id: string;
  label: Text;
  hint?: Text;
  /** The hint is a value to copy (a path). */
  copy?: boolean;
  badge?: (t: Catalog, state: AppState) => string | null;
  actions: readonly ActionId[];
}

/** A value to read and copy (the app's version). */
export interface ValueRow {
  kind: 'value';
  id: string;
  label: Text;
  value: (state: AppState) => string;
}

export type Row = SwitchRow | ChoiceRow<Palette> | ChoiceRow<Language> | ActionsRow | ValueRow;

/** A card: its rows, or a block of its own (the mailbox, the portals, the keys). */
export interface CardSpec {
  id: string;
  heading: Text | null;
  hint?: Text;
  body: readonly Row[] | 'mailbox' | 'portals' | 'keys';
}

/** A whole patch of the settings from what changes (everything else `null`: unchanged). */
export const settingsPatch = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  autoArchiveDays: null,
  autoEmptyTrashDays: null,
  language: null,
  palette: null,
  ...change,
});

/** Days after which old jobs archive themselves, and the trash empties itself, when on. */

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
  { id: 'mailbox', heading: (t) => t.settings.mailbox, body: 'mailbox' },
  {
    id: 'fetch',
    heading: (t) => t.settings.automatic,
    body: [
      {
        kind: 'switch',
        id: 'auto-archive',
        label: (t) => t.settings.autoArchive(AUTO_ARCHIVE_DAYS),
        hint: (t) => t.settings.autoArchiveHint,
        on: (state) => state.autoArchiveDays > 0,
        patch: (on) => ({ autoArchiveDays: on ? AUTO_ARCHIVE_DAYS : 0 }),
        set: (state, on) => void (state.autoArchiveDays = on ? AUTO_ARCHIVE_DAYS : 0),
      },
      {
        kind: 'switch',
        id: 'auto-empty-trash',
        label: (t) => t.settings.autoEmptyTrash(AUTO_EMPTY_TRASH_DAYS),
        hint: (t) => t.settings.autoEmptyTrashHint,
        on: (state) => state.autoEmptyTrashDays > 0,
        patch: (on) => ({ autoEmptyTrashDays: on ? AUTO_EMPTY_TRASH_DAYS : 0 }),
        set: (state, on) => void (state.autoEmptyTrashDays = on ? AUTO_EMPTY_TRASH_DAYS : 0),
      },
    ],
  },
  {
    id: 'portals',
    heading: (t) => t.settings.portals,
    hint: (t) => t.settings.portalsHint,
    body: 'portals',
  },
  {
    id: 'files',
    heading: (t) => t.settings.files,
    body: [
      {
        kind: 'actions',
        id: 'workspace',
        label: (t) => t.settings.workspace,
        hint: (_t, state) => state.settings.workspace,
        copy: true,
        badge: (t, state) =>
          state.settings.workspaceIsDefault ? t.settings.workspaceDefault : null,
        actions: ['workspaceChange', 'workspaceOpen'],
      },
      {
        kind: 'actions',
        id: 'excel',
        label: (t) => t.settings.excel,
        actions: ['excelOpen', 'excelReveal'],
      },
      {
        kind: 'actions',
        id: 'overview',
        label: (t) => t.settings.overview,
        actions: ['overviewOpen', 'overviewReveal'],
      },
      {
        kind: 'actions',
        id: 'txt',
        label: (t) => t.settings.txt,
        hint: (t, state) => t.settings.txtCount(state.settings.txtFiles),
        actions: ['txtRewrite', 'txtReveal', 'txtClear'],
      },
    ],
  },
  { id: 'look', heading: (t) => t.settings.look, body: [palette, language] },
  { id: 'keys', heading: (t) => t.settings.keys, body: 'keys' },
  {
    id: 'care',
    heading: (t) => t.settings.maintenance,
    body: [
      {
        kind: 'actions',
        id: 'logs',
        label: (t) => t.settings.logs,
        actions: ['logsOpen'],
      },
      {
        kind: 'actions',
        id: 'data',
        label: (t) => t.settings.data,
        hint: (_t, state) => state.dataDir,
        copy: true,
        actions: ['dataOpen'],
      },
      {
        kind: 'actions',
        id: 'backup',
        label: (t) => t.settings.backup,
        hint: (t) => t.settings.backupHint,
        actions: ['backupRestore'],
      },
      {
        kind: 'value',
        id: 'version',
        label: (t) => t.settings.version,
        value: (state) => state.version,
      },
    ],
  },
  // The one action that deletes for good, alone and last, apart from the harmless rows.
  {
    id: 'reset',
    heading: null,
    body: [
      {
        kind: 'actions',
        id: 'reset-all',
        label: (t) => t.settings.reset,
        hint: (t) => t.settings.resetHint,
        actions: ['reset'],
      },
    ],
  },
];
