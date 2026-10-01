// Zurück and Vor of the top bar, like a browser's: through the views, the places of the jobs
// and the jobs opened and the Profil's tabs, in the order they were shown. A step back shows the one before as it
// was (its view, its place, its job); a new step after a way back drops the ones ahead.
// Showing or hiding the job view is no step. The mouse's back button goes back too (App).
// In one column a job without a step before it goes back to the list.

import { tick, untrack } from 'svelte';
import type { JobKey, Origin, Place } from '../ipc/types';
import { jobs, sameKey } from './jobs.svelte';
import { navigation, type ViewId } from './navigation.svelte';
import { profileTab, type ProfileTab } from './profile.svelte';
import { shell } from './shell.svelte';

interface Step {
  view: ViewId;
  place: Place;
  area: Origin | null;
  job: JobKey | null;
  tab: ProfileTab;
}

/** The steps kept, the oldest dropped first. */
const KEPT = 100;

function same(a: Step, b: Step): boolean {
  return (
    a.view === b.view &&
    a.place === b.place &&
    a.area === b.area &&
    sameKey(a.job, b.job) &&
    a.tab === b.tab
  );
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
          area: jobs.area,
          job: jobs.selected,
          tab: profileTab.value,
        };
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
    return this.#show(this.#at - 1);
  }

  forward(): boolean {
    return this.#show(this.#at + 1);
  }

  /** Shows step `to` (an unsaved Profil may keep its view and ask first). */
  #show(to: number): boolean {
    const step = this.#steps[to];
    if (step === undefined) return false;
    const apply = (): void => {
      this.#showing = true;
      this.#at = to;
      if (step.place !== jobs.place) jobs.setPlace(step.place);
      if (step.area !== jobs.area) jobs.setArea(step.area);
      profileTab.value = step.tab;
      if (step.job === null) jobs.clearSelection();
      else if (!sameKey(jobs.selected, step.job)) jobs.openKey(step.job);
      void tick().then(() => (this.#showing = false));
    };
    if (step.view === navigation.current) {
      apply();
      return true;
    }
    this.#showing = true;
    if (!navigation.go(step.view, false, apply)) this.#showing = false;
    return true;
  }
}

export const history = new History();
