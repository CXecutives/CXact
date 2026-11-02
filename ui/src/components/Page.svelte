<!--
  The frame of a page (Profil, Einstellungen, the setup's steps; the round 10 draft): the
  page's warm white ground (--page; the setup's cream with `ground="bg"`) at least as high as
  the view, its column (--page-max with --page-side, 16 in a narrow page, the scrollbar's room
  counted in them) centred in it, 8 under the top bar and 40 free at its end, like every scroll
  area. A head (`head`: the page's title, PageHeader) opens the column, 22 above the first
  section's title. The column is the container its parts ask for their width. While a file the
  page would take is over it (`over`: a CV on the Profil) a dashed edge stands inside the view.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    testid?: string | null;
    /** The ground: the page's warm white, or the cream of the setup. */
    ground?: 'page' | 'bg';
    /** A head at the top of the column (the page's title). */
    head?: Snippet | null;
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
</div>

<style>
  /* At least as high as the view: its ground fills it under a short page. */
  .page {
    container: page / inline-size;
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
    max-width: var(--page-column);
    margin: 0 auto;
    padding: var(--page-top-pad) var(--page-side-end) var(--page-bottom);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
    min-width: 0;
  }

  @container page (width < 560px) {
    .column {
      padding-inline: var(--page-side-narrow-end);
    }
  }

  /* The view's, not the page's: one whole frame wherever the page is scrolled to, clear of its
     head, over the fade under the top bar. */
  .over::after {
    position: absolute;
    z-index: var(--z-sticky);
    inset: var(--space-4);
    border: var(--drop-edge) dashed var(--drop-edge-hover);
    border-radius: var(--radius-lg);
    content: '';
    pointer-events: none;
  }
</style>
