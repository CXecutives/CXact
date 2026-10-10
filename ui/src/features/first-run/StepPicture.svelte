<!--
  The picture of the app beside a step of the setup (design round 7): built from the app's own
  parts (the score ring, the glyphs and the chips of a field) with the catalog's example data,
  so it looks like CXact and changes with it. Its entries slide in one after the other
  (pictures.ts STAGGER_MS) and the rings fill once; then it stands still. It is only a
  picture: no pointer, no focus, hidden from screen readers.
  - jobs: four example jobs with their rings, company, place and pay;
  - profile: a profile as the CV fills it, roles, competences and languages coming in;
  - mail: an alert mail, and under it the two jobs it brings, scored.
-->
<script lang="ts">
  import Icon from '$components/Icon.svelte';
  import ScoreRing from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import type { Band } from '$lib/ipc/types';
  import { rise } from '$lib/motion/transitions';
  import { JOB_SCORES, MAIL_SCORES, STAGGER_MS, type PictureId } from './pictures';

  interface Props {
    id: PictureId;
  }

  let { id }: Props = $props();

  const words = $derived(t.firstRun.picture);
  const field = $derived(t.profile.field);
</script>

{#snippet job(
  item: { title: string; company: string; place: string; pay: string },
  scored: { score: number; band: Band },
  index: number,
  set: string,
)}
  <div class="row" in:rise={{ delay: index * STAGGER_MS }}>
    <ScoreRing
      ring={{ status: 'scored', score: scored.score, band: scored.band }}
      animate="picture-{set}-{index}"
    />
    <div class="lines">
      <span class="title">{item.title}</span>
      <span class="meta">
        <span class="part"><Icon name="company" size="xs" />{item.company}</span>
        <span class="part"><Icon name="place" size="xs" />{item.place}</span>
        {#if item.pay}<span class="part">{item.pay}</span>{/if}
      </span>
    </div>
  </div>
{/snippet}

{#snippet chips(label: string, values: readonly string[], from: number)}
  <div class="group">
    <span class="label" in:rise={{ delay: from * STAGGER_MS }}>{label}</span>
    <span class="chips">
      {#each values as value, index (value)}
        <span class="chip" in:rise={{ delay: (from + index + 1) * STAGGER_MS }}>{value}</span>
      {/each}
    </span>
  </div>
{/snippet}

<div class="picture" aria-hidden="true" inert data-testid="setup-picture" data-picture={id}>
  {#if id === 'jobs'}
    <div class="card">
      {#each words.jobs as item, index (item.title)}
        {@render job(item, JOB_SCORES[index]!, index, 'jobs')}
      {/each}
    </div>
  {:else if id === 'profile'}
    <div class="card padded">
      {@render chips(field.roles, words.roles, 0)}
      {@render chips(field.competences, words.competences, 3)}
      {@render chips(field.languages, words.languages, 9)}
    </div>
  {:else}
    <div class="stack">
      <div class="card padded mail" in:rise>
        <Icon name="alertMail" size="md" />
        <div class="lines">
          <span class="title">{words.mailSubject}</span>
          <span class="meta">{words.mailFrom}</span>
        </div>
      </div>
      <span class="arrow"><Icon name="arrowDown" size="sm" /></span>
      <div class="card">
        {#each words.mailJobs as item, index (item.title)}
          {@render job(item, MAIL_SCORES[index]!, index + 2, 'mail')}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .picture {
    display: flex;
    width: 100%;
    max-width: var(--setup-picture-card);
    pointer-events: none;
  }

  .stack {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
  }

  .card {
    display: flex;
    flex: 1;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-xl);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
  }

  /* In the stack each card keeps its own height. */
  .stack .card {
    flex: none;
  }

  .padded {
    gap: var(--space-16);
    padding: var(--space-16);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--list-row-pad) var(--space-16);
    border-bottom: var(--border-width) solid var(--border);
  }

  .row:last-child {
    border-bottom: 0;
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .title {
    color: var(--text);
    font: var(--type-title);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-10);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  .part :global(.icon) {
    color: var(--text-subtle);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .label {
    color: var(--text);
    font: var(--type-label);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    min-height: var(--control-sm);
    padding: 0 var(--space-8);
    border-radius: var(--radius-inner);
    background-color: var(--chip-surface);
    color: var(--chip-text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .mail {
    flex-direction: row;
    align-items: center;
    gap: var(--space-12);
  }

  .mail > :global(.icon) {
    color: var(--text-subtle);
  }

  .arrow {
    display: inline-flex;
    color: var(--text-subtle);
  }
</style>
