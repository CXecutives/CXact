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
// Types: `Commands` is generated from the Rust command table (types/commands.ts).

import { Channel, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Commands, ErrorInfo, ErrorKind, RunEvent } from './types';

export type CommandName = keyof Commands;
/** Arguments as the UI passes them: everything but the run channel. */
export type CommandArgs<K extends CommandName> = Omit<Commands[K]['args'], 'channel'>;
export type CommandResult<K extends CommandName> = Commands[K]['result'];
type Params = ErrorInfo['params'];

/** All commands, in the order of docs/PLAN.md. */
export const COMMAND_NAMES = [
  'app_state',
  'start_run',
  'cancel_run',
  'list_jobs',
  'job_detail',
  'mark_read',
  'set_pinned',
  'move_jobs',
  'move_back',
  'restore_jobs',
  'set_override',
  'purge_jobs',
  'empty_trash',
  'ai_prompt',
  'ai_prompt_top',
  'pick_profile',
  'parse_profile',
  'profile_prompt',
  'save_profile',
  'remove_profile',
  'restore_profile',
  'set_unsaved',
  'close_window',
  'save_mailbox',
  'remove_mailbox',
  'portal_login',
  'portal_logout',
  'pick_workspace',
  'rewrite_txt',
  'clear_txt',
  'open_target',
  'save_settings',
  'reset_all',
  'report_ui_error',
  'clipboard_text',
  'overview_stats',
  'company_count',
] as const satisfies readonly CommandName[];

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

type RunHandler = (event: RunEvent) => void;
const runHandlers = new Set<RunHandler>();

/** A fresh channel for one command call; its events go to every run handler. */
function channel(): Channel<RunEvent> {
  const next = new Channel<RunEvent>();
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
 * The window has been asked to close while the app is busy: it stays until what holds it
 * has stopped (at most ten seconds, src-tauri/src/main.rs). The handler gets what that is,
 * as the busy error names it (`activity`: a run's kind, `session`, `files`), or null.
 * Returns an unsubscribe function.
 */
export function onClosing(handler: (activity: string | null) => void): () => void {
  return subscribe(() =>
    listen<{ activity?: unknown } | null>('closing', (event) => {
      const activity = event.payload?.activity;
      handler(typeof activity === 'string' ? activity : null);
    }),
  );
}

/**
 * The OS window gained (true) or lost (false) the focus: Tauri's window events, the moment
 * the native title bar dims. Returns an unsubscribe function.
 */
export function onWindowFocus(handler: (focused: boolean) => void): () => void {
  const stopFocus = subscribe(() => listen('tauri://focus', () => handler(true)));
  const stopBlur = subscribe(() => listen('tauri://blur', () => handler(false)));
  return () => {
    stopFocus();
    stopBlur();
  };
}

/**
 * The native menu asks for a view (macOS: "Einstellungen …" with Cmd+, in the app menu,
 * src-tauri/src/platform.rs). Returns an unsubscribe function.
 */
export function onNavigate(handler: (view: string) => void): () => void {
  return subscribe(() => listen<string>('navigate', (event) => handler(event.payload)));
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
