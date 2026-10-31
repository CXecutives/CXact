// The job list, the selection and the reader.
//
// - List and counts come from one `list_jobs` call (pages of 120: a page is read in the task
//   that shows its first rows, and 500 rows made that task several times longer than the 60
//   it shows); the list renders in windows of 60 rows that grow while scrolling, chunk by
//   chunk, so 2000 jobs never block a frame. A reload of the same list (sort, undo, the end
//   of a run) asks for as many rows as it holds, keeps the rows that did not change and
//   builds at most a chunk of new ones at once. Another list (place, tab, search) is
//   a new generation of rows: the old rows go as one piece instead of one by one.
// - Rows are plain objects (`$state.raw`): a change replaces the row, so only that row
//   renders again, and no proxy sits between the template and 2000 jobs.
// - Every number comes from the backend (one truth): the counts of the list (with the
//   search and the filter) and the counts over every job (what each place holds, whatever
//   the search and the filter). A change the page makes itself (read, a move) or a run
//   update of a listed row moves them at once; during a run a counts-only query follows
//   every update (throttled), so they stay exact for rows the page does not hold.
// - During a run the new jobs of the run are inserted at the top (they fade in) and listed
//   rows update in place (rings fill live); a job further down the list stays where the
//   next load puts it. The list re-sorts once, when the run finishes, and keeps the
//   selection.
// - `mark_read` when the user opens a job (a click, the keyboard); a job the app opens by
//   itself (the next one after a move) only once it has been looked at (`markSeen`). A new
//   job keeps its dot until then; the list itself never changes for it.
// - Like mail: every job is in one place (inbox, archive, trash); "fits anyway" is a flag of
//   its own. A move takes the row out of a list it no longer belongs to; deleting for good
//   (only from the trash) removes it.
// - Each place is one list in the chosen order, the excluded jobs last. Aktuell and the Archiv
//   have one filter beside the search (the funnel, lib/state/filter.ts: portals, bands and the
//   days the jobs came; kept like the order), the Papierkorb has none. It narrows the list and
//   its counts like the search. The counts over every job never follow it. A query's counts
//   narrow every place alike, so while a search looks under a filter one more counts-only query
//   asks for the places under the other rule (`hitsIn`).
// - The open job is kept per work folder: the next start opens it again (its place with it),
//   only while it still lies where it lay and the list stands beside it.

import { SvelteSet } from 'svelte/reactivity';
import { errorText } from '../i18n/texts';
import { invoke, IpcError } from '../ipc/api';
import type {
  Deleted,
  JobCounts,
  JobDetail,
  JobKey,
  JobQuery,
  JobSort,
  JobView,
  Place,
  RunEvent,
} from '../ipc/types';
import { tokenMs } from '../tokens';
import { app } from './app.svelte';
import {
  isFiltered,
  NO_FILTER,
  parseFilter,
  passesFilter,
  toQuery,
  type ListFilter,
} from './filter';
import { isExcluded, isUnscored, keyOf, moved, replaced, reused, sameKey, ZERO } from './jobRows';
import { keepOpen, keptOpen, type KeptOpen } from './openJob';
import { run } from './run.svelte';
import { viewport } from './viewport.svelte';

export const PAGE = 120;
/** The most rows one `list_jobs` call returns (core::view::MAX_PAGE). */
const MAX_PAGE = 500;
export const WINDOW = 60;
/** Rows mounted per frame while a window fills (small: every frame stays well below 50 ms
 *  on a slow machine, also a shared CI runner; the window still fills within a few frames). */
const CHUNK = 4;
/** At most one counts query per this many ms while a run updates jobs. */
const COUNTS_EVERY = 400;

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** How the load of a job's reader ended: shown, the job is gone (deleted for good since),
 *  failed otherwise, or another job was asked for meanwhile. */
type DetailResult = 'ready' | 'gone' | 'error' | 'stale';

/** A job a move took away, to bring back (`moveBack`): as it was, where it went, its
 *  index in the list then (-1: the list did not hold it) and the rows that stood below and
 *  above it (keyOf, not moved with it): an undo puts it back between them, also when other
 *  moves were undone in another order. */
export interface Unmove {
  job: JobView;
  to: Place;
  at: number;
  below: string | null;
  above: string | null;
}

/** What the counts of a query answer: its search and its filter, over every place. */
function ruleOf(query: JobQuery): string {
  return JSON.stringify({ ...query, place: null, sort: null, limit: null, offset: null });
}

/** Counts and what they answer (`ruleOf`). */
interface RuleCounts {
  rule: string;
  counts: JobCounts;
}

/** Where the order of the list is kept (one choice for every list, per user). */
const SORT_KEY = 'jobs-sort';

/** The kept order; a store that cannot be read keeps the default, by date (decision 1,
 *  2026-10-24: the days' headings, the open jobs of a day before the closed ones, then the
 *  best match). */
function keptSort(): JobSort {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return value === 'match' || value === 'rate' ? value : 'newest';
  } catch {
    return 'newest';
  }
}

function keepSort(sort: JobSort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {
    // Without a store the order lasts for this session only.
    return;
  }
}

/** Where the filter is kept (like the order, per user). */
const FILTER_KEY = 'jobs-filter';

/** The kept filter; a store that cannot be read, or holds something else, keeps none. The
 *  portal is checked against the app's portals where it applies (`filter`). */
function keptFilter(): ListFilter {
  try {
    return parseFilter(JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null') as unknown);
  } catch {
    return NO_FILTER;
  }
}

/** Keeps the user's filter; the run of a fetch's "Zeigen" is never kept. */
function keepFilter(filter: ListFilter): void {
  const kept = { ...filter, run: null };
  try {
    if (isFiltered(kept)) localStorage.setItem(FILTER_KEY, JSON.stringify(kept));
    else localStorage.removeItem(FILTER_KEY);
  } catch {
    // Without a store the filter lasts for this session only.
    return;
  }
}

class JobsStore {
  /** The place the list shows (the tabs Aktuell, Archiv, Papierkorb). */
  place = $state<Place>('inbox');
  sortChoice = $state<JobSort>(keptSort());
  search = $state('');
  /** The filter as chosen (kept); `filter` is what applies. */
  filterChoice = $state.raw<ListFilter>(keptFilter());

  rows = $state.raw<JobView[]>([]);
  /** The counts of the list: with the search and the filter, whatever the place. */
  counts = $state<JobCounts>(ZERO);
  /** What the counts answer (`ruleOf`): a typed search follows --dur-base later and another
   *  filter with its answer, until then the counts are another search's or filter's. */
  #counted = $state('');
  /** The counts under the rule the list's own query does not follow (`hitsIn`). */
  #otherRule = $state.raw<RuleCounts | null>(null);
  /** Rows the backend has for the current query: its count, or exactly how many once a page
   *  came back short. */
  total = $state(0);
  /**
   * How far the page has read the backend's list of this query: the offset of the next page.
   * It counts the rows the backend served, less those that left the query since (moved,
   * deleted) and plus those that came back: such rows keep their place in the list for a
   * while, so the number of rows is no offset. Rows the page put in itself (a run's new
   * jobs) do not count: where they stand in the backend's order is unknown, and at worst the
   * next page repeats a row (it is dropped), it never skips one.
   */
  #served = $state(0);
  /** Keys of the rows the page put in itself (see #served). */
  #own = new Set<string>();
  /** The query of the list the page holds: its next pages continue it, also while a typed
   *  search still waits (they never mix another query's rows into it). */
  #listed: JobQuery | null = null;
  status = $state<Status>('idle');
  /** The first load is over and the job kept from the last run is open again, if it was
   *  (`start`): the history records from here, before the list was still on its way. */
  started = $state(false);
  /** The list has taken --delay-placeholder to load: its placeholder rows show (at once). */
  slow = $state(false);
  error = $state<string | null>(null);
  /** The next page did not load (the list stays, the end of it offers a retry). */
  pageError = $state<string | null>(null);
  /**
   * A job action of the list that failed (a move of a row, its undo, "Trotzdem bewerten",
   * the choice of the way): one sentence in the list header until the next action
   * succeeds or another list comes (place, search, order, filter).
   */
  actionError = $state<string | null>(null);

  /** Another list or view: what the header said about the last action goes. */
  quiet(): void {
    this.actionError = null;
  }
  window = $state(WINDOW);
  /** Rows mounted so far (grows towards `window` chunk by chunk). */
  rendered = $state(CHUNK);
  /** Counts the lists: a load that is not the same list in a new order starts a new one. */
  generation = $state(0);
  /** Keys inserted while the list was on screen (they fade in). */
  fresh = new SvelteSet<string>();
  /** A row the list brings into view once it is mounted (a job the keys opened further down,
   *  the open job after a re-sort), and whether it takes the focus. */
  reveal = $state<{ key: string; focus: boolean } | null>(null);

  selected = $state<JobKey | null>(null);
  detail = $state.raw<JobDetail | null>(null);
  detailStatus = $state<Status>('idle');
  /** The open job has taken --delay-placeholder to load: until then the reader keeps what it
   *  showed, then its placeholder shows (at once). */
  detailSlow = $state(false);
  detailError = $state<string | null>(null);

  /** The counts over every job, without the search and the filter: what each place holds
   *  (the Papierkorb's to empty, whether a filter or a search left a place empty). */
  overviewCounts = $state<JobCounts | null>(null);
  overviewStatus = $state<Status>('idle');

  #request = 0;
  #detailRequest = 0;
  #overviewRequest = 0;
  #pumping = false;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  #countsTimer: ReturnType<typeof setTimeout> | null = null;
  #installed = false;
  /** The filter on screen is not the user's own: "Zeigen" borrowed it (`borrowFilter`). */
  #borrowed = false;

  /** The search whose answer the list holds ('' for none): a typed one comes --dur-base
   *  later, until then the list is another search's. */
  get listedSearch(): string {
    return this.#listed?.search ?? '';
  }

  /** A search is on, from its first typed word on (its answer may still be on its way). */
  get searching(): boolean {
    return this.search.trim() !== '';
  }

  /** The sort actually used: without a profile there is no match to sort by. */
  get sort(): JobSort {
    return app.hasProfile ? this.sortChoice : 'newest';
  }

  /** The filter actually used, the place's. Sent with every query of the list. */
  get filter(): ListFilter {
    return this.#filterOf(this.place);
  }

  /**
   * The filter a place lists by, the same in Aktuell and the Archiv (the Papierkorb has none,
   * decision 25): without a profile no band (there is no match to filter by), only the
   * portals the app knows.
   */
  #filterOf(place: Place): ListFilter {
    if (place === 'trash') return NO_FILTER;
    const chosen = this.filterChoice;
    const portals = app.state?.portals ?? [];
    return {
      ...chosen,
      portals: chosen.portals.filter((portal) => portals.some((line) => line.portal === portal)),
      bands: app.hasProfile ? chosen.bands : [],
    };
  }

  /** A filter narrows the list (the funnel's dot, the chips under the toolbar). */
  get filtered(): boolean {
    return isFiltered(this.filter);
  }

  /**
   * How many hits of the search `place` lists by its own rule (Aktuell and the Archiv under the
   * kept filter, the Papierkorb without one), from the counts that answer that rule. None until
   * they are there: another search's or another filter's never show.
   */
  hitsIn(place: Place): number {
    const rule = ruleOf(this.query(0, 0, this.#filterOf(place)));
    if (rule === this.#counted) return this.counts[place];
    return this.#otherRule?.rule === rule ? this.#otherRule.counts[place] : 0;
  }

  /** The list's place holds no job, or the list did not load: nothing to read beside it (no
   *  job view, no button for it in the top bar). A list still on its way counts by the numbers
   *  the page knows before it (the app state's), so a place without a job never shows the two
   *  columns for the time its call takes. */
  get emptyPlace(): boolean {
    if (this.status === 'error') return true;
    const known =
      this.status === 'ready'
        ? (this.overviewCounts ?? this.counts)
        : (this.overviewCounts ?? app.state?.counts ?? null);
    return known !== null && known[this.place] === 0;
  }

  /** No job in this place, nothing searched or filtered and no run: the list has nothing to
   *  head (JobsView hides its head; Aktuell's empty state offers "Jobs suchen"). The rows of a
   *  run that just ended count before the counts have heard of them. */
  get bare(): boolean {
    const counts = this.overviewCounts;
    return (
      counts !== null &&
      this.status !== 'error' &&
      counts[this.place] === 0 &&
      !this.searching &&
      !this.filtered &&
      !run.active &&
      !this.rows.some((job) => job.place === this.place)
    );
  }

  /** A job passes the filter (the backend's rule, store::filter_condition). */
  readonly #passes = (job: JobView): boolean => passesFilter(job, this.filter);

  /** A job belongs to the list: its place and the filter (the backend's rule,
   *  store::job_page). */
  lists(job: JobView): boolean {
    return job.place === this.place && this.#passes(job);
  }

  /**
   * Another filter (a part of it, or `NO_FILTER` to reset it), the user's own: kept like the
   * order. While "Zeigen" has borrowed the list's filter (`borrowFilter`) nothing is kept,
   * neither what it set nor what the user takes off it chip by chip: the user's own kept
   * filter waits in the store untouched, and with the last chip gone the list is the user's
   * again.
   */
  setFilter(change: Partial<ListFilter>): void {
    const next = { ...this.filterChoice, ...change };
    if (!this.#show(next)) return;
    if (this.#borrowed) this.#borrowed = isFiltered(next);
    else keepFilter(next);
  }

  /** The filter "Zeigen" of a fetch's toast sets is borrowed: it lasts until the user takes
   *  it off or the next search starts, and is never kept. */
  borrowFilter(filter: ListFilter): void {
    this.#borrowed = true;
    this.#show(filter);
  }

  /** The user's own kept filter again, in the place of the borrowed one. */
  returnFilter(): void {
    this.#borrowed = false;
    this.#show(keptFilter());
  }

  /**
   * Shows the list with another filter. The list loads again from the top; the open job
   * stays open when the filter still lists it (its row comes into view), else it closes like
   * a job the search no longer finds. False when it is the filter shown already.
   */
  #show(next: ListFilter): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.filterChoice)) return false;
    this.filterChoice = next;
    this.quiet();
    const open = this.selected;
    const job = open === null ? null : this.held(open);
    const listed = this.rows.some((row) => sameKey(row.key, open));
    if (job !== null && !this.#passes(job)) this.clearSelection();
    void this.load().then(() => {
      if (open !== null && listed && sameKey(this.selected, open) && this.status === 'ready') {
        void this.reach(open, false);
      }
    });
    return true;
  }

  /** Scores are on their way (a run goes or a rescore is due): a job without one waits. */
  get scoring(): boolean {
    return app.hasProfile && (run.active || (app.state?.matchPending ?? 0) > 0);
  }

  /**
   * Rows of the list in the order it draws them: the scored ones, then the ones without a
   * score yet, then the excluded ones (each section behind its fold), also a row whose state
   * changed in place (an override, a run scoring a new job). The keys, the selection and the
   * next job after a move all count in this order.
   */
  readonly visible = $derived.by((): JobView[] => {
    const rows = this.rows;
    const scored = rows.filter((job) => !isExcluded(job) && !isUnscored(job));
    if (scored.length === rows.length) return rows;
    return [...scored, ...rows.filter(isUnscored), ...rows.filter(isExcluded)];
  });

  readonly shown = $derived(this.visible.slice(0, this.rendered));

  /**
   * More rows exist beyond the window (the sentinel shows once the window is rendered). The
   * last window of a page can reach past its rows: rendered is then all of them, and the next
   * page follows.
   */
  readonly more = $derived(
    this.rendered >= Math.min(this.window, this.visible.length) &&
      (this.window < this.visible.length || this.#served < this.total),
  );

  /** Mount the window in chunks, one per frame: no frame builds 60 rows at once. */
  private pump(): void {
    if (this.#pumping) return;
    const target = (): number => Math.min(this.window, this.visible.length);
    if (this.rendered >= target()) return;
    this.#pumping = true;
    requestAnimationFrame(() => {
      this.#pumping = false;
      this.rendered = Math.min(this.rendered + CHUNK, Math.max(target(), CHUNK));
      this.pump();
    });
  }

  install(): void {
    if (this.#installed) return;
    this.#installed = true;
    run.listen((event) => this.onRun(event));
  }

  /** First load after the app state. */
  async start(): Promise<void> {
    const counts = app.state?.counts;
    // The app state knows the counts already: no zeros while the first page loads.
    if (counts) {
      this.counts = counts;
      this.overviewCounts = counts;
    }
    const kept = keptOpen();
    const [detail] = await Promise.all([
      kept === null ? null : invoke('job_detail', { key: kept.key }).catch(() => null),
      this.load(),
      this.loadOverview(),
    ]);
    if (kept !== null) await this.reopen(kept, detail);
    this.started = true;
  }

  /**
   * The job that was open when the app closed opens again (its place with it), unless the
   * user opened another meanwhile; a job that is gone, or no longer lies where it lay, is
   * forgotten. In one column the app starts with the list (a job would stand in its place).
   */
  private async reopen(kept: KeptOpen, detail: JobDetail | null): Promise<void> {
    if (this.selected !== null || viewport.narrow) return;
    if (detail === null || detail.job.place !== kept.place) {
      keepOpen(null);
      return;
    }
    if (this.place !== kept.place) {
      this.place = kept.place;
      await this.load();
      if (this.selected !== null || this.place !== kept.place) return;
    }
    this.selected = detail.job.key;
    this.#detailRequest++;
    this.detail = detail;
    this.detailStatus = 'ready';
    if (this.status === 'ready') void this.reach(detail.job.key, false);
  }

  /** The database changed under the page (a backup restored): the open job closes, the list
   *  and the counts load again; a list never loaded yet waits for its view. */
  async reload(): Promise<void> {
    this.clearSelection();
    this.quiet();
    if (this.status === 'idle') return;
    await Promise.all([this.load(), this.loadOverview()]);
  }

  /** Another place. `dropSearch`: a place chosen in the tabs opens without the search, like
   *  a folder of a mail app (the "Im Archiv (n)" links keep it). */
  setPlace(place: Place, dropSearch = false): void {
    // Another place: an open job of the one left behind closes, like a mail of another
    // folder (here, not in the list: the place also changes from a run's toast).
    const selected = this.selected;
    const open =
      this.detail?.job ??
      (selected ? this.rows.find((row) => sameKey(row.key, selected)) : undefined) ??
      null;
    if (open !== null && open.place !== place) this.clearSelection();
    const searched = dropSearch && this.search !== '';
    if (searched) {
      if (this.#searchTimer !== null) clearTimeout(this.#searchTimer);
      this.search = '';
    }
    if (place === this.place && !searched) return;
    this.place = place;
    this.quiet();
    void this.load();
  }

  setSort(sort: JobSort): void {
    this.sortChoice = sort;
    keepSort(sort);
    this.quiet();
    // The open job keeps its row in view in the new order, also when that is further down.
    const open = this.selected;
    const listed = this.rows.some((job) => sameKey(job.key, open));
    void this.load(true).then(() => {
      if (open !== null && listed && sameKey(this.selected, open) && this.status === 'ready') {
        void this.reach(open, false);
      }
    });
  }

  setSearch(value: string): void {
    this.search = value;
    this.quiet();
    if (this.#searchTimer !== null) clearTimeout(this.#searchTimer);
    this.#searchTimer = setTimeout(
      () => void this.load(),
      value === '' ? 0 : tokenMs('--dur-base'),
    );
  }

  /**
   * Load the first page.
   * `keep` = the same rows in a new order (sort, end of a run): the mounted rows stay and move,
   * and as many rows come back as the list holds (a list scrolled far down stays as long).
   */
  async load(keep = false): Promise<void> {
    const request = ++this.#request;
    this.status = 'loading';
    this.error = null;
    this.pageError = null;
    if (!keep) this.reveal = null;
    const timer = setTimeout(() => {
      if (request === this.#request) this.slow = true;
    }, tokenMs('--delay-placeholder'));
    try {
      const limit = keep ? Math.min(MAX_PAGE, Math.max(PAGE, this.rows.length)) : PAGE;
      const query = this.query(0, limit);
      const [page, other] = await Promise.all([invoke('list_jobs', { query }), this.askOther()]);
      if (request !== this.#request) return;
      const mounted = keep ? new Set(this.shown.map((job) => keyOf(job.key))) : null;
      this.#listed = query;
      this.#own.clear();
      this.#served = page.jobs.length;
      this.rows = keep ? reused(this.rows, page.jobs) : page.jobs;
      this.counts = page.counts;
      this.#counted = ruleOf(query);
      this.#otherRule = other;
      this.total = page.jobs.length < limit ? page.jobs.length : this.countOf(page.counts);
      this.window = keep ? Math.max(WINDOW, this.window) : WINDOW;
      this.rendered = mounted ? this.kept(mounted, Math.min(this.rendered, this.window)) : CHUNK;
      if (!keep) this.generation += 1;
      this.fresh.clear();
      this.status = 'ready';
      this.pump();
    } catch (error) {
      if (request !== this.#request) return;
      this.status = 'error';
      this.error = errorText(error);
    } finally {
      clearTimeout(timer);
      if (request === this.#request) this.slow = false;
    }
  }

  /**
   * How many rows stay mounted when the same list comes back in a new order (the sort, the
   * end of a run, an undo): up to `limit`, but never more than CHUNK rows that are not
   * mounted yet, so no frame builds a whole window of new rows (another sort shows other
   * jobs in its first rows). The rest follows chunk by chunk.
   */
  private kept(mounted: ReadonlySet<string>, limit: number): number {
    const rows = this.visible;
    const end = Math.min(limit, rows.length);
    let fresh = 0;
    for (let index = 0; index < end; index += 1) {
      if (!mounted.has(keyOf(rows[index]!.key))) fresh += 1;
      if (fresh > CHUNK) return Math.max(CHUNK, index);
    }
    return end;
  }

  /** Rows the query has. */
  private countOf(counts: JobCounts): number {
    return counts[this.place];
  }

  private query(offset: number, limit = PAGE, filter = this.filter): JobQuery {
    return {
      place: this.place,
      sort: this.sort,
      search: this.search.trim() === '' ? null : this.search.trim(),
      ...toQuery(filter),
      limit,
      offset,
    };
  }

  /** The next page of the backend's list (see #served): its rows the list does not hold yet. */
  private async page(request: number): Promise<boolean> {
    const listed = this.#listed;
    if (listed === null || this.#served >= this.total) return false;
    const query: JobQuery = { ...listed, limit: PAGE, offset: this.#served };
    const page = await invoke('list_jobs', { query });
    if (request !== this.#request) return false;
    this.#served += page.jobs.length;
    if (page.jobs.length < PAGE) this.total = this.#served;
    if (page.jobs.length === 0) return false;
    const known = new Set(this.rows.map((job) => keyOf(job.key)));
    this.rows = [...this.rows, ...page.jobs.filter((job) => !known.has(keyOf(job.key)))];
    this.counts = page.counts;
    this.#counted = ruleOf(query);
    return true;
  }

  /**
   * The row at `target` of the list (an index, the last row, or a job), loading the pages up
   * to it, and a window that reaches it: its row mounts within a few frames (chunk by chunk,
   * like every window) and the list then brings it into view (`reveal`). Resolves with the
   * job, or null when the list has no such row or another list replaced it meanwhile.
   */
  async reach(target: number | 'last' | JobKey, focus: boolean): Promise<JobView | null> {
    const request = this.#request;
    const index = (): number =>
      target === 'last'
        ? this.visible.length - 1
        : typeof target === 'number'
          ? target
          : this.visible.findIndex((job) => sameKey(job.key, target));
    const missing = (): boolean =>
      target === 'last' || index() < 0 || index() >= this.visible.length;
    this.pageError = null;
    try {
      while (request === this.#request && missing() && (await this.page(request)));
    } catch (error) {
      if (request === this.#request) this.pageError = errorText(error);
    }
    if (request !== this.#request) return null;
    const at = Math.min(index(), this.visible.length - 1);
    const job = at < 0 ? undefined : this.visible[at];
    if (job === undefined) return null;
    if (at >= this.window) this.window = Math.ceil((at + 1) / WINDOW) * WINDOW;
    this.pump();
    this.reveal = { key: keyOf(job.key), focus };
    return job;
  }

  /** The sentinel at the end of the list became visible: show the next window. */
  async grow(): Promise<void> {
    if (this.window < this.visible.length) {
      this.window += WINDOW;
      this.pump();
      return;
    }
    const request = this.#request;
    this.pageError = null;
    try {
      if (await this.page(request)) {
        this.window += WINDOW;
        this.pump();
      }
    } catch (error) {
      if (request === this.#request) this.pageError = errorText(error);
    }
  }

  /**
   * The counts over every job for the list header and the empty states: one counts-only
   * query (on an error they stay as they were).
   */
  async loadOverview(): Promise<void> {
    const request = ++this.#overviewRequest;
    if (this.overviewStatus !== 'ready') this.overviewStatus = 'loading';
    try {
      const page = await invoke('list_jobs', {
        query: {
          place: 'inbox',
          sort: 'newest',
          search: null,
          ...toQuery(NO_FILTER),
          limit: 0,
          offset: 0,
        },
      });
      if (request !== this.#overviewRequest) return;
      this.overviewCounts = page.counts;
      this.overviewStatus = 'ready';
    } catch {
      if (request !== this.#overviewRequest) return;
      this.overviewStatus = 'error';
    }
  }

  /** A search looks under a filter: a place lists by another rule than the list's. */
  get #rulesDiffer(): boolean {
    return this.searching && isFiltered(this.#filterOf('inbox'));
  }

  /** The counts under the rule the list's own query does not follow, while the rules differ;
   *  one that does not come names no hits there (`hitsIn`). */
  private async askOther(): Promise<RuleCounts | null> {
    if (!this.#rulesDiffer) return null;
    const query = this.query(0, 0, this.#filterOf(this.place === 'trash' ? 'inbox' : 'trash'));
    try {
      const { counts } = await invoke('list_jobs', { query });
      return { rule: ruleOf(query), counts };
    } catch {
      return null;
    }
  }

  /** Both counts again from the backend (the rows stay). */
  private async refreshCounts(): Promise<void> {
    const request = this.#request;
    const narrowed = this.searching || this.filtered;
    try {
      const query = this.query(0, 0);
      const [page, other] = await Promise.all([invoke('list_jobs', { query }), this.askOther()]);
      if (request !== this.#request) return;
      this.counts = page.counts;
      this.#counted = ruleOf(query);
      this.#otherRule = other;
      // Without a search and a filter the list's counts are the counts over every job.
      if (!narrowed) {
        this.#overviewRequest++;
        this.overviewCounts = page.counts;
        this.overviewStatus = 'ready';
      }
    } catch {
      // Try again while the run goes; its end reloads everything anyway.
      if (run.active) this.countsSoon();
    }
    if (narrowed) await this.loadOverview();
  }

  /** A counts query soon, at most one per COUNTS_EVERY ms (a run sends many updates). */
  private countsSoon(): void {
    if (this.#countsTimer !== null) return;
    this.#countsTimer = setTimeout(() => {
      this.#countsTimer = null;
      void this.refreshCounts();
    }, COUNTS_EVERY);
  }

  /** Select a job. `click` = the user clicked it: only then it counts as read. */
  async select(job: JobView, click: boolean): Promise<void> {
    this.selected = job.key;
    keepOpen(job);
    if (click && job.unread) void this.markRead(job.key);
    await this.loadDetail(job.key);
  }

  /**
   * Opens the job of `key` again (Zurück and Vor): like a click, but it stays as read as it
   * was. The job lies where it lies now (archived or put in the Papierkorb since): the list
   * follows it there and brings its row into view. Resolves with false when the job is gone
   * (deleted for good since): nothing is open then.
   */
  async openKey(key: JobKey): Promise<boolean> {
    const row = this.rows.find((job) => sameKey(job.key, key));
    this.selected = key;
    if (row !== undefined) keepOpen(row);
    const result = await this.loadDetail(key);
    if (result === 'gone') {
      if (sameKey(this.selected, key)) this.clearSelection();
      return false;
    }
    const detail = this.detail;
    if (result !== 'ready' || detail === null || !sameKey(this.selected, key)) return true;
    keepOpen(detail.job);
    if (detail.job.place !== this.place) {
      this.place = detail.job.place;
      this.quiet();
      await this.load();
    }
    if (!sameKey(this.selected, key)) return true;
    // Its row comes into view (once the list that is on its way has it).
    if (this.status === 'ready') void this.reach(key, false);
    else this.reveal = { key: keyOf(key), focus: false };
    return true;
  }

  clearSelection(): void {
    if (this.selected !== null) keepOpen(null);
    this.selected = null;
    this.detail = null;
    this.detailStatus = 'idle';
    this.#detailRequest++;
  }

  /** The open job has been looked at (a job the app opened by itself). */
  markSeen(key: JobKey): void {
    const job = this.held(key);
    if (job?.unread) void this.markRead(key);
  }

  private async markRead(key: JobKey): Promise<void> {
    this.patch(key, { unread: false });
    try {
      await invoke('mark_read', { key });
    } catch {
      this.patch(key, { unread: true });
    }
  }

  async loadDetail(key: JobKey): Promise<DetailResult> {
    const request = ++this.#detailRequest;
    // The previous job stays until the next one is there (no blank flash between two jobs).
    this.detailStatus = 'loading';
    this.detailError = null;
    const timer = setTimeout(() => {
      if (request === this.#detailRequest) this.detailSlow = true;
    }, tokenMs('--delay-placeholder'));
    try {
      const detail = await invoke('job_detail', { key });
      if (request !== this.#detailRequest) return 'stale';
      this.detail = detail;
      this.detailStatus = 'ready';
      return 'ready';
    } catch (error) {
      if (request !== this.#detailRequest) return 'stale';
      // The failure stands in the reader's place: the job it showed before is not the one
      // asked for (a retry would show it again while the load goes).
      this.detail = null;
      this.detailStatus = 'error';
      this.detailError = errorText(error);
      return error instanceof IpcError && error.kind === 'notFound' ? 'gone' : 'error';
    } finally {
      clearTimeout(timer);
      if (request === this.#detailRequest) this.detailSlow = false;
    }
  }

  /** The job as the page holds it (a row or the reader). */
  private held(key: JobKey): JobView | null {
    const row = this.rows.find((job) => sameKey(job.key, key));
    if (row) return row;
    return this.detail && sameKey(this.detail.job.key, key) ? this.detail.job : null;
  }

  /**
   * "Fits anyway": an excluded job counts as scored with its fit score, or the engine's
   * verdict applies again. The backend assesses it anew, so the row and the reader follow
   * its answer. Resolves with the error text, or null.
   */
  async setOverride(key: JobKey, include: boolean): Promise<string | null> {
    try {
      await invoke('set_override', { key, include });
    } catch (error) {
      return errorText(error);
    }
    // The reader follows at once; a detail that does not come is brought by the list below.
    const detail = await invoke('job_detail', { key }).catch(() => null);
    if (detail !== null) {
      this.patch(key, detail.job);
      if (sameKey(this.selected, key)) {
        this.#detailRequest++;
        this.detail = detail;
        this.detailStatus = 'ready';
      }
    }
    // The job now counts (or no longer): the list takes it in its order, the filters and
    // counts follow.
    void this.load(true);
    return null;
  }

  /**
   * "Endgültig löschen": deletes jobs of the trash for good (rows, text files; a later scan
   * never brings them back). Resolves with what the backend did, or the error text.
   */
  async purge(keys: JobKey[]): Promise<Deleted | { error: string }> {
    return this.forget(() => invoke('purge_jobs', { keys }));
  }

  private async forget(command: () => Promise<Deleted>): Promise<Deleted | { error: string }> {
    try {
      const deleted = await command();
      // What the backend deleted: the rows, the open job (also one the list does not hold).
      const gone = new Set(deleted.keys.map(keyOf));
      const rows = this.rows.filter((job) => !gone.has(keyOf(job.key)));
      for (const job of this.rows) {
        if (gone.has(keyOf(job.key))) this.recount(job, null);
      }
      this.rows = rows;
      if (this.selected !== null && gone.has(keyOf(this.selected))) this.clearSelection();
      await this.refreshCounts();
      return deleted;
    } catch (error) {
      return { error: errorText(error) };
    }
  }

  /**
   * Moves jobs to the inbox, the archive or the trash. The rows leave a list they no longer
   * belong to at once. Resolves with the keys that really moved (toasts and undos only for
   * those; a job already there or gone did not), or the error text; on an error, or when not
   * every job moved, the list loads again. `restore` takes jobs out of the trash back to where
   * each lay (the archive for one thrown away from there): they count as `to` until the
   * counts come from the backend.
   */
  async move(
    keys: JobKey[],
    to: Place,
    restore = false,
  ): Promise<{ moved: JobKey[] } | { error: string }> {
    const before = keys.map((key) => this.held(key)).filter((job): job is JobView => job !== null);
    for (const job of before) {
      this.patch(job.key, { place: to });
      this.dropStray(job.key);
    }
    try {
      const moved = restore
        ? await invoke('restore_jobs', { keys })
        : await invoke('move_jobs', { keys, to });
      if (moved.length < keys.length) void this.load(true);
      else if (restore || this.#rulesDiffer) void this.refreshCounts();
      return { moved };
    } catch (error) {
      for (const job of before) this.patch(job.key, { place: job.place });
      void this.load(true);
      return { error: errorText(error) };
    }
  }

  /**
   * Takes moves back (the undo of a toast): every job goes back to the place it came from as
   * it was there (the trash keeps its date). A row the list lost comes back where it stood
   * when the list is still the one it left; in another list the list loads again when the
   * job belongs there. Resolves with the keys that went back (a job already there did not),
   * or the error text.
   */
  async moveBack(
    back: readonly Unmove[],
    generation: number,
  ): Promise<{ moved: JobKey[] } | { error: string }> {
    let landed: JobKey[];
    try {
      landed = await invoke('move_back', {
        jobs: back.map(({ job }) => ({ key: job.key, to: job.place, trashedAt: job.trashedAt })),
      });
    } catch (error) {
      void this.load(true);
      return { error: errorText(error) };
    }
    const done = new Set(landed.map(keyOf));
    const same = generation === this.generation;
    let missing = false;
    for (const { job, to, at, below, above } of [...back].sort((a, b) => a.at - b.at)) {
      if (!done.has(keyOf(job.key))) continue;
      if (this.rows.some((row) => sameKey(row.key, job.key)) || !same || at < 0) {
        this.patch(job.key, { place: job.place });
        // A list that holds the job in the place it went to (the Archiv, after another place
        // was chosen) loses its row: it lies in another place again.
        this.dropStray(job.key);
        missing ||= !this.rows.some((row) => sameKey(row.key, job.key)) && this.lists(job);
        continue;
      }
      const gone = { ...job, place: to };
      const rows = [...this.rows];
      const index = (key: string | null): number =>
        key === null ? -1 : rows.findIndex((row) => keyOf(row.key) === key);
      const after = index(above);
      const place = index(below) >= 0 ? index(below) : after >= 0 ? after + 1 : at;
      rows.splice(Math.min(place, rows.length), 0, job);
      this.rows = rows;
      this.counts = moved(this.counts, gone, job, this.#passes);
      if (this.overviewCounts !== null) this.overviewCounts = moved(this.overviewCounts, gone, job);
      this.recount(gone, job);
      if (this.detail && sameKey(this.detail.job.key, job.key)) {
        this.detail = { ...this.detail, job: { ...this.detail.job, place: job.place } };
      }
    }
    if (missing) void this.load(true);
    else void this.refreshCounts();
    return { moved: landed };
  }

  /** Archives a job or brings it back to the inbox (the reader's and the row's tool). */
  async archive(key: JobKey, archived: boolean): Promise<string | null> {
    const result = await this.move([key], archived ? 'archive' : 'inbox');
    return 'error' in result ? result.error : null;
  }

  /** The prompt for a deep analysis of a job in any AI chat. */
  async aiPrompt(key: JobKey): Promise<string> {
    return invoke('ai_prompt', { key });
  }

  /** A listed row that no longer belongs to the list leaves it (`patch` has counted it out
   *  of the backend's list already). */
  private dropStray(key: JobKey): void {
    const row = this.rows.find((job) => sameKey(job.key, key));
    if (!row || this.lists(row)) return;
    this.rows = this.rows.filter((job) => !sameKey(job.key, key));
  }

  /**
   * A held row changed (`after`) or was deleted (null): the backend's list of the query loses
   * or gains it, so its total follows, and so does the offset of the next page when the
   * backend served the row (every held row it served stands before that offset).
   */
  private recount(before: JobView, after: JobView | null): void {
    const change = Number(after !== null && this.lists(after)) - Number(this.lists(before));
    if (change === 0) return;
    this.total = Math.max(0, this.total + change);
    if (!this.#own.has(keyOf(before.key))) this.#served = Math.max(0, this.#served + change);
  }

  /** Change a job the page holds (a row, the reader) in place, moving the counts with it. */
  private patch(key: JobKey, change: Partial<JobView>): void {
    const row = this.rows.find((job) => sameKey(job.key, key)) ?? null;
    const shown = this.detail && sameKey(this.detail.job.key, key) ? this.detail.job : null;
    const before = row ?? shown;
    // A job the page does not hold (an undo after the row left):
    // the counts still follow, from the backend.
    if (before === null) {
      this.countsSoon();
      return;
    }
    const after = { ...before, ...change };
    // A listed row belongs to the list's counts; every job belongs to the overall ones.
    if (row !== null) {
      this.counts = moved(this.counts, row, after, this.#passes);
      this.recount(row, after);
      this.rows = replaced(this.rows, key, () => after);
    } else {
      this.countsSoon();
    }
    if (this.overviewCounts !== null) {
      this.overviewCounts = moved(this.overviewCounts, before, after);
    }
    if (shown !== null && this.detail) {
      this.detail = { ...this.detail, job: { ...this.detail.job, ...change } };
    }
  }

  private onRun(event: RunEvent): void {
    // Another search: "Aus der letzten Suche" would speak of the one before, and what
    // "Zeigen" set goes with it: the list is the user's own filter again.
    if (event.type === 'started' && event.kind === 'fetch' && this.#borrowed) this.returnFilter();
    if (event.type === 'jobUpdated') this.upsert(event.job, event.fresh);
    else if (event.type === 'finished') void this.afterRun();
    else if (event.type === 'progress' && event.step === 'scan' && event.done === 0) {
      this.fresh.clear();
    }
  }

  /**
   * A job of the run changed. A listed row updates in place; a job new in this run comes
   * in at the top (never into a search). A known job the page does not list (further down,
   * beyond the loaded page) stays out: it is no new row. The counts follow from the backend.
   */
  private upsert(job: JobView, fresh: boolean): void {
    const index = this.rows.findIndex((row) => sameKey(row.key, job.key));
    if (index >= 0) {
      const before = this.rows[index]!;
      this.counts = moved(this.counts, before, job, this.#passes);
      if (this.overviewCounts !== null) {
        this.overviewCounts = moved(this.overviewCounts, before, job);
      }
      this.recount(before, job);
      this.rows = this.rows.with(index, job);
    } else if ((fresh || this.#served >= this.total) && !this.searching && this.lists(job)) {
      // An excluded job goes behind the fold, the others on top.
      const at = isExcluded(job) ? this.rows.findIndex(isExcluded) : 0;
      const rows = [...this.rows];
      rows.splice(at < 0 ? rows.length : at, 0, job);
      this.#own.add(keyOf(job.key));
      this.rows = rows;
      this.total += 1;
      this.rendered += 1;
      this.window = Math.max(this.window, this.rendered);
      this.fresh.add(keyOf(job.key));
    }
    this.countsSoon();
    // The reader follows the job the list has selected (it may still show the one before).
    if (sameKey(this.selected, job.key)) void this.loadDetail(job.key);
  }

  private async afterRun(): Promise<void> {
    if (this.#countsTimer !== null) {
      clearTimeout(this.#countsTimer);
      this.#countsTimer = null;
    }
    await Promise.all([this.load(true), this.loadOverview()]);
    if (this.selected !== null) void this.loadDetail(this.selected);
  }
}

export const jobs = new JobsStore();
