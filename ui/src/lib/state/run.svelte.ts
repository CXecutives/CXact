// The runs, built from the run events (api.ts: one channel per command call, all fanned out
// to `onRun`). Every run begins with `started` and its kind, so the page follows the runs
// the app starts by itself as what they are: a rescore after a profile or workspace change
// or an engine update. After a reload the snapshot of
// `app_state` replays the events that describe the current state.
//
// Three things are kept apart:
// - the run in progress (`active`, `kind`, its step, progress and status), of any kind;
// - `summary`: the last finished fetch of this session. It means the same as
//   `app.state.lastRun` ("the last fetch"), so `run.summary ?? app.state.lastRun` is the last
//   fetch wherever it is read (sidebar, failed-fetch retry, empty list).
// One fetch, "Jobs suchen": it reads the alert mails first (with a mailbox), then searches the
// portals side by side; the run line counts the portals that are done and the new jobs they
// brought so far, and its bar never moves back. What a fetch brought is a toast at its end
// ("5 neue Jobs, 2 mit hoher Übereinstimmung"), in every view; its "Zeigen" opens Aktuell
// filtered to exactly the jobs it counts. What went wrong is a toast too, once, with its way
// on (a mail part that failed while the search ran says "Postfach prüfen"); the other details
// of a run (each mail, each portal) are in the log, not on screen.

import type { IconMeaning } from '$lib/icons';
import { t } from '../i18n/t';
import { errorText } from '../i18n/texts';
import { invoke, IpcError, onRun } from '../ipc/api';
import type {
  ErrorInfo,
  Portal,
  RunEvent,
  RunKindName,
  RunRequest,
  RunSnapshot,
  RunSummary,
  StatusCode,
  Step,
} from '../ipc/types';
import { app } from './app.svelte';
import { NO_FILTER } from './filter';
import { jobs } from './jobs.svelte';
import { navigation } from './navigation.svelte';
import { shell } from './shell.svelte';
import { toasts } from './toasts.svelte';
import { viewport } from './viewport.svelte';

export interface Progress {
  done: number;
  total: number;
}

/** A mailbox run: what "the last fetch" means (`app.state.lastRun`). */
export const isFetch = (kind: RunKindName): boolean => kind === 'fetch';

/** The share of the bar each part of a fetch fills: the portals' search, then loading the
 *  ads, then scoring them. Reading the mails stays indeterminate. */
const SHARE = { search: 0.5, fetch: 0.4 } as const;

class RunStore {
  active = $state(false);
  kind = $state<RunKindName | null>(null);
  step = $state<Step | null>(null);
  progress = $state<Partial<Record<Step, Progress>>>({});
  status = $state<{ code: StatusCode; portal: Portal | null; until: string | null } | null>(null);
  loginNeeded = $state<Portal | null>(null);
  /** The last finished fetch of this session (see above). */
  summary = $state<RunSummary | null>(null);
  cancelling = $state(false);
  /** The portals of this search that are done, of how many it searches, and the new jobs
   *  (not excluded) they brought so far (`sourceDone`). */
  portalsDone = $state(0);
  portalsTotal = $state(0);
  newSoFar = $state(0);
  /** How far the run is, 0 to 1 (null: indeterminate); it never moves back. */
  fraction = $state<number | null>(null);

  #listeners = new Set<(event: RunEvent) => void>();
  #installed = false;
  /** The last run the page started (a retry starts it again). */
  #request: RunRequest | null = null;
  /** Counts the runs begun, so a failed start leaves a run that began meanwhile alone. */
  #epoch = 0;
  /** A `started` came through the channel: the page follows the runs live. */
  #followed = false;

  /** Subscribe once to the run channel (App.svelte). */
  install(): void {
    if (this.#installed) return;
    this.#installed = true;
    onRun((event) => this.handle(event));
  }

  /** Other stores that react to run events (the job list). */
  listen(listener: (event: RunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The run in progress at the first load (a start of the app, a reload of the page). A run
   * whose `started` already came through the channel is followed live; its snapshot could be
   * older than what arrived since (even its end).
   */
  attach(snapshot: RunSnapshot | null): void {
    if (this.#followed || this.active || snapshot === null) return;
    this.begin(snapshot.kind);
    for (const event of snapshot.replay) this.handle(event, false);
  }

  /** A run that loads ads is going (a fetch or details run, never a rescore). */
  get fetching(): boolean {
    return this.active && this.kind !== 'rescore';
  }

  /** A search ("Jobs suchen") is going: the run line, "Abbrechen" and the empty list say
   *  so. Loading one ad ("Anzeige laden") is no search: its ad section says it. */
  get searching(): boolean {
    return this.active && this.kind === 'fetch';
  }

  /** Why an action waits while a run goes, by its kind (a fetch, the ads of a details run, a
   *  rescore): the words of the backend's busy error. */
  get busyText(): string {
    return t.error.text('busy', { activity: this.kind });
  }

  /** Why "Jobs suchen" cannot start now, in the order it is fixed: a run holds the app; no
   *  usable profile; nothing to read (no portal it searches, no alert mails with a mailbox);
   *  null when it can. The backend refuses the same. */
  get fetchBlocked(): string | null {
    if (this.active) return this.busyText;
    if (!app.hasProfile) return t.toolbar.needsProfile;
    return app.readable ? null : t.toolbar.needsPortal;
  }

  /** Why a run that fetches the full ads of chosen jobs ("Anzeige laden") cannot start now:
   *  a run holds the app; null when it can. The backend refuses the same. */
  get detailsBlocked(): string | null {
    if (this.active) return this.busyText;
    return null;
  }

  private begin(kind: RunKindName): void {
    this.#epoch += 1;
    this.active = true;
    this.kind = kind;
    this.step = null;
    this.progress = {};
    this.status = null;
    this.loginNeeded = null;
    this.cancelling = false;
    this.portalsDone = 0;
    this.portalsTotal =
      app.state?.portals.filter((p) => p.enabled && p.way === 'search').length ?? 0;
    this.newSoFar = 0;
    this.fraction = null;
  }

  /** The bar after an event: the portals done fill the first share, the ads loaded the
   *  next, the scoring the rest; it only moves on. */
  private advance(): void {
    const part = (step: Step): number => {
      const p = this.progress[step];
      return p && p.total > 0 ? Math.min(1, p.done / p.total) : 0;
    };
    let now: number | null = null;
    if (this.step === 'search' && this.portalsTotal > 0) {
      now = SHARE.search * Math.min(1, this.portalsDone / this.portalsTotal);
    } else if (this.step === 'fetch') {
      now = SHARE.search + SHARE.fetch * part('fetch');
    } else if (this.step === 'score') {
      // A rescore is this step alone: the shares are a fetch's.
      now =
        this.kind === 'rescore'
          ? part('score')
          : SHARE.search + SHARE.fetch + (1 - SHARE.search - SHARE.fetch) * part('score');
    }
    if (now !== null) this.fraction = Math.max(this.fraction ?? 0, now);
  }

  async start(request: RunRequest): Promise<boolean> {
    if (this.active) return false;
    this.#request = request;
    this.begin(request.kind);
    const epoch = this.#epoch;
    try {
      await invoke('start_run', { request });
      return true;
    } catch (error) {
      if (this.#epoch === epoch) {
        this.active = false;
        this.kind = null;
      }
      toasts.show(errorText(error), 'warning');
      if (error instanceof IpcError && error.kind === 'busy') void app.load();
      return false;
    }
  }

  /** Start a finished run again: the same request (a details run with its jobs). */
  retry(summary: RunSummary | null): void {
    const kind = summary?.kind ?? 'fetch';
    const same = this.#request !== null && this.#request.kind === kind ? this.#request : null;
    void this.start(same ?? (kind === 'details' ? { kind: 'fetch' } : { kind }));
  }

  /** The Jobs view with its run line, from anywhere (a place of the floating sidebar, the
   *  "Zeigen" of a toast), then `then`; an unsaved Profil may keep the view and ask first. */
  show(then?: () => void): void {
    navigation.go('jobs', false, () => {
      // In one column an open job hides the list and its run line: back to the list.
      if (viewport.narrow) jobs.clearSelection();
      then?.();
    });
  }

  /** The jobs a fetch's toast counts (its "Zeigen"): Aktuell without a search, filtered
   *  to the new jobs of that fetch ("Aus der letzten Suche"), to those of the high band when
   *  the toast names them. Each chip takes its part off again; none of it is kept as the
   *  user's filter. */
  showNew(summary: RunSummary): void {
    const high = (summary.newJobs?.high ?? 0) > 0;
    this.show(() => {
      jobs.setPlace('inbox', true);
      jobs.borrowFilter({ ...NO_FILTER, run: summary.run, bands: high ? ['high'] : [] });
    });
  }

  async cancel(): Promise<void> {
    if (!this.active || this.cancelling) return;
    this.cancelling = true;
    try {
      await invoke('cancel_run');
    } catch (error) {
      this.cancelling = false;
      toasts.show(errorText(error), 'warning');
    }
  }

  handle(event: RunEvent, live = true): void {
    switch (event.type) {
      case 'started':
        if (!live) break;
        this.#followed = true;
        // The page's own start began it already; any other run is one the app started.
        if (!this.active || this.kind !== event.kind) this.begin(event.kind);
        break;
      case 'progress': {
        if (!this.active) break;
        this.step = event.step;
        // The step's progress counts over all portals (the backend sends `portal: null`); the
        // search counts its pages over all sources and names the one it asks.
        if (event.portal === null || event.step === 'search') {
          this.progress = {
            ...this.progress,
            [event.step]: { done: event.done, total: event.total },
          };
        }
        this.advance();
        break;
      }
      case 'sourceDone':
        if (!this.active) break;
        this.step = 'search';
        this.portalsDone += 1;
        this.portalsTotal = Math.max(this.portalsTotal, this.portalsDone);
        this.newSoFar += event.new;
        this.advance();
        break;
      case 'status':
        if (!this.active) break;
        this.status = { code: event.code, portal: event.portal, until: event.until };
        break;
      case 'alert':
        break;
      case 'portalHealth':
        app.setHealth(event.portal, event.health);
        break;
      case 'loginNeeded':
        this.loginNeeded = event.waiting ? event.portal : null;
        break;
      case 'finished':
        this.finish(event.summary, live);
        break;
      case 'jobUpdated':
        break;
    }
    if (live) for (const listener of this.#listeners) listener(event);
  }

  /** What went wrong in a finished run, once as a toast: a failure with its own way on (where
   *  the fix is, the log, or "Erneut versuchen" where nothing else starts it again); a mail
   *  part that failed while the search ran says why with "Postfach prüfen". */
  private tellTrouble(summary: RunSummary): void {
    const mail = summary.mail;
    if (summary.outcome.kind === 'completed' && mail !== null) {
      toasts.show(t.error.text(mail.kind, mail.params), 'warning', {
        label: t.run.checkMailbox,
        onclick: toMailbox,
        undo: false,
      });
    }
    if (summary.outcome.kind === 'failed') {
      const error = summary.outcome.error;
      const fix = failureAction(summary, error);
      toasts.show(
        t.error.text(error.kind, error.params),
        'warning',
        fix === null ? null : { label: fix.label, onclick: fix.onclick, undo: false },
      );
    }
  }

  private finish(summary: RunSummary, live: boolean): void {
    const kind = summary.kind;
    this.active = false;
    this.kind = kind;
    this.cancelling = false;
    this.status = null;
    this.loginNeeded = null;
    if (isFetch(kind)) this.summary = summary;
    if (!live) return;
    this.tellTrouble(summary);
    // What a fetch brought, in every view: "5 neue Jobs, 2 mit hoher Übereinstimmung" and the
    // way to them (without new jobs outside the list the way to it). A rescore speaks where it
    // was started (Einstellungen), not as a fetch.
    if (summary.outcome.kind === 'completed') {
      if (isFetch(kind)) {
        const inList = navigation.current === 'jobs' && !shell.listHidden;
        const brought = summary.newJobs ?? { count: 0, high: 0, excluded: 0 };
        const show =
          brought.count > 0
            ? { label: t.toast.show, onclick: () => this.showNew(summary), undo: false }
            : inList
              ? null
              : { label: t.toast.show, onclick: () => this.show(), undo: false };
        toasts.show(
          t.toast.runDone(brought.count, brought.high, brought.excluded),
          'success',
          show,
        );
      } else if (kind === 'rescore' && navigation.current === 'settings') {
        toasts.show(t.toast.rescored);
      }
    }
    void app.load();
  }
}

export interface FailureAction {
  label: string;
  /** The glyph the action has everywhere (a retry loads again). */
  icon?: IconMeaning;
  onclick: () => void;
}

/**
 * The one fitting action for a failed run, wherever it is said (its toast, the list's run
 * line): the mailbox settings for a mailbox problem, none for an internal error (the log is
 * written quietly), else a retry; no retry is offered while another run goes (it could not
 * start).
 */
export function failureAction(summary: RunSummary | null, error: ErrorInfo): FailureAction | null {
  switch (error.kind) {
    case 'mailAuth':
    case 'mailMissing':
    case 'mailNotGmail':
    case 'secretCorrupt':
    case 'secretStore':
      return { label: t.run.checkMailbox, onclick: toMailbox };
    case 'internal':
      return null;
    default:
      if (run.active) return null;
      return { label: t.common.retry, icon: 'retry', onclick: () => run.retry(summary) };
  }
}

/** "Postfach prüfen": Einstellungen at its Postfach, which says what failed. */
function toMailbox(): void {
  navigation.go('settings', false, () => (navigation.section = 'mailbox'));
}

export const run = new RunStore();
