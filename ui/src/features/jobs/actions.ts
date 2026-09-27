// What a job can do where it is, with one name, icon and order wherever it shows (the menu of
// a right click on its row, the reader's "…", the row's tools under the pointer), from the
// tables below (ACTIONS, OF_PLACE, placeMoves, jobMenu, rowTools):
//   inbox: archive, delete; archive: unarchive, delete; trash: restore, delete for good (asks
//   first; the caller shows the dialog).
// A move folds the rows that leave the list (`moving`; a few, more simply go), opens the
// next job when the open one left (its row in view, with the focus when the focus was on the
// row that left), and says so in a short toast ("Archiviert") with Rückgängig; moves of the
// same kind right after each other merge into it, its one undo takes them all back. The undo
// brings every job back to where it was, its row too, and opens the job again that was open
// when it left. A click within GUARD_MS after the list or the pane changed is ignored, so a
// double click never moves the job that slid under the pointer. The job the app opens by
// itself counts as read only once it has been looked at (DWELL_MS on screen in the Jobs view,
// or a click in the reader). A job that is already where it goes is no move. A move or its
// undo that fails says so where it was asked (the list header, `jobs.actionError`).

import type { IconName } from '$components/Icon.svelte';
import type { RowTool } from '$components/JobRow.svelte';
import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { invoke } from '$lib/ipc/api';
import type { Deleted, JobKey, JobView, OpenTarget, Place } from '$lib/ipc/types';
import { staggerLimit } from '$lib/motion/motion';
import { app } from '$lib/state/app.svelte';
import { inList, isExcluded, jobs, keyOf, sameKey, type Unmove } from '$lib/state/jobs.svelte';
import type { MenuEntry, MenuItem } from '$lib/state/menu.svelte';
import { navigation } from '$lib/state/navigation.svelte';
import { exportText, run } from '$lib/state/run.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { copyJobText } from './jobText';
import { copyJobPrompt } from './prompt';

export type MoveId = 'archive' | 'unarchive' | 'trash' | 'restore';
export type ActionId = MoveId | 'purge';

/** Where a move goes. Wiederherstellen from the Papierkorb puts a job back where it lay (the
 *  backend knows: the archive for one thrown away from there); the page takes the inbox until
 *  it hears back. Dearchivieren puts a job of the Archiv back into the inbox. */
const TARGET: Record<MoveId, Place> = {
  archive: 'archive',
  unarchive: 'inbox',
  trash: 'trash',
  restore: 'inbox',
};

/** One icon per meaning: archiving looks like the archive, Dearchivieren like taking out of
 *  it, Wiederherstellen from the Papierkorb like taking back. Deleting is one look
 *  everywhere: Löschen and Endgültig löschen take the trash, in red (`deletes`: the row's
 *  tool, the entry of the menu and of the reader's "…"). */
const ACTIONS: Record<ActionId, { icon: IconName; deletes: boolean }> = {
  archive: { icon: 'archive', deletes: false },
  unarchive: { icon: 'unarchive', deletes: false },
  trash: { icon: 'trash', deletes: true },
  restore: { icon: 'undo', deletes: false },
  purge: { icon: 'trash', deletes: true },
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

/** What the job's menu needs from where it opens (the list's row, the reader's "…"; the
 *  row's tools take the moves of the same context). */
export interface JobMenuContext {
  /** "Öffnen": the job opens (none where it is open already, the reader). */
  open?: (() => void) | null;
  /** Only Als Text kopieren and what changes the job: the reader has its own buttons for
   *  the rest of what shows it. */
  changesOnly?: boolean;
  /** A move of the place, where the caller hands the focus on (the reader); by default the
   *  job simply moves. */
  move?: ((id: MoveId) => void) | null;
  /** "Endgültig löschen" asks first: the caller shows its dialog. */
  purge: () => void;
  /** Says an action that failed where the menu was opened (null: it went well). */
  report: (error: string | null) => void;
}

/**
 * The job's menu, one table for the row's right click and the reader's "…", in two groups
 * with a line between them: what shows the job (Öffnen, Alert-Mail öffnen, Anzeige öffnen,
 * KI-Prompt kopieren, Als Text kopieren; the reader shows all but the last as its buttons,
 * its "…" starts with that one), then what changes it (for an excluded job the entry that
 * counts it anyway, or the one that excludes it again once it counts, then the moves of its
 * place). No entry names a key. The test id of an entry is `menu-item-<id>`.
 */
export function jobMenu(job: JobView, context: JobMenuContext): MenuEntry[] {
  const { report } = context;
  const change = changesOf(job, context);
  const copy: MenuItem = {
    id: 'copy-text',
    label: t.actions.copyText,
    icon: 'copy',
    run: () => void copyJobText(job).then(report),
  };
  if (context.changesOnly === true) return [copy, { kind: 'separator' }, ...change];
  const show: MenuEntry[] = [];
  if (context.open) {
    show.push({ id: 'open', label: t.actions.open, icon: 'open', run: context.open });
  }
  const noProfile = app.hasProfile ? null : t.actions.promptNoProfile;
  show.push(
    {
      id: 'mail',
      label: t.actions.mail,
      icon: 'alertMail',
      run: () => void openTarget({ kind: 'gmail', key: job.key }).then(report),
    },
    {
      id: 'open-ad',
      label: t.actions.openAd,
      icon: 'external',
      run: () => void openAd(job).then(report),
    },
    {
      id: 'prompt',
      label: t.actions.prompt,
      icon: 'prompt',
      disabled: noProfile !== null,
      reason: noProfile,
      run: () => void copyJobPrompt(job.key).then(report),
    },
    copy,
  );
  return [...show, { kind: 'separator' }, ...change];
}

/** The second group of the job's menu: what changes the job where it is. */
function changesOf(job: JobView, context: JobMenuContext): MenuEntry[] {
  const { report } = context;
  const change: MenuEntry[] = [];
  if (isExcluded(job) || job.overridden) {
    const include = !job.overridden;
    change.push({
      id: include ? 'include' : 'exclude',
      label: include ? t.actions.include : t.actions.exclude,
      icon: include ? 'include' : 'excluded',
      run: () => void override(job, include).then(report),
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
      icon: ACTIONS[id].icon,
      danger: ACTIONS[id].deletes,
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
 * order as its menu (an icon each, its label the tooltip; the ones that delete are red).
 */
export function rowTools(job: JobView, context: JobMenuContext): RowTool[] {
  return placeMoves(job, context).map((entry) => {
    const id = entry.id as ActionId;
    return {
      id,
      icon: ACTIONS[id].icon,
      label: entry.label,
      deletes: ACTIONS[id].deletes,
      disabled: entry.disabled === true,
      reason: entry.reason ?? null,
      run: entry.run,
    };
  });
}

/**
 * "Trotzdem bewerten" (an excluded job counts with its real match) or "Wieder ausschließen":
 * a short toast with Rückgängig. Resolves with the error text, or null.
 */
async function override(job: JobView, include: boolean): Promise<string | null> {
  const error = await jobs.setOverride(job.key, include);
  if (error !== null) return error;
  toasts.show(include ? t.toast.included : t.toast.excluded, 'success', {
    label: t.common.undo,
    onclick: () =>
      void jobs.setOverride(job.key, !include).then((failed) => (jobs.actionError = failed)),
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

const GUARD_MS = 500;
let guardUntil = 0;
/** How long the next job opened by the app stays on screen before it counts as read. */
const DWELL_MS = 2000;
/** The dwell counts in steps of this, only while the job is on screen. */
const DWELL_STEP = 250;
let dwell: ReturnType<typeof setInterval> | undefined;

/** A click right after the pane changed to the next job (a double click) does nothing. */
export function guarded(): boolean {
  return performance.now() < guardUntil;
}

/** What a move's toast says: one short word, however many jobs it took (no titles). */
const SAID: Record<MoveId, () => string> = {
  archive: () => t.toast.archived,
  trash: () => t.toast.trashed,
  unarchive: () => t.toast.unarchived,
  restore: () => t.toast.restored,
};

/** The job to open when `gone` leave the list: the next one below, else the one above; none
 *  when the list did not hold them (a job opened from the day overview). */
function nextAfter(gone: readonly JobView[]): JobView | null {
  const rows = jobs.shown;
  const out = new Set(gone.map((job) => keyOf(job.key)));
  const last = Math.max(...gone.map((job) => rows.findIndex((row) => sameKey(row.key, job.key))));
  if (last < 0) return null;
  const below = rows.slice(last + 1).find((row) => !out.has(keyOf(row.key)));
  if (below) return below;
  return (
    rows
      .slice(0, Math.max(0, last))
      .reverse()
      .find((row) => !out.has(keyOf(row.key))) ?? null
  );
}

/** The list changed under the pointer: clicks on it wait a moment. */
function arm(): void {
  guardUntil = performance.now() + GUARD_MS;
}

/** Another list (another tab or place): nothing slid under the pointer, clicks count. */
export function disarm(): void {
  guardUntil = 0;
}

/** The job is on screen: the Jobs view is shown and the window is in front. */
function onScreen(): boolean {
  return (
    navigation.current === 'jobs' &&
    document.visibilityState !== 'hidden' &&
    document.documentElement.dataset['window'] !== 'inactive'
  );
}

/** The focus was on a row of the list, or on one of its tools. */
function inRow(): boolean {
  return document.activeElement?.closest('[data-key]') != null;
}

/**
 * When the open job left the list, the next one opens, not yet read (see `seen`): its row
 * comes into view, and takes the focus when the focus was on the row (or its tool) that left.
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
  const key = next.key;
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

/** The job the app opened has been looked at (the dwell, or a click in the reader). */
export function seen(key: JobKey | null = jobs.selected): void {
  clearInterval(dwell);
  if (key !== null && sameKey(jobs.selected, key)) jobs.markSeen(key);
}

/**
 * Takes one move back (the jobs to where they were, their rows too), then opens the job
 * again that was open when the move took it away, if it is listed again.
 */
async function undo(
  back: readonly Unmove[],
  generation: number,
  reopen: JobKey | null,
): Promise<void> {
  const result = await jobs.moveBack(back, generation);
  jobs.actionError = 'error' in result ? result.error : null;
  void jobs.loadOverview();
  // Only a job that really came back opens again (one already back is left as it is).
  if ('error' in result || reopen === null) return;
  if (!result.moved.some((key) => sameKey(key, reopen))) return;
  const row = jobs.rows.find((job) => sameKey(job.key, reopen));
  if (row) {
    await jobs.select(row, false);
    jobs.reveal = { key: keyOf(row.key), focus: false };
  }
}

/** Jobs deleted for good: their undo toasts can do nothing any more (the others stay), and
 *  a result file that could not follow says so in the list header. */
function deletedFor(deleted: Deleted): void {
  toasts.forget(new Set(deleted.keys.map(keyOf)));
  jobs.exportNote = exportText(deleted.exportError);
}

/**
 * Moves jobs (the row's or the reader's). Resolves with the error text, which the caller
 * shows where the move was asked (the list header for a row, the reader for its own).
 */
export async function move(all: readonly JobView[], action: MoveId): Promise<string | null> {
  const to = TARGET[action];
  // A job that already lies there is no move (and no toast says it moved).
  const list = all.filter((job) => job.place !== to);
  if (list.length === 0 || guarded()) return null;
  // Only rows that leave the list fold away, and only a few: many rows folding at once would
  // hold the page for frames.
  const leaving = list.filter((job) => !inList({ ...job, place: to }, jobs.place, jobs.filter));
  const next = leaving.length > 0 ? nextAfter(leaving) : null;
  const focus = inRow();
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
      at,
      below: at < 0 ? null : neighbour(jobs.rows.slice(at + 1)),
      above: at < 0 ? null : neighbour(jobs.rows.slice(0, at).reverse()),
    };
  });
  const open = jobs.selected;
  const reopen =
    open !== null && leaving.some((job) => sameKey(job.key, open)) ? { ...open } : null;
  // The list changes now, not when the backend answers: the second click of a double click
  // may come first (it would take the job straight back from where it went).
  if (leaving.length > 0) arm();
  const result = await jobs.move(
    list.map((job) => job.key),
    to,
    action === 'restore',
  );
  foldedAway(folding.map((job) => keyOf(job.key)));
  if ('error' in result) return result.error;
  if (leaving.length > 0) arm();
  openNext(leaving, next, focus, open);
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
    () => undo(undone, generation, reopen),
    undone.length,
    undone.map((entry) => keyOf(entry.job.key)),
  );
  return null;
}

/** Deletes jobs of the trash for good (after the dialog). Resolves with the error text. */
export async function purge(list: readonly JobView[]): Promise<string | null> {
  if (list.length === 0) return null;
  const next = nextAfter(list);
  const focus = inRow();
  const folding = list.length <= staggerLimit() ? list : [];
  for (const job of folding) moving.add(keyOf(job.key));
  const open = jobs.selected;
  const result = await jobs.purge(list.map((job) => job.key));
  foldedAway(folding.map((job) => keyOf(job.key)));
  if ('error' in result) return result.error;
  arm();
  openNext(list, next, focus, open);
  deletedFor(result);
  toasts.show(t.toast.deleted);
  void jobs.loadOverview();
  return null;
}

/** After the trash was emptied: no undo can reach its jobs any more. */
export function trashEmptied(deleted: Deleted): void {
  deletedFor(deleted);
}
