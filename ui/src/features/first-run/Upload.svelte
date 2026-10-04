<!--
  The upload of the setup: one zone with a dashed edge that takes the CV dropped on the window
  (Tauri's drag and drop, `onFileDrag`) or chosen with "Datei wählen" (the backend's file
  dialog with the CV formats), the formats it reads in one quiet line and under the zone the
  one sentence about the AI ("Wird von einer KI ausgewertet."). While a file is dragged over
  the window the zone darkens a little.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import IconTile from '$components/IconTile.svelte';
  import { t } from '$lib/i18n/t';
  import { onFileDrag } from '$lib/ipc/api';

  interface Props {
    /** The file dropped (its path), or null: the file dialog. */
    onfile: (path: string | null) => void;
  }
  let { onfile }: Props = $props();

  let over = $state(false);
  $effect(() =>
    onFileDrag((drag) => {
      over = drag.kind === 'over';
      if (drag.kind === 'drop' && drag.paths[0] !== undefined) onfile(drag.paths[0]);
    }),
  );
</script>

<div class="zone" class:over data-testid="upload-zone">
  <IconTile icon="pickFile" tone="navy" size="lg" />
  <p class="drop">{t.firstRun.drop}</p>
  <Button
    variant="primary"
    icon="pickFile"
    label={t.firstRun.pick}
    testid="upload-pick"
    onclick={() => onfile(null)}
  />
  <p class="formats">{t.firstRun.formats}</p>
</div>
<p class="ai" data-testid="upload-ai">{t.profile.fromCvHint}</p>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-32) var(--space-24);
    border: var(--border-width) dashed var(--border-strong);
    border-radius: var(--radius-lg);
    text-align: center;
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .zone.over {
    background-color: var(--quiet-press);
  }

  .drop {
    color: var(--text);
    font: var(--type-body);
  }

  .formats,
  .ai {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
