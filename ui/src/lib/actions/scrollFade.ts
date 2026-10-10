// `use:scrollFade` - on a view that scrolls under the top bar: sets `--fade-shown` from 0 at
// rest to 1 once the content has scrolled the fade's height (--fade-height), so the fade
// comes in with the scroll and never lies over the first row at rest.

import type { Action } from 'svelte/action';
import { setVars } from './cssVars';

export const scrollFade: Action<HTMLElement> = (node) => {
  const height = parseFloat(getComputedStyle(node).getPropertyValue('--fade-height')) || 1;
  let shown = -1;
  const update = (): void => {
    const next = Math.round(Math.min(node.scrollTop / height, 1) * 100) / 100;
    if (next === shown) return;
    shown = next;
    setVars(node, { 'fade-shown': next });
  };
  update();
  node.addEventListener('scroll', update, { passive: true });
  return {
    destroy() {
      node.removeEventListener('scroll', update);
    },
  };
};
