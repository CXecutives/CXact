<!--
  The shell: the window's top bar (the same on both OS, TitleBar), below it the sidebar and
  the white sheet with the three views. Every view switch is the same: the old view fades out (100 ms), then the new
  one fades in (100 ms), so two views are never readable at once (lib/motion). On start
  nothing animates and the app shows useful content at once: the first-run page while
  nothing was ever fetched, otherwise the Jobs view with the last results. Closing while a
  fetch runs asks first (features/shell/CloseDialog.svelte). Closing while the app is busy
  keeps the window until that has stopped; a calm note says what it waits for (a fetch, a
  rescore, a sign-in, the files). Profil and Einstellungen keep where they were scrolled to
  while the app runs (a return finds the same place). A start whose data cannot load says so
  and offers to try again, the log and the data folder.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Menu from '$components/Menu.svelte';
  import Spinner from '$components/Spinner.svelte';
  import Toast from '$components/Toast.svelte';
  import Tooltip from '$components/Tooltip.svelte';
  import { keepScroll } from '$lib/actions/keepScroll';
  import { t } from '$lib/i18n/t';
  import { invoke, onClosing, reportUiError } from '$lib/ipc/api';
  import type { OpenTarget } from '$lib/ipc/types';
  import { fade, viewIn, viewOut } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import FirstRunView from './features/first-run/FirstRunView.svelte';
  import CloseDialog from './features/shell/CloseDialog.svelte';
  import JobsView from './features/jobs/JobsView.svelte';
  import ProfileView from './features/profile/ProfileView.svelte';
  import SettingsView from './features/settings/SettingsView.svelte';
  import Sidebar from './features/shell/Sidebar.svelte';
  import TitleBar from './features/shell/TitleBar.svelte';

  run.install();
  jobs.install();
  navigation.install();
  void app.load().then((state) => run.attach(state?.running ?? null, state?.lastRun ?? null));

  const firstRun = $derived(shell.firstRun);
  /** Closing while the app is busy: what the window waits for (null: not closing). */
  let closing = $state<{ activity: string | null } | null>(null);
  $effect(() => onClosing((activity) => (closing = { activity })));

  /** The log or the data folder, after a start that could not load its data. */
  function openFolder(target: OpenTarget): void {
    invoke('open_target', { target }).catch((error: unknown) => {
      reportUiError(`open ${target.kind}: ${String(error)}`, null, null);
    });
  }
</script>

<div class="shell" data-testid="shell">
  <TitleBar />
  <div class="body">
    <Sidebar />
    <main class="views">
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
                size="sm"
                icon="folder"
                label={t.common.openLog}
                testid="open-log"
                onclick={() => openFolder({ kind: 'logDir' })}
              />
              <Button
                variant="link"
                size="sm"
                label={t.common.openFolder}
                testid="open-data"
                onclick={() => openFolder({ kind: 'dataDir' })}
              />
            </div>
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
        <!-- The views are the branches of one block: on a switch the old one fades out, then
             the new one fades in (local transitions), while the first view after loading is
             simply there. -->
        {#if navigation.current === 'jobs' && firstRun}
          <section class="view" data-testid="view-first-run" in:viewIn out:viewOut>
            <FirstRunView />
          </section>
        {:else if navigation.current === 'jobs'}
          <section class="view fixed" data-testid="view-jobs" in:viewIn out:viewOut>
            <JobsView />
          </section>
        {:else if navigation.current === 'profile'}
          <section
            class="view"
            data-testid="view-profile"
            in:viewIn
            out:viewOut
            use:keepScroll={'profile'}
          >
            <ProfileView />
          </section>
        {:else}
          <section
            class="view"
            data-testid="view-settings"
            in:viewIn
            out:viewOut
            use:keepScroll={'settings'}
          >
            <SettingsView />
          </section>
        {/if}
      {/if}
    </main>
    {#if closing}
      <div class="closing" data-testid="closing" role="status" transition:fade>
        <p class="closing-note">
          <Spinner size="sm" label={null} />{t.shell.closing(closing.activity)}
        </p>
      </div>
    {/if}
    <CloseDialog />
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
    border-left: var(--border-width) solid var(--border);
    background-color: var(--surface);
  }

  /* All views share one cell; during a switch the new one lies on top and covers the old. */
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

  /* The quieter ways on after a failed start: the log and the data folder. */
  .ways {
    display: flex;
    gap: var(--space-16);
  }
</style>
