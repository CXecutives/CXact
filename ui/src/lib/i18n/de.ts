// German UI catalog - the source of UI text. en.ts says the same in English under the same
// keys (a missing or extra key there is a type error); the screens read the catalog of the
// app's language through `t` (t.ts).
//
// Style rules (CLAUDE.md, checked by core/tests/ui_contract.rs): little text, plain and
// human. Buttons are one verb phrase without a period; notes are one short sentence with a
// period; headings and labels end without a colon; no dash or em dash as a separator, no
// "X: Y", no exclamation marks, no text twice. A sentence speaks to the user as "du", and an
// instruction in a sentence is a du imperative ("Verbinde erst ein Postfach."); a button
// stays an infinitive ("Postfach verbinden"). A control a sentence names stands in quotes
// („Anzeige laden“). Glossary (docs/PLAN.md, one word per thing): Job, Portal, Übereinstimmung
// (Hohe, Mittlere, Geringe), Jobdetails, Anforderungen (Erfüllt, Teilweise erfüllt, Nicht
// erfüllt, Unklar), Profil, Postfach, Alert-Mail, Postfach abrufen (the button; what it does is
// the Abruf), Anzeige laden, Excel-Datei, CSV-Datei, Ergebnisordner, Ausgeschlossen, Trotzdem
// bewerten, Neu, Archiv (Dearchivieren: back into the Eingang), Papierkorb, Löschen (into the
// Papierkorb; there Endgültig löschen and Wiederherstellen), Daten (the card of the app's
// data: its backups, its log, the reset), Aufrufe (what a portal allows a day).
// "Bedingungen" only names the profile's section. A profile field has one name: the label of
// its form field (without the unit) in errors, warnings and the profile (`profileField` reads
// it from `profile.field`, so a new label is one edit).
//
// Every code of the generated types has exactly one text here: the tables are typed as
// `Record<Code, ...>`, so a new code without a text is a type error.

import type {
  BackupKind,
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
import { PORTAL_LABEL } from '../ipc/types/portals';
import { NBSP, formatEuro, formatMoment, formatMoney, formatNumber, formatPercent } from './format';

type Params = Record<string, string | number | boolean | null>;
type Text = string | ((params: Params) => string);

const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const n = (value: number): string => formatNumber(value);
/** German plural for a count. */
const count = (value: number, one: string, many: string): string =>
  `${n(value)} ${value === 1 ? one : many}`;

/** The portals by their web address, everywhere (a sentence never starts with one); the
 *  names come from the portal registry, no catalog translates them. */
const portalName = PORTAL_LABEL;
const portalOf = (value: unknown): string =>
  typeof value === 'string' && value in portalName ? portalName[value as Portal] : str(value);

const INTERNAL = 'Ein interner Fehler, mehr steht im Protokoll.';

/** What holds the app (the backend's `activity`: a run by its kind, a sign-in, a file
 *  command, the mailbox check of Verbinden), for the busy error and the closing note.
 *  Reading the whole mailbox is a fetch, and so is what the backend does not name. */
type Busy = 'fetch' | 'details' | 'rescore' | 'session' | 'files' | 'mailbox';
const BUSY: readonly Busy[] = ['details', 'rescore', 'session', 'files', 'mailbox'];
const busyOf = (value: unknown): Busy => BUSY.find((name) => name === value) ?? 'fetch';

const busy: Record<Busy, string> = {
  fetch: 'Gerade läuft schon ein Abruf.',
  details: 'Gerade werden schon Anzeigen geladen.',
  rescore: 'Die Jobs werden gerade neu bewertet.',
  session: 'Gerade läuft eine Anmeldung.',
  files: 'Die App schreibt gerade ihre Dateien.',
  mailbox: 'Gerade wird das Postfach geprüft.',
};

const closing: Record<Busy, string> = {
  fetch: 'Der Abruf wird beendet, dann schließt die App.',
  details: 'Das Laden der Anzeigen wird beendet, dann schließt die App.',
  rescore: 'Das Bewerten wird beendet, dann schließt die App.',
  session: 'Die Anmeldung wird beendet, dann schließt die App.',
  files: 'Die App schreibt ihre Dateien fertig, dann schließt sie.',
  mailbox: 'Die Prüfung des Postfachs wird beendet, dann schließt die App.',
};

const errors: Record<ErrorKind | 'unknown', Text> = {
  db: 'Die Datenbank meldet einen Fehler.',
  fileLocked: 'Eine Datei ist gerade in einem anderen Programm geöffnet.',
  io: 'Eine Datei ließ sich nicht lesen oder schreiben.',
  xlsx: 'Die Excel-Datei ließ sich nicht schreiben.',
  corrupt: (p) =>
    p.what === 'backup' ? 'Die Sicherung ist beschädigt.' : 'Die Daten der App sind beschädigt.',
  newerSchema: 'Die Daten stammen von einer neueren Version der App.',
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
  demo: 'In der Demo geht das nicht.',
  mailMissing: 'Es ist kein Postfach verbunden.',
  mailConnect: 'Gmail ist nicht erreichbar.',
  mailAuth: 'Gmail lehnt Adresse oder App-Passwort ab.',
  mailTimeout: 'Gmail antwortet nicht.',
  mailLost: 'Die Verbindung zu Gmail ist abgebrochen.',
  mailNotGmail: 'Das ist kein Gmail-Postfach.',
  mailServer: 'Gmail meldet einen Fehler.',
  mailCancelled: 'Abgebrochen.',
  secretStore: 'Der Passwortspeicher des Systems ist nicht erreichbar.',
  secretCorrupt: 'Das gespeicherte App-Passwort ist nicht lesbar.',
  portalUnavailable: (p) => `Keine Verbindung zu ${portalOf(p.portal)}.`,
  portalPaused: (p) => `${portalOf(p.portal)} pausiert gerade.`,
  portalQuota: (p) => `Das Limit für ${portalOf(p.portal)} ist erreicht.`,
  internal: INTERNAL,
  unknown: INTERNAL,
};

/** Fields of the profile form, named in an error or a warning about their value: the label
 *  of the field without its unit, read from the form's own words (`profile.field`, the
 *  sections for a list), so each field has one name. Only the contract types and the
 *  Schwerpunkte have no label of their own. */
const profileField = (): Record<string, string> => {
  const { field, section } = de.profile;
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
    contracts: 'Zeitarbeit und Festanstellung',
    remoteOutside: field.remoteOutside,
    available: field.available,
    // The two days of one field (von, bis).
    workloadMinDays: field.workload,
    workloadMaxDays: field.workload,
    minMonths: field.minMonths,
    exclusionWords: field.exclusionWords,
    targetYears: field.targetYears,
    minSalary: field.minSalary,
    permanentPlaces: field.places,
    permanentRemoteMin: field.remoteMin,
    focus: 'Schwerpunkte',
    roles: field.roles,
    wishDayRate: field.wishRate,
    remote: field.remote,
    regions: field.regions,
    wishIndustries: field.wishIndustries,
  };
};
const fieldName = (value: unknown): string => profileField()[str(value)] ?? str(value);

const invalid: Record<InvalidInput['reason'], Text> = {
  noPortal: 'Mindestens ein Portal muss aktiv sein.',
  profileNotUtf8: 'Die Datei ist keine Textdatei.',
  profileNotJson: (p) => `Die Datei ist beschädigt (Zeile ${str(p.line)}).`,
  profileNotObject: 'Die Datei enthält kein Profil.',
  profileValue: (p) => `Der Wert bei „${fieldName(p.field)}“ passt nicht.`,
  profileAnswer: 'In der Antwort steht kein Profil.',
  profileAnswerCut: 'Die Antwort bricht mitten im Profil ab.',
  mailAddress: 'Die Adresse ist unvollständig.',
  appPassword: 'Ein App-Passwort hat 16 Buchstaben.',
  noSignIn: (p) => `Für ${portalOf(p.portal)} gibt es keine Anmeldung.`,
};

/** Why a portal pauses, as the first half of one sentence (`health.advice.paused`). */
const pause: Record<PauseReason, string> = {
  throttled: 'das Portal bremst die Anfragen',
  blocked: 'das Portal blockiert die Anfragen',
  layoutChanged: 'die Seiten sehen anders aus als erwartet',
  stateUnreadable: 'der Stand des Portals ist nicht lesbar',
  network: 'das Portal ist nicht erreichbar',
  challenged: 'das Portal verlangt eine Prüfung',
};

/** Opening the alert mail of a job in Gmail, the same words wherever it is offered. */
const OPEN_MAIL = 'Alert-Mail öffnen';

/** Alert mails in which the app found no jobs (a portal's row in the settings says it, next
 *  to the button that opens the mail to look). */
const emptyMails = (mails: number): string =>
  `${mails === 1 ? 'In einer Alert-Mail' : `In ${n(mails)} Alert-Mails`} fand die App keine Jobs.`;

/** A profile file the app cannot read (the list and the Profil view). */
const PROFILE_UNREADABLE = 'Profil nicht lesbar';

const ANUE = 'Die Anzeige nennt Zeitarbeit.';
const LOW_TEXT = 'Die Anzeige nennt wenige klare Anforderungen.';
const SHORT_TEXT = 'Die Anzeige ist sehr kurz.';
const WORKLOAD = 'Die Auslastung passt nicht zum Profil.';
const DURATION = 'Die Laufzeit liegt unter dem Minimum im Profil.';

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
    return `Die Anzeige nennt ${ad}, das Profil sieht höchstens ${weekDays(max, false)} vor.`;
  }
  return min === null
    ? WORKLOAD
    : `Die Anzeige nennt ${ad}, das Profil sucht mindestens ${weekDays(min, false)}.`;
}

/** Contract type of an ad (`contractType` params `type`, `inferred`). */
const contract = {
  interim: 'Interim',
  permanent: 'Festanstellung',
  anue: 'Zeitarbeit',
  unclear: 'Vertragsart unklar',
} as const;
export type ContractKind = keyof typeof contract;

function contractName(p: Params): string {
  const type = typeof p.type === 'string' && p.type in contract ? (p.type as ContractKind) : null;
  if (type === null) return contract.unclear;
  return p.inferred && type !== 'unclear' ? `Vermutlich ${contract[type]}` : contract[type];
}

/** Wishes of the profile (`state` met, near, missed or unknown). */
function dayRateWish(p: Params): string {
  const rate = formatEuro(p.rate);
  const wish = formatEuro(p.wish);
  switch (p.state) {
    case 'met':
      return `Der Tagessatz von ${rate} erreicht den Wunsch von ${wish}.`;
    case 'near':
      return `Der Tagessatz von ${rate} liegt knapp unter dem Wunsch von ${wish}.`;
    case 'missed':
      return `Der Tagessatz von ${rate} liegt unter dem Wunsch von ${wish}.`;
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

function industryWish(p: Params): string {
  switch (p.state) {
    case 'met':
      return `Die Branche ${str(p.wish)} ist gewünscht.`;
    case 'missed':
      return `${str(p.industry)} gehört nicht zu den Wunschbranchen.`;
    default:
      return 'Die Anzeige nennt keine Branche.';
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
  dayRate: (p) => `Der Tagessatz von ${formatEuro(p.rate)} liegt unter ${formatEuro(p.min)}.`,
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
      ? 'Der Job ist eine Festanstellung, das Profil schließt sie aus.'
      : 'Das klingt nach einer Festanstellung, das Profil schließt sie aus.';
  },
  permanentRegion: (p) =>
    p.location
      ? `${str(p.location)} liegt außerhalb der Orte für Festanstellung.`
      : 'Der Ort liegt außerhalb der Orte für Festanstellung.',
  permanentRegionUnclear: (p) =>
    p.location
      ? `Ob ${str(p.location)} zu den Orten für Festanstellung gehört, ist unklar.`
      : 'Der Arbeitsort der Festanstellung ist unklar.',
  salary: (p) => {
    if (p.salary === undefined || p.salary === null || p.min === undefined) {
      return 'Das Gehalt liegt unter dem Minimum im Profil.';
    }
    const amount =
      typeof p.currency === 'string' && p.currency !== 'EUR'
        ? formatMoney(num(p.salary), p.currency)
        : formatEuro(p.salary);
    const from = p.lowerBound ? `ab ${amount}` : `von ${amount}`;
    return `Das Jahresgehalt ${from} liegt unter ${formatEuro(p.min)}.`;
  },
  salaryUnknown: 'Die Anzeige nennt kein Gehalt.',
  tooJunior: (p) =>
    p.years !== undefined && p.years !== null
      ? `Der Job verlangt ${count(num(p.years), 'Jahr', 'Jahre')} Erfahrung, das Profil zielt auf ${count(num(p.target), 'Jahr', 'Jahre')}.`
      : 'Der Job richtet sich an weniger Erfahrene.',
  seniorityUnclear: (p) =>
    p.junior
      ? 'Der Titel klingt nach einem Job für Einsteiger.'
      : 'Das gesuchte Erfahrungslevel ist unklar.',
  overqualified: (p) =>
    p.years !== undefined && p.years !== null
      ? `Gesucht ${num(p.years) === 1 ? 'ist' : 'sind'} ${count(num(p.years), 'Jahr', 'Jahre')} Erfahrung, das Profil bringt deutlich mehr mit.`
      : 'Das Profil ist deutlich erfahrener als gesucht.',
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
  industryWish,
  workload: workloadCheck,
  duration: (p) =>
    typeof p.months === 'number' && typeof p.min === 'number'
      ? `Die Laufzeit von ${count(p.months, 'Monat', 'Monaten')} liegt unter dem Minimum von ${count(p.min, 'Monat', 'Monaten')}.`
      : DURATION,
  exclusionWord: (p) => `„${str(p.word)}“ ist eines deiner Ausschlusswörter.`,
} satisfies Record<string, Text>;
export type ReasonCode = keyof typeof reasonCode;

interface CriterionText {
  /** Short name in the criteria strip of the reader. */
  label: string;
  /** Why a job is excluded by it, in the short words of a list row. */
  short: string;
  /** Why a job is excluded by it, from the profile's side (the reader's head; the row the
   *  criterion judges says what the ad states). */
  exclusion: string;
}

/**
 * Hard criteria of the profile (`MatchDetail.criteria[].code`, `ProfileUnderstanding.
 * criteria[].code`). One entry per criterion: a new criterion needs exactly one entry here.
 */
const criteria = {
  minDayRate: {
    label: 'Tagessatz',
    short: 'Tagessatz zu niedrig',
    exclusion: 'Der Tagessatz liegt unter deinem Minimum.',
  },
  countries: {
    label: 'Einsatzländer',
    short: 'Einsatzland passt nicht',
    exclusion: 'Der Einsatzort liegt nicht in deinen Ländern.',
  },
  noAnue: {
    label: 'Zeitarbeit',
    short: 'Zeitarbeit',
    exclusion: 'Du schließt Zeitarbeit aus.',
  },
  noPermanent: {
    label: 'Festanstellung',
    short: 'Festanstellung',
    exclusion: 'Du schließt Festanstellungen aus.',
  },
  availability: {
    label: 'Verfügbarkeit',
    short: 'Start passt nicht',
    exclusion: 'Der Start liegt vor deiner Verfügbarkeit.',
  },
  minSalary: {
    label: 'Jahresgehalt',
    short: 'Gehalt zu niedrig',
    exclusion: 'Das Gehalt liegt unter deinem Minimum.',
  },
  permanentRegion: {
    label: 'Orte',
    short: 'Ort passt nicht',
    exclusion: 'Der Ort liegt nicht in deinen Orten für Festanstellung.',
  },
  targetYears: {
    label: 'Erfahrung',
    short: 'Erfahrung passt nicht',
    exclusion: 'Der Job verlangt weniger Erfahrung, als du suchst.',
  },
  // The workload and the duration are checks, never an exclusion (engine 16).
  workload: {
    label: 'Auslastung',
    short: 'Auslastung passt nicht',
    exclusion: WORKLOAD,
  },
  duration: {
    label: 'Laufzeit',
    short: 'Laufzeit zu kurz',
    exclusion: DURATION,
  },
  exclusionWords: {
    label: 'Ausschlusswörter',
    short: 'Ausschlusswort',
    exclusion: 'Die Anzeige nennt eines deiner Ausschlusswörter.',
  },
} satisfies Record<string, CriterionText>;
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

/** The keys of the profile file the app speaks about (the keys themselves are an external
 *  contract): the criteria, wishes, Schwerpunkte and target roles, German and English, each
 *  by the field it belongs to, which every catalog names by the label of its form field
 *  (`fieldName`). */
export const PROFILE_KEY_FIELD: Readonly<Record<string, string>> = {
  min_tagessatz: 'minDayRate',
  min_day_rate: 'minDayRate',
  tagessatz_ab: 'minDayRate',
  laender: 'countries',
  countries: 'countries',
  ausgeschlossene_vertragsarten: 'contracts',
  excluded_contract_types: 'contracts',
  remote_ausserhalb_erlaubt: 'remoteOutside',
  remote_outside_allowed: 'remoteOutside',
  verfuegbar_ab: 'available',
  available_from: 'available',
  min_jahresgehalt: 'minSalary',
  min_annual_salary: 'minSalary',
  min_salary: 'minSalary',
  festanstellung_orte: 'permanentPlaces',
  permanent_locations: 'permanentPlaces',
  permanent_places: 'permanentPlaces',
  festanstellung_remote_min: 'permanentRemoteMin',
  permanent_remote_min: 'permanentRemoteMin',
  zielprofil_min_jahre: 'targetYears',
  target_min_years: 'targetYears',
  auslastung_min_tage: 'workloadMinDays',
  workload_min_days: 'workloadMinDays',
  auslastung_max_tage: 'workloadMaxDays',
  workload_max_days: 'workloadMaxDays',
  min_laufzeit_monate: 'minMonths',
  min_duration_months: 'minMonths',
  ausschlusswoerter: 'exclusionWords',
  ausschlusswörter: 'exclusionWords',
  exclusion_words: 'exclusionWords',
  schwerpunkte: 'focus',
  focus_areas: 'focus',
  wunschrollen: 'roles',
  target_roles: 'roles',
  tagessatz_wunsch: 'wishDayRate',
  desired_day_rate: 'wishDayRate',
  remote: 'remote',
  regionen: 'regions',
  regions: 'regions',
  // `branchen` of the wishes (the engine reports no other one).
  branchen: 'wishIndustries',
  industries: 'wishIndustries',
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
  availabilityNotUnderstood: '„Verfügbar ab“ ist nicht lesbar.',
  // Keys of a criteria section the engine does not read (a typo, an unknown rule).
  ignoredKeys: (p) => `Die App liest ${joined(rawKeys(p.keys))} in den Bedingungen nicht.`,
  criterionNotUnderstood: (p) => `„${keyLabel(str(p.key))}“ ist nicht lesbar.`,
  regionWithoutPlaces: 'Der Mindest-Remote-Anteil wirkt nur zusammen mit Orten.',
  focusTrimmed: (p) => `Nur die ersten ${n(num(p.max))} Schwerpunkte zählen.`,
} satisfies Record<string, Text>;
export type ProfileWarning = keyof typeof warning;

export const de = {
  app: {
    name: 'CXact',
  },
  nav: {
    label: 'Bereiche',
    jobs: 'Jobs',
    profile: 'Profil',
    settings: 'Einstellungen',
    /** The quiet line at the foot of the sidebar in the demo (`--demo`): its data are samples. */
    demo: 'Demo',
  },
  common: {
    loading: 'Wird geladen',
    cancel: 'Abbrechen',
    remove: 'Entfernen',
    change: 'Ändern',
    open: 'Öffnen',
    hide: 'Ausblenden',
    back: 'Zurück',
    retry: 'Erneut versuchen',
    undo: 'Rückgängig',
    openFolder: 'Ordner öffnen',
    openLog: 'Protokoll öffnen',
  },
  portal: portalName,
  chips: {
    remove: (value: string) => `${value} entfernen`,
    /** The chips a one-line field does not show (their values in its tooltip). */
    more: (value: number) => `+${n(value)}`,
  },
  splitter: {
    label: 'Breite der Liste',
    /** The tooltip of the handle, and its second line. */
    tip: 'Breite ändern',
    reset: 'Doppelklick setzt zurück',
  },
  /** Where a job is, like a mail: the inbox ("Jobs" in the sidebar), the archive, the trash. */
  place: {
    /** The tabs above the job list (their accessible name, and each place). */
    tabs: 'Orte',
    inbox: 'Eingang',
    archive: 'Archiv',
    trash: 'Papierkorb',
    /** The reader beside the inbox while no job is open. */
    pickJob: 'Wähle einen Job aus der Liste.',
    /** The field's placeholder names what it searches. */
    search: {
      inbox: 'Eingang durchsuchen',
      archive: 'Archiv durchsuchen',
      trash: 'Papierkorb durchsuchen',
    } satisfies Record<Place, string>,
    /** Search hits in another place: a button under the results that goes there (its count
     *  after it, quiet like the tabs'). */
    hitsIn: {
      inbox: 'Im Eingang',
      archive: 'Im Archiv',
      trash: 'Im Papierkorb',
    } satisfies Record<Place, string>,
    empty: {
      inbox: 'Keine Jobs.',
      archive: 'Das Archiv ist leer.',
      trash: 'Der Papierkorb ist leer.',
    } satisfies Record<Place, string>,
  },
  /** What a job can do where it is: one name and icon in its menu (a right click on its row,
   *  the reader's "…") and in the reader. */
  actions: {
    /** What shows the job. */
    open: 'Öffnen',
    mail: OPEN_MAIL,
    openAd: 'Anzeige öffnen',
    prompt: 'KI-Prompt kopieren',
    /** Without a usable profile there is nothing to judge the job by. */
    promptNoProfile: 'Ohne Profil gibt es nichts zu bewerten.',
    /** An excluded job counts with its real match anyway, or is excluded again. */
    include: 'Trotzdem bewerten',
    exclude: 'Wieder ausschließen',
    archive: 'Archivieren',
    /** Back into the Eingang from the Archiv (the user's word; Wiederherstellen is the
     *  Papierkorb's). */
    unarchive: 'Dearchivieren',
    trash: 'Löschen',
    restore: 'Wiederherstellen',
    purge: 'Endgültig löschen',
    /** The confirm button of a dialog is the verb of what asked. */
    purgeConfirm: 'Endgültig löschen',
    purgeHeading: (value: number) =>
      value === 1 ? 'Job endgültig löschen?' : `${n(value)} Jobs endgültig löschen?`,
    /** Deleting for good, one job or the whole Papierkorb: one sentence shape. */
    purgeText: 'Der Job kommt nicht wieder, auch nicht mit alten Alert-Mails.',
    emptyTrash: 'Papierkorb leeren',
    emptyTrashHeading: 'Papierkorb leeren?',
    emptyTrashText: (value: number) =>
      value === 1
        ? 'Der Job kommt nicht wieder, auch nicht mit alten Alert-Mails.'
        : `Die ${n(value)} Jobs kommen nicht wieder, auch nicht mit alten Alert-Mails.`,
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
    none: 'Noch nicht bewertet',
    /** A ring without a usable profile. */
    off: 'Ohne Profil keine Übereinstimmung',
    band: {
      high: 'Hohe Übereinstimmung',
      mid: 'Mittlere Übereinstimmung',
      low: 'Geringe Übereinstimmung',
    } satisfies Record<Band, string>,
  },
  reason: {
    weight: {
      must: 'Pflicht',
      nice: 'Optional',
      hard: 'Ausschluss',
      info: 'Hinweis',
    } satisfies Record<ReasonWeight, string>,
    /** Why a requirement decides a row of the Jobdetails (its verdict's tooltip): the ad's
     *  words and what the profile says. */
    evidence: (quote: string, profile: string, partial: boolean) =>
      partial
        ? `„${quote}“ stimmt teilweise mit „${profile}“ im Profil überein.`
        : `„${quote}“ stimmt mit „${profile}“ im Profil überein.`,
    missing: (quote: string) => `„${quote}“ steht nicht im Profil.`,
    code: reasonCode,
  },
  job: {
    unread: 'Neu',
    alsoOn: (portals: string) => `auch auf ${portals}`,
    untitled: 'Job ohne Titel',
    /** An ad that takes no applications any more (the end of its row's first line). */
    closed: 'Beendet',
  },
  toolbar: {
    fetch: 'Postfach abrufen',
    /** Which alert mails "Postfach abrufen" reads (`fetchRange`): the menu of its chevron
     *  (its name, its heading and its tooltip). */
    range: 'Zeitraum',
    rangeName: {
      sinceLast: 'Seit dem letzten Abruf',
      days7: 'Letzte 7 Tage',
      days30: 'Letzte 30 Tage',
      all: 'Alle Alert-Mails',
    } satisfies Record<FetchRange, string>,
    cancel: 'Abbrechen',
    progress: 'Fortschritt des Abrufs',
    /** The first group of the funnel's menu: the order of the list. */
    sortHeading: 'Sortierung',
    /** The order of the list in words (the funnel's menu). */
    sortLabel: {
      match: 'Nach Übereinstimmung',
      newest: 'Nach Datum',
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
    allPortals: 'Alle Portale',
    /** The lowest band of the filter under its heading (`any`: every job, also one without a
     *  score), and as a chip, where the heading is not beside it. */
    band: {
      any: 'Jede',
      mid: 'Ab mittel',
      high: 'Nur hoch',
    } satisfies Record<'any' | 'mid' | 'high', string>,
    bandChip: {
      mid: 'Ab mittlerer Übereinstimmung',
      high: 'Nur hohe Übereinstimmung',
    } satisfies Record<'mid' | 'high', string>,
    /** Without a usable profile there is no match to filter by. */
    bandNoProfile: 'Ohne Profil gibt es keine Übereinstimmung.',
    contractHeading: 'Vertragsart',
    anyContract: 'Jede Vertragsart',
    /** A switch of its own behind a line (remote or not is no place). */
    remoteOnly: 'Nur remote',
    filterReset: 'Filter zurücksetzen',
    needsMailbox: 'Verbinde erst ein Postfach.',
    /** Every portal is switched off in Einstellungen: nothing to fetch from. */
    needsPortal: 'Schalte erst ein Portal ein.',
  },
  run: {
    /** The one line under the list header while a fetch goes: what happens now. */
    line: {
      mailbox: 'Postfach wird gelesen',
      ads: (done: number, total: number) => `Anzeigen ${n(done)} von ${n(total)}`,
      adsStart: 'Anzeigen werden geladen',
      scoring: 'Jobs werden bewertet',
      files: 'Dateien werden geschrieben',
    },
    rescoring: 'Die Jobs werden gerade neu bewertet.',
    /**
     * A file the export could not write (`export.error.params.target`); the old file stays.
     * `overviewLocked`: the Excel file is open in another program.
     */
    exportFailed: {
      overview: 'Die Excel-Datei ließ sich nicht schreiben und blieb unverändert.',
      overviewLocked:
        'Die Excel-Datei ist in einem anderen Programm geöffnet und blieb unverändert.',
      csv: 'Die CSV-Datei ließ sich nicht schreiben und blieb unverändert.',
      csvLocked: 'Die CSV-Datei ist in einem anderen Programm geöffnet und blieb unverändert.',
      txt: 'Nicht alle Textdateien ließen sich schreiben.',
      txtFolder: 'Der Ordner der Textdateien ist nicht erreichbar.',
      backup: 'Die alte Excel-Datei ließ sich nicht sichern, die neue wurde nicht geschrieben.',
      /** The work folder itself (a drive that is gone): nothing was written. */
      workspace: 'Der Ergebnisordner ist nicht erreichbar.',
    },
    checkMailbox: 'Postfach prüfen',
  },
  list: {
    label: 'Jobs',
    /** The folding section at the end of every place (its count after it where known). */
    excluded: 'Ausgeschlossen',
    /** FR-03: while the first fetch runs, the empty list only says what comes (the rows
     *  arrive during the fetch, each once its details are in). */
    emptyWhileRun: 'Die Jobs erscheinen hier nach und nach.',
    emptyAll: 'Nach dem ersten Abruf stehen die Jobs hier.',
    emptyAfterRun: 'Die Alert-Mails enthielten bisher keine Jobs.',
    noHit: (query: string) => `Keine Jobs zu „${query}“.`,
    /** The filter of the inbox leaves nothing in the list. */
    noFilterHit: 'Kein Job passt zum Filter.',
    loadFailed: 'Die Jobliste ließ sich nicht laden.',
    pageFailed: 'Weitere Jobs ließen sich nicht laden.',
    createProfile: 'Profil anlegen',
    openProfile: 'Profil öffnen',
    noMailbox: 'Ohne Postfach kommen keine neuen Jobs dazu.',
    /** No usable profile: said once, at the top of the list. */
    noProfile: 'Ohne Profil gibt es keine Übereinstimmung.',
    profileUnreadable: PROFILE_UNREADABLE,
    profileEmpty: 'Profil ohne Kompetenzen',
    profileBrokenText: 'Die Jobs zeigen deshalb keine Übereinstimmung.',
    /** A profile the app understands little of: one calm line on top of the list. */
    thinProfile: 'Wenig Inhalt im Profil, die Übereinstimmung bleibt grob.',
    connectMailbox: 'Postfach verbinden',
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
    months: (value: number) => count(value, 'Monat', 'Monate'),
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
    /** The workload (percent of a five-day week): "Vollzeit", "3 Tage/Woche", "50 %". */
    workload: (from: number | null, to: number) => workloadWords(from, to, true),
    years: (min: number, max: number | null) =>
      max !== null && max > min
        ? `${n(min)} bis ${count(max, 'Jahr', 'Jahre')}`
        : count(min, 'Jahr', 'Jahre'),
  },
  reader: {
    /** A must requirement the profile lacks: the term goes into the profile's keywords. */
    addToProfile: 'Zum Profil hinzufügen',
    /** The name of the quiet tick that replaces the "+" once the term is in the profile. */
    added: 'Hinzugefügt',
    addedToProfile: (term: string) => `„${term}“ zum Profil hinzugefügt.`,
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
      deadline: 'Bewerbungsfrist',
      contact: 'Kontakt',
      industry: 'Branche',
      portal: 'Portal',
      received: 'Eingegangen',
    },
    /** The pay row of a permanent job or temporary agency work (an annual salary). */
    salaryName: 'Gehalt',
    /** The pay row of an hourly rate. */
    hourlyName: 'Stundensatz',
    /** Quiet after the pay: how it stands to the profile's minimum (signed percent). */
    versusMinimum: (percent: number) => {
      if (percent === 0) return 'genau dein Minimum';
      const share = formatPercent(Math.abs(percent));
      return percent > 0 ? `${share} über deinem Minimum` : `${share} unter deinem Minimum`;
    },
    /** Quiet after the years a job asks: fewer than the profile's minimum. */
    yearsBelow: (years: number) => `unter deinem Minimum von ${count(years, 'Jahr', 'Jahren')}`,
    /** A value the ad does not state. */
    missing: '/',
    /** The contract type in the row "Vertragsart". */
    contractKind: {
      interim: 'Interim',
      freelance: 'Freiberuflich',
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
    open: 'Anzeige öffnen',
    close: 'Schließen',
    /** The "…" button (its menu is the second group of the job's menu, `actions`). */
    more: 'Weitere Aktionen',
    prompt: 'KI-Prompt kopieren',
    /** The clipboard refused the prompt. */
    promptNotCopied: 'Der Prompt ließ sich nicht kopieren.',
    mail: OPEN_MAIL,
    noMail: 'Zu diesem Job gibt es keine Alert-Mail.',
    setUpSignIn: 'Anmeldung einrichten',
    promptNoProfile: 'Ohne Profil gibt es nichts zu bewerten.',
    promptNoText: 'Der Text der Anzeige fehlt noch.',
    /** Loads the whole ad (a preview, a missing one). */
    fetchDetails: 'Anzeige laden',
    why: 'Anforderungen',
    noReasons: 'Die Anzeige nennt keine klaren Anforderungen.',
    ad: 'Anzeige',
    /** The note of the ad section where its text is not all there, one short sentence under
     *  the heading "Anzeige": a preview, an ad still to come or being loaded, one the app
     *  cannot reach, gone or closed. */
    adNote: {
      teaser: 'Nur eine Vorschau.',
      missing: 'Noch nicht geladen.',
      loading: 'Wird geladen.',
      unfetchable: 'Nicht erreichbar.',
      gone: 'Nicht mehr online.',
      closed: 'Keine Bewerbung mehr möglich.',
    },
    short: SHORT_TEXT,
    loadFailed: 'Der Job ließ sich nicht laden.',
  },
  health: {
    /** A portal problem in one sentence that says whether to act (its row in the settings). */
    advice: {
      paused: (reason: PauseReason, iso: string | null) => {
        const why = pause[reason].charAt(0).toUpperCase() + pause[reason].slice(1);
        return iso
          ? `${why}, der Abruf macht ab ${formatMoment(iso)} von selbst weiter.`
          : `${why}, der nächste Abruf versucht es von selbst wieder.`;
      },
      quota: (iso: string) =>
        `Das Limit ist erreicht, der Abruf macht ab ${formatMoment(iso)} von selbst weiter.`,
      emptyMails,
      pages:
        'Die Seiten des Portals sehen anders aus, der nächste Abruf versucht es von selbst wieder.',
      login: 'Die Anmeldung ist abgelaufen, melde dich neu an.',
    },
  },
  profile: {
    none: 'Noch kein Profil',
    /** The file does not read (edited by hand): the empty state says so. */
    unreadable: PROFILE_UNREADABLE,
    noneText: 'Mit einem Profil zeigt jeder Job seine Übereinstimmung.',
    /** Under the error of a profile that no longer reads. */
    replaces: 'Ein neues Profil ersetzt die Datei.',
    /** Another file over the stored profile, and the toast after saving it (Rückgängig). */
    replacesStored: 'Speichern ersetzt dein Profil.',
    replaced: 'Profil ersetzt.',
    /** Rückgängig of a removal or a replacement that did not work. */
    restoreFailed: 'Das alte Profil ließ sich nicht zurückholen.',
    create: 'Profil anlegen',
    fromCv: 'Aus Lebenslauf anlegen',
    /** The same way for a profile that exists: the answer fills the form for review. */
    updateFromCv: 'Aus Lebenslauf aktualisieren',
    pick: 'Profildatei wählen',
    pickOther: 'Andere Datei wählen',
    /** The accessible name of the head's menu (Andere Datei wählen, Ordner öffnen, Profil
     *  löschen). */
    more: 'Weitere Aktionen',
    /** In the head's menu, red; it asks first, and the toast offers Rückgängig. */
    remove: 'Profil löschen',
    removeHeading: 'Profil löschen?',
    removeConfirm: 'Löschen',
    removed: 'Profil gelöscht.',
    /** The toast of a save (during the setup with the way on). */
    saved: 'Profil gespeichert.',
    unnamed: 'Profil ohne Namen',
    rescoring: (value: number) => `${count(value, 'Job wird', 'Jobs werden')} neu bewertet.`,
    /** Values of the file that do not read and a rule that stays off: a click goes to the
     *  first one. */
    check: (value: number) => count(value, 'Wert prüfen', 'Werte prüfen'),
    next: 'Weiter zum ersten Abruf',
    /** The same place without a mailbox: back to the setup page. */
    nextMailbox: 'Weiter zum Postfach',
    warning,
    /** Every domain pack of the engine (core/src/matching/lexicon/domains). */
    pack: {
      finance: 'Finanzen',
      sap: 'SAP',
      itProject: 'IT-Projekte',
      hr: 'Personal',
      procurement: 'Einkauf',
      data: 'Daten',
      pharma: 'Pharma',
      operations: 'Produktion',
      sales: 'Vertrieb',
      legal: 'Recht',
      software: 'Software',
      restructuring: 'Restrukturierung',
      consulting: 'Unternehmensberatung',
      energy: 'Energiewirtschaft',
    } as Record<string, string>,
    save: 'Speichern',
    discard: 'Verwerfen',
    leaveHeading: 'Änderungen speichern?',
    /** Why another file or an update waits while the form holds changes. */
    saveFirst: 'Erst speichern oder verwerfen.',
    /** Why Speichern waits while a value is marked. */
    fixFirst: 'Korrigiere erst den markierten Wert.',
    empty: 'Noch leer',
    /** Under the competences: the terms the jobs of the last 30 days ask for most that the
     *  profile does not name, each with its number of jobs; its "+" adds it as a competence
     *  (an unsaved change like any other). */
    asked: 'Häufig verlangt',
    askedAdd: 'Als Kompetenz hinzufügen',
    /** The accessible name of a term's number. */
    askedIn: (value: number) => `in ${count(value, 'Job', 'Jobs')}`,
    section: {
      person: 'Person',
      criteria: 'Bedingungen',
      competences: 'Kompetenzen',
      experience: 'Erfahrung und Qualifikation',
      languages: 'Sprachen',
      wishes: 'Wünsche',
      permanent: 'Festanstellung',
    },
    /** The two blocks whose effect is easy to get wrong say it in one sentence. */
    sectionHint: {
      criteria: 'Was hier nicht passt, schließt einen Job aus.',
      wishes: 'Wünsche schließen nichts aus.',
    } as Partial<Record<string, string>>,
    field: {
      name: 'Name',
      namePlaceholder: 'Vor- und Nachname',
      title: 'Rolle',
      titlePlaceholder: 'z. B. Interim Manager',
      roles: 'Wunschrollen',
      rolesPlaceholder: 'z. B. Interim CFO',
      competence: 'Kompetenz',
      competencePlaceholder: 'z. B. Projektleitung',
      years: 'Jahre',
      aliases: 'Synonyme',
      addCompetence: 'Kompetenz hinzufügen',
      removeCompetence: (name: string) => `${name || 'Kompetenz'} entfernen`,
      star: 'Als Schwerpunkt markieren',
      /** The star of a Schwerpunkt, and of a row without a competence yet. */
      unstar: 'Schwerpunkt entfernen',
      starEmpty: 'Trag erst eine Kompetenz ein.',
      /** The Schwerpunkte over the column of their marks (`2/5`). */
      focusCount: (value: number, max: number) => `${n(value)}/${n(max)}`,
      focusHint: 'Markierte Kompetenzen zählen doppelt, höchstens fünf.',
      focusFull: 'Höchstens fünf Schwerpunkte.',
      /** More Schwerpunkte in a file or an answer than count. */
      focusTrimmed: (count: number) =>
        `Die Datei nennt ${n(count)} Schwerpunkte, übernommen sind die ersten fünf.`,
      strengths: 'Besondere Stärken',
      strengthsPlaceholder: 'z. B. Teams durch Veränderungen führen',
      keywords: 'Stichworte',
      keywordsPlaceholder: 'z. B. Transformation',
      totalYears: 'Berufserfahrung',
      degrees: 'Abschlüsse',
      degreesPlaceholder: 'z. B. Master',
      industries: 'Branchen',
      industriesPlaceholder: 'z. B. Handel',
      tools: 'Werkzeuge und Methoden',
      toolsPlaceholder: 'z. B. Scrum',
      certificates: 'Zertifikate',
      certificatesPlaceholder: 'z. B. PMP',
      language: 'Sprache',
      languagePlaceholder: 'z. B. Englisch',
      level: 'Niveau',
      addLanguage: 'Sprache hinzufügen',
      removeLanguage: (name: string) => `${name || 'Sprache'} entfernen`,
      wishRate: 'Wunschtagessatz',
      /** Quiet hints where two values contradict each other. */
      belowMinRate: 'Liegt unter dem Mindesttagessatz.',
      aboveExperience: 'Liegt über deiner Berufserfahrung.',
      remote: 'Remote-Anteil',
      regions: 'Wunschregionen',
      regionsPlaceholder: 'z. B. München',
      wishIndustries: 'Wunschbranchen',
      wishIndustriesPlaceholder: 'z. B. Energie',
      minDayRate: 'Mindesttagessatz',
      countries: 'Einsatzländer',
      countriesPlaceholder: 'Land suchen',
      /** Typed text that names no country the app knows. */
      countryNone: 'Kein Land mit diesem Namen.',
      remoteOutside: 'Remote-Jobs im Ausland ausschließen',
      remoteOutsideOff: 'Wähle erst die Einsatzländer.',
      noAnue: 'Zeitarbeit ausschließen',
      noPermanent: 'Festanstellung ausschließen',
      available: 'Verfügbar ab',
      /** Days per week, from and to (either may stay empty): "von 3 bis 5 Tage pro Woche". */
      workload: 'Auslastung',
      workloadFrom: 'von',
      workloadTo: 'bis',
      /** The names of the two day fields for a screen reader. */
      workloadMin: 'Auslastung von',
      workloadMax: 'Auslastung bis',
      /** The second day lies below the first (the backend refuses it). */
      workloadOrder: 'Der zweite Wert liegt unter dem ersten.',
      minMonths: 'Mindestlaufzeit',
      exclusionWords: 'Ausschlusswörter',
      exclusionWordsPlaceholder: 'z. B. Werkstudent',
      /** The option of a single choice that leaves it open (Remote-Anteil, Verfügbar ab). */
      open: 'Offen',
      date: 'Datum',
      datePlaceholder: '01.11.2026',
      dateInvalid: 'Gib das Datum im Format 01.11.2026 ein.',
      /** A day in the right format that the calendar does not have (31.02.2026). */
      dateImpossible: 'Diesen Tag gibt es nicht.',
      /** "Mindestens verlangte Erfahrung 15 Jahre": a job that asks for far less is excluded. */
      targetYears: 'Mindestens verlangte Erfahrung',
      minSalary: 'Mindestjahresgehalt',
      places: 'Orte für Festanstellung',
      placesPlaceholder: 'z. B. München',
      remoteMin: 'Mindest-Remote-Anteil',
      remoteMinHint: 'Gilt für Jobs außerhalb dieser Orte.',
      /** The remote share waits for the places it counts outside of. */
      placesFirst: 'Trag erst Orte ein.',
      /** A euro amount with cents: the app counts whole euros. */
      rounded: 'Auf ganze Euro abgerundet.',
      /** Another number with a decimal part: the app counts whole ones. */
      roundedWhole: 'Auf eine ganze Zahl abgerundet.',
      /** A value the backend refused, said at its field: the limit where one is. */
      refused: 'Dieser Wert passt nicht.',
      atMost: (max: number) => `Höchstens ${n(max)}.`,
      /** A value in the file that the app could not read, shown at its field. */
      unreadableNumber: (value: string) => `In der Datei stand „${value}“, das ist keine Zahl.`,
      unreadableDate: (value: string) => `In der Datei stand „${value}“, das ist kein Datum.`,
      unreadableValue: (value: string) =>
        `In der Datei stand „${value}“, das kann die App nicht lesen.`,
      unreadableFocus: (value: string) => `„${value}“ steht nicht bei den Kompetenzen.`,
      unreadableRole: (value: string) => `„${value}“ nennt kein Fachgebiet.`,
      removeValue: 'Wert entfernen',
    },
    /** The unit right of a number field. */
    unit: {
      euro: '€',
      years: 'Jahre',
      /** "Mindestens verlangte Erfahrung 15 Jahre". */
      experience: 'Jahre',
      percent: '%',
      days: 'Tage pro Woche',
      months: 'Monate',
    },
    level: {
      a1: 'A1',
      a2: 'A2',
      b1: 'B1',
      b2: 'B2',
      c1: 'C1',
      c2: 'C2',
      native: 'Muttersprache',
    } satisfies Record<LanguageLevel, string>,
    /** The remote wish in the words of the jobs (the reader's work mode). */
    remoteWish: {
      full: 'Voll remote',
      mostly: 'Überwiegend remote',
      partly: 'Hybrid',
      onSite: 'Vor Ort',
    } satisfies Record<RemoteWish, string>,
    /** Nothing chosen means no availability (pressing the chosen one again clears it). */
    availability: {
      now: 'Sofort',
      from: 'Datum',
    } satisfies Record<Exclude<ProfileAvailability['kind'], 'unset'>, string>,
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
    /** Common languages, suggested in the language of a row (found by their German and
     *  English names; any other language can be typed). */
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
    paste: {
      privacy: 'Der Lebenslauf geht an die KI, die du nutzt.',
      copied: 'Der Prompt ist kopiert.',
      copyFailed: 'Der Prompt ließ sich nicht kopieren.',
      copy: 'KI-Prompt kopieren',
      copyAgain: 'Erneut kopieren',
      step: 'Füge ihn in eine KI ein und hänge den Lebenslauf an.',
      preview: 'Prompt ansehen',
      answer: 'Antwort der KI',
      take: 'Übernehmen',
      /** Why Übernehmen waits. */
      takeEmpty: 'Füge erst die Antwort der KI ein.',
    },
  },
  settings: {
    mailbox: 'Postfach',
    portals: 'Portale',
    export: 'Export',
    /** The card of how the app looks and speaks: its colours and its language. */
    look: 'Darstellung',
    /** The card of the app's data: its backups, its log, the reset. */
    data: 'Daten',
    /** Back to the job whose "Anmeldung einrichten" led here (the job stays open). */
    backToJob: 'Zurück zum Job',
    connected: 'Verbunden',
    /** The row of the mailbox while none is connected. */
    notConnected: 'Kein Postfach',
    /** The last fetch could not reach Gmail, or Gmail refused the password. */
    unreachable: 'Nicht erreichbar',
    refused: 'Abgelehnt',
    mailRefused: 'Gmail lehnt Adresse oder App-Passwort ab, trag sie über „Ändern“ neu ein.',
    address: 'Gmail-Adresse',
    password: 'App-Passwort',
    createPassword: 'App-Passwort erstellen',
    addressMissing: 'Die Gmail-Adresse fehlt.',
    passwordMissing: 'Das App-Passwort fehlt.',
    /** Google's own words for its 2-step verification. */
    twoStepAction: 'Bestätigung in zwei Schritten einschalten',
    connect: 'Verbinden',
    /** The dialog of "Verbinden", and of "Ändern" (named after the button that opens it). */
    connectHeading: 'Postfach verbinden',
    changeHeading: 'Postfach ändern',
    removeMailbox: 'Postfach entfernen?',
    removeMailboxText: 'Das App-Passwort wird gelöscht, die Jobs bleiben.',
    /** Which alert mails "Postfach abrufen" reads (`fetchRange`). */
    range: 'Zeitraum',
    rangeName: {
      sinceLast: 'Seit dem letzten Abruf',
      days7: '7 Tage',
      days30: '30 Tage',
      all: 'Alle',
    } satisfies Record<FetchRange, string>,
    /** The calls of a portal today (counted from midnight). */
    quota: (used: number, cap: number) => `Heute ${n(used)} von ${n(cap)} Aufrufen`,
    signIn: 'Anmelden',
    signOut: 'Abmelden',
    openPortal: 'Im Browser öffnen',
    signInWaiting: 'Das Anmeldefenster ist offen.',
    /** A portal that is on sent no alert mail for a week or longer (its alert may have run
     *  out), and the way to its page. */
    alertQuiet: (days: number) => `Seit ${n(days)} Tagen keine Alert-Mail`,
    checkAlert: 'Alert prüfen',
    folder: 'Ergebnisordner',
    excel: 'Excel-Datei',
    csv: 'CSV-Datei',
    excelMissing: 'Die Excel-Datei entsteht beim nächsten Abruf.',
    csvMissing: 'Die CSV-Datei entsteht beim nächsten Abruf.',
    /** Another result folder: the profile came along (or the folder has its own), the files
     *  are written there at once. */
    folderMoved: 'Profil und Dateien liegen im neuen Ordner.',
    folderFiles: 'Die Dateien liegen im neuen Ordner.',
    folderOwnProfile: 'Die App nutzt das Profil aus diesem Ordner.',
    logs: 'Protokoll',
    /** The app's version, the quiet line under the last card. */
    version: (value: string) => `Version ${value}`,
    /** The row of the database's copies, and its dialog. */
    backup: 'Sicherung',
    backupHeading: 'Sicherung wiederherstellen',
    backupAction: 'Wiederherstellen',
    backupNone: 'Es gibt noch keine Sicherung.',
    /** After a copy's day and time: why it is there (the copy of a day says nothing). */
    backupKind: {
      daily: null,
      update: 'vor einem Update',
      restore: 'vor dem Wiederherstellen',
    } satisfies Record<BackupKind, string | null>,
    backupText: 'Der jetzige Stand wird vorher gesichert.',
    backupRestored: 'Sicherung wiederhergestellt.',
    /** Its undo brought the state before it back. */
    backupUndone: 'Der vorherige Stand ist zurück.',
    /** The row of the reset, its button and its dialog. */
    reset: 'Alle Daten',
    resetAction: 'Zurücksetzen',
    resetHeading: 'Alles zurücksetzen?',
    resetText: 'Die App löscht Folgendes und startet dann neu.',
    /** Everything the reset deletes, one item each (the dialog's list): the database, the
     *  profile, the keychain entry, the portal sign-ins and the app's files. */
    resetItems: [
      'die Jobs und die Einstellungen',
      'das Profil',
      'das App-Passwort',
      'die Anmeldungen bei den Portalen',
      'die Dateien der App im Ergebnisordner',
    ] as string[],
    resetDone: 'Die App ist zurückgesetzt.',
    /** What stayed can be a file, a folder, the app password or a sign-in: "Element". */
    resetPartly: (value: number) =>
      `Die App ist zurückgesetzt, ${count(value, 'Element ließ', 'Elemente ließen')} sich nicht löschen.`,
    running: 'Ein Abruf läuft gerade.',
    dryRun: 'Probelauf, es werden keine Daten verändert.',
    /** The demo (`--demo`): its own data from sample ads, no fetch. */
    demo: 'Demo mit Beispieldaten, ohne Postfach und Portale.',
    palette: 'Farben',
    /** The palettes (tokens.css): the app's own by the app's name (first, the default), then
     *  light and dark. */
    paletteName: {
      coast: 'CXact',
      light: 'Hell',
      dark: 'Dunkel',
    } satisfies Record<Palette, string>,
    language: 'Sprache',
    /** Each language in its own words, the same in both catalogs. */
    languageName: {
      de: 'Deutsch',
      en: 'English',
    } satisfies Record<Language, string>,
  },
  firstRun: {
    steps: 'Erste Schritte',
    mailbox: 'Postfach',
    /** Where the jobs come from: the portals switched on by name, in the app's order. */
    mailboxText: (portals: readonly Portal[]) =>
      `Die Alert-Mails von ${joined(portals.map((p) => portalName[p]))} müssen an diese Gmail-Adresse${NBSP}gehen.`,
    /** Connected: the portals stand in the list under it, so the sentence does not name them. */
    mailboxDone: 'Die Alert-Mails der Portale müssen an diese Adresse gehen.',
    /** Every portal is off: the fetch would read nothing. */
    noPortal: 'Schalte erst ein Portal ein.',
    openSettings: 'Einstellungen öffnen',
    /** Per portal after connecting: the alert mails "Verbinden" found, else its page to set
     *  up an alert. */
    alertMails: (value: number) => count(value, 'Alert-Mail', 'Alert-Mails'),
    createAlert: 'Alert anlegen',
    /** "Verbinden" found no alert mail of any portal: a fetch would find nothing. */
    noAlerts: 'In den letzten 30 Tagen kam keine Alert-Mail an, leg erst einen Alert an.',
    profile: 'Profil',
    /** A profile without competences: the step stays open. */
    profileEmpty: 'Ohne Kompetenzen wird nichts bewertet.',
    fetch: 'Erster Abruf',
  },
  shell: {
    loadFailed: 'Die App konnte ihre Daten nicht laden.',
    /** Closing while the app is busy: the window waits until what holds it has stopped. */
    closing: (activity: string | null) => closing[busyOf(activity)],
  },
  /** Short confirmations without a period (a participle like "Archiviert"); only a full
   *  sentence ends with one. */
  toast: {
    rescored: 'Jobs neu bewertet',
    /** The job, or the best matches, as a prompt for any AI chat (no brand named). */
    prompt: 'Prompt kopiert',
    /** A job action: one short word, however many jobs it took, without their titles. */
    archived: 'Archiviert',
    unarchived: 'Dearchiviert',
    trashed: 'Gelöscht',
    restored: 'Wiederhergestellt',
    /** Only a deletion for good says "endgültig". */
    deleted: 'Endgültig gelöscht',
    included: 'Bewertet',
    excluded: 'Ausgeschlossen',
    trashEmptied: 'Papierkorb geleert',
    /** At the end of a fetch: what it brought (new, not excluded). */
    runDone: (value: number) =>
      value === 0 ? 'Keine neuen Jobs' : count(value, 'neuer Job', 'neue Jobs'),
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

/** The shape of this catalog with any words: the type of every catalog (en.ts). */
export type Catalog = Widen<typeof de>;

/** Words become `string`; keys, nesting and function signatures stay. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends object
      ? { -readonly [K in keyof T]: Widen<T[K]> }
      : T;
