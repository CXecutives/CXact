<!--
  A group of a page (Profil, Einstellungen; the round 10 draft): its title 16/650 ink, 2 in
  from its box's edge, on a line at least as high as a quiet button, 10 above its content: one
  white box (Group), or several, each under its own caption and 14 below the box before it
  (Jobportale). The title's line holds only the title, and the page's action where the page
  puts one there (it hangs out of the line evenly, so every line keeps its height). Sections
  stand --group-section-gap (30) apart: the page's list of them sets it.
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
    gap: var(--group-heading-gap);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-height: var(--section-head-min);
    margin-inline: var(--section-inset);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  /* A control higher than the line hangs out of it evenly above and below. */
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    height: var(--section-head-min);
    margin-left: auto;
  }

  /* Several boxes of one group, each under its caption. */
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--group-caption-top);
    min-width: 0;
  }
</style>
