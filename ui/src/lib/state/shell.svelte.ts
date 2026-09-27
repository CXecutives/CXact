// What the shell shows: the first-run page while nothing was ever fetched (and no run goes)
// instead of the Jobs view. A mailbox removed later does not bring it back: the jobs stay
// in view, "Postfach abrufen" waits for a mailbox and the list says how to connect one.

import { app } from './app.svelte';
import { run } from './run.svelte';

class Shell {
  /** The Jobs view shows one job in place of its list (one column), and with it the run line
   *  under the list header: a run's end offers its way there ("Zeigen"). Set by JobsView. */
  listHidden = $state(false);

  /** Until `start_run` answers the first-run page stays (a failed start never flashes);
   *  while the first fetch goes the Jobs view shows it, and only a completed one ends the
   *  setup (a failed or cancelled first fetch brings the page back, its step 3 says why). */
  get firstRun(): boolean {
    const state = app.state;
    const going = run.active && !run.starting;
    const completed = run.summary?.outcome.kind === 'completed';
    return state !== null && state.firstRun && !going && !completed;
  }
}

export const shell = new Shell();
