// German UI catalog - the one source of UI text; the screens read it through `t` (t.ts).
//
// Style rules (CLAUDE.md, checked by core/tests/ui_contract.rs): little text, plain and
// human. Buttons are one verb phrase without a period; notes are one short sentence with a
// period; headings and labels end without a colon; no dash or em dash as a separator, no
// "X: Y", no exclamation marks, no text twice. A sentence speaks to the user as "du", and an
// instruction in a sentence is a du imperative ("Verbinde erst ein Postfach."); a button
// stays an infinitive ("Postfach verbinden"). A control a sentence names stands in quotes
// („Anzeige laden“). Glossary (docs/PLAN.md, one word per thing): CXact (the app names
// itself, never "die App"), Job, Portal, Übereinstimmung (Hohe, Mittlere, Geringe),
// Jobdetails, Anforderungen (Erfüllt, Teilweise erfüllt, Nicht erfüllt, Unklar), Profil with
// its groups Wunschjob, Einsatz, Erfahrung, Kompetenzen, Sprachen and Ausschlüsse, Postfach,
// Alert-Mail, Jobs suchen (the button: the mails, then the portals' search; what it does is
// the Suche),
// Anzeige laden, Profil-Ordner, Ausgeschlossen, Trotzdem bewerten, Neu, Aktuell (the place of
// the active jobs, user 2026-10-01), Archiv (Zurückholen: back from there), Papierkorb,
// Löschen (into the Papierkorb; there Endgültig löschen and Wiederherstellen), Daten (the
// group of the app's data: the Profil-Ordner and the reset), Aufrufe (what a portal allows a
// day). A profile field has one name: the label of its form field (without the unit) in
// errors, reasons and the profile (Länder, Tools und Methoden, Wunschtagessatz,
// Mindesttagessatz, Mindestgehalt; `profileField` reads it from `profile.field`, so a new
// label is one edit).
//
// Every code of the generated types has exactly one text here: the tables are typed as
// `Record<Code, ...>`, so a new code without a text is a type error.

import type {
  BackupKind,
  Band,
  ErrorKind,
  InvalidInput,
  JobSort,
  PauseReason,
  Place,
  Portal,
  ProfileForm,
  TermField,
  Way,
  WorkMode,
  MailProvider,
} from '../ipc/types';
import type { ContractKey, CvFailure } from '../ipc/api';
import { formatEuro, formatMoment, formatMoney, formatNumber, formatPercent } from './format';

type Params = Record<string, string | number | boolean | null>;
type Text = string | ((params: Params) => string);

const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const n = (value: number): string => formatNumber(value);
/** German plural for a count. */
const count = (value: number, one: string, many: string): string =>
  `${n(value)} ${value === 1 ? one : many}`;

/** The portals by their brand name, everywhere: one name per portal (owner's rule of one
 *  name per thing, 2026-10-30). */
const BRAND = {
  linkedin: 'LinkedIn',
  freelance: 'freelance.de',
  freelancermap: 'freelancermap',
  hays: 'Hays',
  michaelpage: 'Michael Page',
  solcom: 'SOLCOM',
  gulp: 'GULP',
  amadeusfire: 'Amadeus Fire',
  interimx: 'interim-x',
  fratch: 'FRATCH',
} satisfies Record<Portal, string>;
const portalOf = (value: unknown): string =>
  typeof value === 'string' && value in BRAND ? BRAND[value as Portal] : str(value);

const INTERNAL = 'Ein interner Fehler ist aufgetreten.';

/** What holds the app (the backend's `activity`: a run by its kind, a sign-in, a file
 *  command, the mailbox check of Verbinden), for the busy error. Reading the whole mailbox
 *  is a fetch, and so is what the backend does not name. */
type Busy = 'fetch' | 'details' | 'rescore' | 'session' | 'files' | 'mailbox';
const BUSY: readonly Busy[] = ['details', 'rescore', 'session', 'files', 'mailbox'];
const busyOf = (value: unknown): Busy => BUSY.find((name) => name === value) ?? 'fetch';

const busy: Record<Busy, string> = {
  fetch: 'Gerade läuft schon eine Suche.',
  details: 'Gerade werden schon Anzeigen geladen.',
  rescore: 'Die Jobs werden gerade neu bewertet.',
  session: 'Gerade läuft eine Anmeldung.',
  files: 'CXact schreibt gerade seine Dateien.',
  mailbox: 'Gerade wird das Postfach geprüft.',
};

/** The CV could not be evaluated: a file that does not read. */
const CV_UNREADABLE = 'Die Datei lässt sich nicht lesen.';

/** Why "Aus Lebenslauf ausfüllen" filled nothing, one sentence each (the Profil, the setup's
 *  upload; the error `cv` by its `reason`). */
const cvError: Record<CvFailure, string> = {
  limit: 'Heute ist keine Auswertung mehr möglich.',
  paused: 'Die Auswertung ist pausiert.',
  timeout: 'Die Auswertung hat zu lange gedauert.',
  offline: 'Keine Verbindung zum Internet.',
  outdated: 'Die Auswertung braucht eine neuere Version von CXact.',
  unreadable: CV_UNREADABLE,
  tooLarge: 'Die Datei ist zu groß.',
  unsupported: 'Dieses Format wird nicht unterstützt.',
  refused: CV_UNREADABLE,
  unavailable: 'Die Auswertung antwortet gerade nicht.',
};

const errors: Record<ErrorKind | 'unknown', Text> = {
  db: 'Die Datenbank meldet einen Fehler.',
  fileLocked: 'Eine Datei ist gerade in einem anderen Programm geöffnet.',
  io: 'Eine Datei ließ sich nicht lesen oder schreiben.',
  corrupt: (p) =>
    p.what === 'backup' ? 'Die Sicherung ist beschädigt.' : 'Die Daten von CXact sind beschädigt.',
  invalid: 'Die Eingabe passt nicht.',
  busy: (p) => busy[busyOf(p.activity)],
  // By what was looked for (`what`): a file or folder may never have been written (a new
  // result folder), a job or a mail is gone.
  notFound: (p) =>
    p.what === 'file'
      ? 'Die Datei ist nicht vorhanden.'
      : p.what === 'folder'
        ? 'Der Ordner ist nicht vorhanden.'
        : p.what === 'backup'
          ? 'Die Sicherung gibt es nicht mehr.'
          : 'Das gibt es nicht mehr.',
  dryRun: 'Im Probelauf geht das nicht.',
  mailMissing: 'Es ist kein Postfach verbunden.',
  mailConnect: 'Das Postfach ist nicht erreichbar.',
  /** GMX and WEB.DE refuse a sign-in until IMAP is allowed in their web mailer. */
  mailAuth: (p) =>
    p.allowImap === true
      ? 'Anmeldung abgelehnt. Erlaube den IMAP-Abruf in deinem Postfach.'
      : 'Das Postfach lehnt Adresse oder Passwort ab.',
  mailTimeout: 'Das Postfach antwortet nicht.',
  mailLost: 'Die Verbindung zum Postfach ist abgebrochen.',
  mailNotGmail: 'Das ist kein Gmail-Postfach.',
  mailServer: 'Das Postfach meldet einen Fehler.',
  mailCancelled: 'Abgebrochen.',
  offline: 'Keine Verbindung zum Internet.',
  secretStore: 'Der Passwortspeicher des Systems ist nicht erreichbar.',
  secretCorrupt: 'Das gespeicherte App-Passwort ist nicht lesbar.',
  portalUnavailable: (p) => `Keine Verbindung zu ${portalOf(p.portal)}.`,
  portalPaused: (p) => `${portalOf(p.portal)} pausiert gerade.`,
  portalQuota: (p) => `Das Limit für ${portalOf(p.portal)} ist erreicht.`,
  cv: (p) =>
    typeof p.reason === 'string' && p.reason in cvError ? cvError[p.reason as CvFailure] : INTERNAL,
  internal: INTERNAL,
  unknown: INTERNAL,
};

/** Fields of the profile form, named in an error or a warning about their value: the label
 *  of its field (`profile.field`), so each field has one name. */
const profileField = (): Record<string, string> => {
  const { field } = de.profile;
  return {
    roles: field.roles,
    project: field.contracts,
    permanent: field.contracts,
    temporary: field.contracts,
    dayRateWish: field.dayRateWish,
    dayRateMin: field.dayRateMin,
    minSalary: field.minSalary,
    workMode: field.workMode,
    countries: field.countries,
    regions: field.regions,
    available: field.available,
    workload: field.workload,
    minMonths: field.minMonths,
    competences: field.competences,
    tools: field.tools,
    years: field.totalYears,
    industries: field.industries,
    languages: field.languages,
    degrees: field.degrees,
    certificates: field.certificates,
    exclusionWords: field.exclusionWords,
  };
};
const fieldName = (value: unknown): string => profileField()[str(value)] ?? str(value);

const invalid: Record<InvalidInput['reason'], Text> = {
  noPortal: 'Mindestens ein Portal muss aktiv sein.',
  noSearchTerms: 'Für die Suche braucht CXact ein Profil.',
  profileNotUtf8: 'Die Datei ist keine Textdatei.',
  profileNotJson: (p) => `Die Datei ist beschädigt (Zeile ${str(p.line)}).`,
  profileNotObject: 'Die Datei enthält kein Profil.',
  profileValue: (p) => `Der Wert bei „${fieldName(p.field)}“ passt nicht.`,
  mailAddress: 'Die Adresse ist unvollständig.',
  appPassword: 'Ein App-Passwort hat 16 Buchstaben.',
  noSignIn: (p) => `Für ${portalOf(p.portal)} gibt es keine Anmeldung.`,
};

/** Why a portal pauses, as the first half of one sentence (`health.advice.paused`). */
const pause: Record<PauseReason, string> = {
  throttled: 'das Portal bremst die Aufrufe',
  blocked: 'das Portal blockiert die Aufrufe',
  layoutChanged: 'die Seiten sehen anders aus als erwartet',
  stateUnreadable: 'der Stand des Portals ist nicht lesbar',
  network: 'das Portal ist nicht erreichbar',
  challenged: 'das Portal verlangt eine Prüfung',
  robots: 'die robots.txt des Portals erlaubt die Suche nicht',
};

/** Opening the alert mail of a job in Gmail, the same words wherever it is offered. */
const OPEN_MAIL = 'Alert-Mail öffnen';

/** A profile file the app cannot read (the list and the Profil view). */
const PROFILE_UNREADABLE = 'Profil nicht lesbar';
/** No usable profile, no match: one wording for the ring, the filter and the list. */
const NO_PROFILE = 'Ohne Profil keine Übereinstimmung.';
/** The choice of the profile that wishes nothing. */
const ANY = 'Egal';
/** Two lists of the profile, each a group of its own named like its field. */
const COMPETENCES = 'Kompetenzen';
const LANGUAGES = 'Sprachen';
/** The units inside a number field of the profile. */
const NUMBER_UNIT = { day: '€ am Tag', year: '€ im Jahr', years: 'Jahre' };

const ANUE = 'Die Anzeige nennt Zeitarbeit.';
const LOW_TEXT = 'Die Anzeige nennt wenige klare Anforderungen.';
const SHORT_TEXT = 'Die Anzeige ist sehr kurz.';
const WORKLOAD = 'Die Auslastung passt nicht zu deinem Profil.';
const DURATION = 'Die Laufzeit liegt unter deiner Mindestlaufzeit.';

/** Years of experience, a range with both ends: "3 bis 5 Jahre", "10 Jahre". */
const yearsWords = (min: number, max: number | null): string =>
  max !== null && max > min
    ? `${n(min)} bis ${count(max, 'Jahr', 'Jahre')}`
    : count(min, 'Jahr', 'Jahre');

/** A duration in months or weeks, a range with both ends; `dative` inside a sentence ("von 9
 *  Wochen", "von 3 bis 6 Monaten"). */
function durationWords(
  value: number,
  from: number | null,
  unit: 'month' | 'week',
  dative: boolean,
): string {
  const [one, many] =
    unit === 'week' ? ['Woche', 'Wochen'] : ['Monat', dative ? 'Monaten' : 'Monate'];
  return from !== null && from < value
    ? `${n(from)} bis ${count(value, one, many)}`
    : count(value, one, many);
}

/** A junior level by the word the Jobdetails show for it (`facts.level`). */
const LEVEL: Record<string, string> = {
  internship: 'Praktikum',
  student: 'Werkstudent',
  trainee: 'Trainee',
  entry: 'Berufseinstieg',
  graduate: 'Absolventen',
  volunteer: 'Ehrenamt',
  junior: 'Junior',
  assistant: 'Assistenz',
  associate: 'Associate',
};

/** What an amount of pay is per (`facts.pay`). */
type Per = 'day' | 'hour' | 'year';
const PER: Record<Per, string> = { day: 'Tag', hour: 'Std.', year: 'Jahr' };

/** Days in a week: "3 Tage pro Woche", short "3 Tage/Woche". */
const weekDays = (days: number, short: boolean): string =>
  short ? `${count(days, 'Tag', 'Tage')}/Woche` : `${count(days, 'Tag', 'Tage')} pro Woche`;

/**
 * The workload of an ad (`workloadFrom`, `workloadTo`: percent of a five-day week) in words:
 * full-time, whole days as days ("3 Tage pro Woche", a range "3 bis 4 Tage pro Woche"), any
 * other share as a share ("50 %"), part-time without a number as such. `short` for a list row
 * ("3 Tage/Woche").
 */
function workloadWords(from: number | null, to: number, short: boolean): string {
  if (from === null) return to >= 100 ? 'Teilzeit möglich' : 'Teilzeit';
  const low = Math.min(from, to);
  const whole = (share: number): boolean => share > 0 && share % 20 === 0;
  if (low === to) {
    if (to >= 100) return 'Vollzeit';
    return whole(to) ? weekDays(to / 20, short) : formatPercent(to);
  }
  if (whole(low) && whole(to)) return `${n(low / 20)} bis ${weekDays(to / 20, short)}`;
  return `${n(low)} bis ${formatPercent(to)}`;
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
    return `Die Anzeige nennt ${ad}, du suchst höchstens ${weekDays(max, false)}.`;
  }
  return min === null
    ? WORKLOAD
    : `Die Anzeige nennt ${ad}, du suchst mindestens ${weekDays(min, false)}.`;
}

/** Contract type of an ad (`contractType` params `type`, `inferred`). */
const contract = {
  interim: 'Interim',
  permanent: 'Festanstellung',
  anue: 'Zeitarbeit',
  unclear: 'Vertragsart unklar',
} as const;
type ContractKind = keyof typeof contract;

function contractName(p: Params): string {
  const type = typeof p.type === 'string' && p.type in contract ? (p.type as ContractKind) : null;
  if (type === null) return contract.unclear;
  return p.inferred && type !== 'unclear' ? `Vermutlich ${contract[type]}` : contract[type];
}

/** The pay a rate reason names, as the subject of its sentence: a day rate (a range with both
 *  ends), or an hourly one with what it makes a day (`rate` per day, `amount` per hour,
 *  `from` the lower end of a range). */
function rateSubject(p: Params): string {
  // A range with both ends, in the unit the ad states it (`from`).
  const range = (to: Params[string] | undefined): string =>
    typeof p.from === 'number' && p.from < num(to)
      ? `${n(p.from)} bis ${formatEuro(to)}`
      : formatEuro(to);
  if (p.hourly === true && typeof p.amount === 'number') {
    return `Der Stundensatz von ${range(p.amount)} macht ${formatEuro(p.rate)} am Tag und`;
  }
  return `Der Tagessatz von ${range(p.rate)}`;
}

/** Wishes of the profile (`state` met, near, missed or unknown). */
function dayRateWish(p: Params): string {
  const wish = formatEuro(p.wish);
  switch (p.state) {
    case 'met':
      return `${rateSubject(p)} erreicht den Wunsch von ${wish}.`;
    case 'near':
      return `${rateSubject(p)} liegt knapp unter dem Wunsch von ${wish}.`;
    case 'missed':
      return `${rateSubject(p)} liegt unter dem Wunsch von ${wish}.`;
    default:
      return p.currency
        ? `Der Tagessatz ist in ${str(p.currency)} angegeben.`
        : 'Die Anzeige nennt keinen Tagessatz.';
  }
}

/** The remote wish of the profile (`level` of the profile editor) in the words of the
 *  profile's choice and the reader's work mode, inside a sentence. */
const REMOTE_LEVEL: Record<string, string> = {
  full: 'voll remote',
  mostly: 'überwiegend remote',
  partly: 'hybrid',
  onSite: 'vor Ort',
};

/** The ad's remote share in the words of the reader's work mode, next to the wish ("Der Job
 *  ist 60 % remote, gewünscht ist überwiegend remote"). */
function remoteWish(p: Params): string {
  if (p.state === 'unknown') return 'Die Anzeige nennt keinen Remote-Anteil.';
  const level = typeof p.level === 'string' ? REMOTE_LEVEL[p.level] : undefined;
  const wished = level ? `, gewünscht ist ${level}` : '';
  let ad: string;
  if (p.share === 0) ad = 'Der Job ist vor Ort';
  else if (p.share === 100) ad = 'Der Job ist voll remote';
  else if (typeof p.share === 'number') ad = `Der Job ist ${formatPercent(p.share)} remote`;
  else if (typeof p.from === 'number' && typeof p.to === 'number')
    ad = `Der Job ist ${n(num(p.from))} bis ${formatPercent(p.to)} remote`;
  else ad = 'Der Job ist hybrid';
  return `${ad}${wished}.`;
}

function regionWish(p: Params): string {
  switch (p.state) {
    case 'met':
      return p.remote === true
        ? 'Der Job ist voll remote, die Region spielt keine Rolle.'
        : `${str(p.location)} liegt in einer Wunschregion.`;
    case 'near':
      return `${str(p.location)} liegt außerhalb der Wunschregionen, der Job ist überwiegend remote.`;
    case 'missed':
      return `${str(p.location)} liegt außerhalb der Wunschregionen.`;
    default:
      return 'Ob der Einsatzort in einer Wunschregion liegt, steht nicht fest.';
  }
}

/**
 * Reason codes of the matching engine (`Reason.code`, core/src/matching/types.rs). One entry
 * per code: a new engine code needs exactly one line here. `requirement` and `term` show the
 * ad's own words (the label).
 */
const reasonCode = {
  requirement: '',
  term: '',
  anue: ANUE,
  anueRisk: 'Ein Personaldienstleister ohne Angaben zum Vertrag, Zeitarbeit ist möglich.',
  dayRate: (p) => `${rateSubject(p)} liegt unter ${formatEuro(p.min)}.`,
  availability: 'Die Verfügbarkeit passt nicht.',
  country: (p): string =>
    p.allowed
      ? `Der Einsatzort liegt außerhalb von ${countryNames(p.allowed)}.`
      : 'Der Einsatzort passt nicht.',
  anueOptional: 'Zeitarbeit ist möglich, aber nicht Pflicht.',
  anueHidden: 'Die Anzeige deutet auf Zeitarbeit hin.',
  countryUnclear: 'Der Einsatzort ist unklar.',
  dayRateCurrency: (p) => `Der Satz ist in ${str(p.currency)} angegeben.`,
  availabilityGap: (p) =>
    `Der Start liegt ${count(num(p.days), 'Tag', 'Tage')} vor der Verfügbarkeit.`,
  startVague: 'Der Starttermin ist unklar.',
  permanent: (p) => {
    if (p.excluded !== true) return 'Das klingt nach einer Festanstellung.';
    return p.stated === true
      ? 'Der Job ist eine Festanstellung, die in deinem Profil nicht gewählt ist.'
      : 'Das klingt nach einer Festanstellung, die in deinem Profil nicht gewählt ist.';
  },
  project: (p) =>
    p.stated === true
      ? 'Der Job ist ein Projekt, das in deinem Profil nicht gewählt ist.'
      : 'Das klingt nach einem Projekt, das in deinem Profil nicht gewählt ist.',
  permanentRegion: (p) => {
    const place = p.location
      ? `${str(p.location)} liegt außerhalb deiner Orte für Festanstellung`
      : 'Der Ort liegt außerhalb deiner Orte für Festanstellung';
    // The remote share decides too where the profile sets a minimum for it.
    if (typeof p.remoteMin !== 'number') return `${place}.`;
    return typeof p.remote === 'number'
      ? `${place}, und ${formatPercent(p.remote)} remote liegt unter deinem Minimum von ${formatPercent(p.remoteMin)}.`
      : `${place}, und die Anzeige nennt keine ${formatPercent(p.remoteMin)} remote.`;
  },
  permanentRegionUnclear: (p) =>
    p.location
      ? `Ob ${str(p.location)} zu den Orten für Festanstellung gehört, ist unklar.`
      : 'Der Arbeitsort der Festanstellung ist unklar.',
  salary: (p) => {
    // A salary in another currency is not compared with a minimum in euros.
    if (typeof p.currency === 'string' && p.currency !== 'EUR') {
      return `Das Gehalt ist in ${str(p.currency)} angegeben.`;
    }
    if (typeof p.salary !== 'number' || p.min === undefined) {
      return 'Das Gehalt liegt unter deinem Mindestgehalt.';
    }
    const amount =
      typeof p.from === 'number' && p.from < p.salary
        ? `von ${n(p.from)} bis ${formatEuro(p.salary)}`
        : p.lowerBound
          ? `ab ${formatEuro(p.salary)}`
          : `von ${formatEuro(p.salary)}`;
    const bonus = typeof p.bonus === 'number' ? ` plus ${formatPercent(p.bonus)} Bonus` : '';
    return `Das Jahresgehalt ${amount}${bonus} liegt unter ${formatEuro(p.min)}.`;
  },
  salaryUnknown: 'Die Anzeige nennt kein Gehalt.',
  seniorityUnclear: 'Ob der Job zu deinen Jahren Erfahrung passt, ist unklar.',
  overqualified: (p) => {
    const have = typeof p.have === 'number' ? count(p.have, 'Jahr', 'Jahren') : null;
    if (typeof p.years === 'number') {
      const asked = yearsWords(p.years, typeof p.max === 'number' ? p.max : null);
      return have === null
        ? `Der Job verlangt ${asked} Erfahrung, du bist überqualifiziert.`
        : `Der Job verlangt ${asked} Erfahrung, mit ${have} bist du überqualifiziert.`;
    }
    return have === null
      ? 'Der Job ist eine Einstiegsrolle, du bist überqualifiziert.'
      : `Der Job ist eine Einstiegsrolle, mit ${have} Erfahrung bist du überqualifiziert.`;
  },
  contractType: (p) => contractName(p),
  formalOpen: (p) => {
    if (p.class === undefined || p.class === null) return 'Das Profil nennt keinen Abschluss.';
    const what =
      p.class === 'licence'
        ? 'eine Zulassung, die das Profil nicht nennt'
        : 'einen Abschluss, den das Profil nicht nennt';
    return p.mandatory ? `Die Anzeige verlangt ${what}.` : `Die Anzeige wünscht ${what}.`;
  },
  lowEvidence: LOW_TEXT,
  shortText: SHORT_TEXT,
  focus: (p) =>
    num(p.met) > 0 || p.inTitle === true
      ? `Gefragt ist der Schwerpunkt ${str(p.focus)}.`
      : `Die Anzeige streift den Schwerpunkt ${str(p.focus)}.`,
  targetRole: (p) =>
    p.fit === 'half'
      ? `Der Titel kommt der Wunschrolle ${str(p.role)} nahe.`
      : `Der Titel passt zur Wunschrolle ${str(p.role)}.`,
  dayRateWish,
  remoteWish,
  regionWish,
  workload: workloadCheck,
  duration: (p) => {
    const length =
      typeof p.weeks === 'number'
        ? durationWords(p.weeks, typeof p.from === 'number' ? p.from : null, 'week', true)
        : typeof p.months === 'number'
          ? durationWords(p.months, typeof p.from === 'number' ? p.from : null, 'month', true)
          : null;
    return length !== null && typeof p.min === 'number'
      ? `Die Laufzeit von ${length} liegt unter deiner Mindestlaufzeit von ${count(p.min, 'Monat', 'Monaten')}.`
      : DURATION;
  },
  exclusionWord: (p) => `„${str(p.word)}“ ist eines deiner Ausschlusswörter.`,
} satisfies Record<string, Text>;
export type ReasonCode = keyof typeof reasonCode;

/**
 * Hard criteria of the profile (`MatchDetail.criteria[].code`, `ProfileUnderstanding.
 * criteria[].code`): why a job is excluded by each, from the profile's side (the reader's
 * head; the row the criterion judges says what the ad states). One entry per criterion: a new
 * criterion needs exactly one entry here.
 */
const criteria = {
  minDayRate: 'Der Tagessatz liegt unter deinem Mindesttagessatz.',
  countries: 'Der Einsatzort liegt nicht in deinen Ländern.',
  noAnue: 'Zeitarbeit ist in deinem Profil nicht gewählt.',
  noPermanent: 'Festanstellung ist in deinem Profil nicht gewählt.',
  noProject: 'Projekt und Interim ist in deinem Profil nicht gewählt.',
  availability: 'Der Start liegt vor deiner Verfügbarkeit.',
  minSalary: 'Das Gehalt liegt unter deinem Mindestgehalt.',
  permanentRegion: 'Der Ort liegt nicht in deinen Orten für Festanstellung.',
  // The workload and the duration are checks, never an exclusion (engine 16).
  workload: WORKLOAD,
  duration: DURATION,
  exclusionWords: 'Die Anzeige nennt eines deiner Ausschlusswörter.',
} satisfies Record<string, string>;
export type CriterionKey = keyof typeof criteria;

/** How a row of the reader's Jobdetails fits the profile (features/jobs/terms.ts): met, met in
 *  part (a wish or a limit missed, never an exclusion), not met, unclear in the ad (check),
 *  nothing to judge (no icon). */
export type TermVerdict = 'met' | 'partial' | 'violated' | 'unknown' | 'unset';

/** `JobMatch.note` / `MatchDetail.summary` codes. */
const note = {
  hardCriterion: 'Ein Ausschlusskriterium greift.',
  shortText: 'Zu wenig Text für eine Bewertung.',
  lowEvidence: LOW_TEXT,
  engineFailed: 'Diese Anzeige ließ sich nicht bewerten.',
} satisfies Record<string, Text>;
export type MatchNote = keyof typeof note;

/** The keys of the profile file the app speaks about (Profil-JSON v19, an external
 *  contract), each by the field it belongs to, which every catalog names by the label of its
 *  form field (`fieldName`). */
const PROFILE_KEY_FIELD: Readonly<Record<string, string>> = {
  wunschrollen: 'roles',
  vertragsarten: 'contracts',
  tagessatz_wunsch: 'dayRateWish',
  tagessatz_min: 'dayRateMin',
  mindestgehalt: 'minSalary',
  arbeitsmodell: 'workMode',
  laender: 'countries',
  regionen: 'regions',
  verfuegbar_ab: 'available',
  auslastung: 'workload',
  mindestlaufzeit_monate: 'minMonths',
  kernkompetenzen: 'competences',
  methoden_tools: 'tools',
  berufserfahrung_jahre: 'years',
  branchen: 'industries',
  sprachen: 'languages',
  abschluesse: 'degrees',
  zertifizierungen: 'certificates',
  ausschlusswoerter: 'exclusionWords',
};
const keyLabel = (key: string): string =>
  key in PROFILE_KEY_FIELD ? fieldName(PROFILE_KEY_FIELD[key]) : key;
/** Keys the engine does not read, as written in the file (so they can be found there). */
const rawKeys = (value: unknown): string[] =>
  str(value)
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '')
    .map((key) => `„${key}“`);
const joined = (items: string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items.at(-1)}`;
/** ISO codes as the engine sends them (`DE, AT`) in words: "Deutschland und Österreich". */
const countryNames = (value: unknown): string =>
  joined(
    str(value)
      .split(',')
      .map((code) => code.trim())
      .filter((code) => code !== '')
      .map((code) => de.profile.country[code.toUpperCase()] ?? code),
  );

/** Profile warnings of the engine (`ProfileWarningCode`, core/src/matching/types.rs). */
const warning = {
  noCompetences: 'Das Profil nennt keine Kompetenzen.',
  fewCompetences: 'Das Profil nennt nur wenige Kompetenzen.',
  noCriteria: 'Das Profil setzt keine Bedingungen.',
  availabilityNotUnderstood: '„Verfügbar“ ist nicht lesbar.',
  // Keys of a criteria section the engine does not read (a typo, an unknown rule).
  ignoredKeys: (p) => `CXact liest ${joined(rawKeys(p.keys))} in den Bedingungen nicht.`,
  criterionNotUnderstood: (p) => `„${keyLabel(str(p.key))}“ ist nicht lesbar.`,
  regionWithoutPlaces: 'Der Mindest-Remote-Anteil wirkt nur zusammen mit Orten.',
  focusTrimmed: (p) => `Nur die ersten ${n(num(p.max))} Schwerpunkte zählen.`,
} satisfies Record<string, Text>;

export const de = {
  nav: {
    label: 'Bereiche',
    jobs: 'Jobs',
    profile: 'Profil',
    settings: 'Einstellungen',
    /** The buttons of the top bar: back and forward through what was shown, the sidebar and
     *  the job view on and off (their tooltips). */
    back: 'Zurück',
    forward: 'Vor',
    sidebarHide: 'Seitenleiste ausblenden',
    sidebarShow: 'Seitenleiste einblenden',
    readerHide: 'Jobansicht ausblenden',
    readerShow: 'Jobansicht einblenden',
    /** The handle between the sidebar and the view (accessible name). */
    sidebarWidth: 'Breite der Seitenleiste',
  },
  /** The caption buttons of the Windows top bar, in the words of Windows. */
  window: {
    minimize: 'Minimieren',
    maximize: 'Maximieren',
    restore: 'Verkleinern',
    close: 'Schließen',
  },
  common: {
    loading: 'Wird geladen',
    cancel: 'Abbrechen',
    remove: 'Entfernen',
    edit: 'Ändern',
    open: 'Öffnen',
    back: 'Zurück',
    retry: 'Erneut versuchen',
    undo: 'Rückgängig',
    openFolder: 'Ordner öffnen',
    /** The accessible name of an info symbol beside a label. */
    infoAbout: (label: string) => `Mehr zu ${label}`,
  },
  portal: BRAND,
  chips: {
    remove: (value: string) => `${value} entfernen`,
  },
  splitter: {
    label: 'Breite der Liste',
  },
  /** Where a job is, like a mail: the inbox ("Jobs" in the sidebar), the archive, the trash. */
  place: {
    /** The tabs above the job list (their accessible name, and each place). */
    inbox: 'Aktuell',
    archive: 'Archiv',
    trash: 'Papierkorb',
    /** The field's placeholder names what it searches. */
    search: {
      inbox: 'Aktuell durchsuchen',
      archive: 'Archiv durchsuchen',
      trash: 'Papierkorb durchsuchen',
    } satisfies Record<Place, string>,
  },
  /** What a job can do where it is: one name and icon in its menu (a right click on its row)
   *  and in the reader. */
  actions: {
    /** What shows the job. */
    mail: OPEN_MAIL,
    openAd: 'Anzeige öffnen',
    prompt: 'Prompt für KI-Bewertung',
    /** An excluded job counts with its real match anyway, or is excluded again. */
    include: 'Trotzdem bewerten',
    archive: 'Archivieren',
    /** Back into Aktuell from the Archiv (Wiederherstellen is the Papierkorb's). */
    unarchive: 'Nach Aktuell verschieben',
    trash: 'In den Papierkorb legen',
    restore: 'Wiederherstellen',
    /** Its dialog: reader.purgeHeading, purgeText, purgeConfirm (one for the row and the
     *  job view). */
    purge: 'Endgültig löschen',
  },
  /** The app's own menus (their accessible names). */
  menu: {
    job: 'Job',
  },
  /** The native context menu of fields and selected text (the OS's words). */
  edit: {
    /** The accessible name of a field's menu. */
    menu: 'Bearbeiten',
    undo: 'Rückgängig',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einfügen',
    delete: 'Löschen',
    selectAll: 'Alles auswählen',
  },
  field: {
    reveal: 'Passwort zeigen',
    conceal: 'Passwort verbergen',
    clear: 'Suche leeren',
  },
  score: {
    /** The name of a scored ring: its band and its number ("Hohe Übereinstimmung, 87 %"; the
     *  number comes formatted from format.ts). */
    value: (band: string, percent: string) => `${band}, ${percent}`,
    excluded: 'Ausgeschlossen',
    /** Every ring without a score is one state and one name: not scored yet, being scored,
     *  not scorable. */
    none: 'Nicht bewertet',
    /** A ring without a usable profile. */
    off: NO_PROFILE,
    /** The tooltip of a scored ring: what the match is. */
    info: 'Wie gut die Anforderungen der Anzeige zu deinem Profil passen.',
    band: {
      high: 'Hohe Übereinstimmung',
      mid: 'Mittlere Übereinstimmung',
      low: 'Geringe Übereinstimmung',
    } satisfies Record<Band, string>,
  },
  reason: {
    /** The quiet word after an unmet requirement that is only nice to have. */
    optional: 'optional',
    code: reasonCode,
  },
  job: {
    unread: 'Neu',
    untitled: 'Job ohne Titel',
    /** An ad that takes no applications any more (the end of its row's first line). */
    closed: 'Beendet',
  },
  toolbar: {
    /** The one fetch: the alert mails (with a mailbox), then the portals' search. */
    searchNow: 'Jobs suchen',
    cancel: 'Abbrechen',
    progress: 'Fortschritt der Suche',
    /** The first group of the funnel's menu: the order of the list. */
    sortHeading: 'Sortierung',
    /** The order of the list in words (the funnel's menu). */
    sortLabel: {
      match: 'Nach Übereinstimmung',
      newest: 'Nach Datum',
      rate: 'Nach Tagessatz',
    } satisfies Record<JobSort, string>,
    /** The order without a usable profile: there is no fit to sort by. */
    sortNoProfile: 'Ohne Profil nur nach Datum.',
    /** The funnel (its tooltip and the name of its menu): the order and the filter of the
     *  list (lib/state/filter.ts), its groups under small headings. */
    filter: 'Sortieren und filtern',
    /** The chosen parts of the filter as chips under the toolbar (their group's name). */
    chips: 'Filter',
    portalHeading: 'Portal',
    bandHeading: 'Übereinstimmung',
    /** The bands under their heading; as a chip, where the heading is not beside it, each
     *  says the ring's name of its band (`score.band`). */
    band: {
      high: 'Hoch',
      mid: 'Mittel',
      low: 'Gering',
    } satisfies Record<Band, string>,
    /** Without a usable profile there is no match to filter by. */
    bandNoProfile: NO_PROFILE,
    /** The day a job came into CXact (its first sighting), and the chips of the choices. */
    receivedHeading: 'Neu seit',
    received: {
      today: 'Heute',
      days7: '7 Tagen',
      days30: '30 Tagen',
    },
    receivedChip: {
      today: 'Neu seit heute',
      days7: 'Neu seit 7 Tagen',
      days30: 'Neu seit 30 Tagen',
    },
    /** The chip of a fetch's "Zeigen": only the new jobs of that fetch. */
    lastFetch: 'Aus der letzten Suche',
    filterReset: 'Filter zurücksetzen',
    /** Nothing to read: every portal is off (and no mailbox for the alert mails). */
    needsPortal: 'Schalte erst ein Portal ein.',
    /** The search has nothing to search for without a profile, or names what a profile
     *  still lacks (the fields' names as the Profil labels them). */
    needsProfile: 'Lege erst ein Profil an.',
    needsFields: (names: string[]) => `Ergänze erst ${joined(names)} im Profil.`,
  },
  run: {
    /** The strip under the list header while a run goes: its step in words (no portal
     *  named, they run side by side), how far it is at the right, and a run that waits for
     *  a sign-in with its button. */
    line: {
      mailbox: 'Postfach wird gelesen',
      portals: 'Portale werden durchsucht',
      ads: 'Anzeigen werden geladen',
      scoring: 'Jobs werden bewertet',
      rescore: 'Jobs werden neu bewertet',
      waiting: (portal: string) => `Wartet auf ${portal}`,
      count: (done: number, total: number) => `${n(done)} von ${n(total)}`,
      signIn: 'Anmelden',
    },
    /** A failed fetch's way to the mailbox's settings. */
    checkMailbox: 'Postfach prüfen',
  },
  list: {
    label: 'Jobs',
    /** The two folding sections at the end of every place, after the scored jobs (their
     *  counts after them): the jobs without a score yet, then the excluded ones. */
    unscored: 'Noch nicht bewertet',
    excluded: 'Ausgeschlossen',
    /** An empty place, its heading and one sentence: Aktuell before the first search,
     *  while it fills, after a search that found none that fits (nothing archived or
     *  deleted) and with its jobs all archived or deleted; the Archiv; the Papierkorb. */
    empty: {
      inbox: {
        heading: 'Noch keine Jobs',
        text: 'CXact durchsucht die Jobportale nach Jobs, die zu deinem Profil passen.',
      },
      running: { heading: 'Noch keine Jobs', text: 'Die Jobs erscheinen hier nach und nach.' },
      noMatch: {
        heading: 'Noch keine passenden Jobs',
        text: 'Prüfe dein Profil oder suche später noch einmal.',
      },
      noActive: {
        heading: 'Keine aktuellen Jobs',
        text: 'Neue Jobs kommen mit der nächsten Suche.',
      },
      archive: {
        heading: 'Keine archivierten Jobs',
        text: 'Hier landen Jobs, die du archivierst.',
      },
      trash: {
        heading: 'Der Papierkorb ist leer',
        text: 'Hier landen Jobs, die du in den Papierkorb legst.',
      },
    },
    /** A search or a filter that leaves nothing: an empty state's title and sentence. */
    noHit: (query: string) => `Kein Job passt zu „${query}“`,
    noHitText: 'Andere Wörter finden vielleicht mehr.',
    noHitFiltered: (query: string) => `Kein Job passt zu „${query}“ und zum Filter`,
    noHitFilteredText: 'Ohne den Filter findest du vielleicht mehr.',
    noFilterHit: 'Kein Job passt zum Filter',
    noFilterHitText: 'Hier liegen Jobs, aber keiner passt dazu.',
    loadFailed: 'Die Jobliste ließ sich nicht laden.',
    pageFailed: 'Weitere Jobs ließen sich nicht laden.',
    createProfile: 'Profil anlegen',
    openProfile: 'Profil öffnen',
    completeProfile: 'Profil ergänzen',
    /** No usable profile, a state box at the top of the list: none yet, one that does not
     *  read, one that lacks a required field. */
    noProfile: 'Noch kein Profil',
    noProfileText: NO_PROFILE,
    profileUnreadable: PROFILE_UNREADABLE,
    profileEmpty: 'Profil unvollständig',
    profileBrokenText: 'Die Jobs zeigen deshalb keine Übereinstimmung.',
    /** A profile the app understands little of. */
    thinProfile: 'Wenig Inhalt im Profil',
    thinProfileText: 'Die Übereinstimmung bleibt deshalb grob.',
  },
  /** The facts of a job in their one form each (the reader's Jobdetails, the list row; the
   *  order and the icons are the table of lib/facts.ts): a date "24.09.", a start "ab 01.11.",
   *  money "1.200 €/Tag" and "95.000 €/Jahr", a workload "3 Tage/Woche", the work mode "Voll
   *  remote", "60 % remote", "Hybrid" or "Vor Ort". */
  facts: {
    now: 'ab sofort',
    from: (date: string) => `ab ${date}`,
    /** A start or a rate to be agreed (the engine's `vague`: "nach Absprache", "flexibel",
     *  "zeitnah"). */
    agreed: 'nach Absprache',
    /** A duration: months or weeks, a range with both ends ("3 bis 6 Monate", "9 Wochen"). */
    duration: (value: number, from: number | null, unit: 'month' | 'week') =>
      durationWords(value, from, unit, false),
    /** The duration of a permanent job. */
    unlimited: 'unbefristet',
    /** The remote share the ad states (from and to, in percent). */
    remote: (from: number, to: number) => {
      if (from >= 100) return 'Voll remote';
      if (to <= 0) return 'Vor Ort';
      return from === to
        ? `${formatPercent(from)} remote`
        : `${n(from)} bis ${formatPercent(to)} remote`;
    },
    /** The work mode of an ad that states no share. */
    mode: {
      remote: 'Voll remote',
      hybrid: 'Hybrid',
      onsite: 'Vor Ort',
    } satisfies Record<WorkMode, string>,
    /** Pay per day, hour or year in its currency: `1.200 €/Tag`, `95 €/Std.`, `95.000 €/Jahr`,
     *  `1.000 CHF/Tag`; `lowerBound`: the ad names only its lower end ("ab 95.000 €/Jahr"). */
    pay: (amount: number, per: Per, currency: string | null, lowerBound = false) =>
      `${lowerBound ? 'ab ' : ''}${formatMoney(amount, currency)}/${PER[per]}`,
    /** A range of pay with both ends: "900 bis 1.200 €/Tag". */
    payRange: (from: number, to: number, per: Per, currency: string | null) =>
      `${n(from)} bis ${formatMoney(to, currency)}/${PER[per]}`,
    /** A salary with its bonus: "130.000 €/Jahr plus 20 % Bonus". */
    bonus: (pay: string, percent: number) => `${pay} plus ${formatPercent(percent)} Bonus`,
    /** The workload (percent of a five-day week): "Vollzeit", "3 Tage/Woche", "50 %". */
    workload: (from: number | null, to: number) => workloadWords(from, to, true),
    years: (min: number, max: number | null) => yearsWords(min, max),
    /** A junior level the ad names (`overqualified`, `seniorityUnclear` params `level`). */
    level: (code: string): string | null => LEVEL[code] ?? null,
  },
  reader: {
    /** A must requirement the profile lacks: its term goes into the field it belongs to. */
    addTo: {
      competence: (term: string) => `${term} zu den Kompetenzen hinzufügen`,
      tool: (term: string) => `${term} zu den Tools hinzufügen`,
      industry: (term: string) => `${term} zu den Branchen hinzufügen`,
      language: (term: string) => `${term} zu den Sprachen hinzufügen`,
      certificate: (term: string) => `${term} zu den Zertifikaten hinzufügen`,
      degree: (term: string) => `${term} zu den Abschlüssen hinzufügen`,
    } satisfies Record<TermField, (term: string) => string>,
    /** The name of the quiet tick that replaces the "+" once the term is in the profile. */
    added: 'Hinzugefügt',
    addedToProfile: (term: string) => `„${term}“ zum Profil hinzugefügt`,
    /** The table of the job's facts (features/jobs/terms.ts, in the order of lib/facts.ts). */
    details: 'Jobdetails',
    term: {
      company: 'Unternehmen',
      place: 'Ort',
      mode: 'Arbeitsmodell',
      contract: 'Vertragsart',
      rate: 'Tagessatz',
      start: 'Start',
      duration: 'Laufzeit',
      workload: 'Auslastung',
      experience: 'Erfahrung',
      deadline: 'Bewerben bis',
      contact: 'Kontakt',
      portal: 'Gefunden',
    },
    /** The pay row of a permanent job or temporary agency work (an annual salary). */
    salaryName: 'Gehalt',
    /** The pay row of an hourly rate. */
    hourlyName: 'Stundensatz',
    /** A value the ad does not state (the usual dash, user 2026-09-30). */
    missing: '–',
    /** The contract type in the row "Vertragsart". */
    contractKind: {
      interim: 'Interim',
      freelance: 'Projekt',
      permanent: 'Festanstellung',
      anue: 'Zeitarbeit',
      unclear: 'unklar',
    },
    /** Quiet after a value: required years no passage backs, a contract type the engine
     *  infers. */
    estimated: 'geschätzt',
    assumed: 'vermutet',
    /** How a row of the Jobdetails and a requirement fit the profile: the name of the
     *  verdict's icon, and the groups of the Anforderungen. */
    verdict: {
      met: 'Erfüllt',
      partial: 'Teilweise erfüllt',
      violated: 'Nicht erfüllt',
      unknown: 'Unklar',
    } satisfies Record<Exclude<TermVerdict, 'unset'>, string>,
    criterion: criteria,
    note,
    /** Where the job came from, in the row "Gefunden" of the Jobdetails: its portals
     *  ("freelancermap und LinkedIn"). */
    found: (portals: string[]) => joined(portals),
    close: 'Schließen',
    /** The clipboard refused the prompt. */
    promptNotCopied: 'Der Prompt ließ sich nicht kopieren.',
    mail: OPEN_MAIL,
    /** Loads the whole ad (a preview, a missing one). */
    fetchDetails: 'Anzeige laden',
    why: 'Anforderungen',
    /** Beside "Anforderungen": how many of them the profile meets. */
    metOf: (met: number, all: number) => `${n(met)} von ${n(all)} erfüllt`,
    noReasons: 'Die Anzeige nennt keine klaren Anforderungen.',
    ad: 'Anzeige',
    /** The band under the title of a job without a score (a job without a profile says
     *  score.none). */
    unscored: 'Noch nicht bewertet',
    unscorable: 'Nicht bewertbar',
    /** The state box under the job's title: its title and one sentence under it where that
     *  adds to the band under the title (never "nicht bewertet" again). */
    /** An ad still to come whose portal is off: why nothing loads it. */
    portalOff: (name: string) => `${name} ist ausgeschaltet.`,
    state: {
      missing: 'Die Anzeige ist noch nicht geladen.',
      loading: 'Die Anzeige wird geladen.',
      /** After "Trotzdem bewerten", until the job has its match. */
      scoring: 'Der Job wird bewertet.',
      teaser: {
        heading: 'Die Anzeige ist nur eine Vorschau.',
        text: 'Mit der ganzen Anzeige wird die Bewertung genauer.',
      },
      gone: {
        heading: 'Die Anzeige ist nicht mehr online.',
        text: 'Du siehst die zuletzt geladene Fassung.',
      },
      /** Gone before its text came. */
      goneEarly: 'Ihr Text wurde nicht mehr geladen.',
      unfetchable: {
        heading: 'Die Anzeige lässt sich nicht laden.',
        text: 'Das Portal gibt sie nicht heraus.',
      },
      closed: {
        heading: 'Die Anzeige ist beendet.',
        text: 'Bewerbungen sind nicht mehr möglich.',
      },
      short: { heading: SHORT_TEXT, text: 'Für eine Bewertung reicht sie nicht.' },
    },
    /** The job view while no job is open. */
    noJob: 'Kein Job gewählt',
    pickJob: 'Wähle einen Job aus der Liste.',
    loadFailed: 'Der Job ließ sich nicht laden.',
    /** Deleting a job of the Papierkorb for good, from its job view. */
    purgeHeading: 'Endgültig löschen?',
    purgeText: (name: string) => `„${name}“ kommt nicht wieder, auch nicht mit alten Alert-Mails.`,
    purgeConfirm: 'Löschen',
  },
  health: {
    /** A portal problem in one sentence that says whether to act (its row in the settings). */
    advice: {
      paused: (reason: PauseReason, iso: string | null) => {
        const why = pause[reason].charAt(0).toUpperCase() + pause[reason].slice(1);
        return iso
          ? `${why}, die Suche macht ab ${formatMoment(iso)} von selbst weiter.`
          : `${why}, die nächste Suche versucht es von selbst wieder.`;
      },
      quota: (iso: string) =>
        `Das Limit ist erreicht, die Suche macht ab ${formatMoment(iso)} von selbst weiter.`,
      pages: 'Die nächste Suche versucht es von selbst wieder.',
      login: 'Die Anmeldung ist abgelaufen, melde dich neu an.',
    },
  },
  profile: {
    /** The file does not read (edited by hand): the start page says so. */
    unreadable: PROFILE_UNREADABLE,
    noneText: 'Mit einem Profil zeigt jeder Job seine Übereinstimmung.',
    /** Under the error of a profile that no longer reads. */
    replaces: 'Ein neues Profil ersetzt die Datei.',
    /** The Profil's head: the CV fills the profile (the file dialog at once), and while it
     *  is evaluated what is going on in its place. */
    fromCv: 'Aus Lebenslauf ausfüllen',
    cvBusy: 'Wird von einer KI ausgewertet',
    /** A CV that filled nothing: the state box under the head (its sentence is `cvError`). */
    cvFailed: 'Der Lebenslauf wurde nicht ausgewertet.',
    /** The two ways to the profile as tiles (the setup, the Profil without a profile); the
     *  CV's says the AI. */
    wayCv: 'Aus Lebenslauf',
    wayCvNote: 'Eine KI füllt es aus, du prüfst es danach.',
    byHand: 'Selbst ausfüllen',
    byHandNote: 'Du trägst alles von Hand ein.',
    /** The toast once the CV filled the profile (saved at once; it adds, never overwrites). */
    filled: 'Profil ergänzt. Bitte prüfen.',
    /** Why the CV filled nothing; where a new try can work "Datei auswählen" stands beside
     *  it. */
    cvError,
    pickFile: 'Datei auswählen',
    /** The toast when a change of the profile moved jobs in Aktuell: the jobs now (or no
     *  longer) in the high band and the ones now (or no longer) excluded, only what changed. */
    savedEffect: (high: number, excluded: number) => {
      const jobs = (value: number): string => count(Math.abs(value), 'Job', 'Jobs');
      // After the high band a bare number; alone the excluded ones name the jobs.
      const out = (value: number): string => (high === 0 ? jobs(value) : n(Math.abs(value)));
      return [
        high > 0 ? `${jobs(high)} jetzt mit hoher Übereinstimmung` : null,
        high < 0 ? `${jobs(high)} nicht mehr mit hoher Übereinstimmung` : null,
        excluded > 0 ? `${out(excluded)} ausgeschlossen` : null,
        excluded < 0 ? `${out(excluded)} nicht mehr ausgeschlossen` : null,
      ]
        .filter((part) => part !== null)
        .join(', ');
    },
    warning,
    /** Leaving while a change cannot be saved (a change saves by itself otherwise). */
    discard: 'Verwerfen',
    leaveHeading: 'Änderung verwerfen?',
    leaveWrong: (label: string) => `„${label}“ stimmt noch nicht und wird nicht gespeichert.`,
    leaveFailed: 'Die letzte Änderung lässt sich gerade nicht speichern.',
    /** Why the CV waits while a value is wrong: the field by its label. */
    fixFirst: (label: string) => `Korrigiere erst „${label}“.`,
    /** The card under the head while required values are empty: how many, which, the way. */
    missing: {
      heading: (count: number) =>
        count === 1 ? 'Noch 1 Angabe für passende Jobs' : `Noch ${count} Angaben für passende Jobs`,
      fields: (labels: readonly string[]) =>
        labels.length < 2
          ? labels.join('')
          : `${labels.slice(0, -1).join(', ')} und ${labels.at(-1)}`,
      action: 'Ergänzen',
    },
    /** The groups of the page. */
    section: {
      job: 'Wunschjob',
      work: 'Einsatz',
      experience: 'Erfahrung',
      competences: COMPETENCES,
      languages: LANGUAGES,
      exclusions: 'Ausschlüsse',
    },
    field: {
      roles: 'Wunschrollen',
      rolesPlaceholder: 'Rolle hinzufügen',
      /** The contract types, a choice of several; one at least stays. */
      contracts: 'Vertragsart',
      keepOneContract: 'Mindestens eine Vertragsart bleibt gewählt.',
      /** The day rate's two fields. */
      dayRateWish: 'Wunschtagessatz',
      dayRateMin: 'Mindesttagessatz',
      minSalary: 'Mindestgehalt',
      /** An empty minimum salary: none is asked. */
      minSalaryPlaceholder: 'Keins',
      workMode: 'Arbeitsmodell',
      countries: 'Länder',
      countriesPlaceholder: 'Land hinzufügen',
      /** Typed text that names no country the app knows. */
      countryNone: 'Kein Land mit diesem Namen.',
      languageNone: 'Keine Sprache mit diesem Namen.',
      regions: 'Regionen',
      regionsPlaceholder: 'Region hinzufügen',
      available: 'Verfügbar',
      date: 'Datum',
      datePlaceholder: 'TT.MM.JJJJ',
      dateInvalid: 'Gib das Datum als TT.MM.JJJJ ein.',
      /** A day in the right format that the calendar does not have (31.02.2026). */
      dateImpossible: 'Diesen Tag gibt es nicht.',
      workload: 'Auslastung',
      minMonths: 'Mindestlaufzeit',
      competences: COMPETENCES,
      /** The button under the rows, and the name field of the row it brings. */
      competenceAdd: 'Kompetenz hinzufügen',
      competence: 'Kompetenz',
      /** The years of a competence, as a screen reader names the field. */
      yearsOf: (name: string) => `Jahre in ${name}`,
      tools: 'Tools und Methoden',
      toolsPlaceholder: 'Tool hinzufügen',
      totalYears: 'Berufserfahrung',
      industries: 'Branchen',
      industriesPlaceholder: 'Branche hinzufügen',
      languages: LANGUAGES,
      /** The button under the rows, and the name field of the row it brings. */
      languageAdd: 'Sprache hinzufügen',
      language: 'Sprache',
      /** The level of a language, as a screen reader names its select. */
      levelOf: (name: string) => `Niveau in ${name}`,
      /** The chips a folded chip field hides. */
      moreChips: (count: number) => `+ ${n(count)} weitere`,
      degrees: 'Abschlüsse',
      degreesPlaceholder: 'Abschluss hinzufügen',
      certificates: 'Zertifikate',
      certificatesPlaceholder: 'Zertifikat hinzufügen',
      exclusionWords: 'Ausschlusswörter',
      exclusionWordsPlaceholder: 'Wort hinzufügen',
      /** Quiet hint where two values contradict each other. */
      belowMinRate: 'Der Wunschtagessatz liegt unter dem Mindesttagessatz.',
      /** A euro amount with cents: the app counts whole euros. */
      rounded: 'Auf ganze Euro abgerundet.',
      /** Another number with a decimal part: the app counts whole ones. */
      roundedWhole: 'Auf eine ganze Zahl abgerundet.',
      /** A value the backend refused, said at its field: the limit where one is. */
      refused: 'Dieser Wert passt nicht.',
      atMost: (max: number) => `Höchstens ${n(max)}.`,
      /** A 0 where it would mean nothing (a day rate). */
      atLeast: (min: number) => `Mindestens ${n(min)}.`,
    },
    /** The info symbols beside a label, one sentence each (only these places, docs/PLAN.md). */
    info: {
      contracts: 'Was du nicht wählst, wird ausgeschlossen.',
      dayRate: 'Jobs darunter werden ausgeschlossen.',
      countries: 'Jobs in anderen Ländern werden ausgeschlossen, außer voll remote.',
      exclusionWords: 'Nennt eine Anzeige eines dieser Wörter, wird der Job ausgeschlossen.',
    },
    /** The unit at the right end inside a number field. */
    unit: NUMBER_UNIT,
    /** That unit as it reads after a value: one year is one. */
    unitOf: (unit: keyof typeof NUMBER_UNIT, value: number | null) =>
      unit === 'years' && value === 1 ? 'Jahr' : NUMBER_UNIT[unit],
    /** The contract types of Vertragsart. */
    contract: {
      project: 'Projekt und Interim',
      permanent: 'Festanstellung',
      temporary: 'Zeitarbeit',
    } satisfies Record<ContractKey, string>,
    workMode: {
      any: ANY,
      remote: 'Remote',
      hybrid: 'Hybrid',
      onsite: 'Vor Ort',
    } satisfies Record<ProfileForm['workMode'], string>,
    workload: {
      any: ANY,
      fulltime: 'Vollzeit',
      parttime: 'Teilzeit',
    } satisfies Record<ProfileForm['workload'], string>,
    minMonths: {
      0: ANY,
      3: '3 Monate',
      6: '6 Monate',
      12: '12 Monate',
    } satisfies Record<ProfileForm['minMonths'], string>,
    /** The levels of a language, the European ones as ads and CVs name them (design round 7,
     *  user 2026-10-10), stored as shown. */
    level: {
      A1: 'A1',
      A2: 'A2',
      B1: 'B1',
      B2: 'B2',
      C1: 'C1',
      C2: 'C2',
      native: 'Muttersprache',
    } satisfies Record<ProfileForm['languages'][number]['level'], string>,
    availability: {
      now: 'Sofort',
      from: 'Ab Datum',
    } satisfies Record<ProfileForm['available']['kind'], string>,
    /** Regions of Germany, Austria and Switzerland, suggested in Regionen (any other can be
     *  typed). */
    regionNames: [
      'Baden-Württemberg',
      'Bayern',
      'Berlin',
      'Brandenburg',
      'Bremen',
      'Hamburg',
      'Hessen',
      'Mecklenburg-Vorpommern',
      'Niedersachsen',
      'Nordrhein-Westfalen',
      'Rheinland-Pfalz',
      'Saarland',
      'Sachsen',
      'Sachsen-Anhalt',
      'Schleswig-Holstein',
      'Thüringen',
      'Rhein-Main',
      'Ruhrgebiet',
      'Düsseldorf',
      'Frankfurt am Main',
      'Hannover',
      'Köln',
      'Leipzig',
      'München',
      'Nürnberg',
      'Stuttgart',
      'Burgenland',
      'Kärnten',
      'Niederösterreich',
      'Oberösterreich',
      'Salzburg',
      'Steiermark',
      'Tirol',
      'Vorarlberg',
      'Wien',
      'Basel',
      'Bern',
      'Genf',
      'Lausanne',
      'Luzern',
      'St. Gallen',
      'Zug',
      'Zürich',
    ] as string[],
    /** Every country the engine can tell apart in a job ad (ISO codes of `laender`, the
     *  list of core `profile::country_codes`, checked by core/tests/countries.rs). */
    country: {
      AT: 'Österreich',
      BE: 'Belgien',
      CH: 'Schweiz',
      CZ: 'Tschechien',
      DE: 'Deutschland',
      DK: 'Dänemark',
      ES: 'Spanien',
      FI: 'Finnland',
      FR: 'Frankreich',
      GB: 'Großbritannien',
      HR: 'Kroatien',
      HU: 'Ungarn',
      IE: 'Irland',
      IN: 'Indien',
      IT: 'Italien',
      LU: 'Luxemburg',
      NL: 'Niederlande',
      NO: 'Norwegen',
      PL: 'Polen',
      PT: 'Portugal',
      RO: 'Rumänien',
      SE: 'Schweden',
      SI: 'Slowenien',
      SK: 'Slowakei',
      US: 'USA',
    } as Record<string, string>,
    /** The English names of the countries: the field finds a country by them too (the
     *  same keys as `country`). */
    countryEnglish: {
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
    } as Record<string, string>,
    /** Common languages, the choices of a language row (a language of the profile that is
     *  none of them stays as it is). */
    languageName: {
      ar: 'Arabisch',
      bg: 'Bulgarisch',
      zh: 'Chinesisch',
      da: 'Dänisch',
      de: 'Deutsch',
      en: 'Englisch',
      fi: 'Finnisch',
      fr: 'Französisch',
      el: 'Griechisch',
      hi: 'Hindi',
      it: 'Italienisch',
      ja: 'Japanisch',
      ko: 'Koreanisch',
      hr: 'Kroatisch',
      nl: 'Niederländisch',
      no: 'Norwegisch',
      pl: 'Polnisch',
      pt: 'Portugiesisch',
      ro: 'Rumänisch',
      ru: 'Russisch',
      sv: 'Schwedisch',
      sk: 'Slowakisch',
      sl: 'Slowenisch',
      es: 'Spanisch',
      cs: 'Tschechisch',
      tr: 'Türkisch',
      uk: 'Ukrainisch',
      hu: 'Ungarisch',
    },
  },
  settings: {
    /** The three groups of the page. */
    portals: 'Jobportale',
    mailbox: 'Postfach',
    data: 'Daten',
    /** How CXact uses a portal: the captions of the two boxes of Jobportale. */
    way: {
      search: 'Suche und Alert-Mails',
      alert: 'Nur Alert-Mails',
    } satisfies Record<Way, string>,
    /** A portal's state, its row's second line: a portal of alert mails without a mailbox
     *  needs one, how many alert mails of it came in the last 30 days, resting until a
     *  moment, what the last search brought. */
    needsMailbox: 'Braucht ein Postfach',
    /** Why the switch of a portal of alert mails waits without a mailbox. */
    needsMailboxReason: 'Verbinde erst ein Postfach.',
    alertMails: (value: number) =>
      value === 0
        ? 'Keine Alert-Mails in 30 Tagen'
        : `${count(value, 'Alert-Mail', 'Alert-Mails')} in 30 Tagen`,
    pausedUntil: (iso: string) => `Pausiert bis ${formatMoment(iso)}`,
    noSearchYet: 'Noch keine Suche',
    lastNew: (value: number) =>
      value === 0
        ? 'Zuletzt keine neuen Jobs'
        : `Zuletzt ${count(value, 'neuer Job', 'neue Jobs')}`,
    /** A portal's sign-in ran out, or its sign-in window waits for the user. */
    signInExpired: 'Anmeldung abgelaufen',
    signInWaiting: 'Wartet auf die Anmeldung',
    /** A portal's problem as the word of its line; its sentence is the quiet line under it.
     *  A portal that is on and sent no alert mail for a week or longer (its alert may have
     *  run out) says it in the word alone. */
    problem: {
      paused: 'Pausiert',
      /** Alert mails in which CXact found no jobs, next to the button that opens one. */
      emptyMails: (mails: number) =>
        `${mails === 1 ? 'In einer Alert-Mail' : `In ${n(mails)} Alert-Mails`} keine Jobs`,
      pages: 'Seiten verändert',
      quiet: (days: number) => `Seit ${n(days)} Tagen keine Alert-Mail`,
      failed: 'Fehlgeschlagen',
    },
    connected: 'Verbunden',
    /** The row of the mailbox while none is connected. */
    notConnected: 'Kein Postfach verbunden',
    notConnectedHint: 'Mit einem Postfach liest CXact auch deine Alert-Mails.',
    /** The last fetch could not reach the mailbox, or it refused the password. */
    unreachable: 'Postfach nicht erreichbar',
    refused: (appPassword: boolean) =>
      appPassword ? 'App-Passwort abgelehnt' : 'Passwort abgelehnt',
    /** The providers of a mailbox (design round 7), in their order, and the domain of the
     *  address field's example. */
    provider: {
      gmail: 'Gmail',
      icloud: 'iCloud',
      gmx: 'GMX',
      webde: 'WEB.DE',
    } satisfies Record<MailProvider, string>,
    providerLabel: 'Anbieter',
    address: 'E-Mail-Adresse',
    addressExample: (provider: MailProvider) =>
      `name@${{ gmail: 'gmail.com', icloud: 'icloud.com', gmx: 'gmx.de', webde: 'web.de' }[provider]}`,
    /** Gmail and iCloud sign in with an app password (16 letters), GMX and WEB.DE with the
     *  password. */
    password: 'App-Passwort',
    plainPassword: 'Passwort',
    passwordExample: '16 Buchstaben',
    /** The info symbol beside the app password, by its provider. */
    passwordInfo: {
      gmail:
        'Ein eigenes Passwort für CXact, das du mit Bestätigung in zwei Schritten in deinem Google-Konto erstellst.',
      icloud:
        'Ein eigenes Passwort für CXact, das du mit Zwei-Faktor-Authentifizierung in deinem Apple Account erstellst.',
    } satisfies Partial<Record<MailProvider, string>>,
    createPassword: 'App-Passwort erstellen',
    /** GMX and WEB.DE read alert mails only once IMAP is allowed in their web mailer. */
    allowImap: 'IMAP-Abruf erlauben',
    addressMissing: 'Die E-Mail-Adresse fehlt.',
    passwordMissing: (appPassword: boolean) =>
      appPassword ? 'Das App-Passwort fehlt.' : 'Das Passwort fehlt.',
    connect: 'Verbinden',
    removeMailbox: 'Postfach entfernen?',
    removeMailboxText: (appPassword: boolean) =>
      `Das ${appPassword ? 'App-Passwort' : 'Passwort'} wird gelöscht, die Jobs bleiben.`,
    signOut: 'Abmelden',
    /** A portal's sign-in window (also the job view's), and the folder dialog. */
    signIn: 'Anmelden',
    /** The way to the page of a portal whose alert went quiet. */
    checkAlert: 'Alert prüfen',
    /** A source of alert mails: its page where the user sets up an alert. */
    setUpAlert: 'Alert anlegen',
    /** The row of the profile's folder (its path under it), and what a change did. */
    folder: 'Profil-Ordner',
    folderMoved: 'Profil kopiert',
    folderFiles: 'Ordner geändert',
    folderOwnProfile: 'Profil aus dem neuen Ordner übernommen',
    /** The row of the reset in Daten: its label, its one sentence, its button (the dialog's
     *  too) and its dialog. */
    reset: 'Alles zurücksetzen',
    resetHint: 'Löscht alles, was CXact gespeichert hat.',
    resetAction: 'Zurücksetzen',
    resetHeading: 'Alles zurücksetzen?',
    resetText:
      'CXact löscht Jobs, Profil, Postfach und Anmeldungen und beginnt mit der Einrichtung.',
    dryRun: 'Probelauf, es werden keine Daten verändert.',
  },

  /** The portals by their brand name (Einstellungen > Jobportale; settings.spec checks that
   *  every portal has one). */

  /** The setup (features/first-run/steps.ts): each step's heading and lead, and its words. */
  firstRun: {
    /** Willkommen: what CXact does, one job as it shows it (its title; its band is the
     *  ring's) and what its number means. */
    welcome: 'Willkommen bei CXact',
    welcomeText:
      'CXact findet Projekt- und Interim-Jobs für dich und zeigt dir, wie gut jeder zu dir passt.',
    example: 'Interim CFO für Familienunternehmen',
    start: 'Loslegen',
    /** The two ways to the profile (NewProfileWays). */
    way: 'Profil anlegen',
    wayText: 'CXact vergleicht jeden Job mit deinem Profil. Wie möchtest du es anlegen?',
    /** The CV's upload: the drop zone, the formats it reads and who reads it. */
    upload: 'Lebenslauf hochladen',
    uploadText: 'CXact füllt dein Profil daraus aus. Du prüfst es danach.',
    drop: 'Datei hierher ziehen oder auswählen',
    formats: 'PDF, Word oder Foto',
    ai: 'Wird von einer KI ausgewertet.',
    reading: 'Lebenslauf wird ausgewertet',
    readingText: 'Gleich siehst du dein Profil.',
    /** The whole profile: as the CV filled it, or empty to fill in. */
    profile: 'Dein Profil',
    profileCv: 'Aus deinem Lebenslauf ausgefüllt. Prüfe es und ergänze, was nur du weißt.',
    profileSelf: 'Trag ein, was du suchst und was du mitbringst.',
    next: 'Weiter',
    /** The Postfach, optional: what it brings, the portals of alert mails by name (a word
     *  joiner after the hyphen: the balanced lead never tears the word there, and it stays
     *  the font's own hyphen, which a non-breaking one is not). */
    mailbox: 'Postfach verbinden',
    mailboxText: (portals: readonly Portal[]) =>
      `Dann liest CXact auch deine Alert-⁠Mails von ${joined(portals.map((p) => BRAND[p]))}.`,
    skip: 'Überspringen',
    connect: 'Verbinden',
    /** Fertig: everything with a mailbox, else the profile. */
    done: 'Alles eingerichtet',
    doneProfile: 'Profil eingerichtet',
    doneText: 'Mit „Jobs suchen“ findest du jederzeit neue Jobs.',
    toJobs: 'Zu den Jobs',
  },

  shell: {
    loadFailed: 'CXact konnte seine Daten nicht laden.',
    /** Closing while the app is busy: the window waits until what holds it has stopped. */
    closing: 'CXact schließt, sobald alles beendet ist.',
    /** Closing the window while a fetch runs asks first: close anyway, or keep searching. */
    closeHeading: 'Suche abbrechen und schließen?',
    closeAction: 'Schließen',
    keep: 'Weitersuchen',
    /** The database's copies (the failed start offers them). */
    backupHeading: 'Sicherung wiederherstellen',
    backupAction: 'Wiederherstellen',
    backupNone: 'Es gibt noch keine Sicherung.',
    /** After a copy's day and time: why it is there (the copy of a day says nothing). */
    backupKind: {
      daily: null,
      restore: 'vor dem Wiederherstellen',
    } satisfies Record<BackupKind, string | null>,
    backupText: 'Der jetzige Stand wird vorher gesichert.',
    backupRestored: 'Sicherung wiederhergestellt',
    /** Its undo brought the state before it back. */
    backupUndone: 'Rückgängig gemacht',
  },
  /** Short confirmations without a period (a participle like "Archiviert"); only a full
   *  sentence ends with one. */
  toast: {
    rescored: 'Jobs neu bewertet',
    /** The job as a prompt for any AI chat (no brand named). */
    prompt: 'Prompt kopiert',
    /** A job action: one short word, however many jobs it took, without their titles. */
    archived: 'Archiviert',
    unarchived: 'Nach Aktuell verschoben',
    trashed: 'In den Papierkorb gelegt',
    restored: 'Wiederhergestellt',
    /** Only a deletion for good says "endgültig". */
    deleted: 'Endgültig gelöscht',
    included: 'Trotzdem bewertet',
    /** At the end of a search: what it brought (new, not excluded), how many of them are in
     *  the high band, and without one that fits how many it excluded. */
    runDone: (value: number, high = 0, excluded = 0) =>
      value === 0
        ? excluded > 0
          ? `Keine neuen passenden Jobs, ${n(excluded)} ausgeschlossen`
          : 'Keine neuen passenden Jobs'
        : high === 0
          ? count(value, 'neuer Job', 'neue Jobs')
          : `${count(value, 'neuer Job', 'neue Jobs')}, ${n(high)} mit hoher Übereinstimmung`,
    /** The way from a toast to what it tells of (the finished fetch in the Jobs view). */
    show: 'Zeigen',
  },
  error: {
    text: (kind: ErrorKind | 'unknown', params: Params): string => {
      if (kind === 'invalid' && typeof params.reason === 'string' && params.reason in invalid) {
        return textOf(invalid[params.reason as InvalidInput['reason']], params);
      }
      return textOf(errors[kind], params);
    },
  },
} as const;

export function textOf(text: Text, params: Params = {}): string {
  return typeof text === 'function' ? text(params) : text;
}

/** The shape of this catalog with any words: the type of `t`. */
export type Catalog = Widen<typeof de>;

/** Words become `string`; keys, nesting, lists and function signatures stay. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Widen<T[K]> }
        : T;
