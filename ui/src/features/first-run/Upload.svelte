<!--
  The upload of the setup: one zone with a dashed edge that takes the CV dropped on the window
  (Tauri's drag and drop, `onFileDrag`; the window keeps the file, the page never sends a
  path) or chosen with the link "auswählen" (the backend's file dialog with the CV formats),
  and the formats it reads in one quiet line. The one sentence about the AI stands in the
  card's footer (FirstRunView). While a file is dragged over the window the zone takes the
  navy tint and edge of a chosen tile.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Icon from '$components/Icon.svelte';
  import { t } from '$lib/i18n/t';
  import { onFileDrag } from '$lib/ipc/api';

  interface Props {
    /** A file was dropped on the window (true), or the file dialog is to ask (false). */
    onfile: (dropped: boolean) => void;
  }
  let { onfile }: Props = $props();

  let over = $state(false);
  $effect(() =>
    onFileDrag((drag) => {
      over = drag.kind === 'over';
      if (drag.kind === 'drop' && drag.paths.length > 0) onfile(true);
    }),
  );
</script>

<div class="zone" class:over data-testid="upload-zone">
  <span class="glyph"><Icon name="pickFile" size="lg" /></span>
  <p class="drop">
    {t.firstRun.drop}
    <Button
      variant="link"
      inText
      label={t.firstRun.pick}
      testid="upload-pick"
      onclick={() => onfile(false)}
    />
  </p>
  <p class="formats">{t.firstRun.formats}</p>
</div>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-8);
    padding: var(--space-24);
    border: var(--drop-edge) dashed var(--border-strong);
    border-radius: var(--radius-lg);
    text-align: center;
    transition:
      background-color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }

  .zone.over {
    border-color: var(--active-edge);
    background-color: var(--active-surface);
  }

  .glyph {
    display: inline-flex;
    margin-bottom: var(--space-4);
    color: var(--icon-accent);
  }

  .drop {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-4);
    color: var(--text);
    font: var(--type-md);
  }

  .formats {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
