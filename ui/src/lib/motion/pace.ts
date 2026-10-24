// The pace of browsing: whether an open (a job, a list) may play its motion. Someone who walks
// through the jobs with the arrow keys sees each job at once: no ring that fills again, no
// cards that stagger, no selection that glides a long way. An open less than --delay-browse
// after the one before, or while a key is held (its keydown repeats), is fast browsing.
//
// Opens in one frame are one open: the job view and the list may both ask for the same change
// and get the same answer. Nothing here listens to the keyboard (input.ts does all input);
// input.ts reports each keydown with `noteKey`.

import { browseGap } from './motion';

export interface Pace {
  /** Records an open; true when it may animate. Every call in the same frame gets the answer
   *  of the first. */
  animateOpen(): boolean;
  /** Whether the user browses fast right now (records nothing): the answer of an open in this
   *  frame, else a key held or the last open less than the gap ago. */
  browsingFast(): boolean;
  /** A key went down; `repeat` (KeyboardEvent.repeat): it is held. */
  noteKey(repeat: boolean): void;
}

export interface PaceClock {
  /** Now in ms. */
  now?: () => number;
  /** The least time between two opens that both animate (ms). */
  gap?: () => number;
  /** Runs `callback` at the start of the next frame. */
  nextFrame?: (callback: () => void) => void;
}

/** A pace on its own clock (the app's runs on the page's; the harness checks one on a fake). */
export function createPace({
  now = () => performance.now(),
  gap = browseGap,
  nextFrame = (callback) => requestAnimationFrame(callback),
}: PaceClock = {}): Pace {
  let last = Number.NEGATIVE_INFINITY;
  let held = Number.NEGATIVE_INFINITY;
  /** The answer of the open in this frame (null: none yet). */
  let answer: boolean | null = null;
  const fast = (at: number): boolean => at - last < gap() || at - held < gap();
  return {
    animateOpen() {
      if (answer !== null) return answer;
      const at = now();
      answer = !fast(at);
      last = at;
      nextFrame(() => (answer = null));
      return answer;
    },
    browsingFast() {
      return answer === null ? fast(now()) : !answer;
    },
    noteKey(repeat) {
      held = repeat ? now() : Number.NEGATIVE_INFINITY;
    },
  };
}

const pace = createPace();

/** The job view and the list, when they open a job or a list: `if (animateOpen()) ...`. */
export function animateOpen(): boolean {
  return pace.animateOpen();
}

/** A glide or a refill that is no open of its own asks this (glide.ts). */
export function browsingFast(): boolean {
  return pace.browsingFast();
}

/** input.ts, on every keydown: `noteKey(event.repeat)`. */
export function noteKey(repeat: boolean): void {
  pace.noteKey(repeat);
}
