// The runs, built from the run events (api.ts: one channel per command call, all fanned out
// to `onRun`). Every run begins with `started` and its kind, so the page follows the runs
// the app starts by itself as what they are: the auto fetch at the start, a rescore after a
// profile or workspace change or an engine update. After a reload the snapshot of
// `app_state` replays the events that describe the current state.
//
// Three things are kept apart:
// - the run in progress (`active`, `kind`, its step, progress and status), of any kind;
// - `summary`: the last finished fetch of this session (fetch or whole mailbox). It means the
//   same as `app.state.lastRun` ("the last fetch"), so `run.summary ?? app.state.lastRun` is
//   the last fetch wherever it is read (sidebar, failed-fetch retry, empty list);
// - `result`: the last finished run the list's run line speaks of when it went wrong (a
//   fetch or details run, a rescore only when it failed or could not write the files).
// What a fetch brought is a toast at its end ("5 neue Jobs"), in every view; the details of
// a run (each mail, each portal) are in the log, not on screen.

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
export const isFetch = (kind: RunKindName): boolean => kind === 'fetch' || kind === 'fullMailbox';

class RunStore {
  active = $state(false);
  kind = $state<RunKindName | null>(null);
  step = $state<Step | null>(null);
  progress = $state<Partial<Record<Step, Progress>>>({});
  status = $state<{ code: StatusCode; portal: Portal | null; until: string | null } | null>(null);
  loginNeeded = $state<Portal | null>(null);
  /** The last finished fetch of this session (see above). */
  summary = $state<RunSummary | null>(null);
  /** The finished run the run line speaks of when it went wrong (a fetch or details run, a
   *  rescore in trouble). */
  result = $state<RunSummary | null>(null);
  /** An error of `start_run` itself (busy, no mailbox ...); said in the current language. */
  #startFailure = $state.raw<{ error: unknown } | null>(null);
  /** `start_run` is on its way: nothing is known yet (the first-run page stays until then). */
  starting = $state(false);
  cancelling = $state(false);
  /** What went wrong in the last run shows under the list header until its × hides it. */
  panel = $state<'open' | 'hidden'>('hidden');

  #listeners = new Set<(event: RunEvent) => void>();
  #installed = false;
  /** The last run the page started (a retry starts it again). */
  #request: RunRequest | null = null;
  /** Counts the runs begun, so a failed start leaves a run that began meanwhile alone. */
  #epoch = 0;
  /** A `started` came through the channel: the page follows the runs live. */
  #followed = false;
  /** The rescore going now writes the files again that the last run could not write. */
  #rewriting = false;

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
   * The run in progress at the first load (a reload of the page). A run whose `started`
   * already came through the channel is followed live; its snapshot could be older than
   * what arrived since (even its end).
   */
  attach(snapshot: RunSnapshot | null): void {
    if (snapshot === null || this.#followed) return;
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

  /** Why an action waits while a run goes. */
  get busyText(): string {
    return this.kind === 'rescore' ? t.run.rescoring : t.settings.running;
  }

  /** Why a run that reads the mailbox (Abrufen, the whole mailbox) cannot start now, in the
   *  order she would fix it: the demo never fetches, a run holds the app, no mailbox, no
   *  portal switched on; null when it can. The backend refuses the same. */
  get fetchBlocked(): string | null {
    if (app.state?.demo) return t.error.text('demo', {});
    if (this.active) return this.busyText;
    if (!app.hasMailbox) return t.toolbar.needsMailbox;
    if (!app.hasPortal) return t.toolbar.needsPortal;
    return null;
  }

  /** Why a run that fetches the full ads of chosen jobs ("Details holen") cannot start now:
   *  the demo never fetches, a run holds the app; null when it can. The backend refuses the
   *  same. */
  get detailsBlocked(): string | null {
    if (app.state?.demo) return t.error.text('demo', {});
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
    // A rescore keeps what the line said about the last fetch.
    if (kind === 'rescore') return;
    this.result = null;
    this.#startFailure = null;
    this.panel = 'open';
  }

  async start(request: RunRequest): Promise<boolean> {
    if (this.active) return false;
    // Nothing is lost when the start fails: the line says what it said before.
    const before = { result: this.result, panel: this.panel };
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
        this.result = before.result;
      }
      this.panel = 'open';
      this.#startFailure = { error };
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

  /**
   * Write the files again that a run could not write (an Excel file open elsewhere): a
   * rescore, which reads no mail and asks no portal, scores what is due and writes every
   * file. When it succeeds the last run counts its files as written.
   */
  rewriteFiles(): void {
    this.#rewriting = true;
    void this.start({ kind: 'rescore' }).then((started) => {
      if (!started) this.#rewriting = false;
    });
  }

  /** The Jobs view with its run line, from anywhere (the sidebar's status, the "Zeigen" of a
   *  toast); an unsaved Profil may keep the view and ask first. */
  show(): void {
    navigation.go('jobs', false, () => {
      this.panel = 'open';
      // In one column an open job hides the list and its run line: back to the list.
      if (viewport.narrow) jobs.clearSelection();
    });
  }

  /** Hide what the run line says after a run (and the note of a failed start with it). */
  hide(): void {
    this.panel = 'hidden';
    this.#startFailure = null;
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
        // The step's progress counts over all portals (the backend sends `portal: null`).
        if (event.portal === null) {
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

  private finish(summary: RunSummary, live: boolean): void {
    const kind = summary.kind;
    this.active = false;
    this.kind = kind;
    this.cancelling = false;
    this.status = null;
    this.loginNeeded = null;
    const rewrote = this.#rewriting && kind === 'rescore';
    this.#rewriting = false;
    if (rewrote && this.result !== null && summary.outcome.kind !== 'failed') {
      // The files written again: the last run counts them as they are now.
      this.result = { ...this.result, export: summary.export };
    } else if (kind === 'rescore') {
      // Quiet unless something needs attention: then the run line says it.
      const trouble = summary.outcome.kind === 'failed' || exportError(summary) !== null;
      if (trouble) {
        this.result = summary;
        if (live) this.panel = 'open';
      }
    } else {
      if (isFetch(kind)) this.summary = summary;
      this.result = summary;
    }
    if (!live) return;
    // What a fetch brought, in every view: "5 neue Jobs"; outside the list the way to it. A
    // rescore speaks where it was started (Einstellungen), not as a fetch.
    if (summary.outcome.kind === 'completed') {
      if (isFetch(kind)) {
        const inList = navigation.current === 'jobs' && !shell.listHidden;
        const show = { label: t.toast.show, onclick: () => this.show(), undo: false };
        toasts.show(t.toast.runDone(summary.newJobs?.count ?? 0), 'success', inList ? null : show);
      } else if (kind === 'rescore' && navigation.current === 'settings') {
        toasts.show(t.toast.rescored);
      }
    }
    void app.load();
  }
}

export interface FailureAction {
  label: string;
  /** The glyph the action has everywhere (a retry loads again, like Abrufen). */
  icon?: IconMeaning;
  onclick: () => void;
}

/**
 * The one fitting action for a failed run, wherever it is said (the run card, the day
 * overview): the mailbox settings for a mailbox problem, the log for an internal error, else
 * a retry. A failed fetch gets none while "Abrufen" is there to do the same (with a
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

/** The export error of a finished run, if its files could not all be written. */
export function exportError(summary: RunSummary): ErrorInfo | null {
  return summary.export?.error ?? null;
}

/** Why a result file stayed as it was, by what could not be written (`params.target`): one
 *  sentence for the run card and for a delete for good in the list. */
export function exportText(error: ErrorInfo | null): string | null {
  if (error === null) return null;
  const texts = t.run.exportFailed;
  switch (error.params['target']) {
    case 'overview':
      return error.kind === 'fileLocked' ? texts.overviewLocked : texts.overview;
    case 'overviewHtml':
      return texts.overviewHtml;
    case 'txtFolder':
      return texts.txtFolder;
    case 'backup':
      return texts.backup;
    case 'workspace':
      return texts.workspace;
    default:
      return texts.txt;
  }
}

export const run = new RunStore();
