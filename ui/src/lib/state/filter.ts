// The filter of the job list as one table: its groups in their order, each with its choices,
// its words and what it lets through. The funnel's menu (ListHeader),
// the chips under the list header, the store's query and the harness all read it: another
// group is one entry of FILTER_GROUPS (and its field in ListFilter, which `toQuery` hands to
// the JobQuery), another word one in the catalog. The filter is the same in every
// place (Aktuell, Archiv, Papierkorb) and kept per user like the order. The order of the list
// (SORTS) is the first group of the same menu, "Sortierung", but no part of the filter: it
// sets no dot and no chip, and "Filter zurücksetzen" leaves it. A group lists every value of
// its dimension or is not there at all (user decision 2026-09-27): Quelle and Übereinstimmung
// (Hoch, Mittel, Gering) take several choices at once, any of them lets a job through;
// Gefunden (Heute, Letzte 7 Tage, Letzte 30 Tage) one (user decision 2026-10-01). None is
// checked while a group filters nothing; a second click turns a choice off, and in Gefunden
// another one takes over. There is no contract, work mode, deadline or pay filter (user
// decision 2026-10-01: only what is used); the reader's Jobdetails name them, the order by
// Tagessatz stays.
// Beside the groups the "Zeigen" of a fetch's toast narrows the list to the new jobs of that
// fetch (`run`, the chip "Aus dem letzten Abruf"): no entry of the menu, never kept, gone
// with "Filter zurücksetzen" and the next fetch.
//
// Plain TypeScript with type-only imports: the harness imports it as it is.

import type { Catalog } from '../i18n/de';
import type { Band, JobQuery, JobSort, JobView, Portal } from '../ipc/types';

/** The bands the filter offers, the highest first. */
export const BANDS: readonly Band[] = ['high', 'mid', 'low'];

/** The days "Gefunden" offers: today, the last 7 and the last 30 (today among them). */
export const RECEIVED = ['today', 'days7', 'days30'] as const;
export type Received = (typeof RECEIVED)[number];

/** The filter: each group's choices, none = empty or null (`toQuery` hands it to the
 *  JobQuery). */
export interface ListFilter {
  /** Only these portals' jobs. */
  portals: Portal[];
  /** Only jobs scored in these bands (unscored and excluded jobs never pass). */
  bands: Band[];
  /** Only the jobs that came on these days (`receivedSince`). */
  received: Received | null;
  /** Only the new jobs of this fetch (`RunSummary.run`), the ones its toast counts: the
   *  "Zeigen" of the toast sets it, its chip "Aus dem letzten Abruf" takes it off. No group
   *  of the menu, never kept, and the next fetch drops it (its chip would say another). */
  run: number | null;
}

export const NO_FILTER: ListFilter = {
  portals: [],
  bands: [],
  received: null,
  run: null,
};

/** A new job, in any place: not opened yet and not excluded; the row's dot marks it (like a
 *  mail app's unread mark). */
export const isNew = (job: JobView): boolean => job.unread && job.match?.status !== 'excluded';

/** The first second of the days a choice of "Gefunden" lets through, in the user's time
 *  zone: the start of today, of the day 6 or 29 days before it (Unix seconds). */
export function receivedSince(received: Received, now: Date): number {
  const back = received === 'today' ? 0 : received === 'days7' ? 6 : 29;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  return Math.floor(day.getTime() / 1000);
}

/** When a job came, as "Nach Datum" orders it: the alert mail's date, else its first
 *  sighting (Unix seconds). */
const cameAt = (job: JobView): number => Date.parse(job.mailDate ?? job.firstSeenAt) / 1000;

/** The filter's part of a JobQuery (`now` for the days of "Gefunden"). */
export function toQuery(
  filter: ListFilter,
  now = new Date(),
): Omit<JobQuery, 'place' | 'sort' | 'search' | 'limit' | 'offset'> {
  return {
    portals: filter.portals,
    bands: filter.bands,
    run: filter.run,
    receivedSince: filter.received === null ? null : receivedSince(filter.received, now),
  };
}

/** A part of the filter a group of the menu sets. */
export type GroupKey = Exclude<keyof ListFilter, 'run'>;

/** A choice of a group in the menu. */
export interface FilterEntry {
  /** Stable id: the test id of the menu entry (`menu-item-<id>`). */
  id: string;
  /** One value of its group (a portal, a band, a day range, `true` for a switch). */
  value: string | true;
  /** Its words in the menu, under the group's heading. */
  label: (words: Catalog) => string;
  /** Its words as a chip, where the menu's short words need their heading ("Mittel" under
   *  "Übereinstimmung" is the chip "Mittlere Übereinstimmung"); else the label. */
  chip?: (words: Catalog) => string;
}

export interface FilterGroup {
  key: GroupKey;
  /** Several of its choices at once (any of them lets a job through); else one. */
  multi: boolean;
  /** The small heading above the group in the menu; null where its words speak for
   *  themselves. */
  heading: ((words: Catalog) => string) | null;
  /** The choices in the menu's order (a group of one is a switch); the portal group lists
   *  the portals it is given (the UI's order, lib/portals.ts). */
  entries(portals: readonly Portal[]): FilterEntry[];
  /** Without a usable profile there is no match: the group is off and says why. */
  needsProfile: ((words: Catalog) => string) | null;
  /** A kept value this group can hold (one of a multi group's). */
  valid(value: unknown): boolean;
  /** Whether a job passes one choice (the backend's store::filter_condition). */
  passes(job: JobView, value: never): boolean;
}

/** The choices of a group in the filter, none an empty list. */
export function chosenOf(filter: ListFilter, group: FilterGroup): readonly unknown[] {
  const value = filter[group.key];
  return Array.isArray(value) ? value : value === null ? [] : [value];
}

/** The change a click on a choice makes: a multi group adds or drops it, another group takes
 *  it or (chosen already) drops it. */
export function chooseIn(
  filter: ListFilter,
  group: FilterGroup,
  value: string | true,
): Partial<ListFilter> {
  const chosen = chosenOf(filter, group);
  const on = chosen.includes(value);
  if (group.multi) {
    return { [group.key]: on ? chosen.filter((each) => each !== value) : [...chosen, value] };
  }
  return { [group.key]: on ? null : value };
}

/** The part of the filter without a group's choice (`value`), or without the whole group. */
export function dropFrom(
  filter: ListFilter,
  key: keyof ListFilter,
  value?: unknown,
): Partial<ListFilter> {
  const current = filter[key];
  if (Array.isArray(current) && value !== undefined) {
    return { [key]: (current as unknown[]).filter((each) => each !== value) };
  }
  return { [key]: NO_FILTER[key] };
}

/** The orders of every list, the funnel menu's first group in its order. */
export const SORTS: readonly JobSort[] = ['match', 'newest', 'rate'];

/** The id of an order in the funnel's menu (its test id `menu-item-sort-<order>`). */
export const sortEntryId = (sort: JobSort): string => `sort-${sort}`;

const PORTAL: FilterGroup = {
  key: 'portals',
  multi: true,
  heading: (w) => w.toolbar.portalHeading,
  entries: (portals) =>
    portals.map((portal) => ({
      id: `portal-${portal}`,
      value: portal,
      label: (w) => w.portal[portal],
    })),
  needsProfile: null,
  valid: (value) => typeof value === 'string',
  passes: (job, portal: Portal) => job.key.portal === portal,
};

const BAND: FilterGroup = {
  key: 'bands',
  multi: true,
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
  passes: (job, band: Band) =>
    job.match !== null && job.match.status === 'scored' && job.match.band === band,
};

const RECEIVED_GROUP: FilterGroup = {
  key: 'received',
  multi: false,
  heading: (w) => w.toolbar.receivedHeading,
  entries: () =>
    RECEIVED.map((received) => ({
      id: `received-${received}`,
      value: received,
      label: (w) => w.toolbar.received[received],
      chip: (w) => w.toolbar.receivedChip[received],
    })),
  needsProfile: null,
  valid: (value) => RECEIVED.includes(value as Received),
  passes: (job, received: Received) => cameAt(job) >= receivedSince(received, new Date()),
};

/** The groups of the filter in the menu's order (and the chips'). */
export const FILTER_GROUPS: readonly FilterGroup[] = [PORTAL, BAND, RECEIVED_GROUP];

/** Some part of the filter is chosen (the run of a fetch's "Zeigen" too). */
export function isFiltered(filter: ListFilter): boolean {
  return filter.run !== null || FILTER_GROUPS.some((group) => chosenOf(filter, group).length > 0);
}

/** A chosen part of the filter: its group, its value and its words (a chip under the list
 *  header; a group of several choices has a chip for each). */
export interface ActiveFilter {
  /** The id of its entry in the menu (`run` for the run of a fetch's "Zeigen"): its chip's
   *  test id `chip-<id>`. */
  id: string;
  key: keyof ListFilter;
  value: unknown;
  label: string;
}

/** The chosen parts of the filter in the chips' words: the run of a fetch's "Zeigen" first
 *  (its own words), then group by group in the menu's order ("linkedin.com", "hays.de",
 *  "Mittlere Übereinstimmung", "Heute eingegangen"). */
export function activeFilters(
  filter: ListFilter,
  portals: readonly Portal[],
  words: Catalog,
): ActiveFilter[] {
  const run: ActiveFilter[] =
    filter.run === null
      ? []
      : [{ id: 'run', key: 'run', value: filter.run, label: words.toolbar.lastFetch }];
  return [
    ...run,
    ...FILTER_GROUPS.flatMap((group) => {
      const chosen = chosenOf(filter, group);
      return group
        .entries(portals)
        .filter((entry) => chosen.includes(entry.value))
        .map((entry) => ({
          id: entry.id,
          key: group.key,
          value: entry.value,
          label: (entry.chip ?? entry.label)(words),
        }));
    }),
  ];
}

/** Does a job pass the filter (the backend's store::filter_condition)? It narrows the list
 *  and its counts alike: in each group any of its choices. A row does not say the run it
 *  came with: the run lets through every job it could hold (none excluded), the backend's
 *  list decides the rest. */
export function passesFilter(job: JobView, filter: ListFilter): boolean {
  if (filter.run !== null && job.match?.status === 'excluded') return false;
  return FILTER_GROUPS.every((group) => {
    const chosen = chosenOf(filter, group);
    return chosen.length === 0 || chosen.some((value) => group.passes(job, value as never));
  });
}

/** A kept filter (localStorage): each part a group can hold, none for anything else (the
 *  parts of an earlier version, one portal or one band, a lowest band, a contract type, a
 *  work mode, "Nur neue", a pay floor, are none; a run is never kept). */
export function parseFilter(kept: unknown): ListFilter {
  const parts = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {};
  const filter: Record<string, unknown> = { ...NO_FILTER };
  for (const group of FILTER_GROUPS) {
    const value = parts[group.key];
    if (group.multi) {
      if (Array.isArray(value)) {
        filter[group.key] = [...new Set(value.filter((each) => group.valid(each)))];
      }
    } else if (group.valid(value)) filter[group.key] = value;
  }
  return filter as unknown as ListFilter;
}
