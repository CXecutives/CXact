// The staggered entry of a list of another place: its first rows rise by --move-lg (8 px)
// while they fade in (180 ms, ease-out), each one --stagger-row later than the row before it.
// Web Animations started explicitly, because main.ts mounts with `intro: false` and a Svelte
// transition would also play on every block that a list builds again. So they play only
// where the caller says an open happened (the `on` flag; `animateOpen()` of pace.ts tells
// it), never on a re-render or a view switch: the action has no update, a changed parameter
// replays nothing.
//
// The caps: at most --stagger-max rows step, the later ones come with the last of them, and
// the whole stagger (the last delay plus its piece) ends within --stagger-span: 10 rows,
// 24 ms apart. Under reduced motion every row is simply there.
//
// For elements without a transform of their own (the animation sets it while it runs).

import type { Action } from 'svelte/action';
import {
  duration,
  isReducedMotion,
  move,
  play,
  stagger,
  staggerLimit,
  staggerSpan,
} from './motion';

/**
 * The delay (ms) of item `index` in a stagger of `step` ms whose pieces last `piece` ms: one
 * step per item for the first `max` items, the later ones with the last of them, and never so
 * late that the whole stagger outlasts `span`. Pure (the harness checks the caps on it).
 */
export function staggerDelay(
  index: number,
  step: number,
  piece: number,
  span: number,
  max: number,
): number {
  if (step <= 0) return 0;
  const steps = Math.max(0, Math.min(max - 1, Math.floor((span - piece) / step)));
  return Math.min(Math.max(0, Math.floor(index)), steps) * step;
}

/** Where a row stands in its stagger, and whether it plays at all. */
export interface StaggerParams {
  /** The row's place in its stagger (0: the first, no delay). */
  index?: number;
  /** Play at all (false: it is simply there; the caller passes whether an open happened). */
  on?: boolean;
}

/**
 * Rise `node` into its place as row `index` of a stagger. Returns the animation (null:
 * nothing plays, it is simply there). It holds the row hidden during its delay and is dropped
 * once it ends.
 */
function enter(node: Element, params: StaggerParams = {}): Animation | null {
  if (params.on === false || isReducedMotion()) return null;
  const piece = duration('slow');
  const delay = staggerDelay(params.index ?? 0, stagger(), piece, staggerSpan(), staggerLimit());
  const y = move('lg');
  const motion = play(
    node,
    [
      { opacity: 0, transform: `translateY(${y}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 'slow', easing: 'out', delay },
  );
  motion?.addEventListener('finish', () => motion.cancel());
  return motion;
}

/** A row of a list of another place: `use:enterList={{ index, on: opened }}`. */
export const enterList: Action<Element, StaggerParams | undefined> = (node, params = {}) => {
  enter(node, params);
};

/**
 * A step of the setup comes in: it fades in while sliding by --move-lg from the side it was
 * reached from (Weiter: from the right; Zurück: from the left), 150 ms, ease-out; a
 * cross-fade under reduced motion. `forward` null: no step change happened (the first step
 * of the setup is simply there). An action, not a Svelte transition: the card's content
 * comes with a block further out than its own (the setup's `{#key step}`), where a local
 * transition never plays.
 */
export const enterStep: Action<Element, { forward: boolean | null }> = (node, { forward }) => {
  if (forward === null) return;
  const x = move('lg') * (forward ? 1 : -1);
  const motion = play(
    node,
    [
      { opacity: 0, transform: `translateX(${x}px)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 'base', easing: 'out', crossfade: true },
  );
  motion?.addEventListener('finish', () => motion.cancel());
};
