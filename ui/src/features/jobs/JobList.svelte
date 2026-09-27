<!--
  The job list: one list per place in the chosen order, rows in windows of 60 (a sentinel at
  the end shows the next window), a new job of a run rises in where it lands (the rows below
  simply make room; the rows already there never flicker). Rows move only for the user's own
  change and for the re-sort at the end of a run: after the order, another place or a filter
  the rows on screen glide to their new place (150 ms); rows off screen and new rows are
  simply there. A search and live updates never move anything. A row the user moves out
  (archive, delete, restore) folds its height away. An unopened job carries the coral dot
  until it is opened. At the end of every place the excluded jobs, grey with the ban in the
  ring's place, in one section "Ausgeschlossen (n)" that is folded by default (the choice is
  kept; it opens when its job is opened from elsewhere). A page that fails to load while
  scrolling says so at the end of the list, with a retry. A search looks in the list's place;
  under its hits a button names each other place with hits ("Im Archiv (2)", counted with
  the same filter) and goes there with the search. A click opens a job, a double click opens
  its ad in the browser, a right click its menu (jobMenu of actions.ts); under the pointer
  the row shows the moves of its place as its tools (rowTools, the same table); one coral bar marks
  the open job's row and slides from row to row (RowBar). Back in the Jobs view, the open
  job's row is in view again. A job action that fails says so in the list header. Every
  empty state is one pattern at one place: an icon and one short sentence, centred, at most
  one way out (secondary: the header holds the view's primary). A filter that leaves nothing
  says so and takes itself off ("Filter zurücksetzen"). An empty Eingang offers "Postfach
  abrufen" (while a fetch can start), without a mailbox "Postfach verbinden" instead, which
  opens Einstellungen at the mailbox card. Without a mailbox one slim note at the top says
  how to connect one (unless the empty Eingang says it); without a usable profile one says
  that there is no match without it and leads to the Profil view (the rings stay, empty); a
  thin profile one calm line that the match stays rough. A list that fails to load says only
  that, with a retry (the header hides its tools).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import type { IconName } from '$components/Icon.svelte';
  import Dialog from '$components/Dialog.svelte';
  import type { EmptyAction } from '$components/EmptyState.svelte';
  import JobRow from '$components/JobRow.svelte';
  import ListDivider from '$components/ListDivider.svelte';
  import Notice from '$components/Notice.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import { nearEnd } from '$lib/actions/nearEnd';
  import { t } from '$lib/i18n/t';
  import type { JobView, Place } from '$lib/ipc/types';
  import { play, staggerLimit } from '$lib/motion/motion';
  import { rowCollapse, rowEnter, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { NO_FILTER } from '$lib/state/filter';
  import { isExcluded, jobs, keyOf, sameKey } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import type { ContextMenu } from '$lib/input/input';
  import { disarm, jobMenu, moving, openAd, purge, rowTools, type JobMenuContext } from './actions';
  import { glideIntoView } from '$lib/motion/scroll';
  import RowBar from './RowBar.svelte';

  interface Props {
    /** "Filter zurücksetzen" of a filter that leaves nothing: the header takes the filter off
     *  and keeps the keyboard focus (the button goes with the empty state). */
    onresetfilter?: () => void;
  }
  let { onresetfilter }: Props = $props();

  /** The placeholder rows while the list loads, each title and line a little shorter or
   *  longer than the one before (percent of its room). */
  const SKELETON_ROWS = [0, 1, 2, 3, 4, 5].map((index) => ({
    index,
    title: 72 - (index % 3) * 14,
    meta: 48 + (index % 2) * 12,
  }));

  const shown = $derived(jobs.shown);
  const searching = $derived(jobs.search.trim() !== '');
  /** The words of the search, marked in the rows' titles (at most 8, like the backend). */
  const searchWords = $derived(searching ? jobs.search.trim().split(/\s+/).slice(0, 8) : []);
  /** The rows as far as the window reaches: the active ones, then the excluded ones. */
  const active = $derived(shown.filter((job) => !isExcluded(job)));
  const excluded = $derived(shown.filter(isExcluded));
  // How many excluded jobs the list holds: the counts of each place know it (with the search
  // and the filter, like the list).
  const excludedCount = $derived(
    jobs.place === 'inbox'
      ? jobs.counts.excluded
      : jobs.place === 'archive'
        ? jobs.counts.excludedArchive
        : jobs.counts.excludedTrash,
  );

  /** The excluded section is open (folded by default; the choice is kept like the order). */
  const EXCLUDED_KEY = 'jobs-excluded-open';
  function keptOpen(): boolean {
    try {
      return localStorage.getItem(EXCLUDED_KEY) === '1';
    } catch {
      return false;
    }
  }
  let excludedOpen = $state(keptOpen());
  function toggleExcluded(): void {
    excludedOpen = !excludedOpen;
    try {
      localStorage.setItem(EXCLUDED_KEY, excludedOpen ? '1' : '0');
    } catch {
      // Without a store the choice lasts for this session only.
      return;
    }
  }
  /** The folded section ends the list: every other row is loaded (the backend lists the
   *  excluded jobs last), so no more pages are fetched until it opens. */
  const foldedEnd = $derived(!excludedOpen && excluded.length > 0);
  const more = $derived(jobs.more && !foldedEnd);
  /**
   * The filter leaves the list empty while the place holds jobs (the counts over every job):
   * it says so and takes the filter off.
   */
  const filterEmptied = $derived(
    jobs.filtered && (jobs.overviewCounts ?? jobs.counts)[jobs.place] > 0,
  );
  // "No jobs in the alert mails" only after a fetch that read the mailbox.
  const lastFetch = $derived(run.summary ?? app.state?.lastRun ?? null);
  const mailRead = $derived(lastFetch?.outcome.kind === 'completed' && lastFetch.scan !== null);
  /** The one sentence of an empty inbox. */
  const emptyInbox = $derived(
    run.active ? t.list.emptyWhileRun : mailRead ? t.list.emptyAfterRun : t.list.emptyAll,
  );
  const profileMissing = $derived(app.state !== null && !app.hasProfile);
  // No profile: the fit needs one. One that is there but cannot be used is named.
  const profileNote = $derived.by(() => {
    const profile = app.state?.profile ?? null;
    if (profile === null) {
      return { heading: null, text: t.list.noProfile, label: t.list.createProfile };
    }
    return {
      heading: profile.parseError ? t.list.profileUnreadable : t.list.profileEmpty,
      text: t.list.profileBrokenText,
      label: t.list.openProfile,
    };
  });

  function toProfile(): void {
    // No profile yet: straight into the empty form, one click.
    if (app.state?.profile == null) editor.create();
    navigation.go('profile');
  }
  const mailboxMissing = $derived(app.state !== null && !app.hasMailbox);

  /** Einstellungen at the mailbox card, its "Verbinden" focused (the view keeps no other
   *  scroll place for this way). */
  function toMailbox(): void {
    navigation.go('settings', false, () => {
      void tick().then(() =>
        requestAnimationFrame(() => {
          const card = document.querySelector<HTMLElement>('[data-testid="settings-mailbox"]');
          if (card === null) return;
          glideIntoView(card, 'nearest');
          card
            .querySelector<HTMLElement>('[data-testid="mailbox-connect"]')
            ?.focus({ preventScroll: true });
        }),
      );
    });
  }

  /** The way on from an empty Eingang (secondary: the header holds the view's primary):
   *  without a mailbox to connect one, else to fetch while a fetch can start. */
  const emptyAction = $derived.by((): EmptyAction | null => {
    if (mailboxMissing) return { label: t.list.connectMailbox, onclick: toMailbox };
    if (run.fetchBlocked !== null) return null;
    return {
      label: t.toolbar.fetch,
      icon: 'fetch',
      onclick: () => void run.start({ kind: 'fetch' }),
    };
  });
  /** The empty Eingang says the list stays empty without a mailbox (not the note too). */
  const emptyInboxShown = $derived(
    jobs.place === 'inbox' &&
      jobs.status === 'ready' &&
      jobs.visible.length === 0 &&
      !searching &&
      !filterEmptied,
  );
  /** A profile the app understands little of: the fit is rough, said once on top. */
  const profileThin = $derived(app.hasProfile && app.state?.profile?.quality === 'thin');
  // Jobs without a match get one soon while a run goes or a rescore is pending.
  const pending = $derived(jobs.scoring);

  /** The rows in the order they stand, section by section (the store's order). */
  const order = $derived(shown);
  /** The rows the list shows (a row on the page that is not among them is leaving). */
  const listed = $derived(new Set(shown.map((job) => keyOf(job.key))));
  const openKey = $derived(jobs.selected ? keyOf(jobs.selected) : null);
  /** The open job's row: the list's one bar marks it. */
  const marked = $derived(openKey);
  const markedExcluded = $derived(
    marked !== null && excluded.some((job) => keyOf(job.key) === marked),
  );

  // A job opened from elsewhere (an undo, the job kept open from the last start) whose row
  // is folded away: its section opens (for now; the kept choice stays).
  let lastMarked: string | null = null;
  $effect(() => {
    const key = marked;
    const out = markedExcluded;
    untrack(() => {
      if (key !== lastMarked && out && !excludedOpen) excludedOpen = true;
      lastMarked = key;
    });
  });

  // Back in the Jobs view (the list is built anew): what the header said about an action in
  // another list goes, and the open job's row comes into view.
  onMount(() => {
    jobs.quiet();
    const open = jobs.selected;
    if (open !== null && jobs.visible.some((job) => sameKey(job.key, open))) {
      void jobs.reach(open, false);
    }
  });

  // The open job after a move or a re-sort: once its row is mounted it scrolls into view (and
  // takes the focus when the focus was on the row that left).
  $effect(() => {
    const want = jobs.reveal;
    void shown;
    if (want === null) return;
    untrack(() => {
      const row = list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(want.key)}"] .row`);
      if (!row) return;
      jobs.reveal = null;
      if (want.focus) row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    });
  });

  /** A click opens the job (the open one stays open). */
  function select(job: JobView): void {
    if (!sameKey(jobs.selected, job.key)) void jobs.select(job, true);
  }

  // Another list, another search, order or filter: a click right away counts (the guard
  // after a move is for rows that slid under the pointer).
  $effect(() => {
    void jobs.place;
    void jobs.search;
    void jobs.sortChoice;
    void jobs.filterChoice;
    untrack(disarm);
  });

  // A search looks in the list's place; the other places with hits are named under them,
  // counted with the same filter (the counts of the list cover every place).
  const place = $derived(jobs.place);
  const PLACES: readonly Place[] = ['inbox', 'archive', 'trash'];
  /** The glyph of each place (the tabs' meaning: the inbox, the archive, the trash). */
  const PLACE_ICON: Record<Place, IconName> = {
    inbox: 'inbox',
    archive: 'archive',
    trash: 'trash',
  };
  const elsewhere = $derived.by(() => {
    // Only once the hits of the typed search are there: the counts before are another
    // search's, and the links would show them and then move.
    if (!searching || jobs.search.trim() !== jobs.countedSearch) return [];
    const counts = jobs.counts;
    return PLACES.filter((other) => other !== place)
      .map((other) => ({ place: other, count: counts[other] }))
      .filter((hit) => hit.count > 0);
  });

  /* --------------------------------------------------------------------- glides */

  let list = $state<HTMLElement | null>(null);
  /** The rows of the list (both groups and the divider), which the bar follows. */
  let groups = $state<HTMLElement | null>(null);
  let rowBar = $state<RowBar | null>(null);
  /** The next new rows come from the user's own change (sort, place, filter) or from the
   *  re-sort at the end of a run: the rows on screen glide to their new place. */
  let armed = false;
  /** Top edges of the rows before such a change, until the DOM has the new rows. */
  let before: Map<string, number> | null = null;
  let last = untrack(() => ({
    sort: jobs.sortChoice,
    place: jobs.place,
    filter: jobs.filterChoice,
    active: run.active,
  }));

  function rowsOf(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[data-key]')];
  }

  /** Every row on screen glides from where it stood (150 ms); rows far away are simply there.
   *  Every box is read before the first move starts: a read after a started animation lays
   *  the whole list out again, once per row. */
  function glide(root: HTMLElement, from: Map<string, number>): void {
    const height = window.innerHeight;
    const moves: [HTMLElement, number][] = [];
    for (const row of rowsOf(root)) {
      const was = from.get(row.dataset.key ?? '');
      if (was === undefined) continue;
      const box = row.getBoundingClientRect();
      const shift = Math.round(was - box.top);
      const seen = (top: number): boolean => top < height && top + box.height > 0;
      if (shift === 0 || (!seen(was) && !seen(box.top))) continue;
      moves.push([row, Math.max(-height, Math.min(height, shift))]);
    }
    for (const [row, offset] of moves) {
      const motion = play(row, [{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
        duration: 'base',
      });
      motion?.addEventListener('finish', () => motion.cancel());
      if (row.hasAttribute('data-open')) rowBar?.shift(offset);
    }
  }

  /** New jobs of a run that have entered already (each one fades in once; not reactive). */
  let entered: Record<string, true> = {};

  /** A job new in this run fades in where it lands, among the first --stagger-max rows. */
  function enterFresh(root: HTMLElement): void {
    if (jobs.fresh.size === 0) {
      entered = {};
      return;
    }
    for (const job of order.slice(0, staggerLimit())) {
      const key = keyOf(job.key);
      if (!jobs.fresh.has(key) || key in entered) continue;
      entered[key] = true;
      const row = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      if (row) rowEnter(row);
    }
  }

  // What changed the list: the user's sort, place or filter (never while a run streams new
  // rows in), or the end of a run. A search and live updates arm nothing.
  $effect.pre(() => {
    const now = {
      sort: jobs.sortChoice,
      place: jobs.place,
      filter: jobs.filterChoice,
      active: run.active,
    };
    untrack(() => {
      const chosen =
        now.sort !== last.sort || now.place !== last.place || now.filter !== last.filter;
      if ((chosen && !now.active) || (last.active && !now.active)) armed = true;
      last = now;
    });
  });

  // Before the DOM changes: note where the rows stand. The glide stays armed until the
  // change has loaded.
  $effect.pre(() => {
    void shown;
    untrack(() => {
      if (!armed || list === null) return;
      before = new Map(
        rowsOf(list).map((row) => [row.dataset.key ?? '', row.getBoundingClientRect().top]),
      );
      if (jobs.status !== 'loading') armed = false;
    });
  });

  // After the DOM has the new rows: glide from the noted places, at the start of the next
  // frame (before it is drawn): the new rows are laid out once, there, and not a second time
  // inside the task that built them. A new job of a run fades in.
  $effect(() => {
    void shown;
    untrack(() => {
      const root = list;
      const from = before;
      before = null;
      if (root === null) return;
      if (from !== null) requestAnimationFrame(() => glide(root, from));
      enterFresh(root);
    });
  });

  /** Ends with "Endgültig löschen" of a row: the dialog asks first. */
  let purging = $state<JobView | null>(null);
  let purgeBusy = $state(false);
  let purgeError = $state<string | null>(null);

  /** A failed action of a row says so in the list header. */
  function report(error: string | null): void {
    if (error !== null) jobs.actionError = error;
  }

  /** What the row's menu and its tools do: a move goes at once, deleting for good asks
   *  first, a failure says so in the list header. The open job's menu has no "Öffnen". */
  function contextOf(job: JobView): JobMenuContext {
    return {
      open: sameKey(jobs.selected, job.key) ? null : () => select(job),
      purge: () => {
        purgeError = null;
        purging = job;
      },
      report,
    };
  }

  /** The job's menu on a right click (jobMenu of actions.ts, the reader's "…" too). */
  function menuOf(job: JobView): ContextMenu {
    return { label: t.menu.job, entries: jobMenu(job, contextOf(job)) };
  }

  async function purgeRow(): Promise<void> {
    if (purging === null) return;
    purgeBusy = true;
    purgeError = await purge([purging], true);
    purgeBusy = false;
    if (purgeError === null) purging = null;
  }
</script>

<!-- Under an empty state the way on is a field button like the empty state's own; under
     rows with hits a small one. -->
{#snippet alsoIn(size: 'sm' | 'field')}
  <div class="also" data-testid="also-in">
    {#each elsewhere as hit (hit.place)}
      <Button
        variant="secondary"
        {size}
        icon={PLACE_ICON[hit.place]}
        label={t.place.hitsIn[hit.place]}
        count={hit.count}
        testid="also-{hit.place}"
        onclick={() => jobs.setPlace(hit.place)}
      />
    {/each}
  </div>
{/snippet}

<div
  class="list"
  bind:this={list}
  data-testid="job-list"
  aria-label={t.list.label}
  aria-busy={jobs.status === 'loading'}
>
  {#if mailboxMissing && !emptyInboxShown}
    <div class="note">
      <Notice
        tone="info"
        variant="row"
        text={t.list.noMailbox}
        action={{ label: t.list.connectMailbox, onclick: toMailbox }}
        testid="no-mailbox"
      />
    </div>
  {/if}

  {#if profileMissing}
    <div class="note">
      <Notice
        tone="info"
        variant="row"
        heading={profileNote.heading}
        text={profileNote.text}
        action={{ label: profileNote.label, onclick: toProfile }}
        testid="no-profile"
      />
    </div>
  {/if}

  {#if profileThin}
    <div class="note">
      <Notice
        tone="info"
        variant="row"
        text={t.list.thinProfile}
        action={{ label: t.list.openProfile, onclick: () => navigation.go('profile') }}
        testid="thin-profile"
      />
    </div>
  {/if}

  {#if jobs.status === 'error'}
    <div class="empty">
      <EmptyState
        icon="warning"
        tone="danger"
        text={t.list.loadFailed}
        secondary={{
          label: t.common.retry,
          icon: 'retry',
          onclick: () => {
            void jobs.load();
            void jobs.loadOverview();
          },
        }}
        testid="list-error"
      />
    </div>
  {:else if jobs.rows.length === 0 && jobs.status !== 'ready'}
    <!-- Placeholder rows in the rows' shape at once (the rows take their place without a
         jump); they fade in once the list has taken --delay-placeholder (at once when it has
         already, jobs.slow), so a quick list never shows them. -->
    <div class="skeletons" data-testid="list-skeleton">
      {#each SKELETON_ROWS as line (line.index)}
        <div class="skeleton-row">
          <Skeleton shape="circle" size="sm" late={!jobs.slow} />
          <span class="lines">
            <span class="line title">
              <span class="grow"><Skeleton width={line.title} late={!jobs.slow} /></span>
              <span class="stamp"><Skeleton late={!jobs.slow} /></span>
            </span>
            <span class="line"><Skeleton width={line.meta} late={!jobs.slow} /></span>
          </span>
        </div>
      {/each}
    </div>
  {:else if jobs.visible.length === 0 && jobs.status === 'ready'}
    <div class="empty">
      {#if searching}
        <!-- The search's × clears it; the other places' hits are the way on. -->
        <div class="stack">
          <EmptyState
            icon="search"
            tone="neutral"
            text={t.list.noHit(jobs.search.trim())}
            testid="empty-search"
          />
          {#if elsewhere.length > 0}{@render alsoIn('field')}{/if}
        </div>
      {:else if filterEmptied}
        <EmptyState
          icon="filter"
          tone="neutral"
          text={t.list.noFilterHit}
          secondary={{
            label: t.toolbar.filterReset,
            onclick: () => (onresetfilter ? onresetfilter() : jobs.setFilter(NO_FILTER)),
          }}
          testid="empty-filter"
        />
      {:else if place !== 'inbox'}
        <EmptyState
          icon={place === 'trash' ? 'trash' : 'archive'}
          tone="neutral"
          text={t.place.empty[place]}
          testid="empty-place-{place}"
        />
      {:else}
        <!-- A fetch that goes, none yet, or one that read no jobs: what comes, and the way on. -->
        <EmptyState
          icon="inbox"
          tone="neutral"
          text={mailboxMissing ? t.list.noMailbox : emptyInbox}
          secondary={emptyAction}
          testid="empty-all"
        />
      {/if}
    </div>
  {:else}
    {#snippet row(job: JobView, open: boolean)}
      <!-- The open job's row is marked by the list's one bar. -->
      <JobRow
        {job}
        ring={!profileMissing}
        marks={searchWords}
        pending={pending && job.match === null}
        selected={open}
        bar={false}
        onselect={select}
        onopen={(job) => void openAd(job).then(report)}
        menu={() => menuOf(job)}
        tools={() => rowTools(job, contextOf(job))}
      />
    {/snippet}
    {#snippet group(items: JobView[])}
      {#each items as job (keyOf(job.key))}
        {@const key = keyOf(job.key)}
        {@const open = key === openKey}
        <div
          class="item"
          data-key={key}
          data-open={open ? '' : undefined}
          out:rowCollapse={{ on: moving.has(key) }}
        >
          {@render row(job, open)}
        </div>
      {/each}
    {/snippet}
    <div class="groups" bind:this={groups}>
      <!-- Another list is built anew: its old rows leave as one piece, not row by row. -->
      {#key jobs.generation}
        <div class="rows" data-testid="job-rows">
          {@render group(active)}
        </div>
        {#if excluded.length > 0}
          <ListDivider
            label={t.list.excluded}
            count={excludedCount}
            open={excludedOpen}
            ontoggle={toggleExcluded}
            testid="excluded-divider"
          />
          {#if excludedOpen}
            <div class="rows" data-testid="excluded-rows" transition:unfold>
              {@render group(excluded)}
            </div>
          {/if}
        {/if}
      {/key}
    </div>
    {#if elsewhere.length > 0 && !more}{@render alsoIn('sm')}{/if}
    {#if jobs.pageError}
      <div class="page-error">
        <Notice
          tone="warning"
          variant="row"
          text={t.list.pageFailed}
          action={{ label: t.common.retry, icon: 'retry', onclick: () => void jobs.grow() }}
          testid="page-error"
        />
      </div>
    {:else if more}
      {#key shown.length}
        <div class="sentinel" use:nearEnd={() => void jobs.grow()}>
          <Skeleton width={60} late />
        </div>
      {/key}
    {/if}
  {/if}
  <RowBar
    bind:this={rowBar}
    rows={groups}
    open={marked}
    muted={markedExcluded}
    {listed}
    folding={moving}
    generation={jobs.generation}
  />
</div>

<Dialog
  open={purging !== null}
  variant="danger"
  heading={t.actions.purgeHeading}
  text={t.actions.purgeText}
  confirmLabel={t.actions.purgeConfirm}
  busy={purgeBusy}
  error={purgeError}
  testid="dialog-purge"
  onconfirm={() => void purgeRow()}
  oncancel={() => (purging = null)}
/>

<style>
  /* The containing block of the rows' one selection bar (RowBar). */
  .list {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }

  /* A slim line at the top of the list (no mailbox, no profile). */
  .note {
    padding: var(--space-12) var(--pane-padding);
    border-bottom: var(--border-width) solid var(--border);
  }

  /* Search hits in the other places: buttons under the hits of this one. */
  .also {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-16);
    padding: var(--space-12) var(--pane-padding);
  }

  .page-error {
    padding: var(--space-12) var(--pane-padding);
  }

  /* Plain block flow: a flex column adds nothing here and costs a little more each time the
     rows are laid out again. */
  .groups,
  .rows {
    display: block;
  }

  .stack {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }

  /* Under a centred empty state the links are centred too (under rows they start left), as
     far below its sentence as the empty state's own way on. */
  .stack > .also {
    justify-content: center;
    padding: var(--space-16) 0 0;
  }

  .empty {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: var(--space-32) var(--pane-padding);
  }

  .skeletons {
    display: flex;
    flex-direction: column;
  }

  /* Laid out like a row (ListRow, JobRow): the ring and the title at its top, the next line
     under it, so nothing moves when the rows arrive. */
  .skeleton-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-12);
    height: var(--row-height);
    padding: var(--space-12) var(--pane-padding);
    border-bottom: var(--border-width) solid var(--border);
  }

  .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
  }

  .line {
    display: flex;
    align-items: center;
    height: var(--leading-sm);
  }

  .line.title {
    gap: var(--space-6);
    height: var(--leading-title);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  /* The stamp at the end of the title line (the time of a mail). */
  .stamp {
    flex: none;
    width: calc(var(--control-sm) + var(--space-8));
  }

  .sentinel {
    padding: var(--pane-padding);
  }
</style>
