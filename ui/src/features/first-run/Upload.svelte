<!--
  The upload of the setup: one drop zone with a dashed edge that is one button as a whole
  (Tile `drop`): a click (or Enter and Space) opens the backend's file dialog with the CV
  formats, and a CV dropped on the window (Tauri's drag and drop, `onFileDrag`; the window
  keeps the file, the page never sends a path) is taken at once. The formats it reads stand
  in one quiet line under its words (the dialog takes every format); the sentence about the
  AI stood on the tile one step before. While a file is dragged over the window the zone
  looks as under the pointer.
-->
<script lang="ts">
  import Tile from '$components/Tile.svelte';
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

<Tile
  drop
  {over}
  icon="pickFile"
  label={t.profile.cvDrop}
  note={t.profile.cvFormats}
  testid="upload-zone"
  onclick={() => onfile(false)}
/>
