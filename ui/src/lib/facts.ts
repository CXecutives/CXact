// The facts of a job: THE table of the reader's "Jobdetails" (TERM_ROWS), one row per fact in
// its fixed order with its icon, the same icon wherever the fact shows (no other meaning has
// it). The words of each value have one form, in the catalog's `facts` ("24.09.", "ab 01.11.",
// "1.200 €/Tag", "3 Tage/Woche", "60 % remote"); what a row reads and how it is judged is
// features/jobs/terms.ts.
//
// A change is one entry here: a new row is a new entry (its name in the catalog's
// `reader.term`, its reading in terms.ts), a row moves by moving its entry, another icon is
// another meaning here (lib/icons.ts holds the glyphs).

import type { IconMeaning } from '$lib/icons';
import { formatDay } from '$lib/i18n/format';
import { t } from '$lib/i18n/t';
import type { JobView, KeyFacts } from '$lib/ipc/types';

/** A row of the reader's Jobdetails (its label is `t.reader.term[key]`). */
export type TermKey = keyof typeof t.reader.term;

/** THE table: the rows of the Jobdetails in their order, each with its icon. */
export const TERM_ROWS = [
  { key: 'company', icon: 'company' },
  { key: 'place', icon: 'place' },
  { key: 'mode', icon: 'remote' },
  { key: 'contract', icon: 'contract' },
  { key: 'rate', icon: 'money' },
  { key: 'start', icon: 'start' },
  { key: 'duration', icon: 'duration' },
  { key: 'workload', icon: 'workload' },
  { key: 'experience', icon: 'experience' },
  { key: 'deadline', icon: 'deadline' },
  { key: 'contact', icon: 'contact' },
  { key: 'industry', icon: 'industry' },
  { key: 'portal', icon: 'portal' },
  { key: 'received', icon: 'alertMail' },
] as const satisfies readonly { key: TermKey; icon: IconMeaning }[];

const factsOf = (job: JobView): KeyFacts | null => job.match?.facts ?? null;

/** Whether the job's pay is in another currency than the euro. */
const foreign = (job: JobView): boolean => {
  const code = factsOf(job)?.currency ?? null;
  return code !== null && code !== 'EUR';
};

/** The icon of a row for a job: pay in another currency takes its banknote. */
export function termIcon(key: TermKey, job: JobView): IconMeaning {
  if (key === 'rate' && foreign(job)) return 'otherMoney';
  return TERM_ROWS.find((row) => row.key === key)?.icon ?? 'info';
}

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
