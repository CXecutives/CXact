<!--
  The frame of a page (Profil, Einstellungen, the setup's steps; the round 10 draft): the
  page's warm white ground (--page; the setup's cream with `ground="bg"`) at least as high as
  the view, its column (--page-max with --page-side, 16 in a narrow page) centred in it, 8
  under the top bar and with room at its end for the bar at the foot. A head (`head`: the
  page's title, PageHeader) opens the column, 22 above the first section's title. A bar at
  the page's foot (`foot`: BottomBar) stays docked at the view's bottom edge. The column is
  the container its parts ask for their width. While a file the page would take is over it
  (`over`: a CV on the Profil) a dashed edge stands inside the view.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    testid?: string | null;
    /** The ground: the page's warm white, or the cream of the setup. */
    ground?: 'page' | 'bg';
    /** A head at the top of the column (the page's title). */
    head?: Snippet | null;
    /** A bar at the page's foot, after the column (BottomBar). */
    foot?: Snippet | null;
    /** A file the page would take is over it. */
    over?: boolean;
    /** The page's element (a page that finds its rows in it). */
    element?: HTMLElement | null;
    children: Snippet;
  }

  let {
    testid = null,
    ground = 'page',
    head = null,
    foot = null,
    over = false,
    element = $bindable(null),
    children,
  }: Props = $props();
</script>

<div
  class="page"
  class:cream={ground === 'bg'}
  class:over
  data-testid={testid ?? undefined}
  bind:this={element}
>
  <div class="column">
    {#if head}{@render head()}{/if}
    <div class="content">{@render children()}</div>
  </div>
  {#if foot}{@render foot()}{/if}
</div>

<style>
  /* At least as high as the view, so a bar at the foot stands there under a short page. */
  .page {
    container: page / inline-size;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background-color: var(--page);
  }

  .cream {
    background-color: var(--bg);
  }

  .column {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--page-head-gap);
    width: 100%;
    max-width: var(--page-max);
    margin: 0 auto;
    padding: var(--page-top-pad) var(--page-side) var(--page-bottom);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    min-width: 0;
  }

  @container page (width < 560px) {
    .column {
      padding-inline: var(--page-side-narrow);
    }
  }

  .over {
    border-radius: var(--radius-lg);
    outline: var(--drop-edge) dashed var(--border-strong);
    outline-offset: calc(-1 * var(--space-8));
  }
</style>
