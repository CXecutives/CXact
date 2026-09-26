<!--
  The requirements the profile lacks most often: each with how often, added at once (the
  toast offers the undo).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import { addToProfile, isAdded } from '../../jobs/addToProfile';
  import { overview } from '../model.svelte';
  import Block from './Block.svelte';
</script>

<Block testid="open-musts" heading={t.overview.openMusts} list="rows">
  {#each overview.openMusts as must (must.label)}
    <div class="must" data-testid="open-must">
      <span class="must-text"
        ><span class="must-label" data-copy>{must.label}</span>
        <span class="quiet">{t.overview.inJobs(must.count)}</span></span
      >
      {#if isAdded(must.label)}
        <span class="quiet" data-testid="added-must">{t.reader.added}</span>
      {:else}
        <Button
          variant="secondary"
          size="sm"
          icon="add"
          label={t.overview.addToProfile}
          testid="add-must"
          onclick={() => addToProfile(must.label)}
        />
      {/if}
    </div>
  {/each}
</Block>

<style>
  /* An open must: its words and how often, the action at the end of the row. */
  .must {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .must-text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
  }

  .must-label {
    font: var(--type-md);
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
