// Typed stand-in for @tauri-apps/api in the harness build (`vite build --mode harness`
// aliases every `@tauri-apps/api/*` import to this file). It answers every IPC command
// (typed by the generated `Commands` map) from a small in-memory store, records the calls and
// lets a test push run events. Everything the engine computes (scores, reasons, passages, the
// profile as understood, the prompts) comes from demo/snapshot.json,
// which core/tests/ui_demo_snapshot.rs writes from the invented ads of demo/ads.json; the stub
// only keeps state (docs/CHANGING.md, "The preview's demo data"):
// In the demo window (tools/demo.cmd: the app's real window around this stub) the window's
// commands and events go to Tauri, every data command stays here.
//
//   window.__harness.calls          [command, args][]
//   window.__harness.emit(event)    send a RunEvent the way Rust does (the run's channel,
//                                   else the page's channel from its last app_state)
//   window.__harness.appRun(kind)   a run the page did not start (a rescore after a profile
//                                   change, a fetch started elsewhere): on the page's channel
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
// `?way=mail`: the fetch reads the mailbox (its menu's "Postfach") instead of searching; a
// scripted fetch brings the jobs of the way it takes (the search freelancermap's).
//
// Scenarios (`?scenario=`): default · first-run · setup-cv (the setup after the CV: no
// wished role or language; Deutschland as every new profile has it) · setup-profile (a profile, no mailbox) · setup-mailbox
// (a profile and a mailbox just connected) · mailbox-only · no-profile · empty ·
// many (2000 jobs) · offline · mailbox-refused (Gmail refused the app password while the
// search went on) · paused · running · slow · list-error · profile-broken ·
// concept (five jobs for design reviews: high, medium, low, not scored, excluded) ·
// profile-thin (complete, few terms) · profile-incomplete (no wished role and no language:
// two required fields open) · first-run-empty-profile (no competence, no language)
// · session-left (freelance.de still signed in while the fetch does not use the sign-in)
// · first-fetch-failed (the setup page after a first fetch that could not reach Gmail: step 3
// says why; "Abrufen" then completes and ends the setup)
// · no-minimum (a profile without a minimum day rate: the reader's strip shows the ad's rate
// as a plain fact)
// · dry-run (a Probelauf mailbox, every command that writes outside the database refuses
// with `dryRun` like `ensure_real`)
// · load-failed (the first `app_state` fails with `db`, like a start whose database cannot
// be read; a retry loads) · quiet-alert (freelance.de sent no alert mail for nine days
// before the last fetch).
// `save_mailbox` refuses the app password `falschfalschfals` with `mailAuth` (Gmail said no);
// with `?alerts=none` its check finds no alert mail.
// One profile (core's profile::set): `save_profile` makes it or saves it, refuses a day rate
// above 100.000, a salary above 10.000.000 and a competence with more than 70 years (with its
// row) like core's validation, and names what a usable profile still needs (`missing`, like
// core's missing_required); a saved profile starts the rescore like core (with jobs, while no
// run goes), whose summary says what the save changed in Aktuell (`ScoreDelta`).
// "Aus Lebenslauf ausfüllen" (`profile_from_cv`) answers after a few seconds with the demo
// profile filled from a CV (merged into a stored one);
// `dropped` takes the files last dropped on the window like the window keeps them (`notFound`
// without one). `?cv=limit|paused|offline|timeout|unreadable|tooBig|unsupported|unavailable|
// outdated` fails like the CV evaluation (`limit` also sets `cvUntil`), `?cv=used` starts with
// the tries used up (`cvUntil`), `?cv=slow` takes as long as a real one, `?cv=none` closes the
// file dialog. `profile_missing` names what a form still lacks like core's missing_required.
// Engine 16 in the demo: the profile works three to five days a week for at least six months
// and excludes "Werkstudent" and "Praktikum"; 900413 asks for two days (a check), 2804 for three
// (fits), 2802 lasts three months (a check), 2807 is excluded by its title.
// `?tick=ms` sets the pace of a scripted run (default 40); `?mail=offline` lets every fetch fail to reach Gmail,
// `?mail=no-internet` find no network at all (`offline`: "Keine Verbindung zum Internet");
// `?folder=other` lets `pick_workspace` choose another folder without a profile (the profile
// comes along), `?folder=own` one with its own.
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
  MailboxCheck,
  MoveBack,
  Place,
  PortalState,
  ProfileForm,
  ProfileInfo,
  ProfileUnderstanding,
  Reason,
  RunEvent,
  RunRequest,
  RunSummary,
  ScoreDelta,
  TermField,
} from '../../ui/src/lib/ipc/types';
import { bandOf } from '../../ui/src/lib/ipc/types/bands';
import { PORTAL_LABEL, PORTALS } from '../../ui/src/lib/ipc/types/portals';
import { EMPTY_FORM, MAX_YEARS, NUMBER_LIMITS } from '../../ui/src/lib/ipc/types/profile';
import type { CvFailure } from '../../ui/src/lib/ipc/api';
import snapshot from './demo/snapshot.json';
// The engine's words of the suggestions (written by core's matching::vocabulary test).
import VOCABULARY from './demo/vocabulary.json';
import type { Snapshot } from './snapshot';
import { installPreviewMenu, preview } from './preview';

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
  /** A text of the UI's catalog (`'keysHelp.fetch'`, a function
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

/* ------------------------------------------------------------- demo window */

/** What Tauri lays into the page when it runs around it (the demo window, tools/demo.cmd). */
interface TauriInternals {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (callback: (event: { payload: unknown }) => void) => number;
}

/** The real Tauri around the page, or null in a browser and in the specs. The demo window is
 *  the app's own window around this stub: the window's commands and events go to it (the
 *  buttons, the caption, closing), every data command stays here. */
const TAURI =
  (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__ ?? null;
/** The commands of the window itself (commands/window.rs and the close guard). */
const WINDOW_COMMANDS: ReadonlySet<string> = new Set([
  'window_button',
  'window_maximized',
  'close_window',
  'answer_close',
  'set_unsaved',
]);
/** The events the real window sends (platform.rs, main.rs); the drops arrive through
 *  `harness.fire` so the stub keeps the dropped files like the window does. */
const WINDOW_EVENTS: ReadonlySet<string> = new Set([
  'caption',
  'window-state',
  'close-requested',
  'close-running',
  'closing',
  'tauri://focus',
  'tauri://blur',
]);
const DROP_EVENTS = ['tauri://drag-enter', 'tauri://drag-leave', 'tauri://drag-drop'];

/** Listens to an event of the real window (what @tauri-apps/api/event does). */
async function listenTauri(
  tauri: TauriInternals,
  name: string,
  handler: (event: { payload: unknown }) => void,
): Promise<() => void> {
  const id = await tauri.invoke('plugin:event|listen', {
    event: name,
    target: { kind: 'Any' },
    handler: tauri.transformCallback(handler),
  });
  return () => void tauri.invoke('plugin:event|unlisten', { event: name, eventId: id });
}

/* ----------------------------------------------------------------- scenario */

const params = new URLSearchParams(location.search);
/** The preview in a browser (`tools/ui-preview.cmd`), not a spec driving it: waits like the
 *  real app's and the preview menu (preview.ts). */
const PREVIEW = !navigator.webdriver;
/** Without a scenario the preview opens like the real app the first time (`demo`), the specs
 *  the demo data. */
const scenario = params.get('scenario') ?? (PREVIEW ? 'demo' : 'default');
/** `demo`: the app as on its first open, the whole way through with fake data: the setup
 *  from Willkommen, a CV that fills the profile but its Wunschrollen and Sprachen, the mailbox
 *  connected or skipped, an empty list that the first "Jobs suchen" fills with the demo's
 *  jobs (with a mailbox all of them, else the ones the search finds). The preview keeps its
 *  state across reloads (sessionStorage) until "Von vorn" or another entry of the menu. */
const DEMO_MODE = scenario === 'demo';
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
/** The folders as the OS writes them (Windows with backslashes). */
const SEP = MAC ? '/' : '\\';
const HOME = MAC ? '/Users/demo' : 'C:\\Users\\demo';
const TICK = Number(params.get('tick') ?? (DEMO_MODE ? 150 : PREVIEW ? 300 : 40));
const DELAY = scenario === 'slow' ? 900 : 0;
/** How long the CV evaluation takes: in the specs short, in the preview about as long as a
 *  real one (`?cv=slow`: as long as a slow one). */
const CV_WAIT = PREVIEW ? 8000 : 1500;
/** `?cv=` as the failure of the evaluation it plays. */
const CV_FAILURE: Readonly<Record<string, CvFailure>> = {
  limit: 'limit',
  offline: 'offline',
  timeout: 'timeout',
  unreadable: 'unreadable',
  tooBig: 'tooLarge',
  unsupported: 'unsupported',
  paused: 'paused',
  unavailable: 'unavailable',
  outdated: 'outdated',
};
/** The day the CV import works again while its tries are used up. */
const CV_UNTIL = '2026-09-25';
/** What a drop of files on the window left for the CV import (the window keeps it). */
let droppedFiles: string[] | null = null;
const MAIL_OFFLINE = scenario === 'offline' || params.get('mail') === 'offline';
/** `mail=no-internet`: every fetch finds no network at all (`offline`, not `mailConnect`). */
const NO_INTERNET = params.get('mail') === 'no-internet';
/** `mail=uncounted`: "Verbinden" signs in, but the count does not finish in time. */
const MAIL_UNCOUNTED = params.get('mail') === 'uncounted';

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

/** The demo profile (demo/profile.json) in the form of Profil-JSON v19. The snapshot holds
 *  what the engine understood of it; its form follows once core writes v19 forms. */
const DEMO_FORM: ProfileForm = {
  roles: ['Interim CFO'],
  project: true,
  permanent: true,
  temporary: false,
  dayRateWish: 1200,
  dayRateMin: 1100,
  minSalary: null,
  workMode: 'remote',
  countries: ['DE', 'AT'],
  regions: ['Hamburg'],
  available: { kind: 'from', date: '01.09.2026' },
  workload: 'any',
  minMonths: 6,
  competences: [
    { name: 'Interim Management', years: 12 },
    { name: 'Controlling', years: 18 },
    { name: 'Konzernrechnungslegung nach IFRS', years: 14 },
    { name: 'Konsolidierung', years: 11 },
    { name: 'Liquiditätsplanung', years: 10 },
    { name: 'Restrukturierung', years: 8 },
  ],
  tools: ['SAP S/4HANA', 'LucaNet', 'Power BI', 'IFRS', 'HGB', 'Konzernabschluss'],
  years: 20,
  industries: [
    { name: 'Maschinenbau', preferred: false },
    { name: 'Automotive', preferred: false },
    { name: 'Chemie', preferred: false },
  ],
  languages: [
    { language: 'Deutsch', level: 'native' },
    { language: 'Englisch', level: 'B2' },
  ],
  degrees: ['Diplom-Kauffrau (Univ.)'],
  certificates: ['Certified Interim Manager (DDIM)'],
  exclusionWords: ['Werkstudent', 'Praktikum'],
};

/** What a usable profile still needs, like core's `missing_required`: a wished role, a
 *  country, a competence and a language. */
function missingOf(form: ProfileForm): string[] {
  return [
    form.roles.length === 0 ? 'roles' : null,
    form.countries.length === 0 ? 'countries' : null,
    form.competences.every((row) => row.name.trim() === '') ? 'competences' : null,
    form.languages.length === 0 ? 'languages' : null,
  ].filter((field) => field !== null);
}

/** What the engine understands of a form (a rough stand-in: the form's own terms). */
function understoodOf(form: ProfileForm): ProfileUnderstanding {
  const terms = [...form.competences.map((row) => row.name), ...form.tools];
  return {
    ...DEMO.profile.understood!,
    competenceCount: terms.length,
    competences: terms,
    sources: [],
    warnings: [],
    packs: packsOf(form),
    years: form.years,
    degrees: form.degrees,
  };
}

/** The stored profile of a form, as core answers a save. */
function infoOf(form: ProfileForm): ProfileInfo {
  const count = form.competences.length + form.tools.length;
  return {
    ...DEMO.profile,
    fileName: 'beraterprofil.json',
    bytes: JSON.stringify(form).length,
    savedAt: at(0),
    quality: count === 0 ? 'empty' : count < 5 ? 'thin' : 'good',
    understood: understoodOf(form),
    pending: 0,
    parseError: null,
    form,
    missing: missingOf(form),
  };
}

/** The demo profile with what the engine understood of it. */
const PROFILE: ProfileInfo = { ...DEMO.profile, form: DEMO_FORM, missing: [] };

/** A CV merged into a stored profile like core: by normalized names, nothing overwritten
 *  (stars, levels and years stay). */
function mergeCv(stored: ProfileForm | null): ProfileForm {
  const base = stored ?? structuredClone(EMPTY_FORM);
  const cv = DEMO_FORM;
  const has = (list: string[], name: string): boolean =>
    list.some((item) => item.toLowerCase() === name.toLowerCase());
  const add = (list: string[], more: string[]): string[] => [
    ...list,
    ...more.filter((item) => !has(list, item)),
  ];
  const competences = [...base.competences];
  for (const row of cv.competences) {
    if (
      has(
        competences.map((c) => c.name),
        row.name,
      )
    )
      continue;
    competences.push({ ...row });
  }
  return {
    ...base,
    roles: add(base.roles, cv.roles),
    competences,
    tools: add(base.tools, cv.tools),
    years: base.years ?? cv.years,
    industries: [
      ...base.industries,
      ...cv.industries.filter(
        (row) =>
          !has(
            base.industries.map((i) => i.name),
            row.name,
          ),
      ),
    ],
    languages: [
      ...base.languages,
      ...cv.languages.filter(
        (row) =>
          !has(
            base.languages.map((l) => l.language),
            row.language,
          ),
      ),
    ],
    degrees: add(base.degrees, cv.degrees),
    certificates: add(base.certificates, cv.certificates),
  };
}

/** The domain packs the engine would switch on for a form (a rough stand-in: words of the
 *  competences and tools). */
function packsOf(form: ProfileForm): string[] {
  const words = [...form.competences.map((row) => row.name), ...form.tools].join(' ');
  return [
    ...(/controlling|ifrs|hgb|finanz|konsolid|treasury|buchhalt/i.test(words) ? ['finance'] : []),
    ...(/(^|[^a-z])sap([^a-z]|$)/i.test(words) ? ['sap'] : []),
  ];
}

/**
 * A list a save makes of `before` (the copy the view showed) as `after`, applied to the
 * stored list `now`, like core's rebase: the entries of `after` in its order and spelling,
 * without one the store dropped meanwhile (an untouched entry keeps the stored one); an entry
 * the store gained meanwhile stays after the entry it follows there. `name` tells entries
 * apart (case-insensitive).
 */
function rebase<T>(now: T[], before: T[], after: T[], name: (item: T) => string): T[] {
  const find = (list: T[], item: T): number => {
    const key = name(item).toLowerCase();
    return list.findIndex((other) => name(other).toLowerCase() === key);
  };
  const same = (a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
  const out: T[] = [];
  for (const item of after) {
    const old = find(before, item);
    const current = find(now, item);
    if (old >= 0 && current < 0) continue;
    out.push(old >= 0 && same(before[old]!, item) ? now[current]! : item);
  }
  let at = 0;
  for (const item of now) {
    const found = find(out, item);
    if (found >= 0) at = found + 1;
    else if (find(before, item) < 0) out.splice(at++, 0, item);
  }
  return out;
}

/** The lists the reader's "+" writes into, rebased on the stored profile when saved. */
function rebased(stored: ProfileForm, before: ProfileForm, after: ProfileForm): ProfileForm {
  const text = (item: string): string => item;
  return {
    ...after,
    competences: rebase(stored.competences, before.competences, after.competences, (r) => r.name),
    tools: rebase(stored.tools, before.tools, after.tools, text),
    industries: rebase(stored.industries, before.industries, after.industries, (r) => r.name),
    languages: rebase(stored.languages, before.languages, after.languages, (r) => r.language),
    degrees: rebase(stored.degrees, before.degrees, after.degrees, text),
    certificates: rebase(stored.certificates, before.certificates, after.certificates, text),
  };
}

/** The sources the app searches itself (core's `Way::Search`). */
const SEARCHED: ReadonlySet<PortalState['portal']> = new Set([
  'hays',
  'freelancermap',
  'michaelpage',
  'solcom',
  'gulp',
  'amadeusfire',
  'interimx',
  'fratch',
]);

/** How many alert mails of a portal of alert mails came in the last 30 days (the demo's). */
const ALERT_MAILS: Partial<Record<PortalState['portal'], number>> = { linkedin: 24, freelance: 11 };

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
  alertMails: ALERT_MAILS[name] ?? null,
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
    mail: null,
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
    newJobs: { count: 6, high: 2, excluded: 1 },
    score: demoScoring(),
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
/** `searching`: a search starts once the page asked for the state. */
let autorun = false;
/** The copies of the database in the data folder, newest first (`list_backups`). */
let backups: Backup[] = [];

/** The demo's copies (store/backup.rs): three days. */
const DEMO_BACKUPS: readonly Backup[] = [
  { id: 'jobs-2026-09-24.db', kind: 'daily', at: '2026-09-24T06:05:00Z', bytes: 13_002_342 },
  { id: 'jobs-2026-09-23.db', kind: 'daily', at: '2026-09-23T06:41:00Z', bytes: 12_845_056 },
  { id: 'jobs-2026-09-22.db', kind: 'daily', at: '2026-09-22T07:12:00Z', bytes: 12_320_768 },
];
/** Copies from before a restore kept, like core. */
const RESTORE_KEPT = 3;

/** The name core gives the copy before a restore at `ms` (UTC, to the millisecond). */
function restoreName(ms: number): string {
  // 2026-09-24T07:30:00.000Z: 20260924, 073000, 000
  const digits = new Date(ms).toISOString().replace(/\D/g, '');
  return `jobs.before-restore-${digits.slice(0, 8)}-${digits.slice(8, 14)}-${digits.slice(14, 17)}.db`;
}

/**
 * The scenarios (`?scenario=`), one entry each: what differs from the default state. The
 * preview's menu (preview.ts) names the ones worth a look; a new state is one entry here and
 * one row there.
 */
const SCENARIOS: Readonly<Record<string, () => void>> = {
  demo: () => SCENARIOS['first-run']!(),
  'first-run': () => {
    jobs = [];
    state.firstRun = true;
    state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
    state.profile = null;
    state.lastRun = null;
  },
  // The setup with a usable profile and no mailbox: it begins at the Postfach.
  'setup-profile': () => {
    jobs = [];
    state.firstRun = true;
    state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
    state.lastRun = null;
  },
  // The setup with a profile and a mailbox just connected (what "Verbinden" counted): it
  // begins at Fertig.
  'setup-mailbox': () => {
    jobs = [];
    state.firstRun = true;
    state.mailbox = { ...state.mailbox, check: DEMO_CHECK, checkedAt: at(0) };
    state.lastRun = null;
  },
  // The setup right after the CV: the profile it filled (no wished role, no country, no
  // language), the step "Fast fertig".
  'setup-cv': () => {
    jobs = [];
    state.firstRun = true;
    state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
    state.lastRun = null;
    state.profile = infoOf({ ...mergeCv(null), roles: [], languages: [] });
  },
  // Before the first search: Aktuell holds nothing yet.
  fresh: () => {
    jobs = [];
    state.lastRun = null;
  },
  // A search starts right after the page loaded (the preview watches it run).
  searching: () => {
    autorun = true;
  },
  // No mailbox: the alert mails rest, the search goes on.
  'no-mailbox': () => {
    state.mailbox = { user: null, vault: VAULT, error: null, check: null, checkedAt: null };
  },
  'no-minimum': () => {
    state.profile = { ...PROFILE, form: { ...DEMO_FORM, dayRateMin: null } };
  },
  'no-profile': () => {
    state.profile = null;
    for (const j of jobs) j.match = null;
  },
  concept: () => {
    // Five jobs for design reviews: high, medium, low, not scored, excluded.
    const keep = [
      'freelancermap:2801',
      'freelance:900411',
      'freelancermap:2804',
      'linkedin:4100200302',
      'freelance:900412',
    ];
    jobs = jobs.filter((j) => keep.includes(`${j.key.portal}:${j.key.id}`));
  },
  empty: () => {
    jobs = [];
    state.lastRun = {
      ...lastRun(),
      perPortal: lastRun().perPortal.map((p) => ({ ...p, new: 0 })),
      newJobs: { count: 0, high: 0, excluded: 0 },
      emptyAlerts: [],
    };
  },
  offline: () => {
    state.lastRun = lastRun({ kind: 'failed', error: { kind: 'mailConnect', params: {} } });
  },
  // Gmail refused the app password in the last search, whose search part went on.
  'mailbox-refused': () => {
    state.lastRun = { ...lastRun(), mail: { kind: 'mailAuth', params: {} } };
  },
  // Every job went to the Archiv after the last search: Aktuell is empty.
  archived: () => {
    for (const job of jobs) job.place = 'archive';
  },
  paused: () => {
    state.portals[0]!.health = { kind: 'paused', until: later(95), reason: 'throttled' };
    state.portals[1]!.health = { kind: 'layoutSuspect', emptyMails: 2, pages: 0 };
    // Alert mails without jobs ask her to look (core's PortalHealth::action_needed).
    state.portals[1]!.actionNeeded = true;
    // Near the day's limit: the meter turns ochre.
    state.portals[2]!.quota = { usedHour: 12, capHour: 40, usedDay: 92, capDay: 100 };
  },
  'session-left': () => {
    // A sign-in still stored while the fetch does not use it: the row offers Abmelden.
    state.portals[1]!.signedIn = true;
  },
  'dry-run': () => {
    state.dryRun = true;
    state.mailbox = {
      user: 'probelauf@example.org',
      vault: VAULT,
      error: null,
      check: null,
      checkedAt: null,
    };
  },
  'profile-broken': () => {
    state.profile = {
      ...PROFILE,
      quality: null,
      understood: null,
      parseError: { kind: 'invalid', params: { reason: 'profileNotJson', line: 12, column: 3 } },
      form: null,
    };
    // Like the backend at the start: the scores of a profile that no longer reads go.
    for (const job of jobs) job.match = null;
  },
  'profile-thin': () => {
    // A complete profile that names few terms: the match stays rough.
    state.profile = infoOf({
      ...structuredClone(DEMO_FORM),
      competences: [
        { name: 'Controlling', years: 18 },
        { name: 'Treasury', years: null },
      ],
      tools: ['IFRS'],
      industries: [],
      degrees: [],
      certificates: [],
    });
  },
  'profile-incomplete': () => {
    // A profile without a wished role and a language: two required fields are open.
    state.profile = infoOf({
      ...structuredClone(DEMO_FORM),
      roles: [],
      competences: [
        { name: 'Controlling', years: 18 },
        { name: 'Treasury', years: null },
      ],
      languages: [],
    });
  },
  running: () => {
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
  },
  'quiet-alert': () => {
    // freelance.de sent its last alert mail nine days before the last fetch: its alert
    // may have run out.
    state.portals[1]!.lastAlert = at(9 * 24);
  },
};

function initial(): void {
  jobs = scenario === 'many' ? manyJobs(2000) : sampleJobs();
  backups = scenario === 'first-run' || DEMO_MODE ? [] : structuredClone([...DEMO_BACKUPS]);
  // The last fetch brought a job whose page is still to come: the stub holds it before the
  // catch-up scores it (the list's jobs without a score stand first).
  for (const j of jobs) if (j.detail.kind === 'pending') j.match = null;
  state = {
    platform: MAC ? 'macos' : 'windows',
    // The app's version (src-tauri's CARGO_PKG_VERSION, the workspace's).
    version: '4.0.0',
    dryRun: false,
    firstRun: false,
    running: null,
    settings: {
      workspace: [HOME, 'Documents', 'CXact'].join(SEP),
      workspaceIsDefault: true,
    },
    mailbox: {
      user: 'alerts.demo@gmail.com',
      vault: VAULT,
      error: null,
      check: null,
      checkedAt: null,
    },
    profile: PROFILE,
    // Every portal counts its calls (the backend sends the numbers of each): the alert
    // sources 100 a day, the sources the app searches 1,500 (the deep search).
    portals: [
      portal('linkedin', { quota: { usedHour: 4, capHour: 30, usedDay: 23, capDay: 100 } }),
      portal('freelance', { quota: { usedHour: 2, capHour: 20, usedDay: 11, capDay: 100 } }),
      portal('freelancermap', { quota: { usedHour: 9, capHour: 300, usedDay: 86, capDay: 1500 } }),
      portal('hays', { quota: { usedHour: 6, capHour: 300, usedDay: 18, capDay: 1500 } }),
      portal('michaelpage', { quota: { usedHour: 2, capHour: 300, usedDay: 6, capDay: 1500 } }),
      portal('solcom', { quota: { usedHour: 2, capHour: 300, usedDay: 6, capDay: 1500 } }),
      portal('gulp', { quota: { usedHour: 0, capHour: 300, usedDay: 0, capDay: 1500 } }),
      portal('amadeusfire', { quota: { usedHour: 0, capHour: 300, usedDay: 0, capDay: 1500 } }),
      portal('interimx', { quota: { usedHour: 0, capHour: 300, usedDay: 0, capDay: 1500 } }),
      portal('fratch', { quota: { usedHour: 0, capHour: 300, usedDay: 0, capDay: 1500 } }),
    ],
    lastRun: lastRun(),
    counts: countsOf([]),
    matchPending: 0,
    cvUntil: params.get('cv') === 'used' ? CV_UNTIL : null,
  };
  SCENARIOS[scenario]?.();
  // Before the first fetch the store counted no alert mail (the setup shows what "Verbinden"
  // found in the mailbox instead).
  if (state.lastRun === null) for (const p of state.portals) p.alertMails = null;
  // `?open=portal:id`: that job is open when the page comes (the store the app keeps it in).
  const [openPortal, openId] = (params.get('open') ?? '').split(':');
  if (openPortal && openId) {
    try {
      localStorage.setItem(
        `jobs-open:${state.settings.workspace}`,
        JSON.stringify({ key: { portal: openPortal, id: openId }, place: 'inbox' }),
      );
    } catch {
      // Without a store no job is open.
    }
  }
  for (const p of state.portals) p.lastAlert ??= lastAlertOf(p.portal);
  if (DEMO_MODE) restore();
  refresh();
}

/* ------------------------------------------------------------ demo session */

/** Where the preview keeps the demo across reloads (cleared by the menu, preview.ts). */
const SESSION = 'cxact-preview-demo';

interface Session {
  state: AppState;
  jobs: JobView[];
  backups: Backup[];
  tombstones: string[];
  lastRunNumber: number;
  seenIn: [string, number][];
}

/** The demo as it stands, kept for the next reload. */
function persist(): void {
  const session: Session = {
    state: { ...state, running: null },
    jobs,
    backups,
    tombstones: [...tombstones],
    lastRunNumber,
    seenIn: [...seenIn],
  };
  try {
    sessionStorage.setItem(SESSION, JSON.stringify(session));
  } catch {
    // Without a store the next reload starts over.
  }
}

/** The demo as the last page left it (a run that went is over). */
function restore(): void {
  let session: Session | null;
  try {
    session = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as Session | null;
  } catch {
    session = null;
  }
  if (session === null) return;
  state = { ...session.state, running: null };
  jobs = session.jobs;
  backups = session.backups;
  for (const key of session.tombstones) tombstones.add(key);
  lastRunNumber = session.lastRunNumber;
  for (const [key, run] of session.seenIn) seenIn.set(key, run);
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

/** The excluded jobs of Aktuell and those scored in the high band (a rescore's
 *  `ScoreDelta`). */
function bandsOf(list: JobView[]): { excluded: number; high: number } {
  const inbox = list.filter((j) => j.place === 'inbox');
  return {
    excluded: inbox.filter((j) => j.match?.status === 'excluded').length,
    high: inbox.filter((j) => j.match?.status === 'scored' && bandOf(j.match.score) === 'high')
      .length,
  };
}

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

/** The funnel's filter (store::ListFilter): the portals, the bands of scored jobs (unscored
 *  and excluded ones never pass), the day it came and the new jobs of one run. */
function inFilter(j: JobView, query: Partial<JobQuery>): boolean {
  // The new jobs of one run: first seen in it, none excluded (store::new_jobs).
  if (query.run !== null && query.run !== undefined) {
    if (seenIn.get(markKey(j.key)) !== query.run || j.match?.status === 'excluded') return false;
  }
  const portals = query.portals ?? [];
  if (portals.length > 0 && !portals.includes(j.key.portal)) return false;
  // "Neu seit" (store::filter_condition): the moment it came into CXact.
  if (query.receivedSince !== null && query.receivedSince !== undefined) {
    if (Date.parse(j.firstSeenAt) / 1000 < query.receivedSince) return false;
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
  return { count: gone.length, keys: gone };
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
/** The day of a moment in the user's time zone, as YYYY-MM-DD (orders as a string). */
function localDay(iso: string): string {
  const day = new Date(iso);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

function listJobs(query: JobQuery): { jobs: JobView[]; counts: JobCounts } {
  if (scenario === 'list-error') throw fail('db');
  if (query.offset > 0 && harness.failPages > 0) {
    harness.failPages -= 1;
    throw fail('db');
  }
  const words = searchWords(query.search);
  const base = jobs.filter((j) => matchesSearch(j, words) && inFilter(j, query));
  // The filter narrows the counts like the list (store::job_page). By date: the day the job
  // came into CXact (within a day by its alert mail's date, then by portal), in the trash the
  // moment it went there.
  const days = new Map(base.map((j) => [j, localDay(j.firstSeenAt)]));
  const date = (j: JobView): string =>
    query.place === 'trash' ? (trashedAt.get(markKey(j.key)) ?? '') : (days.get(j) ?? '');
  // store::page_order (design round 7): the scored jobs, then the ones whose ring shows no
  // number (not scored yet and not scorable together), then the excluded ones, each its own
  // section of the list; within one a closed ad after the open ones; then the best score
  // (by match), else by date.
  const scoreOf = (j: JobView): number | null =>
    j.match?.status === 'scored' ? j.match.score : null;
  const section = (j: JobView): number =>
    j.match?.status === 'excluded' ? 2 : scoreOf(j) === null ? 1 : 0;
  const page = base
    .filter((j) => inQuery(j, query))
    .sort((a, b) => {
      const bySection = section(a) - section(b);
      if (bySection !== 0) return bySection;
      const byMatch = query.sort === 'match';
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
      if (query.place !== 'trash') {
        const ma = a.mailDate ?? '';
        const mb = b.mailDate ?? '';
        if (ma !== mb) return ma < mb ? 1 : -1;
        if (a.portal !== b.portal) return a.portal < b.portal ? -1 : 1;
      }
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
 *  jobs of Aktuell and the Archiv of the last 30 days, once per job however written,
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
      ...form.competences.map((c) => c.name),
      ...form.tools,
      ...form.certificates,
      ...form.degrees,
      ...form.industries.map((i) => i.name),
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
      // A language goes in at B2 (core: the level the ad names, else B2; `term_level`).
      const level = field === 'language' ? 'B2' : null;
      if (entry === undefined) counted.set(k, { term, field, count: 1, level });
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

/** The prompt of a job for an AI chat (export::ai_prompt). */
function promptOf(j: JobView): string {
  const prompt = DEMO.prompts[sourceOf(j.key)];
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
  // The demo's first fetch brings every job of the demo, as their mails announce them.
  const announced = DEMO_MODE
    ? [
        ...DEMO.jobs.map((j): JobView => ({
          ...j,
          match: null,
          detail: { kind: 'pending', retryAt: null },
        })),
        ...DEMO.announced,
      ]
    : DEMO.announced;
  return announced.filter((j) => find(j.key) === undefined && !tombstones.has(markKey(j.key)));
}

/** Those jobs once their page came and the engine scored them. */
function arrived(fresh: readonly JobView[]): JobView[] {
  return fresh.map((j) =>
    structuredClone(
      DEMO.fetched[markKey(j.key)]?.job ??
        DEMO.jobs.find((each) => markKey(each.key) === markKey(j.key))!,
    ),
  );
}

/** The number of the last run (the demo's last fetch is 41), and the run each job the
 *  scripted fetches brought was first seen in (store `first_seen_run`). */
let lastRunNumber = 41;
const seenIn = new Map<string, number>();

/** What "Jobs suchen" reads (run_context): the alert mails with a mailbox and a portal of
 *  them on, the portals' search with a usable profile and a portal of it on. */
function readable(): { mail: boolean; search: boolean } {
  const profile = state.profile;
  const usable = profile !== null && profile.parseError === null && profile.missing.length === 0;
  return {
    mail: state.mailbox.user !== null && state.portals.some((p) => p.enabled && p.way === 'alert'),
    search: (usable || state.dryRun) && state.portals.some((p) => p.enabled && p.way === 'search'),
  };
}

/** The scripted "Jobs suchen" (run_context): the mailbox reads the three alert mails and
 *  brings the jobs they name, then every portal of the search that is on is asked (side by
 *  side: each says when it is done, with its new jobs that are not excluded) and brings what
 *  it finds (freelancermap's). `mailFailure`: Gmail cannot be reached, so the mail part is
 *  skipped and the summary says why (`mail`), the search runs anyway. */
function script(kind: RunSummary['kind'], mailFailure: ErrorInfo | null = null): RunEvent[] {
  const ways = readable();
  const mail = ways.mail && mailFailure === null;
  const fresh = unknown().filter(
    (j) => (mail && j.origins.includes('mail')) || (ways.search && j.origins.includes('search')),
  );
  const total = fresh.length;
  const number = ++lastRunNumber;
  for (const j of fresh) seenIn.set(markKey(j.key), number);
  // Their pages and scores; without a profile nothing is scored (the backend has no matcher).
  const profiled = state.profile !== null;
  const done = arrived(fresh);
  const excluded = (j: JobView): boolean => profiled && j.match?.status === 'excluded';
  const reading: RunEvent[] = [
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
  ];
  // The portals' search: each one that is on, done in its turn with what it brought.
  const searched = state.portals.filter((p) => p.enabled && p.way === 'search');
  const searching: RunEvent[] = searched.flatMap((p, index): RunEvent[] => [
    { type: 'status', code: 'searching', portal: p.portal, until: null },
    {
      type: 'progress',
      step: 'search',
      portal: p.portal,
      done: index + 1,
      total: searched.length,
    },
    {
      type: 'sourceDone',
      portal: p.portal,
      new: done.filter((j) => j.portal === p.portal && j.origins.includes('search') && !excluded(j))
        .length,
    },
  ]);
  const events: RunEvent[] = [
    { type: 'started', kind },
    ...(mail ? reading : []),
    ...(ways.search ? searching : []),
    ...fresh.map((j): RunEvent => ({
      type: 'jobUpdated',
      job: structuredClone(j),
      fresh: true,
    })),
  ];
  if (total > 0) {
    events.push(
      { type: 'status', code: 'fetchingDetails', portal: fresh[0]!.portal, until: null },
      ...Array.from({ length: total + 1 }, (_, step): RunEvent => ({
        type: 'progress',
        step: 'fetch',
        portal: null,
        done: step,
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
  done.forEach((j, i) => {
    events.push({
      type: 'jobUpdated',
      job: { ...j, match: profiled ? j.match : null },
      fresh: true,
    });
    events.push({ type: 'progress', step: 'score', portal: null, done: i + 1, total });
  });
  // Each portal's mail names one job, the search finds freelancermap's: new the first time,
  // known after (a known job loads no page again).
  const portals = [
    ...(mail ? (['linkedin', 'freelance'] as const) : []),
    ...searched.map((p) => p.portal),
  ];
  const summary: RunSummary = {
    ...lastRun(),
    run: number,
    kind,
    startedAt: at(0.05),
    finishedAt: at(0),
    scan: mail ? lastRun().scan : null,
    perPortal: portals.map((portal) => {
      const now = fresh.filter((j) => j.portal === portal).length;
      return {
        portal,
        new: now,
        known: portal === 'freelancermap' ? 1 - now : 0,
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
    // The new jobs as store::new_jobs counts them: the excluded ones apart, the high ones
    // among the rest (without a profile none is excluded and none is high).
    newJobs: {
      count: done.filter((j) => !excluded(j)).length,
      high: profiled
        ? done.filter((j) => j.match?.status === 'scored' && j.match.band === 'high').length
        : 0,
      excluded: done.filter(excluded).length,
    },
    mail: mailFailure,
    emptyAlerts: [],
  };
  events.push({ type: 'finished', summary });
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
      emptyAlerts: [],
    },
  });
  return events;
}

function startRun(request: RunRequest, sender: Sender | null): void {
  const kind = request.kind;
  if (running) throw fail('busy');
  if (mailboxCheck !== null) throw fail('busy', { activity: 'mailbox' });
  // run_context: the mails without a mailbox and the search without a profile or a portal
  // of it are skipped; refused only when neither can run.
  const ways = readable();
  if (isFetch(kind) && !ways.mail && !ways.search) {
    const profile = state.profile;
    const usable = profile !== null && profile.parseError === null && profile.missing.length === 0;
    throw fail('invalid', { reason: usable ? 'noPortal' : 'noSearchTerms' });
  }
  // Gmail cannot be reached: with the search the mail part is skipped (the summary says
  // why), without it the run fails.
  const mailFailure =
    MAIL_OFFLINE || NO_INTERNET ? fail(NO_INTERNET ? 'offline' : 'mailConnect') : null;
  running = true;
  runningKind = kind;
  runSender = sender?.hold() ?? null;
  harness.done = false;
  const events =
    mailFailure !== null && isFetch(kind) && !ways.search
      ? offlineScript(NO_INTERNET ? 'offline' : 'mailConnect')
      : request.kind === 'rescore'
        ? rescoreScript()
        : request.kind === 'details'
          ? detailsScript(request.keys)
          : script(request.kind, ways.mail ? mailFailure : null);
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
        newJobs: { count: 0, high: 0, excluded: 0 },
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
    // "The last fetch": a rescore or a details run never replaces it (pipeline::run).
    if (isFetch(event.summary.kind)) {
      state.lastRun = event.summary;
      for (const p of state.portals) {
        p.alertMails = ALERT_MAILS[p.portal] ?? null;
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
    if (autorun) {
      autorun = false;
      setTimeout(() => harness.appRun('fetch'), 600);
    }
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
  save_profile: ({ save }) => {
    const after = save.after;
    const refuse = (field: string, max: number | null, row: number | null = null): never => {
      throw fail('invalid', { reason: 'profileValue', field, row, max });
    };
    const tooLong = after.competences.findIndex((r) => (r.years ?? 0) > MAX_YEARS);
    if (tooLong >= 0) refuse('competences', MAX_YEARS, tooLong);
    // Like core (form::validate, the limits of types/profile.ts), shown or not.
    for (const [key, max] of Object.entries(NUMBER_LIMITS) as [
      keyof typeof NUMBER_LIMITS,
      number,
    ][]) {
      if ((after[key] ?? 0) > max) refuse(key, max);
    }
    const stored = state.profile?.form ?? null;
    const form = stored === null ? structuredClone(after) : rebased(stored, save.before, after);
    state.profile = infoOf(form);
    // Scored with the profile: the engine's scores of the demo.
    const bandsBefore = bandsOf(jobs);
    if (jobs.every((j) => j.match === null)) {
      for (const j of jobs) j.match = demoMatch(j);
    }
    refresh();
    // Like core (scoring::profile_changed): the jobs are scored again, and the rescore says
    // what changed in Aktuell (`ScoreDelta`); no run without jobs, none while one goes.
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
  // "Aus Lebenslauf ausfüllen": the CV merged into the one profile (or made into it), saved
  // at once, after the time an evaluation takes; `?cv=` fails like the evaluation.
  profile_from_cv: async ({ dropped }) => {
    const files = droppedFiles;
    droppedFiles = null;
    if (dropped && (files === null || files.length === 0)) throw fail('notFound', { what: 'file' });
    const cv = params.get('cv');
    await new Promise((resolve) => setTimeout(resolve, cv === 'slow' ? 20_000 : CV_WAIT));
    if (cv === 'none') return null;
    const failure = cv === null || cv === 'slow' ? null : (CV_FAILURE[cv] ?? null);
    if (failure === 'offline') throw fail('offline');
    if (failure === 'limit') state.cvUntil = CV_UNTIL;
    if (failure !== null) throw fail('cv', { reason: failure });
    const stored = state.profile?.form ?? null;
    // The demo's CV names no wished role and no language: two fields stay open to fill in.
    const demoCv = DEMO_MODE && stored === null;
    const merged = mergeCv(stored);
    state.profile = infoOf(demoCv ? { ...merged, roles: [], languages: [] } : merged);
    if (jobs.every((j) => j.match === null)) {
      for (const j of jobs) j.match = demoMatch(j);
    }
    refresh();
    return structuredClone(state.profile);
  },
  profile_missing: ({ form }) => missingOf(form),
  // Fertig of the setup: the next start opens the Jobs view.
  finish_onboarding: () => {
    state.firstRun = false;
    return null;
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

  pick_workspace: () => {
    const kind = params.get('folder');
    if (kind !== 'other' && kind !== 'own') return null;
    const folder = [HOME, 'Documents', 'Jobs'].join(SEP);
    state.settings = { ...state.settings, workspace: folder, workspaceIsDefault: false };
    const profile = kind === 'own' ? 'own' : state.profile === null ? 'none' : 'copied';
    return { folder, profile };
  },
  open_target: ({ target }) => {
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
    return structuredClone(state);
  },
  // The app starts again with the setup (in the preview: the page, as after a reset).
  reset_all: () => {
    if (PREVIEW) setTimeout(() => preview.restart('first-run'), 400);
    return null;
  },
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
  if (TAURI !== null && WINDOW_EVENTS.has(name)) {
    const stop = await listenTauri(TAURI, name, wrapped);
    return () => {
      set.delete(wrapped);
      stop();
    };
  }
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
    // The window keeps what was dropped for the CV import (AppState::note_drop).
    if (name === 'tauri://drag-drop') {
      const paths = (payload as { paths?: unknown } | null)?.paths;
      droppedFiles = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
    }
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
        sort: 'match',
        search: null,
        portals: [],
        bands: [],
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
installPreviewMenu();
if (TAURI !== null) {
  for (const name of DROP_EVENTS) {
    void listenTauri(TAURI, name, (event) => harness.fire(name, event.payload));
  }
} else if (PREVIEW) dropsAsTauri();
if (DEMO_MODE) {
  addEventListener('pagehide', persist);
  setInterval(persist, 1000);
}

/**
 * In the preview a file dragged onto the page arrives like Tauri's drag and drop of the window
 * (the app never sees the browser's drop events): `tauri://drag-enter`, `-leave`, `-drop` with
 * the file's name as its path.
 */
function dropsAsTauri(): void {
  let depth = 0;
  const fire = (name: string, payload: unknown): void => harness.fire(name, payload);
  addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (depth++ === 0) fire('tauri://drag-enter', { paths: [] });
  });
  addEventListener('dragover', (event) => event.preventDefault());
  addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      fire('tauri://drag-leave', null);
    }
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    const files = [...(event.dataTransfer?.files ?? [])].map((file) => file.name);
    fire('tauri://drag-drop', { paths: files });
  });
}

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
  'profile_from_cv',
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
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
  if (TAURI !== null && WINDOW_COMMANDS.has(command))
    return (await TAURI.invoke(command, args)) as T;
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
