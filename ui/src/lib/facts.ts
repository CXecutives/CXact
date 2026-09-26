// The facts of a job: THE table of the reader's "Jobdetails" (TERM_ROWS), one row per fact in
// its fixed order with its icon, the same icon wherever the fact shows (no other meaning has
// it). The words of each value have one form, in the catalog's `facts` ("24.09.", "ab 01.11.",
// "1.200 €/Tag", "3 Tage/Woche", "60 % remote"); what a row reads and how it is judged is
// features/jobs/terms.ts.
//
// A change is one entry here: a new row is a new entry (its name in the catalog's
// `reader.term`, its reading in terms.ts), a row moves by moving its entry, another icon is
// another meaning here (lib/icons.ts holds the glyphs).
//
// ROW_FACTS below are the facts the list row still shows until it drops them (it reads
// `rowFacts`); they use the same words.

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

/** The work mode in words: the remote share the ad states ("60 % remote", "voll remote",
 *  "Vor Ort"), else the mode its location names ("Hybrid"). */
export function modeWords(job: JobView): string | null {
  const facts = factsOf(job);
  const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
  const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
  if (from !== null && to !== null) return t.facts.remote(from, to);
  return job.workMode === null ? null : t.facts.mode[job.workMode];
}

/** The facts the list row shows (until it drops them), each with its icon. */
const ROW_FACTS = [
  {
    key: 'money',
    icon: 'money',
    ink: true,
    format: (job: JobView) => {
      const facts = factsOf(job);
      if (facts?.rate === null || facts?.rate === undefined || foreign(job)) {
        const salary = facts?.salary ?? null;
        return salary === null || foreign(job) ? null : t.facts.pay(salary, 'year', null);
      }
      return t.facts.pay(facts.rate, facts.hourly === true ? 'hour' : 'day', null);
    },
  },
  {
    key: 'foreignMoney',
    icon: 'otherMoney',
    ink: true,
    format: (job: JobView) => {
      const facts = factsOf(job);
      if (!foreign(job) || facts === null || facts.rate === null) return null;
      return t.facts.pay(facts.rate, facts.hourly === true ? 'hour' : 'day', facts.currency);
    },
  },
  {
    key: 'start',
    icon: 'start',
    ink: false,
    format: (job: JobView) => {
      const start = factsOf(job)?.start ?? null;
      return start === null ? null : startWords(start);
    },
  },
  {
    key: 'duration',
    icon: 'duration',
    ink: false,
    format: (job: JobView) => {
      const months = factsOf(job)?.months ?? null;
      return months ? t.facts.months(months) : null;
    },
  },
  {
    key: 'workload',
    icon: 'workload',
    ink: false,
    format: (job: JobView) => {
      const facts = factsOf(job);
      const to = facts?.workloadTo;
      return to === undefined ? null : t.facts.workload(facts?.workloadFrom ?? null, to);
    },
  },
  { key: 'remote', icon: 'remote', ink: false, format: modeWords },
] as const satisfies readonly {
  key: string;
  icon: IconMeaning;
  ink: boolean;
  format: (job: JobView) => string | null;
}[];

export type FactKey = (typeof ROW_FACTS)[number]['key'];

/** One fact as a list row shows it. */
export interface RowFact {
  key: FactKey;
  icon: IconMeaning;
  text: string;
  ink: boolean;
}

/** The facts a list row shows for a job, in their order: every fact the ad names. */
export function rowFacts(job: JobView): RowFact[] {
  return ROW_FACTS.flatMap((fact) => {
    const text = fact.format(job);
    return text === null ? [] : [{ key: fact.key, icon: fact.icon, text, ink: fact.ink }];
  });
}
