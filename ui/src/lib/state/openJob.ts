// The job that is open, kept per work folder (`jobs-open:<folder>` in the page's store): the
// next start of the app opens it again (lib/state/jobs.svelte.ts), only while it still lies
// where it lay. Without a store it is simply not kept.

import type { JobKey, Place } from '../ipc/types';
import { app } from './app.svelte';

/** Where the open job is kept (per work folder: `jobs-open:<folder>`). */
const OPEN_KEY = 'jobs-open';
const PLACES: readonly Place[] = ['inbox', 'archive', 'trash'];

/** The open job as kept: which one, and where it lay. */
export interface KeptOpen {
  key: JobKey;
  place: Place;
}

/** The store's name of the open job in the current work folder (null before the app state). */
function openName(): string | null {
  const folder = app.state?.settings.workspace ?? null;
  return folder === null ? null : `${OPEN_KEY}:${folder}`;
}

/** The kept open job of the work folder; anything else is none. */
export function keptOpen(): KeptOpen | null {
  const name = openName();
  if (name === null) return null;
  try {
    const kept = JSON.parse(localStorage.getItem(name) ?? 'null') as Partial<KeptOpen> | null;
    const key = kept?.key;
    const place = kept?.place;
    return typeof key?.portal === 'string' &&
      typeof key.id === 'string' &&
      place !== undefined &&
      PLACES.includes(place)
      ? { key: { portal: key.portal, id: key.id }, place }
      : null;
  } catch {
    return null;
  }
}

/** Keep the open job (null: none is open). */
export function keepOpen(job: KeptOpen | null): void {
  const name = openName();
  if (name === null) return;
  try {
    if (job === null) localStorage.removeItem(name);
    else localStorage.setItem(name, JSON.stringify({ key: job.key, place: job.place }));
  } catch {
    // Without a store the next start opens no job.
    return;
  }
}
