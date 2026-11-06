// What a job can do where it is, with one name, icon and order wherever it shows (the menu of
// a right click on its row, the reader's head, the row's tools under the pointer), from the
// tables below (ACTIONS, OF_PLACE, placeMoves, jobMenu, rowTools):
//   inbox: archive, into the Papierkorb; archive: back to Eingang, into the Papierkorb;
//   trash: restore, delete for good (asks first; the caller shows the dialog).
// A move folds the rows that leave the list (`moving`; a few, more simply go), opens the
// next job when the open one left (its row in view), hands the keyboard's focus on when it
// stood on a row that left (`focusAfter`; a click moves none), and says so in a short toast
// ("Archiviert") with Rückgängig; moves of the same kind right after each other merge into it,
// its one undo takes them all back as one change. The undo brings every job back to where it was,
// its row too (`returning`: it unfolds the way it folded), and opens the job again that was open
// when it left; in another list than the one the move left (the Archiv, once another place was
// chosen) its rows leave and, when the open job is one of them, the next one opens. A double
// click never moves the job that slid under the pointer, nor opens it: its second press presses
// nothing there and it stays the first press's (input.ts `pressesElsewhere`, `runDouble`); every
// other click and key counts at once. The job the app opens by itself counts as read only once it
// has been looked at (DWELL_MS on screen in the Jobs view, or a press on it). A job that is already
// where it goes is no move. A move that fails says so where it was asked (the list header,
// `jobs.actionError`), an undo that fails in its toast too, which offers to try again.

import type { IconName } from '$components/Icon.svelte';
import type { RowTool } from '$components/JobRow.svelte';
import { tick } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { byKeyboard } from '$lib/input/input';
import { invoke } from '$lib/ipc/api';
import type { Deleted, JobKey, JobView, OpenTarget, Place } from '$lib/ipc/types';
import { staggerLimit } from '$lib/motion/motion';
import { isExcluded, keyOf, sameKey } from '$lib/state/jobRows';
import { jobs, type Unmove } from '$lib/state/jobs.svelte';
import type { MenuEntry, MenuItem } from '$lib/state/menu.svelte';
import { navigation } from '$lib/state/navigation.svelte';
import { run } from '$lib/state/run.svelte';
import { sections } from '$lib/state/sections.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { copyJobPrompt } from './prompt';
import { SHOWS, showActions, type ShowId } from './shows';

export type MoveId = 'archive' | 'unarchive' | 'trash' | 'restore';
export type ActionId = MoveId | 'purge';

/** Where a move goes. Wiederherstellen from the Papierkorb puts a job back where it lay (the
 *  backend knows: the archive for one thrown away from there); the page takes the inbox until
 *  it hears back. Zurückholen puts a job of the Archiv back into the inbox. */
const TARGET: Record<MoveId, Place> = {
  archive: 'archive',
  unarchive: 'inbox',
  trash: 'trash',
  restore: 'inbox',
};

/** One icon per meaning: archiving looks like the archive, In den Eingang verschieben like
 *  taking out of it, Wiederherstellen from the Papierkorb like taking back. In den Papierkorb
 *  legen and Endgültig löschen take the trash, both plain (decision 9, 2026-10-24: the red
 *  dialog of Endgültig löschen carries the danger). */
const ACTIONS: Record<ActionId, IconName> = {
  archive: 'archive',
  unarchive: 'unarchive',
  trash: 'trash',
  restore: 'undo',
  purge: 'trash',
};

const OF_PLACE: Record<Place, readonly ActionId[]> = {
  inbox: ['archive', 'trash'],
  archive: ['unarchive', 'trash'],
  trash: ['restore', 'purge'],
};

/** Opens a page of the job outside the app; resolves with the error text, or null. */
async function openTarget(target: OpenTarget): Promise<string | null> {
  try {
    await invoke('open_target', { target });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** "Anzeige öffnen": the ad in the browser (its menu, a double click on its row). Resolves
 *  with the error text, or null. */
export function openAd(job: JobView): Promise<string | null> {
  return openTarget({ kind: 'jobUrl', key: job.key });
}

/** "Alert-Mail öffnen", the row's entry and the job view's button alike: the mail in Gmail where
 *  the job has a link to it, else the one CXact kept, read in the app (its dialog stands in the
 *  Jobs view, `jobs.storedMail`). Resolves with the error text, or null. */
export async function openMail(job: JobView): Promise<string | null> {
  try {
    const { mail } = await invoke('job_detail', { key: job.key });
    if (mail.gmailUrl !== null) return await openTarget({ kind: 'gmail', key: job.key });
    jobs.storedMail = await invoke('alert_mail', { key: job.key });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** What the job's menu needs from where it opens (the list's row; the row's tools and the
 *  reader's take the moves of the same context). */
export interface JobMenuContext {
  /** A move of the place, where the caller hands the focus on (the reader); by default the
   *  job simply moves. */
  move?: ((id: MoveId) => void) | null;
  /** "Endgültig löschen" asks first: the caller shows its dialog. */
  purge: () => void;
  /** Says an action that failed where the menu was opened (null: it went well). */
  report: (error: string | null) => void;
}

/**
 * The menu of a right click on the job's row, in two groups with a line between them: what
 * shows the job (`showActions`: the reader shows them as its buttons), then what changes it
 * (an excluded job's "Trotzdem bewerten", then the moves of its place). A click on the row
 * opens the job, so the menu has no entry for it. No entry names a key. The test id of an
 * entry is `menu-item-<id>`.
 */
export function jobMenu(job: JobView, context: JobMenuContext): MenuEntry[] {
  const { report } = context;
  const show: MenuEntry[] = [];
  const does: Record<ShowId, () => Promise<string | null>> = {
    mail: () => openMail(job),
    'open-ad': () => openAd(job),
    prompt: () => copyJobPrompt(job.key),
  };
  const actions = showActions(job);
  for (const id of SHOWS) {
    const action = actions[id];
    if (action.hidden) continue;
    show.push({
      id,
      label: action.label,
      icon: action.icon,
      disabled: action.reason !== null,
      reason: action.reason,
      run: () => void does[id]().then(report),
    });
  }
  return [...show, { kind: 'separator' }, ...changesOf(job, context)];
}

/** "Trotzdem bewerten" is for an excluded job the user has not scored by hand, and not for one
 *  in the Papierkorb: a job put there is out of sight, Wiederherstellen comes first. */
export const mayInclude = (job: JobView): boolean => !job.overridden && job.place !== 'trash';

/** The second group of the job's menu: what changes the job where it is. */
function changesOf(job: JobView, context: JobMenuContext): MenuEntry[] {
  const { report } = context;
  const change: MenuEntry[] = [];
  // A job counted anyway stays so (user, 2026-09-29: no way to exclude it again); the toast's
  // undo takes it back.
  if (isExcluded(job) && mayInclude(job)) {
    change.push({
      id: 'include',
      label: t.actions.include,
      icon: 'add',
      run: () => void include(job).then(report),
    });
  }
  return [...change, ...placeMoves(job, context)];
}

/** The moves of the job's place in their one order (OF_PLACE), as entries of its menu. */
function placeMoves(job: JobView, context: JobMenuContext): MenuItem[] {
  const { report } = context;
  return OF_PLACE[job.place].map((id) => {
    const purging = id === 'purge';
    return {
      id,
      label: t.actions[id],
      icon: ACTIONS[id],
      // Deleting for good waits for a run (the backend refuses meanwhile).
      disabled: purging && run.active,
      reason: purging ? run.busyText : null,
      run:
        id === 'purge'
          ? context.purge
          : () => {
              if (context.move) context.move(id);
              else void move([job], id).then(report);
            },
    };
  });
}

/**
 * The row's tools under the pointer: the moves of its place, the same entries in the same
 * order as its menu (an icon each, its label the tooltip).
 */
export function rowTools(job: JobView, context: JobMenuContext): RowTool[] {
  return placeMoves(job, context).map((entry) => {
    const id = entry.id as ActionId;
    return {
      id,
      icon: ACTIONS[id],
      label: entry.label,
      disabled: entry.disabled === true,
      reason: entry.reason ?? null,
      run: entry.run,
    };
  });
}

/**
 * "Trotzdem bewerten": an excluded job counts with its real match; a short toast with
 * Rückgängig. Resolves with the error text, or null.
 */
export async function include(job: JobView): Promise<string | null> {
  const error = await jobs.setOverride(job.key, true);
  if (error !== null) return error;
  toasts.show(t.toast.included, 'success', {
    label: t.common.undo,
    onclick: () =>
      void jobs.setOverride(job.key, false).then((failed) => (jobs.actionError = failed)),
  });
  return null;
}

/** Rows that fold away because the user moved them, until they are gone. */
export const moving = new SvelteSet<string>();

/** How long after a move the rows it folds are looked at, and again while one still folds. */
const FOLD_CHECK_MS = 400;

/**
 * The rows of `keys` leave `moving` once they are gone. A row still on the page that the list
 * no longer shows is still folding (a busy machine folds late, and the bar waits for it): it
 * stays until it is gone. A row that never folded (not built, its list built anew) or came
 * back leaves at once.
 */
function foldedAway(keys: readonly string[]): void {
  if (keys.length === 0) return;
  setTimeout(() => {
    const shown = new Set(jobs.shown.map((job) => keyOf(job.key)));
    const folding = keys.filter(
      (key) =>
        !shown.has(key) && document.querySelector(`[data-key="${CSS.escape(key)}"]`) !== null,
    );
    for (const key of keys) if (!folding.includes(key)) moving.delete(key);
    foldedAway(folding);
  }, FOLD_CHECK_MS);
}

/** Rows an undo brings back, until they are built: they unfold, the mirror of `moving`. */
export const returning = new Set<string>();

/** How long the next job opened by the app stays on screen before it counts as read. */
const DWELL_MS = 2000;
/** The dwell counts in steps of this, only while the job is on screen. */
const DWELL_STEP = 250;
let dwell: ReturnType<typeof setInterval> | undefined;

/** What a move's toast says: one short word, however many jobs it took (no titles). */
const SAID: Record<MoveId, () => string> = {
  archive: () => t.toast.archived,
  trash: () => t.toast.trashed,
  unarchive: () => t.toast.unarchived,
  restore: () => t.toast.restored,
};

/** The job to open when `gone` leave the list: the next one below, else the one above; none
 *  when the list did not hold them (the open job no longer listed after a search). A row
 *  behind a closed fold is not on screen and no next job. */
function nextAfter(gone: readonly JobView[]): JobView | null {
  const rows = jobs.shown;
  const out = new Set(gone.map((job) => keyOf(job.key)));
  const last = Math.max(...gone.map((job) => rows.findIndex((row) => sameKey(row.key, job.key))));
  if (last < 0) return null;
  const next = (row: JobView): boolean => !out.has(keyOf(row.key)) && !sections.folded(row);
  const below = rows.slice(last + 1).find(next);
  if (below) return below;
  return rows.slice(0, Math.max(0, last)).reverse().find(next) ?? null;
}

/** The job is on screen: the Jobs view is shown and the window is in front. */
function onScreen(): boolean {
  return (
    navigation.current === 'jobs' &&
    document.visibilityState !== 'hidden' &&
    document.documentElement.dataset['window'] !== 'inactive'
  );
}

/** The keyboard's focus stands on one of `rows`, which goes with them. */
function focusOn(rows: readonly JobView[]): boolean {
  const key = document.activeElement?.closest<HTMLElement>('[data-key]')?.dataset['key'];
  return byKeyboard() && rows.some((job) => keyOf(job.key) === key);
}

/**
 * When the open job left the list, the next one opens, not yet read (see `seen`): its row
 * comes into view, and takes the focus when `focus` says so (`focusOn`, a dialog that held it).
 * `open` is the job that was open before the action (deleting it for good already closed it).
 */
function openNext(
  gone: readonly JobView[],
  next: JobView | null,
  focus: boolean,
  open: JobKey | null,
): void {
  if (open === null || !gone.some((job) => sameKey(job.key, open))) return;
  clearInterval(dwell);
  if (!next) {
    jobs.clearSelection();
    return;
  }
  void jobs.select(next, false);
  jobs.reveal = { key: keyOf(next.key), focus };
  dwellOn(next.key);
}

/** The job the app opened (the next one after a move, the one kept from the last start) counts
 *  as read once it has been on screen for DWELL_MS. */
export function dwellOn(key: JobKey): void {
  clearInterval(dwell);
  let looked = 0;
  dwell = setInterval(() => {
    if (!sameKey(jobs.selected, key)) {
      clearInterval(dwell);
      return;
    }
    if (onScreen()) looked += DWELL_STEP;
    if (looked >= DWELL_MS) seen(key);
  }, DWELL_STEP);
}

/** The job the app opened has been looked at (the dwell, or a press on it, in the reader or on
 *  its row). */
export function seen(key: JobKey | null = jobs.selected): void {
  clearInterval(dwell);
  if (key !== null && sameKey(jobs.selected, key)) jobs.markSeen(key);
}

/**
 * Takes the moves of one toast back, the last first (each with its jobs, and the open job when it
 * took that away), as one change of the list, so a day or a section they emptied comes back whole
 * (the jobs to where they were, their rows too), then opens the job again that was open when the
 * first of them took it away, if it is listed again. Rows of this list that go back to another
 * place leave it (the Archiv holding a job the undo takes back to Eingang), and the next job opens
 * when the open one was among them, like after a move. Resolves with the sentence of a failure,
 * which the toast says and offers to try again.
 */
async function undo(
  moves: readonly { back: readonly Unmove[]; reopen: JobKey | null }[],
): Promise<string | null> {
  const back = moves.flatMap((made) => made.back);
  const open = jobs.selected;
  const leaving = back.flatMap(({ job }) => {
    const row = jobs.rows.find((held) => sameKey(held.key, job.key));
    return row !== undefined && !jobs.lists({ ...row, place: job.place }) ? [row] : [];
  });
  const next = leaving.length > 0 ? nextAfter(leaving) : null;
  const focus = focusOn(leaving);
  // Only a few, like the rows that fold away.
  const unfolding = back.length <= staggerLimit() ? back.map(({ job }) => keyOf(job.key)) : [];
  for (const key of unfolding) returning.add(key);
  const result = await jobs.moveBack(back);
  void tick().then(() => {
    for (const key of unfolding) returning.delete(key);
  });
  jobs.actionError = 'error' in result ? result.error : null;
  void jobs.loadOverview();
  if ('error' in result) return result.error;
  // Only a job that really came back opens again (one already back is left as it is).
  const came = new Set(result.moved.map(keyOf));
  openNext(
    leaving.filter((job) => came.has(keyOf(job.key))),
    next,
    focus,
    open,
  );
  const first = moves.findLast(({ reopen }) => reopen !== null && came.has(keyOf(reopen)));
  const row = jobs.rows.find((job) => sameKey(job.key, first?.reopen ?? null));
  if (row) {
    await jobs.select(row, false);
    jobs.reveal = { key: keyOf(row.key), focus: false };
  }
  return null;
}

/** Jobs deleted for good: their undo toasts can do nothing any more (the others stay). */
function deletedFor(deleted: Deleted): void {
  toasts.forget(new Set(deleted.keys.map(keyOf)));
}

/**
 * Moves jobs (the row's or the reader's). Resolves with the error text, which the caller
 * shows where the move was asked (the list header for a row, the reader for its own).
 */
export async function move(all: readonly JobView[], action: MoveId): Promise<string | null> {
  const to = TARGET[action];
  // A job that already lies there is no move (and no toast says it moved).
  const list = all.filter((job) => job.place !== to);
  if (list.length === 0) return null;
  // Only rows that leave the list fold away, and only a few: many rows folding at once would
  // hold the page for frames.
  const leaving = list.filter((job) => !jobs.lists({ ...job, place: to }));
  const next = leaving.length > 0 ? nextAfter(leaving) : null;
  const focus = focusOn(leaving);
  const folding = leaving.length <= staggerLimit() ? leaving : [];
  for (const job of folding) moving.add(keyOf(job.key));
  // What the undo brings back: each job as the list held it, and where its row stood.
  const generation = jobs.generation;
  const taken = new Set(list.map((job) => keyOf(job.key)));
  const neighbour = (rows: readonly JobView[]): string | null => {
    const row = rows.find((other) => !taken.has(keyOf(other.key)));
    return row ? keyOf(row.key) : null;
  };
  const back: Unmove[] = list.map((job) => {
    const at = jobs.rows.findIndex((row) => sameKey(row.key, job.key));
    return {
      job: jobs.rows[at] ?? job,
      to,
      generation,
      at,
      below: at < 0 ? null : neighbour(jobs.rows.slice(at + 1)),
      above: at < 0 ? null : neighbour(jobs.rows.slice(0, at).reverse()),
    };
  });
  const open = jobs.selected;
  const reopen =
    open !== null && leaving.some((job) => sameKey(job.key, open)) ? { ...open } : null;
  const result = await jobs.move(
    list.map((job) => job.key),
    to,
    action === 'restore',
  );
  foldedAway(folding.map((job) => keyOf(job.key)));
  if ('error' in result) return result.error;
  openNext(leaving, next, focus, open);
  if (focus) focusAfter(next);
  // Moved into the listed place without being listed (opened from elsewhere): list it.
  if (
    list.some(
      (job) => !leaving.includes(job) && !jobs.rows.some((row) => sameKey(row.key, job.key)),
    )
  ) {
    void jobs.load(true);
  }
  void jobs.loadOverview();
  // A toast and its undo only for the jobs that really moved.
  const moved = new Set(result.moved.map(keyOf));
  const undone = back.filter((entry) => moved.has(keyOf(entry.job.key)));
  if (undone.length === 0) return null;
  toasts.undoable(
    `move-${action}`,
    SAID[action],
    t.common.undo,
    undo,
    { back: undone, reopen },
    undone.length,
    undone.map((entry) => keyOf(entry.job.key)),
  );
  return null;
}

/**
 * Deletes jobs of the trash for good (after the dialog). Resolves with the error text.
 * `fromRow`: a row's menu or tool asked (its dialog held the focus, the row it would go back
 * to is gone): from the keyboard the focus goes on as after a move (`focusAfter`); a click moves
 * none.
 */
export async function purge(list: readonly JobView[], fromRow = false): Promise<string | null> {
  if (list.length === 0) return null;
  const next = nextAfter(list);
  const focus = (fromRow && byKeyboard()) || focusOn(list);
  const folding = list.length <= staggerLimit() ? list : [];
  for (const job of folding) moving.add(keyOf(job.key));
  const open = jobs.selected;
  const result = await jobs.purge(list.map((job) => job.key));
  foldedAway(folding.map((job) => keyOf(job.key)));
  if ('error' in result) return result.error;
  openNext(list, next, focus, open);
  if (focus) focusAfter(next);
  deletedFor(result);
  toasts.show(t.toast.deleted);
  void jobs.loadOverview();
  return null;
}

/** The keyboard focus after rows left the list: the row that takes their place (the list
 *  brings it into view), else the place, whose list is empty now. */
function focusAfter(next: JobView | null): void {
  if (next !== null) jobs.reveal = { key: keyOf(next.key), focus: true };
  else focusPlace();
}

/** The keyboard focus where what held it went and nothing takes its place: the place's entry in
 *  the sidebar, Jobs while the places are folded (its pill stands for them), or the sidebar's
 *  button while the sidebar is folded away; never the top of the window. */
export function focusPlace(): void {
  const entry = (testid: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  (entry(`place-${jobs.place}`) ?? entry('nav-jobs') ?? entry('toggle-sidebar'))?.focus();
}
