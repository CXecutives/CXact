// What a save of the profile changed, said in its toast: the save starts a rescore
// (scoring::profile_changed in the backend), whose summary counts the jobs of Aktuell in
// the high band and the excluded ones before and after it (`ScoreDelta`). Watched from the
// moment of the save, so only the rescore the save started counts (one that was going
// already ends first and is not it); the toast waits for it at most a toast's life, else it
// says only "Profil gespeichert." (as it does when nothing changed, or while a fetch holds
// the rescore back).

import { t } from '$lib/i18n/t';
import { IpcError } from '$lib/ipc/api';
import type { ScoreDelta } from '$lib/ipc/types';
import { run } from '$lib/state/run.svelte';
import { tokenMs } from '$lib/tokens';

export interface SaveEffect {
  /** The toast's words once the rescore of the save is done (or the wait is over). */
  said: () => Promise<string>;
  /** The save failed: nothing to wait for. */
  stop: () => void;
}

export function watchSave(): SaveEffect {
  let started = false;
  /** Undefined until the rescore of the save finished; null when it changed nothing known. */
  let delta: ScoreDelta | null | undefined;
  let wake: (() => void) | null = null;
  const stop = run.listen((event) => {
    if (event.type === 'started' && event.kind === 'rescore') started = true;
    else if (event.type === 'finished' && event.summary.kind === 'rescore' && started) {
      const done = event.summary.outcome.kind === 'completed';
      delta = done ? (event.summary.score?.delta ?? null) : null;
      wake?.();
    }
  });
  return {
    async said() {
      if (delta === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          // A rescore that has not begun after a moment does not come (no jobs, a fetch holds
          // it back); one that began is waited for at most a toast's life.
          setTimeout(
            () => {
              if (!started) resolve();
            },
            2 * tokenMs('--dur-slow'),
          );
          setTimeout(resolve, tokenMs('--dur-toast'));
        });
      }
      stop();
      const change = delta ?? null;
      return change === null
        ? t.profile.saved
        : t.profile.savedEffect(
            change.highAfter - change.highBefore,
            change.excludedAfter - change.excludedBefore,
          );
    },
    stop: () => void stop(),
  };
}

/** A value of the save out of range (`profileValue`): the field (and row) it names, and the
 *  limit where one is; null for any other failure. */
export function refused(
  error: unknown,
): { field: string; row: number | null; max: number | null } | null {
  if (!(error instanceof IpcError) || error.params.reason !== 'profileValue') return null;
  const { field, row, max } = error.params;
  return typeof field === 'string'
    ? {
        field,
        row: typeof row === 'number' ? row : null,
        max: typeof max === 'number' ? max : null,
      }
    : null;
}
