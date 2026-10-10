<!--
  A group of a page (Profil, Einstellungen; "Luftige Gruppen", design round 6): its heading
  in navy (--type-heading) flush with the left edge of its box, 8 above it
  (--layout-heading-gap), then its content: one white box (Group), or several, each under its
  own caption and 16 apart (Jobportale). The heading's line holds only the heading, and the
  page's action where the page puts one there (Profil's "Aus Lebenslauf ausfüllen" on its
  first group): it hangs out of the line above and below, so every heading's line is as high
  as its text and the gap to the box stays 8. Groups are --layout-section-gap apart (the
  page's list of them).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    heading: string;
    /** The id of the section (its heading's is `{id}-heading`). */
    id: string;
    /** Its name in the page's table (`data-section`). */
    name: string;
    /** The page's action at the end of the heading's line. */
    actions?: Snippet | null;
    testid?: string | null;
    /** Its box or boxes (Group). */
    children: Snippet;
  }

  let { heading, id, name, actions = null, testid = null, children }: Props = $props();
</script>

<section
  class="section"
  {id}
  aria-labelledby="{id}-heading"
  data-section={name}
  data-testid={testid ?? undefined}
>
  <div class="head">
    <h2 class="heading" id="{id}-heading">{heading}</h2>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  <div class="groups">{@render children()}</div>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--layout-heading-gap);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  /* A control is higher than the heading's text: it hangs out evenly above and below. */
  .actions {
    display: flex;
    align-items: center;
    height: var(--leading-heading);
    margin-left: auto;
  }

  /* Several boxes of one group, each under its caption. */
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    min-width: 0;
  }
</style>
