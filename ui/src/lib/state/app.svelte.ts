// The app state from the backend (`app_state`): settings, mailbox, profile, portals, last
// run. Loaded once at start and again after anything that changes it (a finished run,
// settings, profile, mailbox). `slow` turns on skeletons only when loading takes longer
// than --dur-fast, so a quick start never flashes placeholders.

import { invoke } from '../ipc/api';
import type { AppState, Portal, PortalHealth } from '../ipc/types';
import { tokenMs } from '../tokens';

class AppStore {
  state = $state<AppState | null>(null);
  error = $state<unknown>(null);
  loading = $state(false);
  slow = $state(false);

  /** Loads the state; resolves with it (or null after an error). A failure stands until the
   *  answer of the next try: the screen that says so and its pressed button stay meanwhile. */
  async load(): Promise<AppState | null> {
    this.loading = true;
    const timer = setTimeout(() => (this.slow = true), tokenMs('--dur-fast'));
    try {
      const next = await invoke('app_state');
      this.error = null;
      this.set(next);
      return next;
    } catch (error) {
      this.error = error;
      return null;
    } finally {
      clearTimeout(timer);
      this.loading = false;
      this.slow = false;
    }
  }

  /** Replace the state with a newer one a command returned (save_settings). */
  set(next: AppState): void {
    this.state = next;
  }

  /** Portal health from a run event, without a reload. */
  setHealth(portal: Portal, health: PortalHealth): void {
    const state = this.state;
    if (state === null) return;
    const item = state.portals.find((p) => p.portal === portal);
    if (item) item.health = health;
  }

  get hasMailbox(): boolean {
    return Boolean(this.state?.mailbox.user);
  }

  /** A portal the app searches itself is switched on. */
  get searches(): boolean {
    return this.state?.portals.some((p) => p.enabled && p.way === 'search') ?? false;
  }

  /** A portal of alert mails is switched on. */
  get alerts(): boolean {
    return this.state?.portals.some((p) => p.enabled && p.way === 'alert') ?? false;
  }

  /** "Jobs suchen" has something to read: a portal it searches, or alert mails with a
   *  mailbox (core's run_context skips the part that cannot run). */
  get readable(): boolean {
    return this.searches || (this.hasMailbox && this.alerts);
  }

  /** A usable profile: it reads and names everything core needs (`missing_required`). */
  get hasProfile(): boolean {
    const profile = this.state?.profile;
    return Boolean(profile && profile.parseError === null && profile.missing.length === 0);
  }
}

export const app = new AppStore();
