// What shows a job (its alert mail, its ad, the prompt of it for an AI chat) as one table:
// the words, the glyph and what is off, decided once for the job's menu (actions.ts jobMenu:
// a right click on its row, the reader's "…" of an excluded job) and the reader's buttons.

import type { IconName } from '$components/Icon.svelte';
import { t } from '$lib/i18n/t';
import type { JobView } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';

/** What shows the job: its alert mail, its ad, the prompt of it for an AI chat. */
export type ShowId = 'mail' | 'open-ad' | 'prompt';

/** One way to show the job as it stands: its words, its glyph, and why it cannot be done now
 *  (its tooltip; null: it can). */
export interface ShowAction {
  id: ShowId;
  label: string;
  icon: IconName;
  reason: string | null;
}

/** Their one order, in the menu and among the reader's buttons: the ad first, then its alert
 *  mail (user, 2026-09-30), then the prompt. */
export const SHOWS: readonly ShowId[] = ['open-ad', 'mail', 'prompt'];

/**
 * Alert-Mail öffnen, off without an alert mail; Anzeige öffnen, which says Offline-Anzeige
 * öffnen for an ad that is gone or takes no applications (the portal's page still opens);
 * KI-Prompt kopieren, off without a profile to judge the job by or without the ad's text (a
 * preview is one).
 */
export function showActions(job: JobView): Record<ShowId, ShowAction> {
  const offline = job.detail.kind === 'gone' || job.closed;
  const text = job.detail.kind === 'ok' || job.detail.kind === 'teaser';
  return {
    mail: {
      id: 'mail',
      label: t.actions.mail,
      icon: 'alertMail',
      reason: job.hasMail ? null : t.reader.noMail,
    },
    'open-ad': {
      id: 'open-ad',
      label: offline ? t.reader.openOffline : t.actions.openAd,
      icon: 'external',
      reason: null,
    },
    prompt: {
      id: 'prompt',
      label: t.actions.prompt,
      icon: 'prompt',
      reason: !app.hasProfile ? t.actions.promptNoProfile : text ? null : t.reader.promptNoText,
    },
  };
}
