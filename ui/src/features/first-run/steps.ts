// The first-run steps as data: their order, their names and when each is done (ticked).
// FirstRunView.svelte numbers and renders them in this order, the first open one that is not
// optional is the current step (its main action is the one primary); each step's body is the
// view's snippet of the same id. The profile comes first, since the search needs it; the
// mailbox is optional, only the alert mails need it (user, 2026-10-01). Adding, moving or
// removing a step is one entry here and its snippet.

import type { Catalog } from '$lib/i18n/de';
import { app } from '$lib/state/app.svelte';

export type StepId = 'mailbox' | 'profile' | 'fetch';

export interface StepSpec {
  id: StepId;
  name: (t: Catalog) => string;
  /** Ticked. The last step never is: a completed first fetch ends the page. */
  done: () => boolean;
  /** Never the current step: its action stays secondary, the next step goes on. */
  optional?: true;
}

export const STEPS: readonly StepSpec[] = [
  // Only a profile the engine can use counts; a broken or empty one keeps the step open.
  { id: 'profile', name: (t) => t.firstRun.profile, done: () => app.hasProfile },
  { id: 'mailbox', name: (t) => t.firstRun.mailbox, done: () => app.hasMailbox, optional: true },
  { id: 'fetch', name: (t) => t.firstRun.fetch, done: () => false },
];
