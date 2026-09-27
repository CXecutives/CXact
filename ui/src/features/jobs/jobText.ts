// "Als Text kopieren" (the job's menu, the reader's "…"): the job as plain lines to paste
// into a note or a mail: its title, company, place, pay, start, duration and the link of its
// ad, each on a line of its own in the words of the Jobdetails, what the ad does not say
// left out. A toast says "Kopiert"; a clipboard that refuses says so in its own words.

import { payWords, startWords } from '$lib/facts';
import { displayTitle } from '$lib/i18n/format';
import { t } from '$lib/i18n/t';
import { invoke } from '$lib/ipc/api';
import type { JobView } from '$lib/ipc/types';
import { placeOf } from '$lib/place';
import { jobs, sameKey } from '$lib/state/jobs.svelte';
import { toasts } from '$lib/state/toasts.svelte';
import { copyText } from './prompt';

/** The job's lines (`url`: the link of its ad, if known). */
function jobLines(job: JobView, url: string | null): string[] {
  const facts = job.match?.facts ?? null;
  const lines = [
    job.title ? displayTitle(job.title) : t.job.untitled,
    job.company,
    placeOf(job.location),
    payWords(job),
    facts?.start ? startWords(facts.start) : null,
    facts?.months ? t.facts.months(facts.months) : null,
    url,
  ];
  return lines.filter((line): line is string => line !== null && line.trim() !== '');
}

/** The link of the job's ad: the open reader's, else the job's details ask the backend. */
async function adLink(job: JobView): Promise<string | null> {
  const open = jobs.detail;
  if (open !== null && sameKey(open.job.key, job.key)) return open.url;
  try {
    return (await invoke('job_detail', { key: job.key })).url;
  } catch {
    // Without the link the other lines still go.
    return null;
  }
}

/** Copy the job as text; resolves with the error text, or null. */
export async function copyJobText(job: JobView): Promise<string | null> {
  const lines = jobLines(job, await adLink(job));
  if (!(await copyText(lines.join('\n')))) return t.reader.textNotCopied;
  toasts.show(t.toast.copied);
  return null;
}
