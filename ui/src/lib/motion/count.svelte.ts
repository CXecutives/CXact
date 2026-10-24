// A number that counts up from 0 with a fill in step: the score ring's digits and its arc. One
// frame loop drives both over --dur-reveal (400 ms, ease-out), so the arc never runs ahead of
// its number. At most COUNT_LIMIT counts run at once (a list that scores many jobs live): the
// others stand at their value at once, as every count does under reduced motion.
//
//   const count = new Count(score);
//   count.run(score)    on the open of a job or a score that arrives on screen
//   count.place(score)  everywhere else
//   {count.value}       the digits;  use:cssVars={{ fill: count.progress }}  the arc
//   $effect(() => () => count.stop());

import { duration, easing, isReducedMotion } from './motion';

/** Counts that may run at the same time. */
const COUNT_LIMIT = 10;
let running = 0;

export class Count {
  /** The number to show, a whole number on its way to the target. */
  value = $state(0);
  /** How far the fill has come, 0 to 1 (eased): the arc shows the target times this. */
  progress = $state(1);
  #frame = 0;
  #counting = false;

  constructor(initial = 0) {
    this.value = Math.round(initial);
  }

  /** Counts from 0 to `target` with the fill from empty. False when it stands at `target` at
   *  once instead (reduced motion, COUNT_LIMIT counts under way). */
  run(target: number): boolean {
    this.stop();
    const length = duration('reveal');
    if (isReducedMotion() || length === 0 || running >= COUNT_LIMIT) {
      this.place(target);
      return false;
    }
    running += 1;
    this.#counting = true;
    this.value = 0;
    this.progress = 0;
    const ease = easing('out');
    let start: number | null = null;
    const step = (now: number): void => {
      start ??= now;
      const t = Math.min(1, (now - start) / length);
      const eased = ease(t);
      this.value = Math.round(target * eased);
      this.progress = eased;
      if (t < 1) this.#frame = requestAnimationFrame(step);
      else this.#end();
    };
    this.#frame = requestAnimationFrame(step);
    return true;
  }

  /** Stands at `target` at once, the fill complete. */
  place(target: number): void {
    this.stop();
    this.value = Math.round(target);
    this.progress = 1;
  }

  /** Stops a count where it is (call when the component goes). */
  stop(): void {
    cancelAnimationFrame(this.#frame);
    this.#end();
  }

  #end(): void {
    if (!this.#counting) return;
    this.#counting = false;
    running -= 1;
  }
}
