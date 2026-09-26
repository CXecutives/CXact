<!--
  An empty part of the window's toolbar row (macOS): it moves the window and a double click
  zooms it, like the toolbar of a Mac app. The title bar of macOS is transparent over the
  page and WKWebView has no app-region, so Tauri's drag script handles the attribute. As
  high as the toolbar row (--window-top); on a white sheet it sticks to the top of its scroll
  area and hides what scrolls below it. It may name the view (Profil, Einstellungen), small
  and on the left like the title of a Mac toolbar; the name is part of the band and moves
  the window too (it takes no pointer of its own).
-->
<script lang="ts">
  interface Props {
    /** Lies on the white sheet (otherwise on the cream of the sidebar). */
    sheet?: boolean;
    /** The view's name in the row (null: an empty row). */
    name?: string | null;
  }

  let { sheet = false, name = null }: Props = $props();
</script>

<div
  class="band"
  class:sheet
  data-tauri-drag-region
  data-testid="drag-band"
  aria-hidden={name === null ? 'true' : undefined}
>
  {#if name}<span class="name" data-testid="toolbar-name">{name}</span>{/if}
</div>

<style>
  .band {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--window-top);
    padding: 0 var(--pane-padding);
  }

  .sheet {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    background-color: var(--surface);
  }

  /* Like the title of a Mac toolbar: one line, small and firm, on the left. */
  .name {
    overflow: hidden;
    color: var(--text);
    font: var(--type-md);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
