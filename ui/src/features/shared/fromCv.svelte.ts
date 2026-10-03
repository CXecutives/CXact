// "Aus Lebenslauf ausfüllen", the same wherever it is offered (the start page of the profile,
// the head of the Profil): the backend asks for the CV, has it evaluated and saves the one
// profile at once (`fillFromCv`). While it runs the button turns; what went wrong is said in
// one sentence with its way on (another try, another file), and the toast says when the
// profile was filled.

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { CvError, fillFromCv, type CvFailure } from '$lib/ipc/api';
import type { ProfileInfo } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toasts.svelte';

/** The failures whose way on is another try, and those whose way is another file. */
const AGAIN: readonly CvFailure[] = ['offline', 'timeout'];
const OTHER_FILE: readonly CvFailure[] = ['unreadable', 'tooLarge', 'refused'];

export interface CvProblem {
  text: () => string;
  /** The way on beside it ("Erneut versuchen", "Andere Datei wählen"), or none. */
  again: (() => string) | null;
}

class FromCv {
  busy = $state(false);
  problem = $state.raw<CvProblem | null>(null);

  /** The profile filled from a CV and stored, or null (closed dialog, a failure said). */
  async run(): Promise<ProfileInfo | null> {
    if (this.busy) return null;
    this.busy = true;
    this.problem = null;
    try {
      const info = await fillFromCv();
      if (info === null) return null;
      if ((await app.load()) === null && app.state) app.state.profile = info;
      toasts.show(t.profile.filled, 'success');
      return info;
    } catch (error) {
      this.problem = problemOf(error);
      return null;
    } finally {
      this.busy = false;
    }
  }

  clear(): void {
    this.problem = null;
  }
}

function problemOf(error: unknown): CvProblem {
  if (!(error instanceof CvError)) return { text: () => errorText(error), again: null };
  const reason = error.reason;
  return {
    text: () => t.profile.cvError[reason],
    again: AGAIN.includes(reason)
      ? () => t.common.retry
      : OTHER_FILE.includes(reason)
        ? () => t.profile.otherFile
        : null,
  };
}

export const fromCv = new FromCv();
