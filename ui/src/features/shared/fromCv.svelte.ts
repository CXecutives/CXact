// "Aus Lebenslauf ausfüllen", the same wherever it is offered (the start page of the profile,
// the head of the Profil): the backend asks for the CV, has it evaluated and saves the one
// profile at once (`fillFromCv`). While it runs the button turns; what went wrong is said in
// one sentence with its way on (another try, another file), and the toast says when the
// profile was filled. While the tries are used up (`AppState.cvUntil`) it is not offered: its
// buttons say why ahead of the click (`limited`), and a dropped CV is not taken.

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { CvError, fillFromCv, type CvFailure, type NextAppState } from '$lib/ipc/api';
import type { ProfileInfo } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toasts.svelte';

/** The failures whose way on is another try, and those whose way is another file. */
const AGAIN: readonly CvFailure[] = ['offline', 'timeout', 'unavailable'];
const OTHER_FILE: readonly CvFailure[] = ['unreadable', 'tooLarge', 'unsupported', 'refused'];

export interface CvProblem {
  text: () => string;
  /** The way on beside it ("Erneut versuchen", "Andere Datei wählen"), or none. */
  again: (() => string) | null;
}

class FromCv {
  busy = $state(false);
  problem = $state.raw<CvProblem | null>(null);

  /** The tries are used up for today: the import waits for `cvUntil`. */
  get limited(): boolean {
    return Boolean((app.state as NextAppState | null)?.cvUntil);
  }

  /** The profile filled from a CV (the files dropped on the window, else the file dialog)
   *  and stored, or null (closed dialog, a failure said). */
  async run(dropped = false): Promise<ProfileInfo | null> {
    if (this.busy) return null;
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
