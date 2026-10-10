<!--
  The frame of a page (Profil, Einstellungen, every step of the setup): the
  white page (--layout-page) at least as high as the view, its column (--page-width) centred in it, its first
  heading's line on the window's first row (--page-top) and the room of the page's end under
  the column (--page-end). The column is the container its rows ask for their width (a
  narrow window puts a row's buttons on a line of their own). A head above the column (`head`:
  the page's title, design round 7) takes the first row instead; a bar at the page's foot
  (`foot`: the Profil's floating bar) takes the page's end. While a file the page would take
  is over it (`over`: a CV on the Profil) a dashed edge stands inside the view.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    testid?: string | null;
    /** A head above the column, in the first row. */
    head?: Snippet | null;
    /** A bar at the page's foot, after the column. */
    foot?: Snippet | null;
    /** A file the page would take is over it. */
    over?: boolean;
    /** The page's element (a page that finds its rows in it). */
    element?: HTMLElement | null;
    children: Snippet;
  }

  let {
    testid = null,
    head = null,
    foot = null,
    over = false,
    element = $bindable(null),
    children,
  }: Props = $props();
</script>

<div
  class="page"
  class:over
  class:headed={head !== null}
  class:footed={foot !== null}
  data-testid={testid ?? undefined}
  bind:this={element}
>
  {#if head}{@render head()}{/if}
  <div class="column">{@render children()}</div>
  {#if foot}{@render foot()}{/if}
</div>

<style>
  /* At least as high as the view, so a bar at the foot stands there under a short page. */
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background-color: var(--layout-page);
  }

  .column {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    width: 100%;
    max-width: calc(var(--page-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--page-top) var(--pane-padding) var(--page-end);
  }

  .headed .column {
    padding-top: var(--space-8);
  }

  .footed .column {
    padding-bottom: 0;
  }

  .over {
    border-radius: var(--radius-lg);
    outline: var(--drop-edge) dashed var(--border-strong);
    outline-offset: calc(-1 * var(--space-8));
  }
</style>
