<!--
  The handle between two columns (the sidebar and the view, the job list and the job view):
  it takes no room of its own, an invisible 8 px strip centred on the columns' border catches
  the pointer below the top bar (the bar keeps moving the window). Under the pointer and
  while it is dragged a 2 px line shows over the border, the whole height; the col-resize
  cursor says that it moves. No grip and no tooltip (tooltips only where needed, user
  2026-09-29); no keyboard: the columns are not a document to navigate.
  Drag it with the left button to resize the column before it between `min` and `max`; a
  double click sets the width back to the first width. For the list the limits follow the
  window and the sidebar (`splitLimits`): the list keeps at least --list-min and at most
  --list-max, the job view at least --reader-min; its first width is --list-first. The width
  is kept per user (`storageKey`, in this browser profile; a store that cannot be read or
  written simply keeps the first width), and a kept width that does not fit is shown at the
  limit and comes back once there is room again.
-->
<script lang="ts" module>
  import { tokenPx } from '$lib/tokens';

  /** The limits of a list column beside a reader in a content of `width` px. */
  export interface SplitLimits {
    min: number;
    max: number;
    /** The first width (and the one a double click brings back). */
    initial: number;
  }

  /** The list keeps --list-min and at most --list-max, and leaves the job view --reader-min;
   *  it starts at --list-first (within those). */
  export function splitLimits(width: number): SplitLimits {
    const min = tokenPx('--list-min');
    const max = Math.max(min, Math.min(tokenPx('--list-max'), width - tokenPx('--reader-min')));
    return { min, max, initial: Math.max(min, Math.min(max, tokenPx('--list-first'))) };
  }

  /**
   * The limits of the one limit set that never shrinks while the window grows: `own` (the
   * content now) capped by `edge` (the content at the next wider layout's narrowest window:
   * the docked sidebar at the fold's breakpoint). Without the cap the list would be wider
   * just below the breakpoint, where the folded sidebar leaves more content, than just above
   * it.
   */
  export function cappedLimits(own: SplitLimits, edge: SplitLimits): SplitLimits {
    const max = Math.max(own.min, Math.min(own.max, edge.max));
    return {
      min: own.min,
      max,
      initial: Math.max(own.min, Math.min(own.initial, edge.initial, max)),
    };
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    /** The width of the column before the handle, in px (set by the handle). */
    size?: number | undefined;
    /** The width a double click restores (and the first width). */
    initial?: number;
    min?: number;
    max?: number;
    /** Where the width is kept (null: not kept). */
    storageKey?: string | null;
    /** What it resizes (accessible name). */
    label?: string;
    testid?: string | null;
  }

  let {
    size = $bindable(),
    initial = tokenPx('--list-first'),
    min = tokenPx('--list-min'),
    max = tokenPx('--list-max'),
    storageKey = null,
    label,
    testid = null,
  }: Props = $props();

  const clamp = (value: number): number => Math.round(Math.max(min, Math.min(max, value)));

  function stored(): number | null {
    if (storageKey === null) return null;
    try {
      const value = Number(localStorage.getItem(storageKey));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  function keep(value: number | null): void {
    if (storageKey === null) return;
    try {
      if (value === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(value));
    } catch {
      // Without a store the width lasts for this session only.
      return;
    }
  }

  /** The width the user chose (null: the first width); shown within the live limits. */
  let chosen = $state<number | null>(untrack(() => stored() ?? size ?? null));

  // The first frame already has the width; afterwards it follows the limits and the choice.
  size = untrack(() => clamp(chosen ?? initial));
  $effect.pre(() => {
    const width = clamp(chosen ?? initial);
    if (width !== untrack(() => size)) size = width;
  });

  let dragging = $state(false);
  let from = { x: 0, width: 0 };
  let frame = 0;
  let next: number | null = null;

  function start(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    from = { x: event.clientX, width: size ?? clamp(initial) };
    next = null;
    dragging = true;
  }

  /** At most one resize per frame, however fast the pointer moves. */
  function move(event: PointerEvent): void {
    if (!dragging) return;
    next = clamp(from.width + event.clientX - from.x);
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (next !== null) chosen = next;
    });
  }

  function end(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (next === null) return;
    chosen = next;
    next = null;
    keep(chosen);
  }

  /** The second click of a double click sets the width back. */
  function reset(event: MouseEvent): void {
    if (event.button !== 0 || event.detail !== 2) return;
    chosen = null;
    next = null;
    keep(null);
  }
</script>

<div
  class="splitter"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label={label ?? t.splitter.label}
  aria-valuenow={size}
  aria-valuemin={min}
  aria-valuemax={max}
  data-testid={testid ?? undefined}
>
  <!-- The strip the pointer takes; not in the Tab order (no keyboard). -->
  <button
    type="button"
    class="hit"
    tabindex="-1"
    aria-hidden="true"
    onpointerdown={start}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
    onclick={reset}
  ></button>
</div>

<style>
  /* No room of its own: the strip lies centred on the border between the columns. */
  .splitter {
    position: relative;
    z-index: var(--z-raised);
    flex: none;
    width: 0;
  }

  .hit {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(-1 * var(--splitter-hit) / 2);
    width: var(--splitter-hit);
    cursor: col-resize;
    touch-action: none;
  }

  /* The line: 2 px over the 1 px border in the middle of the strip, the whole height. */
  .hit::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--splitter-hit) / 2 - var(--border-width));
    width: var(--splitter-line);
    background-color: var(--border-strong);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-standard);
  }

  .hit:hover::after,
  .dragging .hit::after {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }
</style>
