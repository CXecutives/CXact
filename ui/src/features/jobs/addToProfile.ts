// "Zum Profil hinzufügen": a must requirement the profile lacks goes into the profile's
// keywords (`keywords[]`), saved at once like a save of the form (the previous file is the
// backup, every job is scored again), with a toast that takes it back (Ctrl/Cmd+Z too,
// while it is up). The one place the reader and the Übersicht call; a term added here shows
// as added. Not while the profile form holds unsaved changes: they come first.

import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { addToProfile as saveTerm, editor } from '$lib/state/profile.svelte';
import { toasts } from '$lib/state/toasts.svelte';

const fold = (term: string): string => term.trim().toLocaleLowerCase();

/** Terms added in this session (folded), so their button says "Hinzugefügt". */
const added = new SvelteSet<string>();

/** Whether the term was added in this session. */
export function isAdded(term: string): boolean {
  return added.has(fold(term));
}

/** Adds a term to the profile's keywords and saves; the toast's undo takes it out again. */
export function addToProfile(term: string): void {
  const text = term.trim();
  if (text === '' || isAdded(text)) return;
  if (editor.dirty) {
    toasts.show(t.profile.saveFirst, 'info');
    return;
  }
  added.add(fold(text));
  saveTerm(text)
    .then((undo) => {
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
    })
    .catch((error: unknown) => {
      added.delete(fold(text));
      toasts.show(errorText(error), 'info');
    });
}
