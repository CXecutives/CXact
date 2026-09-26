// The funnel of the inbox as one table: the groups of its menu in their order, each group's
// entries (the first one is the default) and what each entry does. The menu (ListHeader),
// the line that names an active filter, "Filter zurücksetzen", the store's query and the
// harness all read it: another filter, another order or another word is a change here and
// in the catalog, nowhere else. The archive and the trash have no filter (only the order).
//
// Plain TypeScript with type-only imports: the harness imports it as it is.

import type { Catalog } from '../i18n/de';
import type { Band, JobSort, JobView, Portal } from '../ipc/types';

/** The lowest band the filter asks for: `mid` lists the mid and the high band. */
export type FilterBand = Exclude<Band, 'low'>;

/** The filter of the inbox (kept per user like the order). */
export interface ListFilter {
  /** Only this portal's jobs; null = every portal. */
  portal: Portal | null;
  /** Only jobs scored in this band or better; null = every job (unscored, excluded too). */
  minBand: FilterBand | null;
}

export const NO_FILTER: ListFilter = { portal: null, minBand: null };

/** What the menu sets: the order of every list and the filter of the inbox. */
export interface ListChoice {
  sort: JobSort;
  filter: ListFilter;
}

/** What picking an entry changes: another order, or only the parts of the filter it names
 *  (a part it does not name stays as chosen, also one that does not apply at the moment,
 *  such as a band without a profile). */
export interface ListChange {
  sort?: JobSort;
  filter?: Partial<ListFilter>;
}

export interface FilterEntry {
  /** Stable id: the test id of the menu entry (`menu-item-<id>`). */
  id: string;
  label: (words: Catalog) => string;
  /** The chosen entry of its group (a switch: on). */
  on: (choice: ListChoice) => boolean;
  /** What picking it changes (a switch turns off again). */
  pick: (choice: ListChoice) => ListChange;
  /** Without a usable profile there is no fit: the entry is off and says why. */
  needsProfile: ((words: Catalog) => string) | null;
}

export interface FilterGroup {
  id: 'sort' | 'portal' | 'band';
  /** The small heading above the group (none for a lone switch). */
  heading: ((words: Catalog) => string) | null;
  /** One switch (a checkbox entry) instead of one choice of several. */
  toggle: boolean;
  /** The group narrows the list (the dot, the line, the reset); the order does not. */
  filters: boolean;
  /** The entries; the portal group lists the portals it is given (the app's order). */
  entries: (portals: readonly Portal[]) => FilterEntry[];
}

/** The orders of every list, in the menus' order (the funnel's, the Archiv's and the
 *  Papierkorb's). */
export const SORTS: readonly JobSort[] = ['match', 'newest'];
const BANDS: readonly (FilterBand | null)[] = [null, 'mid', 'high'];

export const FILTER_GROUPS: readonly FilterGroup[] = [
  {
    id: 'sort',
    heading: (w) => w.toolbar.sortMenu,
    toggle: false,
    filters: false,
    entries: () =>
      SORTS.map((sort) => ({
        id: sort,
        label: (w) => w.toolbar.sortLabel[sort],
        on: (choice) => choice.sort === sort,
        pick: () => ({ sort }),
        needsProfile: sort === 'match' ? (w) => w.toolbar.sortNoProfile : null,
      })),
  },
  {
    id: 'portal',
    heading: (w) => w.toolbar.portalHeading,
    toggle: false,
    filters: true,
    entries: (portals) =>
      [null, ...portals].map((portal) => ({
        id: `portal-${portal ?? 'all'}`,
        label: (w) => (portal === null ? w.toolbar.allPortals : w.portal[portal]),
        on: (choice) => choice.filter.portal === portal,
        pick: () => ({ filter: { portal } }),
        needsProfile: null,
      })),
  },
  {
    id: 'band',
    heading: (w) => w.toolbar.bandHeading,
    toggle: false,
    filters: true,
    entries: () =>
      BANDS.map((band) => ({
        id: `band-${band ?? 'any'}`,
        label: (w) => w.toolbar.band[band ?? 'any'],
        on: (choice) => choice.filter.minBand === band,
        pick: () => ({ filter: { minBand: band } }),
        needsProfile: (w) => w.toolbar.bandNoProfile,
      })),
  },
];

/** Some part of the filter is not the default. */
export function isFiltered(filter: ListFilter): boolean {
  return (Object.keys(NO_FILTER) as (keyof ListFilter)[]).some(
    (key) => filter[key] !== NO_FILTER[key],
  );
}

/**
 * The active filter in words, group by group: the chosen entry of each filtering group that
 * is not its default ("linkedin.com", "Ab mittlerer Passung").
 */
export function filterWords(
  filter: ListFilter,
  portals: readonly Portal[],
  words: Catalog,
): string[] {
  const choice: ListChoice = { sort: 'match', filter };
  return FILTER_GROUPS.filter((group) => group.filters).flatMap((group) => {
    const entries = group.entries(portals);
    const chosen = entries.find((entry) => entry.on(choice));
    if (chosen === undefined || (!group.toggle && chosen === entries[0])) return [];
    return [chosen.label(words)];
  });
}

/** The bands each lowest band of the filter lets through. */
const BAND_FROM: Record<FilterBand, Band[]> = { mid: ['mid', 'high'], high: ['high'] };

/**
 * Does a job pass what narrows the counts too (the backend's store::filter_condition): the
 * portal and the band.
 */
export function passesFilter(job: JobView, filter: ListFilter): boolean {
  if (filter.portal !== null && job.key.portal !== filter.portal) return false;
  if (filter.minBand === null) return true;
  const match = job.match;
  return (
    match !== null && match.status === 'scored' && BAND_FROM[filter.minBand].includes(match.band)
  );
}

/** Does a job of the inbox belong to the filtered list? */
export function inListFilter(job: JobView, filter: ListFilter): boolean {
  return passesFilter(job, filter);
}

/** A kept filter (localStorage), or none when it holds something else. */
export function parseFilter(kept: unknown): ListFilter {
  if (typeof kept !== 'object' || kept === null) return NO_FILTER;
  const { portal, minBand } = kept as Record<string, unknown>;
  return {
    portal: typeof portal === 'string' ? (portal as Portal) : null,
    minBand: minBand === 'mid' || minBand === 'high' ? minBand : null,
  };
}
