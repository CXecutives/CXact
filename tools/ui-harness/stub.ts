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
//   window.__harness.failPages      so many next `list_jobs` calls for a later page fail
//   window.__harness.holdAfter      a scripted run pauses after so many events (null = on)
//   window.__harness.job(key)       a copy of a job as the stub holds it
//   window.__harness.form()         a copy of the stored profile's form (null: no profile)
//   window.__harness.list(query)    what `list_jobs` returns for a query (not recorded)
//
// Scenarios (`?scenario=`): default · first-run · mailbox-only · no-profile · empty ·
// many (2000 jobs) · offline · paused · running · slow · list-error · profile-broken ·
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
// · demo (the `--demo` start: a sample mailbox, no profile and so no scores yet, no fetch of
// any kind, no mailbox, sign-in, other work folder or reset; they refuse with `demo` like
// `ensure_not_demo`)
// · load-failed (the first `app_state` fails with `db`, like a start whose database cannot
// be read; a retry loads).
// `save_mailbox` refuses the app password `falschfalschfals` with `mailAuth` (Gmail said no);
// with `?alerts=none` its check finds no alert mail. `?reset=clean`: the reset left nothing.
// `?file=focus` lets `pick_profile` choose a file with seven Schwerpunkte (the form takes five).
// `save_profile` refuses a minimum day rate above 100.000, a minimum remote share above 100,
// a competence with more than 70 years (with its row), more than five days a week, a second
// day below the first and a minimum duration above 120 months, like core's validation.
// Engine 16 in the demo: the profile works three to five days a week for at least six months
// and excludes "Werkstudent" and "Praktikum"; 900413 asks for two days (a check), 2804 for three
// (fits), 2802 lasts three months (a check), 2807 is excluded by its title.
// `?tick=ms` sets the pace of a scripted run (default 40); `?export=locked` lets the export
// of a run find the Excel file open; `?mail=offline` lets every fetch fail to reach Gmail,
// `?mail=no-internet` find no network at all (`offline`: "Keine Verbindung zum Internet");
// `?folder=other` lets `pick_workspace` choose another folder without a profile (the profile
// comes along), `?folder=own` one with its own; `?palette=light|dark` starts in that palette.
// Dates are fixed so screenshots stay stable (the tests also fix the clock). The portals
// come in the order of the backend (`Portal::ALL`).

import type {
  AppState,
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
  ProfileForm,
  ProfileInfo,
  ProfileUnderstanding,
  Reason,
  RunEvent,
  RunRequest,
  RunSummary,
} from '../../ui/src/lib/ipc/types';
import { BAND_FROM, HIGH_FROM } from '../../ui/src/lib/ipc/types/bands';
import { PORTAL_LABEL, PORTALS } from '../../ui/src/lib/ipc/types/portals';
import {
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
  /** So many next `list_jobs` calls for a later page (offset > 0) fail. */
  failPages: number;
  /** A scripted run pauses after so many of its events until this is null again. */
  holdAfter: number | null;
  /** A copy of a job as the stub holds it (null if unknown). */
  job: (key: JobKey) => JobView | null;
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
/** The palette as the backend says it (`palette=light|dark`; Coast by default). */
const PALETTE: Palette =
  params.get('palette') === 'dark' ? 'dark' : params.get('palette') === 'light' ? 'light' : 'coast';

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
 *  numbered: one the engine could not score (100000 sorts far down), a high, a mid and an
 *  excluded one (every fourth from the fourth); the portals in turn, every third one unread,
 *  a quarter of an hour apart. */
const MANY = ['freelancermap:2806', 'freelancermap:2801', 'freelancermap:2802', 'freelance:900412'];

function manyJobs(count: number): JobView[] {
  const base = MANY.map((key) => DEMO.jobs.find((j) => markKey(j.key) === key)!);
  return Array.from({ length: count }, (_, i) => {
    const from = base[i % base.length]!;
    const portal = PORTALS[i % PORTALS.length]!;
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
    { code: 'targetYears', params: { set: c.targetYears !== null, min: c.targetYears } },
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
      unread('zielprofil_min_jahre', '"senior"', 'targetYears'),
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
      targetYears: null,
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

/** The prompts for an AI, for a new profile and for an update of the stored one (the real
 *  texts live in core/src/profile/prompt.rs). */
const PROMPT =
  'Bitte erstelle aus meinem angehängten Lebenslauf das Profil für meine Job-Alert-App.';
const PROMPT_UPDATE =
  'Bitte aktualisiere das Profil meiner Job-Alert-App mit meinem angehängten Lebenslauf.';

/** The stored profile's JSON an update saves into, with the answer's career stations. */
function updateSource(answer: Record<string, unknown>): string {
  const stored = { name: 'Erika Beispiel', harte_kriterien: { min_tagessatz: 1100 } };
  const stations = answer.stationen;
  return JSON.stringify(stations === undefined ? stored : { ...stored, stationen: stations });
}

type Json = Record<string, unknown>;
const texts = (value: unknown, key?: string): string[] =>
  (Array.isArray(value) ? value : [])
    .map((item) =>
      typeof item === 'string'
        ? item
        : key && item && typeof item === 'object'
          ? (item as Json)[key]
          : null,
    )
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '');
const LEVELS: Record<string, ProfileForm['languages'][number]['level']> = {
  a1: 'a1',
  a2: 'a2',
  b1: 'b1',
  b2: 'b2',
  c1: 'c1',
  c2: 'c2',
  muttersprache: 'native',
};

/** An AI's answer as the backend reads it: the JSON (also in a code block) into the form; for
 *  an update the draft saves into the stored profile. */
function answerDraft(answer: string, update = false): ProfileDraft {
  const fenced = /```[a-z]*\s*([\s\S]*?)```/.exec(answer)?.[1];
  const text = fenced ?? answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1);
  let data: Json;
  try {
    data = JSON.parse(text) as Json;
  } catch {
    // An object that never closes: the answer breaks off.
    const open = answer.split('{').length - answer.split('}').length;
    throw fail('invalid', { reason: open > 0 ? 'profileAnswerCut' : 'profileAnswer' });
  }
  const list = (key: string): unknown[] =>
    Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
  const criteria = (data.harte_kriterien ?? {}) as Json;
  const days = (value: unknown): number | null =>
    typeof value === 'number' && value >= 1 && value <= 5 ? value : null;
  const form: ProfileForm = {
    ...structuredClone(PROFILE_FORM),
    name: typeof data.name === 'string' ? data.name : '',
    title: typeof data.titel === 'string' ? data.titel : '',
    competences: list('kernkompetenzen').map((item, index) => {
      const entry = item as Json;
      return row(
        String(entry.kompetenz ?? ''),
        typeof entry.jahre === 'number' ? entry.jahre : null,
        texts(entry.auch),
        index,
      );
    }),
    strengths: texts(data.alleinstellungsmerkmale),
    keywords: texts(data.keywords),
    years: typeof data.berufserfahrung_jahre === 'number' ? data.berufserfahrung_jahre : null,
    degrees: texts(data.ausbildung, 'abschluss'),
    industries: texts(data.branchen, 'branche'),
    tools: texts(data.methoden_tools, 'name'),
    certificates: texts(data.zertifizierungen, 'name'),
    languages: list('sprachen').map((item, index) => {
      const entry = item as Json;
      return {
        language: String(entry.sprache ?? ''),
        level: LEVELS[String(entry.niveau ?? '').toLowerCase()] ?? null,
        origin: index,
      };
    }),
    focus: texts(data.schwerpunkte),
    roles: [],
    wishes: { dayRate: null, remote: null, regions: [], industries: [] },
    criteria: {
      ...PROFILE_FORM.criteria,
      minDayRate: null,
      // Countries an answer names (one the app does not know stays as it is).
      countries: texts(criteria.laender),
      noAnue: false,
      targetYears: null,
      // The rules of engine 16 the answer sets (a day of the week from 1 to 5).
      workloadMinDays: days(criteria.auslastung_min_tage),
      workloadMaxDays: days(criteria.auslastung_max_tage),
      minMonths:
        typeof criteria.min_laufzeit_monate === 'number' ? criteria.min_laufzeit_monate : null,
      exclusionWords: texts(criteria.ausschlusswoerter),
    },
  };
  if (form.competences.length === 0 && form.name === '')
    throw fail('invalid', { reason: 'profileAnswer' });
  const quality = form.competences.length >= 5 ? 'good' : 'thin';
  const warnings: Notice[] =
    quality === 'thin'
      ? [{ code: 'fewCompetences', params: { count: form.competences.length } }]
      : [];
  const source = update ? updateSource(data) : text;
  return { form, source, quality, understood: understoodOf(form, warnings) };
}

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

const portal = (name: PortalState['portal'], extra: Partial<PortalState> = {}): PortalState => ({
  portal: name,
  enabled: true,
  login: name === 'freelance' ? 'optional' : 'none',
  loginEnabled: false,
  signedIn: name === 'freelance' ? false : null,
  health: { kind: 'ok' },
  actionNeeded: false,
  quota: null,
  ...extra,
});

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
/** Core's one backup of the profile: the previous one of every save, the one a
 *  `remove_profile` took; `restore_profile` swaps it with the profile. */
let backupProfile: ProfileInfo | null = null;
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
    // Every portal counts its calls (the backend sends the numbers of each): 100 a day.
    portals: [
      portal('linkedin', { quota: { usedHour: 4, capHour: 30, usedDay: 23, capDay: 100 } }),
      portal('freelance', { quota: { usedHour: 2, capHour: 20, usedDay: 11, capDay: 100 } }),
      portal('freelancermap', { quota: { usedHour: 9, capHour: 40, usedDay: 86, capDay: 100 } }),
    ],
    setupDone: true,
    fetchRange: 'sinceLast',
    exportExcel: true,
    exportCsv: false,
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
      // Like `create_demo_data` without a profile: nothing scored, until she picks a test
      // profile in Profil.
      state.demo = true;
      state.mailbox = {
        user: 'demo@example.org',
        vault: VAULT,
        error: null,
        check: null,
        checkedAt: null,
      };
      state.profile = null;
      for (const j of jobs) j.match = null;
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
  }
  refresh();
}

/**
 * The counts of store::job_page: per place, and within the inbox; "Neu" is unread and not
 * excluded, per portal too; the excluded ones of the archive and the trash each in their place.
 */
function countsOf(list: JobView[]): JobCounts {
  const c: JobCounts = {
    inbox: 0,
    unread: 0,
    archive: 0,
    trash: 0,
    excluded: 0,
    excludedArchive: 0,
    excludedTrash: 0,
    high: 0,
    noDetail: 0,
    newByPortal: PORTALS.map((portal) => ({ portal, new: 0 })),
  };
  for (const j of list) {
    const out = j.match?.status === 'excluded';
    if (j.place === 'archive') c.archive += 1;
    if (j.place === 'trash') c.trash += 1;
    if (out && j.place === 'archive') c.excludedArchive += 1;
    if (out && j.place === 'trash') c.excludedTrash += 1;
    if (j.place !== 'inbox') continue;
    const isNew = j.unread && !out;
    c.inbox += 1;
    c.unread += isNew ? 1 : 0;
    c.excluded += out ? 1 : 0;
    c.high += j.match?.status === 'scored' && j.match.score >= HIGH_FROM ? 1 : 0;
    c.noDetail += j.detail.kind !== 'ok' ? 1 : 0;
    const line = c.newByPortal.find((p) => p.portal === j.portal);
    if (line && isNew) line.new += 1;
  }
  return c;
}

/* ------------------------------------------------------------------- marks */

/** When a job went to the trash and from where (the archive keeps its time there), deleted
 *  keys and the excluded verdicts the user overrode (store::marks). */
const trashedAt = new Map<string, string>();
const trashedFrom = new Map<string, Place>();
const tombstones = new Set<string>();
const overridden = new Map<string, Match>();
const markKey = (key: JobKey): string => `${key.portal}:${key.id}`;

/** The list of a query (store::job_page): a place, only the unread ones. */
function inQuery(j: JobView, query: Pick<JobQuery, 'place' | 'unread'>): boolean {
  return j.place === query.place && (!query.unread || j.unread);
}

/** The funnel's filter (store::ListFilter): one portal, a lowest band of scored jobs, the
 *  contract types the engine read (none of them passes only without the filter), remote as
 *  the job details say it (the stated share first, else the location's work mode). */
function inFilter(
  j: JobView,
  query: Pick<JobQuery, 'portal' | 'minBand' | 'contracts' | 'remoteOnly'>,
): boolean {
  if (query.portal !== null && query.portal !== undefined && j.key.portal !== query.portal) {
    return false;
  }
  const facts = j.match?.facts ?? null;
  const contracts = query.contracts ?? [];
  if (contracts.length > 0 && !contracts.includes(facts?.contract ?? '')) return false;
  if (query.remoteOnly === true) {
    const share = facts?.remoteFrom ?? facts?.remoteTo ?? null;
    if (share === null ? j.workMode !== 'remote' : share < 100) return false;
  }
  if (query.minBand === null || query.minBand === undefined) return true;
  return j.match?.status === 'scored' && j.match.score >= BAND_FROM[query.minBand];
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
  // The unread filter lists every unread job, excluded ones too (grey behind the divider);
  // only the count leaves them out (store::job_page). By date: the mail's, in the trash
  // the day the job went there.
  const date = (j: JobView): string =>
    query.place === 'trash' ? (trashedAt.get(markKey(j.key)) ?? '') : (j.mailDate ?? j.firstSeenAt);
  // store::page_order: the excluded last; by match the jobs without a score first (on top of
  // the list, so every page is complete); a closed ad after the open ones;
  // then the best score.
  const page = base
    .filter((j) => inQuery(j, query))
    .sort((a, b) => {
      const ex = Number(a.match?.status === 'excluded') - Number(b.match?.status === 'excluded');
      if (ex !== 0) return ex;
      const byMatch = query.sort === 'match';
      if (byMatch) {
        const pending = Number(b.match === null) - Number(a.match === null);
        if (pending !== 0) return pending;
      }
      const closed = Number(a.closed) - Number(b.closed);
      if (closed !== 0) return closed;
      if (byMatch) {
        const d = (b.match?.score ?? 0) - (a.match?.score ?? 0);
        if (d !== 0) return d;
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

/** "Häufig verlangt" like core (`view::asked_terms`, `pipeline::local::terms`): the open
 *  must and nice requirements that are skills and terms (at most five words, no end of a
 *  sentence, a requirement no sentence) of the engine's readers of the scored jobs of the
 *  Eingang and the Archiv of the last 30 days, once per job however written, asked by two
 *  jobs at least, the most frequent first (equal counts by their words), at most eight; what
 *  the stored profile names (competences, synonyms, keywords, tools, certificates) is none of
 *  them. */
function askedTerms(): { term: string; count: number }[] {
  const form = state.profile?.form ?? null;
  if (form === null) return [];
  const key = (term: string): string =>
    term
      .toLowerCase()
      .split(/[^\p{L}\p{N}+#]+/u)
      .filter((word) => word !== '')
      .join(' ');
  const isTerm = (words: string): boolean =>
    words !== '' && words.split(/\s+/).length <= 5 && words.length <= 80 && !/[.!?:;]$/.test(words);
  const known = new Set(
    [
      ...form.competences.flatMap((c) => [c.name, ...c.aliases]),
      ...form.keywords,
      ...form.tools,
      ...form.certificates,
    ].map(key),
  );
  const since = NOW - 30 * 24 * HOUR;
  const counted = new Map<string, { term: string; count: number }>();
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
          (r.code === 'term' || (r.code === 'requirement' && r.params['source'] !== 'sentence')),
      );
    const seen = new Set<string>();
    for (const reason of [...open('must'), ...open('nice')]) {
      const words = reason.label.trim();
      const k = key(words);
      if (!isTerm(words) || k === '' || seen.has(k) || seen.size === 8) continue;
      seen.add(k);
      if (known.has(k)) continue;
      const entry = counted.get(k);
      if (entry === undefined) counted.set(k, { term: words, count: 1 });
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

/** The scripted fetch's new jobs once their page came and the engine scored them. */
function arrived(): JobView[] {
  return DEMO.announced.map((j) => structuredClone(DEMO.fetched[markKey(j.key)]!.job));
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

function script(kind: RunSummary['kind']): RunEvent[] {
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
    ...DEMO.announced.map((j): RunEvent => ({
      type: 'jobUpdated',
      job: structuredClone(j),
      fresh: true,
    })),
    { type: 'status', code: 'fetchingDetails', portal: 'linkedin', until: null },
    { type: 'progress', step: 'fetch', portal: null, done: 0, total: 3 },
    { type: 'progress', step: 'fetch', portal: null, done: 1, total: 3 },
    { type: 'progress', step: 'fetch', portal: null, done: 2, total: 3 },
    { type: 'progress', step: 'fetch', portal: null, done: 3, total: 3 },
    {
      type: 'portalHealth',
      portal: 'freelance',
      health: { kind: 'paused', until: later(15), reason: 'throttled' },
      actionNeeded: false,
    },
    { type: 'status', code: 'waiting', portal: 'freelance', until: later(0.5) },
    { type: 'status', code: 'scoring', portal: null, until: null },
    { type: 'progress', step: 'score', portal: null, done: 0, total: 3 },
  ];
  // Their pages and scores; without a profile nothing is scored (the backend has no matcher).
  const profiled = state.profile !== null;
  const done = arrived();
  done.forEach((j, i) => {
    events.push({
      type: 'jobUpdated',
      job: { ...j, match: profiled ? j.match : null },
      fresh: true,
    });
    events.push({ type: 'progress', step: 'score', portal: null, done: i + 1, total: 3 });
  });
  events.push({ type: 'status', code: 'writingFiles', portal: null, until: null });
  events.push({ type: 'progress', step: 'export', portal: null, done: 1, total: 1 });
  events.push({
    type: 'finished',
    summary: {
      ...lastRun(),
      kind,
      startedAt: at(0.05),
      finishedAt: at(0),
      perPortal: [
        {
          portal: 'linkedin',
          new: 1,
          known: 0,
          dup: 0,
          fetched: 1,
          failed: 0,
          gone: 0,
          skipped: 0,
          stopped: null,
        },
        {
          portal: 'freelance',
          new: 1,
          known: 0,
          dup: 0,
          fetched: 1,
          failed: 0,
          gone: 0,
          skipped: 0,
          stopped: { kind: 'paused', until: later(15), reason: 'throttled' },
        },
        {
          portal: 'freelancermap',
          new: 1,
          known: 0,
          dup: 0,
          fetched: 1,
          failed: 0,
          gone: 0,
          skipped: 0,
          stopped: null,
        },
      ],
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
  if (state.mailbox.user === null && kind !== 'rescore' && kind !== 'details') {
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

/** The rescore the app starts after a profile change: scoring only, nothing fetched. */
function rescoreScript(): RunEvent[] {
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
    if (isFetch(event.summary.kind)) state.lastRun = event.summary;
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
    return structuredClone(detailOf(j));
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
  parse_profile: ({ text, update }) => answerDraft(text, update),
  profile_prompt: ({ update }) => (update && state.profile !== null ? PROMPT_UPDATE : PROMPT),
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
    if (jobs.every((j) => j.match === null)) {
      for (const j of jobs) j.match = demoMatch(j);
    }
    refresh();
    return structuredClone(state.profile);
  },
  remove_profile: () => {
    // Like core: the profile becomes the backup, which `restore_profile` brings back.
    if (state.profile === null) return false;
    backupProfile = state.profile;
    state.profile = null;
    return true;
  },
  restore_profile: () => {
    // Like core: the backup becomes the profile, a profile that is there the backup.
    if (backupProfile === null) return false;
    [state.profile, backupProfile] = [backupProfile, state.profile];
    return true;
  },
  asked_terms: () => askedTerms(),
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
  // Like `existing` (commands/files.rs): a result file nothing wrote yet is not found, nor
  // one switched off (the Excel file, the CSV file alike).
  open_target: ({ target }) => {
    if (target.kind === 'excel' && !state.settings.excelExists) {
      throw fail('notFound', { what: 'file', path: state.settings.excelPath });
    }
    if (target.kind === 'csv' && !state.settings.csvExists) {
      throw fail('notFound', { what: 'file', path: state.settings.csvPath });
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
  failPages: 0,
  holdAfter: null,
  clipboard: null,
  unsaved: false,
  closed: false,
  holdMailbox: false,
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
        portal: null,
        minBand: null,
        contracts: [],
        remoteOnly: false,
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
  'remove_profile',
  'restore_profile',
  'save_profile_template',
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
  'reset_all',
  'restore_backup',
]);

/** Commands that refuse in the demo (`ensure_not_demo` in src-tauri): the mailbox, the
 *  portals, the vault, another work folder, the reset, a restore; `start_run` takes only a
 *  rescore. */
const DEMO_REFUSED: ReadonlySet<string> = new Set([
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
  'pick_workspace',
  'reset_all',
  'restore_backup',
]);

function demoRefuses(command: string, args: Record<string, unknown>): boolean {
  if (DEMO_REFUSED.has(command)) return true;
  return command === 'start_run' && (args.request as RunRequest).kind !== 'rescore';
}

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
  if (state.demo && demoRefuses(command, args)) throw fail('demo');
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
