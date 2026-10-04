// What the shell shows: the setup (a mode of its own, without the sidebar and the buttons of
// the top bar) until it was finished once (`AppState.firstRun`, core's `onboarded`; after
// "Zurücksetzen" it comes again), else the views.
// And the frame around the views, like the Claude app's: the sidebar docked or folded away
// by its button (a narrow window folds it by itself; its button then floats it over the
// view), and the job view beside the list shown or hidden. Both choices are kept per user
// (in this web view: a store that cannot be read or written keeps them for the session).

import { app } from './app.svelte';
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
  /** The sidebar of a narrow window floats over the view. */
  peek = $state(false);
  /** The sidebar's width in px (its handle keeps the user's). */
  sidebarWidth = $state<number | undefined>(undefined);
  /** The user wants the job view beside the list (one column shows a job in its place). */
  #reader = $state(kept(READER));
  /** Where the list's border stands from the left of the view, in px, while the job view
   *  stands beside it (the top bar continues it); null without one. Set by JobsView. */
  listSeam = $state<number | null>(null);

  /** The sidebar stands beside the view (never in the setup). */
  get docked(): boolean {
    return this.#sidebar && !viewport.fold && !this.firstRun;
  }

  /** Its button, a plain switch: docks or folds it; in a narrow window it floats it out and
   *  folds it again. */
  toggleSidebar(): void {
    if (viewport.fold) {
      this.peek = !this.peek;
      return;
    }
    this.#sidebar = !this.#sidebar;
    this.fold();
    keep(SIDEBAR, this.#sidebar);
  }

  /** The floating sidebar folds away. */
  fold(): void {
    this.peek = false;
  }

  get readerOpen(): boolean {
    return this.#reader;
  }

  setReader(open: boolean): void {
    if (open === this.#reader) return;
    this.#reader = open;
    keep(READER, open);
  }

  /** The setup stands in place of the views ("Zu den Jobs" ends it). */
  get firstRun(): boolean {
    return app.state?.firstRun ?? false;
  }
}

export const shell = new Shell();
