// The setup as data: its seven steps in their order (the round 10 draft), each with what
// stands at the top of its card (the app's mark, a tile with the step's glyph, the reading
// spinner or the full ring of Fertig), its heading and lead, where Zurück leads and the
// words of its one primary button. The profile is a whole page instead of a card.
// FirstRunView.svelte renders this table (each step's body is its snippet of the same id),
// onboarding.svelte.ts walks it. Adding, moving or removing a step is one entry here and its
// snippet.

import type { IconName } from '$components/Icon.svelte';
import type { Catalog } from '$lib/i18n/de';
import type { Portal } from '$lib/ipc/types';

export type StepId = 'welcome' | 'way' | 'upload' | 'reading' | 'profile' | 'alerts' | 'done';
/** How the profile comes: from the CV (the recommended way) or typed in. */
export type Way = 'cv' | 'self';

/** What a step asks of the walk: the way chosen, whether a mailbox is connected and the
 *  portals of alert mails (in the app's order). */
export interface Walk {
  way: Way;
  mailbox: boolean;
  alerts: readonly Portal[];
}

/** What stands at the top of a step's card: the app's mark, a tile with a glyph, the
 *  spinner while the CV is read, or the full ring with its check. */
export type StepTop =
  { kind: 'mark' } | { kind: 'tile'; icon: IconName } | { kind: 'spinner' } | { kind: 'success' };

export interface StepSpec {
  id: StepId;
  /** The top of its card (none: the step is a whole page). */
  top?: StepTop;
  heading: (t: Catalog, walk: Walk) => string;
  lead: (t: Catalog, walk: Walk) => string;
  /** Where Zurück leads (null: no Zurück; the evaluation is never a step to go back to). */
  back: (walk: Walk) => StepId | null;
  /** The words of its primary button (null: the step's own control goes on). */
  next: ((t: Catalog) => string) | null;
  /** The primary goes on with an arrow (Loslegen, Weiter, Zu den Jobs). */
  onward?: boolean;
}

export const STEPS: readonly StepSpec[] = [
  {
    id: 'welcome',
    top: { kind: 'mark' },
    heading: (t) => t.firstRun.welcome,
    lead: (t) => t.firstRun.welcomeText,
    back: () => null,
    next: (t) => t.firstRun.start,
    onward: true,
  },
  {
    // A click on a way tile goes on.
    id: 'way',
    top: { kind: 'tile', icon: 'profile' },
    heading: (t) => t.firstRun.way,
    lead: (t) => t.firstRun.wayText,
    back: () => 'welcome',
    next: null,
  },
  {
    // The drop zone goes on; a failed evaluation comes back here and says why.
    id: 'upload',
    top: { kind: 'tile', icon: 'pickFile' },
    heading: (t) => t.firstRun.upload,
    lead: (t) => t.firstRun.uploadText,
    back: () => 'way',
    next: null,
  },
  {
    // "Abbrechen" (and the mouse's back button) stop it and go back to the upload.
    id: 'reading',
    top: { kind: 'spinner' },
    heading: (t) => t.firstRun.reading,
    lead: (t) => t.firstRun.readingText,
    back: () => null,
    next: null,
  },
  {
    // The whole profile as a page: as the CV filled it, or empty to fill in.
    id: 'profile',
    heading: (t) => t.firstRun.profile,
    lead: (t, walk) => (walk.way === 'cv' ? t.firstRun.profileCv : t.firstRun.profileSelf),
    back: (walk) => (walk.way === 'cv' ? 'upload' : 'way'),
    next: (t) => t.firstRun.next,
    onward: true,
  },
  {
    // Optional: "Überspringen" or "Verbinden" go on to Fertig.
    id: 'alerts',
    top: { kind: 'tile', icon: 'alertMail' },
    heading: (t) => t.firstRun.mailbox,
    lead: (t, walk) => t.firstRun.mailboxText(walk.alerts),
    back: () => 'profile',
    next: (t) => t.firstRun.connect,
  },
  {
    // Says what was set up: everything with a mailbox, else the profile.
    id: 'done',
    top: { kind: 'success' },
    heading: (t, walk) => (walk.mailbox ? t.firstRun.done : t.firstRun.doneProfile),
    lead: (t) => t.firstRun.doneText,
    back: () => null,
    next: (t) => t.firstRun.toJobs,
    onward: true,
  },
];

export const stepOf = (id: StepId): StepSpec => STEPS.find((step) => step.id === id) ?? STEPS[0]!;
export const isStep = (value: string | null): value is StepId =>
  STEPS.some((step) => step.id === value);
