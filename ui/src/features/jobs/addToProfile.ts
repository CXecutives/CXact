// The reader's "+": a must requirement the profile lacks goes into the field of the profile
// its term belongs to (core names both: "Kenntnisse in Anaplan" is the tool "Anaplan"), saved
// at once like a save of the form (the previous file is the backup, every job is scored
// again), with a toast that takes it back while it is up. A term added here shows as added.
// (The profile form cannot hold unsaved changes meanwhile: leaving it asks first.)

import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { addToProfile as saveTerm } from '$lib/state/profile.svelte';
import type { ProfileTerm } from '$lib/state/terms';
import { toasts } from '$lib/state/toasts.svelte';

const fold = ({ term, field }: ProfileTerm): string =>
  `${field}:${term.trim().toLocaleLowerCase()}`;

/** Terms added in this session (folded), so their button says "Hinzugefügt". */
const added = new SvelteSet<string>();

/** Whether the term was added in this session. */
export function isAdded(term: ProfileTerm): boolean {
  return added.has(fold(term));
}

/** Adds a term to its field of the profile and saves; the toast's undo takes it out again.
 *  Resolves to the failure in words (the caller shows it where its button is), else null. */
export async function addTerm(term: ProfileTerm): Promise<string | null> {
  const text = term.term.trim();
  if (text === '' || isAdded(term)) return null;
  added.add(fold(term));
  let saved: (() => Promise<void>) | null;
  try {
    saved = await saveTerm(term);
  } catch (error) {
    added.delete(fold(term));
    return errorText(error);
  }
  const undo = saved;
  toasts.show(
    t.reader.addedToProfile(text),
    'success',
    undo === null
      ? null
      : {
          label: t.common.undo,
          onclick: () => {
            added.delete(fold(term));
            undo().catch((error: unknown) => toasts.show(errorText(error), 'info'));
          },
        },
  );
  return null;
}
