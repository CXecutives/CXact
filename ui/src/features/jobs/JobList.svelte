<!--
  The job list: one list per place in the chosen order, rows in windows of 60 (a sentinel at
  the end shows the next window), a new job of a run fades in where it lands (the rows below
  simply make room). Rows move only for the user's own change and for the re-sort at the end
  of a run: after the order, another place or a filter the rows on screen glide to their new
  place (150 ms); rows off screen and new rows are simply there. A search and live updates
  never move anything. An unopened job carries the coral dot until it is opened. At the end of
  every place the excluded jobs, grey, in one section "Ausgeschlossen (n)" that is folded by
  default (the choice is kept; the count where the list knows it; the arrows skip a folded
  section, and it opens when its job is opened from elsewhere). A page that fails to load
  while scrolling says so at the end of the list, with a retry. A search looks in the list's
  place; under its hits a button names each other place with hits ("Im Archiv (2)", counted
  without the inbox's filter) and goes there with the search. Each row's tools are the job's
  actions where it is (Archivieren, Löschen, the star; in the Papierkorb Wiederherstellen,
  Endgültig löschen); a row the user moves out folds away. Its menu (a right click) is the
  table JOB_MENU of actions.ts. A click opens a job; one coral bar marks the open job's row
  and slides from row to row (RowBar). Back in the Jobs view, the open job's row is
  in view again.  in view again. A row move that fails says so in the list header. An empty inbox says where
  jobs come from (an alert on each portal, older mails; reading the whole mailbox asks first,
  as in Einstellungen); a filter that leaves nothing says so and takes itself off ("Filter
  zurücksetzen"). Every empty state has exactly one reason and at most one way out
  (secondary: the header holds the view's primary). Without a mailbox one slim note at the top
  says how to connect one; without a usable profile one says that there is no fit without it
  and leads to the Profil view (the rings stay, empty); a thin profile one calm line that the
  fit stays rough. A list that fails to load says only that, with a retry (the header hides
  its counts and tools). Every empty state of the list is one pattern: an icon, one sentence,
  at most one way out, centred.
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import type { IconName } from '$components/Icon.svelte';
  import Dialog from '$components/Dialog.svelte';
  import JobRow, { type RowTool } from '$components/JobRow.svelte';
  import ListDivider from '$components/ListDivider.svelte';
  import Notice from '$components/Notice.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import { nearEnd } from '$lib/actions/nearEnd';
  import { t } from '$lib/i18n/t';
  import { invoke } from '$lib/ipc/api';
  import { errorText } from '$lib/i18n/texts';
  import { displayTitle } from '$lib/i18n/format';
  import type { JobView, Place, Portal } from '$lib/ipc/types';
  import { play, staggerLimit } from '$lib/motion/motion';
  import { rowCollapse, rowEnter } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { NO_FILTER } from '$lib/state/filter';
  import { isExcluded, jobs, keyOf, sameKey } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { editor } from '$lib/state/profile.svelte';
  import { run } from '$lib/state/run.svelte';
  import type { ContextMenu } from '$lib/input/input';
  import type { MenuEntry } from '$lib/state/menu.svelte';
  import {
    actionsOf,
    disarm,
    guarded,
    hasStar,
    JOB_MENU,
    type JobMenuItem,
    move,
    moving,
    purge,
    toggleStar,
  } from './actions';
  import { glideIntoView } from '$lib/motion/scroll';
  import { copyJobPrompt } from './prompt';
  import RowBar from './RowBar.svelte';

  interface Props {
    /** "Filter zurücksetzen" of a filter that leaves nothing: the header takes the filter off
     *  and keeps the keyboard focus (the button goes with the empty state). */
    onresetfilter?: () => void;
  }
  let { onresetfilter }: Props = $props();

  const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

  const shown = $derived(jobs.shown);
  const searching = $derived(jobs.search.trim() !== '');
  /** The rows as far as the window reaches: the active ones, then the excluded ones. */
  const active = $derived(shown.filter((job) => !isExcluded(job)));
  const excluded = $derived(shown.filter(isExcluded));
  // How many excluded jobs the list holds: the counts of each place know it (with the search
  // and the filter, like the list; the favourites narrow only the list), the favourites once
  // every page is there.
  const excludedCount = $derived.by((): number | null => {
    if (jobs.place === 'inbox' && !jobs.filter.favourites) return jobs.counts.excluded;
    if (jobs.place === 'archive') return jobs.counts.excludedArchive;
    if (jobs.place === 'trash') return jobs.counts.excludedTrash;
    if (jobs.rows.length < jobs.total) return null;
    return jobs.visible.filter(isExcluded).length;
  });

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
  /** The Übersicht's "Ansehen" of the excluded jobs: the section opens and comes into view
   *  once its divider is there (the backend lists the excluded jobs last). */
  let excludedDivider: HTMLElement | undefined = $state();
  $effect(() => {
    if (!jobs.revealExcluded || excludedDivider === undefined) return;
    untrack(() => {
      jobs.revealExcluded = false;
      if (!excludedOpen) toggleExcluded();
      void tick().then(() => {
        if (excludedDivider !== undefined) glideIntoView(excludedDivider, 'center');
      });
    });
  });
  /** The folded section ends the list: every other row is loaded (the backend lists the
   *  excluded jobs last), so no more pages are fetched until it opens. */
  const foldedEnd = $derived(!excludedOpen && excluded.length > 0);
  const more = $derived(jobs.more && !foldedEnd);
  /**
   * The inbox's filter leaves the list empty while the inbox holds jobs (the counts over
   * every job): it says so and takes the filter off.
   */
  const filterEmptied = $derived(jobs.filtered && (jobs.overviewCounts ?? jobs.counts).inbox > 0);
  // "No jobs in the alert mails" only after a fetch that read the mailbox.
  const lastFetch = $derived(run.summary ?? app.state?.lastRun ?? null);
  const mailRead = $derived(lastFetch?.outcome.kind === 'completed' && lastFetch.scan !== null);
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

  // A job opened from elsewhere (the Übersicht, an undo) whose row is folded away: its
  // section opens (for now; the kept choice stays).
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
  // counted without the inbox's filter (the store's hitCounts).
  const place = $derived(jobs.place);
  const PLACES: readonly Place[] = ['inbox', 'archive', 'trash'];
  /** The glyph of each place (the tabs' meaning: the inbox, the archive, the trash). */
  const PLACE_ICON: Record<Place, IconName> = {
    inbox: 'inbox',
    archive: 'archive',
    trash: 'trash',
  };
  const elsewhere = $derived.by(() => {
    if (!searching) return [];
    const counts = jobs.hitCounts ?? jobs.counts;
    return PLACES.filter((other) => other !== place)
      .map((other) => ({ place: other, count: counts[other] }))
      .filter((hit) => hit.count > 0);
  });
  const PORTALS = $derived((app.state?.portals ?? []).filter((p) => p.enabled));
  /** A portal's page that did not open (said under the links). */
  let portalError = $state<string | null>(null);
  function openPortal(portal: Portal): void {
    portalError = null;
    invoke('open_target', { target: { kind: 'portalHome', portal } }).catch((error: unknown) => {
      portalError = errorText(error);
    });
  }
  /** "Ältere Mails lesen" asks first, like Einstellungen: it fetches more portal pages. */
  let confirmOlder = $state(false);

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

  function pin(job: JobView): void {
    if (!guarded()) toggleStar([job]);
  }

  /** Ends with "Endgültig löschen" of a row: the dialog asks first. */
  let purging = $state<JobView | null>(null);
  let purgeBusy = $state(false);
  let purgeError = $state<string | null>(null);

  /** The row's tools: the job's actions where it is (deleting for good waits for a run: the
   *  backend refuses meanwhile). */
  function toolsOf(job: JobView): RowTool[] {
    return actionsOf(job.place).map((action) => ({
      id: action.id,
      icon: action.icon,
      label: action.label,
      disabled: action.id === 'purge' && run.active,
      disabledReason: run.busyText,
      onclick: () => {
        if (action.id === 'purge') {
          purgeError = null;
          purging = job;
        } else {
          void move([job], action.id).then((error) => (jobs.actionError = error));
        }
      },
    }));
  }

  /**
   * The job's menu on a right click (the table JOB_MENU of actions.ts): open it, its ad, the
   * star, its moves and the prompt.
   */
  function menuOf(job: JobView): ContextMenu {
    const list = [job];
    const report = (error: string | null): void => {
      if (error !== null) jobs.actionError = error;
    };
    type Own = Exclude<JobMenuItem['id'], 'moves'>;
    const runs: Record<Own, () => void> = {
      open: () => select(job),
      'open-ad': () => {
        invoke('open_target', { target: { kind: 'jobUrl', key: job.key } }).catch(
          (error: unknown) => report(errorText(error)),
        );
      },
      star: () => toggleStar(list),
      prompt: () => void copyJobPrompt(job.key).then(report),
    };
    const labels: Record<Own, string> = {
      open: t.menu.open,
      'open-ad': t.reader.open,
      star: list.some((chosen) => !chosen.pinned) ? t.reader.pin : t.reader.unpin,
      prompt: t.reader.prompt,
    };
    const entries: MenuEntry[] = [];
    for (const group of JOB_MENU) {
      const items: MenuEntry[] = [];
      for (const item of group) {
        if (!item.shows(job)) continue;
        if (item.id !== 'moves') {
          items.push({
            id: item.id,
            label: labels[item.id],
            icon: item.icon,
            run: runs[item.id],
          });
          continue;
        }
        for (const action of actionsOf(job.place)) {
          items.push({
            id: action.id,
            label: action.label,
            icon: action.icon,
            danger: action.id === 'purge',
            disabled: action.id === 'purge' && run.active,
            reason: action.id === 'purge' ? run.busyText : null,
            run: () => {
              if (action.id === 'purge') {
                purgeError = null;
                purging = job;
              } else {
                void move(list, action.id).then(report);
              }
            },
          });
        }
      }
      if (items.length === 0) continue;
      if (entries.length > 0) entries.push({ kind: 'separator' });
      entries.push(...items);
    }
    return { label: t.menu.job, entries };
  }

  async function purgeRow(): Promise<void> {
    if (purging === null) return;
    purgeBusy = true;
    purgeError = await purge([purging]);
    purgeBusy = false;
    if (purgeError === null) purging = null;
  }
</script>

{#snippet alsoIn()}
  <div class="also" data-testid="also-in">
    {#each elsewhere as hit (hit.place)}
      <Button
        variant="secondary"
        size="sm"
        icon={PLACE_ICON[hit.place]}
        label={t.place.hitsIn[hit.place](hit.count)}
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
  {#if mailboxMissing}
    <div class="note">
      <Notice
        tone="info"
        variant="row"
        text={t.list.noMailbox}
        action={{ label: t.list.connectMailbox, onclick: () => navigation.go('settings') }}
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
    <!-- Only once the list has taken a while (jobs.slow): then at once, never blank rows. -->
    {#if jobs.slow}
      <div class="skeletons" data-testid="list-skeleton">
        {#each SKELETON_ROWS as index (index)}
          <div class="skeleton-row">
            <Skeleton shape="circle" size="sm" />
            <span class="lines">
              <span class="line title"><Skeleton width={70} /></span>
              <span class="line"><Skeleton width={45} /></span>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {:else if jobs.visible.length === 0 && jobs.status === 'ready'}
    <div class="empty">
      {#if searching}
        <div class="stack">
          <EmptyState
            icon="search"
            tone="neutral"
            text={t.list.noHit(jobs.search.trim())}
            secondary={{ label: t.field.clear, icon: 'close', onclick: () => jobs.setSearch('') }}
            testid="empty-search"
          />
          {#if elsewhere.length > 0}{@render alsoIn()}{/if}
        </div>
      {:else if place !== 'inbox'}
        <EmptyState
          icon={place === 'trash' ? 'trash' : 'archive'}
          tone="neutral"
          text={t.place.empty[place]}
          testid="empty-place-{place}"
        />
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
      {:else if run.active || !mailRead}
        <!-- A fetch that goes, or none yet: only what comes (no setup links). -->
        <EmptyState
          icon="jobs"
          tone="neutral"
          text={run.active ? t.list.emptyWhileRun : t.list.emptyAll}
          testid="empty-all"
        />
      {:else}
        <div class="sources">
          <EmptyState icon="jobs" tone="neutral" text={t.list.emptyAfterRun} testid="empty-all" />
          <div class="sources-actions">
            {#each PORTALS as portal (portal.portal)}
              <Button
                variant="ghost"
                size="sm"
                icon="external"
                external
                label={t.list.createAlert(t.portal[portal.portal])}
                testid="alert-{portal.portal}"
                onclick={() => openPortal(portal.portal)}
              />
            {/each}
            {#if app.hasMailbox}
              <Button
                variant="ghost"
                size="sm"
                icon="alertMail"
                label={t.list.readOlder}
                disabled={run.fetchBlocked !== null}
                disabledReason={run.fetchBlocked}
                testid="read-older"
                onclick={() => (confirmOlder = true)}
              />
            {/if}
          </div>
          {#if portalError}
            <Notice tone="danger" variant="inline" text={portalError} testid="portal-error" />
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    {#snippet row(job: JobView, open: boolean)}
      <!-- The open job's row is marked by the list's one bar. -->
      <JobRow
        {job}
        ring={!profileMissing}
        pending={pending && job.match === null}
        selected={open}
        bar={false}
        onselect={select}
        onpin={hasStar(job.place) ? pin : null}
        tools={toolsOf(job)}
        menu={() => menuOf(job)}
        trashDays={app.state?.autoEmptyTrashDays ?? 0}
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
          <div bind:this={excludedDivider}>
            <ListDivider
              label={t.list.excluded}
              count={excludedCount}
              open={excludedOpen}
              ontoggle={toggleExcluded}
              testid="excluded-divider"
            />
          </div>
          {#if excludedOpen}
            <div class="rows" data-testid="excluded-rows">
              {@render group(excluded)}
            </div>
          {/if}
        {/if}
      {/key}
    </div>
    {#if elsewhere.length > 0 && !more}{@render alsoIn()}{/if}
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
  bind:open={confirmOlder}
  heading={t.settings.fullMailboxHeading}
  text={t.settings.fullMailboxText}
  confirmLabel={t.settings.fullMailboxConfirm}
  testid="dialog-read-older"
  onconfirm={() => {
    confirmOlder = false;
    void run.start({ kind: 'fullMailbox' });
  }}
/>

<Dialog
  open={purging !== null}
  variant="danger"
  heading={purging ? t.actions.purgeOne(displayTitle(purging.title)) : t.actions.purgeHeading(1)}
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

  /* Under a centred empty state the links are centred too (under rows they start left). */
  .stack > .also {
    justify-content: center;
    padding-inline: 0;
  }

  /* The empty list says where jobs come from, like every empty state (an icon, one
     sentence), and its ways out are the portals' alerts and the older mails. */
  .sources {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-12);
    max-width: var(--list-min);
  }

  /* The block is centred, its links start on one line (their icons on one axis). */
  .sources-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
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
    height: var(--leading-title);
  }

  .sentinel {
    padding: var(--pane-padding);
  }
</style>
