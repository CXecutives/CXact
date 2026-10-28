<!--
  A card of the job view (the round 10 draft): white, a hairline edge and the card's soft
  shadow, 14 round, 18 20 inside; cards that follow each other stand 12 apart. Its title is
  16/650 ink, a count beside it on the same baseline in the small subtle text (Anforderungen
  "4 von 6"). The `hero` card (the job's head) stands a step higher (--sh-raised).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The card's title (none: the hero, whose content leads). */
    heading?: string | null;
    /** Beside the title, quieter (a count). */
    count?: string | null;
    /** The job's head: a step higher than the cards under it. */
    hero?: boolean;
    testid?: string | null;
    headingTestid?: string | null;
    children: Snippet;
  }

  let {
    heading = null,
    count = null,
    hero = false,
    testid = null,
    headingTestid = null,
    children,
  }: Props = $props();
</script>

<section class="card" class:hero data-card data-testid={testid ?? undefined}>
  {#if heading !== null}
    <h2 class="title" data-testid={headingTestid ?? undefined}>
      {heading}{#if count !== null}<small class="count">{count}</small>{/if}
    </h2>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    position: relative;
    min-width: 0;
    padding: var(--card-pad-y) var(--card-pad-x);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-card);
    background-color: var(--surface);
    box-shadow: var(--sh-card);
  }

  :global([data-card]) + .card {
    margin-top: var(--card-gap);
  }

  .hero {
    box-shadow: var(--sh-raised);
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  .count {
    color: var(--text-subtle);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
    letter-spacing: 0;
  }
</style>
