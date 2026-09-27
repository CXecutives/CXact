<!--
  The first block, "Eingang": Abrufen at the end of its heading (Abbrechen in its place while
  a run goes, same width), the counts of the inbox as tiles that open exactly what they
  count (lead.ts), and under them what went wrong with the last fetch or a start, with its
  way on. The time of the last fetch is said once, in the sidebar.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import StatTile from '$components/StatTile.svelte';
  import { t } from '$lib/i18n/t';
  import { fade } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toHigh, toNew } from '../lead';
  import { overview } from '../model.svelte';
  import Block from './Block.svelte';

  const counts = $derived(overview.counts);
</script>

{#snippet fetchButton(live: boolean)}
  <Button
    size="field"
    variant={app.hasMailbox && app.hasPortal ? 'primary' : 'secondary'}
    icon="fetch"
    label={t.toolbar.fetch}
    disabled={run.fetchBlocked !== null}
    disabledReason={run.fetchBlocked}
    wide
    testid={live ? 'overview-fetch' : null}
    onclick={() => void run.start({ kind: 'fetch' })}
  />
{/snippet}

{#snippet cancelButton(live: boolean)}
  <Button
    size="field"
    variant="secondary"
    icon="cancel"
    label={t.toolbar.cancel}
    loading={live && run.cancelling}
    wide
    testid={live ? 'overview-cancel' : null}
    onclick={() => void run.cancel()}
  />
{/snippet}

{#snippet fetchAction()}
  <!-- The other button stands invisible in the same cell and only keeps the width. -->
  <span class="action">
    {#if run.fetching}
      <span class="live" in:fade>{@render cancelButton(true)}</span>
      <span class="spare" aria-hidden="true" inert>{@render fetchButton(false)}</span>
    {:else}
      <span class="live" in:fade>{@render fetchButton(true)}</span>
      <span class="spare" aria-hidden="true" inert>{@render cancelButton(false)}</span>
    {/if}
  </span>
{/snippet}

<Block testid="since" heading={t.overview.since} first action={fetchAction}>
  {#if counts !== null}
    <div class="tiles">
      <StatTile
        label={t.overview.tileNew}
        value={counts.unread}
        tone="coral"
        testid="tile-new"
        onclick={toNew}
      />
      {#if app.hasProfile}
        <StatTile
          label={t.overview.tileHigh}
          value={counts.high}
          tone="success"
          testid="tile-high"
          onclick={toHigh}
        />
      {/if}
    </div>
  {/if}
  {#if overview.failure}
    <Notice
      tone="danger"
      variant="row"
      heading={overview.failure.heading}
      text={overview.failure.text}
      action={overview.failure.action}
      testid="run-failed"
    />
  {/if}
</Block>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));
    gap: var(--space-12);
  }

  /* Both buttons in one cell: the cell is as wide as the wider one. */
  .action {
    display: grid;
    flex: none;
  }

  .live,
  .spare {
    display: flex;
    grid-area: 1 / 1;
  }

  .spare {
    visibility: hidden;
  }
</style>
