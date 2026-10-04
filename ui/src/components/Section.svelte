<!--
  A section of a page (Profil, Einstellungen): its heading alone on its line, the page's
  actions at its end where the page puts them there (Profil's "Aus Lebenslauf ausfüllen" on
  the first one), then its content in a white rounded group on the cream page, like the
  settings of macOS and Windows; the heading small and muted above it ("Native Gruppen", user
  decision 2026-10-04). `plain` leaves the group out (a section of several groups draws its own, Jobportale). Its
  rows bring their own padding and hairlines (SettingRow, PortalRow), its fields their own
  gaps (the Profil's).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** None: a group without a heading (under the one before). */
    heading?: string | null;
    /** The id of the section (its heading's is `{id}-heading`). */
    id: string;
    /** Its name in the page's table (`data-section`). */
    name: string;
    /** The page's actions at the end of the heading's line. */
    actions?: Snippet | null;
    /** No group around the content (the section draws its own groups). */
    plain?: boolean;
    testid?: string | null;
    children: Snippet;
  }

  let {
    heading = null,
    id,
    name,
    actions = null,
    plain = false,
    testid = null,
    children,
  }: Props = $props();
</script>

<section
  class="section"
  {id}
  aria-labelledby={heading !== null ? `${id}-heading` : undefined}
  data-section={name}
  data-testid={testid ?? undefined}
>
  {#if heading !== null || actions}
    <div class="head">
      {#if heading !== null}<h2 class="heading" id="{id}-heading">{heading}</h2>{/if}
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
  {/if}
  <div class="body" class:plain>{@render children()}</div>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--section-head-gap);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: var(--control-field);
    padding-inline: var(--layout-heading-inset);
  }

  .actions {
    display: flex;
    align-items: center;
    margin-left: auto;
  }

  /* The rows one under the other (each brings its padding and hairline), in the group; rows bleed to the group's edges (--row-inset). */
  .body {
    --row-inset: var(--layout-group-pad);

    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--layout-group-pad-block) var(--layout-group-pad);
    border-radius: var(--layout-group-radius);
    background-color: var(--layout-group);
    box-shadow: inset 0 0 0 var(--border-width) var(--layout-group-edge);
  }

  .body.plain {
    --row-inset: 0;

    padding: 0;
    background-color: transparent;
    box-shadow: none;
  }

  .heading {
    color: var(--layout-heading-color);
    font: var(--layout-heading-font);
    letter-spacing: var(--tracking-tight);
  }
</style>
