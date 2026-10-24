// The job view's structure as data (Reader.svelte renders each card by its key). Moving an entry
// moves its card; removing it hides it. The rows of "Jobdetails" are the table of lib/facts.ts
// (read by terms.ts).

import type { TermKey } from '$lib/facts';
import type { Reason, ReasonKind, ReasonWeight, TermField } from '$lib/ipc/types';
import type { ProfileTerm } from '$lib/state/terms';
import type { Verdict } from './terms';

/**
 * The cards of the job view, top to bottom (the round 10 draft):
 * - hero: the ring, the title and the band, the quiet moves and "×" at its top right, the
 *   state box of a job that has one, and the buttons that show the job;
 * - details: "Jobdetails";
 * - requirements: "Anforderungen", one flat list in the order of byRequirement;
 * - ad: the ad's text (only once it is there).
 */
export const READER_CARDS = ['hero', 'details', 'requirements', 'ad'] as const;

/** The facts a job whose ad is not loaded yet shows: what its alert mail or search said. */
export const PENDING_FACTS: readonly TermKey[] = ['company', 'place', 'portal'];

/** The kinds a requirement can have, in their order: met, then in part, then not met, then
 *  unclear. */
const KIND_ORDER: Record<Extract<ReasonKind, 'met' | 'partial' | 'open' | 'check'>, number> = {
  met: 0,
  partial: 1,
  open: 2,
  check: 3,
};
/** Within a kind: a must before what is only nice to have. */
const WEIGHT_ORDER: Record<ReasonWeight, number> = { must: 0, hard: 1, nice: 2, info: 3 };

/** The order of the Anforderungen: met, in part, not met, unclear; within each a must first. */
export function byRequirement(a: Reason, b: Reason): number {
  const kind = (reason: Reason): number => KIND_ORDER[reason.kind as keyof typeof KIND_ORDER] ?? 4;
  return kind(a) - kind(b) || WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight];
}

/** The reason kind whose icon draws a verdict of the Jobdetails (a row whose verdict excludes
 *  the job draws the ban of a violation instead). */
const VERDICT_KIND: Record<Exclude<Verdict, 'unset'>, ReasonKind> = {
  met: 'met',
  partial: 'partial',
  violated: 'open',
  unknown: 'check',
};

export function kindOf(verdict: Exclude<Verdict, 'unset'>): ReasonKind {
  return VERDICT_KIND[verdict];
}

/** What the Anforderungen list: the ad's requirements (a skill, a term, a formal degree or
 *  licence); a title, a wish or a Schwerpunkt is no requirement, and a fact has its row. */
export const REQUIREMENT_CODES: readonly string[] = ['requirement', 'term', 'formalOpen'];

const FIELDS: ReadonlySet<string> = new Set<TermField>([
  'competence',
  'tool',
  'industry',
  'language',
  'certificate',
  'degree',
]);
const isField = (value: unknown): value is TermField =>
  typeof value === 'string' && FIELDS.has(value);

/** The term of an open requirement and the field of the profile it goes into, as core names
 *  them (`params.term`, `params.field`, `pipeline::local::open_term`: "Kenntnisse in Anaplan"
 *  is the tool "Anaplan", "Branchenerfahrung Energie" the industry "Energie"); null for one
 *  the profile could not take (a sentence, a soft skill, a frame condition). */
function profileTerm(reason: Reason): ProfileTerm | null {
  const { term, field } = reason.params;
  return typeof term === 'string' && term !== '' && isField(field) ? { term, field } : null;
}

/** The term a missing must adds (`addable` says whether it has one; else the ad's words). */
export function termOf(reason: Reason): ProfileTerm {
  return profileTerm(reason) ?? { term: reason.label.trim(), field: 'competence' };
}

/** A missing must that can go into the profile: core names its term. */
export function addable(reason: Reason): boolean {
  return reason.kind === 'open' && reason.weight === 'must' && profileTerm(reason) !== null;
}
