// The only importer of @tauri-apps/api (eslint + core/tests/ui_contract.rs). Everything else
// talks to the backend through these functions, which is also what lets the harness swap
// Tauri for a typed stub (vite `--mode harness`).
//
// Run events: every command that takes a `channel` (`app_state` attaches - also to a run
// that is already going after a reload -, `start_run` reports) gets a Channel of its own;
// `onRun` fans the events of all of them out. Callers never pass the channel.
// One channel per call is required: Tauri numbers the messages of each Rust-side channel
// from 0 and the JS channel delivers them in that order, and when the Rust side drops its
// channel it unregisters the JS one. A shared JS channel therefore swallows every event of
// the second run (the run finished in the backend, the UI never heard of it).
//
// Types: `Commands` is generated from the command table src-tauri/commands.txt
// (types/commands.ts); `NextCommands` holds what the interface needs before the backend has
// it (the stub answers both).

import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AppState,
  Commands,
  ErrorInfo,
  ErrorKind,
  NewJobs,
  PauseReason,
  Portal,
  PortalState,
  ProfileForm,
  ProfileInfo,
  RunEvent,
  RunSummary,
} from './types';

/**
 * Commands the interface needs that the backend adds next, in the shape of `Commands`; each
 * moves into src-tauri/commands.txt (and out of here) once the backend has it.
 * - `profile_from_cv`: "Aus Lebenslauf ausfüllen". `dropped`: take the files last dropped on
 *   the window (the window keeps them, the page never sends a path; onFileDrag), else the
 *   backend asks for the CV with its own file dialog (the CV formats). It reads the file, has
 *   it evaluated and merges the answer into the one profile (or makes it), saved at once. The
 *   stored profile, or null when the dialog was closed. Fails with
 *   `{kind: 'cv', params: {reason}}` (`CvFailure`).
 * - `profile_missing`: the required fields a form still lacks, by the rule of the stored
 *   profile's `missing` (core::profile::missing_required: roles, countries, competences,
 *   languages), for a form not saved yet (the missing line of a new profile).
 * - `finish_onboarding`: the setup reached "Alles eingerichtet": saves `onboarded`, so the
 *   next start opens the Jobs view (`AppState.firstRun` = not onboarded, outside the dry run).
 */
export type NextCommands = {
  profile_from_cv: { args: { dropped: boolean }; result: ProfileInfo | null };
  profile_missing: { args: { form: ProfileForm }; result: string[] };
  finish_onboarding: { args: Record<string, never>; result: null };
};

/**
 * Run events the interface needs that the backend adds next (they join `RunEvent`):
 * - `sourceDone`: a portal's search finished (the portals run side by side) with so many new
 *   jobs that are not excluded; the run snapshot replays them.
 */
export type SourceDone = { type: 'sourceDone'; portal: Portal; new: number };
export type NextRunEvent = RunEvent | SourceDone;

/**
 * Fields of the run summary the backend adds next: `mail`, why the mail part of a search was
 * skipped (Gmail or the keychain failed; the search still ran), and `newJobs.excluded`, how
 * many new jobs it excluded.
 */
export type NextRunSummary = Omit<RunSummary, 'newJobs'> & {
  mail?: ErrorInfo | null;
  newJobs: (NewJobs & { excluded?: number }) | null;
};

/**
 * Fields of the app state the backend adds next: `cvUntil`, the day (`YYYY-MM-DD`, UTC) "Aus
 * Lebenslauf ausfüllen" works again while its tries are used up; null while it works.
 */
export type NextAppState = AppState & { cvUntil?: string | null };

/** Fields of a portal's state the backend adds next: `alertMails`, how many alert mails of
 *  the portal the app read in the last 30 days (its row in Einstellungen; null: unknown). */
export type NextPortalState = PortalState & { alertMails?: number | null };

/** Fields of the profile's form the backend adds next: `project`, whether project and interim
 *  jobs are wanted (Vertragsart, beside `permanent` and `temporary`; missing: wanted). At
 *  least one of the three stays on. */
export type NextProfileForm = ProfileForm & { project?: boolean };
/** The three contract types of Vertragsart, each a value of the form. */
export type ContractKey = 'project' | 'permanent' | 'temporary';

/** Why a portal pauses, with what the backend adds next: `robots`, its robots.txt forbids
 *  the next page. */
export type NextPauseReason = PauseReason | 'robots';

/** The error kinds with what the backend adds next: `cv`, a failed CV evaluation. */
export type NextErrorKind = ErrorKind | 'cv';

type AllCommands = Commands & NextCommands;

export type CommandName = keyof AllCommands;
/** Arguments as the UI passes them: everything but the run channel. */
export type CommandArgs<K extends CommandName> = Omit<AllCommands[K]['args'], 'channel'>;
export type CommandResult<K extends CommandName> = AllCommands[K]['result'];
type Params = ErrorInfo['params'];

/** Commands that receive the run channel as `channel` argument. */
const STREAMING: ReadonlySet<CommandName> = new Set<CommandName>(['app_state', 'start_run']);

/**
 * A failed command: `kind` and `params` come from the backend (ErrorInfo), texts from the
 * catalog. `unknown` marks something that did not arrive as ErrorInfo (a bug of ours).
 */
export class IpcError extends Error {
  readonly kind: ErrorKind | 'unknown';
  readonly params: Params;

  constructor(kind: ErrorKind | 'unknown', params: Params = {}) {
    super(kind);
    this.name = 'IpcError';
    this.kind = kind;
    this.params = params;
  }
}

function isErrorInfo(value: unknown): value is ErrorInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

function toIpcError(error: unknown): IpcError {
  if (error instanceof IpcError) return error;
  if (isErrorInfo(error)) return new IpcError(error.kind, error.params ?? {});
  return new IpcError('unknown', { detail: String(error).slice(0, 200) });
}

/** Why "Aus Lebenslauf ausfüllen" failed: the CV evaluation's codes. */
export const CV_FAILURES = [
  'limit',
  'paused',
  'timeout',
  'outdated',
  'unreadable',
  'tooLarge',
  'unsupported',
  'offline',
  'refused',
  'unavailable',
] as const;
export type CvFailure = (typeof CV_FAILURES)[number];

/** A failed "Aus Lebenslauf ausfüllen", by its code. */
export class CvError extends Error {
  readonly reason: CvFailure;

  constructor(reason: CvFailure) {
    super(reason);
    this.name = 'CvError';
    this.reason = reason;
  }
}

const isCvFailure = (value: unknown): value is CvFailure =>
  (CV_FAILURES as readonly unknown[]).includes(value);

/**
 * "Aus Lebenslauf ausfüllen" (`profile_from_cv`): the files last dropped on the window
 * (`dropped`), else the backend's file dialog. The stored profile, or null when the dialog was
 * closed. Rejects with a CvError (no network counts as `offline`), anything else with an
 * IpcError.
 */
export async function fillFromCv(dropped = false): Promise<ProfileInfo | null> {
  try {
    return await invoke('profile_from_cv', { dropped });
  } catch (error) {
    if (!(error instanceof IpcError)) throw error;
    if (error.kind === 'offline') throw new CvError('offline');
    if ((error.kind as NextErrorKind) === 'cv' && isCvFailure(error.params.reason)) {
      throw new CvError(error.params.reason);
    }
    throw error;
  }
}

/** The required fields a form not saved yet still lacks (`profile_missing`). */
export function profileMissing(form: ProfileForm): Promise<string[]> {
  return invoke('profile_missing', { form });
}

type RunHandler = (event: NextRunEvent) => void;
const runHandlers = new Set<RunHandler>();

/** A fresh channel for one command call; its events go to every run handler. */
function channel(): Channel<NextRunEvent> {
  const next = new Channel<NextRunEvent>();
  next.onmessage = (event) => {
    for (const handler of runHandlers) handler(event);
  };
  return next;
}

/** Subscribe to run events (progress, status, job updates, ...). Returns an unsubscribe. */
export function onRun(handler: RunHandler): () => void {
  runHandlers.add(handler);
  return () => runHandlers.delete(handler);
}

type ArgsTuple<K extends CommandName> = [CommandArgs<K>] extends [Record<string, never>]
  ? [args?: CommandArgs<K>]
  : [args: CommandArgs<K>];

/** Call a backend command, typed by the command map. Rejects with an IpcError. */
export async function invoke<K extends CommandName>(
  command: K,
  ...[args]: ArgsTuple<K>
): Promise<CommandResult<K>> {
  const payload: Record<string, unknown> = { ...(args ?? {}) };
  if (STREAMING.has(command)) payload.channel = channel();
  try {
    return await tauriInvoke<CommandResult<K>>(command, payload);
  } catch (error) {
    throw toIpcError(error);
  }
}

/** Subscribes to a Tauri event and returns a synchronous unsubscribe function. */
function subscribe(start: () => Promise<() => void>): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void start().then(
    (unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    },
    () => undefined,
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

/**
 * The user closes the window (the close button, Alt+F4, Cmd+W or Cmd+Q) while the page holds
 * unsaved changes (`set_unsaved`): the window stays and the page asks, then closes it with
 * `close_window` (src-tauri/src/main.rs). The page answers at once (a `set_unsaved`), else
 * the window closes anyway. Returns an unsubscribe function.
 */
export function onCloseRequested(handler: () => void): () => void {
  return subscribe(() => listen('close-requested', () => handler()));
}

/**
 * The user closes the window while a fetch runs: the window stays and the page asks whether
 * to close anyway, then answers with `answer_close` (src-tauri/src/main.rs). A second close
 * while it asks closes anyway. Returns an unsubscribe function.
 */
export function onCloseRunning(handler: () => void): () => void {
  return subscribe(() => listen('close-running', () => handler()));
}

/**
 * The window has been asked to close while the app is busy: it stays until what holds it
 * has stopped (at most ten seconds, src-tauri/src/main.rs). The event's `activity` (what
 * holds it) is not shown: the note is one sentence. Returns an unsubscribe function.
 */
export function onClosing(handler: () => void): () => void {
  return subscribe(() => listen('closing', () => handler()));
}

/**
 * The OS window gained (true) or lost (false) the focus: Tauri's window events, the moment
 * the window buttons dim. Returns an unsubscribe function.
 */
export function onWindowFocus(handler: (focused: boolean) => void): () => void {
  const stopFocus = subscribe(() => listen('tauri://focus', () => handler(true)));
  const stopBlur = subscribe(() => listen('tauri://blur', () => handler(false)));
  return () => {
    stopFocus();
    stopBlur();
  };
}

/** A caption button of the Windows top bar (components/WindowButtons.svelte). */
export type WindowButton = CommandArgs<'window_button'>['button'];

/** Which caption button the pointer is over and which one is pressed (null: none). */
export interface CaptionState {
  hover: WindowButton | null;
  pressed: WindowButton | null;
}

function windowButton(value: unknown): WindowButton | null {
  return value === 'minimize' || value === 'maximize' || value === 'close' ? value : null;
}

/**
 * Windows: the window over the top bar reports the pointer on the caption buttons
 * (src-tauri/src/platform.rs answers the window procedure there, so the snap layouts of
 * Windows 11 open over Maximieren, and performs the click itself); the page shows the state.
 * Returns an unsubscribe function.
 */
export function onCaption(handler: (state: CaptionState) => void): () => void {
  return subscribe(() =>
    listen<{ hover?: unknown; pressed?: unknown } | null>('caption', (event) =>
      handler({
        hover: windowButton(event.payload?.hover),
        pressed: windowButton(event.payload?.pressed),
      }),
    ),
  );
}

/**
 * The window was maximized (true) or restored (false): Maximieren shows Verkleinern then.
 * Returns an unsubscribe function.
 */
export function onWindowState(handler: (maximized: boolean) => void): () => void {
  return subscribe(() =>
    listen<{ maximized?: unknown } | null>('window-state', (event) =>
      handler(event.payload?.maximized === true),
    ),
  );
}

/**
 * The native menu asks for a view (macOS: "Einstellungen …" with Cmd+, in the app menu,
 * src-tauri/src/platform.rs). Returns an unsubscribe function.
 */
export function onNavigate(handler: (view: string) => void): () => void {
  return subscribe(() => listen<string>('navigate', (event) => handler(event.payload)));
}

/** Where a drag of files over the window stands (Tauri's drag and drop of the window). */
export type FileDrag = { kind: 'over' } | { kind: 'leave' } | { kind: 'drop'; paths: string[] };

/**
 * Files dragged over the window and dropped (the upload of the setup): Tauri's window
 * events, with the paths of what was dropped. Returns an unsubscribe function.
 */
export function onFileDrag(handler: (drag: FileDrag) => void): () => void {
  const stops = [
    subscribe(() => listen('tauri://drag-enter', () => handler({ kind: 'over' }))),
    subscribe(() => listen('tauri://drag-leave', () => handler({ kind: 'leave' }))),
    subscribe(() =>
      listen<{ paths?: unknown } | null>('tauri://drag-drop', (event) => {
        const paths = event.payload?.paths;
        handler({
          kind: 'drop',
          paths: Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [],
        });
      }),
    ),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Edit > Undo of the macOS menu bar (src-tauri/src/platform.rs sends `menu-undo`): the page
 * takes back what Cmd+Z would (lib/input/input.ts). Returns an unsubscribe function.
 */
export function onMenuUndo(handler: () => void): () => void {
  return subscribe(() => listen('menu-undo', () => handler()));
}

/**
 * The text on the clipboard (the Paste entry of the app's own field menu), read by the
 * backend: the page may not read the clipboard without a prompt of the engine (WebView2 asks,
 * WKWebView shows its own Paste button). Null when there is no text or reading failed.
 */
export async function clipboardText(): Promise<string | null> {
  try {
    return await invoke('clipboard_text', {});
  } catch (error) {
    reportUiError(`clipboard: ${String(error)}`, null, null);
    return null;
  }
}

const REPORT_LIMIT = 10;
const REPORT_WINDOW = 60_000;
const REPORT_LENGTH = 2000;
let reportTimes: number[] = [];

/** Send an unexpected UI error to the app log (truncated, at most 10 per minute). */
export function reportUiError(message: string, source: string | null, line: number | null): void {
  const now = Date.now();
  reportTimes = reportTimes.filter((t) => now - t < REPORT_WINDOW);
  if (reportTimes.length >= REPORT_LIMIT) return;
  reportTimes.push(now);
  invoke('report_ui_error', {
    message: message.slice(0, REPORT_LENGTH),
    source: source?.slice(0, 300) ?? null,
    line,
    // The log is the last resort: if even that fails, there is nowhere left to report to.
  }).catch(() => undefined);
}

/** Forward uncaught errors and rejections to the app log. Call once in main.ts. */
export function installErrorReporting(): void {
  addEventListener('error', (event) => {
    reportUiError(String(event.message), event.filename || null, event.lineno || null);
  });
  addEventListener('unhandledrejection', (event) => {
    reportUiError(String(event.reason), null, null);
  });
}
