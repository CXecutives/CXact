<!--
  What every block of the Übersicht shares, so all look the same: a hairline above (not over
  the first block), the heading with its one action at the end, the content, and the block's
  own error at its end (next to what failed, never at the foot of the page). The content
  stands as it is, as rows apart by hairlines (`rows`: notes, open points), or as job rows
  like the list's, their ring on the edge of the column (`jobs`).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Notice from '$components/Notice.svelte';

  interface Props {
    testid: string;
    heading?: string | null;
    /** The first block: its heading line is the window's first row (base.css). */
    first?: boolean;
    list?: 'rows' | 'jobs' | null;
    error?: string | null;
    /** The heading's one action, at the end of its line. */
    action?: Snippet | null;
    /** A way on below the content (a link to all of it). */
    footer?: Snippet | null;
    children: Snippet;
  }

  let {
    testid,
    heading = null,
    first = false,
    list = null,
    error = null,
    action = null,
    footer = null,
    children,
  }: Props = $props();
</script>

<section class="block" data-testid={testid}>
  {#if heading}
    <div class="heading-line" class:first data-first-row={first ? '' : undefined}>
      <h2 class="heading">{heading}</h2>
      {#if action}<span class="heading-action">{@render action()}</span>{/if}
    </div>
  {/if}
  {#if list}
    <div class={list}>{@render children()}</div>
  {:else}
    {@render children()}
  {/if}
  {#if footer}<span class="footer">{@render footer()}</span>{/if}
  {#if error}
    <Notice tone="danger" variant="inline" text={error} testid="{testid}-error" />
  {/if}
</section>

<style>
  /* Sections in the rhythm of the reader's: 20 px above a hairline, 12 below a heading. */
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding-top: var(--space-20);
    border-top: var(--border-width) solid var(--border);
  }

  .block:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  /* A heading with its one action at the end; a small ghost action is centred on the
     heading's line, adds no height and ends on the column's edge (its padding hangs out). */
  .heading-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-12);
    margin-right: calc(-1 * var(--ghost-inset));
  }

  .heading-action {
    display: flex;
    margin-block: calc((var(--leading-lg) - var(--control-sm)) / 2);
  }

  /* The first line: heading and its filled button centred in the window's first row, the
     button's edge on the column's edge. */
  .heading-line.first {
    align-items: center;
    margin-right: 0;
  }

  .first .heading-action {
    margin-block: 0;
  }

  /* Rows apart by a hairline with room on both sides; the block's own gap and the next
     hairline frame the first and the last. */
  .rows {
    display: flex;
    flex-direction: column;
  }

  .rows > :global(*) {
    padding: var(--space-12) 0;
  }

  .rows > :global(:first-child) {
    padding-top: 0;
  }

  .rows > :global(:last-child) {
    padding-bottom: 0;
  }

  .rows > :global(* + *) {
    border-top: var(--border-width) solid var(--border);
  }

  /* Job rows like the list's: their ring on the edge of the column, every row one height;
     the last row's own line gives way to the hairline of the next block. */
  .jobs {
    --row-rule-inset: var(--pane-padding);

    display: flex;
    flex-direction: column;
    margin: 0 calc(-1 * var(--pane-padding));
    clip-path: inset(0 0 var(--border-width) 0);
  }

  .footer {
    display: flex;
  }
</style>
