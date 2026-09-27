// Turns codes with params (errors, notices, reasons, criteria, health) into catalog text of
// the app's language (`t`). The screens never build sentences themselves.
//
// Engine codes travel as plain strings (`Reason.code`, `Notice.code`). The catalog tables
// in t.ts (and en.ts, the same keys) are the one place that knows them: a new code needs one
// entry there. Unknown codes from a newer core fall back to the ad's words or are left out,
// never to a raw code.

import { IpcError } from '../ipc/api';
import type { DetailState, Notice, PortalHealth, Reason } from '../ipc/types';
import {
  textOf,
  type CriterionKey,
  type MatchNote,
  type ProfileWarning,
  type ReasonCode,
} from './de';
import { t } from './t';

const has = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(table, key);

/** The text of any failure (IpcError from api.ts, or something unexpected). */
export function errorText(error: unknown): string {
  if (error instanceof IpcError) return t.error.text(error.kind, error.params);
  return t.error.text('unknown', {});
}

/** Criterion names differ between a note (`dayRate`) and the key (`minDayRate`). */
const ALIASES: Record<string, CriterionKey> = {
  dayRate: 'minDayRate',
  country: 'countries',
  anue: 'noAnue',
  permanent: 'noPermanent',
  salary: 'minSalary',
  tooJunior: 'targetYears',
  exclusionWord: 'exclusionWords',
};

export function criterionKey(value: unknown): CriterionKey | null {
  if (typeof value !== 'string') return null;
  if (has(t.reader.criterion, value)) return value;
  return ALIASES[value] ?? null;
}

/** The words of a reason: the ad's quote for requirements, a catalog sentence otherwise. */
export function reasonText(reason: Reason): string {
  const code = reason.code;
  if (!has(t.reason.code, code) || code === 'requirement' || code === 'term') {
    return reason.label;
  }
  return textOf(t.reason.code[code as ReasonCode], reason.params) || reason.label;
}

/** Wishes of the profile: their sentence names the wish already. */
const WISH_CODES: readonly string[] = ['dayRateWish', 'remoteWish', 'regionWish', 'industryWish'];
/** Words only, folded ("Interim-Management" reads like "interim management"). */
const plain = (text: string): string =>
  text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
/** The requirement's own words hold the profile's phrase already (whole words). */
const within = (profile: string, words: string): boolean =>
  plain(profile) !== '' && ` ${plain(words)} `.includes(` ${plain(profile)} `);

/** The line under a reason: the profile's side of its evidence; null without one, for a wish
 *  and when the profile's phrase is no other than the requirement's own words ("Passt zu
 *  „HGB“ im Profil" under "Konzernabschluss nach HGB" says nothing new). */
export function reasonEvidence(reason: Reason): string | null {
  const profile = reason.evidence?.profile;
  if (!profile || WISH_CODES.includes(reason.code)) return null;
  if (within(profile, reason.label) || within(profile, reason.evidence?.quote ?? '')) return null;
  return t.reason.evidenceLine(profile, reason.kind === 'partial');
}

/** Tooltip of a reason: quote and profile evidence, or that the profile lacks it. */
export function reasonHint(reason: Reason): string | null {
  if (reason.evidence) {
    return t.reason.evidence(
      reason.evidence.quote || reason.label,
      reason.evidence.profile,
      reason.kind === 'partial',
    );
  }
  if (reason.kind === 'open' && reason.label) return t.reason.missing(reason.label);
  return null;
}

/**
 * Why a job is excluded or not scored (the note of its match), if there is one. The engine
 * names the first violation by its reason code (`dayRate`, `country`, `anue` ...) with that
 * reason's params, so after the note table the reason catalog speaks, then the criterion.
 */
export function noteText(note: Notice | null): string | null {
  if (note === null) return null;
  if (note.code === 'hardCriterion') {
    const key = criterionKey(note.params.criterion);
    return key ? t.reader.criterion[key].exclusion : t.reader.note.hardCriterion;
  }
  if (has(t.reader.note, note.code)) {
    return textOf(t.reader.note[note.code as MatchNote], note.params);
  }
  if (has(t.reason.code, note.code) && note.code !== 'requirement' && note.code !== 'term') {
    const text = textOf(t.reason.code[note.code as ReasonCode], note.params);
    if (text) return text;
  }
  const key = criterionKey(note.code);
  return key ? t.reader.criterion[key].exclusion : null;
}

/** Whether a detail state warns (the ad could not be read, or is gone) or is a quiet fact
 *  (it follows, it is a teaser, it comes on request): one tone for the reader's note and the
 *  run card. */
export const DETAIL_WARNS: Record<Exclude<DetailState['kind'], 'ok'>, boolean> = {
  failed: true,
  unfetchable: true,
  gone: true,
  pending: false,
  teaser: false,
  onRequest: false,
};

export function warningText(notice: Notice): string | null {
  return has(t.profile.warning, notice.code)
    ? textOf(t.profile.warning[notice.code as ProfileWarning], notice.params)
    : null;
}

/**
 * A portal problem in one sentence that says what she has to do, or that the app carries on
 * by itself (which of the two is `PortalState.actionNeeded`); the same words in the run
 * card, the day overview and the settings. `ok` has none.
 */
export function healthAdvice(health: PortalHealth): string | null {
  switch (health.kind) {
    case 'ok':
      return null;
    case 'paused':
      return t.health.advice.paused(health.reason, health.until);
    case 'quotaReached':
      return t.health.advice.quota(health.until);
    case 'layoutSuspect':
      return health.emptyMails > 0
        ? t.health.advice.emptyMails(health.emptyMails)
        : t.health.advice.pages;
    case 'loginRequired':
      return t.health.advice.login;
  }
}
