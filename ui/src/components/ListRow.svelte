<!--
  A list row: leading and content (mail style: two lines of content, one row height), the
  one inner padding of the columns on the sides. A hairline under each row; a list whose rows
  reach past its column (for the wash) insets the line with `--row-rule-inset`, so it is as
  wide as every other hairline there. Hover washes the row (80 ms in, 150 ms out), a press
  darkens it (60 ms); rows never move or scale. The selected row takes a very light warm
  wash (one step deeper under the pointer, one more while pressed); the job list marks it
  with its one bar that slides from row to row (RowBar). While the window is inactive the
  selection turns grey, as in Mail and Explorer. While the list
  scrolls rows take no hover: a row rests (`data-rests`), and the rows the pointer passes
  during a scroll carry `data-still` (input.ts) until it is over, so only those rows
  restyle. A mark on :root or a property that inherits (pointer-events) would restyle every
  row twice per scroll, a long task with a few hundred rows. Every row is a button and a Tab
  stop; focus draws no ring (user decision 2026-10-04).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { doubleClick } from '$lib/input/input';

  interface Props {
    selected?: boolean;
    /** The click. */
    onclick?: ((event: MouseEvent) => void) | null;
    /** A double click on the row itself (a job row opens its ad); one on a control laid
     *  over the row (its tools) is that control's. */
    ondouble?: (() => void) | null;
    testid?: string | null;
    leading?: Snippet | null;
    children: Snippet;
  }

  let {
    selected = false,
    onclick = null,
    ondouble = null,
    testid = null,
    leading = null,
    children,
  }: Props = $props();
</script>

<button
  type="button"
  class="row"
  class:selected
  aria-current={selected ? 'true' : undefined}
  data-rests=""
  data-testid={testid ?? undefined}
  onclick={(event) => onclick?.(event)}
  use:doubleClick={ondouble}
>
  {#if leading}<span class="leading">{@render leading()}</span>{/if}
  <span class="content">{@render children()}</span>
</button>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-10);
    width: 100%;
    min-height: var(--row-height);
    overflow: hidden;
    padding: var(--list-row-pad) var(--pane-padding);
    background-color: transparent;
    text-align: left;
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .row:hover:where(:not([data-still])) {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .row:active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  /* The ring keeps its own track on the warm wash: the open row's ring stays hollow. */
  .selected {
    background-color: var(--surface-selected);
  }

  .selected:hover:where(:not([data-still])) {
    background-color: var(--surface-selected-hover);
  }

  /* Pressed, the warm wash deepens one more step (the grey press never covers it). */
  :global(:where(:root:not([data-aux-press]))) .selected:active:hover {
    background-color: var(--surface-selected-press);
    transition-duration: var(--dur-instant);
  }

  /* The hairline under the row (inset where the list says so). */
  .row::after {
    position: absolute;
    right: var(--row-rule-inset, 0);
    bottom: 0;
    left: var(--row-rule-inset, 0);
    height: var(--border-width);
    background-color: var(--border);
    content: '';
  }

  /* Like Mail and Explorer: the selection greys out while the window is in the back. */
  :global(:root[data-window='inactive']) .selected {
    background-color: var(--surface-selected-inactive);
  }

  .leading {
    display: flex;
    flex: none;
  }

  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
</style>
