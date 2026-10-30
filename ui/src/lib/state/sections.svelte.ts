// The two sections after the scored jobs of every place, each behind a fold: "Noch nicht
// bewertet" (open by default) and "Ausgeschlossen" (folded by default). Each choice is kept like
// the order (per user). The list draws them (features/jobs/JobList.svelte) and the next job
// after a move reads them: a row behind a fold is not on screen, so it is no job to open.

import type { JobView } from '../ipc/types';
import { isExcluded, isUnscored } from './jobRows';

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
    return (isExcluded(job) && !this.excludedOpen) || (isUnscored(job) && !this.unscoredOpen);
  }
}

export const sections = new Sections();
