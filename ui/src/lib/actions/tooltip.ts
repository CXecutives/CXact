// `use:tooltip={text}` - a styled tooltip after --delay-tooltip (400 ms) of hover, or of
// keyboard focus (`:focus-visible`: Tab lands on the control, never a click). Hides on
// leave, press and blur (the layer also hides it on a press anywhere, a scroll and Esc, and
// when the window resizes or goes to the back); moving on to the next anchor with the
// pointer shows it at once. An open menu silences what lies behind it, like a native one, and
// only an anchor in the menu itself speaks (the reason of an entry that is off). A button that
// takes the place of the one pressed under a pointer that rests shows none until the pointer
// moves (input/hold.ts `pointerMoved`).
// `{ text, truncated: true }` shows it only while the text of the node is cut off (a long
// row title, one line or clamped to two; `measure` names the element inside that holds the
// text): measured once when the pointer enters, never per frame, and again when the tooltip
// is due. `covered` adds a second reason: something lies over the end of the text (a row's
// tools over its title, which fades out under them), asked only when the tooltip is due.
// `{ text, hint }` adds a second, smaller line under the title, like the tooltips of native
// apps name a key: "Suchen" over "Strg+F". The hint rides on the anchor as
// `data-tooltip-hint`, where the tooltip layer (components/Tooltip.svelte) reads it.
// `{ text, toggle: true }` (the info symbol, components/InfoTip.svelte): a click shows the
// bubble at once and a second click hides it; a press does not hide it.

import type { Action } from 'svelte/action';
import { holdHover, pointerMoved } from '../input/hold';
import { tooltipDelay } from '../motion/motion';
import { menuState } from '../state/menu.svelte';
import { tooltipState } from '../state/tooltip.svelte';

export type TooltipParam =
  | string
  | null
  | undefined
  | {
      text: string | null | undefined;
      truncated?: boolean;
      /** With `truncated`: the element inside the anchor whose text may be cut (a CSS
       *  selector; the anchor itself without one). */
      measure?: string;
      /** With `truncated`: the end of the text lies under something else (asked when the
       *  tooltip is due, not when the pointer comes in). */
      covered?: () => boolean;
      /** A second, smaller line (a key, a hint). */
      hint?: string | null;
      /** A click shows and hides it (the info symbol). */
      toggle?: boolean;
    };

interface Options {
  text: string;
  truncated: boolean;
  measure: string | null;
  covered: (() => boolean) | null;
  hint: string | null;
  toggle: boolean;
}

/** The attribute that carries the second line to the tooltip layer. */
export const TOOLTIP_HINT = 'tooltipHint';

function normalize(param: TooltipParam): Options | null {
  if (param === null || param === undefined) return null;
  if (typeof param === 'string') {
    return param === ''
      ? null
      : {
          text: param,
          truncated: false,
          measure: null,
          covered: null,
          hint: null,
          toggle: false,
        };
  }
  if (!param.text) return null;
  return {
    text: param.text,
    truncated: param.truncated ?? false,
    measure: param.measure ?? null,
    covered: param.covered ?? null,
    hint: param.hint || null,
    toggle: param.toggle ?? false,
  };
}

export const tooltip: Action<HTMLElement, TooltipParam> = (node, param) => {
  let options = normalize(param);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The dismissals (a press, Esc) when the timer started: one since then drops the tooltip
   *  it waited to show. */
  let dismissals = 0;
  /** The pointer came in while it rests after a press: the tooltip waits for it to move. */
  let waiting = false;

  /** The text is cut off across (one line) or down (a clamped second line). */
  const isCut = ({ measure }: Options): boolean => {
    const box = (measure === null ? null : node.querySelector(measure)) ?? node;
    return box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight + 1;
  };
  /** There is something to say now: the anchor says its text always, a truncated one only
   *  while its text is cut off or covered. */
  const due = (now: Options): boolean => !now.truncated || isCut(now) || (now.covered?.() ?? false);
  const mark = (): void => {
    if (options?.hint) node.dataset[TOOLTIP_HINT] = options.hint;
    else delete node.dataset[TOOLTIP_HINT];
  };
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  /** An open menu silences every anchor behind it. */
  const silenced = (): boolean =>
    menuState.open !== null && node.closest('[data-menu-layer]') === null;
  const present = (): void => {
    if (options !== null && !silenced()) tooltipState.show(node, options.text);
  };
  /** The delay is over: shown unless a press or Esc came meanwhile or the text turned out
   *  to be whole. */
  const fire = (): void => {
    timer = undefined;
    if (options !== null && dismissals === tooltipState.dismissals && due(options)) present();
  };
  const wait = (): void => {
    dismissals = tooltipState.dismissals;
    timer = setTimeout(fire, tooltipDelay());
  };
  const enter = (event: PointerEvent): void => {
    cancel();
    if (options === null) return;
    // A button that slid under a pointer resting since a press: once the pointer moves.
    waiting = !pointerMoved(event);
    if (waiting) return;
    const ready = due(options);
    // A title that is whole may be covered once the pointer is on its row: look again then.
    if (!ready && options.covered === null) return;
    if (ready && tooltipState.warm) {
      present();
      return;
    }
    wait();
  };
  const move = (event: PointerEvent): void => {
    if (waiting) enter(event);
  };
  const leave = (): void => {
    cancel();
    waiting = false;
    tooltipState.hide(node);
  };
  /** A press hides the bubble, except on an anchor a click shows and hides. A click (the left
   *  button: it acts, and what it brings may slide a button under the pointer) holds the hover
   *  where it was pressed; a right or middle press only opens a menu or scrolls. */
  const press = (event: PointerEvent): void => {
    if (options?.toggle) return;
    if (event.button === 0) holdHover(event);
    leave();
  };
  const click = (): void => {
    if (!options?.toggle) return;
    cancel();
    if (tooltipState.anchor === node) tooltipState.hide(node);
    else present();
  };
  /** The keyboard brought the focus here (or into it: a wrapped control): the same delay
   *  as hovering, never at once (Tab through a row of buttons would flash every tooltip). */
  const focus = (event: FocusEvent): void => {
    cancel();
    const target = event.target;
    if (options === null || !(target instanceof Element) || !target.matches(':focus-visible')) {
      return;
    }
    if (!due(options)) return;
    wait();
  };
  const blur = (event: FocusEvent): void => {
    // The focus moves on inside the anchor (a wrapped control): nothing changes.
    if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
    cancel();
    // A focused control that goes with its view blurs while the page is being rebuilt, where
    // nothing may be written: the bubble goes right after.
    queueMicrotask(() => tooltipState.hide(node));
  };

  mark();
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointermove', move, { passive: true });
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointerdown', press);
  node.addEventListener('click', click);
  node.addEventListener('focusin', focus);
  node.addEventListener('focusout', blur);

  return {
    update(next: TooltipParam) {
      options = normalize(next);
      mark();
      if (options === null) leave();
      else tooltipState.update(node, options.text);
    },
    destroy() {
      leave();
      delete node.dataset[TOOLTIP_HINT];
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', press);
      node.removeEventListener('click', click);
      node.removeEventListener('focusin', focus);
      node.removeEventListener('focusout', blur);
    },
  };
};
