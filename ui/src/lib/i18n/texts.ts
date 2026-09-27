// Turns codes with params (errors, notices, reasons, criteria, health) into catalog text of
// the app's language (`t`). The screens never build sentences themselves.
//
// Engine codes travel as plain strings (`Reason.code`, `Notice.code`). The catalog tables
// in t.ts (and en.ts, the same keys) are the one place that knows them: a new code needs one
// entry there. Unknown codes from a newer core fall back to the ad's words or are left out,
// never to a raw code.

import { IpcError } from '../ipc/api';
import type { Notice, PortalHealth, Reason } from '../ipc/types';
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

const numberOf = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** Why a requirement of the ad (a skill, a term, a formal degree or licence) has its verdict,
 *  in one plain sentence from its code and params: the tooltip of its icon among the
 *  Anforderungen and of the Jobdetails row it decides. Never empty. */
export function reasonWhy(reason: Reason): string {
  const why = t.reason.why;
  const p = reason.params;
  const kind = reason.kind;
  if (reason.code === 'formalOpen') {
    if (p.class === 'licence') return why.licence.open;
    return p.class === 'degree' ? why.degree.open : why.noDegree;
  }
  const years = numberOf(p.years);
  const have = numberOf(p.have);
  // General experience: the years asked against the profile's own.
  if (p.general === true && years !== null) {
    return have === null ? why.noYears : why.years(t.facts.years(years, numberOf(p.max)), have);
  }
  switch (p.class) {
    case 'frame':
      return why.frame;
    case 'language':
      if (kind === 'met' || kind === 'partial') return why.language[kind];
      return p.held === true ? why.language.low : why.language.open;
    case 'degree':
      return why.degree[kind === 'met' || kind === 'partial' ? kind : 'open'];
    case 'licence':
      return kind === 'met' ? why.licence.met : why.licence.open;
  }
  const evidence = reason.evidence;
  if (evidence) {
    if (years !== null && have !== null && have < years) {
      return why.fewerYears(evidence.profile, have, years);
    }
    if (kind === 'met') return why.met(evidence.profile, numberOf(p.entryYears));
    if (kind === 'partial') {
      return evidence.via === 'general'
        ? why.general(evidence.profile)
        : why.partlyBy(evidence.profile);
    }
  }
  if (p.class === 'soft' && kind === 'partial') return why.soft;
  return kind === 'met' ? why.fits : kind === 'partial' ? why.partly : why.missing;
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
