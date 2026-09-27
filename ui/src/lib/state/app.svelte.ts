// The app state from the backend (`app_state`): settings, mailbox, profile, portals, last
// run. Loaded once at start and again after anything that changes it (a finished run,
// settings, profile, mailbox). `slow` turns on skeletons only when loading takes longer
// than --dur-fast, so a quick start never flashes placeholders. Every state brings the
// app's language and palette, which the whole page follows at once. The range of "Postfach
// abrufen" (`fetchRange`, the menu of the icon button beside it) is saved from here through
// the settings patch.

import { language } from '../i18n/language.svelte';
import { errorText } from '../i18n/texts';
import { invoke } from '../ipc/api';
import { applyPalette } from '../palette';
import type { AppState, FetchRange, Portal, PortalHealth, SettingsPatch } from '../ipc/types';
import { tokenMs } from '../tokens';

/** The ranges of "Postfach abrufen" in the order of its menu. */
export const FETCH_RANGES: readonly FetchRange[] = ['sinceLast', 'days7', 'days30', 'all'];

/** A whole patch of the settings from what changes (everything else `null`: unchanged). */
const patchOf = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  fetchRange: null,
  exportExcel: null,
  exportCsv: null,
  language: null,
  palette: null,
  ...change,
});

class AppStore {
  state = $state<AppState | null>(null);
  error = $state<unknown>(null);
  loading = $state(false);
  slow = $state(false);

  /** Loads the state; resolves with it (or null after an error). */
  async load(): Promise<AppState | null> {
    this.loading = true;
    this.error = null;
    const timer = setTimeout(() => (this.slow = true), tokenMs('--dur-fast'));
    try {
      const next = await invoke('app_state');
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
    language.set(next.language);
    applyPalette(next.palette);
  }

  /** Only the answer to the latest save may replace the state (quick choices in a row). */
  #saves = 0;

  /**
   * The range of "Postfach abrufen": the page follows at once, the save after. Resolves with
   * the error text of a save that failed (the stored state is loaded again), or null.
   */
  async setFetchRange(range: FetchRange): Promise<string | null> {
    const state = this.state;
    if (state === null || state.fetchRange === range) return null;
    const mine = ++this.#saves;
    state.fetchRange = range;
    try {
      const next = await invoke('save_settings', { patch: patchOf({ fetchRange: range }) });
      if (mine === this.#saves) this.set(next);
      return null;
    } catch (error) {
      void this.load();
      return errorText(error);
    }
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

  /** At least one portal is switched on (a fetch without one is refused by the backend). */
  get hasPortal(): boolean {
    return this.state?.portals.some((p) => p.enabled) ?? false;
  }

  get hasProfile(): boolean {
    const profile = this.state?.profile;
    return Boolean(profile && profile.parseError === null && profile.quality !== 'empty');
  }
}

export const app = new AppStore();
