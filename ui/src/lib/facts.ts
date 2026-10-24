// The facts of a job: THE table of the reader's "Jobdetails" (TERM_ROWS), one row per fact in
// its fixed order (round 10: a label and its value, no icon). The words of each value have one
// form, in the catalog's `facts` ("24.09.", "ab 01.11.", "1.200 €/Tag", "3 Tage/Woche",
// "60 % remote"); what a row reads and how it is judged is features/jobs/terms.ts.
//
// A change is one entry here: a new row is a new entry (its name in the catalog's
// `reader.term`, its reading in terms.ts), a row moves by moving its entry.

import { formatDay } from '$lib/i18n/format';
import { t } from '$lib/i18n/t';
import type { JobView, KeyFacts } from '$lib/ipc/types';

/** A row of the reader's Jobdetails (its label is `t.reader.term[key]`). */
export type TermKey = keyof typeof t.reader.term;

/** THE table: the rows of the Jobdetails in their order. */
export const TERM_ROWS = [
  'company',
  'place',
  'mode',
  'contract',
  'rate',
  'start',
  'duration',
  'workload',
  'experience',
  'deadline',
  'contact',
  'portal',
] as const satisfies readonly TermKey[];

const factsOf = (job: JobView): KeyFacts | null => job.match?.facts ?? null;

/** A start in words: "ab sofort", "nach Absprache", "ab 01.11.". */
export function startWords(start: string): string | null {
  if (start === 'now') return t.facts.now;
  if (start === 'vague') return t.facts.agreed;
  const date = formatDay(start);
  return date === '' ? null : t.facts.from(date);
}

/** The work mode in words: the remote share the ad states ("60 % remote", "Voll remote",
 *  "Vor Ort"), else the mode its location names ("Hybrid"). */
export function modeWords(job: JobView): string | null {
  const facts = factsOf(job);
  const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
  const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
  if (from !== null && to !== null) return t.facts.remote(from, to);
  return job.workMode === null ? null : t.facts.mode[job.workMode];
}
