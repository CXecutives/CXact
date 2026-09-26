<!--
  The files of the work folder: the report (written with the Excel file by every export;
  opening it writes it first, except in the dry run and while a run holds the files), the
  Excel file and the folder. A file that is not there yet cannot be opened and says why.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import type { OpenTarget } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { run } from '$lib/state/run.svelte';
  import { openTarget } from '../model.svelte';
  import Block from './Block.svelte';

  let error = $state<string | null>(null);
  const dryRun = $derived(app.state?.dryRun ?? false);
  const noFiles = $derived(app.state !== null && !app.state.settings.excelExists);
  const dryRunReason = $derived(t.error.text('dryRun', {}));

  function open(target: OpenTarget): void {
    error = null;
    void openTarget(target).then((next) => (error = next));
  }
</script>

<Block testid="files" heading={t.overview.files} {error}>
  <div class="files" data-testid="overview-files">
    <Button
      variant="ghost"
      size="sm"
      icon="file-text"
      label={t.run.openOverview}
      disabled={noFiles && (dryRun || run.active)}
      disabledReason={dryRun ? dryRunReason : run.busyText}
      testid="overview-open"
      onclick={() => open({ kind: 'overview' })}
    />
    <Button
      variant="ghost"
      size="sm"
      icon="file-spreadsheet"
      label={t.overview.excel}
      disabled={noFiles}
      disabledReason={dryRun ? dryRunReason : t.settings.excelMissing}
      testid="overview-excel"
      onclick={() => open({ kind: 'excel' })}
    />
    <Button
      variant="ghost"
      size="sm"
      icon="folder-open"
      label={t.common.openFolder}
      testid="overview-folder"
      onclick={() => open({ kind: 'excelInFolder' })}
    />
  </div>
</Block>

<style>
  /* Quiet actions; their icons start on the edge of the column (the buttons' padding and
     border hang out). */
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-left: calc(-1 * var(--ghost-inset));
  }
</style>
