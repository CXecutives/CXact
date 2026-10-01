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
// What a fetch brought is a toast at its end ("5 neue Jobs, 2 mit hoher Übereinstimmung"), in
// every view; its "Zeigen" opens the Eingang filtered to exactly the jobs it counts. What went
// wrong is a toast too, once, with its way on; the other details of a run (each mail, each
// portal) are in the log, not on screen.

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

class RunStore {
  active = $state(false);
  kind = $state<RunKindName | null>(null);
  step = $state<Step | null>(null);
  progress = $state<Partial<Record<Step, Progress>>>({});
  status = $state<{ code: StatusCode; portal: Portal | null; until: string | null } | null>(null);
  loginNeeded = $state<Portal | null>(null);
  /** The last finished fetch of this session (see above). */
  summary = $state<RunSummary | null>(null);
  /** An error of `start_run` itself (busy, no mailbox ...); said in the current language. */
  #startFailure = $state.raw<{ error: unknown } | null>(null);
  /** `start_run` is on its way: nothing is known yet (the first-run page stays until then). */
  starting = $state(false);
  cancelling = $state(false);

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

  /** A run the run line shows is going (a fetch or details run, never a rescore). */
  get fetching(): boolean {
    return this.active && this.kind !== 'rescore';
  }

  /** The words of a failed `start_run`, or null. */
  get startError(): string | null {
    return this.#startFailure === null ? null : errorText(this.#startFailure.error);
  }

  /** Why an action waits while a run goes, by its kind (a fetch, the ads of a details run, a
   *  rescore): the words of the backend's busy error. */
  get busyText(): string {
    return t.error.text('busy', { activity: this.kind });
  }

  /** Why the fetch cannot start now (what its menu chose: "Jobs suchen" the search,
   *  "Postfach abrufen" the mailbox), in the order she would fix it: a run holds the app, no
   *  mailbox for the mails, no source of that way switched on; null when it can (the demo
   *  fetches from its made-up mailbox). The backend refuses the same. */
  get fetchBlocked(): string | null {
    if (this.active) return this.busyText;
    if (app.fetchWay === 'search') return app.searches ? null : t.toolbar.needsPortal;
    if (!app.hasMailbox) return t.toolbar.needsMailbox;
    return app.alerts ? null : t.toolbar.needsPortal;
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
    if (kind !== 'rescore') this.#startFailure = null;
  }

  async start(request: RunRequest): Promise<boolean> {
    if (this.active) return false;
    this.#request = request;
    this.starting = true;
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
      this.#startFailure = { error };
      toasts.show(errorText(error), 'warning');
      if (error instanceof IpcError && error.kind === 'busy') void app.load();
      return false;
    } finally {
      this.starting = false;
    }
  }

  /** Start a finished run again: the same request (a details run with its jobs). */
  retry(summary: RunSummary | null): void {
    const kind = summary?.kind ?? 'fetch';
    const same = this.#request !== null && this.#request.kind === kind ? this.#request : null;
    void this.start(same ?? (kind === 'details' ? { kind: 'fetch' } : { kind }));
  }

  /** Write the files again that a run could not write (an Excel file open elsewhere): a
   *  rescore, which reads no mail and asks no portal, scores what is due and writes every
   *  file. */
  rewriteFiles(): void {
    void this.start({ kind: 'rescore' });
  }

  /** The Jobs view with its run line, from anywhere (the sidebar's status, the "Zeigen" of a
   *  toast), then `then`; an unsaved Profil may keep the view and ask first. */
  show(then?: () => void): void {
    navigation.go('jobs', false, () => {
      // In one column an open job hides the list and its run line: back to the list.
      if (viewport.narrow) jobs.clearSelection();
      then?.();
    });
  }

  /** The jobs a fetch's toast counts (its "Zeigen"): the Eingang without a search, filtered
   *  to the new jobs of that fetch ("Aus dem letzten Abruf"), to those of the high band when
   *  the toast names them. Each chip takes its part off again; none of it is kept as the
   *  user's filter. */
  showNew(summary: RunSummary): void {
    const high = (summary.newJobs?.high ?? 0) > 0;
    this.show(() => {
      jobs.setPlace('inbox', true);
      jobs.setFilter({ ...NO_FILTER, run: summary.run, bands: high ? ['high'] : [] }, false);
    });
  }

  async cancel(): Promise<void> {
    if (!this.active || this.cancelling) return;
    this.cancelling = true;
    try {
      await invoke('cancel_run');
    } catch (error) {
      this.cancelling = false;
      this.#startFailure = { error };
    }
  }

  /** Overall progress of the current step (null = indeterminate). */
  get fraction(): number | null {
    const step = this.step;
    if (step === null) return null;
    const p = this.progress[step];
    if (!p || p.total === 0) return null;
    return p.done / p.total;
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
        break;
      }
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
   *  the fix is, the log, or "Erneut versuchen" where nothing else starts it again), files
   *  that could not be written with "Erneut versuchen". */
  private tellTrouble(summary: RunSummary): void {
    if (summary.outcome.kind === 'failed') {
      const error = summary.outcome.error;
      const fix = failureAction(summary, error, openLog);
      toasts.show(
        t.error.text(error.kind, error.params),
        'warning',
        fix === null ? null : { label: fix.label, onclick: fix.onclick, undo: false },
      );
      return;
    }
    const files = exportText(exportError(summary));
    if (files !== null) {
      toasts.show(files, 'warning', {
        label: t.common.retry,
        onclick: () => this.rewriteFiles(),
        undo: false,
      });
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
        const brought = summary.newJobs ?? { count: 0, high: 0 };
        const show =
          brought.count > 0
            ? { label: t.toast.show, onclick: () => this.showNew(summary), undo: false }
            : inList
              ? null
              : { label: t.toast.show, onclick: () => this.show(), undo: false };
        // Files that could not be written make it no success: a toast says why.
        const kind = exportError(summary) === null ? 'success' : 'info';
        toasts.show(t.toast.runDone(brought.count, brought.high), kind, show);
      } else if (kind === 'rescore' && navigation.current === 'settings') {
        toasts.show(t.toast.rescored);
      }
    }
    void app.load();
  }
}

export interface FailureAction {
  label: string;
  /** The glyph the action has everywhere (a retry loads again, like Postfach abrufen). */
  icon?: IconMeaning;
  onclick: () => void;
}

/**
 * The one fitting action for a failed run, wherever it is said (its toast, the first-run
 * page): the mailbox settings for a mailbox problem, the log for an internal error, else a
 * retry. A failed fetch gets none while "Postfach abrufen" is there to do the same (with a
 * mailbox), and no retry is offered while another run goes (it could not start).
 */
export function failureAction(
  summary: RunSummary | null,
  error: ErrorInfo,
  openLog: () => void,
): FailureAction | null {
  switch (error.kind) {
    case 'mailAuth':
    case 'mailMissing':
    case 'mailNotGmail':
    case 'secretCorrupt':
    case 'secretStore':
      return { label: t.run.checkMailbox, onclick: () => navigation.go('settings') };
    case 'internal':
      return { label: t.common.openLog, icon: 'folder', onclick: openLog };
    default:
      if (run.active) return null;
      if (summary !== null && isFetch(summary.kind) && app.hasMailbox) return null;
      return { label: t.common.retry, icon: 'retry', onclick: () => run.retry(summary) };
  }
}

/** The log folder, from a toast of a failure (its own failure is a toast too). */
function openLog(): void {
  invoke('open_target', { target: { kind: 'logDir' } }).catch((failure: unknown) =>
    toasts.show(errorText(failure), 'warning'),
  );
}

/** The export error of a finished run, if its files could not all be written. */
export function exportError(summary: RunSummary): ErrorInfo | null {
  return summary.export?.error ?? null;
}

/** Why a result file stayed as it was, by what could not be written (`params.target`, the
 *  Excel file where it names none): one sentence for a toast. */
export function exportText(error: ErrorInfo | null): string | null {
  if (error === null) return null;
  const texts = t.run.exportFailed;
  switch (error.params['target']) {
    case 'csv':
      return error.kind === 'fileLocked' ? texts.csvLocked : texts.csv;
    case 'backup':
      return texts.backup;
    case 'workspace':
      return texts.workspace;
    default:
      return error.kind === 'fileLocked' ? texts.overviewLocked : texts.overview;
  }
}

export const run = new RunStore();
