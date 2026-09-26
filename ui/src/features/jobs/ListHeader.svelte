<!--
  The header of the list column: the places as tabs (Eingang, Archiv, Papierkorb; another
  place starts without the search, like a folder of a mail app), then two rows.
  Row 1: the search, whose placeholder names what it searches ("Jobs durchsuchen", "Archiv
  durchsuchen", "Papierkorb durchsuchen"; Enter or ArrowDown open its first hit, the focus
  on its row), and next to it "Abrufen", the one primary of the
  Jobs view, which fills the inbox ("Abbrechen" in its place while a fetch or details run
  goes; locked while the app scores the jobs anew, and without a mailbox, saying why). The
  action slot is as wide as the wider of the two and both fill it, so the search never jumps
  when a run starts; the one that comes fades in, the one that goes is gone at once. On
  macOS this row is the list's part of the toolbar row, centred on the traffic lights, and
  its empty parts move the window.
  Row 2 in the inbox: Neu · Alle · Favoriten with their counts, and at its end "Alle als
  gelesen markieren" (while the list holds unread jobs; the toast takes it back) and the
  order, a quiet button that opens the OS's own menu (Nach Passung, Nach Datum; one choice
  for every list, kept; without a usable profile by date, saying why). In the Archiv and
  the Papierkorb: how many jobs lie there (during a search, how many it found there), in the
  Papierkorb "Papierkorb leeren" (asks first), and the order, which keeps the end of the row
  in every place. While two or more jobs are chosen, the selection bar takes this row, on one
  line: how many, the place's actions, the × that ends the choice (Esc too). The row keeps
  one height otherwise: one line in a column wide enough for the segments with four-digit
  counts and the tools, else always two (the tools on their own line, in every place), so
  the list never jumps and no label shortens (only as a last resort, with still longer
  counts). The bottom hairline shows only once the list below is
  scrolled. Under the rows one sentence says when a job action of the list failed (a move,
  its undo, the star, "all read") or when jobs deleted for good could not leave the Excel
  file; it goes with the next list or the next action that works.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import Notice from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
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
  import { jobs, keyOf, placeOf, type JobFacet } from '$lib/state/jobs.svelte';
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

  const place = $derived(placeOf(jobs.facet));
  const inInbox = $derived(place === 'inbox');

  const places = $derived<{ id: Place; label: string; testid: string }[]>([
    { id: 'inbox', label: t.place.inbox, testid: 'place-inbox' },
    { id: 'archive', label: t.place.archive, testid: 'place-archive' },
    { id: 'trash', label: t.place.trash, testid: 'place-trash' },
  ]);

  /** Another place starts without the search; the inbox comes back on its last tab. */
  function choosePlace(next: Place): void {
    const facet: JobFacet =
      next === 'inbox' ? jobs.inboxFacet : next === 'archive' ? 'archived' : 'trash';
    if (jobs.facet !== facet) jobs.setFacet(facet, true);
  }

  // Each segment counts its list (they follow the search): the unread ones always in the warm
  // pill, the others plain, whichever is chosen, so the control keeps its width; no zero.
  const views = $derived([
    {
      id: 'new' as JobFacet,
      label: t.toolbar.facetNew,
      count: jobs.counts.unread || null,
      tone: 'soft' as const,
    },
    {
      id: 'all' as JobFacet,
      label: t.toolbar.facetAll,
      count: jobs.counts.inbox || null,
      tone: 'plain' as const,
    },
    {
      id: 'favourites' as JobFacet,
      label: t.toolbar.facetSaved,
      count: jobs.counts.favourites || null,
      tone: 'plain' as const,
    },
  ]);
  /** The jobs of this place (with the search), for the count and whether to order. */
  const inPlace = $derived(
    jobs.facet === 'favourites' ? jobs.counts.favourites : jobs.counts[place],
  );
  const query = $derived(jobs.search.trim());
  /** How many jobs lie in the archive or the trash; during a search, how many it found. */
  const placeCount = $derived(
    query === '' ? t.place.count[place](inPlace) : t.place.found[place](inPlace, query),
  );
  /** "Alle als gelesen markieren" while the list holds an unread job: the count leaves out
   *  the excluded ones, which Neu lists all the same (and the action marks too). */
  const unread = $derived(
    jobs.counts.unread > 0 || jobs.rows.some((job) => job.unread && job.place === 'inbox'),
  );

  let searchBox = $state<HTMLElement | null>(null);

  /** Ctrl+F (Cmd+F on macOS, lib/input/input.ts): into the search, its text selected. */
  export function find(): void {
    const input = searchBox?.querySelector('input');
    input?.focus();
    input?.select();
  }

  const SORTS: readonly JobSort[] = ['match', 'newest'];
  // In the Papierkorb the date is the day a job went there (what its row shows).
  const sorts = $derived(SORTS.map((sort) => ({ id: sort, label: t.toolbar.sortLabel[sort] })));

  /** "Alle als gelesen markieren" is on its way: a second click (a double click) waits. */
  let marking = false;

  /** "Alle als gelesen markieren": the unread jobs of the list (with a search its hits);
   *  the toast takes it back. Nothing marked, nothing to say or take back. */
  async function markAllRead(): Promise<void> {
    if (marking) return;
    marking = true;
    const result = await jobs.markAllRead();
    marking = false;
    if ('error' in result) {
      jobs.actionError = result.error;
      return;
    }
    jobs.actionError = null;
    if (result.keys.length === 0) return;
    void jobs.loadOverview();
    toasts.show(
      t.toast.allRead,
      'success',
      {
        label: t.common.undo,
        onclick: () => {
          void jobs.markUnread(result.keys).then((error) => {
            jobs.actionError = error;
            void jobs.loadOverview();
          });
        },
      },
      result.keys.map(keyOf),
    );
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
  </div>
  <!-- An empty archive or trash has nothing to show here: no blank band above its empty state
       (a search without hits keeps the row, the list does not jump while typing). -->
  <!-- A list that did not load has nothing to count or order: the row waits for it. -->
  {#if jobs.status !== 'error' && (bulk.active || inInbox || placeHolds > 0)}
    <div class="second" class:single={bulk.active}>
      {#if bulk.active}
        <SelectionBar
          count={bulk.chosen.length}
          actions={bulk.actions}
          onclear={() => selection.clear()}
          testid="selection-bar"
        />
      {:else}
        {#if inInbox}
          <Segmented
            options={views}
            value={jobs.facet}
            label={t.toolbar.facet}
            size="sm"
            testid="facet"
            onchange={(id) => jobs.setFacet(id)}
          />
        {:else}
          <!-- An empty place says so in the list; no "0 Jobs" above it. -->
          {#if inPlace > 0}
            <span
              class="place-count"
              data-testid="place-count"
              use:tooltip={{ text: placeCount, truncated: true }}>{placeCount}</span
            >
          {/if}
        {/if}
        <span class="tools">
          {#if inInbox && jobs.facet !== 'favourites' && unread}
            <Button
              variant="ghost"
              size="sm"
              icon="check-check"
              label={query === '' ? t.actions.allRead : t.actions.hitsRead}
              testid="mark-all-read"
              onclick={() => void markAllRead()}
            />
          {/if}
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
          {#if inPlace > 0}
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
      {/if}
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

  /* The second row: one height in every state; the tools wrap under a narrow column's
     segments, at its end. */
  .second {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    min-height: var(--control-sm);
  }

  /* A column too narrow for the segments with four-digit counts and the tools on one line
     ("Alle gelesen" and the order: German needs about 600 px): two lines in every state (the segments or the
     count, then the tools), so the list below stands at one height whatever the row holds
     and no label shortens when a count grows. */
  @container (width < 620px) {
    .second:not(.single) {
      flex-wrap: wrap;
      align-content: flex-start;
      min-height: calc(2 * var(--control-sm) + var(--space-8));
    }

    .tools {
      flex-basis: 100%;
      justify-content: flex-end;
    }
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
