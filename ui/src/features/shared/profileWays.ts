// The ways to a new profile besides the empty form, the same wherever "Neues Profil" is
// offered (its dialog, from the Profil view's empty state, the menu of its title and the
// first-run page): "Aus Datei laden" puts a chosen profile file into the form for review;
// "Aus dem Lebenslauf" copies the prompt that has any AI write the profile from a CV (core's
// profile/prompt.rs) and takes the AI's answer back from the clipboard. Nothing is sent
// anywhere and nothing is stored before "Speichern".

import { invoke } from '$lib/ipc/api';
import type { ProfileDraft } from '$lib/ipc/types';
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

/** The text on the clipboard, or null where the platform refuses it (or holds none). */
export async function clipboardText(): Promise<string | null> {
  const text = await invoke('clipboard_text').catch(() => null);
  return text === null || text.trim() === '' ? null : text;
}

/** An AI's answer as a draft of the form, or null when it holds no profile. */
export function readAnswer(text: string): Promise<ProfileDraft | null> {
  return invoke('read_profile_text', { text });
}
