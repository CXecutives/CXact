// The reader's "Jobdetails": what each row reads (TERMS). One entry per row of the facts table
// (lib/facts.ts, its order and icons): the engine's reason codes and the profile's criteria it
// stands for, when it shows, and how it reads the ad's value. A row says only what the ad says
// (its facts, else the value the engine read into a criterion; "–" where it says nothing), and
// a verdict when there is a match to judge by: the worst of its criteria and reasons. The row
// shows the value and the verdict only (user, 2026-09-28: no tooltip on it).
//
// One check per fact: a row is judged by its own criteria and codes only. A requirement that
// states a row's value ("Mindestens 15 Jahre Berufserfahrung im Controlling" states the years)
// gives the row its value (`claims`), and keeps its own verdict among the "Anforderungen". A
// requirement that is nothing but the row's fact (general experience, "10 Jahre
// Berufserfahrung") is the row's own (`owns`): it judges the row and is not listed again. The
// pay row reads the codes and the criterion of the pay that applies only: a salary is never
// judged by a day rate wish, a day rate never by the minimum salary.

import type { IconName } from '$components/Icon.svelte';
import { TERM_ROWS, modeWords, startWords, termIcon, type TermKey } from '$lib/facts';
import { formatDay, formatMoment, formatStamp } from '$lib/i18n/format';
import type { CriterionKey, TermVerdict } from '$lib/i18n/de';
import { t } from '$lib/i18n/t';
import { criterionKey } from '$lib/i18n/texts';
import type { JobView, KeyFacts, Reason, TextRange } from '$lib/ipc/types';
import { placeOf } from '$lib/place';
import { hourlyOf, rateOf, salaryOf } from './pay';
import { criterionVerdict, isRequirement, reasonVerdict, worst, type Judgement } from './verdicts';
import { byYears, generalYears, yearsJudgement, yearsOf } from './years';

export type { TermKey };
export type Verdict = TermVerdict;
type ContractWord = keyof typeof t.reader.contractKind;

export interface TermRow {
  key: TermKey;
  name: string;
  /** The icon of its fact (lib/facts.ts). */
  icon: IconName;
  /** The ad's value in words ("1.200 €/Tag"), or "–". */
  value: string;
  /** A value of several parts, each copied on its own (the contact: name, e-mail, phone). */
  parts: readonly string[] | null;
  /** The part that is an e-mail address (the contact's): a new mail to it. */
  mail: string | null;
  /** The ad does not state it. */
  missing: boolean;
  /** A quiet word after the value: estimated, assumed, no longer online. */
  note: string | null;
  /** The value is due within a week or past (a deadline): it shows in red. */
  urgent: boolean;
  /** Null: nothing to judge (no match, or nothing decides the row). */
  verdict: Exclude<Verdict, 'unset'> | null;
  /** The verdict is a hard criterion the ad violates: it excludes the job. */
  excludes: boolean;
}

/** Where the ad's facts live (the one line that changes when they move to the job itself). */
const factsOf = (job: JobView): KeyFacts | null => job.match?.facts ?? null;

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A deadline this many days ahead or fewer (or past) shows in red. */
const URGENT_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Contract {
  kind: ContractWord;
  /** The engine infers the type from the words of the ad. */
  inferred: boolean;
  /** Employment pay (a permanent job, temporary agency work): a salary, no day rate. */
  employment: boolean;
}

/** What a row reads from, for one job. */
interface Context {
  job: JobView;
  facts: KeyFacts | null;
  contract: Contract;
  /** The row's criterion by its key, the row's reason by its code. */
  criterion: (key: CriterionKey) => Reason | undefined;
  code: (name: string) => Reason | undefined;
  /** The requirements the row claims. */
  claimed: readonly Reason[];
  /** A passage of the text shown states the value (else a number is the engine's estimate). */
  stated: boolean;
  now: Date;
  offline: Offline | null;
}

/** The ad is gone or takes no applications; since when, if the app knows (an ISO moment). */
export interface Offline {
  since: string | null;
}

interface Value {
  value: string | null;
  parts?: readonly string[];
  mail?: string | null;
  note?: string | null;
  urgent?: boolean;
  /** False: the row takes no verdict (the duration of a permanent job). */
  judged?: boolean;
  /** What judges the row besides its criteria and codes (a requirement of years). */
  judges?: readonly Judgement[];
}

/** The engine's codes and the profile's criteria a row stands for. */
interface Checks {
  codes: readonly string[];
  criteria: readonly CriterionKey[];
}

interface Term extends Checks {
  /** Employment pays a salary: then these checks instead. */
  employment?: Checks;
  /** Requirements that state the row's value (its value, never its verdict). */
  claims?: (reason: Reason) => boolean;
  /** Requirements that are the row's fact and nothing else: judged in the row, never listed
   *  again among the Anforderungen. */
  owns?: (reason: Reason) => boolean;
  /** Reasons that tell the value only, never the verdict. */
  quiet?: (reason: Reason) => boolean;
  /** Whether the row shows for this job (always without). */
  shows?: (ctx: Context) => boolean;
  /** Its name for this job (the catalog's `reader.term` without). */
  name?: (ctx: Context) => string;
  read: (ctx: Context) => Value;
}

const NONE: Checks = { codes: [], criteria: [] };

/** What each row reads; their order is the facts table's. */
const TERMS: Record<TermKey, Term> = {
  company: { ...NONE, read: ({ job }) => ({ value: text(job.company) }) },
  place: {
    codes: ['country', 'countryUnclear', 'regionWish', 'permanentRegion', 'permanentRegionUnclear'],
    criteria: ['countries', 'permanentRegion'],
    read: ({ job }) => ({ value: text(placeOf(job.location)) }),
  },
  mode: {
    codes: ['remoteWish'],
    criteria: [],
    read: ({ job }) => ({ value: modeWords(job) }),
  },
  contract: {
    codes: ['contractType', 'anue', 'anueRisk', 'anueOptional', 'anueHidden', 'permanent'],
    criteria: ['noAnue', 'noPermanent'],
    // The type itself, and that the job sounds permanent while the profile does not exclude
    // it, only tell (a guessed type says so in its quiet note).
    quiet: (reason) =>
      reason.code === 'contractType' ||
      (reason.code === 'permanent' && reason.params.excluded !== true),
    read: ({ contract }) =>
      contract.kind === 'unclear'
        ? { value: null }
        : {
            value: t.reader.contractKind[contract.kind],
            note: contract.inferred ? t.reader.assumed : null,
          },
  },
  // The pay: a day rate (or an hourly one), or the annual salary of employment.
  rate: {
    codes: ['dayRate', 'dayRateCurrency', 'dayRateWish'],
    criteria: ['minDayRate'],
    employment: { codes: ['salary', 'salaryUnknown'], criteria: ['minSalary'] },
    name: ({ contract, facts, criterion }) => {
      if (contract.employment) return t.reader.salaryName;
      return hourlyOf(facts, criterion('minDayRate')?.params ?? {})
        ? t.reader.hourlyName
        : t.reader.term.rate;
    },
    read: ({ facts, criterion, code, contract }) =>
      contract.employment
        ? salaryOf(facts, { ...criterion('minSalary')?.params, ...code('salary')?.params })
        : rateOf(facts, criterion('minDayRate')?.params ?? {}),
  },
  start: {
    codes: ['availability', 'availabilityGap', 'startVague'],
    criteria: ['availability'],
    read: ({ facts, criterion }) => {
      const start = facts?.start ?? text(criterion('availability')?.params.start);
      return { value: start === null ? null : startWords(start) };
    },
  },
  duration: {
    codes: ['duration'],
    criteria: ['duration'],
    read: ({ facts, criterion, contract }) => {
      // Months or weeks as the ad states them, a range with its lower end.
      const p = criterion('duration')?.params ?? {};
      const known = facts !== null && (facts.months !== null || facts.weeks !== undefined);
      const weeks = known ? (facts.weeks ?? null) : num(p.weeks);
      const months = known ? facts.months : num(p.months);
      const from = known ? (facts.durationFrom ?? null) : num(p.from);
      if (weeks) return { value: t.facts.duration(weeks, from, 'week') };
      if (months) return { value: t.facts.duration(months, from, 'month') };
      // A permanent job has no end: nothing to compare.
      return contract.kind === 'permanent'
        ? { value: t.facts.unlimited, judged: false }
        : { value: null };
    },
  },
  workload: {
    codes: ['workload'],
    criteria: ['workload'],
    read: ({ facts, criterion }) => {
      const p = criterion('workload')?.params ?? {};
      const fromFacts = facts?.workloadTo !== undefined;
      const to = fromFacts ? (facts?.workloadTo ?? null) : num(p.to);
      const from = fromFacts ? (facts?.workloadFrom ?? null) : num(p.from);
      return { value: to === null ? null : t.facts.workload(from, to) };
    },
  },
  // The years of experience the ad asks for (a range as a range), or the junior level it names:
  // judged against the profile's own years.
  experience: {
    codes: ['overqualified', 'seniorityUnclear'],
    criteria: [],
    owns: generalYears,
    // Years in a topic ("3 Jahre S/4HANA") give the row its value only where the ad asks no
    // general experience; they keep their verdict among the Anforderungen.
    claims: (reason) => isRequirement(reason) && num(reason.params.years) !== null,
    read: ({ code, claimed, stated }) => {
      const own = claimed.filter(generalYears).sort(byYears)[0];
      const topic = claimed.filter((reason) => !generalYears(reason)).sort(byYears)[0];
      const level = code('overqualified') ?? code('seniorityUnclear');
      // The years the row shows: the general experience, else the years that make the job a
      // junior one, else the most a topic asks for; the requirement that states them judges
      // the row where the profile has years to judge them by.
      const years = [own, num(level?.params.years) !== null ? level : undefined, topic].find(
        (reason) => reason !== undefined,
      );
      if (years !== undefined) {
        const min = yearsOf(years);
        const max = num(years.params.max);
        const source = years === level ? claimed.find((r) => yearsOf(r) === min) : years;
        return {
          value: t.facts.years(min, max),
          // Required years no passage backs are the engine's estimate.
          note: stated ? null : t.reader.estimated,
          judges: yearsJudgement(source),
        };
      }
      const word = text(level?.params.level);
      return { value: word === null ? null : t.facts.level(word) };
    },
  },
  deadline: {
    ...NONE,
    read: ({ facts, now }) => {
      const day = text(facts?.deadline);
      const shown = day === null ? '' : formatDay(day, now);
      if (day === null || shown === '') return { value: null };
      // Whole days from today to the deadline, both at local midnight.
      const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
      const due = new Date(year, month - 1, date).getTime();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { value: shown, urgent: Math.round((due - today) / DAY_MS) <= URGENT_DAYS };
    },
  },
  contact: {
    ...NONE,
    read: ({ facts }) => {
      const parts = [facts?.contactName, facts?.contactEmail, facts?.contactPhone].flatMap(
        (part) => text(part) ?? [],
      );
      return parts.length === 0
        ? { value: null }
        : { value: parts.join(', '), parts, mail: text(facts?.contactEmail) };
    },
  },
  industry: {
    codes: ['industryWish'],
    criteria: [],
    // Only where the profile wishes industries (the engine then names the ad's).
    shows: ({ code }) => code('industryWish') !== undefined,
    read: ({ code }) => ({ value: text(code('industryWish')?.params.industry) }),
  },
  // How and when the job came (user decision 2026-10-01: "Gefunden"): the search of its
  // source, its alert mail, both, then the sources it is also on and the moment; quietly
  // after them an ad that is no longer online (once, here).
  portal: {
    ...NONE,
    read: ({ job, offline, now }) => {
      const since = offline?.since ? formatDay(offline.since, now) : '';
      const own = t.portal[job.portal];
      const ways = job.origins.map((origin) =>
        origin === 'search' ? t.reader.foundSearch(own) : t.reader.foundMail(own),
      );
      const also = job.alsoOn
        .filter((portal) => portal !== job.portal)
        .map((portal) => t.portal[portal]);
      // When it came: the alert mail's moment, else its first sighting ("16:49",
      // "gestern 08:12"), at the end.
      const when = formatMoment(job.mailDate ?? job.firstSeenAt, now);
      return {
        value: [
          ...(ways.length > 0 ? ways : [own]),
          ...(also.length > 0 ? [t.job.alsoOn(also.join(', '))] : []),
          ...(when === '' ? [] : [when]),
        ].join(', '),
        note:
          offline === null ? null : since === '' ? t.reader.offline : t.reader.offlineSince(since),
      };
    },
  },
  // The day of the alert mail in the list row's words ("gestern", "Do 24.09.").
  // Hidden (user, 2026-10-01: "Eingegangen" says nothing for a job the search found): the
  // day stands in the row "Gefunden".
  received: {
    ...NONE,
    shows: () => false,
    read: ({ job, now }) => ({ value: text(formatStamp(job.mailDate ?? job.firstSeenAt, now)) }),
  },
};

const KEYS: readonly TermKey[] = TERM_ROWS.map((row) => row.key);

/** The row of each reason code, whatever the pay (a reason a row stands for is never listed
 *  again). */
const ROW_OF_CODE: ReadonlyMap<string, TermKey> = new Map(
  KEYS.flatMap((key) =>
    [...TERMS[key].codes, ...(TERMS[key].employment?.codes ?? [])].map(
      (code) => [code, key] as const,
    ),
  ),
);

/** The row a reason of the match stands for, or null (a requirement keeps its place among the
 *  Anforderungen even when it states a row's value, unless it is the row's fact alone). */
export function rowOf(reason: Reason): TermKey | null {
  return ROW_OF_CODE.get(reason.code) ?? KEYS.find((key) => TERMS[key].owns?.(reason)) ?? null;
}

function contractOf(
  facts: KeyFacts | null,
  reasons: readonly Reason[],
  criteria: readonly Reason[],
): Contract {
  const stated = reasons.find((reason) => reason.code === 'contractType');
  const type =
    text(stated?.params.type) ??
    text(facts?.contract) ??
    criteria.map((reason) => text(reason.params.contract)).find((value) => value !== null) ??
    'unclear';
  const kind: ContractWord = type in t.reader.contractKind ? (type as ContractWord) : 'unclear';
  return {
    kind,
    inferred: stated?.params.inferred === true,
    employment: kind === 'permanent' || kind === 'anue',
  };
}

export interface TermInput {
  job: JobView;
  /** The match's reasons and the profile's criteria (empty without a match). */
  reasons: readonly Reason[];
  criteria: readonly Reason[];
  /** A match to judge by: without one no row has a verdict. */
  withVerdict: boolean;
  /** The length of the ad's text shown: passages lie within it. */
  textLength: number;
  /** The page's clock (a deadline near, the day of the alert mail in words). */
  now: Date;
  /** The ad is no longer online (null: it is, or the app does not know otherwise). */
  offline?: Offline | null;
}

/** The rows of the table for one job, in the facts table's order. */
export function termRows(input: TermInput): TermRow[] {
  const facts = factsOf(input.job);
  const contract = contractOf(facts, input.reasons, input.criteria);
  return KEYS.flatMap((key) => {
    const row = build(key, input, facts, contract);
    return row === null ? [] : [row];
  });
}

function build(
  key: TermKey,
  input: TermInput,
  facts: KeyFacts | null,
  contract: Contract,
): TermRow | null {
  const term = TERMS[key];
  const checks = (contract.employment ? term.employment : undefined) ?? term;
  const criteria = input.criteria.filter((reason) => {
    const key = criterionKey(reason.code);
    return key !== null && checks.criteria.includes(key);
  });
  const claimed = input.reasons.filter((reason) => term.claims?.(reason) === true);
  const reasons = input.reasons.filter((reason) => checks.codes.includes(reason.code));
  const shown = (range: TextRange): boolean =>
    range.start < range.end && range.end <= input.textLength;
  /** A passage of the text shown states the value. */
  const stated = [...criteria, ...reasons, ...claimed].some((reason) => reason.ranges.some(shown));
  const ctx: Context = {
    job: input.job,
    facts,
    contract,
    criterion: (key) => criteria.find((reason) => criterionKey(reason.code) === key),
    code: (name) => reasons.find((reason) => reason.code === name),
    claimed,
    stated,
    now: input.now,
    offline: input.offline ?? null,
  };
  if (term.shows && !term.shows(ctx)) return null;
  const read = term.read(ctx);
  const missing = read.value === null;
  // A criterion names the reason that decided it (core view::criteria_strip).
  const linkedOf = (criterion: Reason): Reason | undefined => {
    const id = text(criterion.params.reason);
    return id === null ? undefined : input.reasons.find((reason) => reason.id === id);
  };
  const linked = new Set(criteria.map((criterion) => linkedOf(criterion)?.id ?? ''));
  const judged =
    input.withVerdict && read.judged !== false
      ? worst([
          ...criteria.map((criterion) => {
            const decided = linkedOf(criterion);
            const verdict = criterionVerdict(criterion, decided);
            return {
              verdict,
              excludes: criterion.kind === 'violation',
            };
          }),
          ...(read.judges ?? []),
          ...reasons
            .filter((reason) => !linked.has(reason.id) && term.quiet?.(reason) !== true)
            .flatMap((reason) => {
              const verdict = reasonVerdict(reason);
              return verdict === null ? [] : [{ verdict, excludes: reason.kind === 'violation' }];
            }),
        ])
      : null;
  const verdict = judged === null || judged.verdict === 'unset' ? null : judged;
  return {
    key,
    name: term.name?.(ctx) ?? t.reader.term[key],
    icon: termIcon(key, input.job),
    value: read.value ?? t.reader.missing,
    parts: missing ? null : (read.parts ?? null),
    mail: missing ? null : (read.mail ?? null),
    missing,
    note: missing ? null : (read.note ?? null),
    urgent: !missing && read.urgent === true,
    verdict: verdict === null ? null : (verdict.verdict as Exclude<Verdict, 'unset'>),
    excludes: verdict?.excludes === true,
  };
}
