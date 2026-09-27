// The filter of the job list as one table: its groups in their order, each with its choices,
// its words and what it lets through. The funnel's menu (ListHeader),
// the chips under the list header, the store's query and the harness all read it: another
// group is one entry of FILTER_GROUPS (and its field in ListFilter, which `toQuery` hands to
// the JobQuery), another word one in the catalog. The filter is the same in every
// place (Eingang, Archiv, Papierkorb) and kept per user like the order. The order of the list
// (SORTS) is the first group of the same menu, "Sortierung", but no part of the filter: it
// sets no dot and no chip, and "Filter zurücksetzen" leaves it. A group lists every value of
// its dimension or is not there at all (user decision 2026-09-27): Portal, Übereinstimmung
// (Hoch, Mittel, Gering), Vertragsart and Arbeitsmodell (Remote, Hybrid, Vor Ort) under a
// heading, "Nur neue" a switch of its own. None is checked while a group filters nothing: a
// choice is checked while it is on, another one of its group takes over, a second click
// turns it off. There is no deadline and no pay filter: the reader's Jobdetails name the
// deadline, the order by Tagessatz stays. Beside the groups the "Zeigen" of a fetch's toast
// narrows the list to the new jobs of that fetch (`run`, the chip "Aus dem letzten Abruf"):
// no entry of the menu, never kept, gone with "Filter zurücksetzen" and the next fetch.
//
// Plain TypeScript with type-only imports: the harness imports it as it is.

import type { Catalog } from '../i18n/de';
import type { Band, JobQuery, JobSort, JobView, Portal, WorkMode } from '../ipc/types';

/** The contract types the filter offers (KeyFacts.contract). */
export const CONTRACTS = ['interim', 'freelance', 'permanent', 'anue'] as const;
export type ContractCode = (typeof CONTRACTS)[number];

/** The bands the filter offers, the highest first. */
export const BANDS: readonly Band[] = ['high', 'mid', 'low'];

/** The work modes the filter offers. */
export const WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite'];

/** The filter: each group's choice, null = none (`toQuery` hands it to the JobQuery). */
export interface ListFilter {
  /** Only this portal's jobs. */
  portal: Portal | null;
  /** Only jobs scored in this band (unscored and excluded jobs never pass). */
  band: Band | null;
  /** Only jobs of this contract type. */
  contract: ContractCode | null;
  /** Only jobs of this work mode (`workModeOf`; a job of no known mode never passes). */
  workMode: WorkMode | null;
  /** Only the new jobs ("Nur neue", `isNew`). */
  unread: true | null;
  /** Only the new jobs of this fetch (`RunSummary.run`), the ones its toast counts: the
   *  "Zeigen" of the toast sets it, its chip "Aus dem letzten Abruf" takes it off. No group
   *  of the menu, never kept, and the next fetch drops it (its chip would say another). */
  run: number | null;
}

export const NO_FILTER: ListFilter = {
  portal: null,
  band: null,
  contract: null,
  workMode: null,
  unread: null,
  run: null,
};

/** A new job, in any place: not opened yet and not excluded. "Nur neue" lists these, the
 *  row's dot marks them (like a mail app's unread mark); the backend's store::NEW. */
export const isNew = (job: JobView): boolean => job.unread && job.match?.status !== 'excluded';

/** The work mode of a job as its Jobdetails name it (core's store::filter_condition): the
 *  remote share the ad states first (all of it remote, none of it on site, anything between
 *  hybrid), the location's work mode only without one; null when neither says. */
export function workModeOf(job: JobView): WorkMode | null {
  const facts = job.match?.facts ?? null;
  const from = facts?.remoteFrom ?? facts?.remoteTo ?? null;
  const to = facts?.remoteTo ?? facts?.remoteFrom ?? null;
  if (from === null || to === null) return job.workMode;
  return from >= 100 ? 'remote' : to <= 0 ? 'onsite' : 'hybrid';
}

/** The filter's part of a JobQuery. */
export function toQuery(
  filter: ListFilter,
): Omit<JobQuery, 'place' | 'sort' | 'search' | 'limit' | 'offset'> {
  return {
    unread: filter.unread === true,
    portal: filter.portal,
    band: filter.band,
    contracts: filter.contract === null ? [] : [filter.contract],
    workMode: filter.workMode,
    run: filter.run,
  };
}

/** A choice of a group in the menu. */
export interface FilterEntry<K extends keyof ListFilter = keyof ListFilter> {
  /** Stable id: the test id of the menu entry (`menu-item-<id>`). */
  id: string;
  value: ListFilter[K];
  /** Its words in the menu, under the group's heading. */
  label: (words: Catalog) => string;
  /** Its words as a chip, where the menu's short words need their heading ("Mittel" under
   *  "Übereinstimmung" is the chip "Mittlere Übereinstimmung"); else the label. */
  chip?: (words: Catalog) => string;
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
  passes(job: JobView, value: NonNullable<ListFilter[K]>): boolean;
}

/** The orders of every list, the funnel menu's first group in its order. */
export const SORTS: readonly JobSort[] = ['match', 'newest', 'rate'];

/** The id of an order in the funnel's menu (its test id `menu-item-sort-<order>`). */
export const sortEntryId = (sort: JobSort): string => `sort-${sort}`;

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

const BAND: FilterGroup<'band'> = {
  key: 'band',
  heading: (w) => w.toolbar.bandHeading,
  entries: () =>
    BANDS.map((band) => ({
      id: `band-${band}`,
      value: band,
      label: (w) => w.toolbar.band[band],
      chip: (w) => w.score.band[band],
    })),
  needsProfile: (w) => w.toolbar.bandNoProfile,
  valid: (value) => BANDS.includes(value as Band),
  passes: (job, band) =>
    job.match !== null && job.match.status === 'scored' && job.match.band === band,
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

const WORK_MODE: FilterGroup<'workMode'> = {
  key: 'workMode',
  heading: (w) => w.toolbar.workHeading,
  entries: () =>
    WORK_MODES.map((mode) => ({
      id: `mode-${mode}`,
      value: mode,
      label: (w) => w.toolbar.work[mode],
    })),
  needsProfile: null,
  valid: (value) => WORK_MODES.includes(value as WorkMode),
  passes: (job, mode) => workModeOf(job) === mode,
};

const UNREAD: FilterGroup<'unread'> = {
  key: 'unread',
  heading: null,
  entries: () => [{ id: 'unread-only', value: true, label: (w) => w.toolbar.unreadOnly }],
  needsProfile: null,
  valid: (value) => value === true,
  passes: isNew,
};

/** The groups of the filter in the menu's order (and the chips'). */
export const FILTER_GROUPS: readonly FilterGroup[] = [PORTAL, BAND, CONTRACT, WORK_MODE, UNREAD];

/** Some part of the filter is chosen (the run of a fetch's "Zeigen" too). */
export function isFiltered(filter: ListFilter): boolean {
  return filter.run !== null || FILTER_GROUPS.some((group) => filter[group.key] !== null);
}

/** A chosen part of the filter: its group and its words (a chip under the list header). */
export interface ActiveFilter {
  key: keyof ListFilter;
  label: string;
}

/** The chosen parts of the filter in the chips' words: the run of a fetch's "Zeigen" first
 *  (its own words), then group by group ("linkedin.com",
 *  "Mittlere Übereinstimmung", "Remote"). */
export function activeFilters(
  filter: ListFilter,
  portals: readonly Portal[],
  words: Catalog,
): ActiveFilter[] {
  const run: ActiveFilter[] =
    filter.run === null ? [] : [{ key: 'run', label: words.toolbar.lastFetch }];
  return [
    ...run,
    ...FILTER_GROUPS.flatMap((group) => {
      const value = filter[group.key];
      if (value === null) return [];
      const entry = group.entries(portals).find((candidate) => candidate.value === value);
      return entry === undefined
        ? []
        : [{ key: group.key, label: (entry.chip ?? entry.label)(words) }];
    }),
  ];
}

/** Does a job pass the filter (the backend's store::filter_condition)? It narrows the list
 *  and its counts alike. A row does not say the run it came with: the run lets through every
 *  job it could hold (none excluded), the backend's list decides the rest. */
export function passesFilter(job: JobView, filter: ListFilter): boolean {
  if (filter.run !== null && job.match?.status === 'excluded') return false;
  return FILTER_GROUPS.every((group) => {
    const value = filter[group.key];
    return value === null || group.passes(job, value as never);
  });
}

/** A kept filter (localStorage): each part a group can hold, none for anything else (the
 *  parts of an earlier version, a lowest band, "Nur remote", a pay floor, are none; a run is
 *  never kept). */
export function parseFilter(kept: unknown): ListFilter {
  const parts = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {};
  const filter: Record<string, unknown> = { ...NO_FILTER };
  for (const group of FILTER_GROUPS) {
    const value = parts[group.key];
    if (group.valid(value)) filter[group.key] = value;
  }
  return filter as unknown as ListFilter;
}
