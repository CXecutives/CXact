<!--
  The header of the list column, the same in the three places. First row: the places as tabs
  (Eingang, Archiv, Papierkorb, each with its icon and how many jobs lie there; the Eingang's
  number moves on only once a fetch has ended; another place starts without the search, like
  a folder of a mail app). A narrow column drops the tabs' numbers first, then their icons.
  Second row: the search, whose placeholder names what it searches (its × clears it), the
  funnel, and at the right end the place's one action: in the Eingang "Postfach abrufen", the
  one primary of the Jobs view, with an outlined icon button beside it that opens the menu
  "Zeitraum" (Seit dem letzten Abruf, Letzte 7 Tage, Letzte 30 Tage, Alle Alert-Mails, the
  current one checked; a choice is saved at once, lib/state/app.svelte.ts); "Abbrechen"
  stands in the fetch's place while a fetch goes, the two cross-fade in one cell as wide as
  the wider, so nothing jumps; the fetch is locked while the app scores the jobs anew, and
  without a mailbox, saying why. In the Papierkorb "Papierkorb leeren" (outlined, the trash
  in red, asks first), in the Archiv none. A narrow column puts the action under the search.
  The funnel "Sortieren und filtern" (an icon button, a coral dot while a filter is on; the order
  sets none), the one control of the order and the filter: its menu holds, under small
  headings, "Sortierung" (Nach Übereinstimmung, Nach Datum, Nach Tagessatz), then the filter
  table (lib/state/filter.ts: Portal, Übereinstimmung, Vertragsart, the work mode, the pay
  floor, then "Nur neue" as a switch of its own; the portals in the
  UI's order, lib/portals.ts), and "Filter zurücksetzen" at the end, off while no filter is
  on (so the menu never changes its height). The menu stays open while choosing (several
  groups in one go, the check marks move with each choice) and closes on a press outside,
  Esc or the funnel; "Filter zurücksetzen" closes it. Without a usable profile the order and
  the bands are off, saying why. A place that holds nothing has nothing to search, order or
  filter: the row stays, empty; while a fetch fills the Eingang its tools stand already (no
  empty band above the run line, nothing moves when the first jobs come). While a filter is
  on, its parts
  stand as small chips under the row, each with its × (the row unfolds and folds away, the
  list glides). Under them the run's one line (RunLine): its progress while a fetch goes, or
  what went wrong. The bottom hairline shows only once the list below is scrolled. Under the
  rows one sentence says when a job action of the list failed (a move, its undo, the choice
  of the Zeitraum) or when jobs deleted for good could not leave the Excel file; it goes
  with the next list or the next action that works.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice from '$components/Notice.svelte';
  import Tabs, { type TabOption } from '$components/Tabs.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import type { Place } from '$lib/ipc/types';
  import { fade, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { inPortalOrder } from '$lib/portals';
  import { activeFilters, NO_FILTER, type ListFilter } from '$lib/state/filter';
  import { jobs } from '$lib/state/jobs.svelte';
  import { menuState, openMenu } from '$lib/state/menu.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { trashEmptied } from './actions';
  import { funnelEntries, rangeEntries } from './headerMenus';
  import RunLine from './RunLine.svelte';

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
  const places = $derived<TabOption<Place>[]>([
    { id: 'inbox', label: t.place.inbox, icon: 'inbox', testid: 'place-inbox', count: inbox },
    {
      id: 'archive',
      label: t.place.archive,
      icon: 'archive',
      testid: 'place-archive',
      count: totals.archive,
    },
    {
      id: 'trash',
      label: t.place.trash,
      icon: 'trash',
      testid: 'place-trash',
      count: totals.trash,
    },
  ]);

  /** Another place starts without the search. */
  function choosePlace(next: Place): void {
    if (jobs.place !== next) jobs.setPlace(next, true);
  }

  /** The search and the funnel: while the place holds jobs (or a search or a filter is on,
   *  to be taken off, or a fetch fills the Eingang); a list that did not load has nothing to
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

  /** The portals of the menu: the enabled ones in the UI's order (lib/portals.ts), and a
   *  chosen one switched off since (so it can be seen and taken off). */
  const portals = $derived(
    inPortalOrder(
      (app.state?.portals ?? []).filter(
        (line) => line.enabled || line.portal === jobs.filterChoice.portal,
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

  /** A chip's ×: that part of the filter goes; the last one hands the focus to the funnel. */
  function dropChip(key: keyof ListFilter): void {
    const last = chips.length === 1;
    jobs.setFilter({ [key]: null });
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

  /* ----------------------------------------------------------------------- fetch */

  /** The Zeitraum's menu is open (its button keeps its hover look). */
  let rangeOpen = $state(false);
  /** The fetch's colour: the view's primary once a fetch can bring jobs. */
  const fetchVariant = $derived(app.hasMailbox && app.hasPortal ? 'primary' : 'secondary');

  /** The Zeitraum's menu below the fetch and its button, its right edge on the button's. */
  function openRange(event: MouseEvent): void {
    const control = (event.currentTarget as HTMLElement | null)?.closest('.fetch');
    if (!control || menuState.open !== null) return;
    rangeOpen = true;
    openMenu({
      label: t.toolbar.range,
      anchor: { kind: 'below', rect: control.getBoundingClientRect(), align: 'end' },
      entries: rangeEntries(),
      fromKeyboard: event.detail === 0,
      onclose: () => (rangeOpen = false),
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
  <span class="fetch">
    <Button
      size="field"
      variant={fetchVariant}
      icon="fetch"
      label={t.toolbar.fetch}
      disabled={run.fetchBlocked !== null}
      disabledReason={run.fetchBlocked}
      testid={live ? 'fetch' : null}
      onclick={() => void run.start({ kind: 'fetch' })}
    />
    <Button
      size="field"
      variant="secondary"
      iconOnly
      icon="range"
      label={t.toolbar.range}
      menu
      expanded={live && rangeOpen}
      testid={live ? 'fetch-range' : null}
      onclick={openRange}
    />
  </span>
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
  <div class="places">
    <Tabs
      options={places}
      value={place}
      label={t.place.tabs}
      testid="places"
      onchange={choosePlace}
    />
  </div>
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
    {#if place === 'inbox'}
      <!-- The other button stands invisible in the same cell and only keeps the width. -->
      <!-- Both stand in one cell as wide as the wider; only the one that fits the run shows
           and takes clicks (a fetch that ends at once simply shows "Postfach abrufen" again). -->
      <span class="action" data-testid="place-action">
        <span class="slot" class:shown={!run.fetching} inert={run.fetching}>
          {@render fetchButton(!run.fetching)}
        </span>
        <span class="slot" class:shown={run.fetching} inert={!run.fetching}>
          {@render cancelButton(run.fetching)}
        </span>
      </span>
    {:else if place === 'trash' && inTrash > 0}
      <span class="action" data-testid="place-action">
        <Button
          variant="secondary"
          size="field"
          icon="trash"
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
  {#if chips.length > 0}
    <div class="unfold" transition:unfold>
      <div class="chips" role="group" aria-label={t.toolbar.chips} data-testid="filter-chips">
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
  <RunLine />
  {#if jobs.actionError}
    <div class="unfold" transition:unfold>
      <div class="note">
        <Notice tone="danger" variant="inline" text={jobs.actionError} testid="header-error" />
      </div>
    </div>
  {:else if jobs.exportNote}
    <div class="unfold" transition:unfold>
      <div class="note">
        <Notice tone="warning" variant="inline" text={jobs.exportNote} testid="header-export" />
      </div>
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

  /* The tabs' row: the chosen pill's edge lines up with the search field's below. */
  .places {
    display: flex;
    align-items: center;
    min-height: var(--tabs-height);
  }

  /* One height whatever it holds (an empty place keeps the row with its action). A narrow
     column puts the action under the search. */
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

  /* The one out of turn fades away under the other (out of reach at once: inert). */
  .slot {
    display: flex;
    grid-area: 1 / 1;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .slot.shown {
    opacity: 1;
  }

  /* "Postfach abrufen" and the Zeitraum's button beside it. */
  .fetch {
    display: flex;
    gap: var(--space-8);
  }

  /* A column (JobsView .head) narrower than the three tabs drops their numbers first (the
     rows' dots still say what is new), then their icons; the labels always stay. */
  @container (width < 440px) {
    .places :global([role='tab'] > .count) {
      display: none;
    }
  }

  @container (width < 380px) {
    .places :global([role='tab'] > .icon) {
      display: none;
    }
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
