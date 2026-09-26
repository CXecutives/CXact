// Scrolling by the keys and by a jump inside a pane (PageUp/PageDown, Space, the arrows with
// the focus nowhere, Home/End, the jump to a passage of the ad): one short tween of
// --dur-slow with --ease-out, the same in both engines, instead of the engine's own smooth
// scroll (its length and curve differ per engine and cannot be set). Under reduced motion
// the pane jumps. Another key while a glide runs adds to where that glide was going, like
// the native smooth scroll; the wheel, the scrollbar or the middle button take over at once
// (the glide ends when the pane moved by something else).

import { duration, easing } from './motion';

interface Glide {
  /** Where the pane goes. */
  target: number;
  /** What the glide set last (anything else moved the pane: the glide ends). */
  set: number;
  frame: number;
}

const glides = new WeakMap<HTMLElement, Glide>();

/** The farthest the pane scrolls down. */
const maxTop = (pane: HTMLElement): number => Math.max(0, pane.scrollHeight - pane.clientHeight);

/** Stop a glide of `pane` where it is. */
export function stopGlide(pane: HTMLElement): void {
  const glide = glides.get(pane);
  if (glide === undefined) return;
  cancelAnimationFrame(glide.frame);
  glides.delete(pane);
}

/** Scroll `pane` to `top` (clamped to what it can scroll) in one short tween. */
export function glideTo(pane: HTMLElement, top: number): void {
  const to = Math.round(Math.min(maxTop(pane), Math.max(0, top)));
  stopGlide(pane);
  const ms = duration('slow');
  const from = pane.scrollTop;
  if (ms === 0 || to === Math.round(from)) {
    pane.scrollTop = to;
    return;
  }
  const ease = easing('out');
  const start = performance.now();
  const glide: Glide = { target: to, set: from, frame: 0 };
  const step = (now: number): void => {
    // The wheel, the scrollbar or the middle button moved the pane: they have it now.
    if (Math.abs(pane.scrollTop - glide.set) > 1) {
      glides.delete(pane);
      return;
    }
    const progress = Math.min(1, (now - start) / ms);
    pane.scrollTop = from + (to - from) * ease(progress);
    glide.set = pane.scrollTop;
    if (progress < 1) glide.frame = requestAnimationFrame(step);
    else glides.delete(pane);
  };
  glides.set(pane, glide);
  glide.frame = requestAnimationFrame(step);
}

/** Scroll `pane` by `delta` from where it is going (a running glide) or where it is. */
export function glideBy(pane: HTMLElement, delta: number): void {
  const base = glides.get(pane)?.target ?? pane.scrollTop;
  glideTo(pane, base + delta);
}

/** The nearest scroll area of `node` that scrolls down (null: none). */
function scrollerOf(node: Element): HTMLElement | null {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (/auto|scroll/.test(overflow) && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

/**
 * Bring `node` into view in its scroll area in one short tween: `center` puts it in the
 * middle (a passage the user jumps to), `nearest` scrolls only as far as needed. The pane's
 * scroll-padding (a sticky band) counts like the engine's scrollIntoView counts it.
 */
export function glideIntoView(node: Element, block: 'center' | 'nearest' = 'nearest'): void {
  const pane = scrollerOf(node);
  if (pane === null) return;
  const style = getComputedStyle(pane);
  const padTop = Number.parseFloat(style.scrollPaddingTop) || 0;
  const padBottom = Number.parseFloat(style.scrollPaddingBottom) || 0;
  const view = pane.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const top = view.top + pane.clientTop + padTop;
  const bottom = view.top + pane.clientTop + pane.clientHeight - padBottom;
  let delta = 0;
  if (block === 'center') {
    delta = box.top + box.height / 2 - (top + bottom) / 2;
  } else if (box.top < top) {
    delta = box.top - top;
  } else if (box.bottom > bottom) {
    delta = Math.min(box.bottom - bottom, box.top - top);
  }
  if (delta !== 0) glideTo(pane, pane.scrollTop + delta);
}
