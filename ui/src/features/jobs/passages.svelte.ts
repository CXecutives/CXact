// The ad's passages under the pointer (the reader's one hover state): hovering a row of the
// Jobdetails or a requirement whose passages the ad shows (`data-item` on the row) tints them
// in the ad text (AdText.svelte), leaving it takes the tint away, a click scrolls the first
// passage into view and flashes it once. Nothing stays pinned. While the reader scrolls (the
// wheel, a jump that glides, content moving under a still pointer) no row takes the tint: a
// scroll clears it, and only a pointer that moves again once the reader rests lights a row,
// so nothing flickers.

import type { Action } from 'svelte/action';
import { scrollArea } from '$lib/actions/inView';
import { crossfadeDuration, duration } from '$lib/motion/motion';
import { glideIntoView } from '$lib/motion/scroll';

/** How long the reader rests after its last scroll before a hover counts again. */
const REST_MS = 150;

/** The row (`data-item`) an event happened in, or null. */
function rowOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-item]') : null;
}

/** Whether the node can be seen whole in its scroll area. */
function visible(node: Element): boolean {
  const area = scrollArea(node);
  const box = node.getBoundingClientRect();
  const view = area?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
  return box.top >= view.top && box.bottom <= view.bottom;
}

export class Passages {
  /** The item whose passages are tinted (the row under the pointer). */
  hovered = $state<string | null>(null);
  /** The item whose passages flash once (after a click on its row). */
  flashing = $state<string | null>(null);
  #flash: ReturnType<typeof setTimeout> | undefined;

  /** `use:passages.watch` on the reader: its pointer, its clicks and its scroll area. */
  readonly watch: Action<HTMLElement> = (node) => {
    let scrolling = false;
    let rest: ReturnType<typeof setTimeout> | undefined;
    let last = { x: Number.NaN, y: Number.NaN };
    let pane: Element | null = null;

    const move = (event: PointerEvent): void => {
      // The engine's own move after a scroll stands where the last one stood: only a
      // pointer that moves counts.
      if (event.clientX === last.x && event.clientY === last.y) return;
      last = { x: event.clientX, y: event.clientY };
      const next = scrolling ? null : (rowOf(event.target)?.dataset.item ?? null);
      if (next !== this.hovered) this.hovered = next;
    };
    const leave = (): void => {
      this.hovered = null;
    };
    const click = (event: MouseEvent): void => {
      const row = rowOf(event.target);
      const item = row?.dataset.item;
      if (event.button !== 0 || row === null || item === undefined) return;
      // A control in the row does its own thing; a click that ends a selection only selects.
      if (event.target instanceof Element && event.target.closest('button, a') !== null) return;
      const selection = getSelection();
      if (selection !== null && !selection.isCollapsed && row.contains(selection.anchorNode)) {
        return;
      }
      this.jump(node, item);
    };
    const scrolled = (): void => {
      scrolling = true;
      this.hovered = null;
      clearTimeout(rest);
      rest = setTimeout(() => (scrolling = false), REST_MS);
    };
    // The scroll area once the frame that shows the reader is drawn (its styles are ready).
    const frame = requestAnimationFrame(() => {
      pane = scrollArea(node);
      pane?.addEventListener('scroll', scrolled, { passive: true });
    });
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('click', click);
    return {
      destroy: () => {
        cancelAnimationFrame(frame);
        clearTimeout(rest);
        clearTimeout(this.#flash);
        pane?.removeEventListener('scroll', scrolled);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerleave', leave);
        node.removeEventListener('click', click);
      },
    };
  };

  /** The first passage of `item` into view (a short glide where it is not in view), then it
   *  flashes once. */
  jump(root: Element, item: string): void {
    const mark = root.querySelector(`mark[data-items~="${CSS.escape(item)}"]`);
    if (mark === null) return;
    const away = !visible(mark);
    if (away) glideIntoView(mark, 'center');
    clearTimeout(this.#flash);
    this.flashing = null;
    this.#flash = setTimeout(
      () => {
        this.flashing = item;
        this.#flash = setTimeout(
          () => (this.flashing = null),
          duration('reveal') || crossfadeDuration(),
        );
      },
      away ? duration('slow') : 0,
    );
  }
}
