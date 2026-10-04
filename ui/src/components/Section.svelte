<!--
  A section of a page (Profil, Einstellungen): its heading (12.5 semibold, navy) above a card
  that holds its rows, 8 px apart. The rows bring their own padding and hairlines; the card's
  `padding` says how (`rows`: they run edge to edge and pad their content by the card's
  inset; `none`: the content does that itself).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Card, { type CardPadding } from './Card.svelte';

  interface Props {
    heading: string;
    /** The id of the section (its heading's is `{id}-heading`). */
    id: string;
    /** Its name in the page's table (`data-section`). */
    name: string;
    padding?: CardPadding;
    testid?: string | null;
    cardTestid?: string | null;
    children: Snippet;
  }

  let {
    heading,
    id,
    name,
    padding = 'rows',
    testid = null,
    cardTestid = null,
    children,
  }: Props = $props();
</script>

<section
  class="section"
  {id}
  aria-labelledby="{id}-heading"
  data-section={name}
  data-testid={testid ?? undefined}
>
  <h2 class="heading" id="{id}-heading">{heading}</h2>
  <Card {padding} testid={cardTestid}>{@render children()}</Card>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }
</style>
