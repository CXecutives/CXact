// Which of the three views is shown. No router: the app has exactly these. It starts in Jobs;
// before the first fetch Jobs shows the setup page. The native menu may ask for a view too (macOS: Cmd+, opens the settings). A view with unsaved
// work (the Profil editor) holds a guard: it may keep the switch and ask first, then switch
// itself; what was to happen with the switch waits for it. The places of the jobs (Aktuell,
// Archiv, Papierkorb) are tabs of the Jobs view, not views (lib/state/jobs.svelte.ts).

import { onNavigate } from '../ipc/api';
import type { Portal } from '../ipc/types';
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
   * The portal whose card Einstellungen should show (scrolled into view) when it opens: set
   * together with `go('settings')` by a way that leads there for one portal (the reader's
   * "Anmeldung einrichten"), so the view never opens at its top without context. The
   * settings view reads it once it is shown and sets it back to null.
   */
  focusPortal = $state<Portal | null>(null);
  #installed = false;
  #guard: LeaveGuard | null = null;
  /** What waits for a switch the guard kept (it runs once that switch happens). */
  #pending: { view: ViewId; then: () => void } | null = null;

  /**
   * Switch views; the guard of the current view may keep it (unless `force`). `then` runs
   * once the switch has happened (at once, or after the guard's question); the view that is
   * already current switches at once. Returns whether it happened now.
   */
  go(view: ViewId, force = false, then?: () => void): boolean {
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

  /** The current view's guard; returns the function that removes it again. */
  guard(guard: LeaveGuard): () => void {
    this.#guard = guard;
    return () => {
      if (this.#guard === guard) this.#guard = null;
    };
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
