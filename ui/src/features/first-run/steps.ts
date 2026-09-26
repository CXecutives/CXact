// The first-run steps as data: their order, their names and when each is done (ticked).
// FirstRunView.svelte numbers and renders them in this order, the first open one is the
// current step (its main action is the one primary); each step's body is the view's snippet
// of the same id. Adding, moving or removing a step is one entry here and its snippet.

import type { Catalog } from '$lib/i18n/de';
import { app } from '$lib/state/app.svelte';

export type StepId = 'mailbox' | 'profile' | 'fetch';

export interface StepSpec {
  id: StepId;
  name: (t: Catalog) => string;
  /** Ticked. The last step never is: a completed first fetch ends the page. */
  done: () => boolean;
}

export const STEPS: readonly StepSpec[] = [
  { id: 'mailbox', name: (t) => t.firstRun.mailbox, done: () => app.hasMailbox },
  // Only a profile the engine can use counts; a broken or empty one keeps the step open.
  { id: 'profile', name: (t) => t.firstRun.profile, done: () => app.hasProfile },
  { id: 'fetch', name: (t) => t.firstRun.fetch, done: () => false },
];
