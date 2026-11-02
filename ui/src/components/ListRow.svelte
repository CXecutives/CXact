<!--
  A row of the job list (the round 10 draft): leading and content on one line, 9 10 inside,
  12 apart, at least 48 high, 8 round. Hover washes the row (80 ms in, 150 ms out), a press
  darkens it (60 ms); rows never move or scale. The chosen row has no fill of its own: the
  list's one highlight lies under it (RowBar), so it takes no wash either. The list draws the
  hairlines between its rows. While the list scrolls and behind an open menu rows take no hover: a
  row rests (`data-rests`), and the rows the pointer passes meanwhile carry `data-still`
  (input.ts) until it is over, so only those rows restyle. Every row is a button and a Tab
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
    gap: var(--list-row-gap);
    width: 100%;
    min-height: var(--list-row-min);
    padding: var(--list-row-pad) var(--list-row-pad-x);
    border-radius: var(--list-row-radius);
    background-color: transparent;
    text-align: left;
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .row:not(.selected):hover:where(:not([data-still])) {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .row:not(.selected):active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  .leading {
    display: flex;
    flex: none;
  }

  .content {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
  }
</style>
