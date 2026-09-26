// `use:keepScroll={'profile'}` on a view's scroll area: where it was scrolled to is kept per
// view while the app runs, and a return to the view finds it there again (Profil and
// Einstellungen, App.svelte), like a native window keeps its panes. The place is noted on
// every scroll; on mount it comes back as soon as the content is tall enough for it (a view
// that loads its content grows after its first frame). A scroll by the user in the
// meantime wins.

import type { Action } from 'svelte/action';

const places = new Map<string, number>();

/** How long a returning view waits for its content to grow tall enough. */
const WAIT_FRAMES = 60;

export const keepScroll: Action<HTMLElement, string> = (node, key) => {
  let current = key;
  let restoring = true;
  let frame = 0;
  const target = places.get(current) ?? 0;

  const room = (): number => node.scrollHeight - node.clientHeight;
  const restore = (left: number): void => {
    if (!restoring) return;
    if (room() >= target || left === 0) {
      node.scrollTop = target;
      restoring = false;
      return;
    }
    frame = requestAnimationFrame(() => restore(left - 1));
  };
  const note = (): void => {
    // The view's own restore scrolls too; only a place that has been reached counts.
    if (restoring && Math.abs(node.scrollTop - target) > 1) {
      if (node.scrollTop === 0) return;
      restoring = false;
      cancelAnimationFrame(frame);
    }
    places.set(current, node.scrollTop);
  };

  if (target > 0) restore(WAIT_FRAMES);
  else restoring = false;
  node.addEventListener('scroll', note, { passive: true });

  return {
    update(next: string) {
      current = next;
    },
    destroy() {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', note);
    },
  };
};
