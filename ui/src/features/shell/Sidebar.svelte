<!--
  The calm sidebar (196 px, icons only below 1100 px) on the cream: no surface of its own,
  the white sheet of the content is the divider. App icon and name live in the native title
  bar of the OS, so the sidebar starts with the views (on macOS below the traffic lights,
  whose 52 px band moves the window): Jobs, Profil, Einstellungen, each with its icon and no
  count, the first on the first line of every view. The places of the jobs (Eingang, Archiv,
  Papierkorb) are tabs above the list. Before the first fetch the setup page stands for Jobs;
  every entry can be chosen, as always. In the demo a quiet line "Demo" stands at the foot
  (the title bar says so on Windows only; macOS hides it). A press here never takes the
  focus (the list keeps its keys). Below 1100 px it folds to its icons by the window width
  alone; only then do the names show as tooltips.
-->
<script lang="ts">
  import DragBand from '$components/DragBand.svelte';
  import SideNav, { type SideNavItem } from '$components/SideNav.svelte';
  import { t } from '$lib/i18n/t';
  import { dragBands } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { viewport } from '$lib/state/viewport.svelte';
  import { VIEWS } from '$lib/views';

  /** The views of lib/views.ts (name, icon). */
  const items = $derived<SideNavItem<ViewId>[]>(
    VIEWS.map((view) => ({
      id: view.id,
      label: t.nav[view.label],
      icon: view.icon,
      testid: `nav-${view.id}`,
    })),
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
      <SideNav
        {items}
        active={navigation.current}
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

  /* The demo's quiet line at the foot (the text where the nav's icons start; centred in the
     rail). */
  .demo {
    margin-top: auto;
    padding: var(--space-8) var(--space-12);
    color: var(--text-subtle);
    font: var(--type-xs);
  }

  .rail .demo {
    padding-inline: 0;
  }
</style>
