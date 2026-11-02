<!--
  The job list (the round 10 draft): one list per place, Aktuell and the Archiv in the chosen
  order, the Papierkorb by date, rows in windows of 60 (a sentinel at the end shows the next
  window), 6 in from the column's edges. In the
  order by date (the default, decision 1) the scored jobs stand under the headings of their
  days (DayGroup: the local day a job came into CXact, in the Papierkorb the day it went
  there; "Heute", "Gestern", "Mi 23.09.", rolling over at midnight with the page's clock),
  each heading sticking to the top while its rows pass; the flat orders (Nach
  Übereinstimmung, Nach Tagessatz) have none and keep the head's hairline once the list
  scrolled (as does a list scrolled past its days). After the scored jobs of every place the
  ones without a score yet in a section "Noch nicht bewertet", open by default, and at the end
  the excluded jobs, the red ban in the ring's place, in one section "Ausgeschlossen" that is
  folded by default (ListDivider, no count; each choice is kept; a section opens when its job
  is opened from elsewhere or the open job's row goes there, and stands open, its heading
  locked, while the list holds a search's answer, so a hit is never hidden behind a fold, and
  while no row of the place would show without it, lib/state/sections.svelte.ts). Neither
  section has days.
  The list of another place lets its first 10 rows rise 8 px one after the other (24 ms
  apart) while their rings fill and count up; the start, a return to Jobs, a filter, a
  search, a selection and fast browsing (pace.ts) show the list at once. A new job of a run rises in where it lands (the
  rows below simply make room; the rows already there never flicker). Rows move only for the
  user's own change and for the re-sort at the end of a run: after the order or a filter the
  rows on screen and the sections' headings glide to their new place (180 ms), as the days'
  headings go or come with the answer; rows off screen and new rows are simply there. A row the user moves out folds its height away (its day or its section
  with its last row). One highlight marks the open job's row and glides from row to row (RowBar).
  A page that fails to load while scrolling says so at the end of the list, with a retry. A
  search looks in the list's place; under its hits a button names each other place that lists
  a hit by its own rule (jobs.hitsIn), by its name (no count), and goes there with the search.
  A click opens a job and brings a row that is cut whole into view (a glide, as little as it
  takes), a double click opens its ad in the browser, a right click its menu
  (jobMenu of actions.ts); under the pointer the row shows the moves of its place as its tools
  (rowTools, the same table). The rows are pressed, not focused (`data-press-only`, like the
  list's head and the sidebar): after a click the keys scroll the list on both OS, Tab still
  reaches them. Back in the Jobs view, the list stands where it was scrolled to.
  A job action that fails says so in the list header.
  What the list shows is the answer it holds: a search or a filter on its way changes nothing
  until its answer comes, neither the rows, their marks and sections, the buttons to the other
  places nor the state of no hit.
  Empty: a place without jobs takes the whole width (JobsView) and says so at the top
  (EmptyState `list`: the briefcase, the archive, the trash, a heading and one sentence;
  Aktuell before the first search, while one fills it, after one that found nothing that fits
  with "Profil öffnen", and with its jobs all moved away). With no job anywhere, nothing
  searched or filtered and no run (jobs.bare) the list has no head: its empty state stands in
  the middle, like the job view's, with "Jobs suchen" as its one primary under its sentence. A
  search without hits has the same empty state at the top (the owner, 2026-10-30), with the other
  places' hits under it; a filter that leaves nothing too, and it takes itself off ("Filter
  zurücksetzen"), also when it leaves a search without hits.
  Placeholder rows (a ring and a line) come once the list takes 300 ms. Without a usable
  profile a state box on top says so and leads to the Profil ("Profil anlegen", or "Profil
  ergänzen" to the first field it lacks); a thin profile one box with the engine's reason and
  "Profil ergänzen". A list that fails to load says only that, in the middle with its retry,
  and has no head while no run goes (JobsView).
-->
<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import type { IconName } from '$components/Icon.svelte';
  import Dialog from '$components/Dialog.svelte';
  import JobRow from '$components/JobRow.svelte';
  import ListDivider from '$components/ListDivider.svelte';
  import Notice from '$components/Notice.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import StateBox, { type StateAction } from '$components/StateBox.svelte';
  import { inView } from '$lib/actions/inView';
  import { nearEnd } from '$lib/actions/nearEnd';
  import { dayKey, displayTitle, formatDayHeading } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { warningText } from '$lib/i18n/texts';
  import type { JobView, Place } from '$lib/ipc/types';
  import { searchWords } from '$lib/marks';
  import { play, staggerLimit } from '$lib/motion/motion';
  import { animateOpen } from '$lib/motion/pace';
  import { glideWhole } from '$lib/motion/scroll';
  import { afterUnfold, rowCollapse, rowEnter, unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { NO_FILTER } from '$lib/state/filter';
  import { allIn, isExcluded, isUnscored, keyOf, sameKey } from '$lib/state/jobRows';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { sections } from '$lib/state/sections.svelte';
  import type { ContextMenu } from '$lib/input/input';
  import {
    focusPlace,
    jobMenu,
    moving,
    openAd,
    purge,
    returning,
    rowTools,
    seen,
    type JobMenuContext,
  } from './actions';
  import DayGroup from './DayGroup.svelte';
  import { completeProfile, fetchBlocked } from './profileGaps';
  import RowBar from './RowBar.svelte';

  interface Props {
    /** "Filter zurücksetzen" of a filter that leaves nothing: the header takes the filter off
     *  and keeps the keyboard focus (the button goes with the empty state; `true` when the
     *  keyboard pressed it). */
    onresetfilter?: (fromKeyboard: boolean) => void;
    /** Whether the head draws its hairline: the list scrolled beneath it and no day's
     *  heading sticks at its top. */
    online?: (line: boolean) => void;
  }
  let { onresetfilter, online }: Props = $props();

  /** The placeholder rows while the list loads, each line a little shorter or longer than
   *  the one before (percent of its room). */
  const SKELETON_ROWS = [0, 1, 2, 3, 4, 5].map((index) => ({
    index,
    width: 72 - (index % 3) * 14,
  }));

  const shown = $derived(jobs.shown);
  /** The list holds the answer to a search. */
  const searching = $derived(jobs.listedSearch !== '');
  /** The words of that search, marked in the rows' titles. */
  const marks = $derived(searchWords(jobs.listedSearch));
  /** The rows as far as the window reaches: the scored ones, the ones without a score yet,
   *  then the excluded ones. */
  const active = $derived(shown.filter((job) => !isExcluded(job) && !isUnscored(job)));
  const unscored = $derived(shown.filter(isUnscored));
  const excluded = $derived(shown.filter(isExcluded));

  /* ----------------------------------------------------------------------- days */

  /** The order by date heads its scored rows by their days (the headings go and come with the
   *  list's answer, as its rows glide). */
  const dayed = $derived(jobs.listedSort === 'newest');
  /** The moment that dates a row: when it came, in the Papierkorb when it went there. */
  const dated = (job: JobView): string =>
    (job.place === 'trash' ? job.trashedAt : null) ?? job.firstSeenAt;
  /** The days of the scored rows in the list's order (a day the backend splits stays split:
   *  each run of rows is its own group, keyed apart), or one group without a heading. */
  const days = $derived.by(() => {
    if (!dayed) return [{ id: 'all', at: null as string | null, jobs: active, start: 0 }];
    const groups: { id: string; at: string | null; jobs: JobView[]; start: number }[] = [];
    const seen: Record<string, number> = {};
    active.forEach((job, index) => {
      const day = dayKey(dated(job));
      const last = groups.at(-1);
      if (last !== undefined && last.id.startsWith(`${day}#`)) {
        last.jobs.push(job);
        return;
      }
      const runs = (seen[day] ?? 0) + 1;
      seen[day] = runs;
      groups.push({ id: `${day}#${runs}`, at: dated(job), jobs: [job], start: index });
    });
    return groups;
  });

  /* ------------------------------------------------------------------- sections */

  /** A section is open (lib/state/sections.svelte.ts, kept like the order): the excluded one
   *  folded by default, the one without a score yet open; a search's answer holds both open. */
  const excludedOpen = $derived(sections.excludedShown);
  const unscoredOpen = $derived(sections.unscoredShown);
  /** The folded section ends the list: every other row is loaded (the backend lists the
   *  excluded jobs last), so no more pages are fetched until it opens. */
  const foldedEnd = $derived(!excludedOpen && excluded.length > 0);
  const more = $derived(jobs.more && !foldedEnd);
  /** The sections that hold rows: each with its heading, and its rows behind its fold. */
  const shownSections = $derived(
    [
      {
        id: 'unscored',
        label: t.list.unscored,
        jobs: unscored,
        open: unscoredOpen,
        toggle: sections.unscoredHeld ? null : () => sections.toggleUnscored(),
        start: active.length,
      },
      {
        id: 'excluded',
        label: t.list.excluded,
        jobs: excluded,
        open: excludedOpen,
        toggle: sections.excludedHeld ? null : () => sections.toggleExcluded(),
        start: active.length + unscored.length,
      },
    ].filter((section) => section.jobs.length > 0),
  );

  /* ---------------------------------------------------------------------- empty */

  /** The jobs of every place, whatever the search and the filter. */
  const totals = $derived(jobs.overviewCounts ?? jobs.counts);
  /** The filter leaves the list empty while the place holds jobs: it says so and takes the
   *  filter off. */
  const filterEmptied = $derived(jobs.listedFiltered && totals[jobs.place] > 0);
  const place = $derived(jobs.place);
  /** The glyph of each place (the sidebar's Jobs, the archive, the trash). */
  const PLACE_ICON: Record<Place, IconName> = {
    inbox: 'jobs',
    archive: 'archive',
    trash: 'trash',
  };
  /** An empty place: Aktuell while a search fills it, after one that found nothing that fits
   *  (or, its jobs all moved away, that there are none), before any; the Archiv; the
   *  Papierkorb. */
  const lastFetch = $derived(run.summary ?? app.state?.lastRun ?? null);
  const empty = $derived.by((): { heading: string; text: string; profile: boolean } => {
    if (place !== 'inbox') return { ...t.list.empty[place], profile: false };
    if (run.searching) return { ...t.list.empty.running, profile: false };
    if (lastFetch?.outcome.kind === 'completed') {
      return totals.archive + totals.trash === 0
        ? { ...t.list.empty.noMatch, profile: true }
        : { ...t.list.empty.noActive, profile: false };
    }
    return { ...t.list.empty.inbox, profile: false };
  });

  /** A search or a filter that leaves nothing, in the words of an empty state. */
  const noHit = $derived.by((): { heading: string; text: string } => {
    const query = jobs.listedSearch;
    if (!searching) return { heading: t.list.noFilterHit, text: t.list.noFilterHitText };
    return jobs.listedFiltered
      ? { heading: t.list.noHitFiltered(query), text: t.list.noHitFilteredText }
      : { heading: t.list.noHit(query), text: t.list.noHitText };
  });

  /* -------------------------------------------------------------------- profile */

  const profileMissing = $derived(app.state !== null && !app.hasProfile);
  /** No usable profile: none yet, one that does not read, one that lacks a field. */
  const profileNote = $derived.by((): { heading: string; text: string; action: StateAction } => {
    const profile = app.state?.profile ?? null;
    if (profile === null) {
      return {
        heading: t.list.noProfile,
        text: t.list.noProfileText,
        action: { label: t.list.createProfile, icon: 'add', onclick: toProfile },
      };
    }
    if (profile.parseError !== null) {
      return {
        heading: t.list.profileUnreadable,
        text: t.list.profileBrokenText,
        action: { label: t.list.openProfile, icon: 'profile', onclick: toProfile },
      };
    }
    return {
      heading: t.list.profileEmpty,
      text: t.list.profileBrokenText,
      action: { label: t.list.completeProfile, icon: 'edit', onclick: completeProfile },
    };
  });

  /** Profil: without a profile its start page with the ways (user decision 2026-10-01: the
   *  same wherever a new profile begins). */
  function toProfile(): void {
    navigation.go('profile');
  }

  /** A profile the app understands little of: the fit is rough, said once on top with what
   *  the engine found thin. */
  const profileThin = $derived(app.hasProfile && app.state?.profile?.quality === 'thin');
  const thinWhy = $derived(
    warningText(app.state?.profile?.understood?.warnings[0] ?? null) ?? t.list.thinProfileText,
  );
  // Jobs without a match get one soon while a run goes or a rescore is pending.
  const pending = $derived(jobs.scoring);

  /* ---------------------------------------------------------------------- rows */

  /** The rows the list shows (a row on the page that is not among them is leaving). */
  const listed = $derived(new Set(shown.map((job) => keyOf(job.key))));
  const openKey = $derived(jobs.selected ? keyOf(jobs.selected) : null);
  const markedExcluded = $derived(
    openKey !== null && excluded.some((job) => keyOf(job.key) === openKey),
  );
  const markedUnscored = $derived(
    openKey !== null && unscored.some((job) => keyOf(job.key) === openKey),
  );
  /** The highlight's row: none while the open job's section is folded (its rows leave after
   *  the fold without a change of size the highlight would hear of). */
  const barOpen = $derived(
    (markedExcluded && !excludedOpen) || (markedUnscored && !unscoredOpen) ? null : openKey,
  );

  // A job opened from elsewhere (an undo, the job kept open from the last start) whose row
  // is folded away, or the open job whose own row goes into a section (a run excludes it, the
  // undo of "Trotzdem bewerten"): its section opens (for now; the kept choice stays), and a row
  // that moved stays in view. A fold by hand keeps working: the row stays where it was. A row a
  // search holds open is not folded away: its section goes back to the kept choice with the
  // search. A job is settled once its row is mounted: one opened before its row came (the kept
  // job, beyond the first rows) opens its section when the row comes.
  let lastMarked: string | null = null;
  let lastSection: 'excluded' | 'unscored' | null = null;
  $effect(() => {
    const key = openKey;
    const section = markedExcluded ? 'excluded' : markedUnscored ? 'unscored' : null;
    untrack(() => {
      if (section !== null && (key !== lastMarked || section !== lastSection)) {
        if (section === 'excluded' && !excludedOpen) sections.excludedOpen = true;
        if (section === 'unscored' && !unscoredOpen) sections.unscoredOpen = true;
        if (key !== null && key === lastMarked) jobs.reveal = { key, focus: false };
      }
      if (key === null || listed.has(key)) {
        lastMarked = key;
        lastSection = section;
      }
    });
  });

  // Back in the Jobs view (the list is built anew): what the header said about an action in
  // another list goes. The list stands where it was scrolled to (JobsView keeps its place), so
  // the open job's row is where the user left it.
  onMount(() => jobs.quiet());

  // The open job after a move or a re-sort: once its row is mounted it scrolls into view (and
  // takes the focus when the focus was on the row that left). A row in a section that is
  // still unfolding scrolls once the section has its height.
  $effect(() => {
    const want = jobs.reveal;
    void shown;
    void excludedOpen;
    void unscoredOpen;
    if (want === null) return;
    untrack(() => {
      const row = list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(want.key)}"] .row`);
      if (!row) return;
      jobs.reveal = null;
      if (want.focus) row.focus({ preventScroll: true });
      afterUnfold(row, () => {
        if (row.isConnected) row.scrollIntoView({ block: 'nearest' });
      });
    });
  });

  /** A click opens the job (the open one stays open and has been looked at), and a row cut by the
   *  day's heading that sticks over it or by the end of the list's pane comes whole into view. */
  function select(job: JobView): void {
    if (sameKey(jobs.selected, job.key)) seen(job.key);
    else void jobs.select(job, true);
    const item = list?.querySelector(`[data-key="${CSS.escape(keyOf(job.key))}"]`);
    if (item) glideWhole(item, dayed && !isExcluded(job) && !isUnscored(job));
  }

  // A search looks in the list's place; the other places that list hits are named under them.
  const PLACES: readonly Place[] = ['inbox', 'archive', 'trash'];
  const elsewhere = $derived(
    searching ? PLACES.filter((other) => other !== place && jobs.hitsIn(other) > 0) : [],
  );

  /* ---------------------------------------------------------------------- opens */

  /** The next list that is there opens (rises and counts up): another place was chosen. The
   *  list the Jobs view comes with (the start, a return from another view) is simply there. */
  let opening = false;
  let openedPlace = untrack(() => jobs.place);
  /** The list (its generation) that opened with motion; another one is simply there. */
  let openedGeneration = $state(Number.NaN);
  $effect.pre(() => {
    const generation = jobs.generation;
    const now = jobs.place;
    const ready = jobs.status === 'ready';
    untrack(() => {
      if (now !== openedPlace) {
        openedPlace = now;
        opening = true;
      }
      if (!opening || !ready) return;
      opening = false;
      openedGeneration = animateOpen() ? generation : Number.NaN;
    });
  });
  const opened = $derived(jobs.generation === openedGeneration);

  /* --------------------------------------------------------------------- glides */

  let list = $state<HTMLElement | null>(null);
  let rowBar = $state<RowBar | null>(null);
  /** The next new rows come from the user's own change (sort, filter) or from the re-sort at
   *  the end of a run: the rows on screen and the sections' headings glide to their new place. */
  let armed = false;
  /** Top edges of what glides before such a change, until the DOM has the new rows. */
  let before: Map<string, number> | null = null;
  let last = untrack(() => ({
    sort: jobs.sortChoice,
    filter: jobs.filterChoice,
    active: run.active,
  }));

  /** What glides: the rows and the sections' headings among them, each by a key of its own. */
  function rowsOf(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[data-key], [data-testid$="-divider"]')];
  }
  const glideKey = (node: HTMLElement): string => node.dataset['key'] ?? node.dataset['testid']!;

  /** Everything on screen glides from where it stood (180 ms, ease-out, as every glide); rows
   *  far away are simply there.
   *  Every box is read before the first move starts: a read after a started animation lays
   *  the whole list out again, once per row. */
  function glide(root: HTMLElement, from: Map<string, number>): void {
    const height = window.innerHeight;
    const moves: [HTMLElement, number][] = [];
    for (const row of rowsOf(root)) {
      const was = from.get(glideKey(row));
      if (was === undefined) continue;
      const box = row.getBoundingClientRect();
      const shift = Math.round(was - box.top);
      const seen = (top: number): boolean => top < height && top + box.height > 0;
      if (shift === 0 || (!seen(was) && !seen(box.top))) continue;
      moves.push([row, Math.max(-height, Math.min(height, shift))]);
    }
    for (const [row, offset] of moves) {
      const motion = play(row, [{ transform: `translateY(${offset}px)` }, { transform: 'none' }], {
        duration: 'slow',
        easing: 'out',
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
    for (const job of shown.slice(0, staggerLimit())) {
      const key = keyOf(job.key);
      if (!jobs.fresh.has(key) || key in entered) continue;
      entered[key] = true;
      const row = root.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
      if (row) rowEnter(row);
    }
  }

  // What changed the list: the user's sort or filter (never while a run streams new rows in),
  // or the end of a run. Another place holds other rows, and a search and live updates arm nothing.
  $effect.pre(() => {
    const now = {
      sort: jobs.sortChoice,
      filter: jobs.filterChoice,
      active: run.active,
    };
    untrack(() => {
      const chosen = now.sort !== last.sort || now.filter !== last.filter;
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
      before = new Map(rowsOf(list).map((row) => [glideKey(row), row.getBoundingClientRect().top]));
      if (jobs.status !== 'loading') armed = false;
    });
  });

  // After the DOM has the new rows: glide from the noted places, before the next frame is drawn
  // (WebKit may draw a layout ahead of its frame callbacks, so whichever comes first of the two):
  // the new rows are laid out once, there, and not a second time inside the task that built them.
  // A new job of a run fades in.
  $effect(() => {
    void shown;
    untrack(() => {
      const root = list;
      const from = before;
      before = null;
      if (root === null) return;
      if (from !== null) {
        const start = (): void => {
          watch.disconnect();
          cancelAnimationFrame(frame);
          glide(root, from);
        };
        const watch = new ResizeObserver(start);
        watch.observe(root);
        const frame = requestAnimationFrame(start);
      }
      enterFresh(root);
    });
  });

  /* ------------------------------------------------------------- the head's line */

  /** The list scrolled away from its top. */
  let scrolled = $state(false);
  /** The top edge of the list's scroll area lies in the days: a day's heading sticks there. */
  let dayAtTop = $state(false);
  /** No hairline while a day's heading sticks at the top. */
  const line = $derived(scrolled && !(dayed && dayAtTop));

  /**
   * `use:topLine` on the days: whether they reach over the top edge of the list's scroll area
   * (an IntersectionObserver whose root is that edge alone; no scroll listener, no layout
   * reads while scrolling). It starts once the frame that shows them has been drawn.
   */
  function topLine(node: HTMLElement): { destroy: () => void } {
    let observer: IntersectionObserver | null = null;
    const frame = requestAnimationFrame(() => {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.at(-1);
          if (entry !== undefined) dayAtTop = entry.isIntersecting;
        },
        { root: list?.parentElement ?? null, rootMargin: '0% 0% -100% 0%' },
      );
      observer.observe(node);
    });
    return {
      destroy() {
        cancelAnimationFrame(frame);
        observer?.disconnect();
      },
    };
  }
  $effect(() => {
    online?.(line);
  });

  /* ---------------------------------------------------------------------- purge */

  /** Ends with "Endgültig löschen" of a row: the dialog asks first. */
  let purging = $state<JobView | null>(null);
  /** The title the dialog names (kept while it fades out). */
  let purgeTitle = $state('');
  let purgeBusy = $state(false);
  let purgeError = $state<string | null>(null);

  /** A failed action of a row says so in the list header. */
  function report(error: string | null): void {
    if (error !== null) jobs.actionError = error;
  }

  /** What the row's menu and its tools do: a move goes at once, deleting for good asks
   *  first, a failure says so in the list header. */
  function contextOf(job: JobView): JobMenuContext {
    return {
      purge: () => {
        purgeError = null;
        purgeTitle = job.title ? displayTitle(job.title) : t.job.untitled;
        purging = job;
      },
      report,
    };
  }

  /** The job's menu on a right click (jobMenu of actions.ts). */
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

<!-- The way to the hits in another place, under the line of no hits or under the rows. -->
{#snippet alsoIn()}
  <div class="also" data-testid="also-in">
    {#each elsewhere as other (other)}
      <Button
        variant="secondary"
        icon={PLACE_ICON[other]}
        label={t.place[other]}
        testid="also-{other}"
        onclick={(event) => {
          jobs.setPlace(other);
          // From the keyboard the focus goes on with it: the button goes with this list.
          if (event.detail === 0) void tick().then(focusPlace);
        }}
      />
    {/each}
  </div>
{/snippet}

{#snippet row(job: JobView, open: boolean, rises: boolean)}
  <JobRow
    {job}
    ring={!profileMissing}
    reveal={rises}
    {marks}
    pending={pending && job.match === null}
    selected={open}
    onselect={select}
    onopen={(job) => void openAd(job).then(report)}
    menu={() => menuOf(job)}
    tools={() => rowTools(job, contextOf(job))}
  />
{/snippet}

<div
  class="list"
  bind:this={list}
  data-testid="job-list"
  aria-label={t.list.label}
  aria-busy={jobs.status === 'loading'}
>
  <span class="mark" use:inView={(at) => (scrolled = at === 'above')}></span>

  {#if profileMissing}
    <div class="note">
      <StateBox
        heading={profileNote.heading}
        text={profileNote.text}
        action={profileNote.action}
        testid="no-profile"
      />
    </div>
  {/if}

  {#if profileThin}
    <div class="note">
      <StateBox
        heading={t.list.thinProfile}
        text={thinWhy}
        action={{ label: t.list.completeProfile, icon: 'edit', onclick: completeProfile }}
        testid="thin-profile"
      />
    </div>
  {/if}

  {#if jobs.status === 'error'}
    <div class="bare">
      <EmptyState
        icon="warning"
        tone="danger"
        heading={t.list.loadFailed}
        action={{
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
  {:else if jobs.rows.length === 0 && jobs.status !== 'ready' && !jobs.emptyPlace && !jobs.answeredEmpty}
    <!-- Placeholder rows in the rows' shape at once (the rows take their place without a
         jump); they fade in once the list has taken --delay-placeholder (at once when it has
         already, jobs.slow), so a quick list never shows them. None for a place the counts
         say is empty, it shows that at once, and none under a list that answered with nothing:
         that stands until the next answer. -->
    <div class="skeletons" data-testid="list-skeleton">
      {#each SKELETON_ROWS as line (line.index)}
        <div class="skeleton-row">
          <Skeleton shape="circle" size="sm" late={!jobs.slow} />
          <span class="bar"><Skeleton width={line.width} late={!jobs.slow} /></span>
        </div>
      {/each}
    </div>
  {:else if jobs.visible.length === 0}
    {#if jobs.answeredEmpty && (searching || filterEmptied)}
      <!-- The search's × clears it; the other places' hits are the way on. -->
      <div class="none" data-testid={searching ? 'empty-search' : 'empty-filter'}>
        <EmptyState
          icon={searching ? 'search' : 'filter'}
          placement="list"
          heading={noHit.heading}
          text={noHit.text}
          secondary={jobs.listedFiltered
            ? {
                label: t.toolbar.filterReset,
                icon: 'reset',
                testid: 'filter-reset',
                onclick: (event) =>
                  onresetfilter ? onresetfilter(event.detail === 0) : jobs.setFilter(NO_FILTER),
              }
            : null}
        />
        {#if searching && elsewhere.length > 0}
          {@render alsoIn()}
        {/if}
      </div>
    {:else if jobs.bare}
      <div class="bare">
        <EmptyState
          icon={PLACE_ICON[place]}
          heading={empty.heading}
          text={empty.text}
          action={place === 'inbox'
            ? {
                label: t.toolbar.searchNow,
                icon: 'search',
                reason: fetchBlocked(),
                testid: 'fetch',
                onclick: () => void run.start({ kind: 'fetch' }),
              }
            : null}
          secondary={empty.profile
            ? { label: t.list.openProfile, icon: 'profile', onclick: toProfile }
            : null}
          testid="empty-all"
        />
      </div>
    {:else}
      <EmptyState
        icon={PLACE_ICON[place]}
        placement="list"
        heading={empty.heading}
        text={empty.text}
        secondary={empty.profile
          ? { label: t.list.openProfile, icon: 'profile', onclick: toProfile }
          : null}
        testid={place === 'inbox' ? 'empty-all' : `empty-place-${place}`}
      />
    {/if}
  {:else}
    <div class="groups" data-press-only>
      <RowBar
        bind:this={rowBar}
        open={barOpen}
        {listed}
        folding={moving}
        generation={jobs.generation}
      />
      <!-- Another list is built anew: its old rows leave as one piece, not row by row. -->
      {#key jobs.generation}
        <div class="rows" data-testid="job-rows" use:topLine>
          {#each days as day (day.id)}
            <DayGroup
              label={day.at === null ? null : formatDayHeading(day.at, clock.now)}
              jobs={day.jobs}
              start={day.start}
              open={openKey}
              opening={opened}
              {row}
            />
          {/each}
        </div>
        {#each shownSections as section (section.id)}
          <div
            class="section"
            in:unfold={{ on: allIn(section.jobs, returning) }}
            out:rowCollapse={{ on: allIn(section.jobs, moving) }}
          >
            <ListDivider
              label={section.label}
              open={section.open}
              ontoggle={section.toggle}
              testid="{section.id}-divider"
            />
            {#if section.open}
              <div class="rows" data-testid="{section.id}-rows" transition:unfold>
                <DayGroup
                  jobs={section.jobs}
                  start={section.start}
                  open={openKey}
                  opening={opened}
                  {row}
                />
              </div>
            {/if}
          </div>
        {/each}
      {/key}
    </div>
    {#if elsewhere.length > 0 && !more}{@render alsoIn()}{/if}
    {#if jobs.pageError}
      <div class="page-error">
        <Notice
          tone="warning"
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
</div>

<Dialog
  open={purging !== null}
  variant="danger"
  heading={t.reader.purgeHeading}
  text={t.reader.purgeText(purgeTitle)}
  confirmLabel={t.reader.purgeConfirm}
  busy={purgeBusy}
  error={purgeError}
  testid="dialog-purge"
  onconfirm={() => void purgeRow()}
  oncancel={() => (purging = null)}
/>

<style>
  .list {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
    padding-bottom: var(--list-rows-end);
  }

  /* An end for rows: a state without rows stands in the very middle. */
  .list:has(> .bare) {
    padding-bottom: 0;
  }

  /* Watched: once it has scrolled away, the head may draw its line. */
  .mark {
    display: block;
    flex: none;
    height: 0;
  }

  /* A state box at the top of the list (no profile, a thin one): under the head, 16 in. */
  .note {
    padding: 0 var(--pane-padding-end) var(--space-8) var(--pane-padding);
  }

  /* The rows 6 in from the column's edges (their wash and the highlight end there). */
  .groups,
  .skeletons {
    display: block;
    padding: 0 var(--list-rows-inset-end) 0 var(--list-rows-inset);
  }

  /* The containing block of the rows' one highlight (RowBar). */
  .groups {
    position: relative;
  }

  /* Plain block flow: a flex column adds nothing here and costs a little more each time the
     rows are laid out again. */
  .rows {
    display: block;
  }

  /* A section folds as one block, heading and all, the heading's margin inside it. */
  .section {
    display: flow-root;
  }

  /* Search hits in the other places: buttons under the hits of this one. */
  .also {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
    padding: var(--space-12) var(--pane-padding-end) var(--space-12) var(--pane-padding);
  }

  /* No job anywhere and no head: the empty state in the middle of the column, like the job
     view's. */
  .bare {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: var(--pane-padding) var(--pane-padding-end) var(--pane-padding) var(--pane-padding);
  }

  /* No hit: the empty state, and the other places' hits centred under it. */
  .none .also {
    justify-content: center;
    padding: var(--space-12) var(--pane-padding-end) 0 var(--pane-padding);
  }

  .page-error {
    padding: var(--space-12) var(--pane-padding-end) var(--space-12) var(--pane-padding);
  }

  /* Laid out like a row (ListRow): the ring and a line, so nothing moves when the rows
     arrive. */
  .skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--list-row-gap);
    min-height: var(--list-row-min);
    padding: var(--list-row-pad) var(--list-row-pad-x);
  }

  .bar {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  .sentinel {
    padding: var(--pane-padding) var(--pane-padding-end) var(--pane-padding) var(--pane-padding);
  }
</style>
