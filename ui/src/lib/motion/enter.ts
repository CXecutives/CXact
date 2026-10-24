// Staggered entries: the rows of a list that opens, the cards of a new job, the groups of a
// page that opens. Each item rises by --move-lg (8 px) while it fades in (180 ms, ease-out),
// one step later than the item before it. Web Animations started explicitly, because main.ts
// mounts with `intro: false` and a Svelte transition would also play on every block that a
// list or a view builds again. So they play only where the caller says an open happened (the
// `on` flag; `animateOpen()` of pace.ts tells it), never on a re-render: the actions have no
// update, a changed parameter replays nothing.
//
// The caps (one rule for every kind): at most --stagger-max items step, the later ones come
// with the last of them, and the whole stagger (the last delay plus its piece) ends within
// --stagger-span. With the tokens: 10 rows (24 ms), 4 cards (60 ms), 8 groups (30 ms). Under
// reduced motion every item is simply there.
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
  type Move,
  type Stagger,
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

export interface EnterParams {
  /** The item's place in its stagger (0: the first, no delay). */
  index?: number;
  /** The step between two items (default the rows'). */
  step?: Stagger;
  /** How far it rises (default --move-lg). */
  distance?: Move;
  /** Play at all (false: it is simply there; the caller passes whether an open happened). */
  on?: boolean;
}

/**
 * Rise `node` into its place as item `index` of a stagger. Returns the animation (null:
 * nothing plays, it is simply there). It holds the item hidden during its delay and is
 * dropped once it ends.
 */
export function enter(node: Element, params: EnterParams = {}): Animation | null {
  if (params.on === false || isReducedMotion()) return null;
  const piece = duration('slow');
  const delay = staggerDelay(
    params.index ?? 0,
    stagger(params.step ?? 'row'),
    piece,
    staggerSpan(),
    staggerLimit(),
  );
  const y = move(params.distance ?? 'lg');
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

/** Where an item stands in its stagger, and whether it plays at all. */
export interface StaggerParams {
  index?: number;
  on?: boolean;
}

/** A row of a list that opens (24 ms apart, 8 px): `use:enterList={{ index, on: opened }}`. */
export const enterList: Action<Element, StaggerParams | undefined> = (node, params = {}) => {
  enter(node, { ...params, step: 'row' });
};

/** A card of a job that opens (60 ms apart, 8 px): `use:enterCards={{ index, on: opened }}`. */
export const enterCards: Action<Element, StaggerParams | undefined> = (node, params = {}) => {
  enter(node, { ...params, step: 'card' });
};

/** A group of a page that opens (30 ms apart, 8 px): `use:enterGroups={{ index, on: opened }}`. */
export const enterGroups: Action<Element, StaggerParams | undefined> = (node, params = {}) => {
  enter(node, { ...params, step: 'group' });
};
