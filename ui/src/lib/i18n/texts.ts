// Turns codes with params (errors, notices, reasons, criteria, health) into catalog text
// (`t`). The screens never build sentences themselves.
//
// Engine codes travel typed (`Reason.code` is a `ReasonCode`, `Notice.code` a `NoteCode`).
// The catalog tables in de.ts are the one place that knows them, each typed as a `Record` of
// its codes: a new code needs one entry there, or it is a type error.

import { IpcError } from '../ipc/api';
import type { CriterionKey, Notice, Params, PortalHealth, Reason } from '../ipc/types';
import { textOf } from './de';
import { t } from './t';

const has = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(table, key);

/** The text of any failure (IpcError from api.ts, or something unexpected). */
export function errorText(error: unknown): string {
  if (error instanceof IpcError) return t.error.text(error.kind, error.params);
  return t.error.text('unknown', {});
}

/** The hard criterion a reason or a note decided (`params.criterion`), if it names one. */
export function criterionOf(params: Params): CriterionKey | null {
  const value = params.criterion;
  return typeof value === 'string' && has(t.reader.criterion, value) ? value : null;
}

/** The ad's words as a line of their own: they may be cut from the middle of a sentence. A
 *  word with a capital inside (iOS, eBay) stays as it is. */
const capitalised = (words: string): string =>
  /^\p{Ll}\p{Lu}/u.test(words) ? words : words.charAt(0).toUpperCase() + words.slice(1);

/** The words of a reason: the ad's quote for requirements, a catalog sentence otherwise. */
export function reasonText(reason: Reason): string {
  const code = reason.code;
  if (code === 'requirement' || code === 'term') return capitalised(reason.label);
  return textOf(t.reason.code[code], reason.params) || reason.label;
}

/** A warning of the engine about the profile, in the catalog's words (null: none, or one the
 *  catalog does not know). */
export function warningText(warning: Notice | null): string | null {
  if (warning === null || !has(t.profile.warning, warning.code)) return null;
  return textOf(t.profile.warning[warning.code], warning.params);
}

/**
 * Why a job is excluded or not scored (the note of its match), if there is one. The engine
 * names the first violation by its reason code (`dayRate`, `country`, `anue` ...) with that
 * reason's params, the criterion it decided among them; so after the app's own notes the
 * reason catalog speaks, then the criterion.
 */
export function noteText(note: Notice | null): string | null {
  if (note === null) return null;
  const code = note.code;
  if (has(t.reader.note, code)) {
    const text = t.reader.note[code];
    return text === null ? null : textOf(text, note.params);
  }
  if (has(t.reason.code, code) && code !== 'requirement' && code !== 'term') {
    const text = textOf(t.reason.code[code], note.params);
    if (text) return text;
  }
  if (has(t.reader.criterion, code)) return t.reader.criterion[code];
  if (has(t.profile.warning, code)) return textOf(t.profile.warning[code], note.params);
  const key = criterionOf(note.params);
  return key ? t.reader.criterion[key] : null;
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
      return t.health.advice.pages;
    case 'loginRequired':
      return t.health.advice.login;
  }
}
