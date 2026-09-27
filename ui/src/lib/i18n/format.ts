// Numbers and dates in the app's language (language.svelte.ts): German (de-DE) or British
// English (en-GB, 24 h, day first). Every call reads the current language, so what a
// template formats follows a switch at once. Render the results with tabular numbers
// (`font-variant-numeric: var(--numeric)`), so counters do not jitter.

import type { Language } from '../ipc/types';
import { language } from './language.svelte';

/** U+202F, the narrow no-break space between a number and its unit (`87 %`). */
export const NARROW_NBSP = ' ';
/** U+00A0, a space no line breaks at. */
export const NBSP = ' ';

interface Formats {
  integer: Intl.NumberFormat;
  oneDecimal: Intl.NumberFormat;
  relative: Intl.RelativeTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  dayMonthYear: Intl.DateTimeFormat;
  clock: Intl.DateTimeFormat;
}

/** The formats of each language, built on first use. */
const built = new Map<Language, Formats>();

function formats(): Formats {
  const current = language.current;
  let found = built.get(current);
  if (found === undefined) {
    const locale = language.locale;
    found = {
      integer: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      oneDecimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
      dayMonth: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      dayMonthYear: new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      clock: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    };
    built.set(current, found);
  }
  return found;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Days back that still read as words ("gestern", "vorgestern"); earlier days show their
 *  weekday and date, so a day of last week is found without counting back. */
const RELATIVE_DAYS = 2;

/** `1.234`, `1,234` */
export function formatNumber(value: number): string {
  return formats().integer.format(value);
}

/** `87 %` with a narrow no-break space in German, `87%` in English. */
export function formatPercent(value: number): string {
  const number = formats().integer.format(value);
  return language.current === 'de' ? `${number}${NARROW_NBSP}%` : `${number}%`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The stamp of a list row, like a mail list: the time today (`14:05`), then `Gestern` and
 * `Vorgestern` (`Yesterday`, `2 days ago`), then the weekday with the date (`Mi 23.09.`,
 * `Wed 23/09`), with the year when it is not this one (`23.09.2025`).
 */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { clock, relative, dayMonth, weekday, dayMonthYear } = formats();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return clock.format(date);
  if (days > 0 && days <= RELATIVE_DAYS) return capitalised(relative.format(-days, 'day'));
  // Older: the weekday with the date, so last week is found without counting.
  if (date.getFullYear() !== now.getFullYear()) return dayMonthYear.format(date);
  return `${weekday.format(date).replace(/\.$/, '')} ${dayMonth.format(date)}`;
}

/** The text with its first letter in capitals (`gestern` becomes `Gestern`). */
function capitalised(text: string): string {
  return text.charAt(0).toLocaleUpperCase(language.locale) + text.slice(1);
}

/** `24.09.`, `24/09`, with the year when it is not this one (`24.09.2025`): the one date of a
 *  job's facts (the day of its alert mail, a start "ab 01.11."). */
export function formatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { dayMonth, dayMonthYear } = formats();
  return (date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(date);
}

/** The day of a moment in words while it is near: `gestern`, `vorgestern` (`yesterday`,
 *  `2 days ago`) and ahead `morgen`, `übermorgen` (`tomorrow`, `in 2 days`), the weekday up
 *  to a week away (`Mo`), then the date; null for today. A time alone always means today. */
function dayOf(date: Date, now: Date): string | null {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return null;
  const { relative, weekday, dayMonth } = formats();
  if (Math.abs(days) <= RELATIVE_DAYS) return relative.format(-days, 'day');
  if (Math.abs(days) < 7) return weekday.format(date).replace(/\.$/, '');
  return dayMonth.format(date);
}

/**
 * `14:05` today, `gestern 14:05`, `vorgestern 14:05`, `Mo 14:05` up to a week back, then
 * `25.09. 14:05` (`25/09 14:05`); ahead the same (`morgen 09:30`, so "ab 09:30" never means
 * tomorrow); one unit a line never breaks (a sentence wraps before the day, not between day
 * and time).
 */
export function formatMoment(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { clock } = formats();
  const day = dayOf(date, now);
  return day === null ? clock.format(date) : `${day} ${clock.format(date)}`.replace(/ /g, NBSP);
}

/**
 * `Heute 14:05`, `Gestern 14:05`, `Vorgestern 14:05`, `Mo 14:05` up to a week back, then
 * `25.09. 14:05` (`Today 14:05`, `Yesterday 14:05`, ...): a moment at the start of a line in
 * a list of days, today named too.
 */
export function formatDayTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { clock, relative } = formats();
  const day = dayOf(date, now) ?? relative.format(0, 'day');
  return capitalised(`${day} ${clock.format(date)}`.replace(/ /g, NBSP));
}

/** `18 KB`, `1,2 MB` (`1.2 MB`): the size of a backup. */
export function formatBytes(bytes: number): string {
  const { integer, oneDecimal } = formats();
  const kb = bytes / 1024;
  if (kb < 1024) return `${integer.format(Math.max(1, Math.round(kb)))}${NARROW_NBSP}KB`;
  return `${oneDecimal.format(kb / 1024)}${NARROW_NBSP}MB`;
}

/** `1.200 €` in German, `€1,200` in English. */
export function formatEuro(value: number | string | boolean | null | undefined): string {
  const number = typeof value === 'number' ? value : Number(value);
  const amount = Number.isFinite(number) ? formats().integer.format(number) : String(value ?? '');
  return language.current === 'de' ? `${amount}${NARROW_NBSP}€` : `€${amount}`;
}

/**
 * An amount in its currency: euros as `formatEuro` does, any other currency with its code
 * after the number, joined by the space a line never breaks at (`1.000 CHF`, `1,000 CHF`).
 */
export function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency || currency === 'EUR') return formatEuro(value);
  const space = language.current === 'de' ? NARROW_NBSP : NBSP;
  return `${formats().integer.format(value)}${space}${currency}`;
}

/* Gender tags of job titles: `(m/w/d)`, `(w/m/d)`, `(m/f/d)`, `(d/m/w)`, `(m/w/x)`,
   `(m/w/divers)`, `(all genders)`, `(gn*)`, `[m/w/d]` and a bare `m/w/d`. */
const GENDER_TOKEN = String.raw`(?:[mwfdxi*]|div(?:ers|erse)?|inter)`;
const GENDER_LIST = String.raw`${GENDER_TOKEN}(?:\s*[/|,]\s*${GENDER_TOKEN}){1,4}`;
const GENDER_WORDS = String.raw`(?:all\s+genders?|alle\s+geschlechter|gn\*?|genderneutral)`;
const GENDER_TAG = new RegExp(
  String.raw`\s*[([]\s*(?:${GENDER_LIST}|${GENDER_WORDS})\s*[)\]]`,
  'giu',
);
const BARE_GENDER = new RegExp(
  String.raw`(?<=^|\s)[mwf]\s*/\s*[mwf]\s*/\s*(?:d|x|div(?:ers)?)(?=$|[\s,.;])`,
  'giu',
);
const DANGLING = /[\s,;|–—-]+$/u;

/**
 * A job title for display: without gender tags such as `(m/w/d)` (they add nothing to the
 * decision and cost the most room). The stored title stays as it is.
 */
export function displayTitle(title: string): string {
  const clean = title
    .replace(GENDER_TAG, '')
    .replace(BARE_GENDER, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .replace(DANGLING, '');
  return clean || title.trim();
}
