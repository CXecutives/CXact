<!--
  The shell: the window's top bar (the same on both OS, TitleBar), below it the sidebar and
  the three views, each on its own ground (shell.ground: the list's white, the warm page of
  the job view and the pages, the setup's cream), which the bar continues. The sidebar's
  button docks or folds it: the sidebar fades in (100 ms) and the view slides from where it
  stood by a transform (FLIP, 180 ms, with the bar's part over it); its width never
  animates, and a window that folds it by its width just shows the new frame. Every view
  switch is the same: the new view is there
  at once, nothing fades, so nothing flashes between them. On start nothing animates and the
  app shows useful content at once: the setup until it was finished
  once (a mode of the shell of its own: no sidebar, the top bar without its buttons, every
  switch of the view refused, the mouse's back button is the setup's Zurück), otherwise the
  Jobs view with the last results. Closing while a
  fetch runs asks first (features/shell/CloseDialog.svelte). Closing while the app is busy
  keeps the window until that has stopped; a calm note says what it waits for (a fetch, a
  rescore, a sign-in, the files). Profil and Einstellungen keep where they were scrolled to
  while the app runs (a return finds the same place). A start whose data cannot load says so
  and offers to try again, to restore a backup (the dialog of Einstellungen, whose restore
  loads the app again) and the data folder; what the restore could not do stays a note under
  them.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Menu from '$components/Menu.svelte';
  import Notice, { type NoticeTone } from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import Splitter from '$components/Splitter.svelte';
  import Toast from '$components/Toast.svelte';
  import Tooltip from '$components/Tooltip.svelte';
  import { keepScroll } from '$lib/actions/keepScroll';
  import { scrollFade } from '$lib/actions/scrollFade';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { foldSidebar, onBack, onForward } from '$lib/input/input';
  import { untrack } from 'svelte';
  import { invoke, onClosing, reportUiError } from '$lib/ipc/api';
  import type { OpenTarget } from '$lib/ipc/types';
  import { play } from '$lib/motion/motion';
  import { fade } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { history } from '$lib/state/history.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { viewport } from '$lib/state/viewport.svelte';
  import { tokenPx } from '$lib/tokens';
  import FirstRunView from './features/first-run/FirstRunView.svelte';
  import CloseDialog from './features/shell/CloseDialog.svelte';
  import JobsView from './features/jobs/JobsView.svelte';
  import ProfileView from './features/profile/ProfileView.svelte';
  import BackupDialog from './features/shell/BackupDialog.svelte';
  import SettingsView from './features/settings/SettingsView.svelte';
  import Sidebar from './features/shell/Sidebar.svelte';
  import TitleBar from './features/shell/TitleBar.svelte';

  run.install();
  jobs.install();
  navigation.install();
  navigation.lock(() => shell.firstRun);
  history.install();
  void app.load().then((state) => run.attach(state?.running ?? null));

  const firstRun = $derived(shell.firstRun);
  /** Closing while the app is busy: the window waits until it has stopped. */
  let closing = $state(false);
  $effect(() => onClosing(() => (closing = true)));
  // The mouse's back button goes back like Zurück in the top bar, the forward button on like Vor.
  // The setup has neither: its step answers the back button itself (FirstRunView), and it has no
  // way forward.
  $effect(() => onBack(() => !shell.firstRun && history.back()));
  $effect(() => onForward(() => !shell.firstRun && history.forward()));

  // The sidebar floats only in a narrow window: with the room to dock it, it folds.
  $effect(() => {
    if (!viewport.fold) shell.peek = false;
  });

  /** The views' sheet: it slides when the sidebar docks or folds. */
  let views = $state<HTMLElement | null>(null);
  const docked = $derived(shell.docked);
  /** Where the sheet stood before the sidebar docked or folded, and the frame it stood in. */
  let from: number | null = null;
  let frame = { fold: viewport.fold, firstRun: shell.firstRun };
  $effect.pre(() => {
    void docked;
    untrack(() => (from = views?.getBoundingClientRect().left ?? null));
  });
  /** Moves that end leave nothing behind (no fill holds the element). */
  function once(motion: Animation | null): void {
    motion?.addEventListener('finish', () => motion.cancel());
  }
  // The sidebar's button docked or folded it: the sidebar fades in, the sheet and the bar's
  // part over it slide from where they stood (a slide still under way starts from where it
  // is). A window that folds it by its width, and the setup's end, just show the new frame.
  $effect(() => {
    const now = docked;
    untrack(() => {
      const before = frame;
      frame = { fold: viewport.fold, firstRun: shell.firstRun };
      if (from === null || views === null) return;
      if (before.fold !== frame.fold || before.firstRun !== frame.firstRun) return;
      const slides = [...document.querySelectorAll('[data-dock-slide]')];
      for (const node of slides) for (const motion of node.getAnimations()) motion.cancel();
      const dx = Math.round(from - views.getBoundingClientRect().left);
      if (dx === 0) return;
      for (const node of slides) {
        const keys = [{ transform: `translateX(${dx}px)` }, { transform: 'none' }];
        once(play(node, keys, { duration: 'slow', easing: 'out' }));
      }
      const sidebar = now ? document.querySelector('[data-testid="sidebar"]') : null;
      if (sidebar !== null) {
        const keys = [{ opacity: 0 }, { opacity: 1 }];
        once(play(sidebar, keys, { duration: 'fast', easing: 'out' }));
      }
    });
  });

  /** The data folder, after a start that could not load its data. */
  function openFolder(target: OpenTarget): void {
    invoke('open_target', { target }).catch((error: unknown) => {
      reportUiError(`open ${target.kind}: ${String(error)}`, null, null);
    });
  }

  /** A backup to restore after a failed start: its button turns while the copies are read,
   *  and what fails (or that there is none) is a note under the ways. */
  let backupDialog = $state<BackupDialog | null>(null);
  let restoring = $state(false);
  let backupNote = $state<{ tone: NoticeTone; text: () => string } | null>(null);
  async function asBackupStep(work: () => Promise<void>): Promise<void> {
    restoring = true;
    backupNote = null;
    try {
      await work();
    } catch (error) {
      backupNote = { tone: 'danger', text: () => errorText(error) };
    } finally {
      restoring = false;
    }
  }
  function restoreBackup(): void {
    void backupDialog?.show(asBackupStep, () => {
      backupNote = { tone: 'info', text: () => t.shell.backupNone };
    });
  }
</script>

<div class="shell" data-testid="shell">
  <TitleBar />
  <div class="body">
    {#if shell.docked}
      <Sidebar />
      <span class="split"
        ><Splitter
          bind:size={shell.sidebarWidth}
          initial={tokenPx('--sidebar-width')}
          min={tokenPx('--sidebar-min')}
          max={tokenPx('--sidebar-max')}
          storageKey="sidebar-width"
          label={t.nav.sidebarWidth}
          testid="sidebar-splitter"
        /></span
      >
    {:else if shell.peek}
      <!-- A narrow window: the sidebar's button floats it over the view. -->
      <div class="peek" data-peek transition:fade>
        <Sidebar floating onchoose={foldSidebar} />
      </div>
    {/if}
    <main
      class="views end-{shell.groundEnd}"
      class:docked={shell.docked}
      data-dock-slide
      bind:this={views}
    >
      {#if app.error !== null && app.state === null}
        <section class="view fixed stage" data-testid="view-error">
          <div class="center">
            <EmptyState
              icon="warning"
              tone="danger"
              heading={t.shell.loadFailed}
              action={{
                label: t.common.retry,
                icon: 'retry',
                onclick: () => void app.load(),
              }}
            />
            <div class="ways">
              <Button
                variant="ghost"
                icon="backup"
                label={t.shell.backupHeading}
                loading={restoring}
                testid="restore-backup"
                onclick={restoreBackup}
              />
              <Button
                variant="ghost"
                icon="folder"
                label={t.common.openFolder}
                testid="open-data"
                onclick={() => openFolder({ kind: 'dataDir' })}
              />
            </div>
            {#if backupNote}
              <Notice
                tone={backupNote.tone}
                variant="box"
                text={backupNote.text()}
                testid="backup-note"
              />
            {/if}
          </div>
        </section>
      {:else if app.state === null}
        <!-- Until the state is known nothing is guessed (no jobs view flashing before the first run). -->
        <section class="view fixed stage" data-testid="view-loading">
          <div class="center">
            {#if app.slow}<Spinner size="lg" />{/if}
          </div>
        </section>
      {:else}
        <!-- The views are the branches of one block: a switch shows the new one at once. -->
        {#if firstRun}
          <section class="view side" data-testid="view-first-run" data-key-pane use:scrollFade>
            <FirstRunView />
          </section>
        {:else if navigation.current === 'jobs'}
          <section class="view fixed list" data-testid="view-jobs">
            <JobsView />
          </section>
        {:else if navigation.current === 'profile'}
          <section
            class="view"
            data-testid="view-profile"
            data-key-pane
            use:keepScroll={'profile'}
            use:scrollFade
          >
            <ProfileView />
          </section>
        {:else}
          <section
            class="view"
            data-testid="view-settings"
            data-key-pane
            use:keepScroll={'settings'}
            use:scrollFade
          >
            <SettingsView />
          </section>
        {/if}
      {/if}
    </main>
    {#if closing}
      <div class="closing" data-testid="closing" role="status" transition:fade>
        <p class="closing-note">
          <Spinner size="sm" label={null} /><span>{t.shell.closing}</span>
        </p>
      </div>
    {/if}
    <CloseDialog />
    <BackupDialog bind:this={backupDialog} />
  </div>
  <Toast />
  <Menu />
  <Tooltip />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--bg);
  }

  .body {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* Closing during a fetch: the window waits until the run has stopped; one calm note says
     so, in the words of a state box. */
  .closing {
    position: absolute;
    z-index: var(--z-overlay);
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-16);
    background-color: var(--scrim);
  }

  .closing-note {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    max-width: var(--dialog-width);
    padding: var(--space-16) var(--space-20);
    border-radius: var(--radius-dialog);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
    color: var(--text);
    font: var(--type-label);
  }

  /* The sheet of the views: the docked sidebar's hairline is its left edge. Beyond its right
     edge a strip of its end colour, out of sight at rest, fills the window while the sheet
     slides in from the left (the sidebar docks). */
  .views {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    box-shadow: var(--sidebar-max) 0 0 0 var(--views-end);
  }

  /* The seam lies on the sidebar's last pixel, inside its width: the view starts right at
     --sidebar-width. */
  .views.docked {
    margin-left: calc(-1 * var(--border-width));
    border-left: var(--border-width) solid var(--border);
  }

  .end-side {
    --views-end: var(--bg);
  }

  .end-page {
    --views-end: var(--page);
  }

  .end-list {
    --views-end: var(--surface);
  }

  /* The handle between the sidebar and the view: no room of its own. */
  .split {
    display: flex;
    flex: none;
  }

  /* The sidebar of a narrow window, floated out by its button over the view: a rounded card
     --peek-inset in from the edges below the bar, its entries where the docked ones stand. */
  .peek {
    position: absolute;
    z-index: var(--z-overlay);
    top: var(--peek-inset);
    bottom: var(--peek-inset);
    left: var(--peek-inset);
    width: calc(var(--sidebar-width) - 2 * var(--peek-inset));
    overflow: hidden;
    border: var(--border-width) solid var(--border);
    border-radius: var(--peek-radius);
    background-color: var(--bg);
    box-shadow: var(--sh-pop);
  }

  /* The one view fills the sheet, on the warm page (Profil, Einstellungen, a start that
     loads or failed); Jobs on the list's white (its job view paints its own page), the setup
     on the cream. */
  .view {
    grid-area: 1 / 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: var(--page);
    --view-fade: var(--grad-fade-page);
  }

  .view.list {
    background-color: var(--surface);
  }

  .view.side {
    background-color: var(--bg);
    --view-fade: var(--grad-fade-side);
  }

  /* A view that scrolls always keeps its scrollbar's room (Windows: a transparent track,
     the thumb only under the pointer; macOS overlay scrollbars take none), so a centred
     column never jumps sideways between a short and a long view. */
  .view:not(.fixed) {
    overflow-y: scroll;
  }

  /* The fade under the top bar (24 px): the view's ground into nothing at the top of a view
     that scrolls; it grows in with the first scroll (scrollFade), so at rest it lies over
     nothing. */
  .view:not(.fixed)::before {
    content: '';
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: block;
    height: var(--fade-height);
    margin-bottom: calc(-1 * var(--fade-height));
    background: var(--view-fade);
    opacity: var(--fade-shown, 0);
    pointer-events: none;
  }

  .fixed {
    overflow: hidden;
  }

  /* The loading and the failed start: centred on the page. */
  .stage {
    display: flex;
    flex-direction: column;
    padding: var(--space-16);
  }

  .center {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-12);
    min-height: 0;
  }

  /* The quieter ways on after a failed start: a backup and the data folder, side by side
     (one above the other in a narrow window). */
  .ways {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-6);
  }
</style>
