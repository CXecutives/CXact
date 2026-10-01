// The app state from the backend (`app_state`): settings, mailbox, profile, portals, last
// run. Loaded once at start and again after anything that changes it (a finished run,
// settings, profile, mailbox). `slow` turns on skeletons only when loading takes longer
// than --dur-fast, so a quick start never flashes placeholders. Every state brings the
// app's language and palette, which the whole page follows at once. What a fetch reads (the
// menu beside it: the search or the mailbox) is saved from here through the settings patch.

import { language } from '../i18n/language.svelte';
import { errorText } from '../i18n/texts';
import { invoke } from '../ipc/api';
import { applyPalette } from '../palette';
import type { AppState, FetchRange, Portal, PortalHealth, SettingsPatch } from '../ipc/types';
import { tokenMs } from '../tokens';

/** The ranges of the alert mails a fetch reads, in the order of their choice (Einstellungen). */
export const FETCH_RANGES: readonly FetchRange[] = ['sinceLast', 'days7', 'days30', 'all'];

/** What a fetch reads, in the order of its menu: the search or the mailbox, never both
 *  (user decision 2026-10-01; the settings' `fetchSearch` and `fetchMail`). */
export const FETCH_WAYS = ['search', 'mail'] as const;
export type FetchWay = (typeof FETCH_WAYS)[number];

/** A whole patch of the settings from what changes (everything else `null`: unchanged). */
const patchOf = (change: Partial<SettingsPatch>): SettingsPatch => ({
  portals: [],
  fetchRange: null,
  exportExcel: null,
  exportCsv: null,
  fetchMail: null,
  fetchSearch: null,
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

  /** What a fetch reads: the mailbox only while its switch alone is on, else the search
   *  (core's `Settings::fetches_mail`). */
  get fetchWay(): FetchWay {
    const state = this.state;
    return state !== null && state.fetchMail && !state.fetchSearch ? 'mail' : 'search';
  }

  /**
   * Another way of the fetch: the page follows at once, the save after. Resolves with the
   * error text of a save that failed (the stored state is loaded again), or null.
   */
  async setFetchWay(way: FetchWay): Promise<string | null> {
    const state = this.state;
    if (state === null || this.fetchWay === way) return null;
    const mine = ++this.#saves;
    const change = { fetchMail: way === 'mail', fetchSearch: way === 'search' };
    Object.assign(state, change);
    try {
      const next = await invoke('save_settings', { patch: patchOf(change) });
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

  /** A source the app searches itself is switched on: "Jobs abrufen" works without a
   *  mailbox too, "Jobs suchen" works at all. */
  get searches(): boolean {
    return this.state?.portals.some((p) => p.enabled && p.way === 'search') ?? false;
  }

  /** A source of alert mails is switched on ("Postfach abrufen" has one to read). */
  get alerts(): boolean {
    return this.state?.portals.some((p) => p.enabled && p.way === 'alert') ?? false;
  }

  get hasProfile(): boolean {
    const profile = this.state?.profile;
    return Boolean(profile && profile.parseError === null && profile.quality !== 'empty');
  }
}

export const app = new AppStore();
