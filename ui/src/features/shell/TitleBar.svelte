<!--
  The window's top bar like the Claude app's (user, 2026-09-27): one row of --titlebar-height
  across the window, no line under it, no icon, no name. Its left part wears the sidebar's
  colour as far as the docked sidebar reaches, with a fine seam at its edge; the rest wears
  the view's. With the sidebar folded the bar is one colour. At the left the sidebar's button,
  Zurück and Vor (macOS: right of the traffic lights); at the right the job view's button,
  always there, dimmed where there is nothing to show or hide (hiding the job view closes its
  job; in one column it closes the job that stands in place of the list), before the caption
  buttons
  on Windows (WindowButtons). The empty bar moves the window, a double click maximizes it
  (Windows: the window of the OS over the bar answers like a native caption and leaves the
  buttons' zones, --titlebar-tools-start and --titlebar-tools-end, to the page;
  src-tauri/src/platform.rs. macOS and the gaps between the buttons: Tauri's drag script). A
  press on a button here never takes the focus, like on a native title bar. Both side buttons
  are plain switches.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import WindowButtons from '$components/WindowButtons.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import { drawsWindowButtons } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { history } from '$lib/state/history.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { viewport } from '$lib/state/viewport.svelte';
  import { tokenPx } from '$lib/tokens';

  const drawn = drawsWindowButtons();
  /** The job view's button stands in every view, like the bar's other buttons (user,
   *  2026-09-29): dimmed where there is no job view to show or hide (Profil, Einstellungen,
   *  the setup page, a start whose data did not load, one column without a job), and then
   *  without a tooltip: it names no action it cannot do (its accessible name stays). */
  const readerIdle = $derived(
    app.state === null ||
      navigation.current !== 'jobs' ||
      shell.firstRun ||
      (viewport.narrow && jobs.selected === null),
  );
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

  /** How far the sidebar's colour reaches (the sidebar's width while it is docked), and where
   *  the border between the list and the job view stands (continued up through the bar). */
  const lines = $derived.by(() => {
    const border = tokenPx('--border-width');
    const sidebar = shell.sidebarWidth ?? tokenPx('--sidebar-width');
    const start = shell.docked ? sidebar + border : 0;
    const vars: Record<string, string> = {};
    if (shell.docked) vars['bar-side'] = `${sidebar}px`;
    if (shell.listSeam !== null) vars['bar-list'] = `${start + shell.listSeam - border}px`;
    return vars;
  });
</script>

<div
  class="bar"
  class:drawn
  class:docked={shell.docked}
  data-testid="title-bar"
  data-tauri-drag-region
  data-press-only
  use:cssVars={lines}
>
  <span class="side" data-tauri-drag-region></span>
  {#if shell.listSeam !== null}
    <span class="list-seam" data-testid="title-bar-seam"></span>
  {/if}
  {#if !drawn}
    <span class="lights" data-testid="traffic-lights" data-tauri-drag-region></span>
  {/if}
  <span class="tools start" data-tauri-drag-region>
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="sidebar"
      label={shell.docked ? t.nav.sidebarHide : t.nav.sidebarShow}
      testid="toggle-sidebar"
      onclick={() => shell.toggleSidebar()}
    />
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="historyBack"
      label={t.nav.back}
      disabled={!history.canBack}
      testid="history-back"
      onclick={() => history.back()}
    />
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="next"
      label={t.nav.forward}
      disabled={!history.canForward}
      testid="history-forward"
      onclick={() => history.forward()}
    />
  </span>
  <span class="fill" data-tauri-drag-region></span>
  <span class="tools end" data-tauri-drag-region>
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="readerPane"
      label={shell.readerOpen && !viewport.narrow ? t.nav.readerHide : t.nav.readerShow}
      disabled={readerIdle}
      plain={readerIdle}
      testid="toggle-reader"
      onclick={toggleReader}
    />
  </span>
  {#if drawn}
    <WindowButtons />
  {/if}
</div>

<style>
  .bar {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    height: var(--titlebar-height);
    background-color: var(--surface);
  }

  /* The sidebar's colour as far as the docked sidebar reaches, its seam at the edge. */
  .side {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
  }

  /* The seam lies where the view's border lies below: just right of the sidebar. */
  .docked .side {
    width: calc(var(--bar-side, var(--sidebar-width)) + var(--border-width));
    border-right: var(--border-width) solid var(--border);
    background-color: var(--bg);
  }

  /* The border between the list and the job view, continued through the bar. */
  .list-seam {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--bar-list);
    width: var(--border-width);
    background-color: var(--border);
    pointer-events: none;
  }

  /* The buttons lie in the zones the Windows caption leaves to the page; they are the bar's
     own size, with larger, stronger glyphs than the content's. */
  .tools {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    --icon-stroke: var(--titlebar-icon-stroke);
  }

  .tools :global(.btn.sm) {
    --btn-height: var(--titlebar-tool);
  }

  .tools :global(.icon.sm) {
    --icon-size: var(--titlebar-icon);
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
</style>
