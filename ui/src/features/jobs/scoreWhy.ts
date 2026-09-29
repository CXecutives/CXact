// "Warum diese Zahl?": what moved a job's score (MatchDetail.factors, the engine's codes and
// params, at most five) as the lines of the popover the reader's ring opens. Green, then
// yellow, then red, a note on the text last (user, 2026-09-29): what fits, what fits in part,
// what holds the score down (a cap ends it as the conclusion); each colour in reading order.
// Each line has the icon and the colour of its verdict: what lifts the score is met, what
// costs a little is met in part, what holds it down is not met, a text with little to judge
// by is unclear (muted). A code the catalog does not know shows no line.

import { t } from '$lib/i18n/t';
import type { Notice, ReasonKind } from '$lib/ipc/types';
import type { MenuLine } from '$lib/state/menu.svelte';

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

type Words = typeof t.score.factor;
type CapWhy = keyof Words['capWhy'];
type Evidence = keyof Words['evidence'];

/** The words and the verdict of one line, or null. */
function said(code: string, p: Notice['params']): [string, ReasonKind] | null {
  const words = t.score.factor;
  switch (code) {
    case 'musts': {
      const [met, total] = [num(p.met), num(p.total)];
      const verdict = met === total ? 'met' : 2 * met >= total ? 'partial' : 'open';
      return [words.musts(met, num(p.partial), total), verdict];
    }
    case 'nice': {
      const [met, total] = [num(p.met), num(p.total)];
      return [words.nice(met, total), met === total ? 'met' : 'partial'];
    }
    case 'focus': {
      const [hit, total] = [num(p.hit), num(p.total)];
      return [words.focus(hit, total), hit === 0 ? 'open' : hit === total ? 'met' : 'partial'];
    }
    case 'targetRole': {
      const role = text(p.role);
      if (p.fit === 'none' || role === '') return [words.noRole, 'partial'];
      return p.fit === 'full'
        ? [words.role(role, true), 'met']
        : [words.role(role, false), 'partial'];
    }
    case 'wishes':
      return num(p.points) > 0 ? [words.wishesUp, 'met'] : [words.wishesDown, 'partial'];
    case 'evidence': {
      const level = text(p.evidence);
      return level in words.evidence ? [words.evidence[level as Evidence], 'check'] : null;
    }
    case 'permanent':
      return [words.permanent, 'partial'];
    case 'cap': {
      const cap = text(p.cap);
      return cap in words.capWhy
        ? [words.cap(words.capWhy[cap as CapWhy], num(p.max)), 'open']
        : null;
    }
    default:
      return null;
  }
}

/** The place of a verdict's colour among the lines. */
const RANK: Record<ReasonKind, number> = { met: 0, partial: 1, open: 2, violation: 2, check: 3 };

/** The popover's lines of a match's factors (a stable sort keeps the reading order). */
export function whyLines(factors: readonly Notice[]): MenuLine[] {
  return factors
    .flatMap(({ code, params }): MenuLine[] => {
      const line = said(code, params);
      return line === null ? [] : [{ kind: 'line', id: code, label: line[0], verdict: line[1] }];
    })
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
}
