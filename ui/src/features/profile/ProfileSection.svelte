<!--
  One section of the profile form: the heading (H2, 17/600; a quiet "optional" after it for a
  block that only refines the match; with "Noch leer" when a thin
  profile leaves it empty: quiet for an optional block, amber only for the one block that is
  needed), at most one sentence 4 px under it, the fields in a card 12 px below. The first
  section of a Profil tab has no heading (the tab names it): its sentence stands alone.
-->
<script lang="ts">
  import Badge from '$components/Badge.svelte';
  import Card from '$components/Card.svelte';
  import { t } from '$lib/i18n/t';
  import type { Snippet } from 'svelte';

  interface Props {
    heading: string | null;
    hint?: string | null;
    /** Mark the section as empty (quality guidance for a thin profile). */
    empty?: boolean;
    /** The block the profile needs (the competences): its "Noch leer" is amber. */
    required?: boolean;
    /** Only refines the match: a quiet "optional" after the heading. */
    optional?: boolean;
    testid?: string | null;
    children: Snippet;
  }

  let {
    heading,
    hint = null,
    empty = false,
    required = false,
    optional = false,
    testid = null,
    children,
  }: Props = $props();
  const id = $props.id();
</script>

<section
  class="section"
  aria-labelledby={heading === null ? undefined : `${id}-heading`}
  data-testid={testid ?? undefined}
>
  {#if heading !== null}
    <div class="head">
      <h2 class="heading" id="{id}-heading">{heading}</h2>
      {#if optional}<span class="optional" data-testid="section-optional">{t.profile.optional}</span
        >{/if}
      {#if empty}<Badge label={t.profile.empty} tone={required ? 'warning' : 'neutral'} />{/if}
    </div>
  {/if}
  {#if hint}<p class="hint">{hint}</p>{/if}
  <Card padding="md">
    <div class="fields">{@render children()}</div>
  </Card>
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .optional {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* 4 px under the heading: it belongs to it, the card keeps the 12 px. */
  .head + .hint {
    margin-top: calc(-1 * var(--space-8));
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    container-type: inline-size;
  }
</style>
