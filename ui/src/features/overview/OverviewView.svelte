<!--
  The Übersicht: the first look in the morning, a place of its own in the sidebar where the
  app starts. It sums up what is new since the last fetch, what fits best, what needs a
  decision and what is open, and leads into the Jobs view (a click opens the job there).
-->
<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import DayOverview from '../jobs/DayOverview.svelte';

  // The counts come with the list: it loads as soon as the app state is there, also when the
  // app starts here and not in Jobs.
  $effect(() => {
    if (app.state !== null && jobs.status === 'idle') void jobs.start();
  });
</script>

<div class="page" data-testid="overview">
  <DayOverview />
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
</style>
