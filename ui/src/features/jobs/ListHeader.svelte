<!--
  The header of the list column, the same in the three places. First row: the places as tabs
  (Eingang, Archiv, Papierkorb, each with how many jobs lie there, quiet; the Eingang's number
  moves on only once a fetch has ended; another place starts without the search, like a
  folder of a mail app) and at its right end the place's one action: in the Eingang "Postfach
  abrufen", the one primary of the Jobs view ("Abbrechen" in its place while a fetch goes;
  locked while the app scores the jobs anew, and without a mailbox, saying why; the slot is
  as wide as the wider of the two, so nothing jumps when a run starts), in the Papierkorb
  "Papierkorb leeren" (red, asks first), in the Archiv none. On macOS this row is the list's
  part of the toolbar row next to the traffic lights, and its empty parts move the window.
  Second row: the search, whose placeholder names what it searches (its × clears it), the
  order (a button with its menu: Nach Übereinstimmung, Nach Datum) and the funnel (an icon
  button, a coral dot while a filter is on), whose menu is the filter table
  (lib/state/filter.ts): Portal, Übereinstimmung under small headings, and "Filter
  zurücksetzen" while a filter is on. Without a usable profile the match order and the bands
  are off, saying why. A place that holds nothing has nothing to search, order or filter:
  the row stays, empty. While a filter is on, its parts stand as small chips under the row,
  each with its × (the row unfolds and folds away, the list glides). The bottom hairline
  shows only once the list below is scrolled. Under the rows one sentence says when a job
  action of the list failed (a move, its undo) or when jobs deleted for good could not leave
  the Excel file; it goes with the next list or the next action that works.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import Notice from '$components/Notice.svelte';
  import Tabs from '$components/Tabs.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import type { Place } from '$lib/ipc/types';
  import { fade, unfold } from '$lib/motion/transitions';
  import { dragBands } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import {
    activeFilters,
    FILTER_GROUPS,
    NO_FILTER,
    SORTS,
    type ListFilter,
  } from '$lib/state/filter';
  import { jobs } from '$lib/state/jobs.svelte';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { trashEmptied } from './actions';

  interface Props {
    /** The list below is scrolled away from its top. */
    scrolled?: boolean;
  }
  let { scrolled = false }: Props = $props();

  const place = $derived(jobs.place);
  /** The jobs of every place, whatever the search and the filter. */
  const totals = $derived(jobs.overviewCounts ?? jobs.counts);

  /** The Eingang's number while a fetch brings new jobs: it moves on once the run is over. */
  let inbox = $state(untrack(() => totals.inbox));
  $effect(() => {
    const now = totals.inbox;
    if (!run.active) inbox = now;
  });
  const places = $derived<{ id: Place; label: string; testid: string; count: number }[]>([
    { id: 'inbox', label: t.place.inbox, testid: 'place-inbox', count: inbox },
    { id: 'archive', label: t.place.archive, testid: 'place-archive', count: totals.archive },
    { id: 'trash', label: t.place.trash, testid: 'place-trash', count: totals.trash },
  ]);

  /** Another place starts without the search. */
  function choosePlace(next: Place): void {
    if (jobs.place !== next) jobs.setPlace(next, true);
  }

  /** The search, the order and the funnel: while the place holds jobs (or a search or a
   *  filter is on, to be taken off); a list that did not load has nothing to order. */
  const tools = $derived(
    jobs.status !== 'error' && (totals[place] > 0 || jobs.search.trim() !== '' || jobs.filtered),
  );

  let searchBox = $state<HTMLElement | null>(null);

  const sorts = $derived(SORTS.map((sort) => ({ id: sort, label: t.toolbar.sortLabel[sort] })));

  /* ---------------------------------------------------------------------- filter */

  /** The portals of the menu: the enabled ones in the app's order, and a chosen one switched
   *  off since (so it can be seen and taken off). */
  const portals = $derived(
    (app.state?.portals ?? [])
      .filter((line) => line.enabled || line.portal === jobs.filterChoice.portal)
      .map((line) => line.portal),
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

  /** A chip's ×: that part of the filter goes; the last one hands the focus to the funnel. */
  function dropChip(key: keyof ListFilter): void {
    const last = chips.length === 1;
    jobs.setFilter({ [key]: null });
    if (last) void focusFunnel();
  }

  /**
   * The funnel's menu below it, its right edge on the button's: the table's groups in their
   * order, each under its heading, the chosen entry checked; while a filter is on, the way
   * back. A second click on the open funnel closes it (the press outside does). Opened from
   * the keyboard, its first entry is active at once (like the OS).
   */
  function openFunnel(event: MouseEvent): void {
    if (funnelBox === null || menuState.open !== null) return;
    const filter = jobs.filter;
    const entries: MenuEntry[] = [];
    for (const group of FILTER_GROUPS) {
      if (entries.length > 0) entries.push({ kind: 'separator' });
      entries.push({ kind: 'heading', label: group.heading(t) });
      const reason = app.hasProfile ? null : (group.needsProfile?.(t) ?? null);
      for (const entry of group.entries(portals)) {
        entries.push({
          id: entry.id,
          label: entry.label(t),
          checked: filter[group.key] === entry.value,
          disabled: reason !== null,
          reason,
          run: () => jobs.setFilter({ [group.key]: entry.value }),
        });
      }
    }
    if (jobs.filtered) {
      entries.push(
        { kind: 'separator' },
        { id: 'filter-reset', label: t.toolbar.filterReset, run: () => jobs.setFilter(NO_FILTER) },
      );
    }
    funnelOpen = true;
    openMenu({
      label: t.toolbar.filter,
      anchor: { kind: 'below', rect: funnelBox.getBoundingClientRect(), align: 'end' },
      entries,
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
  }
</script>

{#snippet fetchButton(live: boolean)}
  <Button
    size="field"
    variant={app.hasMailbox && app.hasPortal ? 'primary' : 'secondary'}
    icon="fetch"
    label={t.toolbar.fetch}
    disabled={run.fetchBlocked !== null}
    disabledReason={run.fetchBlocked}
    wide
    testid={live ? 'fetch' : null}
    onclick={() => void run.start({ kind: 'fetch' })}
  />
{/snippet}

{#snippet cancelButton(live: boolean)}
  <Button
    size="field"
    variant="secondary"
    icon="cancel"
    label={t.toolbar.cancel}
    loading={live && run.cancelling}
    wide
    testid={live ? 'cancel-run' : null}
    onclick={() => void run.cancel()}
  />
{/snippet}

<div class="header" class:scrolled data-testid="list-header" data-press-only>
  <div class="places" data-tauri-drag-region={dragBands() ? '' : undefined}>
    <Tabs
      options={places}
      value={place}
      label={t.place.tabs}
      testid="places"
      onchange={choosePlace}
    />
    {#if place === 'inbox'}
      <!-- The other button stands invisible in the same cell and only keeps the width. -->
      <span class="action" data-testid="place-action">
        {#if run.fetching}
          <span class="live" in:fade>{@render cancelButton(true)}</span>
          <span class="spare" aria-hidden="true" inert>{@render fetchButton(false)}</span>
        {:else}
          <span class="live" in:fade>{@render fetchButton(true)}</span>
          <span class="spare" aria-hidden="true" inert>{@render cancelButton(false)}</span>
        {/if}
      </span>
    {:else if place === 'trash' && inTrash > 0}
      <span class="action" data-testid="place-action">
        <Button
          variant="ghost"
          size="field"
          icon="purge"
          label={t.actions.emptyTrash}
          disabled={run.active}
          disabledReason={run.busyText}
          warns
          testid="empty-trash"
          onclick={() => {
            emptyError = null;
            confirmEmpty = true;
          }}
        />
      </span>
    {/if}
  </div>
  <div class="top" data-tauri-drag-region={dragBands() ? '' : undefined}>
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
      <span class="order">
        <MenuButton
          options={sorts}
          value={app.hasProfile ? jobs.sortChoice : 'newest'}
          disabled={!app.hasProfile}
          disabledReason={t.toolbar.sortNoProfile}
          field
          testid="sort"
          menuLabel={t.toolbar.sortMenu}
          onchange={(sort) => jobs.setSort(sort)}
        />
      </span>
      <span class="funnel" bind:this={funnelBox}>
        <Button
          variant="secondary"
          size="field"
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
      <div class="chips" data-testid="filter-chips">
        {#each chips as chip (chip.key)}
          <span class="chip" transition:fade>
            <Button
              variant="secondary"
              size="sm"
              label={chip.label}
              trailing="close"
              testid="chip-{chip.key}"
              onclick={() => dropChip(chip.key)}
            />
          </span>
        {/each}
      </div>
    </div>
  {/if}
  {#if jobs.actionError}
    <div class="note">
      <Notice tone="danger" variant="inline" text={jobs.actionError} testid="header-error" />
    </div>
  {:else if jobs.exportNote}
    <div class="note">
      <Notice tone="warning" variant="inline" text={jobs.exportNote} testid="header-export" />
    </div>
  {/if}
</div>

<Dialog
  bind:open={confirmEmpty}
  variant="danger"
  heading={t.actions.emptyTrashHeading}
  text={t.actions.emptyTrashText(inTrash)}
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
    padding: var(--list-header-top) var(--pane-padding) var(--pane-padding);
    border-bottom: var(--border-width) solid transparent;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }

  .scrolled {
    border-bottom-color: var(--border);
  }

  /* The rows span the header's side padding too, so on macOS their empty ends move the
     window like the rest of the toolbar row. A narrow column puts the action under the
     tabs. */
  .places {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8) var(--space-16);
    min-height: var(--tabs-height);
    margin: 0 calc(-1 * var(--pane-padding));
    padding: 0 var(--pane-padding);
  }

  /* One height whatever it holds (an empty place keeps the row, empty). A narrow column
     puts the order and the funnel under the search. */
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--list-toolbar);
    margin: var(--space-12) calc(-1 * var(--pane-padding)) 0;
    padding: 0 var(--pane-padding);
  }

  .search {
    display: flex;
    flex: 1 1 30%;
    min-width: 0;
  }

  .order,
  .funnel {
    display: inline-flex;
    flex: none;
  }

  /* Both buttons of the Eingang in one cell: the slot is as wide as the wider one. */
  .action {
    display: grid;
    flex: none;
    margin-left: auto;
  }

  .live,
  .spare {
    display: flex;
    grid-area: 1 / 1;
  }

  .spare {
    visibility: hidden;
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
    padding-top: var(--space-12);
  }
</style>
