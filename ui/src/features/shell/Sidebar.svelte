<!--
  The sidebar: a solid cream column below the top bar with a hairline at its right edge (the
  view's border), the views in it (Jobs, Profil, Einstellungen, each with its glyph and no
  count) and nothing at its foot. Its first entry is centred in the first row of every view,
  so its middle lies on one line with the list's tabs and the pages' first heading (y = 59 on
  Windows; the entry's top at 43, a pixel above --head-pad, because the entry is 2 px taller
  than the row). The places of the jobs (Aktuell, Archiv, Papierkorb) are tabs above the
  list. The setup shows no sidebar. A press here never takes the focus (the list keeps its
  keys).
  Like the Claude app's (user, 2026-09-27) it is docked beside the view (its width is the
  user's, shell.sidebarWidth) or folded away; folded it floats over the view (`floating`,
  App: inside a rounded card, its entries where the docked ones stand), and a choice there
  folds it again.
-->
<script lang="ts">
  import SideNav, { type SideNavItem } from '$components/SideNav.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import { app } from '$lib/state/app.svelte';
  import { navigation, type ViewId } from '$lib/state/navigation.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { VIEWS } from '$lib/views';

  interface Props {
    /** Floats over the view (the folded sidebar). */
    floating?: boolean;
    /** An entry was chosen. */
    onchoose?: () => void;
  }

  let { floating = false, onchoose }: Props = $props();

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
    onchoose?.();
  }

  const width = $derived(
    shell.sidebarWidth === undefined || floating
      ? {}
      : { 'sidebar-live': `${shell.sidebarWidth}px` },
  );
</script>

<aside
  class="sidebar"
  class:floating
  data-testid={floating ? 'sidebar-floating' : 'sidebar'}
  data-press-only
  use:cssVars={width}
>
  <!-- Until the state is known nothing is guessed (like the views): the entries come with it,
       as they are, instead of changing their colours in front of the user. -->
  {#if app.state !== null}
    <div class="nav">
      <SideNav {items} active={navigation.current} label={t.nav.label} onselect={choose} />
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    width: var(--sidebar-live, var(--sidebar-width));
    height: 100%;
    padding: 0 var(--sidebar-pad-x) var(--sidebar-pad-end);
    background-color: var(--bg);
  }

  /* The first entry is centred in the first row of every view. */
  .nav {
    margin-top: calc(var(--head-pad) + (var(--first-row) - var(--nav-row)) / 2);
  }

  /* Floating: the card around it is --peek-inset in from the window's edge and pads its
     entries by as much again, so they stand where the docked ones do and their pills are
     concentric with the card's corners. */
  .floating {
    width: 100%;
    padding: var(--peek-inset);
  }

  .floating .nav {
    margin-top: 0;
  }
</style>
