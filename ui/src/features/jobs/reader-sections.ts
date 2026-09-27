// The reader's structure as data (Reader.svelte renders each entry by its key). Moving an entry
// moves its section or group; removing it hides it. The rows of "Jobdetails" are the table of
// lib/facts.ts (read by terms.ts), the "…" menu is the table in Reader.svelte.

import type { Reason, ReasonKind } from '$lib/ipc/types';
import type { Verdict } from './terms';

/**
 * The sections, top to bottom:
 * - head: the title and the close "×" (company, place, portal and day are rows of the
 *   Jobdetails);
 * - match: the ring beside its band, or the ban of an excluded job with why;
 * - actions: Alert-Mail öffnen, Anzeige öffnen, KI-Prompt kopieren and "…";
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

/** A term has at most this many words; longer words are a sentence. */
const TERM_WORDS = 5;

/** The words an ad puts before a term ("Kenntnisse in Anaplan", "Erfahrung mit SAP Analytics
 *  Cloud", "Branchenerfahrung Energie", "experience with Workday"): the term is what follows.
 *  External contract - the ad's own German and English wording. */
const LEAD =
  /^(?:(?:sehr\s+)?(?:gute|fundierte|solide|erste|tiefe|langjährige)\s+)?(?:kenntnisse|erfahrungen?|know-how|expertise|praxis)\s+(?:in|im|mit|der|von)\s+(?:der\s+|dem\s+|den\s+)?|^branchenerfahrung\s+(?:in\s+(?:der\s+)?)?|^(?:(?:good|solid|strong|deep)\s+)?(?:knowledge|experience|expertise)\s+(?:with|in|of)\s+(?:the\s+)?/iu;

/** The term of a missing must: the ad's words without their lead ("Anaplan"). */
export function termOf(reason: Reason): string {
  const words = reason.label.trim();
  const term = words.replace(LEAD, '').trim();
  return term === '' ? words : term;
}

/** A missing must that can go into the profile: a term of the ad (a keyword, a bullet of a
 *  few words), never a whole sentence. */
export function addable(reason: Reason): boolean {
  if (reason.kind !== 'open' || reason.weight !== 'must') return false;
  if (reason.code === 'term') return true;
  if (reason.code !== 'requirement' || reason.params.source === 'sentence') return false;
  const words = reason.label.trim();
  return words !== '' && words.split(/\s+/).length <= TERM_WORDS && !/[.!?:;]$/.test(words);
}
