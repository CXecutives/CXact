// English UI catalog: de.ts in English, key for key and in the same order. Its type is the
// German catalog's shape (`Catalog`), so a missing or extra key is a type error; after a
// merge the type check lists every new German key to translate here.
//
// The same rules as in German (CLAUDE.md, checked by core/tests/ui_contract.rs): little
// text, plain and natural. Buttons are one verb phrase without a period; notes are one short
// sentence with a period; headings and labels end without a colon; no dash or em dash as a
// separator, no "X: Y", no exclamation marks. No German except product and portal names and
// the name of the German language. Glossary: Job · Portal · Match · Details · Fetch ·
// Profile · Mailbox · Alert email · Overview · Excel file · Excluded · New · To check ·
// Favourites · Inbox (the place of the active jobs) · Archive · Trash · Skill · Preference.
// Plain British English: "email", never "mail" for one message; "preferences", never
// "wishes"; "forever" for endgültig, never "for good"; two main clauses are joined by a
// conjunction, never by a comma alone; an introductory phrase takes its comma ("Without a
// profile, …"); apostrophes and quotes are typographic (’ “ ”), a named control stands in
// quotes (“Fetch details”).

import type {
  Band,
  DetailState,
  ErrorKind,
  InvalidInput,
  JobSort,
  Language,
  Palette,
  PauseReason,
  Place,
  Portal,
  PortalHealth,
  LanguageLevel,
  ProfileAvailability,
  ReasonKind,
  ReasonWeight,
  RemoteWish,
  RunKindName,
  StatusCode,
  Step,
  WorkMode,
} from '../ipc/types';
import { textOf, type Catalog, type ContractKind, type TermVerdict } from './de';
import { PORTAL_LABEL } from '../ipc/types/portals';
import {
  NBSP,
  formatCountdown,
  formatEuro,
  formatMoment,
  formatMoney,
  formatNumber,
  formatPercent,
} from './format';

type Params = Record<string, string | number | boolean | null>;
type Text = string | ((params: Params) => string);

const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const n = (value: number): string => formatNumber(value);
/** English plural for a count. */
const count = (value: number, one: string, many: string): string =>
  `${n(value)} ${value === 1 ? one : many}`;

/** A macOS key name is a symbol (⌘, ⇧); a click with it held is written with a hyphen
 *  ("⌘-click"), a Windows key name with a plus ("Ctrl+click"). */
const isSymbolKey = (key: string): boolean => /^[⌘⇧⌥⌃]$/u.test(key);
const clickWith = (key: string): string => (isSymbolKey(key) ? `${key}-click` : `${key}+click`);
/** Shift in the same writing as the command key it stands beside. */
const shiftBeside = (key: string): string => (isSymbolKey(key) ? '⇧' : 'Shift');

const portalName = PORTAL_LABEL;
const portalOf = (value: unknown): string =>
  typeof value === 'string' && value in portalName ? portalName[value as Portal] : str(value);
const joined = (items: string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Every country the engine can tell apart in a job ad (ISO codes of `laender`, checked
 *  against core `profile::country_codes` by core/tests/countries.rs). */
const countryName: Record<string, string> = {
  AT: 'Austria',
  BE: 'Belgium',
  CH: 'Switzerland',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IN: 'India',
  IT: 'Italy',
  LU: 'Luxembourg',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
  US: 'USA',
};
/** ISO codes as the engine sends them (`DE, AT`) in words: "Germany and Austria". */
const countryNames = (value: unknown): string =>
  joined(
    str(value)
      .split(',')
      .map((code) => code.trim())
      .filter((code) => code !== '')
      .map((code) => countryName[code.toUpperCase()] ?? code),
  );

const INTERNAL = 'An internal error occurred, and the log has the details.';

/** What holds the app (as de.ts). */
type Busy = 'fetch' | 'details' | 'rescore' | 'session' | 'files' | 'mailbox';
const BUSY: readonly Busy[] = ['details', 'rescore', 'session', 'files', 'mailbox'];
const busyOf = (value: unknown): Busy => BUSY.find((name) => name === value) ?? 'fetch';

const busy: Record<Busy, string> = {
  fetch: 'A fetch is running already.',
  details: 'Details are being fetched already.',
  rescore: 'The jobs are being scored again.',
  session: 'A sign-in is running.',
  files: 'The app is writing its files.',
  mailbox: 'The mailbox is being checked.',
};

const closing: Record<Busy, string> = {
  fetch: 'The fetch is stopping, and then the app closes.',
  details: 'Fetching details is stopping, and then the app closes.',
  rescore: 'Scoring is stopping, and then the app closes.',
  session: 'The sign-in is stopping, and then the app closes.',
  files: 'The app is finishing its files, and then it closes.',
  mailbox: 'The mailbox check is stopping, and then the app closes.',
};

const errors: Record<ErrorKind | 'unknown', Text> = {
  db: 'The database reports an error.',
  fileLocked: 'A file is open in another program right now.',
  io: 'A file could not be read or written.',
  xlsx: 'The Excel file could not be written.',
  corrupt: (p) => (p.what === 'backup' ? 'The backup is damaged.' : 'The app’s data is damaged.'),
  newerSchema: 'The data comes from a newer version of the app.',
  invalid: 'The input is not valid.',
  busy: (p) => busy[busyOf(p.activity)],
  notFound: (p) =>
    p.what === 'file'
      ? 'The file does not exist.'
      : p.what === 'folder'
        ? 'The folder does not exist.'
        : p.what === 'backup'
          ? 'The backup no longer exists.'
          : 'This no longer exists.',
  dryRun: 'This does not work in the dry run.',
  demo: 'This does not work in the demo.',
  mailMissing: 'No mailbox is connected.',
  mailConnect: 'Gmail cannot be reached.',
  mailAuth: 'Gmail rejected the address or the app password.',
  mailTimeout: 'Gmail is not responding.',
  mailLost: 'The connection to Gmail was lost.',
  mailNotGmail: 'This is not a Gmail mailbox.',
  mailServer: 'Gmail reports an error.',
  mailCancelled: 'Cancelled.',
  secretStore: 'The system’s password store cannot be reached.',
  secretCorrupt: 'The stored app password cannot be read.',
  portalUnavailable: (p) => `No connection to ${portalOf(p.portal)}.`,
  portalPaused: (p) => `${portalOf(p.portal)} is paused right now.`,
  portalQuota: (p) => `The limit for ${portalOf(p.portal)} is reached.`,
  internal: INTERNAL,
  unknown: INTERNAL,
};

/** Fields of the profile form, named in an error about their value (the label of the field
 *  without its unit, as everywhere: warnings, key names, the profile). */
const profileField: Record<string, string> = {
  name: 'Name',
  title: 'Role',
  competences: 'Skills',
  strengths: 'Key strengths',
  keywords: 'Keywords',
  years: 'Professional experience',
  degrees: 'Degrees',
  industries: 'Industries',
  tools: 'Tools and methods',
  certificates: 'Certificates',
  languages: 'Languages',
  minDayRate: 'Minimum day rate',
  countries: 'Work countries',
  contracts: 'Temporary agency work and permanent jobs',
  remoteOutside: 'Exclude remote jobs abroad',
  available: 'Available from',
  workloadMinDays: 'Workload',
  workloadMaxDays: 'Workload',
  minMonths: 'Minimum duration',
  exclusionWords: 'Exclusion words',
  targetYears: 'Experience asked from',
  minSalary: 'Minimum annual salary',
  permanentPlaces: 'Locations for permanent jobs',
  permanentRemoteMin: 'Minimum remote share',
  focus: 'Focus areas',
  roles: 'Target roles',
  wishDayRate: 'Preferred day rate',
  remote: 'Remote share',
  regions: 'Preferred regions',
  wishIndustries: 'Preferred industries',
};
const fieldName = (value: unknown): string => profileField[str(value)] ?? str(value);

const invalid: Record<InvalidInput['reason'], Text> = {
  noPortal: 'At least one portal must be active.',
  profileNotUtf8: 'The file is not a text file.',
  profileNotJson: (p) => `The file is damaged (line ${str(p.line)}).`,
  profileNotObject: 'The file contains no profile.',
  profileValue: (p) => `The value of “${fieldName(p.field)}” is not valid.`,
  profileAnswer: 'The answer contains no profile.',
  profileAnswerCut: 'The answer stops in the middle of the profile.',
  mailAddress: 'The address is incomplete.',
  appPassword: 'An app password has 16 letters.',
  noSignIn: (p) => `There is no sign-in for ${portalOf(p.portal)}.`,
};

const status: Record<StatusCode, string> = {
  connectingMail: 'Connecting to the mailbox',
  searchingMail: 'Looking for alert emails',
  readingMails: 'Reading alert emails',
  fetchingDetails: 'Fetching details',
  signingIn: 'Signing in',
  waiting: 'Waiting for the portal',
  scoring: 'Scoring the jobs',
  writingFiles: 'Writing the files',
};

/** The status of a run when the backend names the portal it is about. */
const statusAt: Partial<Record<StatusCode, (portal: string) => string>> = {
  fetchingDetails: (portal) => `Fetching details from ${portal}`,
  signingIn: (portal) => `Signing in to ${portal}`,
  waiting: (portal) => `Waiting for ${portal}`,
};

/** Why a portal pauses, as the first half of one sentence (`health.advice.paused`). */
const pause: Record<PauseReason, string> = {
  throttled: 'the portal is throttling requests',
  blocked: 'the portal is blocking requests',
  layoutChanged: 'the pages look different than expected',
  stateUnreadable: 'the state of the portal cannot be read',
  network: 'the portal cannot be reached',
  challenged: 'the portal is asking for a verification',
};

/** Opening the alert email of a job in Gmail, the same words wherever it is offered. */
const OPEN_MAIL = 'Open alert email';

/** The run that reads every alert email (`fullMailbox`), one name everywhere. */
const FULL_MAILBOX = 'Fetch all alert emails';

/** What a detail state means, the same in a row's badge tooltip and in the reader. */
const detailSays = {
  teaser: 'Without a sign-in, the portal shows only the start of the ad.',
  unfetchable: 'The ad could not be fetched after several tries.',
  gone: 'The ad is no longer online.',
  onRequest: 'The app fetches these details only on request.',
} as const;

/** Alert emails in which the app found no jobs (the overview and the settings, next to the
 *  button that opens the email). */
const emptyMails = (mails: number): string =>
  mails === 1
    ? 'The app found no jobs in one alert email.'
    : `The app found no jobs in ${n(mails)} alert emails.`;

/** A profile file the app cannot read (the list, the overview, the Profile view). */
const PROFILE_UNREADABLE = 'Profile cannot be read';

const ANUE = 'The ad mentions temporary agency work.';
const LOW_TEXT = 'The ad names few clear requirements.';
const SHORT_TEXT = 'The ad is very short.';
const WORKLOAD = 'The workload does not fit the profile.';
const DURATION = 'The duration is below the minimum in the profile.';

/** What an amount of pay is per (`facts.pay`). */
type Per = 'day' | 'hour' | 'year';
const PER: Record<Per, string> = { day: 'day', hour: 'hr', year: 'year' };

/** Days in a week: "3 days a week", short "3 days/week". */
const weekDays = (days: number, short: boolean): string =>
  short ? `${count(days, 'day', 'days')}/week` : `${count(days, 'day', 'days')} a week`;

/** The workload of an ad in words, as in de.ts: "full-time", "3 days a week", "50%". */
function workloadWords(from: number | null, to: number, short: boolean): string {
  if (from === null) return to >= 100 ? 'part-time possible' : 'part-time';
  const low = Math.min(from, to);
  const whole = (share: number): boolean => share > 0 && share % 20 === 0;
  if (low === to) {
    if (to >= 100) return 'full-time';
    return whole(to) ? weekDays(to / 20, short) : formatPercent(to);
  }
  if (whole(low) && whole(to)) return `${n(low / 20)} to ${weekDays(to / 20, short)}`;
  return `${n(low)} to ${formatPercent(to)}`;
}

const numberOr = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** The ad's workload against the profile's days (`from`, `to`, `minDays`, `maxDays`). */
function workloadCheck(p: Params): string {
  const to = numberOr(p.to);
  if (to === null) return WORKLOAD;
  const from = numberOr(p.from);
  const ad = workloadWords(from, to, false);
  const max = numberOr(p.maxDays);
  const min = numberOr(p.minDays);
  if (max !== null && from !== null && from > max * 20) {
    return `The ad says ${ad}, but the profile allows at most ${weekDays(max, false)}.`;
  }
  return min === null
    ? WORKLOAD
    : `The ad says ${ad}, but the profile looks for at least ${weekDays(min, false)}.`;
}

/** Contract type of an ad (`contractType` params `type`, `inferred`). */
const contract: Record<ContractKind, string> = {
  interim: 'Interim',
  permanent: 'Permanent',
  anue: 'Temporary agency work',
  unclear: 'Contract type unclear',
};

function contractName(p: Params): string {
  const type = typeof p.type === 'string' && p.type in contract ? (p.type as ContractKind) : null;
  if (type === null) return contract.unclear;
  return p.inferred && type !== 'unclear'
    ? `Probably ${contract[type].toLowerCase()}`
    : contract[type];
}

/** Preferences of the profile (`state` met, near, missed or unknown). */
function dayRateWish(p: Params): string {
  const rate = formatEuro(p.rate);
  const wish = formatEuro(p.wish);
  switch (p.state) {
    case 'met':
      return `The day rate of ${rate} meets your preferred rate of ${wish}.`;
    case 'near':
      return `The day rate of ${rate} is just below your preferred rate of ${wish}.`;
    case 'missed':
      return `The day rate of ${rate} is below your preferred rate of ${wish}.`;
    default:
      return p.currency
        ? `The day rate is given in ${str(p.currency)}.`
        : 'The ad names no day rate.';
  }
}

/** The remote preference of the profile (`level` of the profile editor). */
const REMOTE_LEVEL: Record<string, string> = {
  full: 'fully remote',
  mostly: 'mostly remote',
  partly: 'partly remote',
  onSite: 'on site',
};

/** The ad's remote share next to the preference ("60% remote, and you prefer mostly remote"). */
function remoteWish(p: Params): string {
  if (p.state === 'unknown') return 'The ad names no remote share.';
  const level = typeof p.level === 'string' ? REMOTE_LEVEL[p.level] : undefined;
  const wished = level ? `, and you prefer ${level}` : '';
  let ad: string;
  if (p.share === 0) ad = 'The job is fully on site';
  else if (p.share === 100) ad = 'The job is fully remote';
  else if (typeof p.share === 'number') ad = `The job is ${formatPercent(p.share)} remote`;
  else if (typeof p.from === 'number' && typeof p.to === 'number')
    ad = `The job is ${str(p.from)} to ${formatPercent(p.to)} remote`;
  else ad = 'The job is partly remote';
  return `${ad}${wished}.`;
}

function regionWish(p: Params): string {
  switch (p.state) {
    case 'met':
      return p.remote === true
        ? 'The job is fully remote, so the region does not matter.'
        : `${str(p.location)} is in one of your preferred regions.`;
    case 'near':
      return `${str(p.location)} is outside your preferred regions, but the job is mostly remote.`;
    case 'missed':
      return `${str(p.location)} is outside your preferred regions.`;
    default:
      return 'It is unclear whether the location is in one of your preferred regions.';
  }
}

function industryWish(p: Params): string {
  switch (p.state) {
    case 'met':
      return `${str(p.wish)} is one of your preferred industries.`;
    case 'missed':
      return `${str(p.industry)} is not one of your preferred industries.`;
    default:
      return 'The ad names no industry.';
  }
}

/**
 * Reason codes of the matching engine (`Reason.code`, core/src/matching/types.rs), as in
 * de.ts. `requirement` and `term` show the ad's own words (the label).
 */
const reasonCode = {
  requirement: '',
  term: '',
  anue: ANUE,
  anueRisk: 'A staffing agency gives no contract details, so temporary agency work is possible.',
  dayRate: (p) => `The day rate of ${formatEuro(p.rate)} is below ${formatEuro(p.min)}.`,
  availability: 'The availability does not fit.',
  country: (p) =>
    p.allowed
      ? `The location is outside ${countryNames(p.allowed)}.`
      : 'The location does not fit.',
  anueOptional: 'Temporary agency work is possible but not required.',
  anueHidden: 'The ad hints at temporary agency work.',
  countryUnclear: 'The location is unclear.',
  dayRateCurrency: (p) => `The rate is given in ${str(p.currency)}.`,
  availabilityGap: (p) =>
    `The start is ${count(num(p.days), 'day', 'days')} before you are available.`,
  startVague: 'The start date is unclear.',
  permanent: (p) => {
    if (p.excluded !== true) return 'This sounds like a permanent job.';
    return p.stated === true
      ? 'This is a permanent job, which the profile excludes.'
      : 'This sounds like a permanent job, which the profile excludes.';
  },
  permanentRegion: (p) =>
    p.location
      ? `${str(p.location)} is outside your locations for permanent jobs.`
      : 'The location is outside your locations for permanent jobs.',
  permanentRegionUnclear: (p) =>
    p.location
      ? `It is unclear whether ${str(p.location)} is one of your locations for permanent jobs.`
      : 'The location of the permanent job is unclear.',
  salary: (p) => {
    if (p.salary === undefined || p.salary === null || p.min === undefined) {
      return 'The salary is below the minimum in the profile.';
    }
    const amount =
      typeof p.currency === 'string' && p.currency !== 'EUR'
        ? formatMoney(num(p.salary), p.currency)
        : formatEuro(p.salary);
    const from = p.lowerBound ? `from ${amount}` : `of ${amount}`;
    return `The annual salary ${from} is below ${formatEuro(p.min)}.`;
  },
  salaryUnknown: 'The ad names no salary.',
  tooJunior: (p) =>
    p.years !== undefined && p.years !== null
      ? `The job asks for ${count(num(p.years), 'year', 'years')} of experience, while the profile targets ${count(num(p.target), 'year', 'years')}.`
      : 'The job is meant for people with less experience.',
  seniorityUnclear: (p) =>
    p.junior ? 'The title sounds like a junior job.' : 'The level of experience sought is unclear.',
  overqualified: (p) =>
    p.years !== undefined && p.years !== null
      ? `The job asks for ${count(num(p.years), 'year', 'years')} of experience, and the profile has much more.`
      : 'The profile has much more experience than sought.',
  contractType: (p) => contractName(p),
  formalOpen: (p) => {
    if (p.class === undefined || p.class === null) return 'The profile names no degree.';
    const what =
      p.class === 'licence'
        ? 'a licence the profile does not name'
        : 'a degree the profile does not name';
    return p.mandatory ? `The ad requires ${what}.` : `The ad prefers ${what}.`;
  },
  lowEvidence: LOW_TEXT,
  shortText: SHORT_TEXT,
  focus: (p) =>
    num(p.met) > 0 || p.inTitle === true
      ? `The focus area ${str(p.focus)} is asked for.`
      : `The ad mentions the focus area ${str(p.focus)}.`,
  targetRole: (p) =>
    p.fit === 'half'
      ? `The title comes close to the target role ${str(p.role)}.`
      : `The title fits the target role ${str(p.role)}.`,
  dayRateWish,
  remoteWish,
  regionWish,
  industryWish,
  workload: workloadCheck,
  duration: (p) =>
    typeof p.months === 'number' && typeof p.min === 'number'
      ? `The duration of ${count(p.months, 'month', 'months')} is below the minimum of ${count(p.min, 'month', 'months')}.`
      : DURATION,
  exclusionWord: (p) => `“${str(p.word)}” is on your list of exclusion words.`,
} satisfies Catalog['reason']['code'];

/**
 * Hard criteria of the profile (`MatchDetail.criteria[].code`, `ProfileUnderstanding.
 * criteria[].code`), as in de.ts.
 */
const criteria = {
  minDayRate: {
    label: 'Day rate',
    short: 'Day rate too low',
    exclusion: 'The day rate is below the minimum in the profile.',
  },
  countries: {
    label: 'Countries',
    short: 'Outside your countries',
    exclusion: 'The location is outside the countries in the profile.',
  },
  noAnue: {
    label: 'Temporary agency work',
    short: 'Temporary agency work',
    exclusion: ANUE,
  },
  noPermanent: {
    label: 'Permanent job',
    short: 'Permanent job',
    exclusion: 'This is a permanent job, which the profile excludes.',
  },
  availability: {
    label: 'Availability',
    short: 'Start does not fit',
    exclusion: 'The start does not fit the availability.',
  },
  minSalary: {
    label: 'Annual salary',
    short: 'Salary too low',
    exclusion: 'The salary is below the minimum in the profile.',
  },
  permanentRegion: {
    label: 'Locations',
    short: 'Location does not fit',
    exclusion: 'The location is outside your locations for permanent jobs.',
  },
  targetYears: {
    label: 'Experience',
    short: 'Experience does not fit',
    exclusion: 'The job asks for much less experience.',
  },
  workload: {
    label: 'Workload',
    short: 'Workload does not fit',
    exclusion: WORKLOAD,
  },
  duration: {
    label: 'Duration',
    short: 'Duration too short',
    exclusion: DURATION,
  },
  exclusionWords: {
    label: 'Exclusion words',
    short: 'Exclusion word',
    exclusion: 'The ad names an exclusion word from the profile.',
  },
} satisfies Catalog['reader']['criterion'];

/** `JobMatch.note` / `MatchDetail.summary` codes. */
const note = {
  hardCriterion: 'An exclusion criterion applies.',
  shortText: 'Too little text to score.',
  lowEvidence: LOW_TEXT,
  engineFailed: 'This ad could not be scored.',
} satisfies Catalog['reader']['note'];

/** Names of profile keys the app speaks about (the keys themselves are an external contract),
 *  named like their field in the Profile form. */
const profileKey: Record<string, string> = {
  min_tagessatz: profileField.minDayRate!,
  min_day_rate: profileField.minDayRate!,
  tagessatz_ab: profileField.minDayRate!,
  laender: profileField.countries!,
  countries: profileField.countries!,
  ausgeschlossene_vertragsarten: profileField.contracts!,
  excluded_contract_types: profileField.contracts!,
  remote_ausserhalb_erlaubt: profileField.remoteOutside!,
  remote_outside_allowed: profileField.remoteOutside!,
  verfuegbar_ab: profileField.available!,
  available_from: profileField.available!,
  min_jahresgehalt: profileField.minSalary!,
  min_annual_salary: profileField.minSalary!,
  min_salary: profileField.minSalary!,
  festanstellung_orte: profileField.permanentPlaces!,
  permanent_locations: profileField.permanentPlaces!,
  permanent_places: profileField.permanentPlaces!,
  festanstellung_remote_min: profileField.permanentRemoteMin!,
  permanent_remote_min: profileField.permanentRemoteMin!,
  zielprofil_min_jahre: profileField.targetYears!,
  target_min_years: profileField.targetYears!,
  auslastung_min_tage: profileField.workloadMinDays!,
  workload_min_days: profileField.workloadMinDays!,
  auslastung_max_tage: profileField.workloadMaxDays!,
  workload_max_days: profileField.workloadMaxDays!,
  min_laufzeit_monate: profileField.minMonths!,
  min_duration_months: profileField.minMonths!,
  ausschlusswoerter: profileField.exclusionWords!,
  ausschlusswörter: profileField.exclusionWords!,
  exclusion_words: profileField.exclusionWords!,
  schwerpunkte: profileField.focus!,
  focus_areas: profileField.focus!,
  wunschrollen: profileField.roles!,
  target_roles: profileField.roles!,
  tagessatz_wunsch: profileField.wishDayRate!,
  desired_day_rate: profileField.wishDayRate!,
  remote: profileField.remote!,
  regionen: profileField.regions!,
  regions: profileField.regions!,
  branchen: profileField.wishIndustries!,
  industries: profileField.wishIndustries!,
};
const keyLabel = (key: string): string => profileKey[key] ?? key;
/** Keys the engine does not read, as written in the file (so they can be found there). */
const rawKeys = (value: unknown): string[] =>
  str(value)
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '')
    .map((key) => `“${key}”`);

/** Profile warnings of the engine (`ProfileWarningCode`, core/src/matching/types.rs). */
const warning = {
  noCompetences: 'The profile names no skills.',
  fewCompetences: 'The profile names only a few skills.',
  noCriteria: 'The profile sets no conditions.',
  availabilityNotUnderstood: '“Available from” cannot be read.',
  ignoredKeys: (p) => `The app does not read ${joined(rawKeys(p.keys))} in the conditions.`,
  criterionNotUnderstood: (p) => `“${keyLabel(str(p.key))}” cannot be read.`,
  regionWithoutPlaces: 'The minimum remote share only works together with locations.',
  focusTrimmed: (p) => `Only the first ${n(num(p.max))} focus areas count.`,
} satisfies Catalog['profile']['warning'];

export const en: Catalog = {
  app: {
    name: 'CXact',
  },
  nav: {
    label: 'Sections',
    jobs: 'Jobs',
    profile: 'Profile',
    settings: 'Settings',
    demo: 'Demo',
  },
  common: {
    loading: 'Loading',
    cancel: 'Cancel',
    save: 'Save',
    remove: 'Remove',
    change: 'Change',
    open: 'Open',
    copy: 'Copy',
    hide: 'Hide',
    back: 'Back',
    retry: 'Try again',
    undo: 'Undo',
    openFolder: 'Open folder',
    openLog: 'Open log',
    showInFolder: {
      explorer: 'Show in Explorer',
      finder: 'Show in Finder',
    },
  },
  portal: portalName,
  chips: {
    remove: (value: string) => `Remove ${value}`,
    more: (value: number) => `+${n(value)}`,
  },
  splitter: {
    label: 'Width of the list',
    tip: 'Resize',
    reset: 'Double-click to reset',
  },
  selection: {
    count: (value: number) => `${n(value)} selected`,
    clear: 'Clear selection',
    chosen: (value: number) => `${count(value, 'job', 'jobs')} selected`,
    commandKey: { ctrl: 'Ctrl', cmd: '⌘' },
    hint: (key: string) =>
      `${clickWith(key)} adds or removes a job, ${clickWith(shiftBeside(key))} a whole range.`,
    tip: (key: string) => `Choose several jobs at once with ${clickWith(key)}.`,
    more: (value: number) => `+${n(value)}`,
    pin: 'Favourite',
  },
  place: {
    tabs: 'Locations',
    inbox: 'Inbox',
    archive: 'Archive',
    trash: 'Trash',
    pickJob: 'Choose a job from the list.',
    search: {
      inbox: 'Search jobs',
      archive: 'Search the archive',
      trash: 'Search the trash',
    } satisfies Record<Place, string>,
    count: {
      inbox: (value: number) => `${count(value, 'job', 'jobs')} in Jobs`,
      archive: (value: number) => `${count(value, 'job', 'jobs')} in the archive`,
      trash: (value: number) => `${count(value, 'job', 'jobs')} in the trash`,
    } satisfies Record<Place, (value: number) => string>,
    found: {
      inbox: (value: number, query: string) =>
        `${count(value, 'job', 'jobs')} for “${query}” in Jobs`,
      archive: (value: number, query: string) =>
        `${count(value, 'job', 'jobs')} for “${query}” in the archive`,
      trash: (value: number, query: string) =>
        `${count(value, 'job', 'jobs')} for “${query}” in the trash`,
    } satisfies Record<Place, (value: number, query: string) => string>,
    hitsIn: {
      inbox: (value: number) => `In the inbox (${n(value)})`,
      archive: (value: number) => `In the archive (${n(value)})`,
      trash: (value: number) => `In the trash (${n(value)})`,
    } satisfies Record<Place, (value: number) => string>,
    inArchive: 'In the archive',
    inTrash: 'In the trash',
    inTrashLeft: (days: number) => `In the trash, deleted forever in ${count(days, 'day', 'days')}`,
    inTrashSoon: 'In the trash, due to be deleted forever',
    empty: {
      inbox: 'No jobs.',
      archive: 'The archive is empty.',
      trash: 'The trash is empty.',
    } satisfies Record<Place, string>,
    reader: {
      archive: 'Archived jobs stay here until you bring them back.',
      trash: 'Jobs in the trash stay here until you restore them or empty the trash.',
    } satisfies Record<Exclude<Place, 'inbox'>, string>,
    trashFor: (days: number) =>
      `Jobs in the trash are deleted forever after ${count(days, 'day', 'days')}.`,
  },
  actions: {
    archive: 'Archive',
    toInbox: 'Back to the inbox',
    trash: 'Move to trash',
    restore: 'Restore',
    purge: 'Delete forever',
    purgeConfirm: 'Delete',
    purgeHeading: (value: number) =>
      value === 1 ? 'Delete the job forever?' : `Delete ${n(value)} jobs forever?`,
    purgeOne: (name: string) => `Delete “${name}” forever?`,
    purgeText: 'Jobs deleted forever never come back, not even from old alert emails.',
    emptyTrash: 'Empty trash',
    emptyTrashConfirm: 'Empty',
    emptyTrashHeading: 'Empty the trash?',
    emptyTrashText: (value: number) =>
      value === 1
        ? 'The job is deleted forever and never comes back.'
        : `The ${n(value)} jobs are deleted forever and never come back.`,
  },
  menu: {
    job: 'Job',
    open: 'Open',
  },
  edit: {
    menu: 'Edit',
    undo: 'Undo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    delete: 'Delete',
    selectAll: 'Select all',
  },
  keys: {
    ctrl: 'Ctrl',
    shift: 'Shift',
    del: 'Del',
    enter: 'Enter',
    home: 'Home',
    end: 'End',
  },
  keysHelp: {
    heading: 'Keyboard shortcuts',
    close: 'Close',
    everywhere: 'Everywhere',
    list: 'In the job list',
    range: (first: string, last: string) => `${first} to ${last}`,
    views: 'Choose a view',
    search: 'Search',
    fetch: 'Fetch',
    undo: 'Undo',
    menu: 'Open the menu',
    back: 'Back',
    help: 'Show keyboard shortcuts',
    step: 'Previous or next job',
    edge: 'First or last job',
    extend: 'Choose several jobs',
    archive: 'Archive',
    trash: 'Move to the trash',
    star: 'Favourite',
    openAd: 'Open the ad',
    closeJob: 'Close the job',
  },
  field: {
    reveal: 'Show password',
    conceal: 'Hide password',
    clear: 'Clear search',
  },
  score: {
    value: (band: string, percent: string) => `${band}, ${percent}`,
    excluded: 'Excluded',
    none: 'Not scored yet',
    unscorable: 'Not scored yet',
    off: 'No match without a profile',
    band: {
      high: 'High match',
      mid: 'Medium match',
      low: 'Low match',
    } satisfies Record<Band, string>,
  },
  reason: {
    kind: {
      met: 'Met',
      partial: 'Partly met',
      open: 'Not met',
      violation: 'Reason to exclude',
      check: 'Unclear',
    } satisfies Record<ReasonKind, string>,
    weight: {
      must: 'Must-have',
      nice: 'Optional',
      hard: 'Exclusion',
      info: 'Note',
    } satisfies Record<ReasonWeight, string>,
    evidence: (quote: string, profile: string, partial: boolean) =>
      partial
        ? `“${quote}” partly fits “${profile}” in the profile.`
        : `“${quote}” fits “${profile}” in the profile.`,
    missing: (quote: string) => `“${quote}” is not in the profile.`,
    code: reasonCode,
  },
  job: {
    choose: 'Select',
    included: 'Included',
    workMode: {
      remote: 'Remote',
      hybrid: 'Hybrid',
      onsite: 'On site',
    } satisfies Record<WorkMode, string>,
    detail: {
      pending: 'Details to come',
      teaser: 'Preview only',
      failed: 'Details missing',
      unfetchable: 'Not fetchable',
      gone: 'No longer online',
      onRequest: 'Details on request',
    } satisfies Record<Exclude<DetailState['kind'], 'ok'>, string>,
    detailHint: {
      pending: 'The full ad has not been fetched yet.',
      teaser: detailSays.teaser,
      failed: 'The full ad could not be fetched.',
      unfetchable: detailSays.unfetchable,
      gone: detailSays.gone,
      onRequest: detailSays.onRequest,
    } satisfies Record<Exclude<DetailState['kind'], 'ok'>, string>,
    closed: 'No longer taking applications',
    closedHint: 'The ad can still be read but no longer takes applications.',
    unread: 'New',
    pinned: 'Favourite',
    trashLeft: (days: number) => `${count(days, 'day', 'days')} left`,
    trashSoon: 'deleted soon',
    alsoOn: (portals: string) => `also on ${portals}`,
    untitled: 'Job without a title',
  },
  toolbar: {
    fetch: 'Fetch',
    cancel: 'Cancel',
    progress: 'Progress of the fetch',
    sortMenu: 'Sort',
    sortLabel: {
      match: 'By match',
      newest: 'By date',
    } satisfies Record<JobSort, string>,
    sortNoProfile: 'Without a profile, jobs sort by date only.',
    filter: 'Filter',
    favouritesOnly: 'Favourites only',
    portalHeading: 'Portal',
    bandHeading: 'Match',
    allPortals: 'All portals',
    band: {
      any: 'Any match',
      mid: 'Medium or high match',
      high: 'High match only',
    } satisfies Record<'any' | 'mid' | 'high', string>,
    bandNoProfile: 'Without a profile, there is no match.',
    filterReset: 'Reset filter',
    filterLine: (parts: readonly string[]) => parts.join(' · '),
    filterLineReset: 'Reset',
    needsMailbox: 'Connect a mailbox first.',
    needsPortal: 'Switch on a portal first.',
  },
  run: {
    never: 'No fetch yet',
    historyNotCopied: 'The history could not be copied.',
    step: {
      scan: 'Mailbox',
      fetch: 'Details',
      score: 'Scoring',
      export: 'Files',
    } satisfies Record<Step, string>,
    statusOf: (code: StatusCode, portal: Portal | null): string => {
      const at = portal === null ? undefined : statusAt[code];
      return at !== undefined && portal !== null ? at(portalName[portal]) : status[code];
    },
    ofTotal: (total: number) => `of ${n(total)}`,
    newPill: (value: number) => `${n(value)} new`,
    topPill: (value: number) => `${n(value)} high match`,
    resumesIn: (ms: number) => `Resumes in ${formatCountdown(ms)}`,
    resumesSoon: 'Resuming shortly',
    portalRuns: 'Running',
    portalPaused: 'Paused',
    portalSignIn: 'Sign-in needed',
    portalLayout: 'Pages look different',
    portalNew: (value: number) => `${n(value)} new`,
    portalDup: (value: number) => `${n(value)} duplicates`,
    portalNoDetails: (value: number) => `${n(value)} without details`,
    portalNothing: 'nothing new',
    kind: {
      fetch: 'Fetch',
      details: 'Fetch details',
      rescore: 'Score again',
    } satisfies Record<RunKindName, string>,
    done: 'Fetch done',
    rescored: 'Scored again',
    nothingNew: 'Nothing new since the last fetch.',
    cancelled: 'Fetch cancelled',
    failed: 'Fetch failed',
    details: {
      done: 'Details fetched',
      none: 'No details fetched',
      cancelled: 'Fetching details cancelled',
      failed: 'Fetching details failed',
      failedAds: (value: number) => `${count(value, 'ad', 'ads')} could not be fetched.`,
      goneAds: (value: number) => `${count(value, 'ad is', 'ads are')} no longer online.`,
    },
    rescore: {
      cancelled: 'Scoring cancelled',
      failed: 'Scoring failed',
    },
    rescoring: 'The jobs are being scored again.',
    exportFailed: {
      overview: 'The Excel file could not be written and was left unchanged.',
      overviewLocked: 'The Excel file is open in another program and was left unchanged.',
      overviewHtml: 'The overview could not be written.',
      txt: 'Not all text files could be written.',
      txtFolder: 'The folder of the text files cannot be reached.',
      backup: 'The old Excel file could not be backed up, so the new one was not written.',
      workspace: 'The work folder cannot be reached.',
    },
    skipped: (value: number) => `${count(value, 'job is', 'jobs are')} left for the next fetch.`,
    filesFailed: (value: number) => `${count(value, 'file', 'files')} could not be written.`,
    excelRenamed: (name: string) => `The old Excel file is now called ${name}.`,
    openOverview: 'Open report',
    history: 'History',
    alert: (portal: Portal, postings: number) =>
      `Alert email from ${portalName[portal]} with ${count(postings, 'job', 'jobs')}`,
    health: (portal: Portal, kind: Exclude<PortalHealth['kind'], 'ok'>): string => {
      const name = portalName[portal];
      switch (kind) {
        case 'paused':
          return `Paused on ${name}`;
        case 'quotaReached':
          return `Limit reached on ${name}`;
        case 'layoutSuspect':
          return `Pages on ${name} look different than expected`;
        case 'loginRequired':
          return `Sign-in needed on ${name}`;
      }
    },
    checkMailbox: 'Check mailbox',
  },
  list: {
    label: 'Jobs',
    excluded: 'Excluded',
    formalMissing: {
      degree: 'Degree missing',
      licence: 'Licence missing',
    },
    emptyWhileRun: 'The jobs show up here as the fetch goes on.',
    createAlert: (portal: string) => `Create an alert on ${portal}`,
    readOlder: FULL_MAILBOX,
    emptyAll: 'After the first fetch, the jobs show up here.',
    emptyAfterRun: 'The alert emails have had no jobs so far.',
    noHit: (query: string) => `No jobs for “${query}”.`,
    noFilterHit: 'No job fits the filter.',
    loadFailed: 'The job list could not be loaded.',
    pageFailed: 'More jobs could not be loaded.',
    createProfile: 'Create profile',
    openProfile: 'Open profile',
    noMailbox: 'Without a mailbox, no new jobs come in.',
    noProfile: 'Without a profile, there is no match.',
    profileUnreadable: PROFILE_UNREADABLE,
    profileEmpty: 'Profile without skills',
    profileBrokenText: 'That is why the jobs show no match.',
    thinProfile: 'Little in the profile, so the match stays rough.',
    connectMailbox: 'Connect mailbox',
  },
  facts: {
    now: 'starts now',
    from: (date: string) => `from ${date}`,
    agreed: 'to be agreed',
    months: (value: number) => count(value, 'month', 'months'),
    unlimited: 'open-ended',
    remote: (from: number, to: number) => {
      if (from >= 100) return 'fully remote';
      if (to <= 0) return 'On site';
      return from === to
        ? `${formatPercent(from)} remote`
        : `${n(from)} to ${formatPercent(to)} remote`;
    },
    mode: {
      remote: 'fully remote',
      hybrid: 'Hybrid',
      onsite: 'On site',
    } satisfies Record<WorkMode, string>,
    pay: (amount: number, per: Per, currency: string | null, lowerBound = false) =>
      `${lowerBound ? 'from ' : ''}${formatMoney(amount, currency)}/${PER[per]}`,
    workload: (from: number | null, to: number) => workloadWords(from, to, true),
    years: (min: number, max: number | null) =>
      max !== null && max > min
        ? `${n(min)} to ${count(max, 'year', 'years')}`
        : count(min, 'year', 'years'),
  },
  reader: {
    addToProfile: 'Add to profile',
    added: 'Added',
    addedToProfile: (term: string) => `“${term}” added to the profile.`,
    details: 'Job details',
    term: {
      company: 'Company',
      place: 'Location',
      mode: 'Work mode',
      contract: 'Contract type',
      rate: 'Day rate',
      start: 'Start',
      duration: 'Duration',
      workload: 'Workload',
      experience: 'Experience',
      industry: 'Industry',
      portal: 'Portal',
      received: 'Received',
    },
    salaryName: 'Salary',
    missing: '/',
    contractKind: {
      interim: 'Interim',
      freelance: 'Freelance',
      permanent: 'Permanent',
      anue: 'Temporary agency work',
      unclear: 'unclear',
    },
    estimated: 'estimated',
    assumed: 'assumed',
    verdict: {
      met: 'Met',
      partial: 'Partly met',
      violated: 'Not met',
      unknown: 'Unclear',
    } satisfies Record<Exclude<TermVerdict, 'unset'>, string>,
    criterion: criteria,
    note,
    open: 'Open ad',
    close: 'Close',
    pin: 'Mark as favourite',
    unpin: 'Remove favourite',
    archive: 'Archive',
    restore: 'Restore',
    more: 'More actions',
    delete: 'Delete',
    override: 'Score anyway',
    exclude: 'Exclude again',
    overridden: 'Scored anyway.',
    excludedAgain: 'Excluded again.',
    prompt: 'Copy AI prompt',
    promptNotCopied: 'The prompt could not be copied.',
    mail: OPEN_MAIL,
    noMail: 'There is no alert email for this job.',
    setUpSignIn: 'Set up sign-in',
    promptNoProfile: 'Without a profile, there is nothing to assess.',
    promptNoText: 'The text of the ad is still missing.',
    fetchDetails: 'Load ad',
    why: 'Requirements',
    noReasons: 'The ad names no clear requirements.',
    ad: 'Ad',
    adNote: {
      teaser: 'Only a preview',
      missing: 'Ad missing',
      loading: 'Loading the ad',
      unfetchable: 'Ad cannot be reached',
      gone: 'No longer online',
      closed: 'No longer taking applications',
    },
    short: SHORT_TEXT,
    loadFailed: 'The job could not be loaded.',
  },
  health: {
    advice: {
      paused: (reason: PauseReason, iso: string | null) => {
        const why = pause[reason].charAt(0).toUpperCase() + pause[reason].slice(1);
        return iso
          ? `${why}, so fetching resumes by itself at ${formatMoment(iso)}.`
          : `${why}, so the next fetch tries again by itself.`;
      },
      quota: (iso: string) =>
        `The limit is reached, so fetching resumes by itself at ${formatMoment(iso)}.`,
      emptyMails,
      pages: 'The pages of the portal look different, so the next fetch tries again by itself.',
      login: 'The sign-in has expired, so sign in again.',
    },
  },
  profile: {
    none: 'No profile yet',
    unreadable: PROFILE_UNREADABLE,
    noneText: 'With a profile, every job shows how well it fits.',
    replaces: 'A new profile replaces the file.',
    replacesStored: 'Saving replaces your profile.',
    replaced: 'Profile replaced.',
    restoreFailed: 'The previous profile could not be brought back.',
    create: 'Create profile',
    fromCv: 'Create from CV',
    updateFromCv: 'Update from CV',
    pick: 'Choose profile file',
    pickOther: 'Choose another file',
    more: 'More actions',
    remove: 'Delete profile',
    removeHeading: 'Delete profile?',
    removeConfirm: 'Delete',
    removed: 'Profile deleted.',
    saved: 'Profile saved.',
    unnamed: 'Profile without a name',
    rescoring: (value: number) => `${count(value, 'job is', 'jobs are')} being scored again.`,
    check: (value: number) => count(value, 'value to check', 'values to check'),
    next: 'Go to the first fetch',
    nextMailbox: 'Go to the mailbox',
    warning,
    pack: {
      finance: 'Finance',
      sap: 'SAP',
      itProject: 'IT projects',
      hr: 'HR',
      procurement: 'Procurement',
      data: 'Data',
      pharma: 'Pharma',
      operations: 'Operations',
      sales: 'Sales',
      legal: 'Legal',
      software: 'Software',
      restructuring: 'Restructuring',
      consulting: 'Management consulting',
      energy: 'Energy industry',
    } as Record<string, string>,
    save: 'Save',
    discard: 'Discard',
    leaveHeading: 'Save changes?',
    saveFirst: 'Save or discard first.',
    fixFirst: 'Correct the marked value first.',
    empty: 'Still empty',
    section: {
      person: 'Person',
      criteria: 'Conditions',
      competences: 'Skills',
      experience: 'Experience and qualifications',
      languages: 'Languages',
      wishes: 'Preferences',
      permanent: 'Permanent jobs',
    },
    sectionHint: {
      criteria: 'A job that does not fit here is excluded.',
      wishes: 'Preferences never exclude a job.',
    },
    field: {
      name: 'Name',
      namePlaceholder: 'First and last name',
      title: 'Role',
      titlePlaceholder: 'e.g. Interim manager',
      roles: 'Target roles',
      rolesPlaceholder: 'e.g. Interim CFO',
      competence: 'Skill',
      competencePlaceholder: 'e.g. Project management',
      years: 'Years',
      aliases: 'Synonyms',
      addCompetence: 'Add skill',
      removeCompetence: (name: string) => `Remove ${name || 'skill'}`,
      star: 'Mark as focus area',
      unstar: 'Remove focus area',
      starEmpty: 'Enter a skill first.',
      focusCount: (value: number, max: number) => `${n(value)}/${n(max)}`,
      focusHint: 'Marked skills count twice, at most five.',
      focusFull: 'At most five focus areas.',
      focusTrimmed: (count: number) =>
        `The file names ${n(count)} focus areas, and the first five are taken.`,
      strengths: 'Key strengths',
      strengthsPlaceholder: 'e.g. Leading teams through change',
      keywords: 'Keywords',
      keywordsPlaceholder: 'e.g. Transformation',
      totalYears: 'Professional experience',
      degrees: 'Degrees',
      degreesPlaceholder: 'e.g. Master',
      industries: 'Industries',
      industriesPlaceholder: 'e.g. Retail',
      tools: 'Tools and methods',
      toolsPlaceholder: 'e.g. Scrum',
      certificates: 'Certificates',
      certificatesPlaceholder: 'e.g. PMP',
      language: 'Language',
      languagePlaceholder: 'e.g. German',
      level: 'Level',
      addLanguage: 'Add language',
      removeLanguage: (name: string) => `Remove ${name || 'language'}`,
      wishRate: 'Preferred day rate',
      belowMinRate: 'Below the minimum day rate.',
      aboveExperience: 'Above your professional experience.',
      remote: 'Remote share',
      regions: 'Preferred regions',
      regionsPlaceholder: 'e.g. Munich',
      wishIndustries: 'Preferred industries',
      wishIndustriesPlaceholder: 'e.g. Energy',
      minDayRate: 'Minimum day rate',
      countries: 'Work countries',
      countriesPlaceholder: 'Search for a country',
      countryNone: 'No country by this name.',
      remoteOutside: 'Exclude remote jobs abroad',
      remoteOutsideOff: 'Choose the countries first.',
      noAnue: 'Exclude temporary agency work',
      noPermanent: 'Exclude permanent jobs',
      available: 'Available from',
      workload: 'Workload',
      workloadFrom: 'from',
      workloadTo: 'to',
      workloadMin: 'Workload from',
      workloadMax: 'Workload to',
      workloadOrder: 'The second value is below the first.',
      minMonths: 'Minimum duration',
      exclusionWords: 'Exclusion words',
      exclusionWordsPlaceholder: 'e.g. Internship',
      open: 'Open',
      date: 'Date',
      datePlaceholder: '1 Nov 2026',
      dateInvalid: 'Enter the date as 1 Nov 2026.',
      dateImpossible: 'This day does not exist.',
      targetYears: 'Experience asked from',
      minSalary: 'Minimum annual salary',
      places: 'Locations for permanent jobs',
      placesPlaceholder: 'e.g. Munich',
      remoteMin: 'Minimum remote share',
      remoteMinHint: 'Applies outside these locations.',
      placesFirst: 'Add locations first.',
      rounded: 'Rounded down to whole euros.',
      roundedWhole: 'Rounded down to a whole number.',
      refused: 'This value does not fit.',
      atMost: (max: number) => `At most ${n(max)}.`,
      unreadableNumber: (value: string) => `The file said “${value}”, which is not a number.`,
      unreadableDate: (value: string) => `The file said “${value}”, which is not a date.`,
      unreadableValue: (value: string) => `The file said “${value}”, which the app cannot read.`,
      unreadableFocus: (value: string) => `“${value}” is not one of the skills.`,
      unreadableRole: (value: string) => `“${value}” names no field.`,
      removeValue: 'Remove value',
    },
    unit: {
      euro: '€',
      years: 'years',
      experience: 'years',
      percent: '%',
      days: 'days a week',
      months: 'months',
    },
    level: {
      a1: 'A1',
      a2: 'A2',
      b1: 'B1',
      b2: 'B2',
      c1: 'C1',
      c2: 'C2',
      native: 'Native',
    } satisfies Record<LanguageLevel, string>,
    remoteWish: {
      full: 'Fully remote',
      mostly: 'Mostly remote',
      partly: 'Hybrid',
      onSite: 'On site',
    } satisfies Record<RemoteWish, string>,
    availability: {
      now: 'Immediately',
      from: 'From a date',
    } satisfies Record<Exclude<ProfileAvailability['kind'], 'unset'>, string>,
    country: countryName,
    languageName: {
      ar: 'Arabic',
      bg: 'Bulgarian',
      zh: 'Chinese',
      da: 'Danish',
      de: 'German',
      en: 'English',
      fi: 'Finnish',
      fr: 'French',
      el: 'Greek',
      hi: 'Hindi',
      it: 'Italian',
      ja: 'Japanese',
      ko: 'Korean',
      hr: 'Croatian',
      nl: 'Dutch',
      no: 'Norwegian',
      pl: 'Polish',
      pt: 'Portuguese',
      ro: 'Romanian',
      ru: 'Russian',
      sv: 'Swedish',
      sk: 'Slovak',
      sl: 'Slovenian',
      es: 'Spanish',
      cs: 'Czech',
      tr: 'Turkish',
      uk: 'Ukrainian',
      hu: 'Hungarian',
    },
    paste: {
      privacy: 'The CV goes to the AI you use.',
      copied: 'The prompt is copied.',
      copyFailed: 'The prompt could not be copied.',
      copy: 'Copy AI prompt',
      copyAgain: 'Copy again',
      step: 'Paste it into an AI chat and attach your CV.',
      preview: 'Show prompt',
      answer: 'The AI’s answer',
      take: 'Apply',
      takeEmpty: 'Paste the AI’s answer first.',
    },
  },
  settings: {
    mailbox: 'Mailbox',
    portals: 'Portals',
    export: 'Export',
    look: 'Appearance',
    app: 'App',
    backToJob: 'Back to the job',
    connected: 'Connected',
    notConnected: 'No mailbox',
    /** The last fetch could not reach Gmail, or Gmail refused the password. */
    unreachable: 'Not reachable',
    refused: 'Refused',
    mailRefused: 'Gmail rejected the address or app password, so enter them again with “Change”.',
    address: 'Gmail address',
    password: 'App password',
    createPassword: 'Create app password',
    addressMissing: 'The Gmail address is missing.',
    passwordMissing: 'The app password is missing.',
    twoStepAction: 'Turn on 2-Step Verification',
    connect: 'Connect',
    connectHeading: 'Connect mailbox',
    mailboxNotCounted: 'Mailbox connected.',
    removeMailbox: 'Remove mailbox?',
    removeMailboxText: 'The app password will be deleted, but your jobs stay.',
    range: 'Period',
    rangeName: {
      sinceLast: 'Since the last check',
      days7: '7 days',
      days30: '30 days',
      all: 'All',
    },
    quota: (used: number, cap: number) => `Today ${n(used)} of ${n(cap)} calls`,
    signIn: 'Sign in',
    signOut: 'Sign out',
    openPortal: 'Open in browser',
    signInWaiting: 'The sign-in window is open.',
    folder: 'Result folder',
    excel: 'Excel file',
    csv: 'CSV file',
    excelMissing: 'The Excel file is created at the next check.',
    csvMissing: 'The CSV file is created at the next check.',
    folderMoved: 'The profile and the files are in the new folder.',
    folderFiles: 'The files are in the new folder.',
    folderOwnProfile: 'The app now uses the profile in this folder.',
    fullMailboxConfirm: 'Fetch',
    fullMailboxHeading: 'Fetch all alert emails?',
    fullMailboxText: 'This takes longer and fetches more pages from the portals.',
    logs: 'Log',
    version: (value: string) => `Version ${value}`,
    backup: 'Backup',
    backupHeading: 'Restore a backup',
    backupAction: 'Restore',
    backupNone: 'There is no backup yet.',
    backupToday: (time: string) => `Today ${time}`,
    backupKind: {
      daily: null,
      update: 'before an update',
      restore: 'before a restore',
    },
    backupText: 'The current state is backed up first.',
    backupRestored: 'Backup restored.',
    backupUndone: 'The previous state is back.',
    reset: 'All data',
    resetAction: 'Reset',
    resetHeading: 'Reset everything?',
    resetText: 'The app then restarts and deletes',
    resetItems: [
      'the jobs and the settings',
      'the profile',
      'the app password',
      'the sign-ins at the portals',
      'the app’s files in the result folder',
    ],
    resetDone: 'The app is reset.',
    resetPartly: (value: number) =>
      `The app is reset, but ${count(value, 'item', 'items')} could not be deleted.`,
    running: 'A fetch is running right now.',
    dryRun: 'Dry run, so no data is changed.',
    demo: 'Demo with sample data, without the mailbox or the portals.',
    palette: 'Colours',
    paletteName: {
      coast: 'Coast',
      light: 'Light',
      dark: 'Dark',
    } satisfies Record<Palette, string>,
    language: 'Language',
    languageName: {
      de: 'Deutsch',
      en: 'English',
    } satisfies Record<Language, string>,
  },
  firstRun: {
    steps: 'First steps',
    mailbox: 'Mailbox',
    mailboxText: (portals: readonly Portal[]) =>
      `The alert emails from ${joined(portals.map((p) => portalName[p]))} must go to this Gmail${NBSP}address.`,
    noPortal: 'Turn on a portal first.',
    openSettings: 'Open settings',
    alertMails: (value: number) => count(value, 'alert email', 'alert emails'),
    createAlert: 'Create alert',
    noAlerts: 'No alert email arrived in the last 30 days, so create an alert first.',
    profile: 'Profile',
    profileEmpty: 'Without skills, nothing is scored.',
    fetch: 'First fetch',
  },
  shell: {
    loadFailed: 'The app could not load its data.',
    closing: (activity: string | null) => closing[busyOf(activity)],
  },
  toast: {
    rescored: 'Jobs scored again.',
    copied: 'Copied.',
    prompt: 'Prompt copied.',
    archivedOne: (name: string) => `“${name}” archived.`,
    trashedOne: (name: string) => `“${name}” moved to the trash.`,
    trashedMany: (value: number) => `${n(value)} jobs moved to the trash.`,
    inboxOne: (name: string) => `“${name}” is back in Jobs.`,
    inboxMany: (value: number) => `${n(value)} jobs are back in Jobs.`,
    restoredMany: (value: number) => `${n(value)} jobs restored.`,
    archivedMany: (value: number) => `${n(value)} jobs archived.`,
    restored: (name: string) => `“${name}” restored.`,
    deletedOne: (name: string) => `“${name}” deleted forever.`,
    deletedMany: (value: number) => `${n(value)} jobs deleted forever.`,
    trashEmptied: 'Trash emptied.',
    runDone: (value: number) =>
      value === 0
        ? 'Fetch done, nothing new.'
        : `Fetch done, ${count(value, 'new job', 'new jobs')}.`,
    runDoneFilesOld: 'Fetch done, but the files are not up to date.',
    show: 'Show',
  },
  error: {
    text: (kind: ErrorKind | 'unknown', params: Params): string => {
      if (kind === 'invalid' && typeof params.reason === 'string' && params.reason in invalid) {
        return textOf(invalid[params.reason as InvalidInput['reason']], params);
      }
      return textOf(errors[kind], params);
    },
  },
};
