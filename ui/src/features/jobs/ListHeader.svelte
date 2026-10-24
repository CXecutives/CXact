<!--
  The header of the list column (the round 10 draft), the same in the three places: the
  view's head (PageHeader) above the list, 8 16 10, with a hairline under it once the list
  scrolled beneath it where no day's heading sticks at the top (`line`).
  First row: the places as tabs (Aktuell, Archiv, Papierkorb, their names only, the one
  segmented look of the app; another place starts without the search, like a folder of a
  mail app) and at its right end the place's one action, which keeps one width whichever
  word it shows (Button `sizeTo`): while a search or a rescore goes "Abbrechen" with the
  hollow square, in every place; else in Aktuell "Jobs suchen" with the magnifier (the alert
  mails, then the portals), the one primary of the Jobs view, with or without a mailbox,
  locked while its way cannot run, saying why (without a usable profile what it lacks: "Ergänze
  erst Länder und Sprachen im Profil."); in the Archiv and the Papierkorb none. A narrow column
  puts the action under the tabs.
  Second row, also in a place that holds nothing (decision 24: nothing jumps when the first
  jobs come): the search, whose placeholder names what it searches (its × clears it), and in
  Aktuell and the Archiv the funnel "Sortieren und filtern", a 30 px square, the one control
  of the order and the filter: its menu holds, under small headings, "Sortierung" (Nach
  Übereinstimmung, Nach Datum, Nach Tagessatz), then the filter table (lib/state/filter.ts:
  Portal, Übereinstimmung, Neu seit, each with every value of its dimension; the portals in
  the UI's order, lib/portals.ts), and "Filter zurücksetzen" at the end, off while no filter
  is on (so the menu never changes its height). The menu stays open while choosing and closes
  on a press outside, Esc or the funnel; "Filter zurücksetzen" closes it. Without a usable
  profile the order and the bands are off, saying why. The Papierkorb has no funnel and no
  filter (decision 25). While a filter is on, its parts stand as small chips under the row,
  each with its × (the row unfolds and folds away, the list glides). Under them the run's
  strip (RunLine). Under it one sentence says when a job action of the list failed (a move,
  its undo); it goes with the next list or the next action that works. A list that did not
  load has nothing to search: the second row goes.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import Segmented, { type SegmentedOption } from '$components/Segmented.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import type { Place } from '$lib/ipc/types';
  import { fade, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { inPortalOrder } from '$lib/portals';
  import { activeFilters, dropFrom, NO_FILTER, type ActiveFilter } from '$lib/state/filter';
  import { jobs } from '$lib/state/jobs.svelte';
  import { menuState, openMenu } from '$lib/state/menu.svelte';
  import { run } from '$lib/state/run.svelte';
  import { funnelEntries } from './headerMenus';
  import { profileGaps } from './profileGaps';
  import RunLine from './RunLine.svelte';

  interface Props {
    /** The list scrolled beneath it and no day's heading sticks at its top: the hairline. */
    line?: boolean;
  }
  let { line = false }: Props = $props();

  const place = $derived(jobs.place);

  const places = $derived<SegmentedOption<Place>[]>([
    { id: 'inbox', label: t.place.inbox, testid: 'place-inbox' },
    { id: 'archive', label: t.place.archive, testid: 'place-archive' },
    { id: 'trash', label: t.place.trash, testid: 'place-trash' },
  ]);

  /** Another place starts without the search. */
  function choosePlace(next: Place): void {
    if (jobs.place !== next) jobs.setPlace(next, true);
  }

  /** A search or a rescore goes: "Abbrechen" in every place. */
  const cancellable = $derived(run.searching || (run.active && run.kind === 'rescore'));
  /** Why "Jobs suchen" waits: a run, a profile that lacks something (named), nothing to
   *  read. */
  const fetchBlocked = $derived(
    !run.active && !app.hasProfile ? profileGaps().reason : run.fetchBlocked,
  );
  /** The faces of the place action, each reserving the other's width. */
  const SEARCH = { label: t.toolbar.searchNow, icon: 'search' } as const;
  const CANCEL = { label: t.toolbar.cancel, icon: 'cancel' } as const;

  /** The search (and the funnel) stand unless the list did not load. */
  const tools = $derived(jobs.status !== 'error');
  /** The Papierkorb has no filter. */
  const filterable = $derived(place !== 'trash');

  let searchBox = $state<HTMLElement | null>(null);

  /* ---------------------------------------------------------------------- filter */

  /** The sources of the menu: every one switched on, jobs or not yet (user 2026-10-01), in
   *  the UI's order (lib/portals.ts), and a chosen one switched off since (so it can be seen
   *  and taken off). */
  const portals = $derived(
    inPortalOrder(
      (app.state?.portals ?? []).filter(
        (line) => line.enabled || jobs.filterChoice.portals.includes(line.portal),
      ),
    ).map((line) => line.portal),
  );
  /** The chosen parts of the filter, one chip each (none in the Papierkorb). */
  const chips = $derived(activeFilters(jobs.filter, portals, t));

  let funnelBox = $state<HTMLElement | null>(null);
  let funnelOpen = $state(false);

  /** The funnel's button (the keyboard focus lands there when what held it goes), else the
   *  search. */
  async function focusFunnel(): Promise<void> {
    await tick();
    const target =
      funnelBox?.querySelector<HTMLElement>('button') ?? searchBox?.querySelector('input');
    target?.focus();
  }

  /**
   * Takes the whole filter off ("Filter zurücksetzen" of a filter that leaves nothing). The
   * button goes with what it stood in: the keyboard focus goes to the funnel, not to the top
   * of the window.
   */
  export async function resetFilter(): Promise<void> {
    jobs.setFilter(NO_FILTER);
    await focusFunnel();
  }

  /** A chip's ×: that choice of the filter goes; the last one hands the focus to the funnel. */
  function dropChip(chip: ActiveFilter): void {
    const last = chips.length === 1;
    jobs.setFilter(dropFrom(jobs.filterChoice, chip.key, chip.value));
    if (last) void focusFunnel();
  }

  /**
   * The funnel's menu below it, its right edge on the button's. A second click on the open
   * funnel closes it (the press outside does). Opened from the keyboard, its first entry is
   * active at once (like the OS).
   */
  function openFunnel(event: MouseEvent): void {
    if (funnelBox === null || menuState.open !== null) return;
    funnelOpen = true;
    openMenu({
      label: t.toolbar.filter,
      anchor: { kind: 'below', rect: funnelBox.getBoundingClientRect(), align: 'end' },
      entries: funnelEntries(portals),
      refresh: () => funnelEntries(portals),
      fromKeyboard: event.detail === 0,
      onclose: () => (funnelOpen = false),
    });
  }
</script>

<div class="header" data-testid="list-header" data-press-only>
  <PageHeader {line}>
    {#snippet lead()}
      <span class="places">
        <Segmented
          tabs
          options={places}
          value={place}
          label={t.place.tabs}
          testid="places"
          onchange={choosePlace}
        />
      </span>
    {/snippet}
    {#snippet actions()}
      {#if cancellable || place === 'inbox'}
        <span class="action" data-testid="place-action">
          {#if cancellable}
            <Button
              variant="secondary"
              icon={CANCEL.icon}
              label={CANCEL.label}
              sizeTo={[SEARCH]}
              loading={run.cancelling}
              testid="cancel-run"
              onclick={() => void run.cancel()}
            />
          {:else}
            <Button
              variant="primary"
              icon={SEARCH.icon}
              label={SEARCH.label}
              sizeTo={[CANCEL]}
              disabled={fetchBlocked !== null}
              disabledReason={fetchBlocked}
              testid="fetch"
              onclick={() => void run.start({ kind: 'fetch' })}
            />
          {/if}
        </span>
      {/if}
    {/snippet}
    {#if tools}
      <div class="top">
        <span class="search" bind:this={searchBox}>
          <TextField
            kind="search"
            value={jobs.search}
            label={t.place.search[place]}
            placeholder={t.place.search[place]}
            testid="search"
            oninput={(value) => jobs.setSearch(value)}
          />
        </span>
        {#if filterable}
          <span class="funnel" bind:this={funnelBox}>
            <Button
              variant="secondary"
              iconOnly
              icon="filter"
              label={t.toolbar.filter}
              menu
              expanded={funnelOpen}
              testid="filter"
              onclick={openFunnel}
            />
          </span>
        {/if}
      </div>
    {/if}
    {#if chips.length > 0}
      <div class="unfold" transition:unfold>
        <div class="chips" role="group" aria-label={t.toolbar.chips} data-testid="filter-chips">
          {#each chips as chip (chip.id)}
            <span class="chip" transition:fade>
              <Button
                variant="secondary"
                label={chip.label}
                trailing="close"
                testid="chip-{chip.id}"
                onclick={() => dropChip(chip)}
              />
            </span>
          {/each}
        </div>
      </div>
    {/if}
    <RunLine />
    {#if jobs.actionError}
      <div class="unfold" transition:unfold>
        <div class="note">
          <Notice tone="danger" variant="inline" text={jobs.actionError} testid="header-error" />
        </div>
      </div>
    {/if}
    <span class="tail" aria-hidden="true"></span>
  </PageHeader>
</div>

<style>
  /* The rows stack without a gap: each one below the first brings its own room at its top,
     inside what unfolds, so a row that comes or goes moves nothing at once. */
  .header {
    display: flex;
    flex: none;
    flex-direction: column;
  }

  .places {
    display: flex;
    min-width: 0;
  }

  /* The search and the funnel, 10 under the tabs, 8 apart. */
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--list-toolbar);
    margin-top: var(--space-10);
  }

  .search {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
  }

  .funnel {
    display: inline-flex;
    flex: none;
  }

  /* The place's one action at the end of the tabs' row. */
  .action {
    display: flex;
    flex: none;
    margin-left: auto;
  }

  .unfold {
    display: flex;
    flex-direction: column;
  }

  /* The chosen parts of the filter, each a small button with its ×. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    padding-top: var(--space-8);
  }

  .chip {
    display: inline-flex;
  }

  .note {
    padding-top: var(--space-10);
  }

  /* The head's 8 below its last row, and 2 more: 10, as under the draft's search. */
  .tail {
    display: block;
    height: var(--list-head-tail);
  }
</style>
