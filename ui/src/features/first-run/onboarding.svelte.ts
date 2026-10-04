// The walk through the setup (steps.ts): the step shown, the way to the profile, the CV's
// evaluation and its failure. The first step follows from what is stored: no usable profile
// leads to Willkommen, a usable one to Alert-Mails, a connected mailbox to Fertig (the preview
// and the harness may name a step in the address, `?step=upload`). Once a profile exists the
// steps edit exactly that one (the backend merges a second CV into it). Zurück never lands on
// the evaluation and keeps what was typed; reaching Fertig saves that the setup is done
// (`finish_onboarding`), so the next start opens the Jobs view.

import { errorText } from '$lib/i18n/texts';
import { CvError, fillFromCv, invoke, reportUiError, type CvFailure } from '$lib/ipc/api';
import { app } from '$lib/state/app.svelte';
import { navigation } from '$lib/state/navigation.svelte';
import { isStep, stepOf, type StepId, type Walk, type Way } from './steps';

class Onboarding {
  step = $state<StepId>('welcome');
  way = $state<Way>('cv');
  /** Why the last evaluation failed (the step Auswertung says it with its ways on). */
  failure = $state<CvFailure | null>(null);
  /** A failure that is no CV code, in words. */
  error = $state<string | null>(null);
  /** Counts the evaluations begun: the answer of one that was cancelled is dropped. */
  #attempt = 0;
  #begun = false;
  #finished = false;

  get walk(): Walk {
    return { way: this.way, mailbox: app.hasMailbox };
  }

  /** The first step, once per setup: from what is stored, or the one the address names. */
  begin(): void {
    if (this.#begun) return;
    this.#begun = true;
    const asked = new URLSearchParams(location.search).get('step');
    if (isStep(asked)) {
      if (asked === 'self') this.way = 'self';
      if (asked === 'reading') void this.read(false);
      else this.go(asked);
      return;
    }
    this.go(!app.hasProfile ? 'welcome' : !app.hasMailbox ? 'alerts' : 'done');
  }

  go(step: StepId): void {
    this.step = step;
    if (step === 'done') this.finish();
  }

  /** Zurück (and the mouse's back button): the step before, `true` if there is one. An
   *  evaluation that goes is cancelled first. */
  back(): boolean {
    if (this.step === 'reading') {
      this.cancelReading();
      return true;
    }
    const to = stepOf(this.step).back(this.walk);
    if (to === null) return false;
    this.go(to);
    return true;
  }

  /** The CV (the files dropped on the window, else the file dialog) evaluated: the profile
   *  it filled is stored and reviewed next; a closed dialog goes back to the upload. */
  async read(dropped: boolean): Promise<void> {
    const mine = ++this.#attempt;
    this.failure = null;
    this.error = null;
    this.way = 'cv';
    this.step = 'reading';
    try {
      const info = await fillFromCv(dropped);
      if (mine !== this.#attempt) return;
      if (info === null) {
        this.step = 'upload';
        return;
      }
      if ((await app.load()) === null && app.state) app.state.profile = info;
      if (mine === this.#attempt) this.step = 'review';
    } catch (failure) {
      if (mine !== this.#attempt) return;
      if (failure instanceof CvError) {
        this.failure = failure.reason;
        // The state names the day it works again.
        if (failure.reason === 'limit') void app.load();
      } else this.error = errorText(failure);
    }
  }

  /** "Abbrechen" while it evaluates: back to the upload (a late answer is dropped). */
  cancelReading(): void {
    this.#attempt += 1;
    this.failure = null;
    this.error = null;
    this.step = 'upload';
  }

  /** "Erneut versuchen": the backend took the dropped files, so the file dialog asks again. */
  retry(): void {
    void this.read(false);
  }

  /** "Selbst ausfüllen" (its tile, or after a failure): the short form, empty or as stored. */
  byHand(): void {
    this.#attempt += 1;
    this.way = 'self';
    this.failure = null;
    this.error = null;
    this.go('self');
  }

  /** "Aus Lebenslauf": the upload. */
  byCv(): void {
    this.way = 'cv';
    this.go('upload');
  }

  /** "Zu den Jobs": the shell leaves the setup for the Jobs view. */
  leave(): void {
    if (app.state) app.state.firstRun = false;
    navigation.go('jobs', true);
  }

  /** Fertig is reached: the next start opens the Jobs view. */
  private finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    invoke('finish_onboarding', {}).catch((failure: unknown) => {
      this.#finished = false;
      reportUiError(`finish_onboarding: ${String(failure)}`, null, null);
    });
  }
}

export const onboarding = new Onboarding();
