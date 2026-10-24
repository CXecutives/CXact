// One glide for what marks a choice: the selection of a list (its tint and bar), the pill of
// the sidebar, the thumb of a segment. The marker is one element out of the flow; it stands
// on the element it marks and glides to the next one (180 ms, ease-out), and fades in or out
// (140 ms) when it appears or hides. Its style holds where it stands, through custom
// properties the action sets (cssVars): the component's CSS places it with them, insets
// included:
//
//   .marker {
//     position: absolute; top: 0; left: 0;
//     width: var(--glide-width); height: var(--glide-height);
//     opacity: var(--glide-opacity, 0);
//     transform: translate(var(--glide-x), var(--glide-y));
//   }
//
// The move is a transform that adds the way still to go to that place and runs to nothing
// (composite add, on the compositor), so whatever moves the rows or the options meanwhile
// moves the marker along at once. Only when the two boxes differ in size does a second
// animation take the marker's drawn size to its new one (the box of an element out of the
// flow; a scale would deform its corners).
//
// It jumps instead of gliding: the first time (the component mounts, the first frame), when
// the target or the marker is out of sight in its scroll area, while the user browses fast
// (pace.ts), when the caller says so (`jump`: another list), and under reduced motion. A
// target that is hidden (no box) is placed once it shows, without motion.

import type { Action } from 'svelte/action';
import { px, setVars, type CssVars } from '../actions/cssVars';
import { isReducedMotion, play } from './motion';
import { browsingFast } from './pace';
import { scrollerOf } from './scroll';

export interface GlideParams {
  /** The element it marks (null: hidden). */
  to: HTMLElement | null;
  /** Placed without motion this time (another list, a far jump the caller knows of). */
  jump?: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const same = (a: Box, b: Box): boolean =>
  px(a.x) === px(b.x) &&
  px(a.y) === px(b.y) &&
  px(a.width) === px(b.width) &&
  px(a.height) === px(b.height);

/** Whether `rect` shows at all in the visible part of its scroll area (or of the window). */
function inSight(rect: DOMRect, area: HTMLElement | null): boolean {
  const view = area?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  return (
    rect.bottom > view.top &&
    rect.top < view.bottom &&
    rect.right > view.left &&
    rect.left < view.right
  );
}

/** `use:glide={{ to: chosen }}` on the marker; see the head of this file for its CSS. */
export const glide: Action<HTMLElement, GlideParams> = (node, initial) => {
  let target: HTMLElement | null = null;
  /** Where its style puts it. */
  let placed: Box | null = null;
  let shown = false;
  let vars: CssVars = {};
  /** The glide under way, the way it adds at its start, and its change of size. */
  let move: {
    animation: Animation;
    delta: { x: number; y: number };
    size: Animation | null;
  } | null = null;
  let fade: Animation | null = null;
  /** Placed without motion until the first frame is drawn (and while the target had no
   *  box). */
  let ready = false;
  let pending = false;
  const frame = requestAnimationFrame(() => (ready = true));

  /** The box of `item` in the marker's containing block (layout boxes: a row that moves by a
   *  transform counts where it ends up). Null while either has no box. */
  function boxOf(item: HTMLElement): Box | null {
    const base = node.offsetParent;
    if (base === null || item.offsetParent === null) return null;
    const offset = (from: Element | null): { x: number; y: number; hit: boolean } => {
      let x = 0;
      let y = 0;
      for (let at = from; at instanceof HTMLElement; at = at.offsetParent) {
        if (at === base) return { x, y, hit: true };
        x += at.offsetLeft;
        y += at.offsetTop;
      }
      return { x, y, hit: false };
    };
    const own = offset(item);
    // Not inside the containing block: both from the page.
    const shift = own.hit ? { x: 0, y: 0 } : offset(base);
    return {
      x: own.x - shift.x,
      y: own.y - shift.y,
      width: item.offsetWidth,
      height: item.offsetHeight,
    };
  }

  function running(): boolean {
    return move !== null && move.animation.playState === 'running';
  }

  /** Where it is seen now: on its way while it glides (its size is read where it is drawn). */
  function current(): Box | null {
    if (placed === null || move === null || !running()) return placed;
    const progress = move.animation.effect?.getComputedTiming().progress ?? 1;
    const left = 1 - progress;
    const { delta } = move;
    return { ...placed, x: placed.x + delta.x * left, y: placed.y + delta.y * left };
  }

  function write(): void {
    if (placed === null) return;
    const next: CssVars = {
      'glide-x': px(placed.x),
      'glide-y': px(placed.y),
      'glide-width': px(placed.width),
      'glide-height': px(placed.height),
      'glide-opacity': shown ? 1 : 0,
    };
    setVars(node, next, vars);
    vars = next;
  }

  function stop(): void {
    move?.animation.cancel();
    move?.size?.cancel();
    move = null;
  }

  function slide(from: Box, to: Box): void {
    const sized =
      px(from.width) !== px(to.width) ||
      px(from.height) !== px(to.height) ||
      move?.size?.playState === 'running';
    // The marker's size as drawn now (on its way while it changes), insets included.
    const drawn = sized ? { width: node.offsetWidth, height: node.offsetHeight } : null;
    stop();
    placed = to;
    write();
    const delta = { x: from.x - to.x, y: from.y - to.y };
    const animation = play(
      node,
      [{ transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: 'none' }],
      { duration: 'slow', easing: 'out', composite: 'add' },
    );
    if (animation === null) return;
    let size: Animation | null = null;
    if (drawn !== null) {
      const box = (width: number, height: number): Keyframe => ({
        width: px(width),
        height: px(height),
      });
      size = play(
        node,
        [box(drawn.width, drawn.height), box(node.offsetWidth, node.offsetHeight)],
        {
          duration: 'slow',
          easing: 'out',
        },
      );
    }
    const glided = { animation, delta, size };
    animation.addEventListener('finish', () => {
      if (move === glided) stop();
    });
    move = glided;
  }

  function show(next: boolean, smooth: boolean): void {
    if (shown === next) return;
    shown = next;
    fade?.cancel();
    fade = null;
    write();
    if (!smooth) return;
    const animation = play(node, [{ opacity: next ? 0 : 1 }, { opacity: next ? 1 : 0 }], {
      duration: 'fade',
      easing: next ? 'out' : 'in',
    });
    animation?.addEventListener('finish', () => animation.cancel());
    fade = animation;
  }

  /** May this change move (glide or fade)? */
  function smooth(jump: boolean): boolean {
    return ready && !pending && !jump && !isReducedMotion() && !browsingFast();
  }

  function observe(next: HTMLElement | null): void {
    if (next === target) return;
    if (target !== null) observer.unobserve(target);
    if (next !== null) observer.observe(next);
    target = next;
  }

  function update({ to, jump = false }: GlideParams): void {
    const changed = to !== target;
    observe(to);
    if (to === null) {
      stop();
      show(false, changed && smooth(jump));
      return;
    }
    // Its element is gone (a row that folded away): it waits where it was.
    if (!to.isConnected) return;
    const box = boxOf(to);
    if (box === null) {
      pending = true;
      return;
    }
    const was = current();
    const area = changed && shown && was !== null && smooth(jump) ? scrollerOf(to) : undefined;
    if (
      was !== null &&
      area !== undefined &&
      inSight(to.getBoundingClientRect(), area) &&
      inSight(node.getBoundingClientRect(), area)
    ) {
      slide(was, box);
    } else if (placed === null || !same(box, placed) || changed) {
      // Its own target moved or changed size (the layout around it): along at once; a glide
      // under way adds its way still to go to the new place.
      if (changed) stop();
      placed = box;
      write();
    }
    show(true, changed && !shown && smooth(jump));
    pending = false;
  }

  const observer = new ResizeObserver(() => update({ to: target }));
  if (node.parentElement !== null) observer.observe(node.parentElement);
  update(initial);

  return {
    update,
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stop();
      fade?.cancel();
    },
  };
};
