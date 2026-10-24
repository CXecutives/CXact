<!--
  The head of a view, one for the job list, the job view, Profil and Einstellungen. It scrolls
  with its view (design round 4: no sticky heads; the view's content goes under the top bar's
  fade). Its first row lies on the first row of the window (the sidebar's first entry is
  centred on it): the view's title (20/650 ink, on a row at least 30 high; a job's title may
  take two lines and is text to copy) or what leads instead of it (the list's place tabs), and
  at its end the view's actions, centred on the first line. Below it the head may hold more
  (`children`: the list's search, its filter's chips and the run's line). The head of a page
  (`column="page"`: Profil, Einstellungen) stands in the page's column (Page `head`), 2 in like
  the sections' titles, 22 above the first of them; the job view's takes its column, centred
  in the full width. The list's head stands above its own scroller and draws a hairline under
  it once the list scrolled (`line`).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    heading?: string | null;
    /** The heading is text a user would copy (a job's title). */
    copy?: boolean;
    headingTestid?: string | null;
    /** What stands in the title's place (the list's places). */
    lead?: Snippet | null;
    /** The view's actions at the end of the first row. */
    actions?: Snippet | null;
    /** The column the content takes: the pages' (Profil, Einstellungen), the job view's, or
     *  the full width (the list). */
    column?: 'page' | 'reader' | null;
    /** A hairline under it (the list's head, once the list scrolled beneath it). */
    line?: boolean;
    testid?: string | null;
    children?: Snippet;
  }

  let {
    heading = null,
    copy = false,
    headingTestid = null,
    lead = null,
    actions = null,
    column = null,
    line = false,
    testid = null,
    children,
  }: Props = $props();
</script>

<header class="head" class:paged={column === 'page'} class:line data-testid={testid ?? undefined}>
  <div class="inner {column ?? ''}">
    <div class="row">
      {#if heading !== null}
        <h1
          class="title"
          data-copy={copy ? '' : undefined}
          data-testid={headingTestid ?? undefined}
        >
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
    padding: var(--head-pad) var(--pane-padding);
    border-bottom: var(--border-width) solid transparent;
    container-type: inline-size;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }

  /* A page's head: in the page's column (Page), 2 in like the sections' titles. */
  .paged {
    padding: 0 var(--section-inset);
    border-bottom: 0;
  }

  .line {
    border-bottom-color: var(--border);
  }

  .inner {
    display: flex;
    flex-direction: column;
    min-width: 0;
    margin: 0 auto;
  }

  .inner.page {
    width: 100%;
  }

  .inner.reader {
    max-width: var(--reader-width);
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
</style>
