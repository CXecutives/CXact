<!--
  The head of a view, one for the job list, Profil and Einstellungen. It scrolls with its view
  (design round 4: no sticky heads; the view's content goes under the top bar's fade). Its first
  row lies on the first row of the window (the sidebar's first entry is centred on it): the
  view's title (20/650 ink, on a row at least 30 high) or what leads instead of it (the list's
  search), and at its end the view's actions, centred on the first line. Below it the head may
  hold more (`children`: the list's filter's chips and the run's line). The head of a page
  (`column="page"`: Profil, Einstellungen) stands in the page's column (Page `head`), 2 in like
  the sections' titles, 22 above the first of them. The list's head stands above its own
  scroller.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    heading?: string | null;
    headingTestid?: string | null;
    /** What stands in the title's place (the list's search). */
    lead?: Snippet | null;
    /** The view's actions at the end of the first row. */
    actions?: Snippet | null;
    /** The column the content takes: the pages' (Profil, Einstellungen), or the full width (the
     *  list). */
    column?: 'page' | null;
    testid?: string | null;
    children?: Snippet;
  }

  let {
    heading = null,
    headingTestid = null,
    lead = null,
    actions = null,
    column = null,
    testid = null,
    children,
  }: Props = $props();
</script>

<header class="head" class:paged={column === 'page'} data-testid={testid ?? undefined}>
  <div class="inner" class:page={column === 'page'}>
    <div class="row">
      {#if heading !== null}
        <h1 class="title" data-testid={headingTestid ?? undefined}>
          {heading}
        </h1>
      {/if}
      {@render lead?.()}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
    {@render children?.()}
  </div>
</header>

<style>
  .head {
    flex: none;
    padding: var(--head-pad) var(--pane-padding-end) var(--head-pad) var(--pane-padding);
    container-type: inline-size;
  }

  /* A page's head: in the page's column (Page), 2 in like the sections' titles. */
  .paged {
    padding: 0 var(--section-inset);
  }

  .inner {
    display: flex;
    flex-direction: column;
    min-width: 0;
    margin: 0 auto;
  }

  .page {
    width: 100%;
  }

  /* The title (or what leads) and the actions on the first row; a title of two lines keeps
     the actions on its first line. A narrow head puts the actions under what leads. */
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-8) var(--space-12);
    min-height: var(--first-row);
  }

  .title {
    flex: 0 1 auto;
    min-width: 0;
    padding-block: calc((var(--first-row) - var(--leading-xl)) / 2);
    color: var(--text-heading);
    font: var(--type-xl);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
    outline: none;
  }

  .row > :global(:not(.title, .actions)) {
    align-self: center;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8);
    min-height: var(--first-row);
    margin-left: auto;
  }

  /* Actions that are all away (Archiv, Papierkorb) keep no room: the row runs to its edge. */
  .actions:not(:has(*)) {
    display: none;
  }

  /* On a page the button's edge is the box's under it; only a title stands 2 in. */
  .paged .actions {
    margin-right: calc(-1 * var(--section-inset));
  }
</style>
