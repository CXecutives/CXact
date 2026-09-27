// The filter of the job list as one table: its groups in their order, each with its choices
// (the first is none), its words and what it lets through. The funnel's menu (ListHeader),
// the chips under the list header, the store's query and the harness all read it: another
// group is one entry of FILTER_GROUPS (and its field in ListFilter, which `toQuery` hands to
// the JobQuery), another word one in the catalog. The filter is the same in every
// place (Eingang, Archiv, Papierkorb) and kept per user like the order. The order of the list
// is a choice of its own (SORTS, the sort button).
//
// Plain TypeScript with type-only imports: the harness imports it as it is.

import type { Catalog } from '../i18n/de';
import type { Band, JobQuery, JobSort, JobView, Portal } from '../ipc/types';

/** The lowest band the filter asks for: `mid` lists the mid and the high band. */
export type FilterBand = Exclude<Band, 'low'>;

/** The contract types the filter offers (KeyFacts.contract). */
export const CONTRACTS = ['interim', 'freelance', 'permanent', 'anue'] as const;
export type ContractCode = (typeof CONTRACTS)[number];

/** The filter: each group's choice, null = none (`toQuery` hands it to the JobQuery). */
export interface ListFilter {
  /** Only this portal's jobs. */
  portal: Portal | null;
  /** Only jobs scored in this band or better (unscored and excluded jobs never pass). */
  minBand: FilterBand | null;
  /** Only jobs of this contract type. */
  contract: ContractCode | null;
  /** Only fully remote jobs. */
  remote: true | null;
}

export const NO_FILTER: ListFilter = { portal: null, minBand: null, contract: null, remote: null };

/** The filter's part of a JobQuery. */
export function toQuery(
  filter: ListFilter,
): Pick<JobQuery, 'portal' | 'minBand' | 'contracts' | 'remoteOnly'> {
  return {
    portal: filter.portal,
    minBand: filter.minBand,
    contracts: filter.contract === null ? [] : [filter.contract],
    remoteOnly: filter.remote === true,
  };
}

/** A choice of a group in the menu. */
export interface FilterEntry<K extends keyof ListFilter = keyof ListFilter> {
  /** Stable id: the test id of the menu entry (`menu-item-<id>`). */
  id: string;
  value: ListFilter[K];
  label: (words: Catalog) => string;
}

export interface FilterGroup<K extends keyof ListFilter = keyof ListFilter> {
  key: K;
  /** The small heading above the group in the menu. */
  heading: (words: Catalog) => string;
  /** The choices in the menu's order, none first; the portal group lists the portals it is
   *  given (the app's order). */
  entries(portals: readonly Portal[]): FilterEntry<K>[];
  /** Without a usable profile there is no match: the group is off and says why. */
  needsProfile: ((words: Catalog) => string) | null;
  /** A kept value this group can hold. */
  valid(value: unknown): boolean;
  /** Whether a job passes a choice (the backend's store::filter_condition). */
  passes(job: JobView, value: NonNullable<ListFilter[K]>): boolean;
}

/** The orders of every list, in the sort button's order. */
export const SORTS: readonly JobSort[] = ['match', 'newest'];

/** The bands each lowest band of the filter lets through. */
const BAND_FROM: Record<FilterBand, Band[]> = { mid: ['mid', 'high'], high: ['high'] };

const PORTAL: FilterGroup<'portal'> = {
  key: 'portal',
  heading: (w) => w.toolbar.portalHeading,
  entries: (portals) =>
    [null, ...portals].map((portal) => ({
      id: `portal-${portal ?? 'all'}`,
      value: portal,
      label: (w) => (portal === null ? w.toolbar.allPortals : w.portal[portal]),
    })),
  needsProfile: null,
  valid: (value) => typeof value === 'string',
  passes: (job, portal) => job.key.portal === portal,
};

const BAND: FilterGroup<'minBand'> = {
  key: 'minBand',
  heading: (w) => w.toolbar.bandHeading,
  entries: () =>
    ([null, 'mid', 'high'] as const).map((band) => ({
      id: `band-${band ?? 'any'}`,
      value: band,
      label: (w) => w.toolbar.band[band ?? 'any'],
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
    [null, ...CONTRACTS].map((contract) => ({
      id: `contract-${contract ?? 'any'}`,
      value: contract,
      label: (w) => (contract === null ? w.toolbar.anyContract : w.reader.contractKind[contract]),
    })),
  needsProfile: null,
  valid: (value) => CONTRACTS.includes(value as ContractCode),
  passes: (job, contract) => job.match?.facts.contract === contract,
};

/** A place the ad calls remote, and no hybrid or on-site word beside it. */
const REMOTE_PLACE = /\bremote\b/i;
const NOT_REMOTE_PLACE = /\b(hybrid|vor ort|on-?site)\b/i;

const REMOTE: FilterGroup<'remote'> = {
  key: 'remote',
  heading: (w) => w.toolbar.workHeading,
  entries: () =>
    ([null, true] as const).map((remote) => ({
      id: `remote-${remote === null ? 'any' : 'only'}`,
      value: remote,
      label: (w) => (remote === null ? w.toolbar.anyWork : w.toolbar.remoteOnly),
    })),
  needsProfile: null,
  valid: (value) => value === true,
  // As the backend: the share the ad states first, the place only without one.
  passes: (job) => {
    const facts = job.match?.facts;
    const share = facts?.remoteFrom ?? facts?.remoteTo ?? null;
    if (share !== null) return share >= 100;
    return REMOTE_PLACE.test(job.location) && !NOT_REMOTE_PLACE.test(job.location);
  },
};

/** The groups of the filter in the menu's order (and the chips'). */
export const FILTER_GROUPS: readonly FilterGroup[] = [PORTAL, BAND, CONTRACT, REMOTE];

/** Some part of the filter is chosen. */
export function isFiltered(filter: ListFilter): boolean {
  return FILTER_GROUPS.some((group) => filter[group.key] !== null);
}

/** A chosen part of the filter: its group and its words (a chip under the list header). */
export interface ActiveFilter {
  key: keyof ListFilter;
  label: string;
}

/** The chosen parts of the filter in the menu's words, group by group ("linkedin.com",
 *  "Ab mittlerer Übereinstimmung"). */
export function activeFilters(
  filter: ListFilter,
  portals: readonly Portal[],
  words: Catalog,
): ActiveFilter[] {
  return FILTER_GROUPS.flatMap((group) => {
    const value = filter[group.key];
    if (value === null) return [];
    const entry = group.entries(portals).find((candidate) => candidate.value === value);
    return entry === undefined ? [] : [{ key: group.key, label: entry.label(words) }];
  });
}

/** Does a job pass the filter (the backend's store::filter_condition)? It narrows the list
 *  and its counts alike. */
export function passesFilter(job: JobView, filter: ListFilter): boolean {
  return FILTER_GROUPS.every((group) => {
    const value = filter[group.key];
    return value === null || group.passes(job, value as never);
  });
}

/** A kept filter (localStorage): each part a group can hold, none for anything else. */
export function parseFilter(kept: unknown): ListFilter {
  const parts = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {};
  const filter: Record<string, unknown> = { ...NO_FILTER };
  for (const group of FILTER_GROUPS) {
    const value = parts[group.key];
    if (group.valid(value)) filter[group.key] = value;
  }
  return filter as unknown as ListFilter;
}
