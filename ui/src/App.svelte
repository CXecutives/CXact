<!--
  The shell below the native title bar of the OS: the sidebar and the white sheet with the
  three views. Every view switch is the same quick cross-fade (100 ms): the new view fades in
  on top while the old one fades out below it, so no frame shows an empty sheet. On start
  nothing animates and the app shows useful content at once: the first-run page while
  nothing was ever fetched, otherwise the Jobs view with the last results. Closing while the
  app is busy keeps the window until that has stopped; a calm note says what it waits for
  (a fetch, a rescore, a sign-in, the files). Profil and Einstellungen keep where they were
  scrolled to while the app runs (a return finds the same place); on macOS their name
  stands small in the toolbar row. A start whose data cannot load says so and offers to try
  again, the log and the data folder. Ctrl+/ (Cmd+/) shows the card of the keys.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import DragBand from '$components/DragBand.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Menu from '$components/Menu.svelte';
  import Spinner from '$components/Spinner.svelte';
  import Toast from '$components/Toast.svelte';
  import Tooltip from '$components/Tooltip.svelte';
  import { keepScroll } from '$lib/actions/keepScroll';
  import { t } from '$lib/i18n/t';
  import { invoke, onClosing, reportUiError } from '$lib/ipc/api';
  import type { OpenTarget } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { dragBands } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import FirstRunView from './features/first-run/FirstRunView.svelte';
  import JobsView from './features/jobs/JobsView.svelte';
  import OverviewView from './features/overview/OverviewView.svelte';
  import ProfileView from './features/profile/ProfileView.svelte';
  import SettingsView from './features/settings/SettingsView.svelte';
  import KeysHelp from './features/shell/KeysHelp.svelte';
  import Sidebar from './features/shell/Sidebar.svelte';

  run.install();
  jobs.install();
  navigation.install();
  void app.load().then((state) => run.attach(state?.running ?? null));

  const firstRun = $derived(shell.firstRun);
  // Before the first fetch there is nothing to sum up: the app starts on the setup page.
  $effect(() => {
    if (firstRun && navigation.current === 'overview') navigation.go('jobs', true);
  });
  /** macOS: the views keep the toolbar row free (the Jobs view uses it for its list row). */
  const band = dragBands();
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
  <div class="body">
    <Sidebar />
    <main class="views">
      {#if app.error !== null && app.state === null}
        <section class="view fixed stage" data-testid="view-error">
          {#if band}<DragBand sheet />{/if}
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
          {#if band}<DragBand sheet />{/if}
          <div class="center">
            {#if app.slow}<Spinner size="lg" />{/if}
          </div>
        </section>
      {:else}
        <!-- The four views are the branches of one block: a switch between them cross-fades
             (local transitions), while the first view after loading is simply there. -->
        {#if navigation.current === 'overview' && !firstRun}
          <section class="view" data-testid="view-overview" transition:fade>
            {#if band}<DragBand sheet />{/if}
            <OverviewView />
          </section>
        {:else if (navigation.current === 'jobs' || navigation.current === 'overview') && firstRun}
          <section class="view" data-testid="view-first-run" transition:fade>
            {#if band}<DragBand sheet />{/if}
            <FirstRunView />
          </section>
        {:else if navigation.current === 'jobs'}
          <section class="view fixed" data-testid="view-jobs" transition:fade>
            <JobsView />
          </section>
        {:else if navigation.current === 'profile'}
          <section
            class="view"
            data-testid="view-profile"
            transition:fade
            use:keepScroll={'profile'}
          >
            {#if band}<DragBand sheet name={t.nav.profile} />{/if}
            <ProfileView />
          </section>
        {:else}
          <section
            class="view"
            data-testid="view-settings"
            transition:fade
            use:keepScroll={'settings'}
          >
            {#if band}<DragBand sheet name={t.nav.settings} />{/if}
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
  </div>
  <Toast />
  <KeysHelp />
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

  /* One white sheet for every view: the sidebar stays on the cream, the sheet's hairline and
     rounded corner are the only divider between them. */
  .views {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-top: var(--sheet-top-edge) solid var(--border);
    border-left: var(--border-width) solid var(--border);
    border-top-left-radius: var(--sheet-corner);
    background-color: var(--surface);
  }

  /* All views share one cell; during a switch the new one lies on top and covers the old.
     The keyboard focus stops below the macOS toolbar row (input.ts keepInView). */
  .view {
    grid-area: 1 / 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background-color: var(--surface);
    scroll-padding-top: var(--window-top);
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

  /* The loading and the failed start: the toolbar row on top (macOS), the rest centred. */
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
