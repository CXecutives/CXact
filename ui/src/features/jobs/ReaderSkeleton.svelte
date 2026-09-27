<!--
  The reader while a job's details load (JobsView shows it once loading takes a while): the
  reader's shape in placeholders, so the pane never stands blank and nothing jumps when the
  job comes. The title, the ring beside its band, the row of actions, a few rows of the
  Jobdetails (name and value in their columns) and lines of text under the section "Anzeige",
  in the reader's own spacing.
-->
<script lang="ts" module>
  /** The widths (percent of their column) of the placeholders: Jobdetails rows as name and
   *  value, then the lines of the ad's text. */
  const ROWS = [
    [60, 70],
    [45, 40],
    [70, 55],
    [55, 35],
    [50, 60],
  ] as const;
  const LINES = [96, 88, 92, 60, 84, 72] as const;
  /** The four buttons of the action row. */
  const ACTIONS = [1, 2, 3, 4] as const;
</script>

<script lang="ts">
  import Skeleton from '$components/Skeleton.svelte';
</script>

<div class="reader" data-testid="reader-skeleton">
  <div class="title" data-testid="skeleton-title"><Skeleton width={70} /></div>
  <div class="match">
    <Skeleton shape="circle" size="md" />
    <span class="band"><Skeleton width={100} /></span>
  </div>
  <div class="actions">
    {#each ACTIONS as action (action)}<span class="action"><Skeleton /></span>{/each}
  </div>
  <div class="block">
    <span class="heading"><Skeleton width={100} /></span>
    <div class="rows">
      {#each ROWS as [name, value], index (index)}
        <div class="row" data-testid="skeleton-row">
          <Skeleton width={name} /><Skeleton width={value} />
        </div>
      {/each}
    </div>
  </div>
  <div class="block">
    <span class="heading"><Skeleton width={100} /></span>
    <div class="text">
      {#each LINES as width, index (index)}
        <span class="line" data-testid="skeleton-line"><Skeleton {width} /></span>
      {/each}
    </div>
  </div>
</div>

<style>
  /* The reader's column and spacing (Reader.svelte). */
  .reader {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
  }

  .title {
    display: flex;
    align-items: center;
    height: var(--leading-2xl);
  }

  .match {
    display: flex;
    align-items: center;
    gap: var(--space-16);
  }

  .band {
    width: calc(var(--ring-md) * 3);
  }

  .actions {
    display: flex;
    gap: var(--space-8);
  }

  .action {
    display: flex;
    align-items: center;
    width: calc(var(--control-field) * 4);
    height: var(--control-field);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding-top: var(--space-20);
    border-top: var(--border-width) solid var(--border);
  }

  .heading {
    display: flex;
    align-items: center;
    width: calc(var(--control-field) * 3);
    height: var(--leading-lg);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  /* Name and value in the Jobdetails' two columns. */
  .row {
    display: grid;
    grid-template-columns: 1fr 2fr;
    align-items: center;
    gap: var(--space-24);
    height: var(--leading-md);
  }

  /* The ad's text: a line per line of the text. */
  .text {
    display: flex;
    flex-direction: column;
  }

  .line {
    display: flex;
    align-items: center;
    height: var(--leading-body);
  }
</style>
