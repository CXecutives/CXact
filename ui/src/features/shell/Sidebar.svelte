<!--
  The calm sidebar on the window's colour below the top bar: no surface of its own, the
  view's sheet is the divider.   It starts with the views: Jobs, Profil, Einstellungen, each
  with its icon and no count, the first on the first line of every view. Under Jobs its ways
  can stand (Suche and Alert-Mails, each the list of the jobs that came that way, a chevron
  at the end of Jobs folding them); hidden for now (user decision 2026-10-01: one list, the
  menu beside the fetch chooses what it reads), their code kept (WAYS_SHOWN). The places of the
  jobs (Eingang, Archiv, Papierkorb) are tabs above the list. Before the first fetch the
  setup page stands for Jobs; every entry can be chosen, as always. In the demo a quiet line
  "Demo" stands at the foot. A press here never takes the focus (the list keeps its keys).
  Like the Claude app's (user, 2026-09-27) it is docked beside the view (its width is the
  user's, shell.sidebarWidth) or folded away; folded it floats over the view (`floating`,
  App), and a choice there folds it again.
-->
<script lang="ts">
  import SideNav, { type SideNavItem } from '$components/SideNav.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import type { Origin } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
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

  /** An entry: a view, or a way of the jobs under Jobs. */
  type EntryId = ViewId | 'jobs-search' | 'jobs-mail';
  const WAYS: readonly {
    id: EntryId;
    area: Origin;
    label: () => string;
    icon: 'search' | 'alertMail';
  }[] = [
    { id: 'jobs-search', area: 'search', label: () => t.nav.search, icon: 'search' },
    { id: 'jobs-mail', area: 'mail', label: () => t.nav.mail, icon: 'alertMail' },
  ];

  /** The ways under Jobs are shown (hidden for now, user decision 2026-10-01). */
  const WAYS_SHOWN = false;

  /** Folds the ways; one of them shown, the list shows every job again. */
  function toggleWays(): void {
    if (shell.waysOpen && jobs.area !== null) jobs.setArea(null);
    shell.toggleWays();
  }

  /** The views of lib/views.ts (name, icon), the ways under Jobs while they are open. */
  const items = $derived<SideNavItem<EntryId>[]>(
    VIEWS.flatMap((view): SideNavItem<EntryId>[] => {
      const item: SideNavItem<EntryId> = {
        id: view.id,
        label: t.nav[view.label],
        icon: view.icon,
        testid: `nav-${view.id}`,
      };
      if (view.id !== 'jobs' || !WAYS_SHOWN) return [item];
      const ways = shell.waysOpen
        ? WAYS.map((way) => ({
            id: way.id,
            label: way.label(),
            icon: way.icon,
            testid: `nav-${way.id}`,
            nested: true,
          }))
        : [];
      return [
        { ...item, fold: { open: shell.waysOpen, label: t.nav.ways, ontoggle: toggleWays } },
        ...ways,
      ];
    }),
  );

  /** The entry shown: a way of the jobs, or the view. */
  const active = $derived<EntryId>(
    navigation.current !== 'jobs'
      ? navigation.current
      : (WAYS.find((way) => way.area === jobs.area)?.id ?? 'jobs'),
  );

  /** The view (an unsaved Profil may keep it and ask), with the way of the jobs. */
  function choose(id: EntryId): void {
    const way = WAYS.find((entry) => entry.id === id);
    if (way !== undefined || id === 'jobs') {
      const area = way?.area ?? null;
      navigation.go('jobs', false, () => jobs.setArea(area));
    } else {
      navigation.go(id as ViewId);
    }
    onchoose?.();
  }

  const width = $derived(
    shell.sidebarWidth === undefined ? {} : { 'sidebar-live': `${shell.sidebarWidth}px` },
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
      <SideNav {items} {active} label={t.nav.label} onselect={choose} />
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
    width: var(--sidebar-live, var(--sidebar-width));
    height: 100%;
    padding: 0 var(--space-12) var(--space-12);
  }

  /* The first entry is centred in the first row of every view. */
  .nav {
    margin-top: calc(var(--pane-padding) + (var(--first-row) - var(--control-md)) / 2);
  }

  /* The demo's quiet line at the foot (the text where the nav's icons start). */
  .demo {
    margin-top: auto;
    padding: var(--space-8) var(--space-12);
    color: var(--text-subtle);
    font: var(--type-xs);
  }
</style>
