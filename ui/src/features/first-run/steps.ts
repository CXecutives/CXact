// The setup as data: its steps in their order, each with its heading, its one sentence, where
// Zurück leads and the words of its one primary button; and the failures of the CV with their
// sentence and their ways on. FirstRunView.svelte renders this table (each step's body is its
// snippet of the same id), onboarding.svelte.ts walks it. Adding, moving or removing a step
// is one entry here and its snippet; a new failure is one row of CV_PROBLEMS.

import type { Catalog } from '$lib/i18n/de';
import type { CvFailure } from '$lib/ipc/api';

export type StepId = 'welcome' | 'way' | 'upload' | 'reading' | 'review' | 'alerts' | 'done';
/** How the profile comes: from the CV (the recommended way) or typed in. */
export type Way = 'cv' | 'self';

/** What a step asks of the walk: the way chosen, and whether a mailbox is connected. */
export interface Walk {
  way: Way;
  mailbox: boolean;
}

export interface StepSpec {
  id: StepId;
  heading: (t: Catalog) => string;
  /** One sentence under the heading, or none. */
  text?: (t: Catalog) => string;
  /** Where Zurück leads (null: no Zurück; the evaluation is never a step to go back to). */
  back: (walk: Walk) => StepId | null;
  /** The words of its primary button (null: the step's own control goes on). */
  next: ((t: Catalog, walk: Walk) => string) | null;
  /** The profile's form needs the Profil view's column; the others keep a form's measure. */
  wide?: true;
}

export const STEPS: readonly StepSpec[] = [
  {
    id: 'welcome',
    heading: (t) => t.firstRun.welcome,
    text: (t) => t.firstRun.welcomeText,
    back: () => null,
    next: (t) => t.firstRun.begin,
  },
  {
    id: 'way',
    heading: (t) => t.firstRun.way,
    back: () => 'welcome',
    next: (t) => t.firstRun.next,
  },
  {
    id: 'upload',
    heading: (t) => t.firstRun.upload,
    back: () => 'way',
    next: null,
  },
  {
    id: 'reading',
    heading: (t) => t.firstRun.reading,
    back: () => null,
    next: null,
  },
  {
    id: 'review',
    heading: (t) => t.firstRun.review,
    text: (t) => t.firstRun.reviewText,
    back: (walk) => (walk.way === 'cv' ? 'upload' : 'way'),
    next: (t) => t.firstRun.next,
    wide: true,
  },
  {
    id: 'alerts',
    heading: (t) => t.firstRun.alerts,
    back: () => 'review',
    // Without a mailbox the form's "Verbinden" is the step's primary, "Überspringen" beside.
    next: (t, walk) => (walk.mailbox ? t.firstRun.next : t.firstRun.skip),
  },
  {
    id: 'done',
    heading: (t) => t.firstRun.done,
    text: (t) => t.firstRun.doneText,
    back: () => 'alerts',
    next: (t) => t.firstRun.toJobs,
  },
];

export const stepOf = (id: StepId): StepSpec => STEPS.find((step) => step.id === id) ?? STEPS[0]!;
export const isStep = (value: string | null): value is StepId =>
  STEPS.some((step) => step.id === value);

/** A way on after a failed evaluation: try again, another file, or fill it in by hand. */
export type CvWay = 'retry' | 'otherFile' | 'self';

/** The failures of the evaluation, one sentence each (the catalog's) and the ways on, the
 *  first one the primary (docs/PLAN.md, Block 4). */
export const CV_PROBLEMS: Readonly<Record<CvFailure, readonly CvWay[]>> = {
  limit: ['self'],
  offline: ['retry', 'self'],
  timeout: ['retry', 'self'],
  unreadable: ['otherFile', 'self'],
  tooLarge: ['otherFile', 'self'],
  unsupported: ['otherFile', 'self'],
  refused: ['otherFile', 'self'],
  unavailable: ['retry', 'self'],
  paused: ['self'],
  outdated: ['self'],
};
