<!--
  The Übersicht: the first look in the morning, a place of its own in the sidebar where the
  app starts. Its blocks stand in the one order of blocks.ts, each only with content: the
  Eingang (Abrufen and the counts that lead into the list), what to look at today, the
  favourites, the comparison prompt, the open points, the requirements the profile lacks,
  the market and the files. A click on a job opens it in Jobs.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { BLOCKS } from './blocks';
  import { overview } from './model.svelte';

  // The counts come with the list: it loads as soon as the app state is there, also when the
  // app starts here and not in Jobs.
  $effect(() => {
    if (app.state !== null && jobs.status === 'idle') void jobs.start();
  });

  // Its own queries again whenever the counts, the profile or the portals' switches move.
  $effect(() => {
    void jobs.overviewCounts;
    void app.hasProfile;
    void app.state?.profile?.savedAt;
    void app.state?.portals;
    untrack(() => overview.refresh());
  });
</script>

<div class="page" data-testid="overview">
  <div class="overview" data-testid="day-overview" aria-label={t.overview.label}>
    {#each BLOCKS as block (block.id)}
      {#if block.visible()}
        <block.component />
      {/if}
    {/each}
  </div>
</div>

<style>
  .page {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--pane-padding) var(--pane-padding) var(--space-64);
  }

  /* The blocks one below the other; each brings its hairline and its room (Block). */
  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
    container-type: inline-size;
  }
</style>
