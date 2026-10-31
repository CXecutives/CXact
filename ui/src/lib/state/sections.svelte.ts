// The two sections after the scored jobs of every place, each behind a fold: "Noch nicht
// bewertet" (open by default) and "Ausgeschlossen" (folded by default). Each choice is kept like
// the order (per user). A search holds both open for now, so a hit is never hidden behind a
// fold, and the kept choice returns once it is off. What shows now is said here once: the list
// draws by it (features/jobs/JobList.svelte) and the next job after a move reads it: a row
// behind a closed fold is not on screen, so it is no job to open.

import type { JobView } from '../ipc/types';
import { isExcluded, isUnscored } from './jobRows';
import { jobs } from './jobs.svelte';

const EXCLUDED_KEY = 'jobs-excluded-open';
const UNSCORED_KEY = 'jobs-unscored-open';

/** A kept choice; a store that cannot be read keeps the default. */
function kept(key: string, open: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? open : value === '1';
  } catch {
    return open;
  }
}

function keep(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // Without a store the choice lasts for this session only.
    return;
  }
}

class Sections {
  excludedOpen = $state(kept(EXCLUDED_KEY, false));
  unscoredOpen = $state(kept(UNSCORED_KEY, true));

  /** Its rows show now: it stands open by the choice, or a search holds it open. */
  get excludedShown(): boolean {
    return this.excludedOpen || jobs.searching;
  }

  get unscoredShown(): boolean {
    return this.unscoredOpen || jobs.searching;
  }

  toggleExcluded(): void {
    this.excludedOpen = !this.excludedOpen;
    keep(EXCLUDED_KEY, this.excludedOpen);
  }

  toggleUnscored(): void {
    this.unscoredOpen = !this.unscoredOpen;
    keep(UNSCORED_KEY, this.unscoredOpen);
  }

  /** The job's row stands behind a fold that is closed. */
  folded(job: JobView): boolean {
    return (isExcluded(job) && !this.excludedShown) || (isUnscored(job) && !this.unscoredShown);
  }
}

export const sections = new Sections();
