// `use:fit={{ key, onfit }}` on a line of items (the facts of a list row): the items show in
// their order while they fit whole, the rest step out (`data-out`: out of the flow, unseen,
// still measured). The line shares its parent with siblings that keep their width (a badge
// right after the facts): it gets the room they leave. Measured, never guessed: one shared
// ResizeObserver watches each line's parent and items (a narrower list, the font arriving, a
// value that changes) and measures after layout, all lines first, then all writes. `key`
// names what the line shows (another value or badge measures again); `onfit` hears how many
// items stepped out.

import type { Action } from 'svelte/action';

export interface FitParam {
  /** What the line shows (its items and its siblings): a change measures again. */
  key: string;
  /** How many items stepped out (0: every item fits). */
  onfit?: (out: number) => void;
}

interface Line {
  node: HTMLElement;
  onfit: ((out: number) => void) | undefined;
  out: number;
  watched: Set<Element>;
}

/** The line each watched element belongs to. */
const lines = new WeakMap<Element, Line>();
let observer: ResizeObserver | null = null;

const gap = (node: Element): number => parseFloat(getComputedStyle(node).columnGap) || 0;
const width = (node: Element): number => node.getBoundingClientRect().width;

/** Reads the room and the items of a line; returns the writes. */
function measure(line: Line): () => void {
  const { node } = line;
  const parent = node.parentElement;
  if (!node.isConnected || parent === null) return () => undefined;
  const siblings = [...parent.children].filter((child) => child !== node);
  // The parent has no padding (a row's foot): its box is the room.
  let room = width(parent);
  for (const sibling of siblings) room -= width(sibling) + gap(parent);
  const items = [...node.children];
  const between = gap(node);
  let used = 0;
  let shown = 0;
  for (const item of items) {
    const next = used + (shown > 0 ? between : 0) + width(item);
    // Sub-pixel widths: a fact that fits to a hundredth of a pixel fits.
    if (next > room + 0.01) break;
    used = next;
    shown += 1;
  }
  return () => {
    items.forEach((item, index) => item.toggleAttribute('data-out', index >= shown));
    const out = items.length - shown;
    if (out !== line.out) {
      line.out = out;
      line.onfit?.(out);
    }
  };
}

function watcher(): ResizeObserver {
  observer ??= new ResizeObserver((entries) => {
    const due = new Set<Line>();
    for (const entry of entries) {
      const line = lines.get(entry.target);
      if (line !== undefined) due.add(line);
    }
    const writes = [...due].map(measure);
    for (const write of writes) write();
  });
  return observer;
}

/** Watches the line's parent, its siblings and its items (each new one measures at once).
 *  Never the line itself: its width follows the items shown, and a size this observer
 *  changes would be reported again in the same frame. */
function watch(line: Line): void {
  const { node } = line;
  const parent = node.parentElement;
  const siblings = parent === null ? [] : [...parent.children].filter((child) => child !== node);
  const now = new Set<Element>([
    ...(parent === null ? [] : [parent]),
    ...siblings,
    ...node.children,
  ]);
  for (const element of line.watched) {
    if (!now.has(element)) {
      watcher().unobserve(element);
      lines.delete(element);
    }
  }
  for (const element of now) {
    lines.set(element, line);
    // Observing again reports the element again: the line measures after this layout.
    watcher().observe(element);
  }
  line.watched = now;
}

export const fit: Action<HTMLElement, FitParam> = (node, param) => {
  // -1: the first measure always reports (the listener may hold a count of an earlier line).
  const line: Line = { node, onfit: param.onfit, out: -1, watched: new Set() };
  watch(line);
  return {
    update(next: FitParam) {
      line.onfit = next.onfit;
      watch(line);
    },
    destroy() {
      for (const element of line.watched) {
        watcher().unobserve(element);
        if (lines.get(element) === line) lines.delete(element);
      }
      line.watched.clear();
    },
  };
};
