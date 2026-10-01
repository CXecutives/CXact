// The ways to a new profile besides the empty form, on the start page of a new profile
// (NewProfileWays; without a profile, from the menu of the profiles and the first-run page):
// "Datei hochladen" puts a chosen profile file into the form for review; "Prompt kopieren"
// copies the prompt that has any AI write that file from a CV (core's profile/prompt.rs).
// Nothing is sent anywhere and nothing is stored before "Speichern".

import { invoke } from '$lib/ipc/api';
import { editor } from '$lib/state/profile.svelte';

/**
 * "Aus Datei laden": the chosen file in the form for review; `false` when the dialog was
 * cancelled. `fresh`: saved as a new profile beside the others. Throws what the file or the
 * dialog refused.
 */
export async function pickProfile(fresh = false): Promise<boolean> {
  const draft = await invoke('pick_profile');
  if (draft === null) return false;
  editor.take(draft, fresh);
  return true;
}

/** "Prompt kopieren": the prompt on the clipboard; `false` when the clipboard refused it.
 *  Throws what the backend refused. */
export async function copyProfilePrompt(): Promise<boolean> {
  const prompt = await invoke('profile_prompt');
  try {
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch {
    return false;
  }
}
