<!--
  The body of Willkommen: what CXact does in three steps, one row each (the round 10 draft):
  a 36 tile on the track with its navy glyph (the profile, the search, the score), its title
  14/540 and one muted line.
-->
<script lang="ts">
  import type { IconName } from '$components/Icon.svelte';
  import IconTile from '$components/IconTile.svelte';
  import { t } from '$lib/i18n/t';

  /** The glyph of each step, in the order of the catalog's rows. */
  const ICONS: readonly IconName[] = ['profile', 'search', 'gauge'];
</script>

<ol class="intro" data-testid="first-intro">
  {#each t.firstRun.intro as row, index (row.title)}
    <li class="row">
      <IconTile tone="accent" size="md" icon={ICONS[index] ?? 'profile'} />
      <span class="words">
        <span class="title">{row.title}</span>
        <span class="text">{row.text}</span>
      </span>
    </li>
  {/each}
</ol>

<style>
  .intro {
    display: grid;
    gap: var(--setup-intro-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--setup-intro-inner);
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    color: var(--text);
    font: var(--type-label);
  }

  .text {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
