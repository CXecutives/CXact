// The reader's "Jobdetails": what each row reads (TERMS). One entry per row of the facts table
// (lib/facts.ts, its order and icons): the engine's reason codes and the profile's criteria it
// stands for, when it shows, and how it reads the ad's value. A row says only what the ad says
// (its facts, else the value the engine read into a criterion; "/" where it says nothing), and
// a verdict when there is a match to judge by: the worst of its criteria and reasons, with the
// sentence of the reason that decided it as the verdict's tooltip.
//
// One check per fact, so a row and a requirement never disagree: a requirement that states a
// row's value ("Mindestens 15 Jahre Berufserfahrung im Controlling" states the years) belongs
// to that row (`claims`). The row is judged by it together with its criterion, and the list of
// "Anforderungen" leaves it out (`rowOf`), like the day rate's findings. The pay row reads the
// codes and the criterion of the pay that applies only: a salary is never judged by a day rate
// wish, a day rate never by the minimum salary.

import type { IconName } from '$components/Icon.svelte';
import { TERM_ROWS, modeWords, startWords, termIcon, type TermKey } from '$lib/facts';
import { formatDay } from '$lib/i18n/format';
import type { CriterionKey, TermVerdict } from '$lib/i18n/de';
import { t } from '$lib/i18n/t';
import { criterionKey, reasonHint, reasonText } from '$lib/i18n/texts';
import type { JobView, KeyFacts, Reason } from '$lib/ipc/types';
import { placeOf } from '$lib/place';

export type { TermKey };
export type Verdict = TermVerdict;
type ContractWord = keyof typeof t.reader.contractKind;

export interface TermRow {
  key: TermKey;
  name: string;
  /** The icon of its fact (lib/facts.ts). */
  icon: IconName;
  /** The ad's value in words ("1.200 €/Tag"), or "/". */
  value: string;
  /** The ad does not state it. */
  missing: boolean;
  /** A quiet word after the value: estimated, assumed. */
  note: string | null;
  /** Null: nothing to judge (no match, or nothing decides the row). */
  verdict: Exclude<Verdict, 'unset'> | null;
  /** The sentence of the reason that decided the verdict (its tooltip), if one did. */
  why: string | null;
}

/** Where the ad's facts live (the one line that changes when they move to the job itself). */
const factsOf = (job: JobView): KeyFacts | null => job.match?.facts ?? null;

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The engine's requirements: the ad's own words, judged against the profile's skills. */
const REQUIREMENTS: readonly string[] = ['requirement', 'term'];
const isRequirement = (reason: Reason): boolean => REQUIREMENTS.includes(reason.code);

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
}

interface Value {
  value: string | null;
  note?: string | null;
  /** False: the row takes no verdict (the duration of a permanent job). */
  judged?: boolean;
}

/** The engine's codes and the profile's criteria a row stands for. */
interface Checks {
  codes: readonly string[];
  criteria: readonly CriterionKey[];
}

interface Term extends Checks {
  /** Employment pays a salary: then these checks instead. */
  employment?: Checks;
  /** Requirements that state the row's value (judged in the row, never listed again). */
  claims?: (reason: Reason) => boolean;
  /** Codes that give the value only, never the verdict. */
  valueOnly?: readonly string[];
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
    valueOnly: ['contractType'],
    read: ({ contract }) =>
      contract.kind === 'unclear'
        ? { value: null }
        : {
            value: t.reader.contractKind[contract.kind],
            note: contract.inferred ? t.reader.assumed : null,
          },
  },
  // The pay: a day rate, or the annual salary of employment.
  rate: {
    codes: ['dayRate', 'dayRateCurrency', 'dayRateWish'],
    criteria: ['minDayRate'],
    employment: { codes: ['salary', 'salaryUnknown'], criteria: ['minSalary'] },
    name: ({ contract }) => (contract.employment ? t.reader.salaryName : t.reader.term.rate),
    read: ({ facts, criterion, code, contract }) => {
      if (contract.employment) {
        const p = { ...criterion('minSalary')?.params, ...code('salary')?.params };
        const stated = num(facts?.salary);
        const amount = stated ?? num(p.salary);
        if (amount === null) return { value: null };
        const lower = stated === null ? p.lowerBound === true : facts?.salaryLowerBound === true;
        return {
          value: t.facts.pay(amount, 'year', stated === null ? text(p.currency) : null, lower),
        };
      }
      const p = criterion('minDayRate')?.params ?? {};
      const stated = typeof facts?.rate === 'number' ? facts : null;
      const rate = stated?.rate ?? num(p.rate);
      if (rate === null) {
        const agreed = facts?.rateOpen === true || p.rateOpen === true;
        return { value: agreed ? t.facts.agreed : null };
      }
      const hourly = (stated ? stated.hourly : p.hourly) === true;
      const currency = stated ? stated.currency : text(p.currency);
      return { value: t.facts.pay(rate, hourly ? 'hour' : 'day', currency) };
    },
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
      const months = facts?.months ?? num(criterion('duration')?.params.months);
      if (months) return { value: t.facts.months(months) };
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
  experience: {
    codes: ['tooJunior', 'seniorityUnclear', 'overqualified'],
    criteria: ['targetYears'],
    // A requirement that names years of experience.
    claims: (reason) => isRequirement(reason) && num(reason.params.years) !== null,
    read: ({ criterion, code, claimed, stated }) => {
      const said = [
        criterion('targetYears'),
        code('tooJunior'),
        code('overqualified'),
        ...claimed,
      ].find((reason) => num(reason?.params.years) !== null);
      const years = num(said?.params.years);
      return {
        value: years === null ? null : t.facts.years(years, num(said?.params.max)),
        // Required years no passage backs are the engine's estimate.
        note: stated ? null : t.reader.estimated,
      };
    },
  },
  industry: {
    codes: ['industryWish'],
    criteria: [],
    // Only where the profile wishes industries (the engine then names the ad's).
    shows: ({ code }) => code('industryWish') !== undefined,
    read: ({ code }) => ({ value: text(code('industryWish')?.params.industry) }),
  },
  portal: {
    ...NONE,
    read: ({ job }) => ({
      value: [job.portal, ...job.alsoOn.filter((portal) => portal !== job.portal)]
        .map((portal) => t.portal[portal])
        .join(', '),
    }),
  },
  received: {
    ...NONE,
    read: ({ job }) => ({ value: text(formatDay(job.mailDate ?? job.firstSeenAt)) }),
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

/** The row a reason of the match stands for or that claims it, or null. */
export function rowOf(reason: Reason): TermKey | null {
  return ROW_OF_CODE.get(reason.code) ?? KEYS.find((key) => TERMS[key].claims?.(reason)) ?? null;
}

/** Wishes of the profile (`params.state` met, near, missed or unknown). */
const WISHES: readonly string[] = ['dayRateWish', 'remoteWish', 'regionWish', 'industryWish'];
/** Checks that compare a stated value with a limit of the profile: the value is known and
 *  misses the limit (it is met in part), unlike a check of what the ad leaves unclear. */
const LIMITS: readonly string[] = ['workload', 'duration', 'availabilityGap'];

/** What a reason says about its row: a missed or near wish and a missed limit are met in
 *  part, a check of an unclear ad is unclear; a requirement says what the Anforderungen say
 *  (one the profile lacks is not met). */
function reasonVerdict(reason: Reason): Verdict | null {
  if (WISHES.includes(reason.code)) {
    const state = reason.params.state;
    if (state === 'met') return 'met';
    return state === 'near' || state === 'missed' ? 'partial' : null;
  }
  switch (reason.kind) {
    case 'violation':
      return 'violated';
    case 'partial':
      return 'partial';
    case 'check':
      return LIMITS.includes(reason.code) ? 'partial' : 'unknown';
    case 'met':
      return 'met';
    case 'open':
      return isRequirement(reason) ? 'violated' : null;
  }
}

/** A criterion's state; the reason that decided it says how (an over-qualified job meets the
 *  target years in part, a workload outside the profile's days is a limit missed). */
function criterionVerdict(criterion: Reason, linked: Reason | undefined): Verdict {
  const own: Verdict =
    criterion.kind === 'violation'
      ? 'violated'
      : criterion.kind === 'check'
        ? 'unknown'
        : criterion.kind === 'partial'
          ? 'partial'
          : criterion.kind === 'open'
            ? 'unset'
            : 'met';
  // The engine leaves a criterion open when only a finding decides it (a job asking fewer
  // years than the target, a start to be agreed): that finding says the verdict.
  if (linked === undefined || own === 'violated') return own;
  return reasonVerdict(linked) ?? own;
}

/** The worse verdict first; of two alike, one with a sentence. */
const WEIGHT: Record<Verdict, number> = { violated: 4, unknown: 3, partial: 2, met: 1, unset: 0 };

interface Judgement {
  verdict: Verdict;
  why: string | null;
}

function worst(all: readonly Judgement[]): Judgement | null {
  return all.reduce<Judgement | null>((out, next) => {
    if (out === null || WEIGHT[next.verdict] > WEIGHT[out.verdict]) return next;
    return WEIGHT[next.verdict] === WEIGHT[out.verdict] && out.why === null && next.why !== null
      ? next
      : out;
  }, null);
}

/** Why a reason decides a row: a requirement in the ad's words against the profile's, any
 *  other reason in its sentence. */
function sentence(reason: Reason | undefined): string | null {
  if (reason === undefined) return null;
  const hint = isRequirement(reason) ? reasonHint(reason) : null;
  return hint ?? (reasonText(reason) || null);
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
  const reasons = [
    ...input.reasons.filter((reason) => checks.codes.includes(reason.code)),
    ...claimed,
  ];
  const ctx: Context = {
    job: input.job,
    facts,
    contract,
    criterion: (key) => criteria.find((reason) => criterionKey(reason.code) === key),
    code: (name) => reasons.find((reason) => reason.code === name),
    claimed,
    stated: [...criteria, ...reasons].some((reason) =>
      reason.ranges.some((range) => range.end <= input.textLength),
    ),
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
            return { verdict: criterionVerdict(criterion, decided), why: sentence(decided) };
          }),
          ...reasons
            .filter((reason) => !linked.has(reason.id) && !term.valueOnly?.includes(reason.code))
            .flatMap((reason) => {
              const verdict = reasonVerdict(reason);
              return verdict === null ? [] : [{ verdict, why: sentence(reason) }];
            }),
        ])
      : null;
  const verdict = judged === null || judged.verdict === 'unset' ? null : judged;
  return {
    key,
    name: term.name?.(ctx) ?? t.reader.term[key],
    icon: termIcon(key, input.job),
    value: read.value ?? t.reader.missing,
    missing,
    note: missing ? null : (read.note ?? null),
    verdict: verdict === null ? null : (verdict.verdict as Exclude<Verdict, 'unset'>),
    why: verdict?.why ?? null,
  };
}
