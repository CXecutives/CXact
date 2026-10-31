// Zurück and Vor of the top bar, like a browser's: through the views, the places of the jobs
// and the jobs opened, in the order they were shown. A step back shows the one before as it
// was (its view, its place, its job); a new step after a way back drops the ones ahead.
// Showing or hiding the job view is no step. The mouse's back and forward buttons go the same
// way (App). In one column a job without a step before it goes back to the list.
// A job lies where it lies now: a step whose job was archived or put in the Papierkorb since
// shows it there, and one whose job was deleted for good is dropped (the next step in that
// direction shows, past one that only shows what stands on screen). The first step is what the
// start ended in (the job kept from the last run open again): the start's way there is no step.

import { tick, untrack } from 'svelte';
import type { JobKey, Place } from '../ipc/types';
import { sameKey } from './jobRows';
import { jobs } from './jobs.svelte';
import { navigation, type ViewId } from './navigation.svelte';
import { shell } from './shell.svelte';

interface Step {
  view: ViewId;
  place: Place;
  job: JobKey | null;
}

/** The steps kept, the oldest dropped first. */
const KEPT = 100;

function same(a: Step, b: Step): boolean {
  return a.view === b.view && a.place === b.place && sameKey(a.job, b.job);
}

class History {
  #steps = $state<Step[]>([]);
  #at = $state(-1);
  /** A step being shown: what it changes is no new step. */
  #showing = false;

  get canBack(): boolean {
    return this.#at > 0 || (shell.listHidden && jobs.selected !== null);
  }

  get canForward(): boolean {
    return this.#at < this.#steps.length - 1;
  }

  /** Follows what is shown from now on. */
  install(): void {
    $effect.root(() => {
      $effect(() => {
        const step: Step = {
          view: navigation.current,
          place: jobs.place,
          job: jobs.selected,
        };
        // The Jobs view starts its list, and opens the job kept from the last run, before it
        // is looked at: the states on the way there were never shown.
        if (step.view === 'jobs' && !jobs.started) return;
        untrack(() => this.#record(step));
      });
    });
  }

  #record(step: Step): void {
    if (this.#showing) return;
    const now = this.#steps[this.#at];
    if (now !== undefined && same(now, step)) return;
    const steps = [...this.#steps.slice(0, this.#at + 1), step].slice(-KEPT);
    this.#steps = steps;
    this.#at = steps.length - 1;
  }

  back(): boolean {
    if (this.#at <= 0 && shell.listHidden && jobs.selected !== null) {
      jobs.clearSelection();
      return true;
    }
    return this.#show(this.#at - 1, -1);
  }

  forward(): boolean {
    return this.#show(this.#at + 1, 1);
  }

  /** What is shown is settled: the next change is a step again. */
  #settle(): void {
    void tick().then(() => (this.#showing = false));
  }

  /**
   * Shows step `to` (an unsaved Profil may keep its view and ask first), reached by going `by`
   * steps back or forward. The job of the step is opened where it lies now, which the step
   * then names. One that is gone is dropped (`#drop`).
   */
  #show(to: number, by: -1 | 1, from = this.#steps[this.#at]): boolean {
    const step = this.#steps[to];
    if (step === undefined) return false;
    const apply = (): void => {
      this.#showing = true;
      this.#at = to;
      if (step.place !== jobs.place) jobs.setPlace(step.place);
      if (step.job === null) {
        jobs.clearSelection();
        this.#settle();
      } else if (sameKey(jobs.selected, step.job)) {
        this.#settle();
      } else {
        void jobs.openKey(step.job).then((found) => {
          if (found) {
            this.#steps[to] = { ...step, place: jobs.place };
            this.#settle();
            return;
          }
          this.#drop(to, by, from);
        });
      }
    };
    if (step.view === navigation.current) {
      apply();
      return true;
    }
    this.#showing = true;
    if (!navigation.go(step.view, false, apply)) this.#showing = false;
    return true;
  }

  /**
   * Step `to` shows a job that is gone: the next step in that direction shows instead, the step
   * shown before when none is left. A step beside it that shows what stands on screen (the job
   * on both sides of the one deleted) is no step any more and goes with it.
   */
  #drop(to: number, by: -1 | 1, from: Step | undefined): void {
    const steps = this.#steps.filter((_, index) => index !== to);
    let next = by < 0 ? to - 1 : to;
    const beside = steps[next];
    if (beside !== undefined && from !== undefined && same(beside, from)) {
      steps.splice(next, 1);
      if (by < 0) next -= 1;
    }
    this.#steps = steps;
    if (steps[next] !== undefined) this.#show(next, by, from);
    else this.#back(from);
  }

  /** No step is left that shows: the step shown before shows again. */
  #back(from: Step | undefined): void {
    const at = from === undefined ? -1 : this.#steps.findIndex((step) => step === from);
    if (at < 0) {
      this.#settle();
      return;
    }
    this.#show(at, 1);
  }
}

export const history = new History();
