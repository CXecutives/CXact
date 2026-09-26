// `use:tooltip={text}` - a styled tooltip after --delay-tooltip (400 ms) of hover, or of
// keyboard focus (`:focus-visible`: Tab lands on the control, never a click). Hides on
// leave, press and blur (the layer also hides it when the window resizes or goes to the
// back); moving on to the next anchor with the pointer shows it at once.
// `{ text, truncated: true }` shows it only while the text of the node is cut off (a long
// row title, one line or clamped to two; `measure` names the element inside that holds the
// text): measured once when the pointer enters, never per frame.
// `{ text, hint }` adds a second, smaller line under the title, like the tooltips of native
// apps name a key: "Suchen" over "Strg+F". The hint rides on the anchor as
// `data-tooltip-hint`, where the tooltip layer (components/Tooltip.svelte) reads it.

import type { Action } from 'svelte/action';
import { tooltipDelay } from '../motion/motion';
import { tooltipState, type TooltipPlacement } from '../state/tooltip.svelte';

export type TooltipParam =
  | string
  | null
  | undefined
  | {
      text: string | null | undefined;
      placement?: TooltipPlacement;
      truncated?: boolean;
      /** With `truncated`: the element inside the anchor whose text may be cut (a CSS
       *  selector; the anchor itself without one). */
      measure?: string;
      /** A second, smaller line (a key, a hint). */
      hint?: string | null;
    };

interface Options {
  text: string;
  placement: TooltipPlacement;
  truncated: boolean;
  measure: string | null;
  hint: string | null;
}

/** The attribute that carries the second line to the tooltip layer. */
export const TOOLTIP_HINT = 'tooltipHint';

function normalize(param: TooltipParam): Options | null {
  if (param === null || param === undefined) return null;
  if (typeof param === 'string') {
    return param === ''
      ? null
      : { text: param, placement: 'bottom', truncated: false, measure: null, hint: null };
  }
  if (!param.text) return null;
  return {
    text: param.text,
    placement: param.placement ?? 'bottom',
    truncated: param.truncated ?? false,
    measure: param.measure ?? null,
    hint: param.hint || null,
  };
}

export const tooltip: Action<HTMLElement, TooltipParam> = (node, param) => {
  let options = normalize(param);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The text is cut off across (one line) or down (a clamped second line). */
  const isCut = ({ measure }: Options): boolean => {
    const box = (measure === null ? null : node.querySelector(measure)) ?? node;
    return box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight + 1;
  };
  const mark = (): void => {
    if (options?.hint) node.dataset[TOOLTIP_HINT] = options.hint;
    else delete node.dataset[TOOLTIP_HINT];
  };
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const show = (): void => {
    timer = undefined;
    if (options !== null) tooltipState.show(node, options.text, options.placement);
  };
  const enter = (): void => {
    cancel();
    if (options === null) return;
    if (options.truncated && !isCut(options)) return;
    if (tooltipState.warm) show();
    else timer = setTimeout(show, tooltipDelay());
  };
  const leave = (): void => {
    cancel();
    tooltipState.hide(node);
  };
  /** The keyboard brought the focus here (or into it: a wrapped control): the same delay
   *  as hovering, never at once (Tab through a row of buttons would flash every tooltip). */
  const focus = (event: FocusEvent): void => {
    cancel();
    const target = event.target;
    if (options === null || !(target instanceof Element) || !target.matches(':focus-visible')) {
      return;
    }
    if (options.truncated && !isCut(options)) return;
    timer = setTimeout(show, tooltipDelay());
  };
  const blur = (event: FocusEvent): void => {
    // The focus moves on inside the anchor (a wrapped control): nothing changes.
    if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
    leave();
  };

  mark();
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointerdown', leave);
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
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('pointerdown', leave);
      node.removeEventListener('focusin', focus);
      node.removeEventListener('focusout', blur);
    },
  };
};
