// What shows a job (its alert mail, its ad, the prompt of it for an AI chat) as one table:
// the words, the glyph and what is off, decided once for the job's menu (actions.ts jobMenu:
// a right click on its row) and the reader's buttons.

import type { IconName } from '$components/Icon.svelte';
import { t } from '$lib/i18n/t';
import type { JobView } from '$lib/ipc/types';

/** What shows the job: its alert mail, its ad, the prompt of it for an AI chat. */
export type ShowId = 'mail' | 'open-ad' | 'prompt';

/** One way to show the job as it stands: its words, its glyph, why it cannot be done now
 *  (its tooltip; null: it can), and whether it is there at all for this job. */
export interface ShowAction {
  id: ShowId;
  label: string;
  icon: IconName;
  reason: string | null;
  /** Not offered for this job (no button, no menu entry). */
  hidden: boolean;
}

/** Their one order, in the menu and among the reader's buttons: the ad first, then its alert
 *  mail (user, 2026-09-30), then the prompt. */
export const SHOWS: readonly ShowId[] = ['open-ad', 'mail', 'prompt'];

/**
 * Alert-Mail öffnen, only for a job an alert mail brought (user, 2026-10-01: a job of the
 * search has none, the button is not there); Anzeige öffnen, the same words for an ad that
 * is gone or takes no applications (the portal's page still opens; the ad's note says it);
 * Prompt kopieren, only for a job with a score (scored or excluded; none without a profile)
 * and off without the ad's text (a preview is one).
 */
export function showActions(job: JobView): Record<ShowId, ShowAction> {
  const text = job.detail.kind === 'ok' || job.detail.kind === 'teaser';
  return {
    mail: {
      id: 'mail',
      label: t.actions.mail,
      icon: 'alertMail',
      reason: null,
      hidden: !job.hasMail,
    },
    'open-ad': {
      id: 'open-ad',
      label: t.actions.openAd,
      icon: 'external',
      reason: null,
      hidden: false,
    },
    prompt: {
      id: 'prompt',
      label: t.actions.prompt,
      icon: 'copy',
      reason: text ? null : t.reader.promptNoText,
      hidden: job.match === null || job.match.status === 'unscorable',
    },
  };
}
