// The reader's "Konditionen": what each row reads (TERMS). One entry per row: the engine's
// reason codes and the profile's criteria it stands for (the lists under "Anforderungen" never
// repeat them), when it shows, and how it reads the ad's value. A row says only what the ad
// says (its facts, else the value the engine read into a criterion), and a verdict when there
// is a match to judge by: the worst of its criteria and reasons, with the sentence of the
// reason that decided it as the verdict's tooltip. No profile values: the verdict and its
// sentence are the comparison.
//
// The order of the rows and their icons are the facts table (lib/facts.ts, the list row's
// icons): moving or removing a row's fact there moves or hides the row. A new row is a fact
// with its `term` there, its name in the catalog (`reader.term`) and one entry here. Only the
// reader uses this module.

import type { IconName } from '$components/Icon.svelte';
import { TERM_ROWS, termIcon, type TermKey } from '$lib/facts';
import { formatDate } from '$lib/i18n/format';
import type { CriterionKey, TermVerdict } from '$lib/i18n/de';
import { t } from '$lib/i18n/t';
import { criterionKey, reasonText } from '$lib/i18n/texts';
import type { JobView, KeyFacts, Reason } from '$lib/ipc/types';

export type { TermKey };
export type Verdict = TermVerdict;
type ContractWord = keyof typeof t.reader.contractKind;

export interface TermRow {
  key: TermKey;
  name: string;
  /** The icon of its fact (the same icon as in the list row). */
  icon: IconName;
  /** The ad's value in words ("1.200 €/Tag"), or "offen". */
  value: string;
  /** The ad does not state it. */
  open: boolean;
  /** A quiet word after the value: estimated, assumed. */
  note: string | null;
  /** Null: nothing to judge by (no match, or the row takes no verdict). */
  verdict: Verdict | null;
  /** The sentence of the reason that decided the verdict (its tooltip), if one did. */
  why: string | null;
  /** The reason whose passage states the value (a dotted underline, a click jumps). */
  passage: Reason | null;
  /** Every reason the row stands for: their passages light up with the row. */
  ids: string[];
}

/** Where the ad's facts live (the one line that changes when they move to the job itself). */
const factsOf = (job: JobView): KeyFacts | null => job.match?.facts ?? null;

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

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
  /** The passage that states the value, if the text shown has one. */
  passage: Reason | null;
}

interface Value {
  value: string | null;
  note?: string | null;
  /** False: the row takes no verdict (the duration of a permanent job). */
  judged?: boolean;
}

interface Term {
  /** Reason codes of the engine the row stands for. */
  codes: readonly string[];
  /** Criteria of the profile the row stands for. */
  criteria: readonly CriterionKey[];
  /** Codes that give the value only, never the verdict. */
  valueOnly?: readonly string[];
  /** Whether the row shows for this job (always without). */
  shows?: (ctx: Context) => boolean;
  /** Its name for this job (the catalog's `reader.term` without). */
  name?: (ctx: Context) => string;
  read: (ctx: Context) => Value;
}

/** What each row reads; their order is the facts table's. */
const TERMS: Record<TermKey, Term> = {
  contract: {
    codes: ['contractType', 'anue', 'anueRisk', 'anueOptional', 'anueHidden', 'permanent'],
    criteria: ['noAnue', 'noPermanent'],
    valueOnly: ['contractType'],
    read: ({ contract }) => ({
      value: t.reader.contractKind[contract.kind],
      note: contract.inferred && contract.kind !== 'unclear' ? t.reader.assumed : null,
    }),
  },
  // The pay: a day rate, or the annual salary of employment (the engine judges only the one
  // that applies, the other criterion stays out).
  rate: {
    codes: ['dayRate', 'dayRateCurrency', 'dayRateWish', 'salary', 'salaryUnknown'],
    criteria: ['minDayRate', 'minSalary'],
    name: ({ contract }) => (contract.employment ? t.reader.salaryName : t.reader.term.rate),
    read: ({ facts, criterion, code, contract }) => {
      if (contract.employment) {
        const p = { ...criterion('minSalary')?.params, ...code('salary')?.params };
        const stated = num(facts?.salary);
        const amount = stated ?? num(p.salary);
        const lower = stated === null ? p.lowerBound === true : facts?.salaryLowerBound === true;
        return { value: amount === null ? null : t.reader.salary(amount, lower) };
      }
      const p = criterion('minDayRate')?.params ?? {};
      const stated = typeof facts?.rate === 'number' ? facts : null;
      const rate = stated?.rate ?? num(p.rate);
      if (rate === null) {
        const open = facts?.rateOpen === true || p.rateOpen === true;
        return { value: open ? t.reader.rateOpen : null };
      }
      const hourly = (stated ? stated.hourly : p.hourly) === true;
      const currency = stated ? stated.currency : text(p.currency);
      return { value: t.facts.rate(rate, hourly, currency, true) };
    },
  },
  start: {
    codes: ['availability', 'availabilityGap', 'startVague'],
    criteria: ['availability'],
    read: ({ facts, criterion }) => {
      const start = facts?.start ?? text(criterion('availability')?.params.start);
      if (start === null) return { value: null };
      if (start === 'now') return { value: t.reader.startNow };
      if (start === 'vague') return { value: t.facts.soon };
      const date = formatDate(start);
      return { value: date === '' ? null : t.facts.from(date) };
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
        ? { value: t.reader.unlimited, judged: false }
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
      return { value: to === null ? null : t.facts.workload(from, to, false) };
    },
  },
  remote: {
    codes: ['remoteWish'],
    criteria: [],
    read: ({ facts, job }) => {
      const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
      const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
      if (from !== null && to !== null) return { value: t.facts.remote(from, to) };
      // No share stated: the work mode the ad names ("teilweise remote").
      return { value: job.workMode ? t.reader.workMode[job.workMode] : null };
    },
  },
  place: {
    codes: ['country', 'countryUnclear', 'regionWish', 'permanentRegion', 'permanentRegionUnclear'],
    criteria: ['countries', 'permanentRegion'],
    read: ({ job, criterion }) => {
      const rule = criterion('countries') ?? criterion('permanentRegion');
      const location = text(rule?.params.location) ?? text(job.location);
      return { value: location ?? (rule?.params.remote === true ? t.facts.fullRemote : null) };
    },
  },
  industry: {
    codes: ['industryWish'],
    criteria: [],
    // Only where the profile wishes industries (the engine then names the ad's).
    shows: ({ code }) => code('industryWish') !== undefined,
    read: ({ code }) => ({ value: text(code('industryWish')?.params.industry) }),
  },
  experience: {
    codes: ['tooJunior', 'seniorityUnclear', 'overqualified'],
    criteria: ['targetYears'],
    read: ({ criterion, code, passage }) => {
      const said = [criterion('targetYears'), code('tooJunior'), code('overqualified')].find(
        (reason) => num(reason?.params.years) !== null,
      );
      const years = num(said?.params.years);
      return {
        value: years === null ? null : t.reader.years(years, num(said?.params.max)),
        // Required years no passage backs are the engine's estimate.
        note: passage === null ? t.reader.estimated : null,
      };
    },
  },
};

/** The row of each reason code (a reason a row stands for is never listed again). */
const ROW_OF_CODE: ReadonlyMap<string, TermKey> = new Map(
  (Object.keys(TERMS) as TermKey[]).flatMap((key) =>
    TERMS[key].codes.map((code) => [code, key] as const),
  ),
);

/** The row a reason of the match stands for, or null. */
export function rowOf(reason: Reason): TermKey | null {
  return ROW_OF_CODE.get(reason.code) ?? null;
}

/** Wishes of the profile (`params.state` met, near, missed or unknown). */
const WISHES: readonly string[] = ['dayRateWish', 'remoteWish', 'regionWish', 'industryWish'];
/** Checks that compare a stated value with a limit of the profile: the value is known and
 *  misses the limit (it fits in part), unlike a check of what the ad leaves unclear. */
const LIMITS: readonly string[] = ['workload', 'duration', 'availabilityGap'];

/** What a reason says about its row: a missed or near wish and a missed limit fit in part,
 *  only a check of an unclear ad is "prüfen". */
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
    default:
      return null;
  }
}

/** A criterion's state; the reason that decided it says how (an over-qualified job fits the
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

const sentence = (reason: Reason | undefined): string | null =>
  reason === undefined ? null : reasonText(reason) || null;

function contractOf(
  facts: KeyFacts | null,
  reasons: readonly Reason[],
  criteria: readonly Reason[],
) {
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
  } satisfies Contract;
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
  return TERM_ROWS.flatMap((key) => {
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
  const criteria = input.criteria.filter((reason) => {
    const key = criterionKey(reason.code);
    return key !== null && term.criteria.includes(key);
  });
  const reasons = input.reasons.filter((reason) => term.codes.includes(reason.code));
  // The passage: a criterion's own, else the first reason of the row that has one in the
  // text shown (a preview holds only the start of the ad).
  const passage =
    [...criteria, ...reasons].find((reason) =>
      reason.ranges.some((range) => range.end <= input.textLength),
    ) ?? null;
  const ctx: Context = {
    job: input.job,
    facts,
    contract,
    criterion: (key) => criteria.find((reason) => criterionKey(reason.code) === key),
    code: (name) => reasons.find((reason) => reason.code === name),
    passage,
  };
  if (term.shows && !term.shows(ctx)) return null;
  const read = term.read(ctx);
  const open = read.value === null;
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
  // "offen" twice says nothing: an open value keeps an open verdict to itself.
  const verdict = judged === null || (open && judged.verdict === 'unset') ? null : judged;
  return {
    key,
    name: term.name?.(ctx) ?? t.reader.term[key],
    icon: termIcon(key, input.job),
    value: read.value ?? t.reader.termOpen,
    open,
    note: open ? null : (read.note ?? null),
    verdict: verdict?.verdict ?? null,
    why: verdict?.why ?? null,
    passage,
    ids: [
      ...new Set([
        ...criteria.map((reason) => reason.id),
        ...reasons.map((reason) => reason.id),
        ...[...linked].filter((id) => id !== ''),
      ]),
    ],
  };
}
