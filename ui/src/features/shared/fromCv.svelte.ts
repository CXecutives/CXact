// "Aus Lebenslauf ausfüllen", the same wherever it is offered (the start page of the profile,
// the head of the Profil): the backend asks for the CV, has it evaluated and saves the one
// profile at once (`fillFromCv`). While it runs the button turns and "Abbrechen" stops it (the
// import then answers with nothing); what went wrong is said in one sentence, with the choice of
// a file beside it where a new try can work, and the toast says when the profile was filled.
// While the tries are used up (`AppState.cvUntil`) it is not offered: its button says why ahead
// of the click (`limited`), a tile says it on the click, and a dropped CV is not taken. The
// setup's upload says the same sentences (onboarding).

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { CvError, fillFromCv, invoke, type CvFailure } from '$lib/ipc/api';
import type { ProfileInfo } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toasts.svelte';

/** The failures no new try mends: the evaluation waits (the tries used up, paused) or needs
 *  a newer app. */
const FINAL: readonly CvFailure[] = ['limit', 'paused', 'outdated'];

/** Whether a new try (the file dialog again, or another file) can work after this failure. */
export const retryable = (reason: CvFailure): boolean => !FINAL.includes(reason);

export interface CvProblem {
  text: () => string;
  /** "Datei auswählen" stands beside it. */
  pick: boolean;
  /** An evaluation was tried and failed (else the sentence says why none can start). */
  tried: boolean;
}

class FromCv {
  busy = $state(false);
  problem = $state.raw<CvProblem | null>(null);

  /** The tries are used up for today: the import waits for `cvUntil`. */
  get limited(): boolean {
    return Boolean(app.state?.cvUntil);
  }

  /** The profile filled from a CV (the files dropped on the window, else the file dialog)
   *  and stored, or null (closed dialog, a failure said). */
  async run(dropped = false): Promise<ProfileInfo | null> {
    if (this.busy) return null;
    // No evaluation left today: said at once, nothing asked (the tiles of the start page
    // have no way to wait).
    if (this.limited) {
      this.problem = { ...problemOf(new CvError('limit')), tried: false };
      return null;
    }
    this.busy = true;
    this.problem = null;
    try {
      const info = await fillFromCv(dropped);
      if (info === null) return null;
      if ((await app.load()) === null && app.state) app.state.profile = info;
      toasts.show(t.profile.filled, 'success');
      return info;
    } catch (error) {
      this.problem = problemOf(error);
      // The state names the day it works again: the buttons say it from now on.
      if (error instanceof CvError && error.reason === 'limit') void app.load();
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** "Abbrechen" while it evaluates: the backend stops it and `run` ends with nothing. */
  cancel(): void {
    invoke('cancel_run').catch((error: unknown) => (this.problem = problemOf(error)));
  }

  clear(): void {
    this.problem = null;
  }
}

function problemOf(error: unknown): CvProblem {
  if (!(error instanceof CvError)) {
    return { text: () => errorText(error), pick: false, tried: true };
  }
  const reason = error.reason;
  return { text: () => t.profile.cvError[reason], pick: retryable(reason), tried: true };
}

export const fromCv = new FromCv();
