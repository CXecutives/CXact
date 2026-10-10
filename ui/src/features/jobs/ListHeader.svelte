<!--
  The header of the list column, the same in the three places: the view's head (PageHeader)
  above the list, with a hairline under it once the list scrolled beneath it. First row: the places as
  tabs (Aktuell, Archiv, Papierkorb, their names only, the one segmented look of the app;
  another place starts without the search, like a folder of a mail app) and at its right end
  the place's one action in one slot (at least --place-action wide, its right edge fixed, so
  a swap moves nothing): while a search goes "Abbrechen" with the hollow square, in every
  place; else in Aktuell "Jobs suchen" with the magnifier (the alert mails, then the
  portals), the one primary of the Jobs view, with or without a mailbox, locked while the app
  scores the jobs anew and while its way cannot run, saying why; in the Papierkorb "Papierkorb
  leeren" (outlined with the red of every button that deletes; asks first); in the Archiv
  none. A narrow column puts the action under the tabs.
  Second row: the search, whose placeholder names what it searches (its × clears it), and the
  funnel.
  The funnel "Sortieren und filtern" (an icon button, a coral dot while a filter is on; the order
  sets none), the one control of the order and the filter: its menu holds, under small
  headings, "Sortierung" (Nach Übereinstimmung, Nach Datum, Nach Tagessatz), then the filter
  table (lib/state/filter.ts: Portal, Übereinstimmung, Neu seit, each with every value of its
  dimension; the portals in the UI's order, lib/portals.ts), and "Filter zurücksetzen" at the end, off while no filter is
  on (so the menu never changes its height). The menu stays open while choosing (several
  groups in one go, the check marks move with each choice) and closes on a press outside,
  Esc or the funnel; "Filter zurücksetzen" closes it. Without a usable profile the order and
  the bands are off, saying why. A place that holds nothing has nothing to search, order or
  filter: the row stays, empty; while a fetch fills Aktuell its tools stand already (no
  empty band above the run line, nothing moves when the first jobs come). While a filter is
  on, its parts
  stand as small chips under the row, each with its × (the row unfolds and folds away, the
  list glides). Under them the run's one line (RunLine): its progress while a fetch goes, or
  what went wrong. Under the rows one sentence says when a job action of the list failed (a
  move, its undo); it goes with the next list or the next action that works.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
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
  import { toasts } from '$lib/state/toasts.svelte';
  import { trashEmptied } from './actions';
  import { funnelEntries } from './headerMenus';
  import RunLine from './RunLine.svelte';

  interface Props {
    /** The list is scrolled away from its top: the header shows its hairline. */
    scrolled?: boolean;
  }
  let { scrolled = false }: Props = $props();

  const place = $derived(jobs.place);
  /** The jobs of every place, whatever the search and the filter. */
  const totals = $derived(jobs.overviewCounts ?? jobs.counts);

  const places = $derived<SegmentedOption<Place>[]>([
    { id: 'inbox', label: t.place.inbox, testid: 'place-inbox' },
    { id: 'archive', label: t.place.archive, testid: 'place-archive' },
    { id: 'trash', label: t.place.trash, testid: 'place-trash' },
  ]);

  /** Another place starts without the search. */
  function choosePlace(next: Place): void {
    if (jobs.place !== next) jobs.setPlace(next, true);
  }

  /** The search and the funnel: while the place holds jobs (or a search or a filter is on,
   *  to be taken off, or a fetch fills Aktuell); a list that did not load has nothing to
   *  order. */
  const tools = $derived(
    jobs.status !== 'error' &&
      (totals[place] > 0 ||
        jobs.search.trim() !== '' ||
        jobs.filtered ||
        (run.fetching && place === 'inbox')),
  );

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
  /** The chosen parts of the filter, one chip each. */
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

  /* ----------------------------------------------------------------------- trash */

  let confirmEmpty = $state(false);
  let emptying = $state(false);
  let emptyError = $state<string | null>(null);
  /** Every job of the trash, whatever the search: emptying it deletes them all. */
  const inTrash = $derived(totals.trash);
  /** The Papierkorb holds jobs: "Papierkorb leeren" is its action. */
  const emptiable = $derived(place === 'trash' && inTrash > 0);
  /** How many the dialog names: counted when it opens, so it never says 0 while it fades. */
  let emptyCount = $state(0);
  let placesBox = $state<HTMLElement | null>(null);

  function askEmpty(): void {
    emptyError = null;
    emptyCount = inTrash;
    confirmEmpty = true;
  }

  async function emptyTrash(): Promise<void> {
    emptying = true;
    emptyError = null;
    const result = await jobs.emptyTrash();
    emptying = false;
    if ('error' in result) {
      emptyError = result.error;
      return;
    }
    confirmEmpty = false;
    trashEmptied(result);
    toasts.show(t.toast.trashEmptied);
    void jobs.loadOverview();
    // Its button went with the jobs: the focus goes to the Papierkorb's tab, not to the top
    // of the window.
    await tick();
    placesBox?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }
</script>

<div class="header" data-testid="list-header" data-press-only>
  <PageHeader line={scrolled}>
    {#snippet lead()}
      <span class="places" bind:this={placesBox}>
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
      {#if run.fetching || place === 'inbox' || emptiable}
        <span class="action" data-testid="place-action">
          {#if run.fetching}
            <Button
              variant="secondary"
              icon="cancel"
              label={t.toolbar.cancel}
              loading={run.cancelling}
              wide
              testid="cancel-run"
              onclick={() => void run.cancel()}
            />
          {:else if place === 'inbox'}
            <Button
              variant="primary"
              icon="search"
              label={t.toolbar.searchNow}
              disabled={run.fetchBlocked !== null}
              disabledReason={run.fetchBlocked}
              wide
              testid="fetch"
              onclick={() => void run.start({ kind: 'fetch' })}
            />
          {:else}
            <Button
              variant="secondary"
              icon="trash"
              label={t.actions.emptyTrash}
              disabled={run.active}
              disabledReason={run.busyText}
              warns
              wide
              testid="empty-trash"
              onclick={askEmpty}
            />
          {/if}
        </span>
      {/if}
    {/snippet}
    <div class="top">
      {#if tools}
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
        <span class="funnel" bind:this={funnelBox}>
          <Button
            variant="secondary"
            iconOnly
            icon="filter"
            label={t.toolbar.filter}
            dot={jobs.filtered}
            menu
            expanded={funnelOpen}
            testid="filter"
            onclick={openFunnel}
          />
        </span>
      {/if}
    </div>
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
  </PageHeader>
</div>

<Dialog
  bind:open={confirmEmpty}
  variant="danger"
  heading={t.actions.emptyTrashHeading}
  text={t.actions.emptyTrashText(emptyCount)}
  confirmLabel={t.actions.emptyTrash}
  busy={emptying}
  error={emptyError}
  testid="dialog-empty-trash"
  onconfirm={() => void emptyTrash()}
/>

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

  /* One height whatever it holds (an empty place keeps the row, empty). A narrow column
     puts the funnel under the search. */
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--list-toolbar);
    margin-top: var(--space-10);
  }

  .search {
    display: flex;
    flex: 1 1 30%;
    min-width: 0;
  }

  .funnel {
    display: inline-flex;
    flex: none;
  }

  /* The place's one action: at least --place-action wide, its button filling it. */
  .action {
    display: flex;
    flex: none;
    min-width: var(--place-action);
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
</style>
