// The reader's "Konditionen": fixed rows in a fixed order (TERM_ROWS), each with the ad's
// value, a quiet word after it ("geschätzt"), the profile's side under it (its minimum and
// its wishes, merged into the row instead of a block of their own), the verdict as a word and
// the passage that states the value. A value the ad does not state says "offen"; a verdict
// that would only repeat it stays empty. Only the reader uses this module.
//
// A new row (Auslastung, Mindestlaufzeit) is one key in TERM_ROWS, its name in the catalog
// (`reader.term`) and one case in `build`; the reason codes it stands for go into
// ROW_OF_CODE, its criterion into ROW_OF_CRITERION.

import { formatDate } from '$lib/i18n/format';
import type { CriterionKey } from '$lib/i18n/de';
import { t } from '$lib/i18n/t';
import { criterionKey } from '$lib/i18n/texts';
import type { JobView, KeyFacts, ProfileForm, Reason } from '$lib/ipc/types';

export type TermKey =
  'contract' | 'rate' | 'start' | 'duration' | 'remote' | 'place' | 'experience';

/** The rows of the table, in their order. */
export const TERM_ROWS: readonly TermKey[] = [
  'contract',
  'rate',
  'start',
  'duration',
  'remote',
  'place',
  'experience',
];

/** How a row fits the profile: passt, passt nicht, prüfen, offen. */
export type Verdict = 'met' | 'violated' | 'unknown' | 'unset';

export interface TermRow {
  key: TermKey;
  name: string;
  /** The ad's value in words ("1.200 €/Tag"), or "offen". */
  value: string;
  /** The ad does not state it. */
  open: boolean;
  /** A quiet word after the value: estimated, assumed. */
  note: string | null;
  /** The profile's side, quiet under the value (its minimum, its wish). */
  profile: string | null;
  /** Null: nothing to compare (no profile, no rule for it). */
  verdict: Verdict | null;
  /** The reason whose passage states the value (a dotted underline, a click jumps). */
  passage: Reason | null;
  /** Every reason the row stands for: their passages light up with the row. */
  ids: string[];
}

/** Reason codes of the engine a row stands for (they are not listed again below it). */
const ROW_OF_CODE: Record<string, TermKey> = {
  contractType: 'contract',
  anue: 'contract',
  anueRisk: 'contract',
  anueOptional: 'contract',
  anueHidden: 'contract',
  permanent: 'contract',
  dayRate: 'rate',
  dayRateCurrency: 'rate',
  dayRateWish: 'rate',
  availability: 'start',
  availabilityGap: 'start',
  startVague: 'start',
  remoteWish: 'remote',
  country: 'place',
  countryUnclear: 'place',
  regionWish: 'place',
  permanentRegion: 'place',
  permanentRegionUnclear: 'place',
  tooJunior: 'experience',
  seniorityUnclear: 'experience',
  overqualified: 'experience',
};

/** The hard criteria of the profile per row (the annual salary has no row). */
const ROW_OF_CRITERION: Record<CriterionKey, TermKey | null> = {
  minDayRate: 'rate',
  countries: 'place',
  noAnue: 'contract',
  noPermanent: 'contract',
  availability: 'start',
  minSalary: null,
  permanentRegion: 'place',
  targetYears: 'experience',
};

/** The row a reason of the match stands for, or null. */
export function rowOf(reason: Reason): TermKey | null {
  return ROW_OF_CODE[reason.code] ?? null;
}

/** The row a criterion of the profile stands for, or null. */
function rowOfCriterion(reason: Reason): TermKey | null {
  const key = criterionKey(reason.code);
  return key === null ? null : ROW_OF_CRITERION[key];
}

/** The state of a criterion (met in part still fits). */
function criterionVerdict(reason: Reason): Verdict {
  switch (reason.kind) {
    case 'met':
    case 'partial':
      return 'met';
    case 'violation':
      return 'violated';
    case 'check':
      return 'unknown';
    default:
      return 'unset';
  }
}

/** The state of a wish (`params.state` met, near, missed or unknown): it only compares. */
function wishVerdict(reason: Reason): Verdict {
  switch (reason.params.state) {
    case 'met':
      return 'met';
    case 'near':
      return 'unknown';
    case 'missed':
      return 'violated';
    default:
      return 'unset';
  }
}

/** The worst of several verdicts (a violation beats a check beats a fit beats open). */
const WEIGHT: Record<Verdict, number> = { violated: 3, unknown: 2, met: 1, unset: 0 };
function worst(verdicts: readonly Verdict[]): Verdict | null {
  return verdicts.reduce<Verdict | null>(
    (out, next) => (out === null || WEIGHT[next] > WEIGHT[out] ? next : out),
    null,
  );
}

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export interface TermInput {
  job: JobView;
  /** The match's reasons and the profile's criteria (empty without a match). */
  reasons: readonly Reason[];
  criteria: readonly Reason[];
  /** The profile's form (its minimum and wishes), null without one. */
  profile: ProfileForm | null;
  /** A profile to compare with: without one no row has a verdict. */
  withVerdict: boolean;
  /** The length of the ad's text shown (0 without one): passages lie within it. */
  textLength: number;
}

/** The rows of the table for one job. */
export function termRows(input: TermInput): TermRow[] {
  return TERM_ROWS.map((key) => build(key, input));
}

function build(key: TermKey, input: TermInput): TermRow {
  const { job, profile, withVerdict } = input;
  const facts: KeyFacts | null = job.match?.facts ?? null;
  const criteria = input.criteria.filter((reason) => rowOfCriterion(reason) === key);
  const reasons = input.reasons.filter((reason) => rowOf(reason) === key);
  const code = (name: string): Reason | undefined => reasons.find((r) => r.code === name);
  const criterion = (name: CriterionKey): Reason | undefined =>
    criteria.find((reason) => criterionKey(reason.code) === name);
  // The passage: a criterion's own, else the first reason of the row that has one in the
  // text shown (a preview holds only the start of the ad).
  const passage =
    [...criteria, ...reasons].find((reason) =>
      reason.ranges.some((range) => range.end <= input.textLength),
    ) ?? null;
  const ids = [
    ...criteria.map((reason) => reason.id),
    ...reasons.map((reason) => reason.id),
    // A criterion names the reason that decided it (core view::criteria_strip).
    ...criteria.flatMap((reason) => {
      const linked = text(reason.params.reason);
      return linked === null ? [] : [linked];
    }),
  ];
  const row = (
    value: string | null,
    verdict: Verdict | null,
    extra: { note?: string | null; profile?: string | null } = {},
  ): TermRow => {
    const open = value === null;
    const judged = withVerdict ? verdict : null;
    return {
      key,
      name: t.reader.term[key],
      value: value ?? t.reader.termOpen,
      open,
      note: open ? null : (extra.note ?? null),
      profile: withVerdict ? (extra.profile ?? null) : null,
      // "offen" twice says nothing: an open value keeps an open verdict to itself.
      verdict: open && judged === 'unset' ? null : judged,
      passage,
      ids: [...new Set(ids)],
    };
  };
  switch (key) {
    case 'contract': {
      const stated = code('contractType');
      const type =
        text(stated?.params.type) ??
        text(facts?.contract) ??
        criteria.map((reason) => text(reason.params.contract)).find((value) => value !== null) ??
        'unclear';
      const kind = type in t.reader.contractKind ? (type as ContractWord) : 'unclear';
      return row(t.reader.contractKind[kind], worst(criteria.map(criterionVerdict)), {
        note: stated?.params.inferred === true && kind !== 'unclear' ? t.reader.assumed : null,
      });
    }
    case 'rate': {
      const rule = criterion('minDayRate');
      const wish = code('dayRateWish');
      const p = rule?.params ?? {};
      const rate = num(p.rate) ?? facts?.rate ?? null;
      const value =
        rate !== null
          ? t.facts.rate(
              rate,
              (p.hourly ?? facts?.hourly) === true,
              text(p.currency) ?? facts?.currency ?? null,
              true,
            )
          : p.rateOpen === true || facts?.rateOpen === true
            ? t.reader.rateOpen
            : null;
      const min = profile?.criteria.minDayRate ?? num(p.min);
      const wished = profile?.wishes.dayRate ?? num(wish?.params.wish);
      return row(value, rule ? criterionVerdict(rule) : wish ? wishVerdict(wish) : null, {
        profile: min === null && wished === null ? null : t.reader.profileSide.rate(min, wished),
      });
    }
    case 'start': {
      const rule = criterion('availability');
      const start = text(rule?.params.start) ?? facts?.start ?? null;
      const value =
        start === 'now'
          ? t.facts.now
          : start !== null && start !== 'vague'
            ? t.facts.from(formatDate(start))
            : null;
      const available = profile?.criteria.available;
      return row(value, rule ? criterionVerdict(rule) : null, {
        profile:
          available === undefined || available.kind === 'unset'
            ? null
            : t.reader.profileSide.start(
                available.kind === 'from' ? formatDate(available.date) : null,
              ),
      });
    }
    case 'duration':
      // No rule compares the duration yet (Mindestlaufzeit comes with the engine).
      return row(facts?.months ? t.facts.months(facts.months) : null, null);
    case 'remote': {
      const wish = code('remoteWish');
      const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
      const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
      const value =
        from !== null && to !== null
          ? t.facts.remote(from, to)
          : job.workMode
            ? t.job.workMode[job.workMode]
            : null;
      const level = profile?.wishes.remote ?? null;
      return row(value, wish ? wishVerdict(wish) : null, {
        profile: level === null ? null : t.reader.profileSide.remote(level),
      });
    }
    case 'place': {
      const rule = criterion('countries') ?? criterion('permanentRegion');
      const region = code('regionWish');
      const location = text(rule?.params.location) ?? text(job.location);
      const value = location ?? (rule?.params.remote === true ? t.facts.fullRemote : null);
      const countries = profile?.criteria.countries ?? [];
      const regions = profile?.wishes.regions ?? [];
      return row(value, rule ? criterionVerdict(rule) : region ? wishVerdict(region) : null, {
        profile:
          countries.length + regions.length === 0
            ? null
            : t.reader.profileSide.place(countries.join(', '), regions),
      });
    }
    case 'experience': {
      const rule = criterion('targetYears');
      const said = [rule, code('tooJunior'), code('overqualified')].find(
        (reason) => num(reason?.params.years) !== null,
      );
      const years = num(said?.params.years);
      return row(
        years === null ? null : t.reader.years(years, num(said?.params.max)),
        rule ? criterionVerdict(rule) : null,
        // Required years no passage backs are the engine's estimate.
        { note: passage === null ? t.reader.estimated : null },
      );
    }
  }
}

type ContractWord = keyof typeof t.reader.contractKind;
