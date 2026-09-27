// The one place that decides which OS the UI runs on, and the only place that knows how the
// two differ. Inside the window both are the same app; what differs does so by the
// convention of the OS (docs/PLAN.md, "Platforms"):
//   - the window buttons in the app's top bar (features/shell/TitleBar.svelte, the same bar
//     on both, like the Claude app): Windows gets the app's own caption buttons at the right,
//     macOS its native traffic lights at the left, whose room the bar keeps free
//     (`drawsWindowButtons()`),
//   - dialog buttons: Windows puts the primary first, macOS last (right),
//   - scrollbars: slim styled ones on Windows, the native overlay scrollbars on macOS
//     (base.css keys them off `:root[data-platform]`, like the font smoothing),
//   - words that name OS things (Explorer / Finder, the password store),
//   - the editing keys of text fields and the context menu key (`keyConventions()`,
//     applied by lib/input/input.ts: Ctrl on Windows, Cmd on macOS); the app has no
//     shortcuts of its own.
// Components ask here (`drawsWindowButtons()`, `primaryFirst()`, `keyConventions()`,
// `platform()`),
// never compare OS names themselves. The window's focus state is the same on both:
// `:root[data-window]` is 'inactive' while the window is in the background, and selections
// grey out against it as in Mail and Explorer.

import { onWindowFocus } from './ipc/api';

export type Platform = 'windows' | 'macos';

function isPlatform(value: string | null | undefined): value is Platform {
  return value === 'windows' || value === 'macos';
}

/** `?platform=macos|windows` (harness and gallery) wins over the user agent. */
function detect(): Platform {
  const requested = new URLSearchParams(location.search).get('platform');
  if (isPlatform(requested)) return requested;
  return /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'macos' : 'windows';
}

/** Sets `data-platform` on <html> unless the host already did. Call once before mounting. */
export function applyPlatform(): Platform {
  const root = document.documentElement;
  if (!isPlatform(root.dataset.platform)) root.dataset.platform = detect();
  return platform();
}

/**
 * Keeps `data-window` on <html> in step with the OS window ('active' | 'inactive'); the
 * components style against it with a colour transition, nothing per component in JS. Call
 * once before mounting.
 */
export function trackWindowFocus(): void {
  const root = document.documentElement;
  root.dataset.window = 'active';
  onWindowFocus((focused) => {
    root.dataset.window = focused ? 'active' : 'inactive';
  });
}

export function platform(): Platform {
  const value = document.documentElement.dataset.platform;
  return isPlatform(value) ? value : 'windows';
}

/**
 * The top bar draws the window buttons itself: Windows (Minimieren, Maximieren, Schließen at
 * the right, like the native ones of Windows 11). macOS keeps its native traffic lights,
 * which sit at the left of the same bar; the bar keeps their room free.
 */
export function drawsWindowButtons(): boolean {
  return platform() === 'windows';
}

/** Dialog buttons: the primary action comes first on Windows, last (right) on macOS. */
export function primaryFirst(): boolean {
  return platform() === 'windows';
}

/**
 * A text field's menu. Windows: Undo | Cut, Copy, Paste, Delete | Select all. macOS has no
 * undo and no delete there: Cut, Copy, Paste | Select all.
 */
export function fieldMenuUndoDelete(): boolean {
  return platform() === 'windows';
}

/** How the keyboard of the OS edits text in a field (lib/input/input.ts applies it). */
export interface KeyConventions {
  /** Option types characters (@ is Option+L on a German Mac) and moves by word, like
   *  AltGr on Windows; on Windows a plain Alt is the menu and navigation key. */
  optionTypes: boolean;
  /** The modifier of the editing shortcuts: Cmd on macOS, Ctrl on Windows. */
  command: 'metaKey' | 'ctrlKey';
  /** Ctrl+Y redoes (Windows); macOS redoes with Cmd+Shift+Z only. */
  redoWithY: boolean;
  /** Ctrl+A/E/B/F/N/P/D/H/K move and delete like in every macOS text field. */
  controlEdits: boolean;
  /** Alt+Space opens the window's system menu (Windows); on macOS Option+Space types. */
  systemMenuKey: boolean;
  /** Shift+F10 opens the context menu of a field or a selection, like the Menu key
   *  (Windows; a Mac keyboard has neither). */
  contextMenuKey: boolean;
}

/** A middle click over a scroll area starts the OS autoscroll, which runs until the next
 *  press: Windows (WebView2) has it, macOS has none. */
export function hasAutoscroll(): boolean {
  return platform() === 'windows';
}

export function keyConventions(): KeyConventions {
  const mac = platform() === 'macos';
  return {
    optionTypes: mac,
    command: mac ? 'metaKey' : 'ctrlKey',
    redoWithY: !mac,
    controlEdits: mac,
    systemMenuKey: !mac,
    contextMenuKey: !mac,
  };
}
