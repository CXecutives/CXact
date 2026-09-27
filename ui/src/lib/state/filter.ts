// The filter of the job list as one table: its groups in their order, each with its choices,
// its words and what it lets through. The funnel's menu (ListHeader),
// the chips under the list header, the store's query and the harness all read it: another
// group is one entry of FILTER_GROUPS (and its field in ListFilter, which `toQuery` hands to
// the JobQuery), another word one in the catalog. The filter is the same in every
// place (Eingang, Archiv, Papierkorb) and kept per user like the order. The order of the list
// (SORTS) is the first group of the same menu, "Sortierung", but no part of the filter: it
// sets no dot and no chip, and "Filter zurücksetzen" leaves it. A group lists only its
// choices, none is checked while it filters nothing: a choice is checked while it is on,
// another one of its group takes over, a second choice turns it off. Portal, Übereinstimmung
// and Vertragsart stand under a heading, the work mode and the pay floor speak for
// themselves, "Nur neue" is a switch of its own (the menu fits under the funnel in the usual
// window). The pay floor compares a job with the profile (`FilterContext`): one the profile
// does not name is not offered. There is no deadline filter (user decision 2026-09-27): a
// deadline close by stands in red in the row (`soonDeadline`).
//
// Plain TypeScript with type-only imports: the harness imports it as it is.

import type { Catalog } from '../i18n/de';
import type { Band, JobQuery, JobSort, JobView, Portal } from '../ipc/types';

/** The lowest band the filter asks for: `mid` lists the mid and the high band. */
export type FilterBand = Exclude<Band, 'low'>;

/** The contract types the filter offers (KeyFacts.contract). */
export const CONTRACTS = ['interim', 'freelance', 'permanent', 'anue'] as const;
export type ContractCode = (typeof CONTRACTS)[number];

/** The work mode the filter asks for: remote only, or remote and hybrid. */
export type WorkChoice = 'remote' | 'hybrid';
/** The pay floor the filter asks for: the profile's minimum or wished day rate. */
export type PayChoice = 'min' | 'wish';

/** The filter: each group's choice, null = none (`toQuery` hands it to the JobQuery). */
export interface ListFilter {
  /** Only this portal's jobs. */
  portal: Portal | null;
  /** Only jobs scored in this band or better (unscored and excluded jobs never pass). */
  minBand: FilterBand | null;
  /** Only jobs of this contract type. */
  contract: ContractCode | null;
  /** Only fully remote jobs, or remote and hybrid ones. */
  remote: WorkChoice | null;
  /** Only jobs whose pay reaches this floor of the profile (employment: its salary floor). */
  pay: PayChoice | null;
  /** Only the jobs not opened yet ("Nur neue"). */
  unread: true | null;
}

export const NO_FILTER: ListFilter = {
  portal: null,
  minBand: null,
  contract: null,
  remote: null,
  pay: null,
  unread: null,
};

/** What the pay floor of the filter compares a job with: the profile's pay floors (null: the
 *  profile names none). */
export interface FilterContext {
  minDayRate: number | null;
  wishDayRate: number | null;
  minSalary: number | null;
}

/** How many days ahead a deadline counts as close by (core::view::DEADLINE_DAYS). */
const DEADLINE_DAYS = 7;

/** The local calendar day of `date`, `days` on, as an ISO date (`2026-09-24`). */
export function localDay(date: Date, days = 0): string {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The job's application deadline when it is today or within the next DEADLINE_DAYS (an ISO
 *  date), else null: the row names it in red. */
export function soonDeadline(job: JobView, today: string): string | null {
  const deadline = job.match?.facts.deadline ?? null;
  if (deadline === null || today === '') return null;
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const last = localDay(new Date(year, month - 1, day), DEADLINE_DAYS);
  return deadline >= today && deadline <= last ? deadline : null;
}

/** Employment pays a salary, no day rate (the list row's pay, core's store::EMPLOYMENT). */
const employed = (job: JobView): boolean =>
  job.match?.facts.contract === 'permanent' || job.match?.facts.contract === 'anue';

/** The day rate the ad states in euros (an hourly rate times 8); null for employment, a rate
 *  in another currency and without one (core's store::day_rate). */
function dayRate(job: JobView): number | null {
  const facts = job.match?.facts ?? null;
  if (facts === null || facts.rate === null || employed(job)) return null;
  if (facts.currency !== null && facts.currency !== 'EUR') return null;
  return facts.hourly === true ? facts.rate * 8 : facts.rate;
}

/** The day rate floor of a pay choice. */
const payFloor = (pay: PayChoice, context: FilterContext): number | null =>
  pay === 'min' ? context.minDayRate : context.wishDayRate;

/** The filter's part of a JobQuery. */
export function toQuery(
  filter: ListFilter,
  context: FilterContext,
): Omit<JobQuery, 'place' | 'sort' | 'search' | 'limit' | 'offset'> {
  return {
    unread: filter.unread === true,
    portal: filter.portal,
    minBand: filter.minBand,
    contracts: filter.contract === null ? [] : [filter.contract],
    remoteOnly: filter.remote === 'remote',
    remoteOrHybrid: filter.remote === 'hybrid',
    minDayRate: filter.pay === null ? null : payFloor(filter.pay, context),
    minSalary: filter.pay === null ? null : context.minSalary,
    // The backend still reads it; the list offers no deadline filter.
    deadlineSoon: false,
  };
}

/** A choice of a group in the menu. */
export interface FilterEntry<K extends keyof ListFilter = keyof ListFilter> {
  /** Stable id: the test id of the menu entry (`menu-item-<id>`). */
  id: string;
  value: ListFilter[K];
  /** Its words in the menu, under the group's heading. */
  label: (words: Catalog) => string;
  /** Its words as a chip, where the menu's short words need their heading ("Ab mittel"
   *  under "Übereinstimmung" is the chip "Ab mittlerer Übereinstimmung"); else the label. */
  chip?: (words: Catalog) => string;
  /** Whether the menu offers it now (a pay floor the profile names); always without. */
  offered?: (context: FilterContext) => boolean;
}

export interface FilterGroup<K extends keyof ListFilter = keyof ListFilter> {
  key: K;
  /** The small heading above the group in the menu; null where its words speak for
   *  themselves. */
  heading: ((words: Catalog) => string) | null;
  /** The choices in the menu's order (a group of one is a switch); the portal group lists
   *  the portals it is given (the UI's order, lib/portals.ts). */
  entries(portals: readonly Portal[]): FilterEntry<K>[];
  /** Without a usable profile there is no match: the group is off and says why. */
  needsProfile: ((words: Catalog) => string) | null;
  /** A kept value this group can hold. */
  valid(value: unknown): boolean;
  /** Whether a job passes a choice (the backend's store::filter_condition). */
  passes(job: JobView, value: NonNullable<ListFilter[K]>, context: FilterContext): boolean;
}

/** The orders of every list, the funnel menu's first group in its order. */
export const SORTS: readonly JobSort[] = ['match', 'newest', 'rate'];

/** The id of an order in the funnel's menu (its test id `menu-item-sort-<order>`). */
export const sortEntryId = (sort: JobSort): string => `sort-${sort}`;

/** The bands each lowest band of the filter lets through. */
const BAND_FROM: Record<FilterBand, Band[]> = { mid: ['mid', 'high'], high: ['high'] };

const PORTAL: FilterGroup<'portal'> = {
  key: 'portal',
  heading: (w) => w.toolbar.portalHeading,
  entries: (portals) =>
    portals.map((portal) => ({
      id: `portal-${portal}`,
      value: portal,
      label: (w) => w.portal[portal],
    })),
  needsProfile: null,
  valid: (value) => typeof value === 'string',
  passes: (job, portal) => job.key.portal === portal,
};

const BAND: FilterGroup<'minBand'> = {
  key: 'minBand',
  heading: (w) => w.toolbar.bandHeading,
  entries: () =>
    (['mid', 'high'] as const).map((band) => ({
      id: `band-${band}`,
      value: band,
      label: (w) => w.toolbar.band[band],
      chip: (w) => w.toolbar.bandChip[band],
    })),
  needsProfile: (w) => w.toolbar.bandNoProfile,
  valid: (value) => value === 'mid' || value === 'high',
  passes: (job, band) =>
    job.match !== null && job.match.status === 'scored' && BAND_FROM[band].includes(job.match.band),
};

const CONTRACT: FilterGroup<'contract'> = {
  key: 'contract',
  heading: (w) => w.toolbar.contractHeading,
  entries: () =>
    CONTRACTS.map((contract) => ({
      id: `contract-${contract}`,
      value: contract,
      label: (w) => w.reader.contractKind[contract],
    })),
  needsProfile: null,
  valid: (value) => CONTRACTS.includes(value as ContractCode),
  passes: (job, contract) => job.match?.facts.contract === contract,
};

const REMOTE: FilterGroup<'remote'> = {
  key: 'remote',
  heading: null,
  entries: () => [
    { id: 'remote-only', value: 'remote', label: (w) => w.toolbar.remoteOnly },
    { id: 'remote-hybrid', value: 'hybrid', label: (w) => w.toolbar.remoteOrHybrid },
  ],
  needsProfile: null,
  valid: (value) => value === 'remote' || value === 'hybrid',
  // As the backend: the share the ad states first, the location's work mode only without one.
  passes: (job, mode) => {
    const facts = job.match?.facts;
    if (mode === 'remote') {
      const share = facts?.remoteFrom ?? facts?.remoteTo ?? null;
      return share === null ? job.workMode === 'remote' : share >= 100;
    }
    const most = facts?.remoteTo ?? facts?.remoteFrom ?? null;
    return most === null ? job.workMode === 'remote' || job.workMode === 'hybrid' : most > 0;
  },
};

const PAY: FilterGroup<'pay'> = {
  key: 'pay',
  heading: null,
  entries: () =>
    (['min', 'wish'] as const).map((pay) => ({
      id: `pay-${pay}`,
      value: pay,
      label: (w) => w.toolbar.pay[pay],
      offered: (context) => payFloor(pay, context) !== null,
    })),
  needsProfile: null,
  valid: (value) => value === 'min' || value === 'wish',
  // As the backend: employment by its salary, any other job by its day rate in euros; a job
  // without a stated pay, or without a floor for its kind, never passes.
  passes: (job, pay, context) => {
    if (employed(job)) {
      const salary = job.match?.facts.salary ?? null;
      return salary !== null && context.minSalary !== null && salary >= context.minSalary;
    }
    const rate = dayRate(job);
    const floor = payFloor(pay, context);
    return rate !== null && floor !== null && rate >= floor;
  },
};

const UNREAD: FilterGroup<'unread'> = {
  key: 'unread',
  heading: null,
  entries: () => [{ id: 'unread-only', value: true, label: (w) => w.toolbar.unreadOnly }],
  needsProfile: null,
  valid: (value) => value === true,
  passes: (job) => job.unread,
};

/** The groups of the filter in the menu's order (and the chips'). */
export const FILTER_GROUPS: readonly FilterGroup[] = [PORTAL, BAND, CONTRACT, REMOTE, PAY, UNREAD];

/** The entries of a group the menu offers now. */
export function offeredEntries<K extends keyof ListFilter>(
  group: FilterGroup<K>,
  portals: readonly Portal[],
  context: FilterContext,
): FilterEntry<K>[] {
  return group.entries(portals).filter((entry) => entry.offered?.(context) ?? true);
}

/** The filter as it applies: a pay floor the profile does not name any more is none. */
export function applicable(filter: ListFilter, context: FilterContext): ListFilter {
  return filter.pay !== null && payFloor(filter.pay, context) === null
    ? { ...filter, pay: null }
    : filter;
}

/** Some part of the filter is chosen. */
export function isFiltered(filter: ListFilter): boolean {
  return FILTER_GROUPS.some((group) => filter[group.key] !== null);
}

/** A chosen part of the filter: its group and its words (a chip under the list header). */
export interface ActiveFilter {
  key: keyof ListFilter;
  label: string;
}

/** The chosen parts of the filter in the chips' words, group by group ("linkedin.com",
 *  "Ab mittlerer Übereinstimmung", "Nur remote"). */
export function activeFilters(
  filter: ListFilter,
  portals: readonly Portal[],
  words: Catalog,
): ActiveFilter[] {
  return FILTER_GROUPS.flatMap((group) => {
    const value = filter[group.key];
    if (value === null) return [];
    const entry = group.entries(portals).find((candidate) => candidate.value === value);
    return entry === undefined
      ? []
      : [{ key: group.key, label: (entry.chip ?? entry.label)(words) }];
  });
}

/** Does a job pass the filter (the backend's store::filter_condition)? It narrows the list
 *  and its counts alike. */
export function passesFilter(job: JobView, filter: ListFilter, context: FilterContext): boolean {
  return FILTER_GROUPS.every((group) => {
    const value = filter[group.key];
    return value === null || group.passes(job, value as never, context);
  });
}

/** A kept filter (localStorage): each part a group can hold, none for anything else (a kept
 *  "Nur remote" of an earlier version is the remote choice of Arbeitsmodell). */
export function parseFilter(kept: unknown): ListFilter {
  const parts = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {};
  const filter: Record<string, unknown> = { ...NO_FILTER };
  for (const group of FILTER_GROUPS) {
    const value = group.key === 'remote' && parts.remote === true ? 'remote' : parts[group.key];
    if (group.valid(value)) filter[group.key] = value;
  }
  return filter as unknown as ListFilter;
}
