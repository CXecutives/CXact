// "Zum Profil hinzufügen": a must requirement the profile lacks goes into the profile's
// keywords (`keywords[]`), saved at once like a save of the form (the previous file is the
// backup, every job is scored again), with a toast that takes it back while it is up. The
// one place the reader and the Übersicht call; a term added here shows
// as added. (The profile form cannot hold unsaved changes meanwhile: leaving it asks first.)

import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { addToProfile as saveTerm } from '$lib/state/profile.svelte';
import { toasts } from '$lib/state/toasts.svelte';

const fold = (term: string): string => term.trim().toLocaleLowerCase();

/** Terms added in this session (folded), so their button says "Hinzugefügt". */
const added = new SvelteSet<string>();

/** Whether the term was added in this session. */
export function isAdded(term: string): boolean {
  return added.has(fold(term));
}

/** Adds a term to the profile's keywords and saves; the toast's undo takes it out again.
 *  Resolves to the failure in words (the caller shows it where its button is), else null. */
export async function addTerm(term: string): Promise<string | null> {
  const text = term.trim();
  if (text === '' || isAdded(text)) return null;
  added.add(fold(text));
  let saved: (() => Promise<void>) | null;
  try {
    saved = await saveTerm(text);
  } catch (error) {
    added.delete(fold(text));
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
            added.delete(fold(text));
            undo().catch((error: unknown) => toasts.show(errorText(error), 'info'));
          },
        },
  );
  return null;
}

/** The same where no error line stands beside the button: a failure is a toast. */
export function addToProfile(term: string): void {
  void addTerm(term).then((error) => {
    if (error !== null) toasts.show(error, 'info');
  });
}
