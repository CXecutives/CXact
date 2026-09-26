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
  relativeShort: Intl.RelativeTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  dayMonthYear: Intl.DateTimeFormat;
  dayMonthShort: Intl.DateTimeFormat;
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
      relativeShort: new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }),
      dayMonth: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      dayMonthYear: new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      dayMonthShort: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
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
 * `jetzt` · `vor 5 Minuten` · `vor 3 Stunden` · `gestern` · `vorgestern`, then `So 20.09.`
 * (with the year if it is not the current one); in English `now` · `5 minutes ago` ·
 * `yesterday` · `2 days ago`, then `Sun 20/09`. `short` abbreviates the units for dense
 * lines (`vor 3 Std.`, `3 hr ago`).
 */
export function formatRelative(iso: string, now: Date = new Date(), short = false): string {
  const date = new Date(iso);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const { relative, relativeShort, dayMonth, weekday, dayMonthYear } = formats();
  const format = short ? relativeShort : relative;
  // The clock steps once a minute: a moment after its last step is still "now".
  const ahead = now.getTime() - time;
  const diff = ahead < 0 && ahead > -MINUTE ? 0 : ahead;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (diff >= 0 && days === 0) {
    if (diff < MINUTE) return format.format(0, 'second');
    if (diff < HOUR) return format.format(-Math.floor(diff / MINUTE), 'minute');
    return format.format(-Math.floor(diff / HOUR), 'hour');
  }
  if (days > 0 && days <= RELATIVE_DAYS) return format.format(-days, 'day');
  // Older: the weekday with the date ("So 20.09.", "Sun 20/09"), so last week is found
  // without counting.
  if (date.getFullYear() !== now.getFullYear()) return dayMonthYear.format(date);
  return `${weekday.format(date).replace(/\.$/, '')} ${dayMonth.format(date)}`;
}

/** `14:05` */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formats().clock.format(date);
}

/** `24.09.2026`, `24/09/2026` */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formats().dayMonthYear.format(date);
}

/** `1. Nov.`, `1 Nov`: a day of the coming months in few letters (a list row's start). */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formats().dayMonthShort.format(date);
}

/** The day of a moment in words while it is recent: `gestern`, `vorgestern` (`yesterday`,
 *  `2 days ago`), the weekday up to a week back (`Mo`), then the date; null for today. */
function dayOf(date: Date, now: Date): string | null {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return null;
  const { relative, weekday, dayMonth } = formats();
  if (days <= RELATIVE_DAYS) return relative.format(-days, 'day');
  if (days < 7) return weekday.format(date).replace(/\.$/, '');
  return dayMonth.format(date);
}

/**
 * `14:05` today, `gestern 14:05`, `vorgestern 14:05`, `Mo 14:05` up to a week back, then
 * `25.09. 14:05` (`25/09 14:05`); one unit a line never breaks (a sentence wraps before the
 * day, not between day and time).
 */
export function formatMoment(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { clock } = formats();
  const day = dayOf(date, now);
  return day === null ? clock.format(date) : `${day} ${clock.format(date)}`.replace(/ /g, NBSP);
}

/**
 * `08:30` today, `gestern`, `vorgestern`, `Mo` up to a week back, then `24.09.` (`24/09`):
 * when something happened, in the fewest characters (the sidebar's run status keeps to one
 * line; the run card has the time).
 */
export function formatStamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return dayOf(date, now) ?? formats().clock.format(date);
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

/** Remaining time as `4:05` (minutes and seconds) or `1:04:05`. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
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
