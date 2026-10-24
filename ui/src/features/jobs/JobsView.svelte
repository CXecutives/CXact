<!--
  The Jobs view on the white sheet of the shell: left the list column with its header (the
  places, "Jobs suchen", the search, the order and the filter; a hairline under it once the
  list scrolled where no day's heading sticks), the run's strip and the list; a hairline;
  right the reader (under the top bar's fade), or with nothing selected its empty state ("Kein
  Job gewählt"). No cards, no shadows. A place without jobs (or a list that did not load) has
  nothing to read: the list takes the whole width, without the reader, the handle and the
  seam (decision 24). The handle
  between the columns resizes the list (kept) within limits that follow the window and the
  sidebar and never shrink while the window grows. Below 900 px one column: the list under
  its header, as at every width, or the reader with its "×" (the mouse's back button too).
  The run's line is part of the header. Closing a job from the reader focuses its row.

  The right pane is a stage with its own scroll position. A job opens once its details are
  there: until then the pane keeps the previous job; the empty state goes at once (the pane
  stays empty, a placeholder once the load takes a while). Then the new stage takes the old
  one's place at once, nothing fades, so nothing flashes between them; the new job starts at
  the top. The close "×" in the reader
  head (at every width) and a search that no longer finds the job close it (the place's empty
  state). Esc closes only menus and dialogs: the app has no keys of its own.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Splitter, { cappedLimits, splitLimits } from '$components/Splitter.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import EmptyState from '$components/EmptyState.svelte';
  import { t } from '$lib/i18n/t';
  import { scrollFade } from '$lib/actions/scrollFade';
  import { tokenPx } from '$lib/tokens';
  import { app } from '$lib/state/app.svelte';
  import { jobs, keyOf, sameKey } from '$lib/state/jobs.svelte';
  import { shell } from '$lib/state/shell.svelte';
  import { FOLD_BELOW, viewport } from '$lib/state/viewport.svelte';
  import JobList from './JobList.svelte';
  import Reader from './Reader.svelte';
  import ReaderSkeleton from './ReaderSkeleton.svelte';
  import ListHeader from './ListHeader.svelte';

  const NO_JOB = 'none';
  const ERROR = 'error';
  const WAITING = 'waiting';
  /** A job is chosen and on its way: the empty state goes at once, the pane stays blank. */
  const OPENING = 'opening';

  // The list loads as soon as the app state is there (also after the first run page).
  $effect(() => {
    if (app.state !== null && jobs.status === 'idle') void jobs.start();
  });

  /**
   * What the right pane shows, as the key of its stage: a failed load of the selected job,
   * the loaded job (a job key never equals one of the words), a placeholder once loading
   * takes a while, else the place's empty state. While a job loads quickly the pane keeps
   * the job it showed last; the empty state goes at once (user, 2026-09-30: no "Wähle einen
   * Job" beside a chosen one).
   */
  let shown = NO_JOB;
  /** Counts the changes: each one is a new stage, which starts at the top. */
  let turns = 0;
  const stage = $derived.by((): { what: string; turn: number } => {
    const selected = jobs.selected !== null;
    let next = shown;
    if (selected && jobs.detailStatus === 'error') next = ERROR;
    else if (jobs.detail !== null) next = keyOf(jobs.detail.job.key);
    else if (selected && jobs.detailSlow) next = WAITING;
    else if (selected && shown === NO_JOB) next = OPENING;
    else if (!selected) next = NO_JOB;
    if (next !== shown) {
      shown = next;
      turns += 1;
    }
    return { what: shown, turn: turns };
  });
  // One column shows the list or the reader.
  const reading = $derived(stage.what !== NO_JOB);
  // One column: a job in place of the list hides the list and its run line.
  $effect(() => {
    shell.listHidden = reading && viewport.narrow;
    return () => {
      shell.listHidden = false;
    };
  });
  const place = $derived(jobs.place);
  /** The list shows nothing to choose (an empty place, a search or a filter without hits, a
   *  list that did not load): the list says why, the reader adds no second tile. */
  const placeEmpty = $derived(
    jobs.status === 'error' || (jobs.status === 'ready' && jobs.visible.length === 0),
  );
  /** The list scrolled beneath its header where no day's heading sticks: the hairline. */
  let line = $state(false);
  /** A place without jobs, or a list that did not load: nothing to read beside it. */
  const emptyPlace = $derived(
    jobs.status === 'error' ||
      (jobs.status === 'ready' && (jobs.overviewCounts ?? jobs.counts)[place] === 0),
  );
  /** The width of the list column (the splitter keeps it per user). */
  let listWidth = $state<number | undefined>(undefined);
  /** The docked sidebar's width (the user's, or the first one). */
  const sidebar = $derived(shell.sidebarWidth ?? tokenPx('--sidebar-width'));
  /** The content beside the sidebar (its hairline lies inside its width): the list's limits
   *  and its first width follow it when the window resizes or the sidebar folds or changes
   *  width. */
  const content = $derived(viewport.width - (shell.docked ? sidebar : 0));
  /** The list never gets narrower while the window grows: where the sidebar folded by itself
   *  it takes at most what it has beside the sidebar at the fold's breakpoint. */
  const limits = $derived(
    viewport.fold
      ? cappedLimits(splitLimits(content), splitLimits(FOLD_BELOW - sidebar))
      : splitLimits(content),
  );
  /** The job view stands beside the list unless the user hid it (one column shows a job in
   *  place of the list). A job chosen in the list shows it again. */
  const readerShown = $derived((shell.readerOpen || viewport.narrow) && !emptyPlace);
  // The top bar continues the border between the list and the job view.
  $effect(() => {
    shell.listSeam = readerShown && !viewport.narrow && listWidth !== undefined ? listWidth : null;
    return () => {
      shell.listSeam = null;
    };
  });
  let chosen = untrack(() => jobs.selected);
  $effect(() => {
    const selected = jobs.selected;
    untrack(() => {
      if (selected !== null && !sameKey(selected, chosen)) shell.setReader(true);
      // One column: back to the list (Zurück), at the row of the job that was open.
      const left = chosen;
      if (selected === null && left !== null && viewport.narrow) {
        if (jobs.shown.some((job) => sameKey(job.key, left))) {
          jobs.reveal = { key: keyOf(left), focus: true };
        }
      }
      chosen = selected;
    });
  });

  let right = $state<HTMLElement | null>(null);

  /**
   * Close the job. A focus inside the reader (its close button) goes to the row of the job
   * that was open, like Mail: the list keeps its place and Tab goes on from there.
   */
  function close(): void {
    const open = jobs.selected;
    const focused = document.activeElement;
    const inReader = right !== null && focused !== null && right.contains(focused);
    // In one column the list comes back: at the open job's row, which gets the focus unless
    // the pointer was elsewhere.
    const lost = focused === null || focused === document.body;
    jobs.clearSelection();
    if (open === null || !(inReader || (viewport.narrow && lost))) return;
    if (jobs.shown.some((job) => sameKey(job.key, open))) {
      jobs.reveal = { key: keyOf(open), focus: true };
    }
  }

  let header = $state<ListHeader | null>(null);

  // A search that no longer finds the open job closes it (the list shows what it found);
  // only a change of the search does, never a job opened from elsewhere (an undo).
  // Only a list that holds every hit can tell: a hit beyond the loaded rows stays open. It is
  // the search's own answer that tells, not a change of the list while the search waits.
  let searched = untrack(() => jobs.search.trim());
  let searchChanged = false;
  $effect(() => {
    const search = jobs.search.trim();
    untrack(() => {
      if (search !== searched) searchChanged = true;
      searched = search;
    });
  });
  $effect(() => {
    const selected = jobs.selected;
    const ready = jobs.status === 'ready';
    const listed = jobs.visible;
    untrack(() => {
      if (!searchChanged || !ready || jobs.listedSearch !== searched) return;
      searchChanged = false;
      if (selected === null || searched === '') return;
      const complete = jobs.rows.length >= jobs.total;
      if (complete && !listed.some((row) => sameKey(row.key, selected))) close();
    });
  });
</script>

<div class="jobs" class:reading class:alone={!readerShown} data-testid="jobs">
  <div class="body">
    <aside class="left" use:cssVars={listWidth ? { 'list-width': `${listWidth}px` } : {}}>
      <div class="head">
        <ListHeader bind:this={header} {line} />
      </div>
      <div class="scroll" data-testid="list-scroll">
        <JobList
          onresetfilter={() => void header?.resetFilter()}
          online={(value) => (line = value)}
        />
      </div>
    </aside>
    {#if readerShown}
      <span class="split"
        ><Splitter
          bind:size={listWidth}
          initial={limits.initial}
          min={limits.min}
          max={limits.max}
          storageKey="jobs-list-width"
          testid="list-splitter"
        /></span
      >
      <section class="right" data-testid="reader-pane" bind:this={right}>
        {#key stage.turn}
          <div class="stage" data-testid="stage" use:scrollFade>
            <div
              class="column"
              class:idle={stage.what === NO_JOB || stage.what === ERROR}
              class:job={stage.what !== NO_JOB &&
                stage.what !== ERROR &&
                stage.what !== WAITING &&
                stage.what !== OPENING}
            >
              {#if stage.what === NO_JOB}
                <!-- No job open: the one empty state of every place (its icon, one sentence);
                   beside an empty list, which says it all, nothing. -->
                <div class="place-reader">
                  {#if !placeEmpty}
                    <EmptyState
                      icon="jobs"
                      heading={t.reader.noJob}
                      text={t.reader.pickJob}
                      testid="place-reader"
                    />
                  {/if}
                </div>
              {:else}
                <!-- One column: the way back while no job stands (the reader has its "×"). -->
                {#if stage.what === ERROR || stage.what === WAITING}
                  <div class="back">
                    <Button
                      variant="ghost"
                      icon="back"
                      label={t.common.back}
                      testid="back"
                      onclick={close}
                    />
                  </div>
                {/if}
                {#if stage.what === ERROR}
                  <div class="place-reader">
                    <EmptyState
                      icon="warning"
                      tone="danger"
                      heading={t.reader.loadFailed}
                      text={jobs.detailError}
                      secondary={{
                        label: t.common.retry,
                        icon: 'retry',
                        onclick: () => jobs.selected && void jobs.loadDetail(jobs.selected),
                      }}
                      testid="reader-error"
                    />
                  </div>
                {:else if stage.what === WAITING}
                  <ReaderSkeleton />
                {:else if stage.what === OPENING}
                  <!-- Blank until the chosen job is there. -->
                {:else if jobs.detail}
                  <Reader detail={jobs.detail} onclose={close} />
                {/if}
              {/if}
            </div>
          </div>
        {/key}
      </section>
    {/if}
  </div>
</div>

<style>
  .jobs {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .left {
    display: flex;
    flex: none;
    flex-direction: column;
    width: var(--list-width, clamp(var(--list-first-min), 40%, var(--list-first-max)));
    min-height: 0;
    border-right: var(--border-width) solid var(--border);
  }

  /* The job view hidden: the list takes the whole width. */
  .alone .left {
    flex: 1;
    width: auto;
    border-right: none;
  }

  /* The header asks the column's width (its second row wraps in a narrow column): the query
     container is the header's box, as wide as the column, and not the column itself. Around
     the list a query container made every layout of the view half as long again (the
     reader's ring fill lays the view out in each of its frames).
     It keeps the room of the list's scrollbar beside it, empty (a scroller that never
     scrolls): its tabs, search and tools end where the rows' text ends, with the engine's
     own scrollbar width (Windows 8 px, overlay scrollbars none). */
  .head {
    flex: none;
    overflow-x: hidden;
    overflow-y: scroll;
    container-type: inline-size;
  }

  /* The handle lies over the list's border and takes no room. */
  .split {
    display: flex;
    flex: none;
  }

  /* The list and the reader keep their scrollbar's room whether they scroll or not, like the
     views of the shell (Windows: a transparent track, the thumb only under the pointer;
     macOS overlay scrollbars take none): the rows end on the header's line, and the reader
     does not move sideways between a short and a long job. */
  .scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow-x: auto;
    overflow-y: scroll;
  }

  /* The fade where a job scrolls away under the top bar: the sheet's colour into nothing,
     invisible over the empty top at rest. */
  .stage::before {
    content: '';
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: block;
    flex: none;
    height: var(--fade-height);
    margin-bottom: calc(-1 * var(--fade-height));
    background: var(--grad-fade-page);
    opacity: var(--fade-shown, 0);
    pointer-events: none;
  }

  /* One cell: the stage fills the pane. */
  .right {
    display: grid;
    flex: 1;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-width: 0;
    overflow: hidden;
  }

  /* Each stage scrolls on its own. */
  .stage {
    grid-area: 1 / 1;
    min-height: 0;
    overflow-x: auto;
    overflow-y: scroll;
    background-color: var(--page);
  }

  /* Centred on a whole pixel (rounded down to the step of a hairline): an odd pane width
     would put the text on a half one. */
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    max-width: calc(var(--reader-max) + 2 * var(--reader-pad-x));
    margin: 0 auto 0
      max(
        0%,
        round(
          down,
          calc((100% - var(--reader-max) - 2 * var(--reader-pad-x)) / 2),
          var(--border-width)
        )
      );
    padding: var(--head-pad) var(--reader-pad-x) var(--reader-pad-end);
  }

  /* A job: the reader takes the whole pane (its head's hairline runs from edge to edge) and
     sets its own column. */
  .column.job {
    max-width: none;
    min-height: 100%;
    margin: 0;
    padding: 0;
  }

  /* The chevron's ink lines up with the title below it: the button's padding and border
     hang out, and so does the glyph's own inset in its box. */
  .back {
    display: none;
    margin-left: calc(-1 * (var(--ghost-inset) + var(--space-6)));
  }

  /* The reader with nothing open: the column fills the pane, and its empty state stands in
     the middle, like every other empty state (the list's). */
  .column.idle {
    min-height: 100%;
    padding-bottom: var(--pane-padding);
  }

  .place-reader {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
  }

  @media (width < 900px) {
    .left {
      width: 100%;
      border-right: 0;
    }

    .right,
    .split {
      display: none;
    }

    .reading .left {
      display: none;
    }

    .reading .right {
      display: grid;
    }

    .back {
      display: block;
    }

    .column {
      padding-bottom: var(--space-32);
    }
  }

  /* A narrow window: the sides of the pages (Page). */
  @media (width < 560px) {
    .column {
      padding-inline: var(--page-side-narrow);
    }
  }
</style>
