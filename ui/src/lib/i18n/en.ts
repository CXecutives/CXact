// English UI catalog: de.ts in English, key for key and in the same order. Its type is the
// German catalog's shape (`Catalog`), so a missing or extra key is a type error; after a
// merge the type check lists every new German key to translate here.
//
// The same rules as in German (CLAUDE.md, checked by core/tests/ui_contract.rs): little
// text, plain and natural. Buttons are one verb phrase without a period; notes are one short
// sentence with a period; headings and labels end without a colon; no dash or em dash as a
// separator, no "X: Y", no exclamation marks. No German except product and portal names and
// the name of the German language. Glossary (de.ts, one word per thing): Job, Portal, Match
// (High, Medium, Low), Job details, Requirements (Met, Partly met, Not met, Unclear), Profile,
// Mailbox, Alert email, Check mailbox (the button; what it does is a fetch), Load ad, Excel
// file, CSV file, Export folder, Excluded, Score anyway, New, Inbox (the place of the active
// jobs), Archive (Move to inbox: back from there), Trash, Delete (into the Trash; there Delete
// forever and Restore), Data (the card of the app's data), Calls (what a portal allows a day),
// Skill, Preference. "Conditions" only names the profile's section. Plain British English:
// "email", never "mail" for one message; "preferences", never "wishes"; "forever" for
// endgültig, never "for good"; two main clauses are joined by a conjunction, never by a
// comma alone; an introductory phrase takes its comma ("Without a profile, …"); apostrophes
// and quotes are typographic (’ “ ”), a named control stands in quotes (“Load ad”).

import type {
  Band,
  ErrorKind,
  FetchRange,
  InvalidInput,
  JobSort,
  Language,
  Palette,
  PauseReason,
  Place,
  Portal,
  LanguageLevel,
  ProfileAvailability,
  ReasonWeight,
  RemoteWish,
  WorkMode,
} from '../ipc/types';
import {
  PROFILE_KEY_FIELD,
  textOf,
  type AnswerAdds,
  type Catalog,
  type ContractKind,
  type TermVerdict,
} from './de';
import { PORTAL_LABEL } from '../ipc/types/portals';
import { NBSP, formatEuro, formatMoment, formatMoney, formatNumber, formatPercent } from './format';

type Params = Record<string, string | number | boolean | null>;
type Text = string | ((params: Params) => string);

const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const n = (value: number): string => formatNumber(value);
/** English plural for a count. */
const count = (value: number, one: string, many: string): string =>
  `${n(value)} ${value === 1 ? one : many}`;

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
  details: 'Ads are being loaded already.',
  rescore: 'The jobs are being scored again.',
  session: 'A sign-in is running.',
  files: 'The app is writing its files.',
  mailbox: 'The mailbox is being checked.',
};

const closing: Record<Busy, string> = {
  fetch: 'The fetch is stopping, and then the app closes.',
  details: 'Loading the ads is stopping, and then the app closes.',
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
  offline: 'No connection to the internet.',
  secretStore: 'The system’s password store cannot be reached.',
  secretCorrupt: 'The stored app password cannot be read.',
  portalUnavailable: (p) => `No connection to ${portalOf(p.portal)}.`,
  portalPaused: (p) => `${portalOf(p.portal)} is paused right now.`,
  portalQuota: (p) => `The limit for ${portalOf(p.portal)} is reached.`,
  internal: INTERNAL,
  unknown: INTERNAL,
};

/** Fields of the profile form, named in an error or a warning about their value: the label
 *  of the field without its unit, read from the form's own words (de.ts). */
const profileField = (): Record<string, string> => {
  const { field, section } = en.profile;
  return {
    name: field.name,
    title: field.title,
    competences: section.competences,
    strengths: field.strengths,
    keywords: field.keywords,
    years: field.totalYears,
    degrees: field.degrees,
    industries: field.industries,
    tools: field.tools,
    certificates: field.certificates,
    languages: section.languages,
    minDayRate: field.minDayRate,
    countries: field.countries,
    contracts: 'Temporary agency work and permanent jobs',
    remoteOutside: field.remoteOutside,
    available: field.available,
    workloadMinDays: field.workload,
    workloadMaxDays: field.workload,
    minMonths: field.minMonths,
    exclusionWords: field.exclusionWords,
    minSalary: field.minSalary,
    permanentPlaces: field.places,
    permanentRemoteMin: field.remoteMin,
    focus: 'Focus areas',
    roles: field.roles,
    wishDayRate: field.wishRate,
    remote: field.remote,
    regions: field.regions,
    wishIndustries: field.wishIndustries,
  };
};
const fieldName = (value: unknown): string => profileField()[str(value)] ?? str(value);

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

/** Alert emails in which the app found no jobs (a portal's row in the settings, next to the
 *  button that opens the email). */
const emptyMails = (mails: number): string =>
  mails === 1
    ? 'The app found no jobs in one alert email.'
    : `The app found no jobs in ${n(mails)} alert emails.`;

/** A profile file the app cannot read (the list and the Profile view). */
const PROFILE_UNREADABLE = 'Profile cannot be read';

const ANUE = 'The ad mentions temporary agency work.';
const LOW_TEXT = 'The ad names few clear requirements.';
const SHORT_TEXT = 'The ad is very short.';
const WORKLOAD = 'The workload does not fit the profile.';
const DURATION = 'The duration is below the minimum in the profile.';

/** Years of experience, a range with both ends: "3 to 5 years", "10 years". */
const yearsWords = (min: number, max: number | null): string =>
  max !== null && max > min
    ? `${n(min)} to ${count(max, 'year', 'years')}`
    : count(min, 'year', 'years');

/** A duration in months or weeks, a range with both ends ("9 weeks", "3 to 6 months"). */
function durationWords(
  value: number,
  from: number | null,
  unit: 'month' | 'week',
  _inside: boolean,
): string {
  const [one, many] = unit === 'week' ? ['week', 'weeks'] : ['month', 'months'];
  return from !== null && from < value
    ? `${n(from)} to ${count(value, one, many)}`
    : count(value, one, many);
}

/** A junior level by the word the job details show for it (`facts.level`). */
const LEVEL: Record<string, string> = {
  internship: 'Internship',
  student: 'Working student',
  trainee: 'Trainee',
  entry: 'Career start',
  graduate: 'Graduate',
  volunteer: 'Volunteer',
  junior: 'Junior',
  assistant: 'Assistant',
  associate: 'Associate',
};

/** How far an amount lies above the profile's minimum (percent), inside a sentence. */
const aboveMinimum = (percent: number): string =>
  percent === 0 ? 'exactly at your minimum' : `${formatPercent(percent)} above your minimum`;

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

/** The pay a rate reason names, as the subject of its sentence: a day rate (a range with both
 *  ends), or an hourly one with what it makes a day (`rate` per day, `amount` per hour,
 *  `from` the lower end of a range). */
function rateSubject(p: Params): string {
  // A range with both ends, in the unit the ad states it (`from`).
  const range = (to: Params[string] | undefined): string =>
    typeof p.from === 'number' && p.from < num(to)
      ? `${n(p.from)} to ${formatEuro(to)}`
      : formatEuro(to);
  if (p.hourly === true && typeof p.amount === 'number') {
    return `The hourly rate of ${range(p.amount)} makes ${formatEuro(p.rate)} a day and`;
  }
  return `The day rate of ${range(p.rate)}`;
}

/** Preferences of the profile (`state` met, near, missed or unknown). */
function dayRateWish(p: Params): string {
  const wish = formatEuro(p.wish);
  switch (p.state) {
    case 'met':
      return `${rateSubject(p)} meets your preferred rate of ${wish}.`;
    case 'near':
      return `${rateSubject(p)} is just below your preferred rate of ${wish}.`;
    case 'missed':
      return `${rateSubject(p)} is below your preferred rate of ${wish}.`;
    default:
      return p.currency
        ? `The day rate is given in ${str(p.currency)}.`
        : 'The ad names no day rate.';
  }
}

/** The remote preference of the profile (`level` of the profile editor) in the words of the
 *  profile's choice and the reader's work mode, inside a sentence. */
const REMOTE_LEVEL: Record<string, string> = {
  full: 'fully remote',
  mostly: 'mostly remote',
  partly: 'hybrid',
  onSite: 'on site',
};

/** The ad's remote share in the words of the reader's work mode, next to the preference ("The
 *  job is 60% remote, and you prefer mostly remote"). */
function remoteWish(p: Params): string {
  if (p.state === 'unknown') return 'The ad names no remote share.';
  const level = typeof p.level === 'string' ? REMOTE_LEVEL[p.level] : undefined;
  const wished = level ? `, and you prefer ${level}` : '';
  let ad: string;
  if (p.share === 0) ad = 'The job is on site';
  else if (p.share === 100) ad = 'The job is fully remote';
  else if (typeof p.share === 'number') ad = `The job is ${formatPercent(p.share)} remote`;
  else if (typeof p.from === 'number' && typeof p.to === 'number')
    ad = `The job is ${n(num(p.from))} to ${formatPercent(p.to)} remote`;
  else ad = 'The job is hybrid';
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
  dayRate: (p) => `${rateSubject(p)} is below ${formatEuro(p.min)}.`,
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
  permanentRegion: (p) => {
    const place = p.location
      ? `${str(p.location)} is outside your locations for permanent jobs`
      : 'The location is outside your locations for permanent jobs';
    // The remote share decides too where the profile sets a minimum for it.
    if (typeof p.remoteMin !== 'number') return `${place}.`;
    return typeof p.remote === 'number'
      ? `${place}, and ${formatPercent(p.remote)} remote is below your minimum of ${formatPercent(p.remoteMin)}.`
      : `${place}, and the ad does not name ${formatPercent(p.remoteMin)} remote.`;
  },
  permanentRegionUnclear: (p) =>
    p.location
      ? `It is unclear whether ${str(p.location)} is one of your locations for permanent jobs.`
      : 'The location of the permanent job is unclear.',
  salary: (p) => {
    // A salary in another currency is not compared with a minimum in euros.
    if (typeof p.currency === 'string' && p.currency !== 'EUR') {
      return `The salary is given in ${str(p.currency)}.`;
    }
    if (typeof p.salary !== 'number' || p.min === undefined) {
      return 'The salary is below your minimum.';
    }
    const amount =
      typeof p.from === 'number' && p.from < p.salary
        ? `of ${n(p.from)} to ${formatEuro(p.salary)}`
        : p.lowerBound
          ? `from ${formatEuro(p.salary)}`
          : `of ${formatEuro(p.salary)}`;
    const bonus = typeof p.bonus === 'number' ? ` plus a ${formatPercent(p.bonus)} bonus` : '';
    return `The annual salary ${amount}${bonus} is below ${formatEuro(p.min)}.`;
  },
  salaryUnknown: 'The ad names no salary.',
  seniorityUnclear: 'Whether the job fits your years of experience is unclear.',
  overqualified: (p) => {
    const have = typeof p.have === 'number' ? count(p.have, 'year', 'years') : null;
    const tail = have === null ? 'you are overqualified' : `with ${have} you are overqualified`;
    return typeof p.years === 'number'
      ? `The job asks for ${yearsWords(p.years, typeof p.max === 'number' ? p.max : null)} of experience, ${tail}.`
      : `The job is a junior role, ${tail}.`;
  },
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
  duration: (p) => {
    const length =
      typeof p.weeks === 'number'
        ? durationWords(p.weeks, typeof p.from === 'number' ? p.from : null, 'week', true)
        : typeof p.months === 'number'
          ? durationWords(p.months, typeof p.from === 'number' ? p.from : null, 'month', true)
          : null;
    return length !== null && typeof p.min === 'number'
      ? `The duration of ${length} is below your minimum duration of ${count(p.min, 'month', 'months')}.`
      : DURATION;
  },
  exclusionWord: (p) => `“${str(p.word)}” is one of your exclusion words.`,
} satisfies Catalog['reason']['code'];

/**
 * Hard criteria of the profile (`MatchDetail.criteria[].code`, `ProfileUnderstanding.
 * criteria[].code`), as in de.ts.
 */
const criteria = {
  minDayRate: {
    label: 'Day rate',
    met: 'The day rate reaches your minimum.',
    short: 'Day rate too low',
    exclusion: 'The day rate is below your minimum.',
  },
  countries: {
    label: 'Countries',
    met: (p) =>
      p.remote === true ? 'The job is fully remote.' : 'The place of work is in your countries.',
    short: 'Outside your countries',
    exclusion: 'The place of work is not in your countries.',
  },
  noAnue: {
    label: 'Temporary agency work',
    met: 'The ad names its contract type, no temporary agency work.',
    short: 'Temporary agency work',
    exclusion: 'You exclude temporary agency work.',
  },
  noPermanent: {
    label: 'Permanent job',
    met: 'The ad names its contract type, no permanent job.',
    short: 'Permanent job',
    exclusion: 'You exclude permanent jobs.',
  },
  availability: {
    label: 'Availability',
    met: 'The start fits your availability.',
    short: 'Start does not fit',
    exclusion: 'The start is before you are available.',
  },
  minSalary: {
    label: 'Annual salary',
    met: 'The salary reaches your minimum.',
    short: 'Salary too low',
    exclusion: 'The salary is below your minimum.',
  },
  permanentRegion: {
    label: 'Locations',
    met: (p) =>
      p.remote === true
        ? 'The job is fully remote.'
        : 'The place is one of your locations for permanent jobs.',
    short: 'Location does not fit',
    exclusion: 'The place is not among your locations for permanent jobs.',
  },
  workload: {
    label: 'Workload',
    met: 'The workload fits your days.',
    short: 'Workload does not fit',
    exclusion: WORKLOAD,
  },
  duration: {
    label: 'Duration',
    met: 'The duration reaches your minimum duration.',
    short: 'Duration too short',
    exclusion: DURATION,
  },
  exclusionWords: {
    label: 'Exclusion words',
    met: 'The ad names none of your exclusion words.',
    short: 'Exclusion word',
    exclusion: 'The ad names one of your exclusion words.',
  },
} satisfies Catalog['reader']['criterion'];

/** `JobMatch.note` / `MatchDetail.summary` codes. */
const note = {
  hardCriterion: 'An exclusion criterion applies.',
  shortText: 'Too little text to score.',
  lowEvidence: LOW_TEXT,
  engineFailed: 'This ad could not be scored.',
} satisfies Catalog['reader']['note'];

/** A key of the profile file by the name of its field (de.ts, `PROFILE_KEY_FIELD`). */
const keyLabel = (key: string): string =>
  key in PROFILE_KEY_FIELD ? fieldName(PROFILE_KEY_FIELD[key]) : key;
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
  window: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore Down',
    close: 'Close',
  },
  common: {
    loading: 'Loading',
    cancel: 'Cancel',
    remove: 'Remove',
    change: 'Change',
    open: 'Open',
    hide: 'Hide',
    back: 'Back',
    retry: 'Try again',
    undo: 'Undo',
    openFolder: 'Open folder',
    openLog: 'Open log',
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
  place: {
    tabs: 'Locations',
    inbox: 'Inbox',
    archive: 'Archive',
    trash: 'Trash',
    pickJob: 'Choose a job from the list.',
    search: {
      inbox: 'Search the inbox',
      archive: 'Search the archive',
      trash: 'Search the trash',
    } satisfies Record<Place, string>,
    hitsIn: {
      inbox: 'In the inbox',
      archive: 'In the archive',
      trash: 'In the trash',
    } satisfies Record<Place, string>,
    empty: {
      inbox: 'No jobs.',
      archive: 'The archive is empty.',
      trash: 'The trash is empty.',
    } satisfies Record<Place, string>,
  },
  actions: {
    open: 'Open',
    mail: OPEN_MAIL,
    openAd: 'Open ad',
    prompt: 'Copy AI prompt',
    promptNoProfile: 'Without a profile, there is nothing to assess.',
    include: 'Score anyway',
    exclude: 'Exclude again',
    archive: 'Archive',
    unarchive: 'Move to inbox',
    trash: 'Delete',
    restore: 'Restore',
    purge: 'Delete forever',
    purgeConfirm: 'Delete forever',
    purgeHeading: (value: number) =>
      value === 1 ? 'Delete the job forever?' : `Delete ${n(value)} jobs forever?`,
    purgeText: 'The job never comes back, not even from old alert emails.',
    emptyTrash: 'Empty trash',
    emptyTrashHeading: 'Empty the trash?',
    emptyTrashText: (value: number) =>
      value === 1
        ? 'The job never comes back, not even from old alert emails.'
        : `The ${n(value)} jobs never come back, not even from old alert emails.`,
  },
  menu: {
    job: 'Job',
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
  field: {
    reveal: 'Show password',
    conceal: 'Hide password',
    clear: 'Clear search',
  },
  score: {
    value: (band: string, percent: string) => `${band}, ${percent}`,
    excluded: 'Excluded',
    none: 'Not scored yet',
    off: 'No match without a profile',
    band: {
      high: 'High match',
      mid: 'Medium match',
      low: 'Low match',
    } satisfies Record<Band, string>,
    why: 'Why this number?',
    factor: {
      musts: (met: number, partial: number, total: number) => {
        const line = `${n(met)} of ${count(total, 'must-have', 'must-haves')} met`;
        return partial > 0 ? `${line}, ${n(partial)} in part` : line;
      },
      nice: (met: number, total: number) =>
        `${n(met)} of ${count(total, 'optional requirement', 'optional requirements')} met`,
      focus: (hit: number, total: number) => {
        if (total === 1) return hit > 0 ? 'Your focus area matched' : 'Your focus area missed';
        return hit > 0
          ? `${n(hit)} of ${n(total)} focus areas matched`
          : 'None of your focus areas matched';
      },
      role: (role: string, full: boolean) =>
        full ? `Fits the target role ${role}` : `Close to the target role ${role}`,
      noRole: 'No target role in the title',
      wishesUp: 'Your preferences fit, so a little more',
      wishesDown: 'Your preferences hardly fit, so a little less',
      evidence: {
        low: 'Little text, so scored with caution',
        teaser: 'Only a preview, so scored with caution',
      },
      permanent: 'Permanent role, so a little less',
      cap: (why: string, max: number) => `${why}, so at most ${n(max)}`,
      capWhy: {
        formal: 'Formal requirement open',
        severalOpen: 'Several must-haves open',
        offField: 'No skill must-have met',
        titleOpen: 'Core of the role open',
        noItems: 'No clear requirements',
        junior: 'Junior role',
      },
    },
  },
  reason: {
    weight: {
      must: 'Must-have',
      nice: 'Optional',
      hard: 'Exclusion',
      info: 'Note',
    } satisfies Record<ReasonWeight, string>,
    why: {
      met: (profile: string, years: number | null) =>
        years === null
          ? `You bring ${profile}.`
          : `You bring ${profile}, ${count(years, 'year', 'years')}.`,
      fewerYears: (profile: string, have: number, asked: number) =>
        `You bring ${profile}, but ${n(have)} instead of ${count(asked, 'year', 'years')}.`,
      general: (profile: string) => `Your profile names only the broader ${profile}.`,
      years: (asked: string, have: number) =>
        `The job asks for ${asked} of experience, you bring ${count(have, 'year', 'years')}.`,
      topicYears: (asked: string, profile: string, have: number) =>
        `The job asks for ${asked} of ${profile}, you bring ${count(have, 'year', 'years')}.`,
      noYears: 'Your years of experience are not in the profile.',
      soft: 'Personal strengths count half without proof in the profile.',
      frame: 'A condition of the job, it does not count.',
      language: {
        met: 'Your language skills are enough.',
        partial: 'Your language level is one step below.',
        low: 'Your language level is well below.',
        open: 'The language is not in your profile.',
      },
      degree: {
        met: 'Your degree fits.',
        partial: 'Your degree fits only in part.',
        open: 'Your profile names no fitting degree.',
      },
      licence: {
        met: 'The licence is in your profile.',
        open: 'The licence is not in your profile.',
      },
      noDegree: 'Your profile names no degree.',
      fits: 'Fits your profile.',
      partly: 'Fits your profile only in part.',
      partlyBy: (profile: string) => `Only partly covered by ${profile}.`,
      missing: 'Not in your profile.',
    },
    code: reasonCode,
  },
  job: {
    unread: 'New',
    alsoOn: (portals: string) => `also on ${portals}`,
    untitled: 'Job without a title',
    closed: 'Closed',
  },
  toolbar: {
    fetch: 'Check mailbox',
    range: 'Period',
    rangeName: {
      sinceLast: 'Since the last fetch',
      days7: 'Last 7 days',
      days30: 'Last 30 days',
      all: 'All alert emails',
    } satisfies Record<FetchRange, string>,
    cancel: 'Cancel',
    progress: 'Progress of the fetch',
    sortHeading: 'Sort',
    sortLabel: {
      match: 'By match',
      newest: 'By date',
      rate: 'By day rate',
    } satisfies Record<JobSort, string>,
    sortNoProfile: 'Without a profile, jobs sort by date only.',
    filter: 'Sort and filter',
    chips: 'Filter',
    portalHeading: 'Portal',
    bandHeading: 'Match',
    band: {
      high: 'High',
      mid: 'Medium',
      low: 'Low',
    } satisfies Record<Band, string>,
    bandNoProfile: 'Without a profile, there is no match.',
    contractHeading: 'Contract',
    workHeading: 'Work model',
    work: {
      remote: 'Remote',
      hybrid: 'Hybrid',
      onsite: 'On site',
    } satisfies Record<WorkMode, string>,
    unreadOnly: 'New only',
    filterReset: 'Reset filter',
    needsMailbox: 'Connect a mailbox first.',
    needsPortal: 'Switch on a portal first.',
  },
  run: {
    line: {
      mailbox: 'Reading the mailbox',
      ads: (done: number, total: number) => `Ads ${n(done)} of ${n(total)}`,
      adsStart: 'Loading the ads',
      scoring: 'Scoring the jobs',
      files: 'Writing the files',
    },
    exportFailed: {
      overview: 'The Excel file could not be written and was left unchanged.',
      overviewLocked: 'The Excel file is open in another program and was left unchanged.',
      csv: 'The CSV file could not be written and was left unchanged.',
      csvLocked: 'The CSV file is open in another program and was left unchanged.',
      backup: 'The old Excel file could not be backed up, so the new one was not written.',
      workspace: 'The export folder cannot be reached.',
    },
    checkMailbox: 'Review mailbox',
    paused: (portal: string, until: string | null) =>
      until === null
        ? `${portalOf(portal)} paused`
        : `${portalOf(portal)} paused until ${formatMoment(until)}`,
  },
  list: {
    label: 'Jobs',
    excluded: 'Excluded',
    emptyWhileRun: 'The jobs show up here as the fetch goes on.',
    emptyAll: 'After the first fetch, the jobs show up here.',
    emptyAfterRun: 'The alert emails have had no jobs so far.',
    noHit: (query: string) => `No jobs for “${query}”.`,
    noFilterHit: 'No job fits the filter.',
    loadFailed: 'The job list could not be loaded.',
    pageFailed: 'More jobs could not be loaded.',
    createProfile: 'Create profile',
    openProfile: 'Open profile',
    noMailbox: 'Without a mailbox, no new jobs come in.',
    noProfile: 'No match without a profile.',
    profileUnreadable: PROFILE_UNREADABLE,
    profileEmpty: 'Profile without skills',
    profileBrokenText: 'That is why the jobs show no match.',
    thinProfile: 'Little in the profile, so the match stays rough.',
    connectMailbox: 'Connect mailbox',
  },
  facts: {
    now: 'immediately',
    from: (date: string) => `from ${date}`,
    agreed: 'to be agreed',
    duration: (value: number, from: number | null, unit: 'month' | 'week') =>
      durationWords(value, from, unit, false),
    unlimited: 'open-ended',
    remote: (from: number, to: number) => {
      if (from >= 100) return 'Fully remote';
      if (to <= 0) return 'On site';
      return from === to
        ? `${formatPercent(from)} remote`
        : `${n(from)} to ${formatPercent(to)} remote`;
    },
    mode: {
      remote: 'Fully remote',
      hybrid: 'Hybrid',
      onsite: 'On site',
    } satisfies Record<WorkMode, string>,
    pay: (amount: number, per: Per, currency: string | null, lowerBound = false) =>
      `${lowerBound ? 'from ' : ''}${formatMoney(amount, currency)}/${PER[per]}`,
    payRange: (from: number, to: number, per: Per, currency: string | null) =>
      `${n(from)} to ${formatMoney(to, currency)}/${PER[per]}`,
    bonus: (pay: string, percent: number) => `${pay} plus a ${formatPercent(percent)} bonus`,
    workload: (from: number | null, to: number) => workloadWords(from, to, true),
    years: (min: number, max: number | null) => yearsWords(min, max),
    level: (code: string): string | null => LEVEL[code] ?? null,
  },
  reader: {
    addTo: {
      competence: (term: string) => `Add ${term} to skills`,
      tool: (term: string) => `Add ${term} to tools`,
      industry: (term: string) => `Add ${term} to industries`,
      language: (term: string) => `Add ${term} to languages`,
      certificate: (term: string) => `Add ${term} to certificates`,
      degree: (term: string) => `Add ${term} to degrees`,
    },
    added: 'Added',
    addedToProfile: (term: string) => `“${term}” added to the profile.`,
    details: 'Job details',
    term: {
      company: 'Company',
      place: 'Location',
      mode: 'Work model',
      contract: 'Contract type',
      rate: 'Day rate',
      start: 'Start',
      duration: 'Duration',
      workload: 'Workload',
      experience: 'Experience',
      deadline: 'Deadline',
      contact: 'Contact',
      industry: 'Industry',
      portal: 'Portal',
      received: 'Received',
    },
    salaryName: 'Salary',
    hourlyName: 'Hourly rate',
    payMet: {
      day: (percent: number) => `The day rate is ${aboveMinimum(percent)}.`,
      upper: (percent: number) => `The upper end is ${aboveMinimum(percent)}.`,
      hour: (amount: number, perDay: number, percent: number) =>
        `The hourly rate of ${formatEuro(amount)} makes ${formatEuro(perDay)} a day and is ${aboveMinimum(percent)}.`,
      salary: (percent: number) => `The salary is ${aboveMinimum(percent)}.`,
      bonus: (percent: number) => `With the bonus the salary is ${aboveMinimum(percent)}.`,
    },
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
    openOffline: 'Open offline ad',
    offline: 'no longer online',
    offlineSince: (day: string) => `no longer online since ${day}`,
    close: 'Close',
    more: 'More actions',
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
      teaser: 'Only a preview.',
      missing: 'Not loaded yet.',
      loading: 'Loading.',
      unfetchable: 'Cannot be reached.',
      gone: 'No longer online.',
      closed: 'No longer taking applications.',
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
    noneText: 'With a profile, every job shows its match.',
    replaces: 'A new profile replaces the file.',
    replacesStored: 'Saving replaces your profile.',
    replaced: 'Profile replaced.',
    restoreFailed: 'The previous profile could not be brought back.',
    fromCv: 'Create from CV',
    updateFromCv: 'Update from CV',
    profiles: 'Profiles',
    numbered: (value: number) => `Profile ${n(value)}`,
    newProfile: 'New profile',
    duplicate: 'Duplicate profile',
    copyName: (name: string) => `${name} copy`,
    rename: 'Rename',
    renameHeading: 'Rename profile',
    load: 'Load from file',
    switched: 'Profile switched, jobs are being scored again.',
    created: (name: string) => `Profile created, “${name}” is active now.`,
    duplicated: (name: string) => `Copy created, “${name}” is active now.`,
    remove: 'Delete profile',
    removeHeading: (name: string) => `Delete “${name}”?`,
    removeConfirm: 'Delete',
    removed: 'Profile deleted.',
    removedNow: (name: string) => `Profile deleted, “${name}” is active now.`,
    saved: 'Profile saved.',
    savedEffect: (high: number, excluded: number) => {
      const jobs = (value: number): string => count(Math.abs(value), 'job', 'jobs');
      const out = (value: number): string => (high === 0 ? jobs(value) : n(Math.abs(value)));
      const parts = [
        high > 0 ? `${jobs(high)} now with a high match` : null,
        high < 0 ? `${jobs(high)} no longer with a high match` : null,
        excluded > 0 ? `${out(excluded)} excluded` : null,
        excluded < 0 ? `${out(excluded)} no longer excluded` : null,
      ].filter((part) => part !== null);
      return parts.length === 0 ? 'Profile saved.' : `Profile saved, ${parts.join(', ')}.`;
    },
    unnamed: 'Profile without a name',
    rescoring: (value: number) => `${count(value, 'job is', 'jobs are')} being scored again.`,
    check: (value: number) => count(value, 'value to check', 'values to check'),
    next: 'Go to the first fetch',
    nextMailbox: 'Go to the mailbox',
    warning,
    save: 'Save',
    discard: 'Discard',
    leaveHeading: 'Save changes?',
    saveFirst: 'Save or discard first.',
    fixFirst: 'Correct the marked value first.',
    empty: 'Still empty',
    asked: 'Often asked for',
    askedAdd: 'Add',
    askedIn: (value: number) => `in ${count(value, 'job', 'jobs')}`,
    askedField: {
      competence: 'Skill',
      tool: 'Tool',
      industry: 'Industry',
      language: 'Language',
      certificate: 'Certificate',
      degree: 'Degree',
    },
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
      permanent: 'A permanent job that does not fit here is excluded.',
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
      focusTrimmed: 'The first five focus areas are taken.',
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
      atLeast: (min: number) => `At least ${n(min)}.`,
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
      from: 'Date',
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
      copy: 'Copy prompt',
      copied: 'Copied',
      copyFailed: 'The prompt could not be copied.',
      preview: 'Show prompt',
      step: 'Paste it into the AI chat and attach your CV',
      answer: 'Paste the AI’s answer',
      fromClipboard: 'Paste from clipboard',
      take: 'Apply',
      takeEmpty: 'Paste the AI’s answer first.',
      summary: (adds: AnswerAdds, update: boolean): string => {
        const parts = (
          [
            [adds.competences, 'skill', 'skills'],
            [adds.tools, 'tool', 'tools'],
            [adds.certificates, 'certificate', 'certificates'],
            [adds.languages, 'language', 'languages'],
            [adds.industries, 'industry', 'industries'],
            [adds.degrees, 'degree', 'degrees'],
            [adds.other, 'other detail', 'other details'],
          ] as const
        )
          .filter(([value]) => value > 0)
          .map(([value, one, many]) => count(value, one, many));
        if (parts.length === 0) return 'The answer adds nothing.';
        return `${update ? 'Adds' : 'The profile gets'} ${joined(parts)}.`;
      },
    },
  },
  settings: {
    mailbox: 'Mailbox',
    portals: 'Portals',
    export: 'Export',
    look: 'Appearance',
    data: 'Data',
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
    changeHeading: 'Change mailbox',
    removeMailbox: 'Remove mailbox?',
    removeMailboxText: 'The app password will be deleted, but your jobs stay.',
    quota: (used: number, cap: number) => `Today ${n(used)} of ${n(cap)} calls`,
    signIn: 'Sign in',
    signOut: 'Sign out',
    openPortal: 'Open in browser',
    signInWaiting: 'The sign-in window is open.',
    alertQuiet: (days: number) => `No alert email for ${n(days)} days.`,
    checkAlert: 'Check alert',
    folder: 'Export folder',
    excel: 'Excel file',
    csv: 'CSV file',
    excelOff: 'Turn on the Excel file.',
    csvOff: 'Turn on the CSV file.',
    folderMoved: 'The profile and the files are in the new folder.',
    folderFiles: 'The files are in the new folder.',
    folderOwnProfile: 'The app now uses the profile in this folder.',
    backup: 'Backup',
    backupHeading: 'Restore a backup',
    backupAction: 'Restore',
    backupNone: 'There is no backup yet.',
    backupKind: {
      daily: null,
      update: 'before an update',
      restore: 'before a restore',
    },
    backupText: 'The current state is backed up first.',
    backupRestored: 'Backup restored',
    backupUndone: 'The previous state is back.',
    reset: 'All data',
    resetAction: 'Reset',
    resetHeading: 'Reset everything?',
    resetText: 'The app deletes the following and then restarts.',
    resetItems: [
      'the jobs and the settings',
      'the backups',
      'the profiles',
      'the app password',
      'the sign-ins at the portals',
      'the app’s files in the export folder',
    ],
    resetDone: 'The app is reset.',
    resetPartly: (value: number) =>
      `The app is reset, but ${count(value, 'item', 'items')} could not be deleted.`,
    dryRun: 'Dry run, so no data is changed.',
    demo: 'Demo with sample data, without the mailbox or the portals.',
    palette: 'Theme',
    paletteName: {
      coast: 'CXact',
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
    mailboxDone: 'The alert emails of the portals must go to this address.',
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
    /** Closing the window while a fetch runs asks first; its button closes anyway. */
    closeHeading: 'Close anyway?',
    closeText: 'The fetch is still running.',
    closeAction: 'Close',
  },
  calendar: {
    open: 'Open calendar',
    previous: 'Previous month',
    next: 'Next month',
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    day: (day: number, month: string, year: number) => `${day} ${month} ${year}`,
  },
  toast: {
    rescored: 'Jobs scored again',
    prompt: 'Prompt copied',
    archived: 'Archived',
    unarchived: 'Moved to inbox',
    trashed: 'Deleted',
    restored: 'Restored',
    deleted: 'Deleted forever',
    included: 'Scored anyway',
    excluded: 'Excluded',
    trashEmptied: 'Trash emptied',
    runDone: (value: number, high = 0) =>
      value === 0
        ? 'No new jobs'
        : high === 0
          ? count(value, 'new job', 'new jobs')
          : `${count(value, 'new job', 'new jobs')}, ${n(high)} with a high match`,
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
