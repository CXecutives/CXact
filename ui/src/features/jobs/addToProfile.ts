// "Zum Profil hinzufügen": a must requirement the profile lacks goes into the profile's
// keywords (`keywords[]`), with a toast that takes it back (Ctrl/Cmd+Z too, while it is up).
// The one place the reader calls; the reader shows a term added here as added.
//
// For now the term goes into the page's copy of the profile form only (what the stub
// preview shows). The integrator wires the real save here, in `addToProfile` and its undo:
// `save_profile` with the stored form as `before` and the form with the term as `after`
// (the backend writes only that key and rescores), then `app.load()`.

import { SvelteSet } from 'svelte/reactivity';
import { t } from '$lib/i18n/t';
import { app } from '$lib/state/app.svelte';
import { toasts } from '$lib/state/toasts.svelte';

const fold = (term: string): string => term.trim().toLocaleLowerCase();

/** Terms added in this session (folded), so their button says "Hinzugefügt". */
const added = new SvelteSet<string>();

/** Whether the term was added from the reader in this session. */
export function isAdded(term: string): boolean {
  return added.has(fold(term));
}

/** The profile's keywords (null without a readable profile form). */
function keywords(): string[] | null {
  return app.state?.profile?.form?.keywords ?? null;
}

/** Adds a term to the profile's keywords; the toast's undo takes it out again. */
export function addToProfile(term: string): void {
  const text = term.trim();
  if (text === '' || isAdded(text)) return;
  const list = keywords();
  const known = list?.some((keyword) => fold(keyword) === fold(text)) ?? false;
  if (list !== null && !known) list.push(text);
  added.add(fold(text));
  toasts.show(t.reader.addedToProfile(text), 'success', {
    label: t.common.undo,
    onclick: () => removeFromProfile(text, known),
  });
}

/** The undo: the term leaves the keywords again (unless it stood there before). */
function removeFromProfile(term: string, known: boolean): void {
  added.delete(fold(term));
  if (known) return;
  const list = keywords();
  const at = list?.findIndex((keyword) => fold(keyword) === fold(term)) ?? -1;
  if (list !== null && at >= 0) list.splice(at, 1);
}
