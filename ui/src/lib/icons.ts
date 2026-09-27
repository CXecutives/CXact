// The icons of the app by meaning: the one map from what an icon says to the Lucide glyph
// that draws it. Every component and view names the meaning (`icon="trash"`), never a glyph;
// components/Icon.svelte draws the glyph. One glyph per meaning and one meaning per glyph
// (core/tests/ui_contract.rs): a glyph that shows up twice says the same thing twice, so
// another icon for a meaning is one edit here, and a new meaning needs a glyph of its own.
// A new glyph also gets its import in Icon.svelte (a type error names it).

export const ICONS = {
  // The four views (lib/views.ts).
  overview: 'layout-dashboard',
  jobs: 'briefcase',
  profile: 'user-round',
  settings: 'settings',

  // The places of a job and the moves between them: the place's icon is also the move there.
  inbox: 'inbox',
  archive: 'archive',
  /** Dearchivieren: out of the archive, back into the inbox. */
  unarchive: 'archive-restore',
  /** Delete (Löschen), delete for good, empty the trash, remove the mailbox: one glyph, in
   *  red wherever it deletes. */
  trash: 'trash-2',
  /** Take back: Wiederherstellen from the trash, Rückgängig in a field. */
  undo: 'undo-2',
  star: 'star',

  // A job and its ad.
  /** Open a job (its menu's first entry). */
  open: 'corner-down-left',
  /** Opens a page in the browser: the ad, a portal, Google's app passwords. */
  external: 'external-link',
  /** An alert mail: open it, read the older ones. */
  alertMail: 'mail',
  /** Copy a prompt for an AI chat (the job, the comparison, the CV). */
  prompt: 'message-square-text',
  /** Load the whole ad (Anzeige laden). */
  details: 'download',
  /** A reason that leads to its passage in the ad. */
  jump: 'arrow-down',

  // Runs.
  /** Get the new alert mails (Postfach abrufen). */
  fetch: 'refresh-cw',
  /** Try again what failed (a load, a run, a file). */
  retry: 'rotate-cw',
  /** Stop a run. */
  cancel: 'circle-stop',
  /** The last run (the run status at the foot of the sidebar). */
  lastRun: 'history',

  // Files and folders.
  /** A document the app writes or reads: the profile file, the Bericht, the log. */
  document: 'file-text',
  excel: 'file-spreadsheet',
  /** Show a file or folder in Explorer or Finder. */
  folder: 'folder-open',
  /** Choose a file (the profile). */
  pickFile: 'file-up',
  /** Write files again (the text files). */
  rewrite: 'file-pen-line',
  /** Reset the app. */
  reset: 'rotate-ccw',
  /** Restore a copy of the database (Sicherung wiederherstellen). */
  backup: 'database-backup',

  // Editing and moving around.
  add: 'plus',
  /** Change a stored value (the mailbox, the work folder). */
  edit: 'pencil',
  /** Close, clear or take out (a toast, the reader, a search, a term). */
  close: 'x',
  copy: 'copy',
  cut: 'scissors',
  /** Paste (a field; the CV's answer). */
  paste: 'clipboard-paste',
  delete: 'delete',
  selectAll: 'text-select',
  reveal: 'eye',
  conceal: 'eye-off',
  /** More actions (the … menu). */
  more: 'ellipsis',
  /** Fold open or shut (a disclosure, a divider, a menu button). */
  expand: 'chevron-down',
  back: 'chevron-left',
  /** The way on after a step (Weiter). */
  next: 'arrow-right',
  search: 'search',
  filter: 'funnel',
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
  /** An excluded job counts with its real match anyway ("Trotzdem bewerten"). */
  include: 'scale',
  /** Met in part. */
  partial: 'circle-minus',
  /** The ad does not say. */
  unstated: 'circle-dashed',
  /** The ad is unclear: to check. */
  unclear: 'circle-question-mark',
  privacy: 'shield',
  /** A focus (Schwerpunkt) of the profile. */
  focus: 'target',

  // The facts of a job (lib/facts.ts).
  contract: 'handshake',
  money: 'euro',
  /** Pay in another currency. */
  otherMoney: 'banknote',
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
