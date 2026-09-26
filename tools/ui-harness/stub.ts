// Typed stand-in for @tauri-apps/api in the harness build (`vite build --mode harness`
// aliases every `@tauri-apps/api/*` import to this file). It answers every IPC command
// (typed by the generated `Commands` map) from a small in-memory store with realistic,
// invented sample data, records the calls and lets a test push run events:
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
//
// Scenarios (`?scenario=`): default · first-run · mailbox-only · no-profile · empty ·
// many (2000 jobs) · offline · paused · running · slow · list-error · profile-broken ·
// profile-thin · profile-unreadable (a value of every criterion and wish does not read, a key
// is not read at all) · reset (the state after
// "reset everything": first run, no mailbox, no profile, the report) · first-run-empty-profile
// · session-left (freelance.de still signed in while the fetch does not use the sign-in)
// · first-fetch-failed (the setup page after a first fetch that could not reach Gmail: step 3
// says why; "Abrufen" then completes and ends the setup)
// · no-minimum (a profile without a minimum day rate and a start: the reader's strip shows
// the ad's rate and start as plain facts)
// · dry-run (the demo: a Probelauf mailbox, every command that writes outside the database
// refuses with `dryRun` like `ensure_real`)
// · load-failed (the first `app_state` fails with `db`, like a start whose database cannot
// be read; a retry loads).
// `save_mailbox` refuses the app password `falschfalschfals` with `mailAuth` (Gmail said no).
// `?file=focus` lets `pick_profile` choose a file with seven Schwerpunkte (the form takes five).
// `save_profile` refuses a minimum day rate above 100.000, a minimum remote share above 100,
// a competence with more than 70 years (with its row), more than five days a week, a second
// day below the first and a minimum duration above 120 months, like core's validation.
// Engine 16 in the demo: the profile works three to five days a week for at least six months
// and excludes "Werkstudent" and "Praktikum"; 900413 asks for two days (a check), 2804 for three
// (fits), 2802 lasts three months (a check), 2807 is excluded by its title.
// `?tick=ms` sets the pace of a scripted run (default 40); `?export=locked` lets the export
// of a run find the Excel file open; `?mail=offline` lets every fetch fail to reach Gmail;
// `?folder=other` lets `pick_workspace` choose another, empty folder.
// Dates are fixed so screenshots stay stable (the tests also fix the clock). The portals
// come in the order of the backend (`Portal::ALL`).

import type {
  AppState,
  Band,
  Commands,
  Deleted,
  ErrorInfo,
  Highlight,
  JobCounts,
  JobDetail,
  JobKey,
  JobQuery,
  JobView,
  Language,
  MailboxCheck,
  MoveBack,
  Notice,
  OverviewStats,
  Place,
  Portal,
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
  /** The text `clipboard_text` returns (null: the browser's clipboard, if it allows it). */
  clipboard: string | null;
  /** The page holds unsaved changes (its last `set_unsaved`). */
  unsaved: boolean;
  /** The window was closed (`close_window`, or a close request without unsaved changes). */
  closed: boolean;
  /** The user closes the window (X, Alt+F4, Cmd+Q/W): like main.rs, the page is asked
   *  (`close-requested`) while it holds unsaved changes, else the window closes. */
  requestClose: () => void;
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
const HOME = MAC ? '/Users/demo' : 'C:/Users/demo';
const DATA_DIR = MAC
  ? '/Users/demo/Library/Application Support/job-alert-monitor'
  : 'C:/Users/demo/AppData/Roaming/job-alert-monitor';
const TICK = Number(params.get('tick') ?? 40);
const DELAY = scenario === 'slow' ? 900 : 0;
const EXPORT_LOCKED = params.get('export') === 'locked';
const MAIL_OFFLINE = scenario === 'offline' || params.get('mail') === 'offline';
/** The app's language as the backend says it (`lang=en`; German by default). */
const LANGUAGE: Language = params.get('lang') === 'en' ? 'en' : 'de';
/** The order of the backend (`Portal::ALL`), on every screen. */
const PORTALS: readonly Portal[] = ['linkedin', 'freelance', 'freelancermap'];

const NOW = new Date('2026-09-24T09:30:00+02:00').getTime();
const HOUR = 3_600_000;
const at = (hoursAgo: number): string => new Date(NOW - hoursAgo * HOUR).toISOString();
const later = (minutes: number): string => new Date(NOW + minutes * 60_000).toISOString();

/* ----------------------------------------------------------------- fixtures */

type Match = NonNullable<JobView['match']>;

/** Requirements the sample profile does not name (no competence, tool or keyword of it). */
const OPEN_MUSTS = [
  'Branchenerfahrung Energie',
  'Erfahrung mit SAP Analytics Cloud',
  'Kenntnisse in Anaplan',
];

/** A job whose ad states no key facts. */
const NO_FACTS = {
  rate: null,
  hourly: null,
  currency: null,
  rateOpen: null,
  start: null,
  months: null,
  remoteFrom: null,
  remoteTo: null,
  contract: null,
};

const scored = (score: number, top: string[], mustMet = 3, mustTotal = 4): Match => ({
  score,
  band: score >= 80 ? 'high' : score >= 40 ? 'mid' : 'low',
  status: 'scored',
  note: null,
  mustMet,
  mustTotal,
  top,
  // The reader's open musts (detailOf): one partial first when two or more are missing.
  open: OPEN_MUSTS.slice(0, Math.min(2, mustTotal - mustMet - (mustTotal - mustMet >= 2 ? 1 : 0))),
  facts: NO_FACTS,
});

/** Excluded by a hard criterion: the engine names the first violation's reason code. */
const excludedBy = (
  code: string,
  score: number,
  params: Record<string, string | number> = {},
): Match => ({
  score,
  band: score >= 80 ? 'high' : score >= 40 ? 'mid' : 'low',
  status: 'excluded',
  note: { code, params },
  mustMet: 2,
  mustTotal: 4,
  top: [],
  open: [],
  facts: NO_FACTS,
});

function job(
  portal: JobView['portal'],
  id: string,
  title: string,
  company: string,
  location: string,
  hoursAgo: number,
  extra: Partial<JobView> = {},
): JobView {
  return {
    key: { portal, id },
    portal,
    title,
    company,
    location,
    workMode: 'hybrid',
    mailDate: at(hoursAgo),
    firstSeenAt: at(hoursAgo),
    unread: false,
    pinned: false,
    detail: { kind: 'ok' },
    short: false,
    closed: false,
    match: null,
    alsoOn: [],
    place: 'inbox',
    trashedAt: null,
    overridden: false,
    appliedAt: null,
    note: null,
    ...extra,
  };
}

/** When the last fetch (`lastRun`, 1.2 to 1 hours ago) first saw its new jobs: the three
 *  best unread jobs came with it, the other unread ones are older (the two sections of the
 *  list's Neu). */
const LAST_FETCH_SAW = at(1.1);

function sampleJobs(): JobView[] {
  return [
    job(
      'freelancermap',
      '2801',
      'Interim CFO (m/w/d) für Familienunternehmen',
      'Hanseatic Holding GmbH',
      'Hamburg',
      2,
      {
        unread: true,
        pinned: true,
        alsoOn: ['linkedin'],
        firstSeenAt: LAST_FETCH_SAW,
        match: {
          ...scored(91, ['Interim-Management im Mittelstand', 'Konzernabschluss nach HGB'], 4, 4),
          facts: {
            ...NO_FACTS,
            rate: 1200,
            start: 'now',
            months: 6,
            remoteFrom: 60,
            remoteTo: 60,
            contract: 'interim',
          },
        },
      },
    ),
    job(
      'linkedin',
      '4100200301',
      'Head of Controlling Transformation',
      'Nordlicht Energie AG',
      'Bremen',
      3,
      {
        unread: true,
        firstSeenAt: LAST_FETCH_SAW,
        workMode: 'remote',
        match: {
          ...scored(84, ['Controlling mit SAP S/4HANA', 'Aufbau Reporting'], 4, 5),
          facts: {
            ...NO_FACTS,
            rate: 1250,
            start: 'now',
            remoteFrom: 100,
            remoteTo: 100,
            contract: 'interim',
          },
        },
      },
    ),
    job(
      'freelance',
      '900411',
      'SAP S/4HANA Finance Projektleitung',
      'Datenwerk Süd GmbH',
      'München',
      5,
      {
        unread: true,
        firstSeenAt: LAST_FETCH_SAW,
        detail: { kind: 'teaser' },
        match: scored(76, ['Projektleitung SAP Finance'], 2, 3),
      },
    ),
    job('freelancermap', '2802', 'Interim Head of Finance', 'Grünwerk Mobility GmbH', 'Berlin', 6, {
      unread: true,
      workMode: 'remote',
      // Three months, shorter than the profile's six: a check of the duration.
      match: {
        ...scored(72, ['Finanzplanung und Liquidität'], 3, 4),
        facts: { ...NO_FACTS, months: 3 },
      },
    }),
    job(
      'freelancermap',
      '2803',
      'Kaufmännische Leitung Projektgeschäft',
      'Werft 7 GmbH',
      'Kiel',
      9,
      {
        unread: true,
        workMode: 'onsite',
        match: scored(66, ['Projektcontrolling'], 2, 4),
      },
    ),
    job(
      'linkedin',
      '4100200302',
      'Finance Business Partner Shared Service',
      'Alpenblick Logistik AG',
      'Leipzig',
      11,
      {
        unread: true,
        detail: { kind: 'pending', retryAt: null },
      },
    ),
    job(
      'freelance',
      '900412',
      'Buchhaltung über Personaldienstleister',
      'Musterpersonal GmbH',
      'Berlin',
      12,
      {
        unread: true,
        workMode: null,
        match: excludedBy('anue', 55),
      },
    ),
    job(
      'linkedin',
      '4100200303',
      'Controller Konzernberichtswesen',
      'Contoso Services GmbH',
      'Frankfurt am Main',
      27,
      {
        match: scored(58, ['Konzernberichtswesen'], 2, 4),
        appliedAt: at(20),
        note: 'Rückruf der Personalberatung am Montag',
      },
    ),
    job('freelancermap', '2804', 'Interim Treasury Manager', 'Rheinhafen Chemie GmbH', 'Köln', 30, {
      // Three days a week for a year: both within the profile.
      match: {
        ...scored(47, ['Liquiditätsplanung'], 1, 3),
        facts: { ...NO_FACTS, months: 12, workloadFrom: 60, workloadTo: 60 },
      },
      appliedAt: at(26),
    }),
    // Archived: in no list but the archive and in no count but its own.
    job(
      'linkedin',
      '4100200306',
      'Sachbearbeitung Kreditoren',
      'Nordhafen Logistik GmbH',
      'Bremen',
      40,
      {
        match: scored(18, [], 0, 4),
        place: 'archive',
      },
    ),
    job(
      'linkedin',
      '4100200304',
      'Leitung Rechnungswesen',
      'Stadtwerke Nordheide',
      'Buchholz',
      50,
      {
        workMode: 'onsite',
        // Its page takes no applications any more (the reader says since when).
        closed: true,
        match: scored(45, ['Jahresabschluss nach HGB'], 2, 4),
      },
    ),
    job('freelance', '900413', 'SAP FI Berater Migration', 'Datenwerk Süd GmbH', 'München', 55, {
      workMode: 'onsite',
      // Two days a week, fewer than the profile's three: a check of the workload.
      match: {
        ...scored(32, ['SAP FI'], 1, 4),
        facts: { ...NO_FACTS, workloadFrom: 40, workloadTo: 40 },
      },
    }),
    job(
      'freelancermap',
      '2805',
      'Projektcontroller Bau',
      'Baufeld Projekte GmbH',
      'Stuttgart',
      70,
      {
        detail: { kind: 'failed', attempts: 3, retryAt: null },
        match: scored(24, [], 0, 3),
      },
    ),
    job('linkedin', '4100200305', 'Payroll Specialist', 'Lakeside Payroll AG', 'Zürich', 80, {
      match: excludedBy('country', 38, { allowed: 'DE, AT' }),
    }),
    // A word of the profile's exclusion words in the title (engine 16); read, older than the
    // week of the overview's market.
    job(
      'freelancermap',
      '2807',
      'Werkstudent Controlling (m/w/d)',
      'Elbufer Handel GmbH',
      'Hamburg',
      200,
      {
        workMode: null,
        match: excludedBy('exclusionWord', 41, { word: 'Werkstudent' }),
      },
    ),
    job('freelancermap', '2806', 'Reporting Analyst', 'Hafenkontor GmbH', 'Hamburg', 96, {
      short: true,
      match: {
        score: 0,
        band: 'low',
        status: 'unscorable',
        note: { code: 'shortText', params: {} },
        mustMet: 0,
        mustTotal: 0,
        top: [],
        open: [],
        facts: NO_FACTS,
      },
    }),
  ];
}

const COMPANIES = [
  'Nordlicht Energie AG',
  'Werft 7 GmbH',
  'Contoso Services GmbH',
  'Alpenblick Logistik AG',
];
const TITLES = [
  'Interim Controller',
  'SAP FI/CO Berater',
  'Finance Manager',
  'Projektleitung Finance',
];
const CITIES = ['Hamburg', 'Berlin', 'München', 'Köln', 'Leipzig'];

function manyJobs(count: number): JobView[] {
  const out: JobView[] = [];
  const portals = PORTALS;
  for (let i = 0; i < count; i += 1) {
    const score = (i * 37) % 100;
    out.push(
      job(
        portals[i % 3]!,
        String(100000 + i),
        `${TITLES[i % TITLES.length]} ${i + 1}`,
        COMPANIES[i % COMPANIES.length]!,
        CITIES[i % CITIES.length]!,
        i / 4,
        {
          unread: i % 3 === 0,
          match:
            i % 17 === 5
              ? excludedBy('dayRate', score, { rate: 700, min: 1100 })
              : scored(score, ['Controlling im Konzern']),
        },
      ),
    );
  }
  return out;
}

/** The invented sample profile of the fixtures (core/tests/fixtures/matching/sample_profile.json). */
const row = (name: string, years: number | null, aliases: string[], origin: number) => ({
  name,
  years,
  aliases,
  origin,
});
const PROFILE_FORM: ProfileForm = {
  name: 'Erika Beispiel',
  title: 'Interim Managerin Finanzen',
  competences: [
    row('Interim Management', 12, [], 0),
    row('Controlling', 18, ['Financial Controlling', 'FP&A'], 1),
    row('Konzernrechnungslegung nach IFRS', 14, [], 2),
    row('Konsolidierung', 11, [], 3),
    row('Liquiditätsplanung', 10, [], 4),
    row('Restrukturierung', 8, ['Sanierung'], 5),
  ],
  strengths: ['Aufbau von Konzernreportings in weniger als 100 Tagen'],
  keywords: ['IFRS', 'HGB', 'Konzernabschluss'],
  years: 20,
  degrees: ['Diplom-Kauffrau (Univ.)'],
  industries: ['Maschinenbau', 'Automotive', 'Chemie'],
  tools: ['SAP S/4HANA', 'LucaNet', 'Power BI'],
  certificates: ['Certified Interim Manager (DDIM)'],
  languages: [
    { language: 'Deutsch', level: 'native', origin: 0 },
    { language: 'Englisch', level: 'b2', origin: 1 },
  ],
  focus: ['Controlling', 'Konzernrechnungslegung nach IFRS'],
  roles: ['Interim CFO'],
  wishes: { dayRate: 1200, remote: 'mostly', regions: ['Hamburg'], industries: [] },
  criteria: {
    minDayRate: 1100,
    countries: ['DE', 'AT'],
    noAnue: true,
    noPermanent: false,
    available: { kind: 'unset' },
    remoteOutside: true,
    targetYears: 15,
    minSalary: null,
    permanentPlaces: [],
    permanentRemoteMin: null,
    // Engine 16: three to five days a week, at least six months, two words that exclude.
    workloadMinDays: 3,
    workloadMaxDays: 5,
    minMonths: 6,
    exclusionWords: ['Werkstudent', 'Praktikum'],
  },
};

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

const PROFILE: ProfileInfo = {
  fileName: 'profil-interim-finance.json',
  bytes: 18_422,
  savedAt: at(72),
  quality: 'good',
  understood: {
    competenceCount: 42,
    packs: ['finance', 'sap'],
    years: 20,
    degrees: ['Diplom-Kauffrau (Univ.)'],
    competences: [
      'Interim-Management',
      'Konzernabschluss nach HGB',
      'Controlling',
      'SAP S/4HANA Finance',
      'Liquiditätsplanung',
      'Restrukturierung',
      'M&A Integration',
      'Reporting',
      'Treasury',
      'Budgetierung',
      'IFRS',
      'Führung von Finanzteams',
    ],
    sources: [
      { path: 'kernkompetenzen[].kompetenz', count: 6 },
      { path: 'keywords[]', count: 3 },
      { path: 'methoden_tools[].name', count: 3 },
      { path: 'branchen[].branche', count: 3 },
      { path: 'stationen[].schwerpunkte[]', count: 27 },
    ],
    criteria: [
      { code: 'minDayRate', params: { set: true, min: '1100' } },
      { code: 'countries', params: { set: true, countries: 'DE, AT' } },
      { code: 'noAnue', params: { set: true } },
      { code: 'noPermanent', params: { set: false } },
      { code: 'availability', params: { set: false, from: null } },
      { code: 'minSalary', params: { set: false, min: null } },
      { code: 'permanentRegion', params: { set: false, places: null, remoteMin: null } },
      { code: 'targetYears', params: { set: true, min: 15 } },
      { code: 'workload', params: { set: true, minDays: 3, maxDays: 5 } },
      { code: 'duration', params: { set: true, min: 6 } },
      { code: 'exclusionWords', params: { set: true, words: 'Werkstudent, Praktikum' } },
    ],
    warnings: [
      {
        code: 'criterionNotUnderstood',
        params: { key: 'festanstellung_remote_min', value: '"viel"', field: 'permanentRemoteMin' },
      },
    ],
    focus: PROFILE_FORM.focus,
    roles: PROFILE_FORM.roles,
    wishes: PROFILE_FORM.wishes,
  },
  scoredAt: at(1),
  pending: 0,
  parseError: null,
  form: PROFILE_FORM,
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
  fetchDetails: true,
  login: name === 'freelance' ? 'optional' : 'none',
  loginEnabled: false,
  signedIn: name === 'freelance' ? false : null,
  health: { kind: 'ok' },
  actionNeeded: false,
  quota: null,
  ...extra,
});

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
    score: { scored: 10, excluded: 2, unscorable: 1, pending: 1, best: 91, delta: null },
    export: {
      overviewXlsx: 'C:/Users/demo/Jobs/Uebersicht.xlsx',
      overviewHtml: 'C:/Users/demo/Jobs/Uebersicht.html',
      backup: null,
      txtWritten: 7,
      txtFailed: 0,
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
/** The profile a `remove_profile` took (core keeps it as the backup until restored). */
let removedProfile: ProfileInfo | null = null;

function initial(): void {
  jobs = scenario === 'many' ? manyJobs(2000) : sampleJobs();
  state = {
    platform: MAC ? 'macos' : 'windows',
    dryRun: false,
    firstRun: false,
    running: null,
    settings: {
      workspace: `${HOME}/Documents/Job-Alerts`,
      workspaceIsDefault: true,
      txtFiles: 38,
      excelPath: `${HOME}/Documents/Job-Alerts/auswertung/JobAlerts.xlsx`,
      excelExists: true,
    },
    mailbox: { user: 'alerts.demo@gmail.com', vault: VAULT, error: null, check: null },
    profile: PROFILE,
    // Every portal counts its pages (the backend sends the numbers of each).
    portals: [
      portal('linkedin', { quota: { usedHour: 4, capHour: 30, usedDay: 23, capDay: 80 } }),
      portal('freelance', { quota: { usedHour: 2, capHour: 20, usedDay: 11, capDay: 60 } }),
      portal('freelancermap', { quota: { usedHour: 9, capHour: 40, usedDay: 86, capDay: 100 } }),
    ],
    setupDone: true,
    autoArchiveDays: 30,
    autoEmptyTrashDays: 30,
    language: LANGUAGE,
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
      state.mailbox = { user: null, vault: VAULT, error: null, check: null };
      state.profile = null;
      state.lastRun = null;
      state.settings.excelExists = false;
      state.settings.txtFiles = 0;
      break;
    case 'no-files':
      // A connected mailbox, but nothing written to the workspace yet.
      state.settings.excelExists = false;
      state.settings.txtFiles = 0;
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
    case 'paused':
      state.portals[0]!.health = { kind: 'paused', until: later(95), reason: 'throttled' };
      state.portals[1]!.health = { kind: 'layoutSuspect', emptyMails: 2, pages: 0 };
      // Alert mails without jobs ask her to look (core's PortalHealth::action_needed).
      state.portals[1]!.actionNeeded = true;
      // The hour binds: the bar and its words both speak of the hour.
      state.portals[2]!.quota = { usedHour: 38, capHour: 40, usedDay: 61, capDay: 100 };
      break;
    case 'reset':
      // After "reset everything" the app starts empty: the first-run page, with the report.
      jobs = [];
      state.firstRun = true;
      state.mailbox = { user: null, vault: VAULT, error: null, check: null };
      state.profile = null;
      state.lastRun = null;
      state.settings.excelExists = false;
      state.settings.txtFiles = 0;
      state.resetReport = { removed: 12, failed: 1 };
      break;
    case 'session-left':
      // A sign-in still stored while the fetch does not use it: the row offers Abmelden.
      state.portals[1]!.signedIn = true;
      break;
    case 'dry-run':
      state.dryRun = true;
      state.mailbox = {
        user: 'probelauf@example.org',
        vault: VAULT,
        error: null,
        check: null,
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
 * excluded, per portal too; a favourite counts until it goes to the trash.
 */
function countsOf(list: JobView[]): JobCounts {
  const c: JobCounts = {
    inbox: 0,
    unread: 0,
    favourites: 0,
    archive: 0,
    trash: 0,
    excluded: 0,
    high: 0,
    noDetail: 0,
    newByPortal: PORTALS.map((portal) => ({ portal, new: 0 })),
  };
  for (const j of list) {
    if (j.pinned && j.place !== 'trash') c.favourites += 1;
    if (j.place === 'archive') c.archive += 1;
    if (j.place === 'trash') c.trash += 1;
    if (j.place !== 'inbox') continue;
    const out = j.match?.status === 'excluded';
    const isNew = j.unread && !out;
    c.inbox += 1;
    c.unread += isNew ? 1 : 0;
    c.excluded += out ? 1 : 0;
    c.high += j.match?.status === 'scored' && j.match.score >= 80 ? 1 : 0;
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

/** The list of a query (store::job_page): a place, the favourites, only the unread ones. */
function inQuery(j: JobView, query: Pick<JobQuery, 'place' | 'unread' | 'favourites'>): boolean {
  const where = query.favourites ? j.pinned && j.place !== 'trash' : j.place === query.place;
  return where && (!query.unread || j.unread);
}

const BAND_FROM: Record<Band, number> = { high: 80, mid: 40, low: 0 };

/** The funnel's filter (store::ListFilter): one portal, a lowest band of scored jobs, the
 *  jobs marked "Beworben". */
function inFilter(j: JobView, query: Pick<JobQuery, 'portal' | 'minBand' | 'applied'>): boolean {
  if (query.applied === true && j.appliedAt === null) return false;
  if (query.portal !== null && query.portal !== undefined && j.key.portal !== query.portal) {
    return false;
  }
  if (query.minBand === null || query.minBand === undefined) return true;
  return j.match?.status === 'scored' && j.match.score >= BAND_FROM[query.minBand];
}

function refresh(): void {
  state.counts = countsOf(jobs);
}

const DAY_MS = 24 * HOUR;

/** The Übersicht's numbers (view::overview_stats): open musts of 30 days in the inbox, the
 *  market of 7 days, the enabled portals with their last alert mail. */
function overviewStats(): OverviewStats {
  const month = NOW - 30 * DAY_MS;
  const week = NOW - 7 * DAY_MS;
  const recent = jobs.filter((j) => Date.parse(j.mailDate ?? j.firstSeenAt) >= month);
  const scoredJobs = recent.filter((j) => j.match?.status === 'scored');
  const open = new Map<string, number>();
  for (const j of scoredJobs.filter((x) => x.place === 'inbox')) {
    for (const label of j.match?.open ?? []) open.set(label, (open.get(label) ?? 0) + 1);
  }
  const openMusts = [...open.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
  const rates = scoredJobs
    .filter((j) => (j.match?.score ?? 0) >= 40 && j.match?.facts.rate !== null)
    .map((j) => {
      const f = j.match!.facts;
      return f.hourly === true ? f.rate! * 8 : f.rate!;
    })
    .sort((a, b) => a - b);
  const mid = rates.length >> 1;
  const median =
    rates.length === 0
      ? null
      : rates.length % 2 === 1
        ? rates[mid]!
        : Math.floor((rates[mid - 1]! + rates[mid]!) / 2);
  const remote = recent
    .map((j) => {
      const f = j.match?.facts;
      const from = f?.remoteFrom ?? f?.remoteTo ?? null;
      if (from !== null) return from >= 50;
      return j.workMode === null ? null : j.workMode === 'remote';
    })
    .filter((r): r is boolean => r !== null);
  const newByPortal = PORTALS.map((portal) => ({
    portal,
    count: jobs.filter(
      (j) => j.key.portal === portal && Date.parse(j.firstSeenAt) >= week && j.place !== 'trash',
    ).length,
  }));
  const quietPortals = state.portals
    .filter((p) => p.enabled)
    .map((p) => {
      const last = jobs
        .filter((j) => j.key.portal === p.portal && j.mailDate !== null)
        .map((j) => Date.parse(j.mailDate!))
        .sort((a, b) => b - a)[0];
      const lastAlert = last === undefined ? null : new Date(last).toISOString();
      return { portal: p.portal, lastAlert, quiet: last === undefined || last < week };
    });
  return {
    openMusts,
    market: {
      newByPortal,
      medianDayRate: median,
      rateCount: rates.length,
      remoteShare:
        remote.length === 0
          ? null
          : Math.floor((remote.filter(Boolean).length * 100) / remote.length),
      remoteKnown: remote.length,
    },
    quietPortals,
  };
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

/** The portals' names as the store's search column holds them (`Portal::label`). */
const PORTAL_LABEL: Record<Portal, string> = {
  linkedin: 'linkedin.com',
  freelance: 'freelance.de',
  freelancermap: 'freelancermap.de',
};

/** Like store::search_words: every word of a search (at most 8) is in the portal's name, the
 *  title, the company or the location, in any order; an empty search matches everything. */
function matchesSearch(j: JobView, search: string | null | undefined): boolean {
  const words = fold(search ?? '')
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 8);
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
  const base = jobs.filter((j) => matchesSearch(j, query.search) && inFilter(j, query));
  // The unread filter lists every unread job, excluded ones too (grey behind the divider);
  // only the count leaves them out (store::job_page). By date: the mail's, in the trash
  // the day the job went there.
  const date = (j: JobView): string =>
    query.place === 'trash' && !query.favourites
      ? (trashedAt.get(markKey(j.key)) ?? '')
      : (j.mailDate ?? j.firstSeenAt);
  const page = base
    .filter((j) => inQuery(j, query))
    .sort((a, b) => {
      const ex = Number(a.match?.status === 'excluded') - Number(b.match?.status === 'excluded');
      if (ex !== 0) return ex;
      if (query.sort === 'match') {
        const na = Number(a.match === null) - Number(b.match === null);
        if (na !== 0) return na;
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

/* ------------------------------------------------------------------- detail */

const AD_INTRO = (j: JobView): string =>
  `Für ${j.company} suchen wir Unterstützung als ${j.title} in ${j.location || 'Deutschland'}.\n\n`;

/** Contract type per stub ad, as the engine reads it (`contractType` params): interim unless
 *  listed; a permanent job the engine only infers from the words of the ad. */
const CONTRACTS: Record<string, { type: string; inferred: boolean }> = {
  '4100200304': { type: 'permanent', inferred: false },
  '4100200305': { type: 'permanent', inferred: false },
  '4100200306': { type: 'permanent', inferred: false },
  '4100200303': { type: 'permanent', inferred: true },
  '900412': { type: 'anue', inferred: false },
  '2803': { type: 'freelance', inferred: false },
  '2805': { type: 'freelance', inferred: false },
  '900413': { type: 'freelance', inferred: false },
  '2806': { type: 'unclear', inferred: false },
  '2807': { type: 'unclear', inferred: false },
};

function contractOf(j: JobView): { type: string; inferred: boolean } {
  return CONTRACTS[j.key.id] ?? { type: 'interim', inferred: false };
}

/** How each contract type reads in an ad (the passage of the row "Vertragsart"). */
function contractWords(contract: { type: string; inferred: boolean }): string {
  switch (contract.type) {
    // No workload here: an ad states it in its frame, where its facts say so (frameOf).
    case 'interim':
      return 'Interim-Mandat';
    case 'freelance':
      return 'Freiberufliche Mitarbeit im Projekt';
    case 'permanent':
      return contract.inferred ? 'Unbefristete Position' : 'Festanstellung';
    case 'anue':
      return 'Einsatz über Arbeitnehmerüberlassung';
    default:
      return '';
  }
}

/** The experience an ad asks for: stated in its text (a passage), or the engine's estimate
 *  from the title and the tasks. The profile aims at 15 years (`zielprofil_min_jahre`). */
const YEARS: Record<string, { years: number; stated: boolean }> = {
  '2801': { years: 15, stated: true },
  '4100200301': { years: 12, stated: true },
  '900411': { years: 10, stated: false },
  '2802': { years: 10, stated: true },
  '2803': { years: 8, stated: false },
  '900412': { years: 3, stated: true },
  '4100200303': { years: 5, stated: false },
  '2804': { years: 7, stated: false },
  '4100200306': { years: 2, stated: false },
  '4100200304': { years: 10, stated: true },
  '900413': { years: 6, stated: false },
  '2805': { years: 5, stated: false },
  '4100200305': { years: 4, stated: false },
};

function yearsOf(j: JobView): { years: number; stated: boolean } {
  return YEARS[j.key.id] ?? { years: 5 + (Number(j.key.id) % 11), stated: false };
}

/** The passages of an ad's frame, as its facts say them (the engine reads the facts from
 *  them): a job's row, its reader and its prompt say the same. */
function frameOf(
  facts: Match['facts'],
  contract: string,
): { start: string; rate: string; remote: string; months: string; workload: string; text: string } {
  const start = facts.start === 'now' ? 'Start ab sofort' : 'Start zum nächstmöglichen Zeitpunkt';
  const rate =
    facts.rate === null
      ? 'Tagessatz nach Absprache'
      : `Tagessatz ${facts.rate.toLocaleString('de-DE')} €`;
  const months = facts.months === null ? '' : `Laufzeit ${facts.months} Monate`;
  const remote =
    facts.remoteFrom === null
      ? ''
      : facts.remoteFrom >= 100
        ? 'vollständig remote'
        : `Einsatz zu ${facts.remoteFrom} Prozent remote`;
  // The workload as an ad says it (the engine reads full-time, days a week and a share).
  const to = facts.workloadTo;
  const workload =
    to === undefined
      ? ''
      : to >= 100
        ? 'Einsatz in Vollzeit'
        : to % 20 === 0
          ? `Einsatz an ${to / 20} Tagen pro Woche`
          : `Auslastung ${to} Prozent`;
  const lead = contract === '' ? '' : `${contract}. `;
  const length = months === '' ? '' : `, ${months} mit Option auf Verlängerung`;
  const days = workload === '' ? '' : `, ${workload}`;
  return {
    start,
    rate,
    remote,
    months,
    workload,
    text: `\nRahmen\n${lead}${start}${length}${days}. ${rate}${remote === '' ? '' : `, ${remote}`}.\n`,
  };
}

/** The profile's days a week against an ad's workload, as core's matching::limits decides:
 *  more days than the maximum or fewer than the minimum is a check. */
function workloadFits(facts: Match['facts'], min: number | null, max: number | null): boolean {
  const to = facts.workloadTo ?? 0;
  const from = facts.workloadFrom;
  const above = from !== undefined && max !== null && from > max * 20;
  const below = min !== null && to < min * 20;
  return !above && !below;
}

/** The profile's wishes next to an ad's facts, in the engine's states (met, near, missed). */
function wishesOf(facts: Match['facts']): {
  rate: { state: string; rate: number; wish: number } | null;
  remote: { state: string; share: number; level: string } | null;
} {
  const wish = PROFILE_FORM.wishes;
  const rateState = (rate: number, target: number): string =>
    rate >= target ? 'met' : rate * 1000 >= target * 950 ? 'near' : 'missed';
  const minShare: Record<string, number> = { full: 100, mostly: 60, partly: 20 };
  const share = facts.remoteFrom;
  const min = wish.remote === null ? undefined : minShare[wish.remote];
  return {
    rate:
      facts.rate === null || wish.dayRate === null
        ? null
        : { state: rateState(facts.rate, wish.dayRate), rate: facts.rate, wish: wish.dayRate },
    remote:
      share === null || wish.remote === null || min === undefined
        ? null
        : {
            state: share >= min ? 'met' : share + 30 >= min ? 'near' : 'missed',
            share,
            level: wish.remote,
          },
  };
}

/** A wish state as the reader groups it (met, met in part, open). */
const wishKind = (state: string): Reason['kind'] =>
  state === 'met' ? 'met' : state === 'near' ? 'partial' : 'open';

/** Requirements the stub ads ask for, beyond the job's own top reasons; all of them in the
 *  sample profile (a competence, a keyword, a tool or a language). */
const MORE_MUSTS = [
  'Reporting nach IFRS',
  'Erfahrung in der Konsolidierung',
  'Restrukturierung und Sanierung',
  'Verhandlungssicheres Deutsch',
];
const PARTIAL_MUST = 'Aufbau und Weiterentwicklung des Reportings';
const NICE_MET = 'Konzernabschluss nach HGB';
const NICE_OPEN = 'Französisch in Wort und Schrift';

/** The profile's words behind a met requirement (the reason's evidence), by the ad's words. */
const EVIDENCE: Record<string, string> = {
  'Interim-Management im Mittelstand': 'Interim Management',
  'Controlling mit SAP S/4HANA': 'SAP S/4HANA',
  'Projektleitung SAP Finance': 'SAP S/4HANA',
  'Finanzplanung und Liquidität': 'Liquiditätsplanung',
  Projektcontrolling: 'Controlling',
  Konzernberichtswesen: 'Konsolidierung',
  Liquiditätsplanung: 'Liquiditätsplanung',
  'Jahresabschluss nach HGB': 'HGB',
  'SAP FI': 'SAP S/4HANA',
  'Controlling im Konzern': 'Financial Controlling',
  'Reporting nach IFRS': 'Konzernrechnungslegung nach IFRS',
  'Erfahrung in der Konsolidierung': 'Konsolidierung',
  'Restrukturierung und Sanierung': 'Restrukturierung',
  'Verhandlungssicheres Deutsch': 'Deutsch',
  [PARTIAL_MUST]: 'Aufbau von Konzernreportings in weniger als 100 Tagen',
  [NICE_MET]: 'Konzernabschluss',
};

/**
 * The detail of a job. Its reasons agree with the list numbers: exactly `mustMet` met must
 * requirements, and `mustTotal - mustMet` that are not met (the first of two or more is
 * partial, the rest open), plus one met and one open nice-to-have. The terms follow the
 * engine's verdict, also for a job included by hand ("Trotzdem einbeziehen" keeps what the
 * engine found: a violation stays a violation, core view::overridden).
 */
function detailOf(j: JobView): JobDetail {
  const m = j.match;
  // The engine's own verdict, before the user counted the job anyway.
  const engine = overridden.get(markKey(j.key)) ?? m;
  const excludedBy = engine?.status === 'excluded' ? (engine.note?.code ?? null) : null;
  const notes = engine?.note?.params ?? {};
  const mustMet = m?.mustMet ?? 0;
  const missing = Math.max(0, (m?.mustTotal ?? 0) - mustMet);
  const metMusts = [...(m?.top.slice(0, 1) ?? []), ...MORE_MUSTS].slice(0, mustMet);
  const partial = missing >= 2 ? [PARTIAL_MUST] : [];
  const openMusts = OPEN_MUSTS.slice(0, missing - partial.length);
  const tasks = ['Führung eines Teams von sechs Personen', 'Monatsabschluss und Forecast'];
  const contract = contractOf(j);
  const years = yearsOf(j);
  const yearsWords = `Mindestens ${years.years} Jahre Berufserfahrung in Finanzfunktionen`;

  // A day rate that excludes the job is one the ad states.
  const facts: Match['facts'] = {
    ...(m?.facts ?? NO_FACTS),
    ...(excludedBy === 'dayRate' && typeof notes.rate === 'number' ? { rate: notes.rate } : {}),
  };
  const frame = frameOf(facts, contractWords(contract));
  const parts: string[] = [AD_INTRO(j), 'Ihre Aufgaben\n'];
  for (const t of [...tasks, ...partial]) parts.push(`• ${t}\n`);
  parts.push('\nIhr Profil\n');
  if (years.stated) parts.push(`• ${yearsWords}\n`);
  for (const r of [...metMusts, NICE_MET, ...openMusts, NICE_OPEN]) parts.push(`• ${r}\n`);
  parts.push(frame.text);
  const text = parts.join('');
  // The text the reader gets: all of it, the start of a preview, or none yet.
  const ok = j.detail.kind === 'ok';
  const shown = ok ? text : j.detail.kind === 'teaser' ? AD_INTRO(j).trim() : null;
  /** The first range of words in the text shown (none for no words, words it lacks or words
   *  past the end of a preview). */
  const rangeOf = (words: string, from = 0): { start: number; end: number }[] => {
    const start = words === '' || shown === null ? -1 : text.indexOf(words, from);
    const end = start + words.length;
    return start >= 0 && end <= (shown?.length ?? 0) ? [{ start, end }] : [];
  };
  // The place as the intro says it ("… in Hamburg.").
  const placeAt = text.indexOf(` in ${j.location}`);
  const place = placeAt >= 0 && j.location !== '' ? rangeOf(j.location, placeAt) : [];

  const reasons: Reason[] = [];
  const highlights: Highlight[] = [];
  const add = (
    kind: Reason['kind'],
    weight: Reason['weight'],
    code: string,
    label: string,
    extra: Record<string, string | number | boolean | null> = {},
    ranges = rangeOf(label),
  ): void => {
    const id = String(reasons.length);
    for (const r of ranges) {
      highlights.push({
        id: String(highlights.length),
        start: r.start,
        end: r.end,
        kind,
        reason: id,
      });
    }
    const profile = EVIDENCE[label];
    reasons.push({
      id,
      kind,
      weight,
      code,
      label,
      evidence:
        profile && (kind === 'met' || kind === 'partial')
          ? { profile, path: 'kernkompetenzen[2].kompetenz', via: 'synonym', quote: label }
          : null,
      params: extra,
      ranges,
    });
  };
  // Included by hand: the user's word comes first (core view::overridden); no words of its own.
  if (j.overridden) add('met', 'info', 'userOverride', '', {}, []);
  const contractRange = rangeOf(contractWords(contract));
  add(
    contract.inferred || contract.type === 'unclear' ? 'check' : 'met',
    'info',
    'contractType',
    '',
    contract,
    contractRange,
  );
  for (const r of metMusts) add('met', 'must', 'requirement', r);
  for (const r of partial) add('partial', 'must', 'requirement', r);
  for (const r of openMusts) add('open', 'must', 'requirement', r);
  add('met', 'nice', 'requirement', NICE_MET);
  add('open', 'nice', 'requirement', NICE_OPEN);
  if (facts.start !== 'now') add('check', 'info', 'startVague', '', {}, rangeOf(frame.start));
  // The engine's violation, where the ad says it.
  const min = PROFILE_FORM.criteria.minDayRate ?? 0;
  if (excludedBy === 'anue') add('violation', 'hard', 'anue', '', {}, contractRange);
  if (excludedBy === 'country') {
    add('violation', 'hard', 'country', '', { allowed: 'DE, AT', location: j.location }, place);
  }
  if (excludedBy === 'dayRate') {
    add('violation', 'hard', 'dayRate', '', { rate: facts.rate, min }, rangeOf(frame.rate));
  }
  // An exclusion word of the profile, where the title or the ad says it (engine 16). Like
  // core matching::exclusion the sentence that names it is marked, not the word; every
  // sentence of a stub ad is a line of its own (a point without its bullet).
  const word = excludedBy === 'exclusionWord' ? String(notes.word ?? '') : null;
  const sentenceOf = (words: string): { start: number; end: number }[] => {
    const found = text.indexOf(words);
    if (words === '' || found < 0) return [];
    const from = text.lastIndexOf('\n', found) + 1;
    const to = text.indexOf('\n', found);
    const line = text
      .slice(from, to < 0 ? text.length : to)
      .replace(/^•\s*/, '')
      .trim();
    return rangeOf(line, from);
  };
  const wordRange = word === null ? [] : sentenceOf(word);
  const wordReason = word === null ? null : String(reasons.length);
  if (word !== null) add('violation', 'hard', 'exclusionWord', '', { word }, wordRange);
  // The profile's days a week and minimum duration (engine 16) are checks, never an
  // exclusion; a permanent job has no end.
  const limits = state.profile?.form?.criteria ?? PROFILE_FORM.criteria;
  const minDays = limits.workloadMinDays ?? null;
  const maxDays = limits.workloadMaxDays ?? null;
  const minMonths = limits.minMonths ?? null;
  const days: Record<string, number> = {
    ...(minDays === null ? {} : { minDays }),
    ...(maxDays === null ? {} : { maxDays }),
  };
  const stated: Record<string, number> =
    facts.workloadTo === undefined
      ? {}
      : {
          ...(facts.workloadFrom === undefined ? {} : { from: facts.workloadFrom }),
          to: facts.workloadTo,
        };
  const workloadSet = minDays !== null || maxDays !== null;
  const workloadRange = rangeOf(frame.workload);
  const workloadReason =
    workloadSet && facts.workloadTo !== undefined && !workloadFits(facts, minDays, maxDays)
      ? String(reasons.length)
      : null;
  if (workloadReason !== null) {
    add('check', 'info', 'workload', '', { ...stated, ...days }, workloadRange);
  }
  const durationSet = minMonths !== null && contract.type !== 'permanent';
  const monthsRange = rangeOf(frame.months);
  let durationReason: string | null = null;
  if (durationSet && minMonths !== null && facts.months !== null && facts.months < minMonths) {
    durationReason = String(reasons.length);
    add('check', 'info', 'duration', '', { months: facts.months, min: minMonths }, monthsRange);
  }
  // The experience against the profile's target of 15 years: enough, or a senior title that
  // asks for fewer (the profile brings more); an estimate below it is a point to check, and
  // stated below it for a junior role it excludes.
  const target = PROFILE_FORM.criteria.targetYears ?? 0;
  const senior = /Head|Leitung|Leiter|CFO|Manager/.test(j.title);
  const yearsRange = years.stated ? rangeOf(yearsWords) : [];
  const yearsKind: Reason['kind'] =
    years.years >= target ? 'met' : !years.stated ? 'check' : senior ? 'partial' : 'violation';
  if (yearsKind === 'partial') {
    add('partial', 'info', 'overqualified', '', { years: years.years, target }, yearsRange);
  } else if (yearsKind === 'violation') {
    add('violation', 'hard', 'tooJunior', '', { years: years.years, target }, yearsRange);
  }
  // Wishes of the profile (engine v4), next to what the ad states.
  const wishes = wishesOf(facts);
  if (wishes.rate !== null) {
    add(wishKind(wishes.rate.state), 'info', 'dayRateWish', '', wishes.rate, rangeOf(frame.rate));
  }
  if (wishes.remote !== null) {
    add(
      wishKind(wishes.remote.state),
      'info',
      'remoteWish',
      '',
      { ...wishes.remote },
      rangeOf(frame.remote),
    );
  }
  // The terms show the criteria the profile sets (the engine leaves out the others), with
  // the ad's value and the passage that states it; `open` = the ad does not say.
  const criterion = (
    id: string,
    kind: Reason['kind'],
    code: string,
    params: Record<string, string | number | boolean> = {},
    ranges: { start: number; end: number }[] = [],
  ): Reason => ({
    id,
    kind,
    weight: 'hard',
    code,
    label: '',
    evidence: null,
    params,
    ranges,
  });
  // The contract says whether it is temporary agency work: stated as another type it is not;
  // inferred or unclear it is a point to check.
  const agency: Reason['kind'] =
    excludedBy === 'anue'
      ? 'violation'
      : contract.inferred || contract.type === 'unclear'
        ? 'check'
        : 'met';
  const criteria: Reason[] = [
    facts.rate === null
      ? criterion(
          'c:minDayRate',
          'open',
          'minDayRate',
          { rateOpen: true, min },
          rangeOf(frame.rate),
        )
      : criterion(
          'c:minDayRate',
          facts.rate >= min ? 'met' : 'violation',
          'minDayRate',
          { rate: facts.rate, min },
          rangeOf(frame.rate),
        ),
    criterion(
      'c:countries',
      excludedBy === 'country' ? 'violation' : 'met',
      'countries',
      { location: j.location, countries: 'DE, AT' },
      place,
    ),
    criterion(
      'c:noAnue',
      agency,
      'noAnue',
      agency === 'check' ? {} : { contract: contract.type },
      contractRange,
    ),
    facts.start === 'now'
      ? criterion('c:availability', 'met', 'availability', { start: 'now' }, rangeOf(frame.start))
      : criterion(
          'c:availability',
          'open',
          'availability',
          { start: 'vague' },
          rangeOf(frame.start),
        ),
    criterion(
      'c:targetYears',
      yearsKind,
      'targetYears',
      { years: years.years, target },
      yearsRange,
    ),
  ].filter(
    // Like the engine, a criterion the profile does not set is left out (the sample profile's
    // start counts as set, except in no-minimum).
    (c) =>
      (c.code !== 'minDayRate' || state.profile?.form?.criteria.minDayRate !== null) &&
      (c.code !== 'availability' || scenario !== 'no-minimum'),
  );
  // Engine 16: the profile's values, the ad's and the reason that decided it (core
  // view::criteria_strip); the exclusion words show only where one excludes the job.
  const linked = (id: string | null): Record<string, string> => (id === null ? {} : { reason: id });
  if (workloadSet) {
    const kind =
      facts.workloadTo === undefined ? 'open' : workloadReason === null ? 'met' : 'check';
    criteria.push(
      criterion(
        'c:workload',
        kind,
        'workload',
        { ...days, ...stated, ...linked(workloadReason) },
        workloadRange,
      ),
    );
  }
  if (durationSet && minMonths !== null) {
    const kind = facts.months === null ? 'open' : durationReason === null ? 'met' : 'check';
    const months: Record<string, number> = facts.months === null ? {} : { months: facts.months };
    criteria.push(
      criterion(
        'c:duration',
        kind,
        'duration',
        { min: minMonths, ...months, ...linked(durationReason) },
        monthsRange,
      ),
    );
  }
  if (word !== null) {
    const words = (limits.exclusionWords ?? []).join(', ');
    criteria.push(
      criterion(
        'c:exclusionWords',
        'violation',
        'exclusionWords',
        { words, word, ...linked(wordReason) },
        wordRange,
      ),
    );
  }
  // A closed ad was last fetched when its page said so.
  const fetchedAt = ok ? (j.closed ? at(20) : j.firstSeenAt) : null;
  return {
    job: j,
    text: shown,
    url: `https://example.com/${j.portal}/${j.key.id}`,
    fetchedAt,
    mail: {
      subject: 'Neue Jobs für Ihr Profil',
      gmailUrl: 'https://mail.google.com/mail/u/0/#all/18c2f0a9d1e4b7a3',
    },
    match:
      m === null || state.profile === null
        ? null
        : {
            score: m.score,
            status: m.status,
            band: m.band,
            rev: '0123456789abcdef',
            at: at(1),
            summary: m.note,
            reasons: m.status === 'unscorable' ? [] : reasons,
            highlights,
            criteria,
          },
  };
}

/** The profile part of the prompts (core leaves out name and contact data the same way). */
const PROMPT_PROFILE = [
  'Mein Profil (JSON, ohne Name und Kontaktdaten)',
  '```json',
  JSON.stringify(
    {
      titel: PROFILE_FORM.title,
      kernkompetenzen: PROFILE.understood?.competences ?? [],
      schwerpunkte: PROFILE_FORM.focus,
      wunschrollen: PROFILE_FORM.roles,
      harte_kriterien: {
        min_tagessatz: PROFILE_FORM.criteria.minDayRate,
        laender: PROFILE_FORM.criteria.countries,
      },
      einsatzpraeferenzen: {
        tagessatz_wunsch: PROFILE_FORM.wishes.dayRate,
        remote: PROFILE_FORM.wishes.remote,
      },
    },
    null,
    2,
  ),
  '```',
];

/** The facts and text of one ad in a prompt. */
function adOf(j: JobView): string[] {
  const d = detailOf(j);
  return [
    `Titel: ${j.title}`,
    `Unternehmen: ${j.company}`,
    `Ort: ${j.location}`,
    `Link: ${d.url}`,
    ...(j.match ? [`Passung laut App: ${j.match.score} von 100`] : []),
    '',
    d.text ?? 'Den vollständigen Anzeigentext hat die App noch nicht.',
  ];
}

/** A prompt like core's export::ai_prompt: the rubric in short, the profile, the ad. */
function promptOf(j: JobView): string {
  return [
    'Du unterstützt mich als KI-Assistent bei der Auswahl von Projekten. Bitte prüfe gründlich, wie gut diese Stellenanzeige zu meinem Beraterprofil passt.',
    '',
    ...PROMPT_PROFILE,
    '',
    'Die Anzeige',
    ...adOf(j),
  ].join('\n');
}

/**
 * Like core's export::ai_prompt_top: the best current matches (3 to 5; favourites first, then
 * by score; only the inbox, never excluded or gone), compared in one prompt.
 */
function promptTopOf(limit: number): string {
  const best = jobs
    .filter((j) => j.match?.status === 'scored' && j.place === 'inbox' && j.detail.kind !== 'gone')
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
        b.firstSeenAt.localeCompare(a.firstSeenAt),
    )
    .slice(0, Math.min(5, Math.max(3, limit)));
  if (best.length === 0) throw fail('notFound', { what: 'jobs' });
  return [
    'Du unterstützt mich als KI-Assistent bei der Auswahl von Projekten. Bitte vergleiche die besten aktuellen Jobs aus meiner Job-Alert-App mit meinem Beraterprofil und bring sie in eine Reihenfolge.',
    '',
    ...PROMPT_PROFILE,
    '',
    'Die Jobs',
    ...best.flatMap((j, i) => ['', `Job ${i + 1}`, ...adOf(j)]),
  ].join('\n');
}

/* --------------------------------------------------------------------- runs */

let running = false;
/** The kind of the run in progress (its end names it). */
let runningKind: RunSummary['kind'] = 'fetch';

function fail(kind: ErrorInfo['kind'], params: ErrorInfo['params'] = {}): ErrorInfo {
  return { kind, params };
}

/** Through the channel of the run, or without a run the page's channel (as Rust does). */
function emit(event: RunEvent): void {
  (runSender ?? pageSender)?.send(event);
}

const isFetch = (kind: RunSummary['kind']): boolean => kind === 'fetch' || kind === 'fullMailbox';

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

const NEW_JOBS: JobView[] = [
  job(
    'linkedin',
    '4100200399',
    'Interim CFO Carve-out',
    'Brückenwerk Industrie AG',
    'Hannover',
    0.1,
    { unread: true, detail: { kind: 'pending', retryAt: null } },
  ),
  job(
    'freelancermap',
    '2899',
    'Controlling Lead Post-Merger',
    'Elbufer Medien GmbH',
    'Hamburg',
    0.1,
    { unread: true, detail: { kind: 'pending', retryAt: null } },
  ),
  job(
    'freelance',
    '900499',
    'Buchhalter im Kundeneinsatz',
    'Personalwerk Nord GmbH',
    'Bremen',
    0.1,
    { unread: true, workMode: null, detail: { kind: 'pending', retryAt: null } },
  ),
];

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
    ...NEW_JOBS.map((j): RunEvent => ({ type: 'jobUpdated', job: j, fresh: true })),
    { type: 'status', code: 'fetchingDetails', portal: 'linkedin', until: null },
    { type: 'progress', step: 'fetch', portal: null, done: 0, total: 2 },
    { type: 'progress', step: 'fetch', portal: null, done: 1, total: 2 },
    { type: 'progress', step: 'fetch', portal: null, done: 2, total: 2 },
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
  // Without a profile nothing is scored (the backend has no matcher then).
  const profiled = state.profile !== null;
  const results: Match[] = [
    scored(88, ['Carve-out Erfahrung', 'Konzernabschluss nach HGB'], 4, 4),
    scored(61, ['Post-Merger-Integration'], 2, 4),
    excludedBy('anue', 49),
  ];
  NEW_JOBS.forEach((j, i) => {
    events.push({
      type: 'jobUpdated',
      job: {
        ...j,
        detail: i === 2 ? j.detail : { kind: 'ok' },
        match: profiled ? results[i]! : null,
      },
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
          fetched: 0,
          failed: 0,
          gone: 0,
          skipped: 1,
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
      // Three new jobs, the excluded one is none; the 88 fits well (without a profile none
      // is excluded and none fits well).
      newJobs: profiled ? { count: 2, high: 1 } : { count: 3, high: 0 },
      export: exported(),
      emptyAlerts: [],
    },
  });
  return events;
}

/** "Details holen" for jobs: their pages, their scores, no mailbox and no new jobs. */
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
      job: {
        ...j,
        detail: { kind: 'ok' },
        match: state.profile === null ? null : (j.match ?? scored(62, ['Controlling'], 2, 3)),
      },
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
    MAIL_OFFLINE && isFetch(kind)
      ? offlineScript()
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

function offlineScript(): RunEvent[] {
  return [
    { type: 'started', kind: 'fetch' },
    { type: 'status', code: 'connectingMail', portal: null, until: null },
    {
      type: 'finished',
      summary: {
        ...lastRun({ kind: 'failed', error: fail('mailConnect') }),
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
  // The favourite, a flag of its own whatever the place (store::set_pinned).
  set_pinned: ({ key, on }) => {
    const j = find(key);
    if (j === undefined || j.pinned === on) return false;
    j.pinned = on;
    refresh();
    return true;
  },
  move_jobs: ({ keys, to }) => moveJobs(keys, to),
  move_back: ({ jobs: back }) => moveBack(back),
  restore_jobs: ({ keys }) => restoreJobs(keys),
  // What the list shows: with a search only its hits, with the filter only its jobs
  // (store::mark_all_read_filtered).
  mark_all_read: ({ place, search, portal, minBand, applied }) => {
    const marked = jobs.filter(
      (j) =>
        j.unread &&
        j.place === place &&
        matchesSearch(j, search) &&
        inFilter(j, { portal, minBand, applied }),
    );
    for (const j of marked) j.unread = false;
    refresh();
    return marked.map((j) => structuredClone(j.key));
  },
  // "Beworben" with its time; never archives the job (store::set_applied).
  set_applied: ({ keys, on }) => {
    const changed: JobKey[] = [];
    for (const key of keys) {
      const j = find(key);
      if (j === undefined || (j.appliedAt !== null) === on) continue;
      j.appliedAt = on ? new Date(Date.now()).toISOString() : null;
      changed.push(structuredClone(j.key));
    }
    refresh();
    return changed;
  },
  set_note: ({ key, note }) => {
    const j = find(key);
    const next = note === null || note.trim() === '' ? null : note.trim().slice(0, 2000);
    if (j === undefined || j.note === next) return false;
    j.note = next;
    refresh();
    return true;
  },
  overview_stats: () => structuredClone(overviewStats()),
  company_count: ({ company, days }) => {
    const since = Date.now() - days * DAY_MS;
    return jobs.filter(
      (j) => j.company === company && Date.parse(j.firstSeenAt) >= since && j.place !== 'trash',
    ).length;
  },
  mark_unread: ({ keys }) => {
    let changed = 0;
    for (const key of keys) {
      const j = find(key);
      if (j === undefined || j.unread) continue;
      j.unread = true;
      changed += 1;
    }
    refresh();
    return changed;
  },
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
  ai_prompt_top: ({ limit }) => {
    if (state.profile === null) throw fail('notFound', { what: 'profile' });
    return promptTopOf(limit);
  },
  pick_profile: () => structuredClone(params.get('file') === 'focus' ? FOCUS_DRAFT : FILE_DRAFT),
  parse_profile: ({ text, update }) => answerDraft(text, update),
  profile_prompt: ({ update }) => (update && state.profile !== null ? PROMPT_UPDATE : PROMPT),
  save_profile: ({ save }) => {
    const after = save.after;
    const refuse = (field: string, max: number | null, row: number | null = null): never => {
      throw fail('invalid', { reason: 'profileValue', field, row, max });
    };
    if ((after.criteria.minDayRate ?? 0) > 100_000) refuse('minDayRate', 100_000);
    // Hidden or not, like core's validation.
    if ((after.criteria.permanentRemoteMin ?? 0) > 100) refuse('permanentRemoteMin', 100);
    const tooLong = after.competences.findIndex((r) => (r.years ?? 0) > 70);
    if (tooLong >= 0) refuse('competences', 70, tooLong);
    if (after.focus.length > 5) refuse('focus', 5);
    // Engine 16 (core form::validate_limits): at most five days a week, the second day not
    // below the first, at most 120 months, and words within what a profile holds.
    const c = after.criteria;
    const minDays = c.workloadMinDays ?? null;
    const maxDays = c.workloadMaxDays ?? null;
    if ((minDays ?? 0) > 5) refuse('workloadMinDays', 5);
    if ((maxDays ?? 0) > 5) refuse('workloadMaxDays', 5);
    if (minDays !== null && maxDays !== null && maxDays < minDays) refuse('workloadMaxDays', null);
    if ((c.minMonths ?? 0) > 120) refuse('minMonths', 120);
    const words = c.exclusionWords ?? [];
    if (words.length > 300 || words.some((w) => w.length > 1000)) refuse('exclusionWords', null);
    const form = savedForm(after);
    const count = form.competences.length + form.tools.length + form.keywords.length;
    const quality = count === 0 ? 'empty' : count < 5 ? 'thin' : 'good';
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
    if (jobs.every((j) => j.match === null)) {
      const sample = sampleJobs();
      for (const j of jobs) j.match = sample.find((s) => s.key.id === j.key.id)?.match ?? null;
    }
    refresh();
    return structuredClone(state.profile);
  },
  remove_profile: () => {
    // Like core: the profile becomes the backup, which `restore_profile` brings back.
    removedProfile = state.profile;
    state.profile = null;
    return removedProfile !== null;
  },
  restore_profile: () => {
    if (state.profile !== null || removedProfile === null) return false;
    state.profile = removedProfile;
    removedProfile = null;
    return true;
  },
  set_unsaved: ({ on }) => {
    harness.unsaved = on;
    return null;
  },
  close_window: () => {
    harness.unsaved = false;
    harness.closed = true;
    return null;
  },
  save_mailbox: ({ user, password }) => {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(user)) {
      throw fail('invalid', { reason: 'mailAddress' });
    }
    if (!/^[a-z]{16}$/i.test(password.replace(/\s/g, ''))) {
      throw fail('invalid', { reason: 'appPassword' });
    }
    if (password.replace(/\s/g, '').toLowerCase() === WRONG_PASSWORD) throw fail('mailAuth');
    state.mailbox = { user, vault: VAULT, error: null, check: DEMO_CHECK };
    return state.mailbox;
  },
  remove_mailbox: () => {
    state.mailbox = { user: null, vault: VAULT, error: null, check: null };
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
  pick_workspace: () => {
    if (params.get('folder') !== 'other') return null;
    // Nothing is written there yet: the text files stay in the old folder.
    const folder = `${HOME}/Documents/Jobs`;
    state.settings = {
      workspace: folder,
      workspaceIsDefault: false,
      txtFiles: 0,
      excelPath: `${folder}/auswertung/JobAlerts.xlsx`,
      excelExists: false,
    };
    return folder;
  },
  rewrite_txt: () => ({
    overviewXlsx: null,
    overviewHtml: null,
    backup: null,
    txtWritten: state.settings.txtFiles,
    txtFailed: 0,
    error: null,
  }),
  clear_txt: () => {
    const removed = state.settings.txtFiles;
    state.settings.txtFiles = 0;
    return { removed, failed: [] };
  },
  // Like `existing` (commands/app.rs): a result file nothing wrote yet is not found (the
  // HTML overview is written before it opens, except in the dry run).
  open_target: ({ target }) => {
    const file = target.kind === 'excel' || (target.kind === 'overview' && state.dryRun);
    if (file && !state.settings.excelExists) {
      throw fail('notFound', { what: 'file', path: state.settings.excelPath });
    }
    return null;
  },
  save_settings: ({ patch }) => {
    for (const change of patch.portals) {
      const p = state.portals.find((x) => x.portal === change.portal);
      if (p === undefined) continue;
      if (change.enabled !== null) p.enabled = change.enabled;
      if (change.fetchDetails !== null) p.fetchDetails = change.fetchDetails;
      if (change.loginEnabled !== null) p.loginEnabled = change.loginEnabled;
    }
    // Every portal may be off (the backend saves it); a fetch is then refused, see start_run.
    if (patch.autoArchiveDays !== null) state.autoArchiveDays = patch.autoArchiveDays;
    if (patch.autoEmptyTrashDays !== null) state.autoEmptyTrashDays = patch.autoEmptyTrashDays;
    if (patch.language !== null) state.language = patch.language;
    return structuredClone(state);
  },
  reset_all: () => null,
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
  requestClose() {
    if (!harness.unsaved) {
      harness.closed = true;
      return;
    }
    for (const handler of listeners.get('close-requested') ?? []) handler({ payload: null });
  },
  job(key) {
    const found = find(key);
    return found === undefined ? null : structuredClone(found);
  },
};
window.__harness = harness;
initial();

/* --------------------------------------------------------------------- core */

/** The app password Gmail refuses in the harness. */
const WRONG_PASSWORD = 'falschfalschfals';

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
  'rewrite_txt',
  'clear_txt',
  'reset_all',
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
