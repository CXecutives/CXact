// The reader's structure as data (Reader.svelte renders each entry by its key). Moving an entry
// moves its section or group; removing it hides it. The rows of "Jobdetails" are the table of
// lib/facts.ts (read by terms.ts), the "…" menu is the table in Reader.svelte.

import type { Reason, ReasonKind, TermField } from '$lib/ipc/types';
import type { ProfileTerm } from '$lib/state/terms';
import type { Verdict } from './terms';

/**
 * The sections, top to bottom:
 * - head: the title and the close "×" (company, place, portal and day are rows of the
 *   Jobdetails);
 * - match: the ring beside its band, or the ban of an excluded job with why;
 * - actions: Alert-Mail öffnen, Anzeige öffnen, Prompt kopieren and "…";
 * - details: "Jobdetails";
 * - requirements: "Anforderungen", in the groups below;
 * - ad: the note on a text that is not all there, and the ad text.
 */
export const READER_SECTIONS = [
  'head',
  'match',
  'actions',
  'details',
  'requirements',
  'ad',
] as const;

export interface RequirementGroup {
  kind: Extract<ReasonKind, 'met' | 'partial' | 'open' | 'check'>;
  /** Its verdict: the group's title, and its icon in the Jobdetails too. */
  verdict: Exclude<Verdict, 'unset'>;
}

/** The groups of "Anforderungen", in their order (a quiet count after each title). */
export const REQUIREMENT_GROUPS: readonly RequirementGroup[] = [
  { kind: 'met', verdict: 'met' },
  { kind: 'partial', verdict: 'partial' },
  { kind: 'open', verdict: 'violated' },
  { kind: 'check', verdict: 'unknown' },
];

/** The reason kind whose icon draws a verdict (the Jobdetails and the groups alike; a row
 *  whose verdict excludes the job draws the ban of a violation instead). */
export function kindOf(verdict: Exclude<Verdict, 'unset'>): ReasonKind {
  return REQUIREMENT_GROUPS.find((group) => group.verdict === verdict)?.kind ?? 'check';
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
