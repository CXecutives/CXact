// The facts of a job: THE table the list row and the reader's Konditionen read. One entry per
// meaning: its key, its icon (the same icon wherever the fact shows, and no other meaning has
// it), its words in a list row and the reader row it stands for. The order of the table is the
// order of the facts in a row and of the rows of the reader.
//
// A change is one entry here: a new fact is a new entry (its words in the catalog `facts`), a
// fact moves by moving its entry, another icon is another name here (Icon.svelte holds the
// glyphs). The row shows every fact the ad names, as many as fit whole; the reader's rows are
// the `term`s of the entries, in their order. Several entries may stand for one reader row
// (the pay in euros or in another currency, the remote share or the work mode): the row then
// takes the icon of the entry whose value it shows, so a value has one icon everywhere.

import type { IconName } from '$components/Icon.svelte';
import { formatShortDate } from '$lib/i18n/format';
import { t } from '$lib/i18n/t';
import type { JobView, KeyFacts } from '$lib/ipc/types';

/** A row of the reader's Konditionen (its label is `t.reader.term[key]`). */
export type TermKey = keyof typeof t.reader.term;

/** The facts as the row reads them. `salary` (the annual pay of a permanent job) is not yet a
 *  field of the backend's KeyFacts (open in docs/PLAN.md): the row and the reader show it as
 *  soon as the facts carry it under this name. */
type Facts = KeyFacts & { salary?: number | null };

export interface Fact {
  key: string;
  icon: IconName;
  /** The fact in the words of a list row ("1.200/Tag"); null when the ad does not say it
   *  (and for a row of the reader the list row leaves out). */
  format: (job: JobView) => string | null;
  /** The reader's row it stands for (several entries may share one); null: the list row
   *  only. */
  term: TermKey | null;
  /** Drawn in ink (the pay); the other facts are muted. */
  ink?: boolean;
}

const factsOf = (job: JobView): Facts | null => job.match?.facts ?? null;

/** The annual salary a permanent job states, or null. */
export const salaryOf = (job: JobView): number | null => factsOf(job)?.salary ?? null;

/** The remote share, from and to (one of the two stands for both), or null. */
function share(facts: Facts | null): [number, number] | null {
  const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
  const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
  return from === null || to === null ? null : [from, to];
}

/** The pay in euros (`euro`) or in another currency (`other`), per day, hour or year. */
function pay(job: JobView, currency: 'euro' | 'other'): string | null {
  const facts = factsOf(job);
  if (facts === null) return null;
  const code = facts.currency ?? null;
  const euro = code === null || code === 'EUR';
  if (facts.rate !== null) {
    if (euro !== (currency === 'euro')) return null;
    return t.facts.pay(facts.rate, facts.hourly === true ? 'hour' : 'day', code);
  }
  const salary = salaryOf(job);
  return salary !== null && currency === 'euro' ? t.facts.pay(salary, 'year', null) : null;
}

/** The contract type in a word; nothing while it is unclear. */
function contract(job: JobView): string | null {
  const kind = factsOf(job)?.contract ?? null;
  if (kind === null || kind === 'unclear' || !(kind in t.reader.contractKind)) return null;
  return t.reader.contractKind[kind as keyof typeof t.reader.contractKind];
}

function start(job: JobView): string | null {
  const value = factsOf(job)?.start ?? null;
  if (value === null) return null;
  if (value === 'now') return t.facts.now;
  if (value === 'vague') return t.facts.soon;
  const date = formatShortDate(value);
  return date === '' ? null : t.facts.from(date);
}

function workload(job: JobView): string | null {
  const facts = factsOf(job);
  const to = facts?.workloadTo;
  return to === undefined ? null : t.facts.workload(facts?.workloadFrom ?? null, to);
}

/** The remote share the ad states, else a location that says remote. */
function remote(job: JobView): string | null {
  const stated = share(factsOf(job));
  if (stated !== null) return stated[1] <= 0 ? null : t.facts.remote(stated[0], stated[1]);
  return job.workMode === 'remote' ? t.job.workMode.remote : null;
}

/** On site or hybrid: an ad without remote work, else the location's mode while no share is
 *  known. */
function mode(job: JobView): string | null {
  const stated = share(factsOf(job));
  if (stated !== null) return stated[1] <= 0 ? t.job.workMode.onsite : null;
  return job.workMode === 'hybrid' || job.workMode === 'onsite'
    ? t.job.workMode[job.workMode]
    : null;
}

/** A row of the reader that has no words in the list row. */
const readerOnly = (): null => null;

/** THE table: the facts of a job in their order. */
export const FACTS = [
  { key: 'contract', icon: 'contract', format: contract, term: 'contract' },
  { key: 'money', icon: 'money', format: (job) => pay(job, 'euro'), term: 'rate', ink: true },
  {
    key: 'foreignMoney',
    icon: 'otherMoney',
    format: (job) => pay(job, 'other'),
    term: 'rate',
    ink: true,
  },
  { key: 'start', icon: 'start', format: start, term: 'start' },
  {
    key: 'duration',
    icon: 'duration',
    format: (job) => {
      const months = factsOf(job)?.months ?? null;
      return months ? t.facts.months(months) : null;
    },
    term: 'duration',
  },
  { key: 'workload', icon: 'workload', format: workload, term: null },
  { key: 'remote', icon: 'remote', format: remote, term: 'remote' },
  { key: 'mode', icon: 'onsite', format: mode, term: 'remote' },
  { key: 'place', icon: 'place', format: readerOnly, term: 'place' },
  { key: 'experience', icon: 'experience', format: readerOnly, term: 'experience' },
] as const satisfies readonly Fact[];

export type FactKey = (typeof FACTS)[number]['key'];

/** One fact as a row shows it. */
export interface RowFact {
  key: FactKey;
  icon: IconName;
  text: string;
  ink: boolean;
}

/** The facts a list row shows for a job, in the table's order: every fact the ad names (what
 *  it does not say is left out). */
export function rowFacts(job: JobView): RowFact[] {
  const out: RowFact[] = [];
  for (const fact of FACTS as readonly Fact[]) {
    const text = fact.format(job);
    if (text !== null) {
      out.push({ key: fact.key as FactKey, icon: fact.icon, text, ink: fact.ink === true });
    }
  }
  return out;
}

/** The reader's rows in their order (each `term` of the table once, where it first stands). */
export const TERM_ROWS: readonly TermKey[] = [
  ...new Set((FACTS as readonly Fact[]).flatMap((fact) => (fact.term === null ? [] : [fact.term]))),
];

/** The icon of a reader row for a job: the icon of the entry whose value the job has (a CHF
 *  rate its banknote, a hybrid job its building), else of the row's first entry. */
export function termIcon(term: TermKey, job: JobView | null = null): IconName {
  const entries = (FACTS as readonly Fact[]).filter((fact) => fact.term === term);
  const shown = job === null ? undefined : entries.find((fact) => fact.format(job) !== null);
  return (shown ?? entries[0])?.icon ?? 'info';
}
