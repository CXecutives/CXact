// Which of the three views is shown. No router: the app has exactly these. It starts in Jobs.
// The native menu may ask for a view too (macOS: Cmd+, opens the settings). While the setup
// stands (App.svelte locks it) every switch is refused: the menu, a toast's action, a link. A
// view with unsaved work (the Profil editor) holds a guard: it may keep the switch and ask
// first, then switch itself or stay; what was to happen with the switch waits for it and goes
// when it stays. The places of the jobs (Aktuell, Archiv, Papierkorb) belong to the Jobs view,
// they are no views (lib/state/jobs.svelte.ts).

import { onNavigate } from '../ipc/api';
import { VIEWS, type ViewId } from '../views';

export type { ViewId };

/** In the sidebar's order (lib/views.ts). */
export const VIEW_IDS: readonly ViewId[] = VIEWS.map((view) => view.id);

const isView = (value: string): value is ViewId => (VIEW_IDS as readonly string[]).includes(value);

/** The first view: Jobs. The preview and the harness may name another in the address
 *  (`?view=settings`); the app itself is loaded without one. */
function firstView(): ViewId {
  const asked = new URLSearchParams(location.search).get('view');
  return asked !== null && isView(asked) ? asked : 'jobs';
}

/** `true` lets the switch to `next` happen; `false` keeps the current view. */
export type LeaveGuard = (next: ViewId) => boolean;

class Navigation {
  current = $state<ViewId>(firstView());
  /**
   * The group of Einstellungen a way into it leads to (`data-section`: "Postfach prüfen" of
   * a failed fetch leads to the Postfach), set once the switch happened; the view brings it
   * into view once it is shown and sets it back to null.
   */
  section = $state<string | null>(null);
  #installed = false;
  #guard: LeaveGuard | null = null;
  /** True while no view may be chosen (the setup). */
  #locked: () => boolean = () => false;
  /** What waits for a switch the guard kept (it runs once that switch happens, and goes when
   *  the view stays). */
  #pending: { view: ViewId; then: () => void } | null = null;

  /**
   * Switch views; the guard of the current view may keep it (unless `force`). `then` runs
   * once the switch has happened (at once, or after the guard's question); the view that is
   * already current switches at once. Returns whether it happened now.
   */
  go(view: ViewId, force = false, then?: () => void): boolean {
    if (!force && this.#locked()) return false;
    if (!force && view !== this.current && this.#guard !== null && !this.#guard(view)) {
      this.#pending = then === undefined ? null : { view, then };
      return false;
    }
    const pending = this.#pending;
    this.#pending = null;
    this.current = view;
    (then ?? (pending?.view === view ? pending.then : undefined))?.();
    return true;
  }

  /** The guard's view stays: what waited for the switch it kept goes, so a later switch to that
   *  view is one of its own. */
  stay(): void {
    this.#pending = null;
  }

  /** The current view's guard; returns the function that removes it again. */
  guard(guard: LeaveGuard): () => void {
    this.#guard = guard;
    return () => {
      if (this.#guard === guard) this.#guard = null;
    };
  }

  /** No view may be chosen while `locked` says so (the setup; only a forced switch passes). */
  lock(locked: () => boolean): void {
    this.#locked = locked;
  }

  /** Follow the native menu (App.svelte, once). */

  install(): void {
    if (this.#installed) return;
    this.#installed = true;
    onNavigate((view) => {
      if (isView(view)) this.go(view);
    });
  }
}

export const navigation = new Navigation();
