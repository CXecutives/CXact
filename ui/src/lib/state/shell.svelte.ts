// What the shell shows: the first-run page while nothing was ever fetched (and no run goes)
// instead of the Jobs view. A mailbox removed later does not bring it back: the jobs stay
// in view, "Postfach abrufen" waits for a mailbox and the list says how to connect one.
// And the frame around the views, like the Claude app's: the sidebar docked or folded away
// (then it floats over the view while the pointer is on its button, on the window's left
// edge or on it), and the job view beside the list shown or hidden. Both choices are kept
// per user (in this web view: a store that cannot be read or written keeps them for the
// session).

import { app } from './app.svelte';
import { run } from './run.svelte';
import { viewport } from './viewport.svelte';

const SIDEBAR = 'sidebar-open';
const READER = 'reader-open';

function kept(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function keep(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    // Without a store the choice lasts for this session.
    return;
  }
}

class Shell {
  /** The Jobs view shows one job in place of its list (one column), and with it the run line
   *  under the list header: a run's end offers its way there ("Zeigen"). Set by JobsView. */
  listHidden = $state(false);

  /** The user wants the sidebar beside the view (a narrow window folds it anyway). */
  #sidebar = $state(kept(SIDEBAR));
  /** The folded sidebar floats over the view. */
  peek = $state(false);
  /** The sidebar's width in px (its handle keeps the user's). */
  sidebarWidth = $state<number | undefined>(undefined);
  /** The user wants the job view beside the list (one column shows a job in its place). */
  #reader = $state(kept(READER));
  /** Where the list's border stands from the left of the view, in px, while the job view
   *  stands beside it (the top bar continues it); null without one. Set by JobsView. */
  listSeam = $state<number | null>(null);

  /** The sidebar stands beside the view. */
  get docked(): boolean {
    return this.#sidebar && !viewport.fold;
  }

  /** Its button: docks or folds it; in a narrow window it floats it out (the pointer that
   *  leaves it folds it again). */
  toggleSidebar(): void {
    if (viewport.fold) {
      this.peek = true;
      return;
    }
    this.#sidebar = !this.#sidebar;
    this.peek = false;
    keep(SIDEBAR, this.#sidebar);
  }

  get readerOpen(): boolean {
    return this.#reader;
  }

  setReader(open: boolean): void {
    if (open === this.#reader) return;
    this.#reader = open;
    keep(READER, open);
  }

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
