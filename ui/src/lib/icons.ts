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
   *  red wherever it deletes. */
  trash: 'trash-2',
  /** Take back: Wiederherstellen from the trash, Rückgängig in a field. */
  undo: 'undo-2',
  /** A Schwerpunkt of the profile: outlined, filled while marked (a glyph made to be
   *  filled). */
  star: 'star',

  // A job and its ad.
  /** Open a job in the job view, to read it (its menu's first entry; user, 2026-10-01). */
  open: 'book-open',
  /** Opens a page in the browser: the ad, a portal, Google's app passwords. */
  external: 'external-link',
  /** Mail: an alert mail (open it, read the older ones) and the mailbox they come to. */
  alertMail: 'mail',
  /** Load the whole ad (Anzeige laden). */
  details: 'download',
  /** A reason that leads to its passage in the ad. */
  jump: 'arrow-down',

  // Runs.
  /** Get the new alert mails (Postfach abrufen). */
  fetch: 'refresh-cw',
  /** The Zeitraum of "Postfach abrufen", the button beside it. */
  range: 'sliders-horizontal',
  /** Try again what failed (a load, a run, a file). */
  retry: 'rotate-cw',
  /** Stop a run. */
  cancel: 'circle-stop',
  /** The last run (the run status at the foot of the sidebar). */
  lastRun: 'history',

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
  /** More actions (the … menu). */
  more: 'ellipsis',
  /** Fold open or shut (a disclosure, a divider, a menu button). */
  expand: 'chevron-down',
  /** Back (Zurück); in the calendar the month before. */
  back: 'chevron-left',
  /** In the calendar the month after. */
  forward: 'chevron-right',
  /** Opens the calendar beside a day field. */
  pickDay: 'calendar-days',
  /** Zurück and Vor in the top bar: through the views, places and jobs seen. */
  historyForward: 'arrow-right',
  historyBack: 'arrow-left',
  /** The top bar's sidebar button at rest; under the pointer it says what a click does. */
  sidebar: 'panel-left',
  sidebarHide: 'panel-left-close',
  sidebarShow: 'panel-left-open',
  /** The top bar's job view button, the same way. */
  readerPane: 'panel-right',
  readerHide: 'panel-right-close',
  readerShow: 'panel-right-open',
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
  /** Met in part. */
  partial: 'circle-minus',
  /** The ad does not say. */
  unstated: 'circle-dashed',
  /** The ad is unclear: to check. */
  unclear: 'circle-question-mark',
  privacy: 'shield',

  // The facts of a job (lib/facts.ts).
  contract: 'file-pen-line',
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
