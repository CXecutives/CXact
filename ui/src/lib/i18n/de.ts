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
// („Details holen“). Glossary (docs/PLAN.md): Job · Portal · Passung · Details · Abrufen ·
// Profil · Postfach · Alert-Mail · Übersicht · Excel-Datei · Ausgeschlossen · Neu · Zu prüfen ·
// Favorit (Favoriten) · Archiv · Papierkorb. A profile field has one name: the label of its
// form field (without the unit) in errors, warnings and the profile.
//
// Every code of the generated types has exactly one text here: the tables are typed as
// `Record<Code, ...>`, so a new code without a text is a type error.

import type {
  Band,
  DetailState,
  ErrorKind,
  InvalidInput,
  JobSort,
  Language,
  PauseReason,
  Place,
  Portal,
  PortalHealth,
  LanguageLevel,
  ProfileAvailability,
  ProfileQuality,
  ReasonKind,
  ReasonWeight,
  RemoteWish,
  RunKindName,
  StatusCode,
  Step,
  VaultKind,
  WorkMode,
} from '../ipc/types';
import {
  NBSP,
  formatCountdown,
  formatEuro,
  formatMoment,
  formatMoney,
  formatNumber,
  formatPercent,
  formatStamp,
} from './format';

type Params = Record<string, string | number | boolean | null>;
type Text = string | ((params: Params) => string);

const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const n = (value: number): string => formatNumber(value);
/** German plural for a count. */
const count = (value: number, one: string, many: string): string =>
  `${n(value)} ${value === 1 ? one : many}`;

/** A macOS key name is a symbol (⌘, ⇧); a click with it held is written with a hyphen
 *  ("⌘-Klick"), a Windows key name with a plus ("Strg+Klick"). */
const isSymbolKey = (key: string): boolean => /^[⌘⇧⌥⌃]$/u.test(key);
const clickWith = (key: string): string => (isSymbolKey(key) ? `${key}-Klick` : `${key}+Klick`);
/** Shift in the same writing as the command key it stands beside. */
const shiftBeside = (key: string): string => (isSymbolKey(key) ? '⇧' : 'Umschalt');

/** The portals by their web address, everywhere (a sentence never starts with one). */
const portalName: Record<Portal, string> = {
  linkedin: 'linkedin.com',
  freelance: 'freelance.de',
  freelancermap: 'freelancermap.de',
};
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
  details: 'Gerade werden schon Details geholt.',
  rescore: 'Die Jobs werden gerade neu bewertet.',
  session: 'Gerade läuft eine Anmeldung.',
  files: 'Die App schreibt gerade ihre Dateien.',
  mailbox: 'Gerade wird das Postfach geprüft.',
};

const closing: Record<Busy, string> = {
  fetch: 'Der Abruf wird beendet, dann schließt die App.',
  details: 'Das Holen der Details wird beendet, dann schließt die App.',
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
  corrupt: 'Die Daten der App sind beschädigt.',
  newerSchema: 'Die Daten stammen von einer neueren Version der App.',
  invalid: 'Die Eingabe passt nicht.',
  busy: (p) => busy[busyOf(p.activity)],
  // By what was looked for (`what`): a file or folder may never have been written (a new
  // work folder), a job or a mail is gone.
  notFound: (p) =>
    p.what === 'file'
      ? 'Die Datei ist nicht vorhanden.'
      : p.what === 'folder'
        ? 'Der Ordner ist nicht vorhanden.'
        : 'Das gibt es nicht mehr.',
  dryRun: 'Im Probelauf geht das nicht.',
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

/** Fields of the profile form, named in an error about their value (the label of the field
 *  without its unit, as everywhere: warnings, key names, the profile). */
const profileField: Record<string, string> = {
  name: 'Name',
  title: 'Rolle',
  competences: 'Kompetenzen',
  strengths: 'Besondere Stärken',
  keywords: 'Stichworte',
  years: 'Berufserfahrung',
  degrees: 'Abschlüsse',
  industries: 'Branchen',
  tools: 'Werkzeuge und Methoden',
  certificates: 'Zertifikate',
  languages: 'Sprachen',
  minDayRate: 'Mindest-Tagessatz',
  countries: 'Einsatzländer',
  contracts: 'Zeitarbeit und Festanstellung',
  remoteOutside: 'Remote-Jobs im Ausland ausschließen',
  available: 'Verfügbar ab',
  targetYears: 'Jobs ab',
  minSalary: 'Mindest-Jahresgehalt',
  permanentPlaces: 'Orte für Festanstellung',
  permanentRemoteMin: 'Mindest-Remote-Anteil',
  focus: 'Schwerpunkte',
  roles: 'Wunschrollen',
  wishDayRate: 'Wunschtagessatz',
  remote: 'Remote-Anteil',
  regions: 'Wunschregionen',
  wishIndustries: 'Wunschbranchen',
};
const fieldName = (value: unknown): string => profileField[str(value)] ?? str(value);

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

const status: Record<StatusCode, string> = {
  connectingMail: 'Verbindet mit dem Postfach',
  searchingMail: 'Sucht Alert-Mails',
  readingMails: 'Liest Alert-Mails',
  fetchingDetails: 'Holt Details',
  signingIn: 'Meldet sich an',
  waiting: 'Wartet auf das Portal',
  scoring: 'Bewertet die Jobs',
  writingFiles: 'Schreibt die Dateien',
};

/** The status of a run when the backend names the portal it is about. */
const statusAt: Partial<Record<StatusCode, (portal: string) => string>> = {
  fetchingDetails: (portal) => `Holt Details von ${portal}`,
  signingIn: (portal) => `Meldet sich bei ${portal} an`,
  waiting: (portal) => `Wartet auf ${portal}`,
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

/** What a detail state means, the same in a row's badge tooltip and in the reader (the
 *  teaser's says what the glossary word "Vorschau" is). */
const detailSays = {
  teaser: 'Ohne Anmeldung zeigt das Portal nur den Anfang der Anzeige.',
  unfetchable: 'Die Anzeige ließ sich mehrmals nicht holen.',
  gone: 'Die Anzeige ist nicht mehr online.',
  onRequest: 'Diese Details holt die App nur auf Anfrage.',
} as const;

/** Alert mails in which the app found no jobs (the overview's open points and the settings
 *  say it alike, next to the button that opens the mail to look). */
const emptyMails = (mails: number): string =>
  `${mails === 1 ? 'In einer Alert-Mail' : `In ${n(mails)} Alert-Mails`} fand die App keine Jobs.`;

/** A profile file the app cannot read (the list, the overview, the Profil view). */
const PROFILE_UNREADABLE = 'Profil nicht lesbar';

/** The run that reads every alert mail (`fullMailbox`): one name in the list, the run card
 *  and the settings. */
const FULL_MAILBOX = 'Alle Alert-Mails abrufen';

const ANUE = 'Die Anzeige nennt Arbeitnehmerüberlassung.';
const LOW_TEXT = 'Die Anzeige hat wenig Text.';
const SHORT_TEXT = 'Die Anzeige ist sehr kurz.';

/** Contract type of an ad (`contractType` params `type`, `inferred`). */
const contract = {
  interim: 'Interim',
  permanent: 'Festanstellung',
  anue: 'Arbeitnehmerüberlassung',
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

/** The remote wish of the profile (`level` of the profile editor). */
const REMOTE_LEVEL: Record<string, string> = {
  full: 'voll remote',
  mostly: 'überwiegend remote',
  partly: 'teilweise remote',
  onSite: 'vor Ort',
};

/** The ad's remote share next to the wish ("zu 60 % remote, gewünscht ist überwiegend remote"). */
function remoteWish(p: Params): string {
  if (p.state === 'unknown') return 'Die Anzeige nennt keinen Remote-Anteil.';
  const level = typeof p.level === 'string' ? REMOTE_LEVEL[p.level] : undefined;
  const wished = level ? `, gewünscht ist ${level}` : '';
  let ad: string;
  if (p.share === 0) ad = 'Der Job ist ganz vor Ort';
  else if (p.share === 100) ad = 'Der Job ist ganz remote';
  else if (typeof p.share === 'number') ad = `Der Job ist zu ${formatPercent(p.share)} remote`;
  else if (typeof p.from === 'number' && typeof p.to === 'number')
    ad = `Der Job ist zu ${str(p.from)} bis ${formatPercent(p.to)} remote`;
  else ad = 'Der Job ist teilweise remote';
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
  anueRisk: 'Ein Personaldienstleister ohne Angaben zum Vertrag, Überlassung ist möglich.',
  dayRate: (p) => `Der Tagessatz von ${formatEuro(p.rate)} liegt unter ${formatEuro(p.min)}.`,
  availability: 'Die Verfügbarkeit passt nicht.',
  country: (p): string =>
    p.allowed
      ? `Der Einsatzort liegt außerhalb von ${countryNames(p.allowed)}.`
      : 'Der Einsatzort passt nicht.',
  anueOptional: 'Arbeitnehmerüberlassung ist möglich, aber nicht Pflicht.',
  anueHidden: 'Die Anzeige deutet auf Arbeitnehmerüberlassung hin.',
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
} satisfies Record<string, Text>;
export type ReasonCode = keyof typeof reasonCode;

interface CriterionText {
  /** Short name in the criteria strip of the reader. */
  label: string;
  /** Why a job is excluded by it, in the short words of a list row. */
  short: string;
  /** Why a job is excluded by it. */
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
    exclusion: 'Der Tagessatz liegt unter dem Minimum im Profil.',
  },
  countries: {
    label: 'Einsatzländer',
    short: 'Einsatzland passt nicht',
    exclusion: 'Der Einsatzort liegt außerhalb der Länder im Profil.',
  },
  noAnue: {
    label: 'Arbeitnehmerüberlassung',
    short: 'Arbeitnehmerüberlassung',
    exclusion: ANUE,
  },
  noPermanent: {
    label: 'Festanstellung',
    short: 'Festanstellung',
    exclusion: 'Der Job ist eine Festanstellung, das Profil schließt sie aus.',
  },
  availability: {
    label: 'Verfügbarkeit',
    short: 'Start passt nicht',
    exclusion: 'Der Start passt nicht zur Verfügbarkeit.',
  },
  minSalary: {
    label: 'Jahresgehalt',
    short: 'Gehalt zu niedrig',
    exclusion: 'Das Gehalt liegt unter dem Minimum im Profil.',
  },
  permanentRegion: {
    label: 'Orte',
    short: 'Ort passt nicht',
    exclusion: 'Der Ort liegt außerhalb der Orte für Festanstellung.',
  },
  targetYears: {
    label: 'Erfahrung',
    short: 'Erfahrung passt nicht',
    exclusion: 'Der Job verlangt deutlich weniger Erfahrung.',
  },
} satisfies Record<string, CriterionText>;
export type CriterionKey = keyof typeof criteria;

export type CriterionState = 'met' | 'violated' | 'unknown' | 'unset';

/** `JobMatch.note` / `MatchDetail.summary` codes. */
const note = {
  hardCriterion: 'Ein Ausschlusskriterium greift.',
  shortText: 'Zu wenig Text für eine Bewertung.',
  lowEvidence: LOW_TEXT,
  engineFailed: 'Diese Anzeige ließ sich nicht bewerten.',
} satisfies Record<string, Text>;
export type MatchNote = keyof typeof note;

/** Names of profile keys the app speaks about (the keys themselves are an external contract):
 *  the criteria, wishes, Schwerpunkte and target roles, German and English, named like their
 *  field in the Profil form. */
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
  schwerpunkte: profileField.focus!,
  focus_areas: profileField.focus!,
  wunschrollen: profileField.roles!,
  target_roles: profileField.roles!,
  tagessatz_wunsch: profileField.wishDayRate!,
  desired_day_rate: profileField.wishDayRate!,
  remote: profileField.remote!,
  regionen: profileField.regions!,
  regions: profileField.regions!,
  // `branchen` of the wishes (the engine reports no other one).
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
  noCriteria: 'Das Profil setzt keine Ausschlusskriterien.',
  availabilityNotUnderstood: '„Verfügbar ab“ ist nicht lesbar.',
  // Keys of a criteria section the engine does not read (a typo, an unknown rule).
  ignoredKeys: (p) => `Die App liest ${joined(rawKeys(p.keys))} in den Ausschlusskriterien nicht.`,
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
    overview: 'Übersicht',
    jobs: 'Jobs',
    profile: 'Profil',
    settings: 'Einstellungen',
    /** Why the Übersicht waits during the first run. */
    overviewLater: 'Nach dem ersten Abruf',
  },
  common: {
    loading: 'Wird geladen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    remove: 'Entfernen',
    change: 'Ändern',
    open: 'Öffnen',
    copy: 'Kopieren',
    hide: 'Ausblenden',
    back: 'Zurück',
    retry: 'Erneut versuchen',
    undo: 'Rückgängig',
    openFolder: 'Ordner öffnen',
    openLog: 'Protokoll öffnen',
    /** A file shown selected in its folder, named by the file manager of the OS. */
    showInFolder: {
      explorer: 'Im Explorer zeigen',
      finder: 'Im Finder zeigen',
    } satisfies Record<'explorer' | 'finder', string>,
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
  /** The bar that replaces the list's second row while several jobs are selected. */
  selection: {
    count: (value: number) => `${n(value)} ausgewählt`,
    clear: 'Auswahl aufheben',
    /** The reader while several jobs are chosen. */
    chosen: (value: number) => `${count(value, 'Job', 'Jobs')} ausgewählt`,
    /** The key that takes a row in or out, by OS (macOS writes its symbol). */
    commandKey: { ctrl: 'Strg', cmd: '⌘' } satisfies Record<'ctrl' | 'cmd', string>,
    hint: (key: string) =>
      `${clickWith(key)} nimmt einen Job dazu oder heraus, ${clickWith(shiftBeside(key))} einen ganzen Bereich.`,
    /** Once, after a few single moves: several jobs can go at once. */
    tip: (key: string) => `Mehrere Jobs auf einmal wählst du mit ${clickWith(key)}.`,
    /** The pane names the chosen jobs, the first few, then how many more. */
    more: (value: number) => `+${n(value)}`,
    /** The pane's and the bar's words for the star and for reading. */
    pin: 'Favorit',
    read: 'Als gelesen',
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
      inbox: 'Jobs durchsuchen',
      archive: 'Archiv durchsuchen',
      trash: 'Papierkorb durchsuchen',
    } satisfies Record<Place, string>,
    /** The second header row of the archive and the trash. */
    count: {
      inbox: (value: number) => `${count(value, 'Job', 'Jobs')} unter Jobs`,
      archive: (value: number) => `${count(value, 'Job', 'Jobs')} im Archiv`,
      trash: (value: number) => `${count(value, 'Job', 'Jobs')} im Papierkorb`,
    } satisfies Record<Place, (value: number) => string>,
    /** The same row during a search: what it found there, not how many jobs lie there. */
    found: {
      inbox: (value: number, query: string) =>
        `${count(value, 'Job', 'Jobs')} zu „${query}“ unter Jobs`,
      archive: (value: number, query: string) =>
        `${count(value, 'Job', 'Jobs')} zu „${query}“ im Archiv`,
      trash: (value: number, query: string) =>
        `${count(value, 'Job', 'Jobs')} zu „${query}“ im Papierkorb`,
    } satisfies Record<Place, (value: number, query: string) => string>,
    /** Search hits in another place: a button under the results that goes there. */
    hitsIn: {
      inbox: (value: number) => `Im Eingang (${n(value)})`,
      archive: (value: number) => `Im Archiv (${n(value)})`,
      trash: (value: number) => `Im Papierkorb (${n(value)})`,
    } satisfies Record<Place, (value: number) => string>,
    /** The quiet line under the title of a job that is not in the inbox. */
    inArchive: 'Im Archiv',
    inTrash: 'Im Papierkorb',
    /** The same words as the trash's own sentence (`trashFor`): "endgültig gelöscht". */
    inTrashLeft: (days: number) =>
      `Im Papierkorb, wird in ${count(days, 'Tag', 'Tagen')} endgültig gelöscht`,
    inTrashSoon: 'Im Papierkorb, wird bald endgültig gelöscht',
    empty: {
      inbox: 'Keine Jobs.',
      archive: 'Das Archiv ist leer.',
      trash: 'Der Papierkorb ist leer.',
    } satisfies Record<Place, string>,
    /** The reader of the archive and the trash while no job is open. */
    reader: {
      archive: 'Archivierte Jobs bleiben hier, bis du sie zurückholst.',
      trash:
        'Jobs im Papierkorb bleiben hier, bis du sie wiederherstellst oder den Papierkorb leerst.',
    } satisfies Record<Exclude<Place, 'inbox'>, string>,
    trashFor: (days: number) =>
      `Jobs im Papierkorb werden nach ${count(days, 'Tag', 'Tagen')} endgültig gelöscht.`,
  },
  /** What a job can do where it is: one name and icon on a row, in the reader, in the bar. */
  actions: {
    archive: 'Archivieren',
    /** Back into the inbox (the toast says "zurückgeholt"): a verb, not a way back. */
    toInbox: 'Zurück in den Eingang',
    trash: 'In den Papierkorb',
    restore: 'Wiederherstellen',
    purge: 'Endgültig löschen',
    /** The confirm button of a dialog is the bare verb of its heading. */
    purgeConfirm: 'Löschen',
    purgeHeading: (value: number) =>
      value === 1 ? 'Job endgültig löschen?' : `${n(value)} Jobs endgültig löschen?`,
    /** One job, named. */
    purgeOne: (name: string) => `„${name}“ endgültig löschen?`,
    purgeText: 'Endgültig gelöschte Jobs kommen nicht wieder, auch nicht mit alten Alert-Mails.',
    emptyTrash: 'Papierkorb leeren',
    emptyTrashConfirm: 'Leeren',
    emptyTrashHeading: 'Papierkorb leeren?',
    emptyTrashText: (value: number) =>
      value === 1
        ? 'Der Job wird endgültig gelöscht und kommt nicht wieder.'
        : `Die ${n(value)} Jobs werden endgültig gelöscht und kommen nicht wieder.`,
    markAllRead: 'Alle als gelesen markieren',
    /** The text button of the list header (during a search: its hits). */
    allRead: 'Alle gelesen',
    hitsRead: 'Ergebnisse gelesen',
  },
  /** The app's own menus (their accessible names and the entries of the job's menu). */
  menu: {
    job: 'Job',
    open: 'Öffnen',
    unread: 'Als ungelesen markieren',
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
  /** Key names of Windows in shortcuts (macOS writes symbols, platform.ts). */
  keys: {
    ctrl: 'Strg',
    shift: 'Umschalt',
    del: 'Entf',
    enter: 'Eingabe',
    home: 'Pos1',
    end: 'Ende',
  },
  /** The card of the keys (Ctrl+/ or Cmd+/): what a key does, in a few words each. */
  keysHelp: {
    heading: 'Tastenkürzel',
    close: 'Schließen',
    everywhere: 'Überall',
    list: 'In der Jobliste',
    /** Ctrl+1 to Ctrl+4: the two keys around the word. */
    range: (first: string, last: string) => `${first} bis ${last}`,
    views: 'Bereich wählen',
    search: 'Suchen',
    fetch: 'Abrufen',
    undo: 'Rückgängig',
    menu: 'Menü öffnen',
    back: 'Zurück',
    help: 'Tastenkürzel zeigen',
    step: 'Voriger oder nächster Job',
    edge: 'Erster oder letzter Job',
    extend: 'Mehrere Jobs wählen',
    archive: 'Archivieren',
    trash: 'In den Papierkorb',
    star: 'Favorit',
    unread: 'Als ungelesen markieren',
    openAd: 'Anzeige öffnen',
    closeJob: 'Job schließen',
  },
  field: {
    reveal: 'Passwort zeigen',
    conceal: 'Passwort verbergen',
    clear: 'Suche leeren',
  },
  score: {
    /** `Passung 87 %` - the number comes formatted from format.ts. */
    value: (percent: string) => `Passung ${percent}`,
    excluded: 'Ausgeschlossen',
    /** Aria label part of a ring whose score comes from a teaser only. */
    provisional: 'vorläufig',
    unscorable: 'Nicht bewertbar',
    pending: 'Wird bewertet',
    none: 'Noch nicht bewertet',
    /** A ring without a usable profile. */
    off: 'Ohne Profil keine Passung',
    band: {
      high: 'Hohe Passung',
      mid: 'Mittlere Passung',
      low: 'Geringe Passung',
    } satisfies Record<Band, string>,
  },
  reason: {
    kind: {
      met: 'Erfüllt',
      partial: 'Teilweise erfüllt',
      open: 'Nicht im Profil',
      violation: 'Ausschlussgrund',
      check: 'Prüfen',
    } satisfies Record<ReasonKind, string>,
    weight: {
      must: 'Pflicht',
      nice: 'Optional',
      hard: 'Ausschluss',
      info: 'Hinweis',
    } satisfies Record<ReasonWeight, string>,
    /** The line under a reason: only the profile's side (the ad's words stand above it). */
    evidenceLine: (profile: string, partial: boolean) =>
      partial ? `Passt teilweise zu „${profile}“ im Profil.` : `Passt zu „${profile}“ im Profil.`,
    /** Tooltip of a reason: the ad's words and what the profile says. */
    evidence: (quote: string, profile: string, partial: boolean) =>
      partial
        ? `„${quote}“ passt teilweise zu „${profile}“ im Profil.`
        : `„${quote}“ passt zu „${profile}“ im Profil.`,
    missing: (quote: string) => `„${quote}“ steht nicht im Profil.`,
    code: reasonCode,
  },
  job: {
    /** The round checkbox over a row's ring (it takes the row into the choice). */
    choose: 'Auswählen',
    /** An excluded job the user counts anyway (its row's quiet badge). */
    included: 'Einbezogen',
    workMode: {
      remote: 'Remote',
      hybrid: 'Hybrid',
      onsite: 'Vor Ort',
    } satisfies Record<WorkMode, string>,
    /** Badge per DetailState kind (`ok` shows none). */
    detail: {
      pending: 'Details folgen',
      teaser: 'Nur Vorschau',
      failed: 'Details fehlen',
      unfetchable: 'Nicht erreichbar',
      gone: 'Nicht mehr online',
      onRequest: 'Details auf Anfrage',
    } satisfies Record<Exclude<DetailState['kind'], 'ok'>, string>,
    /** What a detail badge means, in its tooltip. */
    detailHint: {
      pending: 'Die ganze Anzeige ist noch nicht geholt.',
      teaser: detailSays.teaser,
      failed: 'Die ganze Anzeige ließ sich nicht holen.',
      unfetchable: detailSays.unfetchable,
      gone: detailSays.gone,
      onRequest: detailSays.onRequest,
    } satisfies Record<Exclude<DetailState['kind'], 'ok'>, string>,
    /** The ad's page says it takes no applications any more (badge and its tooltip). */
    closed: 'Keine Bewerbung mehr möglich',
    closedHint: 'Die Anzeige ist noch lesbar, nimmt aber keine Bewerbungen mehr an.',
    unread: 'Neu',
    pinned: 'Favorit',
    /** The date column of a row in the Papierkorb: how long until it empties itself. */
    trashLeft: (days: number) => `noch ${count(days, 'Tag', 'Tage')}`,
    trashSoon: 'bald gelöscht',
    alsoOn: (portals: string) => `auch auf ${portals}`,
    untitled: 'Job ohne Titel',
  },
  toolbar: {
    fetch: 'Abrufen',
    cancel: 'Abbrechen',
    progress: 'Fortschritt des Abrufs',
    /** The switch Neu, Alle, Favoriten ("Auswahl" is the multi-selection's word). */
    facet: 'Ansicht',
    facetNew: 'Neu',
    facetAll: 'Alle',
    facetSaved: 'Favoriten',
    /** The menu of the sort button (its accessible name). */
    sortMenu: 'Sortierung',
    /** The order of the list in words (the sort button). */
    sortLabel: {
      match: 'Nach Passung',
      newest: 'Nach Datum',
    } satisfies Record<JobSort, string>,
    /** The order without a usable profile: there is no fit to sort by. */
    sortNoProfile: 'Ohne Profil nur nach Datum.',
    needsMailbox: 'Verbinde erst ein Postfach.',
    /** Every portal is switched off in Einstellungen: nothing to fetch from. */
    needsPortal: 'Schalte erst ein Portal ein.',
  },
  run: {
    never: 'Noch kein Abruf',
    /** The clipboard refused the history. */
    historyNotCopied: 'Der Verlauf ließ sich nicht kopieren.',
    step: {
      scan: 'Postfach',
      fetch: 'Details',
      score: 'Bewertung',
      export: 'Dateien',
    } satisfies Record<Step, string>,
    /** The status, naming the portal where the backend says which one. */
    statusOf: (code: StatusCode, portal: Portal | null): string => {
      const at = portal === null ? undefined : statusAt[code];
      return at !== undefined && portal !== null ? at(portalName[portal]) : status[code];
    },
    /** After the rolling number of a step counter: "von 7". */
    ofTotal: (total: number) => `von ${n(total)}`,
    newPill: (value: number) => `${n(value)} neu`,
    topPill: (value: number) => `${n(value)} mit hoher Passung`,
    resumesIn: (ms: number) => `Weiter in ${formatCountdown(ms)}`,
    /** A pause whose end has come: the portal goes on in a moment. */
    resumesSoon: 'Geht gleich weiter',
    /** A portal's line while a run goes, when it has no countdown. */
    portalRuns: 'Läuft',
    portalPaused: 'Pausiert',
    portalSignIn: 'Anmeldung nötig',
    portalLayout: 'Seiten sehen anders aus',
    /** A portal's line after a fetch ("linkedin.com 4 neu, 2 doppelt, 3 ohne Details"). */
    portalNew: (value: number) => `${n(value)} neu`,
    portalDup: (value: number) => `${n(value)} doppelt`,
    portalNoDetails: (value: number) => `${n(value)} ohne Details`,
    portalNothing: 'nichts Neues',
    kind: {
      fetch: 'Abruf',
      details: 'Details holen',
      rescore: 'Neu bewerten',
      fullMailbox: FULL_MAILBOX,
    } satisfies Record<RunKindName, string>,
    done: 'Abruf fertig',
    rescored: 'Neu bewertet',
    nothingNew: 'Nichts Neues seit dem letzten Abruf.',
    cancelled: 'Abruf abgebrochen',
    failed: 'Abruf fehlgeschlagen',
    /** A details run (the reader's "Details holen"): its title, what it did not get. */
    details: {
      done: 'Details geholt',
      none: 'Keine Details geholt',
      cancelled: 'Details holen abgebrochen',
      failed: 'Details holen fehlgeschlagen',
      failedAds: (value: number) =>
        `${count(value, 'Anzeige ließ', 'Anzeigen ließen')} sich nicht holen.`,
      goneAds: (value: number) =>
        `${count(value, 'Anzeige ist', 'Anzeigen sind')} nicht mehr online.`,
    },
    /** A rescore the card speaks about (only when something went wrong). */
    rescore: {
      cancelled: 'Bewertung abgebrochen',
      failed: 'Bewertung fehlgeschlagen',
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
      overviewHtml: 'Die Übersicht ließ sich nicht schreiben.',
      txt: 'Nicht alle Textdateien ließen sich schreiben.',
      txtFolder: 'Der Ordner der Textdateien ist nicht erreichbar.',
      backup: 'Die alte Excel-Datei ließ sich nicht sichern, die neue wurde nicht geschrieben.',
      /** The work folder itself (a drive that is gone): nothing was written. */
      workspace: 'Der Arbeitsordner ist nicht erreichbar.',
    },
    skipped: (value: number) => `${count(value, 'Job folgt', 'Jobs folgen')} beim nächsten Abruf.`,
    filesFailed: (value: number) =>
      count(value, 'Datei ließ', 'Dateien ließen') + ' sich nicht schreiben.',
    /** The old program's Excel file, renamed before the app wrote its own (by its name). */
    excelRenamed: (name: string) => `Die alte Excel-Datei heißt jetzt ${name}.`,
    openOverview: 'Bericht öffnen',
    history: 'Verlauf',
    alert: (portal: Portal, postings: number) =>
      `Alert-Mail von ${portalName[portal]} mit ${count(postings, 'Job', 'Jobs')}`,
    /** A line of the history when a portal's health changes. */
    health: (portal: Portal, kind: Exclude<PortalHealth['kind'], 'ok'>): string => {
      const name = portalName[portal];
      switch (kind) {
        case 'paused':
          return `Pause bei ${name}`;
        case 'quotaReached':
          return `Limit bei ${name} erreicht`;
        case 'layoutSuspect':
          return `Seiten von ${name} sehen anders aus als erwartet`;
        case 'loginRequired':
          return `Anmeldung bei ${name} nötig`;
      }
    },
    checkMailbox: 'Postfach prüfen',
  },
  list: {
    label: 'Jobs',
    /** The folding section at the end of every place (its count in brackets where known). */
    excluded: 'Ausgeschlossen',
    /** By match: the jobs still waiting for their score, a small group on top. */
    pendingSection: 'Noch ohne Passung',
    /** Under Neu: the jobs first seen in the last fetch, then the older unread ones. */
    freshSection: 'Seit dem letzten Abruf',
    olderSection: 'Früher',
    /** A row excluded by a formal requirement the ad makes mandatory (`formalOpen` with its
     *  `class`), in the short words of the criteria. */
    formalMissing: {
      degree: 'Abschluss fehlt',
      licence: 'Zulassung fehlt',
    },
    /** FR-03: while the first fetch runs, the empty list only says what comes (the rows
     *  arrive during the fetch, each once its details are in). */
    emptyWhileRun: 'Die Jobs erscheinen hier nach und nach.',
    createAlert: (portal: string) => `Alert auf ${portal} anlegen`,
    readOlder: FULL_MAILBOX,
    emptyNew: 'Keine neuen Jobs.',
    emptyFavourites: 'Noch keine Favoriten.',
    emptyAll: 'Nach dem ersten Abruf stehen die Jobs hier.',
    emptyAfterRun: 'Die Alert-Mails enthielten bisher keine Jobs.',
    noHit: (query: string) => `Keine Jobs zu „${query}“.`,
    /** A search under Neu or Favoriten that Alle would find. */
    noHitIn: {
      new: (query: string) => `Keine neuen Jobs zu „${query}“.`,
      favourites: (query: string) => `Keine Favoriten zu „${query}“.`,
    },
    searchAll: 'In allen suchen',
    showAll: 'Alle zeigen',
    loadFailed: 'Die Jobliste ließ sich nicht laden.',
    pageFailed: 'Weitere Jobs ließen sich nicht laden.',
    createProfile: 'Profil anlegen',
    openProfile: 'Profil öffnen',
    noMailbox: 'Ohne Postfach kommen keine neuen Jobs dazu.',
    /** No usable profile: said once, at the top of the list. */
    noProfile: 'Ohne Profil gibt es keine Passung.',
    profileUnreadable: PROFILE_UNREADABLE,
    profileEmpty: 'Profil ohne Kompetenzen',
    profileBrokenText: 'Die Jobs zeigen deshalb keine Passung.',
    /** A profile the app understands little of: one calm line on top of the list. */
    thinProfile: 'Wenig Inhalt im Profil, die Passung bleibt grob.',
    connectMailbox: 'Postfach verbinden',
  },
  /** The key facts of an ad in short words (list row, criteria chips). */
  facts: {
    now: 'ab sofort',
    from: (date: string) => `ab ${date}`,
    months: (value: number) => count(value, 'Monat', 'Monate'),
    remote: (from: number, to: number) => {
      if (from >= 100) return 'voll remote';
      if (to <= 0) return 'vor Ort';
      return from === to
        ? `${formatPercent(from)} remote`
        : `${n(from)} bis ${formatPercent(to)} remote`;
    },
    /** `1.100 €`, with the unit `1.100 €/Tag`, per hour `95 €/Std.`, `1.000 CHF/Tag`. */
    rate: (amount: number, hourly: boolean, currency: string | null, unit: boolean) => {
      const money = formatMoney(amount, currency);
      return hourly ? `${money}/Std.` : unit ? `${money}/Tag` : money;
    },
    rateOpen: 'Satz nach Absprache',
    fullRemote: 'voll remote',
  },
  reader: {
    mustMet: (met: number, total: number, partial = 0) =>
      `${n(met)} von ${n(total)} Pflicht erfüllt` +
      (partial > 0 ? `, ${n(partial)} teilweise` : ''),
    noMust: 'Keine Pflichtanforderungen erkannt',
    /** The block "Anforderungen": the must line, then how many optional ones are missing. */
    requirements: 'Anforderungen',
    requirementsLine: (must: string, niceMissing: number) =>
      niceMissing > 0
        ? `${must} · ${n(niceMissing)} optional ${niceMissing === 1 ? 'fehlt' : 'fehlen'}`
        : must,
    /** A must requirement the profile lacks: the term goes into the profile's keywords. */
    addToProfile: 'Zum Profil hinzufügen',
    added: 'Hinzugefügt',
    addedToProfile: (term: string) => `„${term}“ zum Profil hinzugefügt.`,
    /** The label of the table of the ad's terms. */
    frame: 'Konditionen',
    /** The rows of the terms table, in their order (features/jobs/terms.ts). */
    term: {
      contract: 'Vertragsart',
      rate: 'Tagessatz',
      start: 'Start',
      duration: 'Laufzeit',
      remote: 'Remote',
      place: 'Ort',
      experience: 'Erfahrung',
    },
    /** The value of a term the ad does not state. */
    termOpen: 'offen',
    /** The contract type in the row "Vertragsart" (it carries the verdicts on temporary
     *  agency work and permanent jobs; a check without a type says "unklar"). */
    contractKind: {
      interim: 'Interim',
      freelance: 'Freiberuflich',
      permanent: 'Festanstellung',
      anue: 'Zeitarbeit',
      unclear: 'unklar',
    },
    rateOpen: 'nach Absprache',
    years: (min: number, max: number | null) =>
      max !== null && max > min
        ? `${n(min)} bis ${count(max, 'Jahr', 'Jahre')}`
        : count(min, 'Jahr', 'Jahre'),
    /** Quiet after a value: required years no passage backs, a contract type the engine
     *  infers. */
    estimated: 'geschätzt',
    assumed: 'vermutet',
    /** The profile's side of a row, quiet under the ad's value (its wishes merged in). */
    profileSide: {
      rate: (min: number | null, wish: number | null) =>
        [
          min === null ? '' : `Minimum ${formatEuro(min)}`,
          wish === null ? '' : `Wunsch ${formatEuro(wish)}`,
        ]
          .filter((part) => part !== '')
          .join(', '),
      start: (date: string | null) =>
        date === null ? 'Verfügbar ab sofort' : `Verfügbar ab ${date}`,
      remote: (level: RemoteWish) => `Wunsch ${REMOTE_LEVEL[level] ?? level}`,
      place: (countries: string, regions: readonly string[]) =>
        [
          countries === '' ? '' : countryNames(countries),
          regions.length === 0 ? '' : `Wunsch ${joined([...regions])}`,
        ]
          .filter((part) => part !== '')
          .join(', '),
    },
    /** Whether a term of the ad fits the profile, in a word (the table's third column). */
    verdict: {
      met: 'passt',
      violated: 'passt nicht',
      unknown: 'prüfen',
      unset: 'offen',
    } satisfies Record<CriterionState, string>,
    /** A marked passage of the ad under the pointer: its state and weight ("Erfüllt ·
     *  Pflicht"), or the row of the terms and its verdict. */
    markHint: (what: string, state: string) => `${what} · ${state}`,
    criterion: criteria,
    note,
    open: 'Anzeige öffnen',
    close: 'Schließen',
    /** The star as a labelled button (its state is its pressed look). */
    favourite: 'Favorit',
    pin: 'Als Favorit markieren',
    unpin: 'Favorit entfernen',
    archive: 'Archivieren',
    restore: 'Wiederherstellen',
    /** The "…" button and its menu. */
    more: 'Weitere Aktionen',
    markUnread: 'Als ungelesen markieren',
    /** An excluded job: its passage, counting it anyway, and back. */
    showInAd: 'In der Anzeige zeigen',
    override: 'Trotzdem einbeziehen',
    overrideUndo: 'Rückgängig',
    overridden: 'Manuell einbezogen',
    prompt: 'KI-Prompt kopieren',
    /** The clipboard refused the prompt. */
    promptNotCopied: 'Der Prompt ließ sich nicht kopieren.',
    /** Under the band of a score that comes from a preview only. */
    preliminary: 'Vorläufig, nur Vorschau',
    /** The band of a job whose ad is still to come. */
    scoredLater: 'Wird bewertet, sobald die Anzeige da ist',
    mail: OPEN_MAIL,
    noMail: 'Zu diesem Job gibt es keine Alert-Mail.',
    /** The preview note names the portal; the sign-in is set up in Einstellungen. */
    teaserOf: (portal: string) => `Ohne Anmeldung zeigt ${portal} nur eine Vorschau.`,
    setUpSignIn: 'Anmeldung einrichten',
    promptNoProfile: 'Ohne Profil gibt es nichts zu bewerten.',
    promptNoText: 'Der Text der Anzeige fehlt noch.',
    /** The exact moment of the mail, in the tooltip of its date. */
    mailAt: (date: string, time: string) => `Alert-Mail vom ${date} um ${time}`,
    fetchDetails: 'Details holen',
    /** The ad of a job whose details are still to come. */
    fetchNow: 'Jetzt holen',
    why: 'Anforderungen im Detail',
    met: 'Erfüllt',
    partial: 'Teilweise erfüllt',
    missing: 'Nicht im Profil',
    check: 'Zu prüfen',
    violations: 'Ausgeschlossen',
    noReasons: 'Die Anzeige nennt keine klaren Anforderungen.',
    ad: 'Anzeige',
    detail: {
      pending: 'Die Anzeige fehlt noch.',
      teaser: detailSays.teaser,
      failed: 'Die Details ließen sich nicht holen.',
      unfetchable: detailSays.unfetchable,
      gone: detailSays.gone,
      onRequest: detailSays.onRequest,
    } satisfies Record<Exclude<DetailState['kind'], 'ok'>, string>,
    /** A closed or vanished ad, since the app saw it so (when it knows). */
    offline: 'Anzeige offline',
    offlineSince: (date: string) => `Anzeige offline seit ${date}`,
    detailsOff: '„Details holen“ ist für dieses Portal aus.',
    short: SHORT_TEXT,
    loadFailed: 'Der Job ließ sich nicht laden.',
  },
  overview: {
    noProfileText: 'Mit einem Profil zeigt jeder Job, wie gut er passt.',
    profileUnreadable: PROFILE_UNREADABLE,
    label: 'Übersicht',
    /** The first block: what is new since the last fetch, as counts that lead into the list. */
    since: 'Seit dem letzten Abruf',
    tileNew: 'Neu',
    tileHigh: 'Hohe Passung',
    tileExcluded: 'Ausgeschlossen',
    fetchedAt: (when: string) => `Abgerufen ${when}`,
    today: 'Heute ansehen',
    allNew: (value: number) => `Alle ${n(value)} neuen`,
    favourites: 'Favoriten',
    decide: 'Braucht eine Entscheidung',
    noDetail: (value: number) =>
      value === 1 ? '1 Job ohne ganze Anzeige' : `${n(value)} Jobs ohne ganze Anzeige`,
    fetchDetails: 'Details holen',
    excludedCheck: (value: number) =>
      value === 1 ? '1 Job ausgeschlossen' : `${n(value)} Jobs ausgeschlossen`,
    look: 'Ansehen',
    /** Shown in the empty reader when the overview has nothing else to say (like Mail's "no message selected"). */
    pick: 'Wähle links einen Job aus.',
    issues: 'Offene Punkte',
    best: 'Neu und passend',
    excel: 'Excel-Datei öffnen',
    /** The best matches as one prompt for any AI chat. */
    promptTop: 'Prompt für KI-Vergleich kopieren',
    /** Its tooltip: what goes into it (favourites first, read or not). */
    promptTopHint: 'Kopiert deine Favoriten und die besten Jobs mit dem Profil als einen Prompt.',
    /** No scored job and no favourite to compare yet. */
    promptTopNone: 'Noch ist kein Job bewertet.',
    /** When the list beside shows the best new jobs on top already. */
    bestInList: 'Die besten neuen Jobs stehen oben in der Liste.',
    files: 'Dateien',
    /** Under the portal's name, so the sentence does not name it again; next to the button
     *  that opens the mail. */
    emptyAlerts: emptyMails,
    lastRun: 'Letzter Abruf',
    /** The jobs marked "Beworben", with when and the note. */
    applied: 'Beworben',
    appliedWhen: (days: number) =>
      days === 0
        ? 'Beworben heute'
        : days === 1
          ? 'Beworben gestern'
          : `Beworben vor ${n(days)} Tagen`,
    adClosed: 'Anzeige geschlossen',
    /** The musts the profile lacks most often (30 days). */
    openMusts: 'Oft verlangt, nicht im Profil',
    inJobs: (value: number) => `in ${n(value)} Jobs`,
    addToProfile: 'Zum Profil hinzufügen',
    /** The market of the last seven days. */
    market: 'Markt',
    marketNew: 'Neu in 7 Tagen',
    marketRate: 'Tagessatz passender Jobs',
    marketRateValue: (median: string, jobs: number) =>
      `${median} im Mittel aus ${count(jobs, 'Job', 'Jobs')}`,
    marketMin: (value: string) => `dein Minimum ${value}`,
    marketRemote: 'Überwiegend remote',
    marketRemoteValue: (share: number, known: number) =>
      `${formatPercent(share)} von ${count(known, 'Job', 'Jobs')}`,
    /** A portal whose alert mails stopped (none for a week). */
    quietSince: (when: string) => `Seit ${when} keine Alert-Mail.`,
    quietNever: 'Noch keine Alert-Mail angekommen.',
  },
  health: {
    /** A portal problem in one sentence that says whether to act, the same in the run card,
     *  the day overview and the settings. */
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
    /** Under the error of a profile that no longer reads. */
    replaces: 'Ein neues Profil ersetzt die Datei.',
    create: 'Profil anlegen',
    fromCv: 'Aus Lebenslauf anlegen',
    /** The same way for a profile that exists: the answer fills the form for review. */
    updateFromCv: 'Aus Lebenslauf aktualisieren',
    pick: 'Profildatei wählen',
    pickOther: 'Andere Datei wählen',
    /** The accessible name of the head's menu (Andere Datei wählen, Ordner öffnen, Entfernen). */
    more: 'Weitere Aktionen',
    remove: 'Entfernen',
    /** Removing needs no question: the toast offers Rückgängig. */
    removed: 'Profil entfernt.',
    /** The moment like every moment of the app (`21.09. 09:30`, the time alone today). */
    savedAt: (moment: string) => `Gespeichert ${moment}`,
    unnamed: 'Profil ohne Namen',
    quality: {
      good: 'Vollständig',
      thin: 'Wenig Inhalt',
      empty: 'Ohne Kompetenzen',
    } satisfies Record<ProfileQuality, string>,
    qualityText: {
      good: 'Die Passung stützt sich auf das ganze Profil.',
      thin: 'Wenige Kompetenzen, die Passung bleibt grob.',
      empty: 'Ohne Kompetenzen wird nichts bewertet.',
    } satisfies Record<ProfileQuality, string>,
    rescoring: (value: number) => `${count(value, 'Job wird', 'Jobs werden')} neu bewertet.`,
    rescored: 'Gespeichert, Jobs neu bewertet.',
    /** Values of the file that do not read and a rule that stays off: a click goes to the
     *  first one. */
    check: (value: number) => count(value, 'Wert prüfen', 'Werte prüfen'),
    next: 'Weiter zum ersten Abruf',
    /** The head's stats line, the same word as in "So liest die App dein Profil". */
    understood: (terms: number) => count(terms, 'Suchbegriff', 'Suchbegriffe'),
    focusCount: (focus: number) => count(focus, 'Schwerpunkt', 'Schwerpunkte'),
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
    } as Record<string, string>,
    draft: {
      new: 'Neues Profil',
      file: 'Profil aus einer Datei',
      answer: 'Profil aus dem Lebenslauf',
      update: 'Profil mit dem Lebenslauf aktualisiert',
    },
    unsaved: 'Nicht gespeichert',
    review: 'Prüfe die Angaben und speichere sie.',
    save: 'Speichern',
    discard: 'Verwerfen',
    /** Why Speichern and Verwerfen wait. */
    noChanges: 'Noch nichts geändert.',
    saved: 'Gespeichert.',
    leaveHeading: 'Änderungen speichern?',
    /** Why another file or an update waits while the form holds changes. */
    saveFirst: 'Erst speichern oder verwerfen.',
    empty: 'Noch leer',
    section: {
      person: 'Person',
      criteria: 'Konditionen',
      competences: 'Kompetenzen',
      experience: 'Erfahrung und Qualifikation',
      languages: 'Sprachen',
      wishes: 'Wünsche',
      permanent: 'Festanstellung',
      understood: 'So liest die App dein Profil',
    },
    /** One sentence per block: what it is for. */
    sectionHint: {
      person: 'Die Rolle zählt für die Passung.',
      competences: 'Nur dieser Block ist nötig, danach bewertet die App jeden Job.',
      experience: 'Damit prüft die App, was eine Anzeige verlangt.',
      languages: 'Die App vergleicht sie mit den Sprachen einer Anzeige.',
      wishes: 'Wünsche verschieben die Passung leicht, sie schließen nichts aus.',
      criteria: 'Ein Job, der hier nicht passt, gilt als ausgeschlossen.',
      permanent: 'Diese Regeln gelten nur für Festanstellungen.',
      understood: 'Damit vergleicht die App jede Anzeige.',
    },
    field: {
      name: 'Name',
      namePlaceholder: 'Vor- und Nachname',
      title: 'Rolle',
      titlePlaceholder: 'z. B. Interim Manager',
      roles: 'Wunschrollen',
      rolesHint: 'Passt der Titel einer Anzeige dazu, steigt die Passung leicht.',
      rolesPlaceholder: 'z. B. Interim CFO',
      competence: 'Kompetenz',
      competencePlaceholder: 'z. B. Projektleitung',
      years: 'Jahre',
      yearsHint: 'Die Jahre zählen, wenn eine Anzeige Erfahrung in Jahren verlangt.',
      aliases: 'Synonyme',
      aliasesHint: 'Andere Wörter für dieselbe Kompetenz, auch englische.',
      aliasesPlaceholder: 'Synonyme',
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
      strengthsHint: 'Sie stützen die Passung, belegen aber keine Anforderung.',
      strengthsPlaceholder: 'z. B. Teams durch Veränderungen führen',
      keywords: 'Stichworte',
      keywordsPlaceholder: 'z. B. Transformation',
      keywordsHint: 'Begriffe, die in passenden Anzeigen stehen.',
      totalYears: 'Berufserfahrung',
      totalYearsHint: 'Ab zehn Jahren bewertet die App Jobs für Einsteiger niedrig.',
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
      levelHint: 'Ohne Niveau rechnet die App mit B2.',
      addLanguage: 'Sprache hinzufügen',
      removeLanguage: (name: string) => `${name || 'Sprache'} entfernen`,
      wishRate: 'Wunschtagessatz',
      wishRateHint: 'Den Mindest-Tagessatz legen die Konditionen fest.',
      remote: 'Remote-Anteil',
      regions: 'Wunschregionen',
      regionsPlaceholder: 'z. B. München',
      wishIndustries: 'Wunschbranchen',
      wishIndustriesPlaceholder: 'z. B. Energie',
      minDayRate: 'Mindest-Tagessatz',
      countries: 'Einsatzländer',
      countriesPlaceholder: 'Land suchen',
      /** Typed text that names no country the app knows. */
      countryNone: 'Kein Land mit diesem Namen.',
      /** One click for Deutschland, Österreich and Schweiz. */
      dach: 'DACH hinzufügen',
      remoteOutside: 'Remote-Jobs im Ausland ausschließen',
      remoteOutsideOff: 'Wähle erst die Einsatzländer.',
      noAnue: 'Zeitarbeit ausschließen',
      noPermanent: 'Festanstellung ausschließen',
      noPermanentHint: 'Nur bei klarem Wortlaut, sonst markiert die App den Job zum Prüfen.',
      available: 'Verfügbar ab',
      availableHint: 'Beginnt ein Job früher, markiert die App ihn zum Prüfen.',
      /** The option of a single choice that leaves it open (Remote-Anteil, Verfügbar ab). */
      open: 'Offen',
      date: 'Datum',
      datePlaceholder: '01.11.2026',
      dateInvalid: 'Gib das Datum im Format 01.11.2026 ein.',
      /** A day in the right format that the calendar does not have (31.02.2026). */
      dateImpossible: 'Diesen Tag gibt es nicht.',
      /** "Jobs ab 15 Jahren Erfahrung": jobs for far less experience are excluded. */
      targetYears: 'Jobs ab',
      minSalary: 'Mindest-Jahresgehalt',
      places: 'Orte für Festanstellung',
      placesPlaceholder: 'z. B. München',
      remoteMin: 'Mindest-Remote-Anteil',
      remoteMinHint:
        'Außerhalb der Orte für Festanstellung braucht ein Job mindestens diesen Remote-Anteil.',
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
      unreadableRole: (value: string) => `„${value}“ ist keine Rolle, die die App kennt.`,
      removeValue: 'Wert entfernen',
    },
    /** The unit right of a number field. */
    unit: {
      euro: '€',
      years: 'Jahre',
      /** "Jobs ab 15 Jahren Erfahrung". */
      experience: 'Jahren Erfahrung',
      percent: '%',
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
    /** What a level means, in the tooltip of its button. */
    levelMeaning: {
      a1: 'Anfänger',
      a2: 'Grundkenntnisse',
      b1: 'Mittelstufe',
      b2: 'Gute Kenntnisse',
      c1: 'Fließend',
      c2: 'Verhandlungssicher',
      native: 'Muttersprache',
    } satisfies Record<LanguageLevel, string>,
    remoteWish: {
      full: 'Ganz remote',
      mostly: 'Überwiegend remote',
      partly: 'Teilweise remote',
      onSite: 'Vor Ort',
    } satisfies Record<RemoteWish, string>,
    /** Nothing chosen means no availability (pressing the chosen one again clears it). */
    availability: {
      now: 'Sofort',
      from: 'Ab Datum',
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
    /** "So liest die App dein Profil": what the engine reads in the file. */
    reading: {
      termsLabel: 'Suchbegriffe',
      more: (value: number) => `und ${n(value)} weitere`,
      sources: 'Gelesen aus',
      /** A part of the file the form does not show (career stations and the like). */
      fileOnly: (name: string) => `${name}, nur in der Datei`,
      years: 'Berufserfahrung',
      yearsValue: (value: number) => count(value, 'Jahr', 'Jahre'),
      /** After the label "Jobs ab" (dative): `15 Jahren Erfahrung`. */
      yearsFrom: (value: number) => `${count(value, 'Jahr', 'Jahren')} Erfahrung`,
      degrees: 'Abschlüsse',
      packs: 'Fachwortschatz',
      criteria: 'Konditionen',
      none: 'Keine',
      from: (value: string) => `ab ${value}`,
      excluded: 'ausgeschlossen',
      stale: 'Das gilt für den gespeicherten Stand.',
      /** Parts of the profile file by their key (an external contract), in the form's words. */
      source: {
        titel: 'Rolle',
        kernkompetenzen: 'Kompetenzen',
        methoden_tools: 'Werkzeuge und Methoden',
        zertifizierungen: 'Zertifikate',
        branchen: 'Branchen',
        sprachen: 'Sprachen',
        alleinstellungsmerkmale: 'Besondere Stärken',
        keywords: 'Stichworte',
        abschluss: 'Abschlüsse',
        ausbildung: 'Abschlüsse',
        schwerpunkte: 'Schwerpunkte',
        stationen: 'Stationen',
        projekte: 'Projekte',
      } as Record<string, string>,
    },
    paste: {
      privacy: 'Der Lebenslauf geht an die KI, die du nutzt.',
      copied: 'Der Prompt ist kopiert.',
      copyFailed: 'Der Prompt ließ sich nicht kopieren.',
      copy: 'Prompt kopieren',
      copyAgain: 'Erneut kopieren',
      step: 'Füge ihn in eine KI ein und hänge den Lebenslauf an.',
      preview: 'Prompt ansehen',
      answer: 'Antwort der KI',
      take: 'Übernehmen',
      /** Why Übernehmen waits. */
      takeEmpty: 'Füge erst die Antwort der KI ein.',
      /** The steps close (an answer pasted so far stays for the next time). */
      close: 'Schließen',
    },
  },
  settings: {
    mailbox: 'Postfach',
    /** The section of what the app does on its own: archive, empty the trash. */
    automatic: 'Automatisch',
    portals: 'Portale',
    files: 'Dateien',
    maintenance: 'Wartung',
    connected: 'Verbunden',
    notConnected: 'Kein Postfach verbunden.',
    /** The last fetch could not reach Gmail, or Gmail refused the password. */
    unreachable: 'Nicht erreichbar',
    refused: 'Abgelehnt',
    mailRefused: 'Gmail lehnt Adresse oder App-Passwort ab, trag sie über „Ändern“ neu ein.',
    vault: {
      windowsCredentialManager:
        'Das App-Passwort liegt in der Windows-Anmeldeinformationsverwaltung.',
      macosKeychain: 'Das App-Passwort liegt im macOS-Schlüsselbund.',
    } satisfies Record<VaultKind, string>,
    address: 'Gmail-Adresse',
    password: 'App-Passwort',
    createPassword: 'App-Passwort erstellen',
    /** Under both fields: what an app password is and needs (the pages follow). */
    twoStep: 'Ein App-Passwort hat 16 Buchstaben und braucht die Bestätigung in zwei Schritten.',
    addressMissing: 'Die Gmail-Adresse fehlt.',
    passwordMissing: 'Das App-Passwort fehlt.',
    /** Google's own words for its 2-step verification. */
    twoStepAction: 'Bestätigung in zwei Schritten einschalten',
    connect: 'Verbinden',
    /** A changed mailbox is saved (said under its row). */
    mailboxSaved: 'Postfach verbunden.',
    removeMailbox: 'Postfach entfernen?',
    removeMailboxText: 'Das App-Passwort wird gelöscht, die Jobs bleiben.',
    autoArchive: 'Jobs nach 30 Tagen archivieren',
    autoArchiveHint: 'Favoriten werden nie archiviert.',
    autoEmptyTrash: 'Papierkorb nach 30 Tagen leeren',
    autoEmptyTrashHint: 'Jobs im Papierkorb werden dann endgültig gelöscht.',
    active: 'Aktiv',
    details: 'Details holen',
    /** Once at the top of the portals: what "Details holen" is for. */
    portalsHint: 'Ohne „Details holen“ bekommen die Jobs eines Portals keine Passung.',
    needsDetails: 'Schalte erst „Details holen“ ein.',
    /** The sign-in row of a portal that offers one. */
    loginHint: 'Zeigt ganze Anzeigen.',
    quota: (used: number, cap: number) => `Heute ${n(used)} von ${n(cap)} Seiten`,
    quotaHour: (used: number, cap: number) => `Diese Stunde ${n(used)} von ${n(cap)} Seiten`,
    /** The sign-in row of a portal: its label, and its state. */
    session: 'Anmeldung',
    signedIn: 'Angemeldet',
    /** A portal that is off. */
    portalOff: 'Wird beim Abruf übersprungen.',
    signIn: 'Anmelden',
    signOut: 'Abmelden',
    openPortal: 'Im Browser öffnen',
    signInWaiting: 'Das Anmeldefenster ist offen.',
    workspace: 'Arbeitsordner',
    workspaceDefault: 'Standard',
    excel: 'Excel-Datei',
    excelMissing: 'Die Excel-Datei entsteht beim ersten Abruf.',
    /** The HTML file of the favourites and new matches. */
    overview: 'Bericht',
    txt: 'Textdateien',
    /** What the text files are (one per ad) and what they are for, with their number. */
    txtCount: (value: number) =>
      `${count(value, 'Anzeige', 'Anzeigen')} als Text für eine KI-Bewertung`,
    /** After a change of the work folder: only new text files are written there by themselves. */
    txtLeftBehind: 'Die Textdateien liegen noch im alten Ordner, „Neu schreiben“ legt sie hier an.',
    txtNone: 'Es gibt keine Textdateien.',
    txtRewrite: 'Neu schreiben',
    txtClear: 'Löschen',
    txtWritten: (value: number) => `${count(value, 'Datei', 'Dateien')} geschrieben.`,
    txtFailed: (value: number) => `${count(value, 'Datei ist', 'Dateien sind')} gerade geöffnet.`,
    txtCleared: (value: number) => `${count(value, 'Datei', 'Dateien')} gelöscht.`,
    txtClearHeading: 'Textdateien löschen?',
    /** A deleted text file is never written again by a fetch (core `mark_txt_written`). */
    txtClearText: 'Nur „Neu schreiben“ holt sie zurück.',
    fullMailbox: FULL_MAILBOX,
    fullMailboxHint: 'Liest alle Alert-Mails, nicht nur die neuen.',
    fullMailboxAction: 'Abrufen',
    fullMailboxConfirm: 'Abrufen',
    fullMailboxHeading: 'Alle Alert-Mails abrufen?',
    fullMailboxText: 'Das dauert länger und holt mehr Seiten der Portale.',
    logs: 'Protokoll',
    data: 'Daten der App',
    reset: 'Alles zurücksetzen',
    /** Everything core's reset deletes: the database, the profile, the keychain entry, the
     *  portal sign-ins; the dialog adds the app's files in the work folder. */
    resetHint: 'Löscht Jobs, Einstellungen, Profil, App-Passwort und Anmeldungen.',
    resetAction: 'Zurücksetzen',
    resetHeading: 'Alles zurücksetzen?',
    resetText: 'Die App startet danach neu und löscht',
    /** Everything the reset deletes, one item each (the dialog's list). */
    resetItems: [
      'die Jobs und die Einstellungen',
      'das Profil',
      'das App-Passwort',
      'die Anmeldungen bei den Portalen',
      'Excel-Datei, Bericht und Textdateien im Arbeitsordner',
    ] as string[],
    resetDone: 'Die App ist zurückgesetzt.',
    /** What stayed can be a file, a folder, the app password or a sign-in: "Element". */
    resetPartly: (value: number) =>
      `Die App ist zurückgesetzt, ${count(value, 'Element ließ', 'Elemente ließen')} sich nicht löschen.`,
    running: 'Ein Abruf läuft gerade.',
    dryRun: 'Probelauf, es werden keine Daten verändert.',
    language: 'Sprache',
    /** Excel file and report are written at the next fetch (the text files stay German). */
    languageHint: 'Excel-Datei und Bericht folgen beim nächsten Abruf.',
    /** Each language in its own words, the same in both catalogs. */
    languageName: {
      de: 'Deutsch',
      en: 'English',
    } satisfies Record<Language, string>,
    /** The card of the app's keys (their names follow the OS, platform.ts keyLabel). */
    keys: {
      heading: 'Tastenkürzel',
      overview: 'Übersicht',
      jobs: 'Jobs',
      profile: 'Profil',
      settings: 'Einstellungen',
      search: 'Suchen',
      undo: 'Rückgängig',
      archive: 'Archivieren',
      trash: 'In den Papierkorb',
      favourite: 'Favorit',
      unread: 'Gelesen oder ungelesen',
      applied: 'Beworben',
      openAd: 'Anzeige öffnen',
      fetch: 'Abrufen',
    },
  },
  firstRun: {
    benefit: 'Die App liest die Alert-Mails aus Gmail und zeigt, welche Jobs zum Profil passen.',
    privacy: 'Alles bleibt auf diesem Rechner.',
    steps: 'Erste Schritte',
    mailbox: 'Postfach',
    /** Where the jobs come from: the portals by name, in the app's order (`Portal::ALL`). */
    mailboxText: `Die Alerts von ${joined(Object.values(portalName))} müssen an diese Gmail-Adresse${NBSP}gehen.`,
    /** Per portal after connecting: its page to set up an alert. */
    createAlert: 'Alert anlegen',
    profile: 'Profil',
    profileText: 'Das Profil entsteht in der App, auf Wunsch aus dem Lebenslauf.',
    /** The empty form instead of the steps with an AI. */
    selfFill: 'Selbst ausfüllen',
    fetch: 'Erster Abruf',
    fetchHint: 'Der erste Abruf liest die Alerts der letzten 30 Tage und dauert ein paar Minuten.',
  },
  shell: {
    loadFailed: 'Die App konnte ihre Daten nicht laden.',
    /** The sidebar's run status, one line: the time today, the date on another day. */
    last: (iso: string) => `Abgerufen ${formatStamp(iso)}`,
    showRun: 'Abruf anzeigen',
    runFailed: (iso: string) => `Fehlgeschlagen ${formatStamp(iso)}`,
    runCancelled: (iso: string) => `Abgebrochen ${formatStamp(iso)}`,
    /** Closing while the app is busy: the window waits until what holds it has stopped. */
    closing: (activity: string | null) => closing[busyOf(activity)],
  },
  toast: {
    rescored: 'Jobs neu bewertet.',
    copied: 'Kopiert.',
    /** The job, or the best matches, as a prompt for any AI chat (no brand named). */
    prompt: 'Prompt kopiert.',
    archivedOne: (name: string) => `„${name}“ archiviert.`,
    trashedOne: (name: string) => `„${name}“ in den Papierkorb gelegt.`,
    trashedMany: (value: number) => `${n(value)} Jobs in den Papierkorb gelegt.`,
    inboxOne: (name: string) => `„${name}“ zurückgeholt.`,
    inboxMany: (value: number) => `${n(value)} Jobs zurückgeholt.`,
    restoredMany: (value: number) => `${n(value)} Jobs wiederhergestellt.`,
    allRead: 'Alle als gelesen markiert.',
    archivedMany: (value: number) => `${n(value)} Jobs archiviert.`,
    restored: (name: string) => `„${name}“ wiederhergestellt.`,
    /** Only a deletion for good says "endgültig". */
    deletedOne: (name: string) => `„${name}“ endgültig gelöscht.`,
    deletedMany: (value: number) => `${n(value)} Jobs endgültig gelöscht.`,
    trashEmptied: 'Papierkorb geleert.',
    runDone: (value: number) =>
      value === 0
        ? 'Abruf fertig, nichts Neues.'
        : `Abruf fertig, ${count(value, 'neuer Job', 'neue Jobs')}.`,
    runDoneFilesOld: 'Abruf fertig, die Dateien sind nicht aktuell.',
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
