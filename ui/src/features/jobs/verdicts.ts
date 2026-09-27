// How a row of the reader's Jobdetails is judged (terms.ts): what a reason or a criterion of
// the match says about the row, and the worst of them.

import type { TermVerdict as Verdict } from '$lib/i18n/de';
import type { Reason } from '$lib/ipc/types';

/** The engine's requirements: the ad's own words, judged against the profile's skills. */
const REQUIREMENTS: readonly string[] = ['requirement', 'term'];
export const isRequirement = (reason: Reason): boolean => REQUIREMENTS.includes(reason.code);

/** Wishes of the profile (`params.state` met, near, missed or unknown). */
const WISHES: readonly string[] = ['dayRateWish', 'remoteWish', 'regionWish', 'industryWish'];
/** Checks that compare a stated value with a limit of the profile: the value is known and
 *  misses the limit (it is met in part), unlike a check of what the ad leaves unclear. */
const LIMITS: readonly string[] = ['workload', 'duration', 'availabilityGap'];

/** What a reason says about its row: a missed or near wish and a missed limit are met in
 *  part, a check of an unclear ad is unclear. */
export function reasonVerdict(reason: Reason): Verdict | null {
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
      return null;
  }
}

/** A criterion's state; the reason that decided it says how (a workload outside the
 *  profile's days is a limit missed, a start to be agreed is unclear). */
export function criterionVerdict(criterion: Reason, linked: Reason | undefined): Verdict {
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
  // The engine leaves a criterion open when only a finding decides it (a start to be
  // agreed): that finding says the verdict.
  if (linked === undefined || own === 'violated') return own;
  return reasonVerdict(linked) ?? own;
}

/** The worse verdict first. */
const WEIGHT: Record<Verdict, number> = { violated: 4, unknown: 3, partial: 2, met: 1, unset: 0 };

export interface Judgement {
  verdict: Verdict;
  excludes: boolean;
}

export function worst(all: readonly Judgement[]): Judgement | null {
  return all.reduce<Judgement | null>(
    (out, next) => (out === null || WEIGHT[next.verdict] > WEIGHT[out.verdict] ? next : out),
    null,
  );
}
