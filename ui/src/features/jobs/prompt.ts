// A job's prompt for any AI chat. Copied to the clipboard and confirmed by a toast; nothing
// is sent. A clipboard that refuses says so in its own words (no log line would explain it).

import { t } from '$lib/i18n/t';
import { errorText } from '$lib/i18n/texts';
import type { JobKey } from '$lib/ipc/types';
import { jobs } from '$lib/state/jobs.svelte';
import { toasts } from '$lib/state/toasts.svelte';

/** Puts text on the clipboard; false when the clipboard refused it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy the prompt; resolves with the error text, or null. */
/** The prompt of one job for any AI chat, on the clipboard (the job's menu, the reader). */
export async function copyJobPrompt(key: JobKey): Promise<string | null> {
  let prompt: string;
  try {
    prompt = await jobs.aiPrompt(key);
  } catch (error) {
    return errorText(error);
  }
  if (!(await copyText(prompt))) return t.reader.promptNotCopied;
  toasts.show(t.toast.prompt);
  return null;
}
