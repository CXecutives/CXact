<!--
  The body of the CV's upload: one drop zone with a dashed edge that is one button as a whole
  (Tile `drop`): a click (or Enter and Space) opens the backend's file dialog with the CV
  formats, and a CV dropped on the window (Tauri's drag and drop, `onFileDrag`; the window
  keeps the file, the page never sends a path) is taken at once. Under it one quiet line says
  who reads it (an AI). While a file is dragged over the window the zone looks as under the
  pointer. Why the last evaluation filled nothing stands above it in a state box; where no
  new try can work (the tries used up, paused, an app too old) the box offers "Selbst
  ausfüllen" and the zone and its line go.
-->
<script lang="ts">
  import StateBox from '$components/StateBox.svelte';
  import Tile from '$components/Tile.svelte';
  import { t } from '$lib/i18n/t';
  import { onFileDrag } from '$lib/ipc/api';

  interface Props {
    /** Why the CV filled nothing (null: nothing to say). */
    problem: string | null;
    /** No evaluation can run now. */
    blocked: boolean;
    /** A file was dropped on the window (true), or the file dialog is to ask (false). */
    onfile: (dropped: boolean) => void;
    /** "Selbst ausfüllen" where no evaluation can run. */
    onself: () => void;
  }
  let { problem, blocked, onfile, onself }: Props = $props();

  let over = $state(false);
  $effect(() =>
    onFileDrag((drag) => {
      over = drag.kind === 'over' && !blocked;
      if (drag.kind === 'drop' && drag.paths.length > 0 && !blocked) onfile(true);
    }),
  );
</script>

<div class="upload">
  {#if problem !== null}
    <StateBox
      alert
      heading={problem}
      action={blocked
        ? { label: t.profile.byHand, icon: 'edit', testid: 'cv-self', onclick: onself }
        : null}
      testid="cv-error"
      headingTestid="cv-error-text"
    />
  {/if}
  {#if !blocked}
    <Tile
      drop
      {over}
      icon="upload"
      label={t.firstRun.drop}
      note={t.firstRun.formats}
      testid="upload-zone"
      onclick={() => onfile(false)}
    />
    <p class="ai" data-testid="upload-ai">{t.firstRun.ai}</p>
  {/if}
</div>

<style>
  .upload {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .ai {
    margin-top: calc(var(--setup-ai-gap) - var(--space-12));
    color: var(--text-subtle);
    font: var(--type-xs);
  }
</style>
