// The Übersicht's ways into the Jobs view, in one place: each opens the Eingang (the one
// work list) with exactly the filter its count names, no search, the kept order untouched,
// and, for the excluded jobs, their section opened and brought into view. When the list's API
// changes, only this file follows.

import type { JobView } from '$lib/ipc/types';
import { NO_FILTER, passesFilter, type ListFilter } from '$lib/state/filter';
import { jobs } from '$lib/state/jobs.svelte';
import { navigation } from '$lib/state/navigation.svelte';

/** Jobs with the Eingang and only this filter (the view first: an unsaved Profil may ask). */
function show(filter: ListFilter, revealExcluded = false): void {
  navigation.go('jobs', false, () => {
    if (revealExcluded) jobs.revealExcluded = true;
    if (jobs.place !== 'inbox' || jobs.search !== '') jobs.setPlace('inbox', true);
    jobs.setFilter(filter);
  });
}

/** "Neu": the Eingang, its unopened jobs marked by their dot. */
export function toNew(): void {
  show(NO_FILTER);
}

/** "Hohe Passung": the Eingang's jobs of the high band ("Nur hohe Passung"). */
export function toHigh(): void {
  show({ ...NO_FILTER, minBand: 'high' });
}

/** The excluded jobs not opened yet: the Eingang with its excluded section open and in view. */
export function toExcluded(): void {
  show(NO_FILTER, true);
}

/** A job of the Übersicht, open in Jobs: in the Eingang, without a search or a filter that
 *  would hide it. */
export function openJob(job: JobView): void {
  navigation.go('jobs', false, () => {
    if (jobs.place !== 'inbox' || jobs.search !== '') jobs.setPlace('inbox', true);
    if (!passesFilter(job, jobs.filter)) jobs.setFilter(NO_FILTER);
    void jobs.select(job, true);
  });
}
