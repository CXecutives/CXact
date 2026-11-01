<!--
  The window's top bar like the Claude app's (user, 2026-09-27): one row of --titlebar-height
  across the window, no line under it, no icon, no name. It continues the columns below it
  (shell.ground): the sidebar's cream as far as the docked sidebar reaches, with its seam at
  the edge; over the list the list's white, over the job view beside it the job view's page
  with the list's border running up through the bar; the page over a job standing alone in
  one column, over Profil, Einstellungen and a start that loads or failed; the cream over the
  setup. At the left Zurück, Vor and the sidebar's button (macOS: right of the traffic
  lights), quiet 28 px buttons at --titlebar-tools-inset (6 px: three buttons then end at
  --titlebar-tools-start, the zone the Windows caption leaves to the page, a deliberate
  departure from the draft's 12 px, decision 29). At the right the job view's button, only in
  Jobs where it does something (a place with jobs beside its job view, whatever the search or
  the filter leaves of its list, or a job standing in place of the list in one column) and
  hidden, not dimmed, everywhere else; hiding the job
  view closes its job (in one column the job that stands in place of the list). Then the
  caption buttons on Windows (WindowButtons). Every button is a plain switch: its glyph never
  changes under the pointer.
  The empty bar moves the window, a double click maximizes it (Windows: the window of the OS
  over the bar answers like a native caption and leaves the buttons' zones,
  --titlebar-tools-start and --titlebar-tools-end, to the page; src-tauri/src/platform.rs.
  macOS and the gaps between the buttons: Tauri's drag script). A press on a button here
  never takes the focus, like on a native title bar. In the setup the bar holds none of its
  buttons (only the caption buttons on Windows) and all of it moves the window. While the scrim
  of a modal (a dialog, the closing note) lies over the bar it still moves the window and that
  cancels nothing: on Windows by the same window of the OS, on macOS by a transparent drag region
  of its height that rises over the scrim (`overScrim`).
  The part over the view (`ground`) slides with the view when the sidebar docks or folds
  (App, data-dock-slide); a strip of its end colour beyond its right edge fills the bar
  while it is drawn in from the left.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import WindowButtons from '$components/WindowButtons.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import { drawsWindowButtons, scrimNeedsDragRegion } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { history } from '$lib/state/history.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { viewport } from '$lib/state/viewport.svelte';
  import { tokenPx } from '$lib/tokens';

  const drawn = drawsWindowButtons();
  const overScrim = scrimNeedsDragRegion();
  /** The job view's button stands only where it does something (decision 29): in Jobs while
   *  the job view can stand beside the list (its place holds jobs, JobsView; a search without
   *  hits keeps it), or in one column while a job stands in place of the list. */
  const readerToggle = $derived(
    app.state !== null &&
      !shell.firstRun &&
      navigation.current === 'jobs' &&
      (viewport.narrow ? shell.listHidden : !jobs.emptyPlace),
  );
  /** A click hides the job view: it stands beside the list, or in one column a job stands in
   *  the list's place. */
  const readerShown = $derived(viewport.narrow ? jobs.selected !== null : shell.readerOpen);
  /** A click hides the sidebar: it stands docked, or floats over the view. */
  const sidebarOut = $derived(shell.docked || shell.peek);
  /** Hidden, the job view closes its job too (the list shows none chosen); shown again, it
   *  asks for one. In one column it closes the job that stands in place of the list. */
  function toggleReader(): void {
    if (viewport.narrow) {
      jobs.clearSelection();
      return;
    }
    if (shell.readerOpen) jobs.clearSelection();
    shell.setReader(!shell.readerOpen);
  }

  /** Where the view starts (the docked sidebar's width) and where the border between the
   *  list and the job view stands in it (continued up through the bar). */
  const lines = $derived.by(() => {
    const vars: Record<string, string> = {};
    if (shell.docked) vars['bar-side'] = `${shell.sidebarWidth ?? tokenPx('--sidebar-width')}px`;
    if (shell.ground === 'list' && shell.listSeam !== null) {
      vars['bar-list'] = `${shell.listSeam - tokenPx('--border-width')}px`;
    }
    return vars;
  });
</script>

<div
  class="bar"
  class:drawn
  data-testid="title-bar"
  data-tauri-drag-region
  data-press-only
  use:cssVars={lines}
>
  <span
    class="ground {shell.ground} end-{shell.groundEnd}"
    class:docked={shell.docked}
    data-testid="title-bar-ground"
    data-dock-slide
  >
    {#if shell.ground === 'list' && shell.listSeam !== null}
      <span class="reader" data-testid="title-bar-seam"></span>
    {/if}
  </span>
  {#if !drawn}
    <span class="lights" data-testid="traffic-lights" data-tauri-drag-region></span>
  {/if}
  <span class="tools start" data-tauri-drag-region>
    {#if !shell.firstRun}
      {@render startTools()}
    {/if}
  </span>
  <span class="fill" data-tauri-drag-region></span>
  <span class="tools end" data-tauri-drag-region>
    {#if readerToggle}
      <Button
        variant="ghost"
        iconOnly
        icon="readerPane"
        label={readerShown ? t.nav.readerHide : t.nav.readerShow}
        testid="toggle-reader"
        onclick={toggleReader}
      />
    {/if}
  </span>
  {#if drawn}
    <WindowButtons />
  {/if}
</div>
{#if overScrim}
  <span class="over-scrim" data-tauri-drag-region></span>
{/if}

{#snippet startTools()}
  <Button
    variant="ghost"
    iconOnly
    icon="back"
    label={t.nav.back}
    disabled={!history.canBack}
    repeats
    testid="history-back"
    onclick={() => history.back()}
  />
  <Button
    variant="ghost"
    iconOnly
    icon="next"
    label={t.nav.forward}
    disabled={!history.canForward}
    repeats
    testid="history-forward"
    onclick={() => history.forward()}
  />
  <Button
    variant="ghost"
    iconOnly
    icon="sidebar"
    label={sidebarOut ? t.nav.sidebarHide : t.nav.sidebarShow}
    testid="toggle-sidebar"
    onclick={() => shell.toggleSidebar()}
  />
{/snippet}

<style>
  /* The cream of the sidebar and the setup; the view's part lies over it (`ground`). */
  .bar {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--titlebar-height);
    background-color: var(--bg);
    isolation: isolate;
  }

  /* Over the view: from the docked sidebar's edge (its seam, where the view's border lies
     below) to the right edge, in the view's ground. Beyond its right edge a strip of the end
     colour, out of sight at rest, fills the bar while the part slides in from the left. It
     lies under everything else in the bar. */
  .ground {
    position: absolute;
    z-index: var(--z-below);
    inset: 0;
    pointer-events: none;
    box-shadow: var(--sidebar-max) 0 0 0 var(--ground-end);
  }

  /* Its seam on the sidebar's last pixel, like the view's below. */
  .ground.docked {
    left: calc(var(--bar-side, var(--sidebar-width)) - var(--border-width));
    border-left: var(--border-width) solid var(--border);
  }

  .ground.side {
    background-color: var(--bg);
  }

  .ground.page {
    background-color: var(--page);
  }

  .ground.list {
    background-color: var(--surface);
  }

  .end-side {
    --ground-end: var(--bg);
  }

  .end-page {
    --ground-end: var(--page);
  }

  .end-list {
    --ground-end: var(--surface);
  }

  /* The job view's page beside the list, its left edge the list's border. */
  .reader {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: var(--bar-list);
    border-left: var(--border-width) solid var(--border);
    background-color: var(--page);
  }

  /* The buttons lie in the zones the Windows caption leaves to the page; they are the quiet
     icon-button height (--titlebar-tool, which core's window.rs counts with). */
  .tools {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
  }

  .start {
    padding-inline-start: var(--titlebar-tools-inset);
  }

  .end {
    padding-inline-end: var(--titlebar-tools-inset);
  }

  .fill {
    position: relative;
    flex: 1;
    align-self: stretch;
  }

  /* macOS: the room of the traffic lights. */
  .lights {
    position: relative;
    flex: none;
    align-self: stretch;
    width: var(--traffic-lights-width);
  }

  /* macOS, while a modal stands: only a direct hit on a drag region moves the window (Tauri's
     drag script), and the scrim takes every hit, so this one lies over it. Outside the bar,
     which is a layer of its own below the scrim; a dialog stays clear of it (Dialog.svelte). */
  .over-scrim {
    display: none;
  }

  :global(:root:has([aria-modal='true'])) .over-scrim {
    position: fixed;
    z-index: var(--z-overlay-bar);
    top: 0;
    right: 0;
    left: 0;
    display: block;
    height: var(--titlebar-height);
  }
</style>
