// The setup as data: its steps in their order, each with its heading, its one sentence, where
// Zurück leads and the words of its one primary button.
// FirstRunView.svelte renders this table (each step's body is its snippet of the same id),
// onboarding.svelte.ts walks it. Adding, moving or removing a step is one entry here and its
// snippet.

import type { Catalog } from '$lib/i18n/de';
import type { Portal } from '$lib/ipc/types';

export type StepId = 'way' | 'upload' | 'reading' | 'review' | 'self' | 'alerts' | 'done';
/** How the profile comes: from the CV (the recommended way) or typed in. */
export type Way = 'cv' | 'self';

/** What a step asks of the walk: the way chosen, whether a mailbox is connected and the
 *  portals of alert mails (in the app's order). */
export interface Walk {
  way: Way;
  mailbox: boolean;
  alerts: readonly Portal[];
}

export interface StepSpec {
  id: StepId;
  heading: (t: Catalog, walk: Walk) => string;
  /** One sentence under the heading, or none. */
  text?: (t: Catalog, walk: Walk) => string;
  /** Where Zurück leads (null: no Zurück; the evaluation is never a step to go back to). */
  back: (walk: Walk) => StepId | null;
  /** The words of its primary button (null: the step's own control goes on). */
  next: ((t: Catalog, walk: Walk) => string) | null;
}

export const STEPS: readonly StepSpec[] = [
  {
    // Willkommen and the two ways in one: a click on a tile goes on.
    id: 'way',
    heading: (t) => t.firstRun.welcome,
    text: (t) => t.firstRun.welcomeText,
    back: () => null,
    next: null,
  },
  {
    // The drop zone goes on; a failed evaluation comes back here and says why.
    id: 'upload',
    heading: (t) => t.firstRun.upload,
    back: () => 'way',
    next: null,
  },
  {
    // "Abbrechen" (and the mouse's back button) go back to the upload.
    id: 'reading',
    heading: (t) => t.firstRun.reading,
    back: () => null,
    next: null,
  },
  {
    // After the CV: the whole profile as the AI filled it, to check.
    id: 'review',
    heading: (t) => t.firstRun.review,
    text: (t) => t.firstRun.reviewText,
    back: () => 'upload',
    next: (t) => t.firstRun.next,
  },
  {
    // By hand: the whole profile, empty.
    id: 'self',
    heading: (t) => t.firstRun.self,
    text: (t) => t.firstRun.later,
    back: () => 'way',
    next: (t) => t.firstRun.next,
  },
  {
    // Without a mailbox "Überspringen" and "Verbinden"; once connected the portals' rows.
    id: 'alerts',
    heading: (t, walk) => (walk.mailbox ? t.firstRun.connected : t.settings.connectHeading),
    text: (t, walk) => (walk.mailbox ? t.firstRun.alertsDone : t.firstRun.alertsText(walk.alerts)),
    back: (walk) => (walk.way === 'cv' ? 'review' : 'self'),
    next: (t, walk) => (walk.mailbox ? t.firstRun.next : t.settings.connect),
  },
  {
    // Says what was set up: everything with a mailbox, else the profile.
    id: 'done',
    heading: (t) => t.firstRun.done,
    back: () => null,
    next: (t) => t.firstRun.toJobs,
  },
];

export const stepOf = (id: StepId): StepSpec => STEPS.find((step) => step.id === id) ?? STEPS[0]!;
export const isStep = (value: string | null): value is StepId =>
  STEPS.some((step) => step.id === value);
