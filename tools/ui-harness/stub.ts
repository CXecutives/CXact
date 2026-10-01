// Typed stand-in for @tauri-apps/api in the harness build (`vite build --mode harness`
// aliases every `@tauri-apps/api/*` import to this file). It answers every IPC command
// (typed by the generated `Commands` map) from a small in-memory store, records the calls and
// lets a test push run events. Everything the engine computes (scores, reasons, passages, the
// profile as understood, the prompts) comes from demo/snapshot.json,
// which core/tests/ui_demo_snapshot.rs writes from the invented ads of demo/ads.json; the stub
// only keeps state (docs/CHANGING.md, "The preview's demo data"):
//
//   window.__harness.calls          [command, args][]
//   window.__harness.emit(event)    send a RunEvent the way Rust does (the run's channel,
//                                   else the page's channel from its last app_state)
//   window.__harness.appRun(kind)   a run the app starts by itself (the auto fetch, a
//                                   rescore after a profile change): on the page's channel
//   window.__harness.fire(name, p)  an app event, as Rust's `window.emit` sends it
//   window.__harness.done           true once a started run has finished
//   window.__harness.detailDelay    ms `job_detail` takes (default 0)
//   window.__harness.editDetail     changes every job's reader before it is shown (a fact
//                                   or a param of the engine the demo ads do not state)
//   window.__harness.failPages      so many next `list_jobs` calls for a later page fail
//   window.__harness.holdAfter      a scripted run pauses after so many events (null = on)
//   window.__harness.job(key)       a copy of a job as the stub holds it
//   window.__harness.gone(key)      the portal no longer has the job's ad (details gone)
//   window.__harness.noMail(key)    the job's alert mail cannot be opened (no Gmail id)
//   window.__harness.form()         a copy of the stored profile's form (null: no profile)
//   window.__harness.list(query)    what `list_jobs` returns for a query (not recorded)
//
// Scenarios (`?scenario=`): default · first-run · mailbox-only · no-profile · empty ·
// many (2000 jobs) · offline · paused · running · slow · list-error · profile-broken ·
// concept (five jobs for design reviews: high, medium, low, not scored, excluded) ·
// profile-thin · profile-unreadable (a value of every criterion and wish does not read, a key
// is not read at all) · profile-remote-unread (the demo profile with one value that does not
// read: the minimum remote share of permanent roles) · reset (the state after
// "reset everything": first run, no mailbox, no profile, the report) · first-run-empty-profile
// · session-left (freelance.de still signed in while the fetch does not use the sign-in)
// · first-fetch-failed (the setup page after a first fetch that could not reach Gmail: step 3
// says why; "Abrufen" then completes and ends the setup)
// · no-minimum (a profile without a minimum day rate and a start: the reader's strip shows
// the ad's rate and start as plain facts)
// · dry-run (the demo: a Probelauf mailbox, every command that writes outside the database
// refuses with `dryRun` like `ensure_real`)
// · demo (the demo start, `CXact Demo` or `--demo`: an empty Eingang, the sample profile and
// a made-up mailbox whose fetch brings the scripted fetch's jobs; connecting a mailbox, a
// sign-in, another work folder, the reset and a restore refuse with `demo` like
// `ensure_not_demo`)
// · load-failed (the first `app_state` fails with `db`, like a start whose database cannot
// be read; a retry loads) · quiet-alert (freelance.de sent no alert mail for nine days
// before the last fetch).
// `save_mailbox` refuses the app password `falschfalschfals` with `mailAuth` (Gmail said no);
// with `?alerts=none` its check finds no alert mail. `?reset=clean`: the reset left nothing.
// `?file=focus` lets `pick_profile` choose a file with seven Schwerpunkte (the form takes five).
// Several profiles, one active (core's profile::set): with a profile the work folder holds
// the scenario's profile (1, active) and two invented test profiles (2 SAP FI/CO, 3 Cloud
// Architect, tools/test-profiles/); `load_profile` takes a third one (the page's "Aus Datei
// laden" picks a file into the form instead, `pick_profile`). A deleted active profile gives
// the place back to the one active before it, like core. A switch scores the jobs with the new active profile at once: the list rows take the
// engine's matches of that profile from the snapshot (`DEMO.profiles`); the reader keeps the
// demo profile's reasons under the new score (the snapshot has one profile's readers).
// `save_profile` refuses a minimum day rate above 100.000, a minimum remote share above 100,
// a competence with more than 70 years (with its row), more than five days a week, a second
// day below the first and a minimum duration above 120 months, like core's validation; a
// saved profile starts the rescore like core (with jobs, while no run goes), whose summary
// says what the save changed in the Eingang (`ScoreDelta`).
// Engine 16 in the demo: the profile works three to five days a week for at least six months
// and excludes "Werkstudent" and "Praktikum"; 900413 asks for two days (a check), 2804 for three
// (fits), 2802 lasts three months (a check), 2807 is excluded by its title.
// `?tick=ms` sets the pace of a scripted run (default 40); `?export=locked` lets the export
// of a run find the Excel file open; `?mail=offline` lets every fetch fail to reach Gmail,
// `?mail=no-internet` find no network at all (`offline`: "Keine Verbindung zum Internet");
// `?folder=other` lets `pick_workspace` choose another folder without a profile (the profile
// comes along), `?folder=own` one with its own; `?palette=light|dark` starts in that palette (CXact by default).
// Dates are fixed so screenshots stay stable (the tests also fix the clock). The portals
// come in the order of the backend (`Portal::ALL`).

import type {
  AppState,
  AskedTerm,
  Backup,
  Commands,
  Deleted,
  ErrorInfo,
  JobCounts,
  JobDetail,
  JobKey,
  JobQuery,
  JobView,
  Language,
  MailboxCheck,
  MoveBack,
  Notice,
  Palette,
  Place,
  PortalState,
  ProfileDraft,
  ProfileEntry,
  ProfileForm,
  ProfileInfo,
  ProfileUnderstanding,
  Reason,
  RunEvent,
  RunRequest,
  RunSummary,
  ScoreDelta,
  TermField,
  WorkMode,
} from '../../ui/src/lib/ipc/types';
import { bandOf } from '../../ui/src/lib/ipc/types/bands';
import { PORTAL_LABEL, PORTALS } from '../../ui/src/lib/ipc/types/portals';
import {
  EMPTY_FORM,
  MAX_FOCUS,
  MAX_ITEMS,
  MAX_TEXT,
  MAX_YEARS,
  NUMBER_CRITERIA,
  WORD_CRITERIA,
  type NumberCriterion,
  type WordCriterion,
} from '../../ui/src/lib/ipc/types/profile';
import snapshot from './demo/snapshot.json';
// The engine's words of the suggestions (written by core's matching::vocabulary test).
import VOCABULARY from './demo/vocabulary.json';
import type { Snapshot } from './snapshot';

interface Harness {
  calls: [string, unknown][];
  emit: (event: RunEvent) => void;
  /** A run the app starts by itself, on the page's channel (no `start_run`). */
  appRun: (kind: RunSummary['kind']) => void;
  /** An app event the way `window.emit` sends it (the native menu's `navigate`). */
  fire: (name: string, payload: unknown) => void;
  done: boolean;
  /** Milliseconds `job_detail` takes. */
  detailDelay: number;
  /** Changes every job's reader before it is shown (null: as the engine wrote it). */
  editDetail: ((detail: JobDetail) => JobDetail) | null;
  /** So many next `list_jobs` calls for a later page (offset > 0) fail. */
  failPages: number;
  /** A scripted run pauses after so many of its events until this is null again. */
  holdAfter: number | null;
  /** A copy of a job as the stub holds it (null if unknown). */
  job: (key: JobKey) => JobView | null;
  /** The portal no longer has the job's ad (details `gone`), as a fetch would find it. */
  gone: (key: JobKey) => void;
  /** The job's alert mail cannot be opened (no Gmail id): `hasMail` false. */
  noMail: (key: JobKey) => void;
  /** A copy of the stored profile's form (null without a profile). */
  form: () => ProfileForm | null;
  /** What `list_jobs` returns for a query (the inbox by match unless it says otherwise),
   *  without recording a call: the specs read the demo data here instead of copying it. */
  list: (query: Partial<JobQuery>) => { jobs: JobView[]; counts: JobCounts };
  /** The text `clipboard_text` returns (null: the browser's clipboard, if it allows it). */
  clipboard: string | null;
  /** The page holds unsaved changes (its last `set_unsaved`). */
  unsaved: boolean;
  /** The window was closed (`close_window`, or a close request without unsaved changes). */
  closed: boolean;
  /** The user closes the window (X, Alt+F4, Cmd+Q/W): like main.rs, the page is asked
   *  (`close-requested`) while it holds unsaved changes, then (`close-running`) while a
   *  fetch runs, else the window closes; a second close while it asks about the fetch
   *  closes anyway. Closing while a run goes cancels it first (`closing`). */
  requestClose: () => void;
  /** A run goes as the backend sees it (from `start_run`'s answer on; the page shows the run
   *  line a task earlier). */
  runs: () => boolean;
  /** The window is maximized (`window_button` maximize toggles it and sends
   *  `window-state`, like platform.rs). */
  maximized: boolean;
  /** The window was minimized (`window_button` minimize). */
  minimized: boolean;
  /** A text of the UI's catalog in the page's language (`'keysHelp.fetch'`, a function
   *  entry called with `args`): specs read texts from the catalog instead of retyping them. */
  text: (path: string, ...args: unknown[]) => Promise<string>;
  /** "Verbinden" signs in and counts until this is false again or `cancel_run` stops it; it
   *  holds the app meanwhile (`Activity::Mailbox`): a run is refused as busy. */
  holdMailbox: boolean;
}

declare global {
  interface Window {
    __harness: Harness;
  }
}

/* ------------------------------------------------------------------ channel */

/**
 * Tauri's Channel as the page sees it (@tauri-apps/api/core): messages carry the index of
 * their Rust-side sender and are delivered in that order; the message `end` (the Rust side
 * dropped its channel) unregisters the callback, after which nothing arrives any more.
 */
export class Channel<T = unknown> {
  onmessage: (message: T) => void = () => undefined;
  #next = 0;
  #pending = new Map<number, T>();
  #end: number | null = null;
  #closed = false;

  /** What `window.__TAURI_INTERNALS__.runCallback` does with one raw message. */
  receive(raw: { index: number; message?: T; end?: true }): void {
    if (this.#closed) return;
    if (raw.end) {
      if (raw.index === this.#next) this.#closed = true;
      else this.#end = raw.index;
      return;
    }
    if (raw.index !== this.#next) {
      this.#pending.set(raw.index, raw.message as T);
      return;
    }
    this.onmessage(raw.message as T);
    this.#next += 1;
    while (this.#pending.has(this.#next)) {
      const message = this.#pending.get(this.#next) as T;
      this.#pending.delete(this.#next);
      this.onmessage(message);
      this.#next += 1;
    }
    if (this.#next === this.#end) this.#closed = true;
  }
}

/**
 * The Rust side of one `channel` argument (tauri::ipc::Channel): its own message counter
 * from 0, shared by its clones; once the last clone is dropped it sends `end`. Delivery is
 * asynchronous, as with `webview.eval`.
 */
class Sender {
  #index = 0;
  #holders = 0;

  constructor(readonly channel: Channel<RunEvent>) {}

  hold(): Sender {
    this.#holders += 1;
    return this;
  }

  send(event: RunEvent): void {
    const index = this.#index++;
    const message = structuredClone(event);
    queueMicrotask(() => this.channel.receive({ index, message }));
  }

  release(): void {
    this.#holders -= 1;
    if (this.#holders > 0) return;
    const index = this.#index;
    queueMicrotask(() => this.channel.receive({ index, end: true }));
  }
}

/** The page's channel from its last `app_state` (commands::scoring keeps it). */
let pageSender: Sender | null = null;
/** The channel of the run in progress (commands::run::RunHandle). */
let runSender: Sender | null = null;

/* ----------------------------------------------------------------- scenario */

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ?? 'default';
/** `?platform=macos` shows the demo as a Mac shows it: keychain and Mac paths. */
const MAC = params.get('platform') === 'macos';
const VAULT = MAC ? 'macosKeychain' : 'windowsCredentialManager';

/** What "Verbinden" finds in the demo mailbox (mail::check::check_mailbox). */
const DEMO_CHECK: MailboxCheck = {
  days: 30,
  total: 34,
  perPortal: [
    { portal: 'linkedin', count: 20 },
    { portal: 'freelancermap', count: 14 },
    { portal: 'freelance', count: 0 },
  ],
};
/** `alerts=none`: "Verbinden" finds no alert mail of any portal. */
const NO_ALERTS: MailboxCheck = {
  days: 30,
  total: 0,
  perPortal: DEMO_CHECK.perPortal.map((count) => ({ ...count, count: 0 })),
};
const HOME = MAC ? '/Users/demo' : 'C:/Users/demo';
const DATA_DIR = MAC
  ? '/Users/demo/Library/Application Support/job-alert-monitor'
  : 'C:/Users/demo/AppData/Roaming/job-alert-monitor';
const TICK = Number(params.get('tick') ?? 40);
const DELAY = scenario === 'slow' ? 900 : 0;
const EXPORT_LOCKED = params.get('export') === 'locked';
const MAIL_OFFLINE = scenario === 'offline' || params.get('mail') === 'offline';
/** `mail=no-internet`: every fetch finds no network at all (`offline`, not `mailConnect`). */
const NO_INTERNET = params.get('mail') === 'no-internet';
/** `mail=uncounted`: "Verbinden" signs in, but the count does not finish in time. */
const MAIL_UNCOUNTED = params.get('mail') === 'uncounted';
/** The app's language as the backend says it (`lang=en`; German by default). */
const LANGUAGE: Language = params.get('lang') === 'en' ? 'en' : 'de';
/** The palette as the backend says it (`palette=light|dark`; CXact by default). */
const PALETTE: Palette =
  params.get('palette') === 'dark' ? 'dark' : params.get('palette') === 'light' ? 'light' : 'cxact';

const NOW = new Date('2026-09-24T09:30:00+02:00').getTime();
const HOUR = 3_600_000;
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
const later = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString();

/* ----------------------------------------------------------------- fixtures */

type Match = NonNullable<JobView['match']>;

/** What the engine computed for the demo (snapshot.ts): the stub never scores, explains or
 *  writes a prompt itself. */
const DEMO = snapshot as unknown as Snapshot;

/** The demo job (`portal:id`) whose reader and prompts a job of the scenario `many` shows. */
const SOURCE = new Map<string, string>();
const sourceOf = (key: JobKey): string => SOURCE.get(markKey(key)) ?? markKey(key);

/** The demo's jobs as the engine left them. */
function sampleJobs(): JobView[] {
  return structuredClone(DEMO.jobs);
}

/** The scenario `many`: four demo jobs in turn under new ids (100000 on), their titles
 *  numbered: one the engine could not score (on top with the others without a number), a high, a mid and an
 *  excluded one (every fourth from the fourth); the portals in turn, every third one unread,
 *  a quarter of an hour apart. */
const MANY = ['freelancermap:2806', 'freelancermap:2801', 'freelancermap:2802', 'freelance:900412'];

/** The portals of the many jobs in turn (the alert portals of the first versions). */
const MANY_PORTALS = ['linkedin', 'freelance', 'freelancermap'] as const;

function manyJobs(count: number): JobView[] {
  const base = MANY.map((key) => DEMO.jobs.find((j) => markKey(j.key) === key)!);
  return Array.from({ length: count }, (_, i) => {
    const from = base[i % base.length]!;
    const portal = MANY_PORTALS[i % MANY_PORTALS.length]!;
    const key = { portal, id: String(100000 + i) };
    SOURCE.set(markKey(key), markKey(from.key));
    return {
      ...structuredClone(from),
      key,
      portal,
      title: `${from.title} ${i + 1}`,
      mailDate: at(i / 4),
      firstSeenAt: at(i / 4),
      unread: i % 3 === 0,
      alsoOn: [],
    };
  });
}

/** A competence row of a form (a chosen file's, a scenario's). */
const row = (name: string, years: number | null, aliases: string[], origin: number) => ({
  name,
  years,
  aliases,
  origin,
});
/** The sample profile (demo/profile.json) with what the engine understood of it. */
const PROFILE: ProfileInfo = DEMO.profile;
const PROFILE_FORM: ProfileForm = PROFILE.form!;

/** The profile's criteria as the engine reads them (`ProfileUnderstanding.criteria`, the
 *  params flat like core's view: a list is one text). */
function criteriaOf(c: ProfileForm['criteria']): Notice[] {
  const minDays = c.workloadMinDays ?? null;
  const maxDays = c.workloadMaxDays ?? null;
  const words = c.exclusionWords ?? [];
  return [
    { code: 'minDayRate', params: { set: c.minDayRate !== null, min: c.minDayRate } },
    {
      code: 'countries',
      params: { set: c.countries.length > 0, countries: c.countries.join(', ') },
    },
    { code: 'noAnue', params: { set: c.noAnue } },
    { code: 'noPermanent', params: { set: c.noPermanent } },
    {
      code: 'availability',
      params: {
        set: c.available.kind !== 'unset',
        from:
          c.available.kind === 'from'
            ? c.available.date
            : c.available.kind === 'now'
              ? 'now'
              : null,
      },
    },
    { code: 'minSalary', params: { set: c.minSalary !== null, min: c.minSalary } },
    { code: 'permanentRegion', params: { set: c.permanentPlaces.length > 0, places: null } },
    { code: 'workload', params: { set: minDays !== null || maxDays !== null, minDays, maxDays } },
    { code: 'duration', params: { set: (c.minMonths ?? null) !== null, min: c.minMonths ?? null } },
    { code: 'exclusionWords', params: { set: words.length > 0, words: words.join(', ') } },
  ];
}

/** What the engine understands of a form (a rough stand-in: the form's own terms). */
function understoodOf(form: ProfileForm, warnings: Notice[]): ProfileUnderstanding {
  const names = form.competences.map((r) => r.name);
  const terms = [...names, ...form.tools, ...form.keywords];
  return {
    competenceCount: terms.length,
    competences: terms,
    sources: [
      { path: 'kernkompetenzen[].kompetenz', count: names.length },
      { path: 'methoden_tools[].name', count: form.tools.length },
      { path: 'keywords[]', count: form.keywords.length },
    ].filter((s) => s.count > 0),
    criteria: criteriaOf(form.criteria),
    warnings,
    packs: packsOf(form),
    years: form.years,
    degrees: form.degrees,
    focus: form.focus,
    roles: form.roles,
    wishes: form.wishes,
  };
}

/** The IT sample of the fixtures (sample_profile_it.json) as a chosen file: a value of it
 *  does not read (the minimum day rate). */
const FILE_FORM: ProfileForm = {
  ...structuredClone(PROFILE_FORM),
  name: 'Jonas Muster',
  title: '',
  competences: [
    row('SAP-Projektleitung', 12, [], 0),
    row('SAP S/4HANA Migration', 6, [], 1),
    row('Programmmanagement', 8, [], 2),
  ],
  strengths: [],
  keywords: [],
  degrees: [],
  industries: [],
  tools: [],
  certificates: [],
  languages: [],
  focus: [],
  roles: [],
  wishes: { dayRate: null, remote: 'partly', regions: [], industries: [] },
  criteria: { ...structuredClone(PROFILE_FORM.criteria), minDayRate: null },
};
const FILE_DRAFT: ProfileDraft = {
  form: FILE_FORM,
  source: '{"name": "Jonas Muster"}',
  quality: 'thin',
  understood: understoodOf(FILE_FORM, [
    { code: 'fewCompetences', params: { count: 3 } },
    {
      code: 'criterionNotUnderstood',
      params: { key: 'min_tagessatz', value: '"ab 900"', field: 'minDayRate' },
    },
  ]),
};

/** A chosen file with seven Schwerpunkte: the form takes the first five (core's form::read),
 *  the engine says how many the file named. */
const FOCUS_FORM: ProfileForm = {
  ...structuredClone(PROFILE_FORM),
  name: 'Jonas Muster',
  competences: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n, index) =>
    row(`Kompetenz ${n}`, null, [], index),
  ),
  focus: ['A', 'B', 'C', 'D', 'E'].map((n) => `Kompetenz ${n}`),
};
const FOCUS_DRAFT: ProfileDraft = {
  form: FOCUS_FORM,
  source: '{"name": "Jonas Muster"}',
  quality: 'good',
  understood: understoodOf(FOCUS_FORM, [{ code: 'focusTrimmed', params: { count: 7, max: 5 } }]),
};

/** A value that does not read, as the engine reports it (the field it belongs to added by
 *  core's view::profile_warning). */
const unread = (key: string, value: string, field: string | null): Notice => ({
  code: 'criterionNotUnderstood',
  params: field === null ? { key, value } : { key, value, field },
});

/** A profile whose criteria and wishes do not read: each field says so, a Schwerpunkt that is
 *  no competence and a target role without a field too, and a key of the criteria the app
 *  does not read at all. */
const UNREADABLE_PROFILE: ProfileInfo = {
  ...PROFILE,
  understood: {
    ...PROFILE.understood!,
    warnings: [
      { code: 'availabilityNotUnderstood', params: { value: 'bald' } },
      unread('min_tagessatz', '"teuer"', 'minDayRate'),
      unread('laender', '"Atlantis"', 'countries'),
      unread('ausgeschlossene_vertragsarten', '5', 'contracts'),
      unread('remote_ausserhalb_erlaubt', '"vielleicht"', 'remoteOutside'),
      unread('min_jahresgehalt', '"hoch"', 'minSalary'),
      unread('festanstellung_orte', '[]', 'permanentPlaces'),
      unread('festanstellung_remote_min', '"viel"', 'permanentRemoteMin'),
      unread('schwerpunkte', 'Treasury', 'focus'),
      unread('wunschrollen', 'Head of', 'roles'),
      unread('tagessatz_wunsch', '"hoch"', 'wishDayRate'),
      unread('remote', '"egal"', 'remote'),
      unread('regionen', '5', 'regions'),
      unread('branchen', '{}', 'wishIndustries'),
      // Engine 16: a word for a day, a day beyond the week, a word for months, a number for
      // words.
      unread('auslastung_min_tage', '"viel"', 'workloadMinDays'),
      unread('auslastung_max_tage', '9', 'workloadMaxDays'),
      unread('min_laufzeit_monate', '"lang"', 'minMonths'),
      unread('ausschlusswoerter', '5', 'exclusionWords'),
      { code: 'ignoredKeys', params: { keys: 'tagessatz_max' } },
    ],
  },
  form: {
    ...structuredClone(PROFILE_FORM),
    focus: ['Controlling', 'Treasury'],
    roles: ['Interim CFO', 'Head of'],
    wishes: { dayRate: null, remote: null, regions: [], industries: [] },
    criteria: {
      minDayRate: null,
      countries: [],
      noAnue: false,
      noPermanent: false,
      available: { kind: 'unset' },
      remoteOutside: true,
      minSalary: null,
      permanentPlaces: [],
      permanentRemoteMin: null,
      workloadMinDays: null,
      workloadMaxDays: null,
      minMonths: null,
      exclusionWords: [],
    },
  },
};

/** The demo profile with one value of the file that does not read: its minimum remote share
 *  of permanent roles says "viel" (the field stays empty, core names the key and the field). */
const REMOTE_UNREAD_PROFILE: ProfileInfo = {
  ...PROFILE,
  understood: {
    ...PROFILE.understood!,
    warnings: [unread('festanstellung_remote_min', '"viel"', 'permanentRemoteMin')],
  },
  form: {
    ...structuredClone(PROFILE_FORM),
    criteria: { ...structuredClone(PROFILE_FORM.criteria), permanentRemoteMin: null },
  },
};

/** The prompt that has an AI write a profile file from a CV (the real text lives in
 *  core/src/profile/prompt.rs). */
const PROMPT =
  'Du unterstützt mich als KI-Assistent bei meinem Beraterprofil. Du kennst meine Job-Alert-App nicht.';

/** The domain packs the engine would switch on for a form (a rough stand-in: words of the
 *  competences, keywords and tools). */
function packsOf(form: ProfileForm): string[] {
  const words = [...form.competences.map((row) => row.name), ...form.keywords, ...form.tools].join(
    ' ',
  );
  return [
    ...(/controlling|ifrs|hgb|finanz|konsolid|treasury|buchhalt/i.test(words) ? ['finance'] : []),
    ...(/(^|[^a-z])sap([^a-z]|$)/i.test(words) ? ['sap'] : []),
  ];
}

/** A saved form: trimmed, empty rows gone, origins as the backend reads them back. */
/**
 * The keywords a save makes of `before` (the copy the view showed) as `after`, applied to the
 * stored list `now`, like core's `profile::form::rebase`: the terms of `after` in its order
 * and spelling, without a term the store dropped meanwhile (an untouched term keeps the
 * stored spelling); a term the store gained meanwhile stays after the term it follows there.
 */
function mergeKeywords(now: string[], before: string[], after: string[]): string[] {
  const find = (list: string[], text: string): number => {
    const key = text.toLowerCase();
    return list.findIndex((item) => item.toLowerCase() === key);
  };
  const out: string[] = [];
  for (const text of after) {
    const old = find(before, text);
    const current = find(now, text);
    if (old >= 0 && current < 0) continue;
    out.push(old >= 0 && before[old] === text ? now[current]! : text);
  }
  let at = 0;
  for (const text of now) {
    const found = find(out, text);
    if (found >= 0) at = found + 1;
    else if (find(before, text) < 0) out.splice(at++, 0, text);
  }
  return out;
}

function savedForm(form: ProfileForm): ProfileForm {
  const clean = (items: string[]): string[] => items.map((t) => t.trim()).filter((t) => t !== '');
  return {
    ...structuredClone(form),
    name: form.name.trim(),
    title: form.title.trim(),
    competences: form.competences
      .filter((r) => r.name.trim() !== '')
      .map((r, index) => ({ ...r, name: r.name.trim(), aliases: clean(r.aliases), origin: index })),
    languages: form.languages
      .filter((r) => r.language.trim() !== '')
      .map((r, index) => ({ ...r, language: r.language.trim(), origin: index })),
    focus: clean(form.focus),
    // Every field of engine 16 is there once saved (core's form always has them).
    criteria: {
      ...structuredClone(form.criteria),
      workloadMinDays: form.criteria.workloadMinDays ?? null,
      workloadMaxDays: form.criteria.workloadMaxDays ?? null,
      minMonths: form.criteria.minMonths ?? null,
      exclusionWords: clean(form.criteria.exclusionWords ?? []),
    },
  };
}

/** The sources the app searches itself (core's `Way::Search`). */
const SEARCHED: ReadonlySet<PortalState['portal']> = new Set([
  'hays',
  'freelancermap',
  'michaelpage',
  'solcom',
  'gulp',
  'interimx',
]);

const portal = (name: PortalState['portal'], extra: Partial<PortalState> = {}): PortalState => ({
  portal: name,
  way: SEARCHED.has(name) ? 'search' : 'alert',
  enabled: true,
  login: name === 'freelance' ? 'optional' : 'none',
  loginEnabled: false,
  signedIn: name === 'freelance' ? false : null,
  health: { kind: 'ok' },
  actionNeeded: false,
  quota: null,
  lastAlert: null,
  ...extra,
});

/** The date of a portal's last alert mail (store::last_alerts): the mail of its newest job. */
function lastAlertOf(name: PortalState['portal']): string | null {
  const dates = jobs.flatMap((j) => (j.portal === name && j.mailDate !== null ? [j.mailDate] : []));
  return dates.length === 0
    ? null
    : dates.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
}

/** What the scoring of the last fetch found: the demo's jobs as the engine judged them, the
 *  one whose page is still to come pending. */
function demoScoring(): RunSummary['score'] {
  const judged = DEMO.jobs.filter((j) => j.detail.kind !== 'pending').map((j) => j.match);
  const count = (status: Match['status']): number =>
    judged.filter((m) => m?.status === status).length;
  const scores = judged.flatMap((m) => (m?.status === 'scored' ? [m.score] : []));
  return {
    scored: count('scored'),
    excluded: count('excluded'),
    unscorable: count('unscorable'),
    pending: DEMO.jobs.length - judged.length,
    best: scores.length === 0 ? null : Math.max(...scores),
    delta: null,
  };
}

function lastRun(outcome: RunSummary['outcome'] = { kind: 'completed' }): RunSummary {
  return {
    run: 41,
    kind: 'fetch',
    outcome,
    dryRun: false,
    startedAt: at(1.2),
    finishedAt: at(1),
    scan: {
      mailsFound: 9,
      mailsChecked: 9,
      mailsDefective: 0,
      alertMails: 9,
      emptyAlerts: 1,
      postings: 14,
      new: 7,
      known: 6,
      dup: 1,
    },
    perPortal: [
      {
        portal: 'linkedin',
        new: 2,
        known: 2,
        dup: 1,
        fetched: 1,
        failed: 0,
        gone: 0,
        skipped: 1,
        stopped: null,
      },
      {
        portal: 'freelance',
        new: 2,
        known: 1,
        dup: 0,
        fetched: 2,
        failed: 0,
        gone: 0,
        skipped: 0,
        stopped: null,
      },
      {
        portal: 'freelancermap',
        new: 3,
        known: 3,
        dup: 0,
        fetched: 3,
        failed: 0,
        gone: 0,
        skipped: 0,
        stopped: null,
      },
    ],
    // Seven new, one of them excluded; two of the others fit well.
    newJobs: { count: 6, high: 2 },
    score: demoScoring(),
    export: {
      overviewXlsx: 'C:/Users/demo/Jobs/Uebersicht.xlsx',
      overviewCsv: null,
      backup: null,
      error: null,
    },
    emptyAlerts: [
      {
        portal: 'freelance',
        subject: 'Neue Projekte für Sie',
        date: at(20),
        gmailId: '18c2f0a9d1e4b7a3',
      },
    ],
  };
}

/* -------------------------------------------------------------------- store */

let jobs: JobView[] = [];
let state: AppState;
/** Core's one backup of the active profile: the previous one of every save;
 *  `restore_profile` without a number swaps it with the profile. */
let backupProfile: ProfileInfo | null = null;

/** A profile of the work folder (core's profile::set): its number, the name the user gave
 *  it, what the app shows of it while another one is active (the active one is
 *  `state.profile`) and the engine's matches of the demo's jobs with it (`portal:id`; null:
 *  the demo profile's). */
interface StubProfile {
  id: number;
  name: string | null;
  info: ProfileInfo | null;
  matches: Record<string, Match | null> | null;
}
let profiles: StubProfile[] = [];
let activeId: number | null = null;
/** The profile active before the active one (core's index `previous`). */
let previousId: number | null = null;
/** Deleted profiles by number (their backup), for the undo. */
const deletedProfiles = new Map<number, StubProfile>();
/** The number of the other profiles of the demo (`DEMO.profiles`) the work folder starts
 *  with; the next one is the file "Aus Datei laden" chooses. */
const FOLDER_PROFILES = 2;
/** The copies of the database in the data folder, newest first (`list_backups`). */
let backups: Backup[] = [];

/** The demo's copies (store/backup.rs): three days and one from before an update. */
const DEMO_BACKUPS: readonly Backup[] = [
  { id: 'jobs-2026-09-24.db', kind: 'daily', at: '2026-09-24T06:05:00Z', bytes: 13_002_342 },
  { id: 'jobs-2026-09-23.db', kind: 'daily', at: '2026-09-23T06:41:00Z', bytes: 12_845_056 },
  { id: 'jobs-2026-09-22.db', kind: 'daily', at: '2026-09-22T07:12:00Z', bytes: 12_320_768 },
  { id: 'jobs.pre-v5.db', kind: 'update', at: '2026-09-18T08:20:00Z', bytes: 11_796_480 },
];
/** Copies from before a restore kept, like core. */
const RESTORE_KEPT = 3;

/** The name core gives the copy before a restore at `ms` (UTC, to the millisecond). */
function restoreName(ms: number): string {
  // 2026-09-24T07:30:00.000Z: 20260924, 073000, 000
  const digits = new Date(ms).toISOString().replace(/\D/g, '');
  return `jobs.before-restore-${digits.slice(0, 8)}-${digits.slice(8, 14)}-${digits.slice(14, 17)}.db`;
}

function initial(): void {
  jobs = scenario === 'many' ? manyJobs(2000) : sampleJobs();
  backups =
    scenario === 'first-run' || scenario === 'reset' ? [] : structuredClone([...DEMO_BACKUPS]);
  // The last fetch brought a job whose page is still to come: the stub holds it before the
  // catch-up scores it (the list's jobs without a score stand first).
  for (const j of jobs) if (j.detail.kind === 'pending') j.match = null;
  state = {
    platform: MAC ? 'macos' : 'windows',
    // The app's version (src-tauri's CARGO_PKG_VERSION, the workspace's).
    version: '3.0.0',
    dryRun: false,
    demo: false,
    firstRun: false,
    running: null,
    settings: {
      workspace: `${HOME}/Documents/Job-Alerts`,
      workspaceIsDefault: true,
      excelPath: `${HOME}/Documents/Job-Alerts/auswertung/JobAlerts.xlsx`,
      excelExists: true,
      csvPath: `${HOME}/Documents/Job-Alerts/auswertung/JobAlerts.csv`,
      // `exportCsv` is off: the app writes none.
      csvExists: false,
    },
    mailbox: {
      user: 'alerts.demo@gmail.com',
      vault: VAULT,
      error: null,
      check: null,
      checkedAt: null,
    },
    profile: PROFILE,
    profiles: [],
    // Every portal counts its calls (the backend sends the numbers of each): 100 a day.
    portals: [
      portal('linkedin', { quota: { usedHour: 4, capHour: 30, usedDay: 23, capDay: 100 } }),
      portal('freelance', { quota: { usedHour: 2, capHour: 20, usedDay: 11, capDay: 100 } }),
      portal('freelancermap', { quota: { usedHour: 9, capHour: 40, usedDay: 86, capDay: 100 } }),
      portal('hays', { quota: { usedHour: 6, capHour: 30, usedDay: 18, capDay: 100 } }),
      portal('michaelpage', { quota: { usedHour: 2, capHour: 30, usedDay: 6, capDay: 100 } }),
      portal('solcom', { quota: { usedHour: 2, capHour: 30, usedDay: 6, capDay: 100 } }),
      portal('gulp', { quota: { usedHour: 0, capHour: 30, usedDay: 0, capDay: 100 } }),
      portal('interimx', { quota: { usedHour: 0, capHour: 30, usedDay: 0, capDay: 100 } }),
    ],
    sources: [],
    setupDone: true,
    fetchRange: 'sinceLast',
    exportExcel: true,
    exportCsv: false,
    autoFetch: false,
    fetchMail: true,
    fetchSearch: true,
    language: LANGUAGE,
    palette: PALETTE,
    lastRun: lastRun(),
    counts: countsOf([]),
    matchPending: 0,
    dataDir: DATA_DIR,
    logDir: `${DATA_DIR}/logs`,
    resetReport: null,
  };
  switch (scenario) {
    case 'first-run':
      jobs = [];
      state.firstRun = true;
      state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
      state.profile = null;
      state.lastRun = null;
      state.settings.excelExists = false;
      break;
    case 'no-files':
      // A connected mailbox, but nothing written to the workspace yet.
      state.settings.excelExists = false;
      break;
    case 'mailbox-only':
      jobs = [];
      state.firstRun = true;
      state.profile = null;
      state.lastRun = null;
      break;
    case 'first-fetch-failed':
      // A failed first fetch keeps the setup page (only a completed one ends it).
      jobs = [];
      state.firstRun = true;
      state.lastRun = lastRun({ kind: 'failed', error: { kind: 'mailConnect', params: {} } });
      break;
    case 'first-run-empty-profile':
      // A profile that names no competences: nothing can be scored with it.
      jobs = [];
      state.firstRun = true;
      state.lastRun = null;
      state.profile = { ...PROFILE, quality: 'empty' };
      break;
    case 'no-minimum':
      state.profile = {
        ...PROFILE,
        form: { ...PROFILE_FORM, criteria: { ...PROFILE_FORM.criteria, minDayRate: null } },
      };
      break;
    case 'no-profile':
      state.profile = null;
      for (const j of jobs) j.match = null;
      break;
    case 'concept': {
      // Five jobs for design reviews: high, medium, low, not scored, excluded.
      const keep = [
        'freelancermap:2801',
        'freelance:900411',
        'freelancermap:2804',
        'linkedin:4100200302',
        'freelance:900412',
      ];
      jobs = jobs.filter((j) => keep.includes(`${j.key.portal}:${j.key.id}`));
      break;
    }
    case 'empty':
      jobs = [];
      state.lastRun = {
        ...lastRun(),
        perPortal: lastRun().perPortal.map((p) => ({ ...p, new: 0 })),
        newJobs: { count: 0, high: 0 },
        emptyAlerts: [],
      };
      break;
    case 'offline':
      state.lastRun = lastRun({ kind: 'failed', error: { kind: 'mailConnect', params: {} } });
      break;
    case 'last-failed':
      // The last fetch before this start failed; Gmail answers again now.
      state.lastRun = lastRun({ kind: 'failed', error: { kind: 'mailConnect', params: {} } });
      break;
    case 'paused':
      state.portals[0]!.health = { kind: 'paused', until: later(95), reason: 'throttled' };
      state.portals[1]!.health = { kind: 'layoutSuspect', emptyMails: 2, pages: 0 };
      // Alert mails without jobs ask her to look (core's PortalHealth::action_needed).
      state.portals[1]!.actionNeeded = true;
      // Near the day's limit: the meter turns ochre.
      state.portals[2]!.quota = { usedHour: 12, capHour: 40, usedDay: 92, capDay: 100 };
      break;
    case 'reset':
      // After "reset everything" the app starts empty: the first-run page, with the report.
      jobs = [];
      state.firstRun = true;
      state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
      state.profile = null;
      state.lastRun = null;
      state.settings.excelExists = false;
      state.resetReport = { removed: 12, failed: params.get('reset') === 'clean' ? 0 : 1 };
      break;
    case 'session-left':
      // A sign-in still stored while the fetch does not use it: the row offers Abmelden.
      state.portals[1]!.signedIn = true;
      break;
    case 'demo':
      // Like `create_demo_data`: an empty Eingang, no fetch yet, the sample profile; the
      // made-up mailbox brings jobs with every fetch.
      state.demo = true;
      jobs = [];
      state.mailbox = {
        user: 'demo@example.com',
        vault: VAULT,
        error: null,
        check: null,
        checkedAt: null,
      };
      state.lastRun = null;
      state.settings.excelExists = false;
      break;
    case 'dry-run':
      state.dryRun = true;
      state.mailbox = {
        user: 'probelauf@example.org',
        vault: VAULT,
        error: null,
        check: null,
        checkedAt: null,
      };
      break;
    case 'profile-broken':
      state.profile = {
        ...PROFILE,
        quality: null,
        understood: null,
        parseError: { kind: 'invalid', params: { reason: 'profileNotJson', line: 12, column: 3 } },
        form: null,
      };
      // Like the backend at the start: the scores of a profile that no longer reads go.
      for (const job of jobs) job.match = null;
      break;
    case 'profile-thin':
      state.profile = {
        ...PROFILE,
        quality: 'thin',
        understood: {
          ...PROFILE.understood!,
          competenceCount: 3,
          competences: ['Controlling', 'Treasury', 'IFRS'],
          packs: ['finance'],
          focus: [],
          roles: [],
          warnings: [{ code: 'fewCompetences', params: { count: 3 } }],
        },
        form: {
          ...structuredClone(PROFILE_FORM),
          competences: [row('Controlling', 18, [], 0), row('Treasury', null, [], 1)],
          focus: [],
          roles: [],
          keywords: ['IFRS'],
          years: null,
          degrees: [],
          industries: [],
          tools: [],
          certificates: [],
          languages: [],
          wishes: { dayRate: null, remote: null, regions: [], industries: [] },
        },
      };
      break;
    case 'profile-unreadable':
      state.profile = UNREADABLE_PROFILE;
      break;
    case 'profile-remote-unread':
      state.profile = REMOTE_UNREAD_PROFILE;
      break;
    case 'running':
      state.running = {
        kind: 'fetch',
        startedAt: at(0.05),
        replay: [
          { type: 'progress', step: 'scan', portal: null, done: 9, total: 9 },
          { type: 'progress', step: 'fetch', portal: null, done: 5, total: 7 },
          {
            type: 'portalHealth',
            portal: 'freelance',
            health: { kind: 'paused', until: later(12), reason: 'throttled' },
            actionNeeded: false,
          },
          { type: 'status', code: 'waiting', portal: 'linkedin', until: later(0.7) },
        ],
      };
      break;
    case 'quiet-alert':
      // freelance.de sent its last alert mail nine days before the last fetch: its alert
      // may have run out.
      state.portals[1]!.lastAlert = at(9 * 24);
      break;
  }
  for (const p of state.portals) p.lastAlert ??= lastAlertOf(p.portal);
  deletedProfiles.clear();
  activeId = state.profile === null ? null : 1;
  profiles =
    state.profile === null
      ? []
      : [
          { id: 1, name: null, info: null, matches: null },
          // The dry run lists its sample profile only.
          ...(state.dryRun ? [] : DEMO.profiles.slice(0, FOLDER_PROFILES)).map((other, index) => ({
            id: index + 2,
            name: null,
            info: structuredClone(other.profile),
            matches: other.matches,
          })),
        ];
  refresh();
}

/**
 * The counts of store::job_page: per place, and the excluded ones of each place.
 */
function countsOf(list: JobView[]): JobCounts {
  const c: JobCounts = {
    inbox: 0,
    archive: 0,
    trash: 0,
    excluded: 0,
    excludedArchive: 0,
    excludedTrash: 0,
  };
  for (const j of list) {
    const out = j.match?.status === 'excluded';
    c[j.place] += 1;
    if (out && j.place === 'inbox') c.excluded += 1;
    if (out && j.place === 'archive') c.excludedArchive += 1;
    if (out && j.place === 'trash') c.excludedTrash += 1;
  }
  return c;
}

/** The excluded jobs of the Eingang and those scored in the high band (a rescore's
 *  `ScoreDelta`). */
function bandsOf(list: JobView[]): { excluded: number; high: number } {
  const inbox = list.filter((j) => j.place === 'inbox');
  return {
    excluded: inbox.filter((j) => j.match?.status === 'excluded').length,
    high: inbox.filter((j) => j.match?.status === 'scored' && bandOf(j.match.score) === 'high')
      .length,
  };
}

/** A new job (store::NEW): not opened yet and not excluded, in any place. */
const isNewJob = (j: JobView): boolean => j.unread && j.match?.status !== 'excluded';

/* ------------------------------------------------------------------- marks */

/** When a job went to the trash and from where (the archive keeps its time there), deleted
 *  keys and the excluded verdicts the user overrode (store::marks). */
const trashedAt = new Map<string, string>();
const trashedFrom = new Map<string, Place>();
const tombstones = new Set<string>();
const overridden = new Map<string, Match>();
const markKey = (key: JobKey): string => `${key.portal}:${key.id}`;

/** The list of a query (store::job_page): a place. */
function inQuery(j: JobView, query: Pick<JobQuery, 'place'>): boolean {
  return j.place === query.place;
}

/** Employment pays a salary, no day rate (store::EMPLOYMENT). */
const employed = (j: JobView): boolean =>
  j.match?.facts.contract === 'permanent' || j.match?.facts.contract === 'anue';

/** The day rate in euros as store::day_rate reads it: an hourly rate times 8; none for
 *  employment, a rate in another currency and without one. */
function dayRate(j: JobView): number | null {
  const facts = j.match?.facts ?? null;
  if (facts === null || facts.rate === null || employed(j)) return null;
  if (facts.currency !== null && facts.currency !== 'EUR') return null;
  return facts.hourly === true ? facts.rate * 8 : facts.rate;
}

/** The work mode as store::filter_condition reads it: the remote share the ad states first
 *  (all of it remote, none of it on site, anything between hybrid), the location's work mode
 *  only without one; null when neither says. */
function workModeOf(j: JobView): WorkMode | null {
  const facts = j.match?.facts ?? null;
  const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
  const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
  if (from === null || to === null) return j.workMode;
  return from >= 100 ? 'remote' : to <= 0 ? 'onsite' : 'hybrid';
}

/** The funnel's filter (store::ListFilter): new ones only, one portal, the band of scored jobs
 *  (unscored and excluded ones never pass), the contract types the engine read (none of them
 *  passes only without the filter) and the work mode as the job details say it (a job of no
 *  known mode never passes). */
function inFilter(j: JobView, query: Partial<JobQuery>): boolean {
  if (query.unread === true && !isNewJob(j)) return false;
  // The new jobs of one run: first seen in it, none excluded (store::new_jobs).
  if (query.run !== null && query.run !== undefined) {
    if (seenIn.get(markKey(j.key)) !== query.run || j.match?.status === 'excluded') return false;
  }
  const portals = query.portals ?? [];
  if (portals.length > 0 && !portals.includes(j.key.portal)) return false;
  // The day it came (store::filter_condition): the alert mail's date, else its first sighting.
  if (query.receivedSince !== null && query.receivedSince !== undefined) {
    if (Date.parse(j.mailDate ?? j.firstSeenAt) / 1000 < query.receivedSince) return false;
  }
  const facts = j.match?.facts ?? null;
  const contracts = query.contracts ?? [];
  if (contracts.length > 0 && !contracts.includes(facts?.contract ?? '')) return false;
  if (query.workMode !== null && query.workMode !== undefined) {
    if (workModeOf(j) !== query.workMode) return false;
  }
  // How it came (store::filter_condition): an alert mail named it, the search found it.
  if (query.origin !== null && query.origin !== undefined && !j.origins.includes(query.origin)) {
    return false;
  }
  const bands = query.bands ?? [];
  if (bands.length === 0) return true;
  return j.match?.status === 'scored' && bands.includes(bandOf(j.match.score));
}

function refresh(): void {
  state.counts = countsOf(jobs);
}

/** Moves jobs to a place; returns how many moved. */
/** Moves jobs to a place; returns the keys that really moved (store::move_jobs). */
function moveJobs(keys: JobKey[], to: Place): JobKey[] {
  const moved: JobKey[] = [];
  for (const key of keys) {
    const j = find(key);
    if (j === undefined || j.place === to) continue;
    if (to === 'trash') trashedFrom.set(markKey(key), j.place);
    j.place = to;
    if (to === 'trash') trashedAt.set(markKey(key), new Date(Date.now()).toISOString());
    else trashedAt.delete(markKey(key));
    j.trashedAt = trashedAt.get(markKey(key)) ?? null;
    moved.push(structuredClone(j.key));
  }
  refresh();
  return moved;
}

/** Wiederherstellen (store::restore_jobs): out of the trash back to where each job lay. */
function restoreJobs(keys: JobKey[]): JobKey[] {
  return keys.flatMap((key) =>
    find(key)?.place === 'trash' ? moveJobs([key], trashedFrom.get(markKey(key)) ?? 'inbox') : [],
  );
}

/** Takes moves back (store::move_back): into the trash with the time the job first went
 *  there, not the time of the undo. */
function moveBack(back: MoveBack[]): JobKey[] {
  const moved: JobKey[] = [];
  for (const { key, to, trashedAt: at } of back) {
    if (moveJobs([key], to).length === 0) continue;
    const j = find(key);
    if (to === 'trash' && at !== null && j !== undefined) {
      trashedAt.set(markKey(key), at);
      j.trashedAt = at;
    }
    moved.push(structuredClone(key));
  }
  return moved;
}

/** Deletes jobs of the trash for good: only a tombstone stays, no later run brings them back.
 *  Like the backend (a file command), never during a run. */
function purgeJobs(keys: JobKey[]): Deleted {
  if (running) throw fail('busy');
  const doomed = new Set(
    keys.filter((key) => find(key)?.place === 'trash').map((key) => markKey(key)),
  );
  const gone = jobs.filter((j) => doomed.has(markKey(j.key))).map((j) => structuredClone(j.key));
  jobs = jobs.filter((j) => !doomed.has(markKey(j.key)));
  for (const key of doomed) tombstones.add(key);
  refresh();
  return { count: gone.length, keys: gone, exportError: null };
}

const fold = (text: string): string =>
  text
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** The words of a search as store::search_words takes them (at most 8, folded). */
function searchWords(search: string | null | undefined): string[] {
  return fold(search ?? '')
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 8);
}

/** Like store::search_words: every word of a search is in the portal's name, the title, the
 *  company or the location, in any order; an empty search matches everything, and folds
 *  nothing (the stub runs on the page's main thread, the backend it stands for does not). */
function matchesSearch(j: JobView, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const text = fold(`${PORTAL_LABEL[j.portal]}\n${j.title}\n${j.company}\n${j.location}`);
  return words.every((word) => text.includes(word));
}

/** The same order and counts as store::job_page (one statement, list and counts agree). */
function listJobs(query: JobQuery): { jobs: JobView[]; counts: JobCounts } {
  if (scenario === 'list-error') throw fail('db');
  if (query.offset > 0 && harness.failPages > 0) {
    harness.failPages -= 1;
    throw fail('db');
  }
  const words = searchWords(query.search);
  const base = jobs.filter((j) => matchesSearch(j, words) && inFilter(j, query));
  // The filter narrows the counts like the list (store::job_page). By date: the mail's, in
  // the trash the day the job went there.
  const date = (j: JobView): string =>
    query.place === 'trash' ? (trashedAt.get(markKey(j.key)) ?? '') : (j.mailDate ?? j.firstSeenAt);
  // store::page_order: the excluded last; by match every job whose ring shows no number
  // first (not scored yet and not scorable together, on top of the list, so every page is
  // complete); a closed ad after the open ones; then the best score, the ones without a
  // number and the excluded ones by date.
  const scoreOf = (j: JobView): number | null =>
    j.match?.status === 'scored' ? j.match.score : null;
  const page = base
    .filter((j) => inQuery(j, query))
    .sort((a, b) => {
      const ex = Number(a.match?.status === 'excluded') - Number(b.match?.status === 'excluded');
      if (ex !== 0) return ex;
      const byMatch = query.sort === 'match';
      if (byMatch) {
        const pending = Number(scoreOf(a) !== null) - Number(scoreOf(b) !== null);
        if (pending !== 0) return pending;
      }
      const closed = Number(a.closed) - Number(b.closed);
      if (closed !== 0) return closed;
      if (byMatch) {
        const d = (scoreOf(b) ?? 0) - (scoreOf(a) ?? 0);
        if (d !== 0) return d;
      }
      // By rate the highest day rate first, the jobs without one last.
      if (query.sort === 'rate') {
        const ra = dayRate(a);
        const rb = dayRate(b);
        if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1;
        if (ra !== null && rb !== null && ra !== rb) return rb - ra;
      }
      // ISO dates order as plain strings (localeCompare on 2000 jobs took the page's main
      // thread for milliseconds; the real backend sorts in SQLite, off it).
      const da = date(a);
      const db = date(b);
      if (da !== db) return da < db ? 1 : -1;
      return a.key.id.localeCompare(b.key.id);
    });
  return {
    jobs: page.slice(query.offset, query.offset + Math.min(query.limit, 500)),
    counts: countsOf(base),
  };
}

/* ------------------------------------------------------------------- asked */

/** "Häufig verlangt" like core (`view::asked_terms`, `pipeline::local::terms`): the terms
 *  and fields the engine's readers name for the open must and nice requirements that are
 *  skills (`params.term`, `params.field`, core `pipeline::local::open_term`) of the scored
 *  jobs of the Eingang and the Archiv of the last 30 days, once per job however written,
 *  asked by two jobs at least, the most frequent first (equal counts by their words), at most
 *  eight; what the stored profile names in any field is none of them. */
function askedTerms(): AskedTerm[] {
  const form = state.profile?.form ?? null;
  if (form === null) return [];
  const key = (term: string): string =>
    term
      .toLowerCase()
      .split(/[^\p{L}\p{N}+#]+/u)
      .filter((word) => word !== '')
      .join(' ');
  const known = new Set(
    [
      ...form.competences.flatMap((c) => [c.name, ...c.aliases]),
      ...form.keywords,
      ...form.tools,
      ...form.certificates,
      ...form.degrees,
      ...form.industries,
      ...form.wishes.industries,
      ...form.languages.map((l) => l.language),
    ].map(key),
  );
  const since = NOW - 30 * 24 * HOUR;
  const counted = new Map<string, AskedTerm>();
  const newest = [...jobs].sort((a, b) =>
    (b.mailDate ?? b.firstSeenAt).localeCompare(a.mailDate ?? a.firstSeenAt),
  );
  for (const j of newest) {
    if (j.place === 'trash' || j.match?.status !== 'scored') continue;
    if (new Date(j.mailDate ?? j.firstSeenAt).getTime() < since) continue;
    let reasons: Reason[];
    try {
      reasons = detailOf(j).match?.reasons ?? [];
    } catch {
      continue;
    }
    const open = (weight: 'must' | 'nice'): Reason[] =>
      reasons.filter(
        (r) =>
          r.kind === 'open' &&
          r.weight === weight &&
          r.params['class'] === 'skill' &&
          typeof r.params['term'] === 'string',
      );
    // A stored match keeps at most eight requirements (by their words), one count per term.
    const kept = new Set<string>();
    const seen = new Set<string>();
    for (const reason of [...open('must'), ...open('nice')]) {
      const words = reason.label.trim().toLowerCase();
      if (kept.has(words) || kept.size === 8) continue;
      kept.add(words);
      const term = String(reason.params['term']);
      const field = reason.params['field'] as TermField;
      const k = key(term);
      if (seen.has(k) || known.has(k)) continue;
      seen.add(k);
      const entry = counted.get(k);
      if (entry === undefined) counted.set(k, { term, field, count: 1 });
      else entry.count += 1;
    }
  }
  return [...counted.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .slice(0, 8)
    .map(([, entry]) => entry);
}

/* ------------------------------------------------------------------- detail */

/** The engine's score of a job: the demo's, or the one once its page came. */
function demoMatch(j: JobView): Match | null {
  const key = sourceOf(j.key);
  const page = DEMO.fetched[key]?.job;
  if (page !== undefined && j.detail.kind === 'ok' && page.detail.kind === 'ok') {
    return structuredClone(page.match);
  }
  const listed = DEMO.jobs.find((d) => markKey(d.key) === key);
  return structuredClone(listed?.match ?? page?.match ?? null);
}

/** A job once a details run brought its page: the engine's row of then with the job's own
 *  place, star and read state (unchanged if the demo has no page for it). */
function pageOf(j: JobView): JobView {
  const page = DEMO.fetched[sourceOf(j.key)]?.job;
  if (page === undefined) return j;
  return {
    ...j,
    detail: page.detail,
    short: page.short,
    closed: page.closed,
    match: state.profile === null ? null : structuredClone(page.match),
  };
}

/**
 * The reader of a job as the engine wrote it (view::job_detail): the demo's, or the one once
 * its page came (a details run, the scripted fetch), with the job as the stub holds it now.
 * Without a profile there is no match. A job included by hand counts as scored, the user's
 * word first and the engine's findings kept (view::overridden).
 */
function detailOf(j: JobView): JobDetail {
  const key = sourceOf(j.key);
  const listed = DEMO.details[key];
  const page = DEMO.fetched[key]?.detail;
  const came = j.detail.kind === 'ok' && (listed === undefined || listed.text === null);
  const base = came ? (page ?? listed) : (listed ?? page);
  if (base === undefined) throw fail('notFound', { what: 'job' });
  const detail = structuredClone(base);
  if (listed === undefined && !came) {
    // A job of the scripted fetch as its mail announced it: the page is still to come.
    detail.text = null;
    detail.fetchedAt = null;
    detail.match = null;
  }
  detail.job = structuredClone(j);
  if (!j.hasMail) detail.mail.gmailUrl = null;
  if (state.profile === null || j.match === null) detail.match = null;
  const match = detail.match;
  if (match !== null && j.overridden) {
    match.status = 'scored';
    match.summary = { code: 'userOverride', params: {} };
    const own: Reason = {
      id: 'userOverride',
      kind: 'met',
      weight: 'info',
      code: 'userOverride',
      label: '',
      evidence: null,
      params: {},
      ranges: [],
    };
    match.reasons = [own, ...match.reasons].slice(0, 40);
  }
  // The profile of `no-minimum` sets neither a minimum day rate nor a start: its strip leaves
  // those criteria out.
  if (match !== null && scenario === 'no-minimum') {
    match.criteria = match.criteria.filter(
      (c) => c.code !== 'minDayRate' && c.code !== 'availability',
    );
  }
  return detail;
}

/** The prompt of a job for an AI chat (export::ai_prompt) in the app's language. */
function promptOf(j: JobView): string {
  const prompt = DEMO.prompts[state.language][sourceOf(j.key)];
  if (prompt === undefined) throw fail('notFound', { what: 'job' });
  return prompt;
}

/* --------------------------------------------------------------------- runs */

let running = false;
/** The kind of the run in progress (its end names it). */
let runningKind: RunSummary['kind'] = 'fetch';
/** The page asks whether to close while a fetch runs, or the user chose to close anyway
 *  (main.rs `CloseGuard::ask`): the next close request closes. */
let closeAsked = false;

/** The window closes like main.rs: a run in progress is cancelled first (the page shows its
 *  note on `closing`), then the window is gone. */
function closeWindow(): void {
  if (!running) {
    harness.closed = true;
    return;
  }
  for (const handler of listeners.get('closing') ?? []) {
    handler({ payload: { activity: runningKind } });
  }
  cancelRun();
  setTimeout(() => (harness.closed = true), TICK * 2);
}

function fail(kind: ErrorInfo['kind'], params: ErrorInfo['params'] = {}): ErrorInfo {
  return { kind, params };
}

/** Through the channel of the run, or without a run the page's channel (as Rust does). */
function emit(event: RunEvent): void {
  (runSender ?? pageSender)?.send(event);
}

const isFetch = (kind: RunSummary['kind']): boolean => kind === 'fetch';

/** `app_state`: the page's new channel replaces the old one and takes over a running run. */
function attachPage(sender: Sender): void {
  pageSender?.release();
  pageSender = sender.hold();
  if (runSender !== null) {
    runSender.release();
    runSender = sender.hold();
  }
}

/** The run is over: its handle (and with it its channel) is dropped. */
function endRun(): void {
  running = false;
  runSender?.release();
  runSender = null;
}

/** The scripted fetch's jobs the store does not know yet, as their mails announce them. A job
 *  it holds in any place, or deleted for good, is known and stays as it is (store::upsert:
 *  no page is loaded again, nothing turns new again), so a second fetch brings nothing. */
function unknown(): JobView[] {
  return DEMO.announced.filter((j) => find(j.key) === undefined && !tombstones.has(markKey(j.key)));
}

/** Those jobs once their page came and the engine scored them. */
function arrived(fresh: readonly JobView[]): JobView[] {
  return fresh.map((j) => structuredClone(DEMO.fetched[markKey(j.key)]!.job));
}

/** What the export of a run reports (`?export=locked`: the Excel file is open elsewhere). */
function exported(): RunSummary['export'] {
  const written = lastRun().export!;
  if (!EXPORT_LOCKED) return written;
  return {
    ...written,
    overviewXlsx: null,
    error: {
      kind: 'fileLocked',
      params: { path: 'C:/Users/demo/Jobs/JobAlerts.xlsx', target: 'overview' },
    },
  };
}

/** The number of the last run (the demo's last fetch is 41), and the run each job the
 *  scripted fetches brought was first seen in (store `first_seen_run`). */
let lastRunNumber = 41;
const seenIn = new Map<string, number>();

function script(kind: RunSummary['kind']): RunEvent[] {
  const fresh = unknown();
  const total = fresh.length;
  const number = ++lastRunNumber;
  for (const j of fresh) seenIn.set(markKey(j.key), number);
  const events: RunEvent[] = [
    { type: 'started', kind },
    { type: 'status', code: 'connectingMail', portal: null, until: null },
    { type: 'status', code: 'searchingMail', portal: null, until: null },
    { type: 'progress', step: 'scan', portal: null, done: 0, total: 3 },
    {
      type: 'alert',
      portal: 'linkedin',
      subject: 'Neue Jobs',
      date: at(0.1),
      postings: 1,
      gmailId: 'a1',
    },
    { type: 'progress', step: 'scan', portal: null, done: 1, total: 3 },
    {
      type: 'alert',
      portal: 'freelancermap',
      subject: 'Neue Projekte',
      date: at(0.1),
      postings: 1,
      gmailId: 'a2',
    },
    { type: 'progress', step: 'scan', portal: null, done: 2, total: 3 },
    {
      type: 'alert',
      portal: 'freelance',
      subject: 'Projekte',
      date: at(0.1),
      postings: 1,
      gmailId: 'a3',
    },
    { type: 'progress', step: 'scan', portal: null, done: 3, total: 3 },
    // The sources' own search: a page of each, named while it is asked.
    { type: 'status', code: 'searching', portal: 'hays', until: null },
    { type: 'progress', step: 'search', portal: 'hays', done: 1, total: 2 },
    { type: 'status', code: 'searching', portal: 'freelancermap', until: null },
    { type: 'progress', step: 'search', portal: 'freelancermap', done: 2, total: 2 },
    ...fresh.map((j): RunEvent => ({
      type: 'jobUpdated',
      job: structuredClone(j),
      fresh: true,
    })),
  ];
  if (total > 0) {
    events.push(
      { type: 'status', code: 'fetchingDetails', portal: fresh[0]!.portal, until: null },
      ...Array.from({ length: total + 1 }, (_, done): RunEvent => ({
        type: 'progress',
        step: 'fetch',
        portal: null,
        done,
        total,
      })),
    );
    if (fresh.some((j) => j.portal === 'freelance')) {
      events.push(
        {
          type: 'portalHealth',
          portal: 'freelance',
          health: { kind: 'paused', until: later(15), reason: 'throttled' },
          actionNeeded: false,
        },
        { type: 'status', code: 'waiting', portal: 'freelance', until: later(0.5) },
      );
    }
    events.push(
      { type: 'status', code: 'scoring', portal: null, until: null },
      { type: 'progress', step: 'score', portal: null, done: 0, total },
    );
  }
  // Their pages and scores; without a profile nothing is scored (the backend has no matcher).
  const profiled = state.profile !== null;
  const done = arrived(fresh);
  done.forEach((j, i) => {
    events.push({
      type: 'jobUpdated',
      job: { ...j, match: profiled ? j.match : null },
      fresh: true,
    });
    events.push({ type: 'progress', step: 'score', portal: null, done: i + 1, total });
  });
  events.push({ type: 'status', code: 'writingFiles', portal: null, until: null });
  events.push({ type: 'progress', step: 'export', portal: null, done: 1, total: 1 });
  events.push({
    type: 'finished',
    summary: {
      ...lastRun(),
      run: number,
      kind,
      startedAt: at(0.05),
      finishedAt: at(0),
      // Each portal's mail names one job: new the first time, known after (a known job
      // loads no page again).
      perPortal: (['linkedin', 'freelance', 'freelancermap'] as const).map((portal) => {
        const now = fresh.filter((j) => j.portal === portal).length;
        return {
          portal,
          new: now,
          known: 1 - now,
          dup: 0,
          fetched: now,
          failed: 0,
          gone: 0,
          skipped: 0,
          stopped:
            portal === 'freelance' && now > 0
              ? { kind: 'paused' as const, until: later(15), reason: 'throttled' as const }
              : null,
        };
      }),
      // The new jobs as store::new_jobs counts them: the excluded ones are none, the high
      // ones apart (without a profile none is excluded and none is high).
      newJobs: {
        count: done.filter((j) => !profiled || j.match?.status !== 'excluded').length,
        high: profiled
          ? done.filter((j) => j.match?.status === 'scored' && j.match.band === 'high').length
          : 0,
      },
      export: exported(),
      emptyAlerts: [],
    },
  });
  return events;
}

/** "Anzeige laden" for jobs: their pages, their scores, no mailbox and no new jobs. */
function detailsScript(keys: JobKey[]): RunEvent[] {
  const targets = keys.map(find).filter((j): j is JobView => j !== undefined);
  const events: RunEvent[] = [
    { type: 'started', kind: 'details' },
    { type: 'status', code: 'fetchingDetails', portal: targets[0]?.portal ?? null, until: null },
    { type: 'progress', step: 'fetch', portal: null, done: 0, total: targets.length },
  ];
  targets.forEach((j, i) => {
    events.push({
      type: 'jobUpdated',
      job: pageOf(j),
      fresh: false,
    });
    events.push({
      type: 'progress',
      step: 'fetch',
      portal: null,
      done: i + 1,
      total: targets.length,
    });
  });
  events.push({ type: 'status', code: 'writingFiles', portal: null, until: null });
  events.push({
    type: 'finished',
    summary: {
      ...lastRun(),
      kind: 'details',
      startedAt: at(0.01),
      finishedAt: at(0),
      scan: null,
      newJobs: null,
      perPortal: PORTALS.filter((p) => targets.some((j) => j.portal === p)).map((portal) => ({
        portal,
        new: 0,
        known: 0,
        dup: 0,
        fetched: targets.filter((j) => j.portal === portal).length,
        failed: 0,
        gone: 0,
        skipped: 0,
        stopped: null,
      })),
      export: exported(),
      emptyAlerts: [],
    },
  });
  return events;
}

function startRun(request: RunRequest, sender: Sender | null): void {
  const kind = request.kind;
  if (running) throw fail('busy');
  if (mailboxCheck !== null) throw fail('busy', { activity: 'mailbox' });
  // A mailbox run needs a portal to read (commands/run.rs run_context).
  if (isFetch(kind) && state.portals.every((p) => !p.enabled)) {
    throw fail('invalid', { reason: 'noPortal' });
  }
  // The fetch of one way (the sidebar's Suche, Alert-Mails): run_context refuses the same.
  const only = request.only ?? null;
  if (
    isFetch(kind) &&
    only === 'search' &&
    !state.portals.some((p) => p.enabled && p.way === 'search')
  ) {
    throw fail('invalid', { reason: 'noPortal' });
  }
  if (isFetch(kind) && only === 'mail' && state.mailbox.user === null) throw fail('mailMissing');
  // Without a mailbox a fetch searches the sources, if one is on (run_context's read_mail).
  const searches = state.fetchSearch && state.portals.some((p) => p.enabled && p.way === 'search');
  if (
    (state.mailbox.user === null || !state.fetchMail) &&
    kind !== 'rescore' &&
    kind !== 'details' &&
    !searches
  ) {
    throw fail('mailMissing');
  }
  running = true;
  runningKind = kind;
  runSender = sender?.hold() ?? null;
  harness.done = false;
  const events =
    (MAIL_OFFLINE || NO_INTERNET) && isFetch(kind)
      ? offlineScript(NO_INTERNET ? 'offline' : 'mailConnect')
      : request.kind === 'rescore'
        ? rescoreScript()
        : request.kind === 'details'
          ? detailsScript(request.keys)
          : script(request.kind);
  let index = 0;
  const step = (): void => {
    if (!running) return;
    if (harness.holdAfter !== null && index >= harness.holdAfter) {
      setTimeout(step, TICK);
      return;
    }
    const event = events[index++];
    if (event === undefined) return;
    apply(event);
    emit(event);
    if (event.type === 'finished') {
      endRun();
      harness.done = true;
      return;
    }
    setTimeout(step, TICK);
  };
  setTimeout(step, TICK);
}

/** What the rescore after the last profile save changed (null: nothing known). */
let rescoreDelta: ScoreDelta | null = null;

/** The rescore the app starts after a profile change: scoring only, nothing fetched; its
 *  summary carries what the save changed. */
function rescoreScript(): RunEvent[] {
  const delta = rescoreDelta;
  rescoreDelta = null;
  return [
    { type: 'started', kind: 'rescore' },
    { type: 'status', code: 'scoring', portal: null, until: null },
    { type: 'progress', step: 'score', portal: null, done: 0, total: 1 },
    { type: 'progress', step: 'score', portal: null, done: 1, total: 1 },
    {
      type: 'finished',
      summary: {
        ...lastRun(),
        kind: 'rescore',
        startedAt: at(0.01),
        finishedAt: at(0),
        score: { ...demoScoring()!, delta },
        scan: null,
        newJobs: null,
        perPortal: [],
        emptyAlerts: [],
        export: exported(),
      },
    },
  ];
}

/** A fetch that cannot reach Gmail (`mailConnect`) or finds no network at all (`offline`). */
function offlineScript(kind: 'mailConnect' | 'offline'): RunEvent[] {
  return [
    { type: 'started', kind: 'fetch' },
    { type: 'status', code: 'connectingMail', portal: null, until: null },
    {
      type: 'finished',
      summary: {
        ...lastRun({ kind: 'failed', error: fail(kind) }),
        perPortal: [],
        newJobs: { count: 0, high: 0 },
        emptyAlerts: [],
      },
    },
  ];
}

/** Keep the store in step with the events, so a reload after the run sees the new jobs. */
function apply(event: RunEvent): void {
  if (event.type === 'jobUpdated') {
    const i = jobs.findIndex(
      (j) => j.key.portal === event.job.key.portal && j.key.id === event.job.key.id,
    );
    if (i >= 0) jobs[i] = event.job;
    else if (!tombstones.has(markKey(event.job.key))) jobs.unshift(event.job);
    refresh();
  } else if (event.type === 'finished') {
    // Only a completed fetch ends the setup (a failed first fetch keeps the setup page).
    if (event.summary.outcome.kind === 'completed') state.firstRun = false;
    // "The last fetch": a rescore or a details run never replaces it (pipeline::run).
    if (isFetch(event.summary.kind)) {
      state.lastRun = event.summary;
      for (const p of state.portals) {
        const newest = lastAlertOf(p.portal);
        const newer =
          newest !== null && (p.lastAlert === null || Date.parse(newest) > Date.parse(p.lastAlert));
        if (newer) p.lastAlert = newest;
      }
    }
    state.running = null;
  }
}

function cancelRun(): void {
  if (!running) return;
  running = false;
  const summary: RunSummary = {
    ...lastRun({ kind: 'cancelled' }),
    kind: runningKind,
    perPortal: [],
    emptyAlerts: [],
  };
  setTimeout(() => {
    const event: RunEvent = { type: 'finished', summary };
    apply(event);
    emit(event);
    endRun();
    harness.done = true;
  }, TICK);
}

/* ----------------------------------------------------------------- profiles */

/** The role a profile goes by without a name of its own (core's profile::role). */
function roleOf(info: ProfileInfo | null): string | null {
  const form = info?.form ?? null;
  if (form === null) return null;
  return form.title.trim() || form.roles.map((role) => role.trim()).find((r) => r !== '') || null;
}

/** The switcher's list (core's view::profile_entries). */
function profileEntries(): ProfileEntry[] {
  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    role: roleOf(p.id === activeId ? state.profile : p.info),
    active: p.id === activeId,
  }));
}

/** The number a new profile takes: after the highest of the folder, a deleted one's too. */
function nextProfileId(): number {
  return Math.max(0, ...profiles.map((p) => p.id), ...deletedProfiles.keys()) + 1;
}

/** One line, trimmed, at most 80 characters; empty: none (core's set_name). */
function profileName(name: string | null): string | null {
  const clean = (name ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, 80).trimEnd();
  return clean === '' ? null : clean;
}

/** A new empty profile (`{}`) as the app shows it: nothing in it, so nothing scores. */
function emptyProfile(id: number): ProfileInfo {
  const form = structuredClone(EMPTY_FORM);
  return {
    ...structuredClone(PROFILE),
    fileName: `beraterprofil-${id}.json`,
    bytes: 2,
    savedAt: at(0),
    quality: 'empty',
    understood: understoodOf(form, [{ code: 'noCompetences', params: {} }]),
    scoredAt: null,
    pending: 0,
    parseError: null,
    form,
  };
}

/**
 * The engine's match of a job with the active profile (the stub never scores itself): the
 * demo profile's, another profile's from its own matches in the snapshot (by the demo job it
 * stands for); a job the snapshot scored for the demo profile only (the scripted fetch's)
 * keeps that one. Without a usable profile no job has a match; a job counted anyway stays
 * counted.
 */
function matchWithActive(j: JobView): Match | null {
  const info = state.profile;
  if (info === null || info.form === null || info.quality === 'empty') return null;
  const own = profiles.find((p) => p.id === activeId)?.matches ?? null;
  const key = sourceOf(j.key);
  const found = own !== null && key in own ? structuredClone(own[key] ?? null) : demoMatch(j);
  if (found === null || !j.overridden) return found;
  overridden.set(markKey(j.key), found);
  return { ...found, status: 'scored', note: { code: 'userOverride', params: {} } };
}

/** Another profile becomes the active one (none: no profile left): every job is scored with
 *  it at once, like the rescore the backend starts. */
function activate(target: StubProfile | null): void {
  const from = profiles.find((p) => p.id === activeId);
  if (from !== undefined) from.info = state.profile;
  if (activeId !== null && target !== null && target.id !== activeId) previousId = activeId;
  activeId = target?.id ?? null;
  state.profile = target === null ? null : structuredClone(target.info);
  backupProfile = null;
  for (const j of jobs) j.match = matchWithActive(j);
  refresh();
}

/** A new profile of `info`, active from now on. */
function addProfile(info: ProfileInfo, name: string | null, matches: StubProfile['matches']): void {
  const added: StubProfile = { id: nextProfileId(), name, info, matches };
  profiles.push(added);
  activate(added);
}

const profileOf = (id: number): StubProfile => {
  const found = profiles.find((p) => p.id === id);
  if (found === undefined) throw fail('notFound', { what: 'profile' });
  return found;
};

/* ----------------------------------------------------------------- handlers */

type Args<K extends keyof Commands> = Omit<Commands[K]['args'], 'channel'>;
type Handlers = {
  [K in keyof Commands]: (args: Args<K>) => Commands[K]['result'] | Promise<Commands[K]['result']>;
};

const find = (key: { portal: string; id: string }): JobView | undefined =>
  jobs.find((j) => j.key.portal === key.portal && j.key.id === key.id);

/** The Rust side of the `channel` argument of the command being handled. */
let sender: Sender | null = null;

/** `load-failed`: the first `app_state` fails. */
let loadFailures = scenario === 'load-failed' ? 1 : 0;

const handlers: Handlers = {
  app_state: () => {
    if (loadFailures > 0) {
      loadFailures -= 1;
      throw fail('db');
    }
    if (sender !== null) attachPage(sender);
    state.profiles = profileEntries();
    // The sources at least one job came from (core's Store::sources).
    state.sources = PORTALS.filter((portal) => jobs.some((job) => job.key.portal === portal));
    return structuredClone(state);
  },
  start_run: ({ request }) => {
    startRun(request, sender);
    return null;
  },
  cancel_run: () => {
    mailboxCheck?.stop();
    cancelRun();
    return null;
  },
  list_jobs: ({ query }) => structuredClone(listJobs(query)),
  job_detail: ({ key }) => {
    const j = find(key);
    if (j === undefined) throw fail('notFound');
    const detail = structuredClone(detailOf(j));
    return harness.editDetail === null ? detail : harness.editDetail(detail);
  },
  mark_read: ({ key }) => {
    const j = find(key);
    if (j === undefined || !j.unread) return false;
    j.unread = false;
    refresh();
    return true;
  },
  move_jobs: ({ keys, to }) => moveJobs(keys, to),
  move_back: ({ jobs: back }) => moveBack(back),
  restore_jobs: ({ keys }) => restoreJobs(keys),
  // "Fits anyway": scored with its fit score and the note `userOverride`; taken back, the
  // engine's verdict again (store::set_override, view::JobView).
  set_override: ({ key, include }) => {
    const j = find(key);
    if (j === undefined || j.overridden === include) return false;
    j.overridden = include;
    if (include && j.match !== null) {
      overridden.set(markKey(key), j.match);
      j.match = { ...j.match, status: 'scored', note: { code: 'userOverride', params: {} } };
    } else if (!include) {
      j.match = overridden.get(markKey(key)) ?? j.match;
      overridden.delete(markKey(key));
    }
    refresh();
    return true;
  },
  purge_jobs: ({ keys }) => purgeJobs(keys),
  empty_trash: () => purgeJobs(jobs.filter((j) => j.place === 'trash').map((j) => j.key)),
  ai_prompt: ({ key }) => {
    const j = find(key);
    if (j === undefined) throw fail('notFound', { what: 'job' });
    if (state.profile === null) throw fail('notFound', { what: 'profile' });
    return promptOf(j);
  },
  pick_profile: () => structuredClone(params.get('file') === 'focus' ? FOCUS_DRAFT : FILE_DRAFT),
  // A pasted answer reads when it holds a JSON object (the demo's chosen file).
  read_profile_text: ({ text }: { text: string }) =>
    /\{[\s\S]*\}/.test(text) ? structuredClone(FILE_DRAFT) : null,
  profile_prompt: () => PROMPT,
  save_profile: ({ save }) => {
    const after = save.after;
    const refuse = (field: string, max: number | null, row: number | null = null): never => {
      throw fail('invalid', { reason: 'profileValue', field, row, max });
    };
    const tooLong = after.competences.findIndex((r) => (r.years ?? 0) > MAX_YEARS);
    if (tooLong >= 0) refuse('competences', MAX_YEARS, tooLong);
    if (after.focus.length > MAX_FOCUS) refuse('focus', MAX_FOCUS);
    // Like core (form::validate_criteria, the limits of types/profile.ts), hidden or not:
    // every number up to its limit, words within what a profile holds, the second day of the
    // workload not below the first.
    const c = after.criteria;
    for (const key of Object.keys(NUMBER_CRITERIA) as NumberCriterion[]) {
      const { max } = NUMBER_CRITERIA[key];
      if ((c[key] ?? 0) > max) refuse(key, max);
    }
    for (const key of Object.keys(WORD_CRITERIA) as WordCriterion[]) {
      const words = c[key];
      if (words.length > MAX_ITEMS || words.some((w) => w.length > MAX_TEXT)) refuse(key, null);
    }
    const [minDays, maxDays] = [c.workloadMinDays, c.workloadMaxDays];
    if (minDays !== null && maxDays !== null && maxDays < minDays) refuse('workloadMaxDays', null);
    const form = savedForm(after);
    // The keywords like core's merge: an unchanged list keeps the stored one, a changed one
    // is applied to it (a term added from the reader and its undo, each on its own copy).
    const stored = save.source === null ? (state.profile?.form ?? null) : null;
    if (stored !== null) {
      const { keywords } = save.before;
      form.keywords =
        keywords.length === after.keywords.length &&
        keywords.every((term, index) => term === after.keywords[index])
          ? [...stored.keywords]
          : mergeKeywords(stored.keywords, keywords, form.keywords);
    }
    const count = form.competences.length + form.tools.length + form.keywords.length;
    const quality = count === 0 ? 'empty' : count < 5 ? 'thin' : 'good';
    // Without any profile the save makes the first one of the folder.
    if (activeId === null) {
      activeId = nextProfileId();
      profiles.push({ id: activeId, name: null, info: null, matches: null });
    }
    if (state.profile !== null) backupProfile = state.profile;
    state.profile = {
      ...PROFILE,
      fileName: 'beraterprofil.json',
      bytes: JSON.stringify(form).length,
      savedAt: at(0),
      quality,
      understood: {
        ...PROFILE.understood!,
        competenceCount: count,
        competences: form.competences.map((r) => r.name),
        // Like the engine: a domain only from what the profile names (no fixed sample packs).
        packs: packsOf(form),
        criteria: criteriaOf(form.criteria),
        warnings: [],
        focus: form.focus,
        roles: form.roles,
        wishes: form.wishes,
      },
      form,
    };
    // Scored with the profile: the engine's scores of the demo.
    const bandsBefore = bandsOf(jobs);
    if (jobs.every((j) => j.match === null)) {
      for (const j of jobs) j.match = demoMatch(j);
    }
    refresh();
    // Like core (scoring::profile_changed): the jobs are scored again, and the rescore says
    // what changed in the Eingang (`ScoreDelta`); no run without jobs, none while one goes.
    const bandsAfter = bandsOf(jobs);
    rescoreDelta = {
      excludedBefore: bandsBefore.excluded,
      excludedAfter: bandsAfter.excluded,
      highBefore: bandsBefore.high,
      highAfter: bandsAfter.high,
    };
    if (jobs.length > 0 && !running && mailboxCheck === null) {
      startRun({ kind: 'rescore' }, null);
    }
    return structuredClone(state.profile);
  },
  list_profiles: () => profileEntries(),
  switch_profile: ({ id }) => {
    const target = profileOf(id);
    if (id !== activeId) activate(target);
    return profileEntries();
  },
  create_profile: () => {
    const id = nextProfileId();
    addProfile(emptyProfile(id), null, null);
    return profileEntries();
  },
  // Like core: the file byte for byte, so its matches too.
  duplicate_profile: ({ id, name }) => {
    const source = profileOf(id);
    const info = id === activeId ? state.profile : source.info;
    addProfile(structuredClone(info!), profileName(name), source.matches);
    return profileEntries();
  },
  rename_profile: ({ id, name }) => {
    profileOf(id).name = profileName(name);
    return profileEntries();
  },
  // Like core: the file becomes its backup; the one active before is active again, without
  // it the next profile in order (else the one before), the last one leaves none.
  delete_profile: ({ id }) => {
    const index = profiles.findIndex((p) => p.id === id);
    if (index < 0) return false;
    const [gone] = profiles.splice(index, 1);
    if (id === activeId) {
      gone!.info = state.profile;
      const back = profiles.find((p) => p.id === previousId);
      activeId = null;
      activate(back ?? profiles[index] ?? profiles[index - 1] ?? null);
      previousId = null;
    }
    deletedProfiles.set(id, gone!);
    return true;
  },
  // Like core: a number brings a deleted profile back (active again); none swaps the active
  // profile with its backup (the undo of another file saved over it).
  restore_profile: ({ id }) => {
    if (id === null) {
      if (backupProfile === null) return false;
      [state.profile, backupProfile] = [backupProfile, state.profile];
      return true;
    }
    const back = deletedProfiles.get(id);
    if (back === undefined) return false;
    deletedProfiles.delete(id);
    profiles.push(back);
    profiles.sort((a, b) => a.id - b.id);
    activate(back);
    return true;
  },
  // The file the stub chooses: the next test profile of the snapshot.
  load_profile: () => {
    const file = DEMO.profiles[FOLDER_PROFILES]!;
    addProfile(structuredClone(file.profile), null, file.matches);
    return profileEntries();
  },
  asked_terms: () => askedTerms(),
  vocabulary: () => structuredClone(VOCABULARY),
  set_unsaved: ({ on }) => {
    harness.unsaved = on;
    return null;
  },
  close_window: () => {
    harness.unsaved = false;
    harness.requestClose();
    return null;
  },
  answer_close: ({ close }) => {
    closeAsked = close;
    if (close) harness.requestClose();
    return null;
  },
  // Like platform.rs: minimize, maximize or restore, and a close request (the page asks
  // about unsaved changes first).
  window_button: ({ button }) => {
    if (button === 'minimize') harness.minimized = true;
    else if (button === 'close') harness.requestClose();
    else {
      harness.maximized = !harness.maximized;
      harness.fire('window-state', { maximized: harness.maximized });
    }
    return null;
  },
  window_maximized: () => harness.maximized,
  save_mailbox: async ({ user, password }) => {
    // Like the command: the shape first (before the busy check), nothing is sent while it
    // cannot be right.
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(user)) {
      throw fail('invalid', { reason: 'mailAddress' });
    }
    if (!/^[a-z]{16}$/i.test(password.replace(/\s/g, ''))) {
      throw fail('invalid', { reason: 'appPassword' });
    }
    if (running) throw fail('busy');
    if (mailboxCheck !== null) throw fail('busy', { activity: 'mailbox' });
    if (harness.holdMailbox) await checking();
    if (password.replace(/\s/g, '').toLowerCase() === WRONG_PASSWORD) throw fail('mailAuth');
    // A count that does not finish never throws the sign-in away: `check` is then null.
    state.mailbox = {
      user,
      vault: VAULT,
      error: null,
      check: MAIL_UNCOUNTED ? null : params.get('alerts') === 'none' ? NO_ALERTS : DEMO_CHECK,
      checkedAt: new Date().toISOString(),
    };
    return state.mailbox;
  },
  remove_mailbox: () => {
    if (running) throw fail('busy');
    if (mailboxCheck !== null) throw fail('busy', { activity: 'mailbox' });
    state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
    return true;
  },
  portal_login: ({ portal: name }) => {
    const p = state.portals.find((x) => x.portal === name);
    if (p) p.signedIn = true;
    return true;
  },
  portal_logout: ({ portal: name }) => {
    const p = state.portals.find((x) => x.portal === name);
    if (p) p.signedIn = false;
    return true;
  },
  // Like core: the profile comes along into a folder without one (`folder=other`), a folder
  // with its own keeps it (`folder=own`); the files are written there at once.
  pick_workspace: () => {
    const kind = params.get('folder');
    if (kind !== 'other' && kind !== 'own') return null;
    const folder = `${HOME}/Documents/Jobs`;
    state.settings = {
      ...state.settings,
      workspace: folder,
      workspaceIsDefault: false,
      excelPath: `${folder}/auswertung/JobAlerts.xlsx`,
      excelExists: state.exportExcel && state.lastRun !== null,
      csvPath: `${folder}/auswertung/JobAlerts.csv`,
      csvExists: state.exportCsv && state.lastRun !== null,
    };
    const profile = kind === 'own' ? 'own' : state.profile === null ? 'none' : 'copied';
    return { folder, profile };
  },
  // Like `overview` (commands/files.rs): a result file switched off is not found (the app
  // writes none); one switched on is written fresh before it opens, also the first time.
  open_target: ({ target }) => {
    if (target.kind === 'excel' && !state.exportExcel) {
      throw fail('notFound', { what: 'file', path: state.settings.excelPath });
    }
    if (target.kind === 'csv' && !state.exportCsv) {
      throw fail('notFound', { what: 'file', path: state.settings.csvPath });
    }
    // A new mail only to the contact an ad names (commands/files.rs).
    if (target.kind === 'contactMail' && !find(target.key)?.match?.facts.contactEmail) {
      throw fail('notFound', { what: 'mail' });
    }
    return null;
  },
  save_settings: ({ patch }) => {
    for (const change of patch.portals) {
      const p = state.portals.find((x) => x.portal === change.portal);
      if (p === undefined) continue;
      if (change.enabled !== null) p.enabled = change.enabled;
      if (change.loginEnabled !== null) p.loginEnabled = change.loginEnabled;
    }
    // Every portal may be off (the backend saves it); a fetch is then refused, see start_run.
    if (patch.fetchRange !== null) state.fetchRange = patch.fetchRange;
    if (patch.autoFetch !== null) state.autoFetch = patch.autoFetch;
    if (patch.fetchMail !== null && patch.fetchMail !== undefined) {
      state.fetchMail = patch.fetchMail;
    }
    if (patch.fetchSearch !== null && patch.fetchSearch !== undefined) {
      state.fetchSearch = patch.fetchSearch;
    }
    if (patch.exportCsv !== null) {
      // Like the Excel file below.
      state.exportCsv = patch.exportCsv;
      state.settings.csvExists = patch.exportCsv && state.lastRun !== null;
    }
    if (patch.exportExcel !== null) {
      // Switched on, the file follows a moment later (like a mark); off, none is there.
      state.exportExcel = patch.exportExcel;
      state.settings.excelExists = patch.exportExcel && state.lastRun !== null;
    }
    if (patch.language !== null) state.language = patch.language;
    if (patch.palette !== null) state.palette = patch.palette;
    state.profiles = profileEntries();
    return structuredClone(state);
  },
  reset_all: () => null,
  list_backups: () => structuredClone(backups),
  // Like core: the state it replaces is copied first (the undo), the newest three such copies
  // kept; a name that is no copy is not found. The demo data stays as it is.
  restore_backup: ({ id }) => {
    if (running || mailboxCheck !== null) throw fail('busy');
    if (!backups.some((backup) => backup.id === id)) {
      throw fail('notFound', { what: 'backup', name: id });
    }
    let ms = Date.now();
    while (backups.some((backup) => backup.id === restoreName(ms))) ms += 1;
    const before: Backup = {
      id: restoreName(ms),
      kind: 'restore',
      at: new Date(ms).toISOString(),
      bytes: backups[0]?.bytes ?? 0,
    };
    const kept = [before, ...backups.filter((backup) => backup.kind === 'restore')].slice(
      0,
      RESTORE_KEPT,
    );
    backups = [...kept, ...backups.filter((backup) => backup.kind !== 'restore')].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    );
    return structuredClone(before);
  },
  report_ui_error: () => null,
  clipboard_text: async () =>
    harness.clipboard ?? (await navigator.clipboard.readText().catch(() => null)),
};

/** Listeners of app events (`listen` of @tauri-apps/api/event). */
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

export async function listen<T>(
  name: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const set = listeners.get(name) ?? new Set();
  listeners.set(name, set);
  const wrapped = handler as (event: { payload: unknown }) => void;
  set.add(wrapped);
  return () => set.delete(wrapped);
}

const harness: Harness = {
  calls: [],
  emit(event) {
    apply(event);
    emit(event);
  },
  appRun(kind) {
    startRun(kind === 'details' ? { kind, keys: [] } : { kind }, null);
  },
  fire(name, payload) {
    for (const handler of listeners.get(name) ?? []) handler({ payload });
  },
  done: false,
  detailDelay: 0,
  editDetail: null,
  failPages: 0,
  holdAfter: null,
  clipboard: null,
  unsaved: false,
  closed: false,
  maximized: false,
  minimized: false,
  holdMailbox: false,
  runs: () => running,
  requestClose() {
    if (harness.unsaved) {
      for (const handler of listeners.get('close-requested') ?? []) handler({ payload: null });
      return;
    }
    if (running && isFetch(runningKind) && !closeAsked) {
      closeAsked = true;
      for (const handler of listeners.get('close-running') ?? []) handler({ payload: null });
      return;
    }
    closeWindow();
  },
  job(key) {
    const found = find(key);
    return found === undefined ? null : structuredClone(found);
  },
  gone(key) {
    const found = find(key);
    if (found !== undefined) found.detail = { kind: 'gone' };
  },
  noMail(key) {
    const found = find(key);
    if (found !== undefined) found.hasMail = false;
  },
  async text(path, ...args) {
    const { t } = await import('../../ui/src/lib/i18n/t');
    let value: unknown = t;
    for (const part of path.split('.')) value = (value as Record<string, unknown>)[part];
    return String(
      typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value,
    );
  },
  form() {
    return state.profile?.form ? structuredClone(state.profile.form) : null;
  },
  list(query) {
    return structuredClone(
      listJobs({
        place: 'inbox',
        unread: false,
        sort: 'match',
        search: null,
        portals: [],
        bands: [],
        contracts: [],
        workMode: null,
        origin: null,
        run: null,
        receivedSince: null,
        limit: 500,
        offset: 0,
        ...query,
      }),
    );
  },
};
window.__harness = harness;
initial();

/* --------------------------------------------------------------------- core */

/** The app password Gmail refuses in the harness. */
const WRONG_PASSWORD = 'falschfalschfals';

/** A "Verbinden" in progress (`harness.holdMailbox`): `stop` is `cancel_run`. */
let mailboxCheck: { stop: () => void } | null = null;

/** Signs in and counts until `holdMailbox` is false again; `cancel_run` stops it. */
function checking(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (harness.holdMailbox) return;
      clearInterval(timer);
      mailboxCheck = null;
      resolve();
    }, TICK);
    mailboxCheck = {
      stop: () => {
        clearInterval(timer);
        mailboxCheck = null;
        reject(fail('mailCancelled'));
      },
    };
  });
}

/** Commands that refuse in the dry run (`ensure_real` in src-tauri): they write outside it. */
const DRY_RUN_REFUSED: ReadonlySet<string> = new Set([
  'pick_profile',
  'switch_profile',
  'create_profile',
  'duplicate_profile',
  'rename_profile',
  'delete_profile',
  'restore_profile',
  'load_profile',
  'save_profile_template',
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
  'reset_all',
  'restore_backup',
]);

/** Commands that refuse in the demo (`ensure_not_demo` in src-tauri): a real mailbox, the
 *  portals' sign-in, the vault, another work folder, the reset, a restore. Its fetches run
 *  like any (its mailbox and portals are made up). */
const DEMO_REFUSED: ReadonlySet<string> = new Set([
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
  'pick_workspace',
  'reset_all',
  'restore_backup',
]);

/** Resolves in the next task (a message, not a timer: no clamping, no fake clock). */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  harness.calls.push([command, args]);
  const handler = handlers[command as keyof Commands] as ((a: unknown) => unknown) | undefined;
  if (handler === undefined) throw fail('internal', { command });
  if (state.dryRun && DRY_RUN_REFUSED.has(command)) throw fail('dryRun');
  if (state.demo && DEMO_REFUSED.has(command)) throw fail('demo');
  const delay = command === 'job_detail' ? DELAY + harness.detailDelay : DELAY;
  if (command !== 'report_ui_error') {
    // Like Tauri's IPC, the answer arrives in a task of its own: the page's work on it is
    // never counted into the click or key that asked.
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    else await nextTask();
  }
  // Like Tauri: every call gets its own Rust-side channel, dropped when nothing holds it.
  sender = args.channel instanceof Channel ? new Sender(args.channel as Channel<RunEvent>) : null;
  const own = sender?.hold() ?? null;
  try {
    return handler(args) as T;
  } finally {
    sender = null;
    own?.release();
  }
}
