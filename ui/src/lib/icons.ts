// The icons of the app by meaning: the one map from what an icon says to the Lucide glyph
// that draws it. Every component and view names the meaning (`icon="trash"`), never a glyph;
// components/Icon.svelte draws the glyph. One glyph per meaning and one meaning per glyph
// (core/tests/ui_contract.rs): a glyph that shows up twice says the same thing twice, so
// another icon for a meaning is one edit here, and a new meaning needs a glyph of its own.
// A new glyph also gets its import in Icon.svelte (a type error names it).

export const ICONS = {
  // The three views (lib/views.ts).
  jobs: 'briefcase',
  profile: 'user-round',
  settings: 'settings',

  // The places of a job and the moves between them: the place's icon is also the move there.
  inbox: 'inbox',
  archive: 'archive',
  /** Zurückholen: out of the archive, back into the inbox. */
  unarchive: 'archive-restore',
  /** Delete (Löschen), delete for good, empty the trash, remove the mailbox: one glyph, in
   *  red where nothing brings it back (not Löschen, which moves a job into the trash). */
  trash: 'trash-2',
  /** Take back: Wiederherstellen from the trash, Rückgängig in a field. */
  undo: 'undo-2',

  // A job and its ad.
  /** Opens a page in the browser: the ad of a job (Anzeige öffnen), a portal, Google's app
   *  passwords. */
  external: 'external-link',
  /** Mail: an alert mail (open it, read the older ones) and the mailbox they come to. */
  alertMail: 'mail',
  /** Set up an alert at a portal (Alert anlegen). */
  alertAdd: 'bell-plus',
  /** Load the whole ad (Anzeige laden). */
  details: 'download',

  // Runs.
  /** Try again what failed (a load, a run, a file). */
  retry: 'rotate-cw',
  /** Zurücksetzen: everything (Alles zurücksetzen in Daten), the list's filter. */
  reset: 'rotate-ccw',

  // Files and folders.
  /** A document the app reads: the profile file. */
  document: 'file-text',
  /** Show a file or folder in Explorer or Finder. */
  folder: 'folder-open',
  /** Choose a file (the profile). */
  pickFile: 'file-up',
  /** Restore a copy of the database (Sicherung wiederherstellen). */
  backup: 'database-backup',

  // Editing and moving around.
  add: 'plus',
  /** Change a stored value (the mailbox, the work folder). */
  edit: 'pencil',
  /** Close, clear or take out (a toast, the reader, a search, a term). */
  close: 'x',
  /** Copy: a text, a prompt for an AI chat (the job, the CV; user 2026-10-01). */
  copy: 'copy',
  cut: 'scissors',
  /** Paste (a field; the CV's answer). */
  paste: 'clipboard-paste',
  delete: 'delete',
  selectAll: 'text-select',
  reveal: 'eye',
  conceal: 'eye-off',
  /** Fold open or shut (a disclosure, a divider, a menu button). */
  expand: 'chevron-down',
  /** Zurück everywhere: the top bar, the setup, the one-column job view (one glyph per
   *  meaning, round 10). */
  back: 'arrow-left',
  /** Vor in the top bar, Weiter, Loslegen and Zu den Jobs. */
  next: 'arrow-right',
  /** The top bar's sidebar button at rest; under the pointer it says what a click does. */
  sidebar: 'panel-left',
  /** The top bar's job view button, the same way. */
  readerPane: 'panel-right',
  search: 'search',
  /** Stops a run (Abbrechen beside Jobs suchen). */
  cancel: 'square',
  filter: 'list-filter',
  signIn: 'log-in',
  signOut: 'log-out',

  // States and verdicts.
  /** Done, chosen, fulfilled (a tick). */
  check: 'check',
  /** Went well: a result (a toast, a run, a note), a requirement met. */
  success: 'circle-check',
  info: 'info',
  /** Something needs a look or failed. */
  warning: 'triangle-alert',
  /** Excluded by a hard criterion. */
  excluded: 'ban',
  /** Met in part. */
  partial: 'circle-minus',
  /** The ad is unclear: to check. */
  unclear: 'circle-question-mark',

  // The facts of a job (lib/facts.ts).
  contract: 'file-pen-line',
  start: 'calendar',
  duration: 'hourglass',
  workload: 'clock',
  remote: 'house',
  /** The company of a job (its row, its reader). */
  company: 'building-2',
  place: 'map-pin',
  industry: 'factory',
  experience: 'award',
  /** The application deadline an ad names. */
  deadline: 'calendar-clock',
  /** The contact an ad names (a person, an e-mail address, a phone number). */
  contact: 'contact-round',

  // The reader (features/jobs/Reader.svelte): its head and its Jobdetails.
  /** The portal that announced a job. */
  portal: 'globe',
  /** Not met: a requirement the profile lacks, a term of the ad that does not fit. */
  unmet: 'circle-x',
} as const;

/** What an icon says (the name every component and view uses). */
export type IconMeaning = keyof typeof ICONS;

/** The Lucide glyphs of the app (Icon.svelte imports exactly these). */
export type Glyph = (typeof ICONS)[IconMeaning];

/** A glyph's size for the eye (owner, 2026-10-31: each as large as makes sense, so that they
 *  stand in harmony). On Lucide's one grid a sparse, a narrow or a low glyph reads smaller than a
 *  dense one beside it, so these grow a step (tokens.css --icon-grow-*), their line kept. The
 *  rest fill their box (20 to 22 of the 24 units, measured with its line). */
export const GLYPH_GROWTH: Partial<Record<Glyph, 'grow-s' | 'grow-m' | 'grow-l'>> = {
  // Only a stroke or two, 14 to 18 units.
  'arrow-left': 'grow-l',
  'arrow-right': 'grow-l',
  plus: 'grow-l',
  x: 'grow-l',
  'undo-2': 'grow-l',
  // 18 wide beside glyphs of 20 and 22, and pale where it stands on its tile.
  'file-up': 'grow-l',
  'file-text': 'grow-m',
  'user-round': 'grow-m',
  // 22 wide but only 16 to 18 high.
  mail: 'grow-s',
  inbox: 'grow-s',
  eye: 'grow-s',
};

/** The glyphs whose straight lines lie on multiples of 3 of the 24 units or through the centre:
 *  at 16 they stand on the seam between two pixel rows and would draw as two grey ones, a step
 *  bolder than their neighbours. Icon.svelte moves them half a pixel at that size, so they draw
 *  crisp at 100 %. Not a glyph that stands low already (the triangle, the download). */
export const SEAM_GLYPHS: ReadonlySet<Glyph> = new Set<Glyph>([
  'arrow-left',
  'arrow-right',
  'plus',
  'x',
  'list-filter',
  'square',
  'panel-left',
  'panel-right',
  'external-link',
  'log-in',
  'log-out',
  'archive',
  'archive-restore',
  'text-select',
  'circle-minus',
]);
