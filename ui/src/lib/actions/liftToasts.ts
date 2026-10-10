// `use:liftToasts={on}` - a bar that sticks to the window's bottom edge (the Profil's FloatBar,
// the setup's foot on its long steps): while it is there (`on`, default true), the toast stack
// rises above it by its height (`toasts.lift`), and drops back when it goes.

import type { Action } from 'svelte/action';
import { toasts } from '../state/toasts.svelte';

export const liftToasts: Action<HTMLElement, boolean | undefined> = (node, on = true) => {
  let active = on;
  const set = (): void => {
    toasts.lift = active ? node.offsetHeight : 0;
  };
  const observer = new ResizeObserver(set);
  observer.observe(node);
  set();
  return {
    update(next = true) {
      active = next;
      set();
    },
    destroy() {
      observer.disconnect();
      toasts.lift = 0;
    },
  };
};
