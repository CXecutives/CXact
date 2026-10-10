<!--
  The shell: the window's top bar (the same on both OS, TitleBar), below it the sidebar and
  the white sheet with the three views. Every view switch is the same: the new view is there
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
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { onBack } from '$lib/input/input';
  import { invoke, onClosing, reportUiError } from '$lib/ipc/api';
  import type { OpenTarget } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { history } from '$lib/state/history.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { tokenPx } from '$lib/tokens';
  import FirstRunView from './features/first-run/FirstRunView.svelte';
  import { onboarding } from './features/first-run/onboarding.svelte';
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
  // The mouse's back button goes back like Zurück in the top bar (in the setup its Zurück).
  $effect(() => onBack(() => (shell.firstRun ? onboarding.back() : history.back())));

  // A docked sidebar never floats as well.
  $effect(() => {
    if (shell.docked) shell.peek = false;
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
        <Sidebar floating onchoose={() => shell.fold()} />
      </div>
    {/if}
    <main class="views" class:docked={shell.docked}>
      {#if app.error !== null && app.state === null}
        <section class="view fixed stage" data-testid="view-error">
          <div class="center">
            <EmptyState
              icon="warning"
              tone="danger"
              text={t.shell.loadFailed}
              action={{
                label: t.common.retry,
                icon: 'retry',
                onclick: () => void app.load(),
              }}
            />
            <div class="ways">
              <Button
                variant="link"
                icon="backup"
                label={t.shell.backupHeading}
                loading={restoring}
                testid="restore-backup"
                onclick={restoreBackup}
              />
              <Button
                variant="link"
                icon="folder"
                label={t.common.openFolder}
                testid="open-data"
                onclick={() => openFolder({ kind: 'dataDir' })}
              />
            </div>
            {#if backupNote}
              <Notice
                tone={backupNote.tone}
                variant="inline"
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
          <section class="view" data-testid="view-first-run">
            <FirstRunView />
          </section>
        {:else if navigation.current === 'jobs'}
          <section class="view fixed" data-testid="view-jobs">
            <JobsView />
          </section>
        {:else if navigation.current === 'profile'}
          <section class="view" data-testid="view-profile" use:keepScroll={'profile'}>
            <ProfileView />
          </section>
        {:else}
          <section class="view" data-testid="view-settings" use:keepScroll={'settings'}>
            <SettingsView />
          </section>
        {/if}
      {/if}
    </main>
    {#if closing}
      <div class="closing" data-testid="closing" role="status" transition:fade>
        <p class="closing-note">
          <Spinner size="sm" label={null} />{t.shell.closing}
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

  /* Closing during a fetch: the window waits until the run has stopped. */
  .closing {
    position: absolute;
    z-index: var(--z-overlay);
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--scrim);
  }

  .closing-note {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-16) var(--space-20);
    border-radius: var(--radius-dialog);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
    color: var(--text);
    font: var(--type-md);
  }

  /* One white sheet for every view: the sidebar stays on the cream, the sheet's hairline is
     the only divider between them (the top bar's hairline runs above both). */
  .views {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background-color: var(--surface);
  }

  .views.docked {
    border-left: var(--border-width) solid var(--border);
  }

  /* The handle between the sidebar and the view: no room of its own. */
  .split {
    display: flex;
    flex: none;
  }

  /* The sidebar of a narrow window, floated out by its button over the view, a little in
     from the edges. */
  .peek {
    position: absolute;
    z-index: var(--z-overlay);
    top: var(--peek-inset);
    bottom: var(--peek-inset);
    left: var(--peek-inset);
    overflow: hidden;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--bg);
    box-shadow: var(--sh-menu);
  }

  /* The one view fills the sheet. */
  .view {
    grid-area: 1 / 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: var(--surface);
  }

  /* A view that scrolls always keeps its scrollbar's room (Windows: a transparent track,
     the thumb only under the pointer; macOS overlay scrollbars take none), so a centred
     column never jumps sideways between a short and a long view. */
  .view:not(.fixed) {
    overflow-y: scroll;
    background-color: var(--layout-page);
  }

  /* The fade under the top bar: the view's colour into nothing at the top of a view that
     scrolls, over the empty padding at rest and over the content once it scrolled under it. */
  .view:not(.fixed)::before {
    content: '';
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: block;
    height: var(--fade-height);
    margin-bottom: calc(-1 * var(--fade-height));
    background: var(--grad-fade-page);
    pointer-events: none;
  }

  .fixed {
    overflow: hidden;
  }

  /* The loading and the failed start: centred. */
  .stage {
    display: flex;
    flex-direction: column;
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

  /* The quieter ways on after a failed start: a backup and the data folder (they wrap in a
     narrow window). */
  .ways {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-8) var(--space-16);
  }
</style>
