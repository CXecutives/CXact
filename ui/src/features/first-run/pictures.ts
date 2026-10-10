// The picture of the app beside the setup's steps (StepPicture.svelte) as data: which picture
// each step shows (steps.ts names it) and the scores of the example jobs. The words are the
// catalog's (`t.firstRun.picture`). Changing a picture is one entry here.

import type { Band } from '$lib/ipc/types';

/** A picture: example jobs with their rings, a profile filling itself, an alert mail and
 *  the jobs it brings. */
export type PictureId = 'jobs' | 'profile' | 'mail';

/** The scores of the example jobs, in the catalog's order: one in each colour of the ring. */
export const JOB_SCORES: readonly { score: number; band: Band }[] = [
  { score: 91, band: 'high' },
  { score: 78, band: 'mid' },
  { score: 64, band: 'mid' },
  { score: 41, band: 'mid' },
];

/** The scores of the jobs the alert mail brings. */
export const MAIL_SCORES: readonly { score: number; band: Band }[] = [
  { score: 86, band: 'high' },
  { score: 72, band: 'mid' },
];

/** The gap between two entries coming in, in ms (each slides in after the one before). */
export const STAGGER_MS = 40;
