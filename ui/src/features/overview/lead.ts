// The Übersicht's ways into the Jobs view, in one place: each opens exactly the set its
// count names (no search, no filter but its own, the kept order untouched). They use the
// list's public setters (facet, filter, search) and the list's kept fold of the excluded
// jobs; when the list's API changes, only this file follows.

import type { JobView } from '$lib/ipc/types';
import {
  NO_FILTER,
  inFacet,
  inListFilter,
  jobs,
  type JobFacet,
  type ListFilter,
} from '$lib/state/jobs.svelte';
import { navigation } from '$lib/state/navigation.svelte';

/** Where the list keeps whether its excluded section is open (JobList reads it on mount). */
const EXCLUDED_OPEN_KEY = 'jobs-excluded-open';

function keepExcludedOpen(): void {
  try {
    localStorage.setItem(EXCLUDED_OPEN_KEY, '1');
  } catch {
    // Without a store the section opens with the job she opens there.
    return;
  }
}

/** Jobs with this list of the inbox and only this filter (the view first: an unsaved Profil
 *  may ask). */
function show(facet: JobFacet, filter: ListFilter, excludedOpen = false): void {
  navigation.go('jobs', false, () => {
    if (excludedOpen) keepExcludedOpen();
    if (jobs.facet !== facet || jobs.search !== '') jobs.setFacet(facet, true);
    jobs.setFilter(filter);
  });
}

/** "Neu": the unopened jobs of the inbox. */
export function toNew(): void {
  show('new', NO_FILTER);
}

/** "Hohe Passung": the inbox's jobs of the high band, read or not ("Nur hohe Passung"). */
export function toHigh(): void {
  show('all', { ...NO_FILTER, minBand: 'high' });
}

/** The excluded jobs not opened yet: the new ones with their excluded section open. */
export function toExcluded(): void {
  show('new', NO_FILTER, true);
}

/** "Alle n Favoriten": the favourites of the inbox. */
export function toFavourites(): void {
  show('favourites', NO_FILTER);
}

/** A job of the Übersicht, open in Jobs: in a list of the inbox that holds it, without a
 *  search or a filter that would hide it. */
export function openJob(job: JobView): void {
  navigation.go('jobs', false, () => {
    if (!inFacet(job, jobs.facet) || jobs.search !== '') {
      jobs.setFacet(inFacet(job, 'new') ? 'new' : 'all', true);
    }
    if (!inListFilter(job, jobs.filter)) jobs.setFilter(NO_FILTER);
    void jobs.select(job, true);
  });
}
