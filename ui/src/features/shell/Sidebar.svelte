<!--
  The calm sidebar (196 px, icons only below 1100 px) on the cream: no surface of its own,
  the white sheet of the content is the divider. App icon and name live in the native title
  bar of the OS, so the sidebar starts with the views (on macOS below the traffic lights,
  whose 52 px band moves the window): Übersicht, Jobs, Profil, Einstellungen, each with its
  icon and no count, the first on the first line of every view; Ctrl/Cmd+1 to 4 choose them
  (the keys stand in their tooltips). The places of the jobs (Eingang, Archiv, Papierkorb)
  are tabs above the list. At the foot a quiet run status on one line (what happened last
  and when) that opens the run in the Jobs view. It shows only while there is a run to open,
  and it is said once: while the run card is on screen it steps aside. In the demo a quiet
  line "Demo" stands above it (the title bar says so on Windows only; macOS hides it).
  Before the first fetch Jobs is the setup page and the Übersicht waits, saying why;
  Profil and Einstellungen can be reached. A press here never takes the focus (the list
  keeps its keys). Below 1100 px it folds to its icons by the window width alone.
-->
<script lang="ts">
  import DragBand from '$components/DragBand.svelte';
  import SideNav, { type SideNavItem } from '$components/SideNav.svelte';
  import StatusLine from '$components/StatusLine.svelte';
  import { t } from '$lib/i18n/t';
  import { settled } from '$lib/motion/settled.svelte';
  import { fade } from '$lib/motion/transitions';
  import { dragBands, keyLabel } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { viewport } from '$lib/state/viewport.svelte';

  const setup = $derived(shell.firstRun);
  /** The four views. Before the first fetch the Übersicht waits (nothing to sum up yet) and
   *  Jobs is the setup page. */
  const items = $derived<SideNavItem<ViewId>[]>([
    {
      id: 'overview',
      label: t.nav.overview,
      icon: 'layout-dashboard',
      testid: 'nav-overview',
      hint: keyLabel('mod+1'),
      disabled: setup ? t.nav.overviewLater : null,
    },
    {
      id: 'jobs',
      label: t.nav.jobs,
      icon: 'briefcase',
      testid: 'nav-jobs',
      hint: keyLabel('mod+2'),
    },
    {
      id: 'profile',
      label: t.nav.profile,
      icon: 'user-round',
      testid: 'nav-profile',
      hint: keyLabel('mod+3'),
    },
    {
      id: 'settings',
      label: t.nav.settings,
      icon: 'settings',
      testid: 'nav-settings',
      hint: keyLabel('mod+4'),
    },
  ]);
  // The last fetch: a rescore of this session is no fetch.
  const fetched = $derived(run.summary?.kind === 'rescore' ? null : run.summary);
  const last = $derived(fetched ?? app.state?.lastRun ?? null);
  const outcome = $derived(run.active ? null : (last?.outcome.kind ?? null));
  const failed = $derived(outcome === 'failed');
  const status = $derived.by(() => {
    if (run.active) {
      if (run.status) return t.run.statusOf(run.status.code, run.status.portal);
      return run.step ? t.run.step[run.step] : t.run.kind[run.kind ?? 'fetch'];
    }
    if (last === null) return t.run.never;
    // The time moves on ("08:30" becomes the date after midnight): read the shared clock.
    void clock.now;
    // What happened last and when, in the same short form in every state (one line).
    if (outcome === 'failed') return t.shell.runFailed(last.finishedAt);
    if (outcome === 'cancelled') return t.shell.runCancelled(last.finishedAt);
    return t.shell.last(last.finishedAt);
  });
  // A click opens the run card: without a run to open the status would be a dead button.
  // The run card says the same while it is on screen.
  // The status that arrives with the first data is simply there (no fade at start).
  const motion = settled();
  const statusShown = $derived(
    (run.active || last !== null) &&
      !(navigation.current === 'jobs' && !shell.firstRun && shell.runCard && !shell.listHidden),
  );

  /** The view (an unsaved Profil may keep it and ask). */
  function choose(id: ViewId): void {
    navigation.go(id);
  }
</script>

<aside class="sidebar" class:rail={viewport.rail} data-testid="sidebar" data-press-only>
  {#if dragBands()}<span class="lights"><DragBand /></span>{/if}
  <!-- Until the state is known nothing is guessed (like the views): the entries come with it,
       as they are, instead of changing their colours in front of the user. -->
  {#if app.state !== null}
    <div class="nav">
      <!-- The setup page stands for Jobs: Jobs is marked current while it shows. -->
      <SideNav
        {items}
        active={setup && navigation.current === 'overview' ? 'jobs' : navigation.current}
        label={t.nav.label}
        collapsed={viewport.rail}
        onselect={choose}
      />
    </div>
  {/if}

  {#if app.state?.demo}
    <!-- The demo (`--demo`) says so on every view, so nobody takes its samples for real. -->
    <p class="demo" data-testid="demo-mark">{t.nav.demo}</p>
  {/if}

  {#if statusShown}
    <div class="status" transition:fade={{ on: motion.ready }}>
      <StatusLine
        text={status}
        label={t.shell.showRun}
        icon={failed ? 'triangle-alert' : 'history'}
        tone={failed ? 'danger' : 'neutral'}
        busy={run.active}
        progress={run.active && !viewport.rail ? run.fraction : undefined}
        progressLabel={t.toolbar.progress}
        collapsed={viewport.rail}
        testid="run-status"
        onclick={() => run.show()}
      />
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    width: var(--sidebar-width);
    height: 100%;
    padding: 0 var(--space-12) var(--space-12);
  }

  .rail {
    align-items: center;
    width: var(--rail-width);
  }

  /* The traffic lights' band spans the whole width of the sidebar. */
  .lights {
    display: flex;
    flex-direction: column;
    align-self: stretch;
    margin: 0 calc(-1 * var(--space-12));
  }

  /* The first entry starts on the first line of every view (below the sheet's top edge,
     which macOS does not draw). */
  .nav {
    margin-top: calc(var(--pane-padding) + var(--sheet-top-edge));
  }

  .status {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: auto;
  }

  /* The demo's quiet line at the foot, above the run status (the text where the nav's
     icons start; centred in the rail). */
  .demo {
    margin-top: auto;
    padding: var(--space-8) var(--space-12);
    color: var(--text-subtle);
    font: var(--type-xs);
  }

  .rail .demo {
    padding-inline: 0;
  }

  .demo + .status {
    margin-top: 0;
  }
</style>
