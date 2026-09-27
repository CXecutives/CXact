// The years of experience an ad asks for, as the reader's row "Erfahrung" reads them
// (terms.ts): general experience ("10 Jahre Berufserfahrung") is the row's own, years in a
// topic ("3 Jahre S/4HANA") give it its value; each judged by the years the engine compared
// them with (`have`, `yearsFit`: the profile's own years, or the competence's).

import type { TermVerdict as Verdict } from '$lib/i18n/de';
import { t } from '$lib/i18n/t';
import type { Reason } from '$lib/ipc/types';
import { isRequirement, type Judgement } from './verdicts';

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** The years a requirement asks for (0 without). */
export const yearsOf = (reason: Reason): number => num(reason.params.years) ?? 0;

/** The most years first. */
export const byYears = (a: Reason, b: Reason): number => yearsOf(b) - yearsOf(a);

/** General experience (`10 Jahre Berufserfahrung`): the row "Erfahrung" is all it says. */
export const generalYears = (reason: Reason): boolean =>
  isRequirement(reason) && reason.params.general === true && num(reason.params.years) !== null;

const YEARS_VERDICT: Record<string, Exclude<Verdict, 'unset'>> = {
  met: 'met',
  partial: 'partial',
  open: 'violated',
};

/** How the years of a requirement stand to the profile's (`yearsFit`, `have`), whatever its
 *  skill: general experience against the profile's years, years in a topic against that
 *  competence's own. None where nothing judges them (no years in the profile, a topic the
 *  profile does not name). */
export function yearsJudgement(reason: Reason | undefined): Judgement[] {
  const fit = reason?.params.yearsFit;
  const verdict = typeof fit === 'string' ? YEARS_VERDICT[fit] : undefined;
  const have = num(reason?.params.have);
  if (reason === undefined || verdict === undefined || have === null) return [];
  const asked = t.facts.years(yearsOf(reason), num(reason.params.max));
  const why =
    reason.params.general === true || !reason.evidence
      ? t.reason.why.years(asked, have)
      : t.reason.why.topicYears(asked, reason.evidence.profile, have);
  return [{ verdict, why, excludes: false }];
}
