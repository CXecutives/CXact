// Token-bound wrappers of svelte/transition, svelte/animate and svelte/motion.
// This folder is the only place allowed to import them (eslint + ui_contract.rs).
//
// The rules of all motion in the UI (lib/motion is their one home):
//   - Only transform and opacity move, plus colour and stroke-dashoffset. The exceptions are
//     single small boxes: the height of a row or line that folds or unfolds, the width of a
//     button that gives up its room in a row (foldAside), and the size of an element out of the
//     flow that glides to another box (glide.ts, barSlide). End values are whole pixels.
//   - One curve per kind: entries ease out (--ease-out, 150 to 180 ms), exits ease in
//     (--ease-in, 60 to 100 ms), every glide (a marker, a thumb, a chevron, rows that move)
//     180 ms with --ease-out. Two travels: --move-sm (4 px) for small things and every exit,
//     --move-lg (8 px) for large ones. The ring and its count 400 ms (--dur-reveal), a whole
//     stagger at most 400 ms (--stagger-span). Nothing overshoots, bounces, scales or
//     deforms, not even on press.
//   - Motion only where something new comes: the rows of another place (enter.ts, capped
//     and skipped while the user browses fast, pace.ts), a new job's ring, an insert or a
//     removal, a state change. A view switch, a job swap or a re-render shows the new content
//     at once: a cascade there would leave a frame without content and replay on every
//     return. A glide jumps when its target is out of sight (glide.ts).
//   - Under reduced motion every movement is dropped: an entry or a glide is simply there,
//     and what remains of a transition is a cross-fade of --dur-crossfade.
//
// No replay by construction: Svelte plays a local transition only when the block right
// around it (if, each, key) is the one that changed, so a transition never plays when a
// view, a list or the app mounts (main.ts also mounts with `intro: false`). Something that
// comes and goes with a block further out (a menu inside its `{#key}`) takes `|global`.
//
// fade and rise never read the element's style: svelte/transition's versions call
// getComputedStyle for the element's own opacity and transform, which forces a style and
// layout pass in the middle of the script (a new job in the reader lays out the whole page
// twice in one task). The elements they move are opaque and untransformed, so the result is
// the same.

import { flip as svelteFlip } from 'svelte/animate';
import type { AnimationConfig } from 'svelte/animate';
import type { TransitionConfig } from 'svelte/transition';
import {
  crossfadeDuration,
  duration,
  easing,
  isReducedMotion,
  move,
  play,
  type Duration,
  type Easing,
  type Move,
} from './motion';

export interface MotionParams {
  duration?: Duration;
  easing?: Easing;
  /** Delay in ms. */
  delay?: number;
  /** Play at all (false while the screen is still being built: it is simply there). */
  on?: boolean;
}

export interface RiseParams extends MotionParams {
  distance?: Move;
}

/** Opacity from 0 to 1 (in) or back (out), without reading the element's style. */
function opacity(ms: number, ease: (t: number) => number, delay = 0): TransitionConfig {
  return { duration: ms, easing: ease, delay, css: (t) => `opacity: ${t}` };
}

function crossfade(_node: Element, delay = 0): TransitionConfig {
  return opacity(crossfadeDuration(), easing('standard'), delay);
}

/** Opacity only. */
export function fade(node: Element, params: MotionParams = {}): TransitionConfig {
  if (params.on === false) return {};
  if (isReducedMotion()) return crossfade(node);
  return opacity(
    duration(params.duration ?? 'fast'),
    easing(params.easing ?? 'standard'),
    params.delay ?? 0,
  );
}

/** Fade in while rising by a token distance (default --move-sm, 4 px). */
export function rise(node: Element, params: RiseParams = {}): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move(params.distance ?? 'sm');
  return {
    duration: duration(params.duration ?? 'base'),
    easing: easing(params.easing ?? 'out'),
    delay: params.delay ?? 0,
    css: (t, u) => `transform: translateY(${u * y}px); opacity: ${t}`,
  };
}

/** Fade in while sliding in from the start side by --move-sm (4 px): a field that appears
 *  beside the choice that asked for it (the day of Verfügbar), 150 ms. */
export function slideIn(node: Element, params: RiseParams = {}): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const x = move(params.distance ?? 'sm');
  return {
    duration: duration(params.duration ?? 'base'),
    easing: easing(params.easing ?? 'out'),
    delay: params.delay ?? 0,
    css: (t, u) => `transform: translateX(${-u * x}px); opacity: ${t}`,
  };
}

/** A small thing that appears in its place (the trailing button of a field): it fades in,
 *  nothing scales (100 ms, ease-out). */
export function pop(node: Element, params: MotionParams = {}): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  return opacity(
    duration(params.duration ?? 'fast'),
    easing(params.easing ?? 'out'),
    params.delay ?? 0,
  );
}

/**
 * A chip that the user adds rises by --move-sm (4 px) while it fades in (150 ms, ease-out).
 * `in:chipIn` on the chip inside a `{#each}` keyed by the chip's value (a reload of the same
 * chips then creates nothing): Svelte plays a local intro only in a block that ran before,
 * so the chips a field mounts with are simply there, and only an added chip rises.
 */
export function chipIn(node: Element, params: MotionParams = {}): TransitionConfig {
  if (params.on === false) return {};
  if (isReducedMotion()) return crossfade(node);
  const y = move('sm');
  return {
    duration: duration(params.duration ?? 'base'),
    easing: easing(params.easing ?? 'out'),
    delay: params.delay ?? 0,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`,
  };
}

/** Maximum rows that may FLIP; above this a list cross-fades. */
export const FLIP_LIMIT = 100;

export interface FlipParams extends MotionParams {
  /** Rows in the list: above FLIP_LIMIT rows do not move (the list cross-fades). */
  count?: number;
}

/** FLIP reordering, a glide like every other (180 ms, ease-out):
 *  `animate:flip={{ count: rows.length }}`. */
export function flip(
  node: Element,
  fromTo: { from: DOMRect; to: DOMRect },
  params: FlipParams = {},
): AnimationConfig {
  // Only rows the user can see move: a row that is off screen before and after is placed.
  const offscreen = (rect: DOMRect): boolean => rect.bottom < 0 || rect.top > innerHeight;
  const still =
    (params.count ?? 0) > FLIP_LIMIT || (offscreen(fromTo.from) && offscreen(fromTo.to));
  return svelteFlip(node, fromTo, {
    duration: still ? 0 : duration(params.duration ?? 'slow'),
    easing: easing(params.easing ?? 'out'),
    delay: params.delay ?? 0,
  });
}

/**
 * Entry of a list row. A list that loads, filters or comes back into view is simply there;
 * only a row that arrives while the list is on screen (a new job during a run) fades in,
 * rising 4 px in 150 ms, and only among the first --stagger-max rows (the list decides).
 * A Web Animation started by the list after the row is in place, not a transition on
 * every row: the transition would run (and fire its events) for each of hundreds of rows
 * that simply appear.
 */
export function rowEnter(row: Element): void {
  const reduced = isReducedMotion();
  const from: Keyframe = reduced
    ? { opacity: 0 }
    : { opacity: 0, transform: `translateY(${move('sm')}px)` };
  const to: Keyframe = reduced ? { opacity: 1 } : { opacity: 1, transform: 'none' };
  const motion = play(row, [from, to], {
    duration: 'base',
    easing: reduced ? 'standard' : 'out',
    crossfade: true,
  });
  motion?.addEventListener('finish', () => motion.cancel());
}

function lifted(t: number, y: number): string {
  return `opacity: ${t}; transform: translateY(${Math.round((1 - t) * y)}px)`;
}

/** Dialog entrance: it rises by --move-lg (8 px) while it fades in, nothing scales (180 ms,
 *  ease-out). */
export function dialogIn(node: Element): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move('lg');
  return { duration: duration('slow'), easing: easing('out'), css: (t) => lifted(t, y) };
}

/** Dialog exit: it sinks by --move-sm while it fades (100 ms, ease-in). */
export function dialogOut(node: Element): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move('sm');
  return { duration: duration('fast'), easing: easing('in'), css: (t) => lifted(t, y) };
}

/** The scrim behind a dialog follows the dialog's timing (`in:scrim out:scrim`: with
 *  `transition:` it gets no direction and would outlast its dialog). */
export function scrim(
  node: Element,
  _params: unknown,
  options: { direction: string },
): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const out = options.direction === 'out';
  return opacity(duration(out ? 'fast' : 'slow'), easing(out ? 'in' : 'out'));
}

export interface CollapseParams {
  /** Collapse at all: only a job that the user moves out of the list (archive, delete,
   *  restore); a row that a filter or a search hides is simply gone. */
  on: boolean;
}

/**
 * A job moved out of the list: its row folds away (150 ms, ease-in) while the rows below
 * close the gap, so nothing jumps. The one animation of a height in the app, and it is
 * one row's (rows are contained, the rest only moves). Instant under reduced motion.
 * `out:rowCollapse={{ on }}` on the row's wrapper in the list.
 */
export function rowCollapse(node: Element, { on }: CollapseParams): TransitionConfig {
  if (!on || isReducedMotion()) return {};
  const height = node.getBoundingClientRect().height;
  return {
    duration: duration('base'),
    easing: easing('in'),
    css: (t) => `overflow: hidden; height: ${Math.round(t * height)}px; opacity: ${t}`,
  };
}

/**
 * Something that comes and goes in the flow (a line under the list header, the minimum salary,
 * the mailbox form, a row of the profile): it unfolds to its height while it fades in (150 ms,
 * ease-out) and folds away the same way back, so what is below glides instead of jumping. A
 * cross-fade under reduced motion. `transition:unfold` on it. While it moves it carries
 * `data-unfolding` (afterUnfold, afterFolds): what scrolls to a part of it waits for its height.
 */
export function unfold(node: Element, params: MotionParams = {}): TransitionConfig {
  if (params.on === false) return {};
  if (isReducedMotion()) return crossfade(node);
  const height = node.getBoundingClientRect().height;
  node.setAttribute(UNFOLDING, '');
  const done = (): void => node.removeAttribute(UNFOLDING);
  node.addEventListener('introend', done, { once: true });
  node.addEventListener('outroend', done, { once: true });
  return {
    duration: duration('base'),
    easing: easing('out'),
    css: (t) => `overflow: hidden; height: ${Math.round(t * height)}px; opacity: ${t}`,
  };
}

const UNFOLDING = 'data-unfolding';

/**
 * Runs `then` once whatever unfolds around `node` has its height (`unfold`): a part scrolled
 * into view while its block is still a few pixels high stays out of view, and the scroll
 * shifts the clipped block's own content. Waits for the transitions of the current update to
 * start first.
 */
export function afterUnfold(node: Element, then: () => void): void {
  queueMicrotask(() => {
    const block = node.closest(`[${UNFOLDING}]`);
    if (block === null) then();
    else block.addEventListener('introend', () => afterUnfold(node, then), { once: true });
  });
}

/**
 * Runs `then` once nothing unfolds or folds away inside `pane` any more: while the height above
 * what shows changes the engine keeps the pane's place (scroll anchoring), and that would take
 * the pane from a glide. Waits for the transitions of the current update to start first.
 */
export function afterFolds(pane: Element, then: () => void): void {
  queueMicrotask(() => {
    const block = pane.querySelector(`[${UNFOLDING}]`);
    if (block === null) {
      then();
      return;
    }
    const ended = new AbortController();
    const next = (): void => {
      ended.abort();
      afterFolds(pane, then);
    };
    block.addEventListener('introend', next, { signal: ended.signal });
    block.addEventListener('outroend', next, { signal: ended.signal });
  });
}

/**
 * A button that comes or goes beside one that stays (a portal's alert call beside its sign-in):
 * it takes its room or gives it up, its gap included, in one glide (180 ms, ease-out) while it
 * fades, so the one that stays glides to its new place instead of jumping. With `on` false both
 * come or go together: it only fades and nothing moves. A cross-fade under reduced motion.
 */
export function foldAside(node: Element, params: MotionParams = {}): TransitionConfig {
  if (params.on === false || isReducedMotion()) return fade(node);
  const width = node.getBoundingClientRect().width;
  const row = node.parentElement;
  const gap = row === null ? 0 : Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  return {
    duration: duration('slow'),
    easing: easing('out'),
    css: (t, u) =>
      `overflow: hidden; width: ${Math.round(t * width)}px; margin-left: ${-Math.round(u * gap)}px; opacity: ${t}`,
  };
}

/** Where the job list's highlight stands: its top in the list and its height (px). */
export interface BarBox {
  top: number;
  height: number;
}

/** The toast comes up from below by --move-lg while it fades in, nothing scales (180 ms,
 *  ease-out; user, 2026-10-10). */
export function toastIn(node: Element): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move('lg');
  return {
    duration: duration('slow'),
    easing: easing('out'),
    css: (t, u) => `opacity: ${t}; transform: translateY(${Math.round(u * y)}px)`,
  };
}

/** The toast goes down by --move-sm the way it came while it fades (100 ms, ease-in). */
export function toastOut(node: Element): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move('sm');
  return {
    duration: duration('fast'),
    easing: easing('in'),
    css: (t, u) => `opacity: ${t}; transform: translateY(${Math.round(u * y)}px)`,
  };
}

/** A menu drops in by --move-sm (4 px) toward where it opened while it fades in (150 ms,
 *  ease-out): down below its button or pointer, up when it opened above. */
export function menuIn(node: Element, { up = false }: { up?: boolean } = {}): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  const y = move('sm') * (up ? 1 : -1);
  return {
    duration: duration('base'),
    easing: easing('out'),
    css: (t) => `opacity: ${t}; transform: translateY(${Math.round((1 - t) * y)}px)`,
  };
}

/** A menu leaves with a quick fade (60 ms), nothing moves. */
export function menuOut(_node: Element): TransitionConfig {
  return opacity(duration('instant'), easing('in'));
}

/** The tooltip fades in where it stands, nothing moves or scales (100 ms, ease-out; it comes
 *  after --delay-tooltip, lib/actions/tooltip.ts), and leaves with a 60 ms fade. */
export function tooltipIn(node: Element): TransitionConfig {
  if (isReducedMotion()) return crossfade(node);
  return opacity(duration('fast'), easing('out'));
}

export function tooltipOut(_node: Element): TransitionConfig {
  return opacity(duration('instant'), easing('in'));
}
