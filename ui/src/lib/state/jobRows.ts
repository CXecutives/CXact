// Plain helpers over the job rows of the list, without state: a job's key and its section, the
// counts a change moves, the rows a reload keeps. The state is lib/state/jobs.svelte.ts.

import type { JobCounts, JobKey, JobView, Place } from '../ipc/types';

export const ZERO: JobCounts = {
  inbox: 0,
  archive: 0,
  trash: 0,
  excluded: 0,
  excludedArchive: 0,
  excludedTrash: 0,
};

export function keyOf(key: JobKey): string {
  return `${key.portal}:${key.id}`;
}

export function sameKey(a: JobKey | null, b: JobKey | null): boolean {
  return a !== null && b !== null && a.portal === b.portal && a.id === b.id;
}

export const isExcluded = (job: JobView): boolean => job.match?.status === 'excluded';

/** A job without a score yet (its ad not loaded or too short to score), not excluded: its
 *  own section after the scored jobs (design round 7). */
export const isUnscored = (job: JobView): boolean =>
  job.match === null || job.match.status === 'unscorable';

/** Every job passes (the counts over every job). */
const everyJob = (): boolean => true;

/**
 * What one job adds to the counts (the backend's definitions, store::job_page): each place
 * counts its jobs and its excluded ones; a job the filter of the counts (`passes`) leaves out
 * adds nothing (a change can take a job out of it or bring it in).
 */
function add(
  counts: JobCounts,
  job: JobView | null,
  sign: 1 | -1,
  passes: (job: JobView) => boolean = everyJob,
): JobCounts {
  if (job === null || !passes(job)) return counts;
  const at = (place: Place): number => (job.place === place ? sign : 0);
  const out = isExcluded(job);
  return {
    inbox: counts.inbox + at('inbox'),
    archive: counts.archive + at('archive'),
    trash: counts.trash + at('trash'),
    excluded: counts.excluded + (out ? at('inbox') : 0),
    excludedArchive: counts.excludedArchive + (out ? at('archive') : 0),
    excludedTrash: counts.excludedTrash + (out ? at('trash') : 0),
  };
}

/** `counts` after `before` became `after` (the same job); `passes`: the filter of the
 *  counts. */
export function moved(
  counts: JobCounts,
  before: JobView,
  after: JobView,
  passes: (job: JobView) => boolean = everyJob,
): JobCounts {
  return add(add(counts, before, -1, passes), after, 1, passes);
}

/** The text of a row as it came from the backend, kept per object (each is read once). */
const texts = new WeakMap<JobView, string>();

function textOf(job: JobView): string {
  let text = texts.get(job);
  if (text === undefined) {
    text = JSON.stringify(job);
    texts.set(job, text);
  }
  return text;
}

/**
 * `next` with every row that equals the one held keeping the held object: a reload of the
 * same list (a sort, an undo, the end of a run) renders only the rows that changed, not all
 * of them again.
 */
export function reused(held: readonly JobView[], next: JobView[]): JobView[] {
  const byKey = new Map(held.map((job) => [keyOf(job.key), job]));
  return next.map((job) => {
    const old = byKey.get(keyOf(job.key));
    return old !== undefined && textOf(old) === textOf(job) ? old : job;
  });
}

/** `list` with the row of `key` replaced by `change(row)` (the same array if absent). */
export function replaced(
  list: JobView[],
  key: JobKey,
  change: (job: JobView) => JobView,
): JobView[] {
  const index = list.findIndex((job) => sameKey(job.key, key));
  return index < 0 ? list : list.with(index, change(list[index]!));
}
