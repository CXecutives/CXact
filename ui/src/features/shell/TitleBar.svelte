<!--
  The window's top bar, the same on both OS like the Claude app's (user, 2026-09-27): one row
  of --titlebar-height (36 px) across the whole window above the sidebar and the sheet, in the
  design's window colour with a hairline under it, and nothing in it but the window buttons.
  Windows: the app's own caption buttons at the right over the bar's full height
  (WindowButtons). macOS: the native traffic lights at the left, centred in the bar
  (tauri.macos.conf.json); their room stays empty. The empty bar
  moves the window, a double click maximizes it (Windows: the window of the OS over the bar
  answers like a native caption, right click and Alt+Space open the system menu,
  src-tauri/src/platform.rs; macOS: Tauri's drag script). A press on a button here never
  takes the focus, like on a native title bar. Below the bar the app is the same on both OS.
-->
<script lang="ts">
  import WindowButtons from '$components/WindowButtons.svelte';
  import { drawsWindowButtons } from '$lib/platform';

  const drawn = drawsWindowButtons();
</script>

<div class="bar" class:drawn data-testid="title-bar" data-tauri-drag-region data-press-only>
  {#if drawn}
    <WindowButtons />
  {:else}
    <span class="lights" data-testid="traffic-lights" data-tauri-drag-region></span>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    flex: none;
    box-sizing: content-box;
    height: var(--titlebar-height);
    border-bottom: var(--border-width) solid var(--titlebar-border);
    background-color: var(--titlebar-bg);
  }

  /* Windows: the buttons at the right end. */
  .drawn {
    justify-content: flex-end;
  }

  /* macOS: the room of the traffic lights. */
  .lights {
    flex: none;
    width: var(--traffic-lights-width);
  }
</style>
