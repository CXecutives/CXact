// The ways to a new profile besides the empty form, the same wherever they are offered (the
// Profil view's empty state and the menu of its title, the first-run page): "Aus Datei laden"
// puts a chosen profile file into the form for review, and "KI-Prompt für Profilanfertigung
// kopieren" puts the prompt on the clipboard that has any AI write such a file from a CV
// (core's profile/prompt.rs). Nothing is sent anywhere.

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import { invoke } from '$lib/ipc/api';
import { editor } from '$lib/state/profile.svelte';
import { toasts } from '$lib/state/toasts.svelte';

/**
 * "Aus Datei laden": the chosen file in the form for review (nothing is stored before
 * "Speichern"); `false` when the dialog was cancelled. `fresh`: saved as a new profile beside
 * the others. Throws what the file or the dialog refused.
 */
export async function pickProfile(fresh = false): Promise<boolean> {
  const draft = await invoke('pick_profile');
  if (draft === null) return false;
  editor.take(draft, fresh);
  return true;
}

/** "KI-Prompt für Profilanfertigung kopieren": the prompt on the clipboard, confirmed by a
 *  toast like the job's prompt; a failure is said in a toast too, the page stays as it is. */
export async function copyProfilePrompt(): Promise<void> {
  let prompt: string;
  try {
    prompt = await invoke('profile_prompt');
  } catch (error) {
    toasts.show(errorText(error), 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    toasts.show(t.profile.promptNotCopied, 'warning');
    return;
  }
  toasts.show(t.toast.prompt);
}
