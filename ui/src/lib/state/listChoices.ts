// The order and the filter of the job list as the user chose them, kept per user (read by
// lib/state/jobs.svelte.ts). A store that cannot be read keeps the default; without one the choice
// lasts for this session. Here too the one way to forget all the page keeps (`forgetKept`).

import type { JobSort } from '../ipc/types';
import { isFiltered, NO_FILTER, parseFilter, type ListFilter } from './filter';

/** "Alles zurücksetzen": all the page keeps goes, the list's choices and the others' (the open
 *  job, the sidebar, the widths). The store is the web view's: it outlives the restart, and core's
 *  reset does not reach it. */
export function forgetKept(): void {
  try {
    localStorage.clear();
  } catch {
    // Without a store nothing was kept.
    return;
  }
}

/** Where the order of the list is kept (one choice for every list, per user). */
const SORT_KEY = 'jobs-sort';

/** The kept order; a store that cannot be read keeps the default, by date (decision 1,
 *  2026-10-24: the days' headings, the open jobs of a day before the closed ones, then the
 *  best match). */
export function keptSort(): JobSort {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return value === 'match' || value === 'rate' ? value : 'newest';
  } catch {
    return 'newest';
  }
}

export function keepSort(sort: JobSort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // Without a store the order lasts for this session only.
    return;
  }
}

/** Where the filter is kept (like the order, per user). */
const FILTER_KEY = 'jobs-filter';

/** The kept filter; a store that cannot be read, or holds something else, keeps none. The
 *  portal is checked against the app's portals where it applies (`filter`). */
export function keptFilter(): ListFilter {
  try {
    return parseFilter(JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as unknown);
  } catch {
    return NO_FILTER;
  }
}

/** Keeps the user's filter; the run of a fetch's "Zeigen" is never kept. */
export function keepFilter(filter: ListFilter): void {
  const kept = { ...filter, run: null };
  try {
    if (isFiltered(kept)) localStorage.setItem(FILTER_KEY, JSON.stringify(kept));
    else localStorage.removeItem(FILTER_KEY);
  } catch {
    // Without a store the filter lasts for this session only.
    return;
  }
}
