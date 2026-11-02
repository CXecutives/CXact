// What the shell shows: the setup (a mode of its own, without the sidebar and the buttons of
// the top bar, like a start that failed: `bare`) until it was finished once (`AppState.firstRun`,
// core's `onboarded`; after "Zurücksetzen" it comes again), else the views.
// And the frame around the views, like the Claude app's: the sidebar docked or folded away
// by its button (a narrow window folds it by itself; its button then floats it over the
// view), the job view beside the list shown or hidden, and the places under Jobs in the sidebar
// open or folded. These choices are kept per user (in this web view: a store that cannot be read
// or written keeps them for the session).
// The ground of the view below the top bar is decided here too: the bar wears it. So is what
// stands under the view, out of what scrolls (`foot`: the setup's bar).

import type { Snippet } from 'svelte';
import { app } from './app.svelte';
import { navigation } from './navigation.svelte';
import { viewport } from './viewport.svelte';

const SIDEBAR = 'sidebar-open';
const READER = 'reader-open';
const PLACES = 'places-open';

/** The colour a view stands on: the setup's cream, the warm page or the list's white. */
export type Ground = 'side' | 'page' | 'list';

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
  /** The user wants the places under Jobs in the sidebar. */
  #places = $state(kept(PLACES));
  /** A bar under the view, across the sheet and out of what scrolls (set by the page it belongs
   *  to, while it stands). */
  foot = $state<Snippet | null>(null);
  /** Where the list's border stands from the left of the view, in px, while the job view
   *  stands beside it (the top bar continues it); null without one. Set by JobsView. */
  listSeam = $state<number | null>(null);

  /** The views stand without the frame around them, no sidebar and no buttons in the top bar: the
   *  setup, and a start that failed, where they would lead to nothing. */
  get bare(): boolean {
    return this.firstRun || (app.error !== null && app.state === null);
  }

  /** The sidebar stands beside the view (never without the frame). */
  get docked(): boolean {
    return this.#sidebar && !viewport.fold && !this.bare;
  }

  /** Its button, a plain switch: docks or folds it; in a narrow window it floats it out and
   *  folds it again. */
  toggleSidebar(): void {
    if (viewport.fold) {
      this.peek = !this.peek;
      return;
    }
    this.#sidebar = !this.#sidebar;
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

  get placesOpen(): boolean {
    return this.#places;
  }

  /** The chevron at Jobs, a plain switch. */
  togglePlaces(): void {
    this.#places = !this.#places;
    keep(PLACES, this.#places);
  }

  /** The setup stands in place of the views ("Zu den Jobs" ends it). */
  get firstRun(): boolean {
    return app.state?.firstRun ?? false;
  }

  /** The ground of the view, which the top bar continues above it: the setup's cream
   *  (`side`); the warm page (`page`) of Profil, Einstellungen, a start that loads or failed,
   *  and of a job standing in place of the list (one column); else the list's white (`list`),
   *  with the job view's page right of `listSeam` while it stands beside the list. */
  get ground(): Ground {
    if (this.firstRun) return 'side';
    if (app.state === null || navigation.current !== 'jobs' || this.listHidden) return 'page';
    return 'list';
  }

  /** The ground at the view's right edge: the job view's page while it stands beside the
   *  list. */
  get groundEnd(): Ground {
    return this.ground === 'list' && this.listSeam !== null ? 'page' : this.ground;
  }
}

export const shell = new Shell();
