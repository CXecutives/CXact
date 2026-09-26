<!--
  The header of the list column: the places as tabs (Eingang with the number of its unopened
  jobs in coral, nothing at 0; Archiv, Papierkorb; another place starts without the search,
  like a folder of a mail app), then one toolbar row: the search, whose placeholder names what
  it searches ("Jobs durchsuchen", "Archiv durchsuchen", "Papierkorb durchsuchen"; Enter or
  ArrowDown open its first hit, the focus on its row), in the Eingang the funnel, and
  "Abrufen", the one primary of the Jobs view, which fills the inbox ("Abbrechen" in its place
  while a fetch or details run goes; locked while the app scores the jobs anew, and without a
  mailbox, saying why). The action slot is as wide as the wider of the two and both fill it,
  so the search never jumps when a run starts; the one that comes fades in, the one that goes
  is gone at once. On macOS this row is the list's part of the toolbar row, centred on the
  traffic lights, and its empty parts move the window.
  The funnel (a quiet icon button, a coral dot while a filter is on) opens the app's menu of
  the order and the filter, one table (lib/state/filter.ts): Sortierung, Nur Favoriten,
  Portal, Passung under small headings, and "Filter zurücksetzen" while a filter is on.
  Without a usable profile the match order and the bands are off, saying why. While a filter
  is on, one quiet line under the toolbar names it in the menu's words and takes it off
  ("Zurücksetzen").
  The Archiv and the Papierkorb (no filter there) keep a second row: how many jobs lie there
  (during a search, how many it found there), in the Papierkorb "Papierkorb leeren" (asks
  first), and the order, a quiet button with its menu. While jobs are chosen, the selection
  bar takes the toolbar row, on one line (how many, the place's actions, the × that ends the
  choice, Esc too), so nothing below moves. The bottom hairline shows only once the list below
  is scrolled. Under the rows one sentence says when a job action of the list failed (a move,
  its undo, the star) or when jobs deleted for good could not leave the Excel file; it goes
  with the next list or the next action that works.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import Notice from '$components/Notice.svelte';
  import SelectionBar from '$components/SelectionBar.svelte';
  import Tabs from '$components/Tabs.svelte';
  import TextField from '$components/TextField.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { chipKeys } from '$lib/input/input';
  import { t } from '$lib/i18n/t';
  import type { JobSort, Place } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { dragBands } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { FILTER_GROUPS, filterWords, NO_FILTER } from '$lib/state/filter';
  import { jobs } from '$lib/state/jobs.svelte';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { trashEmptied } from './actions';
  import { bulk } from './bulk.svelte';
  import { selection } from './selection.svelte';

  interface Props {
    /** The list below is scrolled away from its top. */
    scrolled?: boolean;
    /** Enter or ArrowDown in the search: the list opens its first hit (`true` if it had
     *  one; the focus goes to its row). */
    onopen?: () => boolean;
  }
  let { scrolled = false, onopen }: Props = $props();

  /**
   * The search's own keys (lib/input/input.ts): Enter and ArrowDown open the first hit, like
   * the search of a mail app; Backspace and Esc stay the field's (Esc clears it). The keys of
   * a field with suggestions are the hook input.ts offers for a field.
   */
  const searchKeys = {
    commit: (): boolean => onopen?.() ?? false,
    removeLast: (): boolean => false,
    clear: (): boolean => false,
    step: (by: -1 | 1): boolean => (by === 1 ? (onopen?.() ?? false) : false),
  };

  const place = $derived(jobs.place);
  const inInbox = $derived(place === 'inbox');

  /** The unopened jobs of the inbox, whatever the search and the filter (the excluded ones
   *  are not counted). */
  const unread = $derived((jobs.overviewCounts ?? jobs.counts).unread);
  const places = $derived<{ id: Place; label: string; testid: string; count?: number | null }[]>([
    { id: 'inbox', label: t.place.inbox, testid: 'place-inbox', count: unread || null },
    { id: 'archive', label: t.place.archive, testid: 'place-archive' },
    { id: 'trash', label: t.place.trash, testid: 'place-trash' },
  ]);

  /** Another place starts without the search. */
  function choosePlace(next: Place): void {
    if (jobs.place !== next) jobs.setPlace(next, true);
  }

  const query = $derived(jobs.search.trim());
  /** How many jobs lie in the archive or the trash; during a search, how many it found. */
  const placeCount = $derived(
    query === ''
      ? t.place.count[place](jobs.counts[place])
      : t.place.found[place](jobs.counts[place], query),
  );

  let searchBox = $state<HTMLElement | null>(null);

  /** Ctrl+F (Cmd+F on macOS, lib/input/input.ts): into the search, its text selected (a
   *  choice of jobs, which holds the row, ends first). */
  export async function find(): Promise<void> {
    if (bulk.active) {
      selection.clear();
      await tick();
    }
    const input = searchBox?.querySelector('input');
    input?.focus();
    input?.select();
  }

  const SORTS: readonly JobSort[] = ['match', 'newest'];
  // In the Papierkorb the date is the day a job went there (what its row shows).
  const sorts = $derived(SORTS.map((sort) => ({ id: sort, label: t.toolbar.sortLabel[sort] })));

  /* ---------------------------------------------------------------------- funnel */

  /** The funnel shows while the inbox holds jobs, or while a filter is on (it takes it off
   *  again, also when it leaves nothing in the list); a list that did not load has nothing
   *  to filter. */
  const funnel = $derived(
    inInbox &&
      jobs.status !== 'error' &&
      ((jobs.overviewCounts ?? jobs.counts).inbox > 0 || jobs.filtered),
  );
  /** The portals of the menu: the enabled ones in the app's order, and a chosen one switched
   *  off since (so it can be seen and taken off). */
  const portals = $derived(
    (app.state?.portals ?? [])
      .filter((line) => line.enabled || line.portal === jobs.filterChoice.portal)
      .map((line) => line.portal),
  );
  /** The active filter in the menu's words (the line under the toolbar). */
  const activeWords = $derived(jobs.filtered ? filterWords(jobs.filter, portals, t) : []);

  let funnelBox = $state<HTMLElement | null>(null);
  let funnelOpen = $state(false);

  /**
   * The funnel's menu below it, its right edge on the button's: the table's groups in their
   * order, each under its heading, the chosen entry checked; while a filter is on, the way
   * back. A second click on the open funnel closes it (the press outside does). Opened from
   * the keyboard, its first entry is active at once (like the OS).
   */
  function openFunnel(event: MouseEvent): void {
    if (funnelBox === null || menuState.open !== null) return;
    const choice = jobs.choice;
    const entries: MenuEntry[] = [];
    for (const group of FILTER_GROUPS) {
      if (entries.length > 0) entries.push({ kind: 'separator' });
      if (group.heading !== null) entries.push({ kind: 'heading', label: group.heading(t) });
      for (const entry of group.entries(portals)) {
        const reason = app.hasProfile ? null : (entry.needsProfile?.(t) ?? null);
        entries.push({
          id: entry.id,
          label: entry.label(t),
          checked: entry.on(choice),
          toggle: group.toggle,
          disabled: reason !== null,
          reason,
          run: () => jobs.choose(entry.pick(jobs.choice)),
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
  const inTrash = $derived(jobs.overviewCounts?.trash ?? jobs.counts.trash);
  /** The jobs of this place without the search: an empty archive or trash has no second row. */
  const placeHolds = $derived((jobs.overviewCounts ?? jobs.counts)[place]);

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
    icon="refresh-cw"
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
    icon="circle-stop"
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
  </div>
  <div class="top" data-tauri-drag-region={dragBands() ? '' : undefined}>
    {#if bulk.active}
      <SelectionBar
        count={bulk.chosen.length}
        actions={bulk.actions}
        onclear={() => selection.clear()}
        testid="selection-bar"
      />
    {:else}
      <span class="search" bind:this={searchBox} use:chipKeys={searchKeys}>
        <TextField
          kind="search"
          value={jobs.search}
          label={t.place.search[place]}
          placeholder={t.place.search[place]}
          testid="search"
          oninput={(value) => jobs.setSearch(value)}
        />
      </span>
      {#if funnel}
        <span class="funnel" bind:this={funnelBox}>
          <Button
            variant="secondary"
            size="field"
            iconOnly
            icon="funnel"
            label={t.toolbar.filter}
            dot={jobs.filtered}
            menu
            expanded={funnelOpen}
            testid="filter"
            onclick={openFunnel}
          />
        </span>
      {/if}
      <!-- The other button stands invisible in the same cell and only keeps the width. -->
      <span class="action">
        {#if run.fetching}
          <span class="live" in:fade>{@render cancelButton(true)}</span>
          <span class="spare" aria-hidden="true" inert>{@render fetchButton(false)}</span>
        {:else}
          <span class="live" in:fade>{@render fetchButton(true)}</span>
          <span class="spare" aria-hidden="true" inert>{@render cancelButton(false)}</span>
        {/if}
      </span>
    {/if}
  </div>
  {#if activeWords.length > 0}
    <div class="filter-line" data-testid="filter-line">
      <span
        class="filter-words"
        data-testid="filter-words"
        use:tooltip={{ text: t.toolbar.filterLine(activeWords), truncated: true }}
        >{t.toolbar.filterLine(activeWords)}</span
      >
      <Button
        variant="link"
        size="sm"
        label={t.toolbar.filterLineReset}
        testid="filter-line-reset"
        onclick={() => jobs.setFilter(NO_FILTER)}
      />
    </div>
  {/if}
  <!-- The Archiv and the Papierkorb count their jobs; an empty one says so in the list, and a
       list that did not load has nothing to count or order. -->
  {#if !inInbox && jobs.status !== 'error' && placeHolds > 0}
    <div class="second">
      {#if jobs.counts[place] > 0}
        <span
          class="place-count"
          data-testid="place-count"
          use:tooltip={{ text: placeCount, truncated: true }}>{placeCount}</span
        >
      {/if}
      <span class="tools">
        {#if place === 'trash' && inTrash > 0}
          <Button
            variant="ghost"
            size="sm"
            icon="circle-x"
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
        {/if}
        {#if jobs.counts[place] > 0}
          <MenuButton
            options={sorts}
            value={app.hasProfile ? jobs.sortChoice : 'newest'}
            disabled={!app.hasProfile}
            disabledReason={t.toolbar.sortNoProfile}
            testid="sort"
            menuLabel={t.toolbar.sortMenu}
            onchange={(sort) => jobs.setSort(sort)}
          />
        {/if}
      </span>
    </div>
  {/if}
  {#if jobs.actionError}
    <Notice tone="danger" variant="inline" text={jobs.actionError} testid="header-error" />
  {:else if jobs.exportNote}
    <Notice tone="warning" variant="inline" text={jobs.exportNote} testid="header-export" />
  {/if}
</div>

<Dialog
  bind:open={confirmEmpty}
  variant="danger"
  heading={t.actions.emptyTrashHeading}
  text={t.actions.emptyTrashText(inTrash)}
  confirmLabel={t.actions.emptyTrashConfirm}
  busy={emptying}
  error={emptyError}
  testid="dialog-empty-trash"
  onconfirm={() => void emptyTrash()}
/>

<Dialog
  bind:open={bulk.confirmPurge}
  variant="danger"
  heading={t.actions.purgeHeading(bulk.chosen.length)}
  text={t.actions.purgeText}
  confirmLabel={t.actions.purgeConfirm}
  busy={bulk.purging}
  error={bulk.purgeError}
  testid="dialog-purge-chosen"
  onconfirm={() => void bulk.purgeChosen()}
/>

<style>
  .header {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: var(--space-12);
    padding: var(--list-header-top) var(--pane-padding) var(--pane-padding);
    border-bottom: var(--border-width) solid transparent;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }

  .scrolled {
    border-bottom-color: var(--border);
  }

  /* The rows span the header's side padding too, so on macOS their empty ends move the
     window like the rest of the toolbar row. */
  .places {
    display: flex;
    align-items: flex-end;
    margin: 0 calc(-1 * var(--pane-padding));
    padding: 0 var(--pane-padding);
  }

  /* One height whatever it holds (the search and its tools, or the selection bar). */
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--list-toolbar);
    margin: 0 calc(-1 * var(--pane-padding));
    padding: 0 var(--pane-padding);
  }

  .search {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .funnel {
    display: inline-flex;
    flex: none;
  }

  /* Both buttons in one cell: the slot is as wide as the wider one. */
  .action {
    display: grid;
    flex: none;
  }

  .live,
  .spare {
    display: flex;
    grid-area: 1 / 1;
  }

  .spare {
    visibility: hidden;
  }

  /* The active filter: quiet words, cut at their end (the tooltip has them whole), and the
     way back at the end of the line. */
  .filter-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    min-width: 0;
    margin-top: calc(-1 * var(--space-4));
  }

  .filter-words {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The second row of the Archiv and the Papierkorb: the count, then the tools at its end. */
  .second {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    min-height: var(--control-sm);
  }

  /* A long search shortens the line (the tooltip has it whole). */
  .place-count {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    margin-right: calc(-1 * var(--ghost-inset));
  }
</style>
