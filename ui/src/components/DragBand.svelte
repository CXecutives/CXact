<!--
  An empty part of the window's toolbar row (macOS): it moves the window and a double click
  zooms it, like the toolbar of a Mac app. The title bar of macOS is transparent over the
  page and WKWebView has no app-region, so Tauri's drag script handles the attribute. As
  high as the toolbar row (--window-top); on a white sheet it sticks to the top of its scroll
  area and hides what scrolls below it. It may name the view (Profil, Einstellungen) on the
  left, bold like the window title of a Mac app; the name is part of the band and moves the
  window too (it takes no pointer of its own). Under a named band a hairline fades in
  (150 ms) as soon as the view is scrolled, none at the top, like the toolbar of a Mac app.
-->
<script lang="ts">
  interface Props {
    /** Lies on the white sheet (otherwise on the cream of the sidebar). */
    sheet?: boolean;
    /** The view's name in the row (null: an empty row). */
    name?: string | null;
  }

  let { sheet = false, name = null }: Props = $props();

  /** A hairline's height at the very top of the scroll area: out of view once it scrolled. */
  let top = $state<HTMLElement | null>(null);
  let scrolled = $state(false);

  $effect(() => {
    const node = top;
    const area = node?.parentElement ?? null;
    if (node === null || area === null) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (entry) scrolled = !entry.isIntersecting;
      },
      { root: area },
    );
    watch.observe(node);
    return () => watch.disconnect();
  });
</script>

{#if sheet && name}<span class="top" bind:this={top} aria-hidden="true"></span>{/if}
<div
  class="band"
  class:sheet
  class:edged={sheet && name}
  class:scrolled
  data-tauri-drag-region
  data-testid="drag-band"
  data-scrolled={sheet && name ? String(scrolled) : undefined}
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

  /* Takes no room: the band stays at the top of the area. */
  .top {
    display: block;
    height: var(--border-width);
    margin-bottom: calc(-1 * var(--border-width));
    pointer-events: none;
  }

  .edged::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: var(--border-width);
    background-color: var(--border);
    content: '';
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .scrolled::after {
    opacity: 1;
  }

  /* Like the window title of a Mac app: one line, bold, on the left. */
  .name {
    overflow: hidden;
    color: var(--text);
    font: var(--type-mac-title);
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
