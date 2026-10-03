// Numbers and dates in German (de-DE). Render the results with tabular numbers
// (`font-variant-numeric: var(--numeric)`), so counters do not jitter.

/** The locale of every number and date. */
const LOCALE = 'de-DE';

/** U+202F, the narrow no-break space between a number and its unit (`87 %`). */
export const NARROW_NBSP = ' ';
/** U+00A0, a space no line breaks at. */
export const NBSP = ' ';
/** U+2011, a hyphen no line breaks at (a compound that must stay whole on its line). */
export const NB_HYPHEN = '‑';

interface Formats {
  integer: Intl.NumberFormat;
  oneDecimal: Intl.NumberFormat;
  relative: Intl.RelativeTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  dayMonthYear: Intl.DateTimeFormat;
  clock: Intl.DateTimeFormat;
}

/** The formats, built on first use. */
let built: Formats | null = null;

function formats(): Formats {
  built ??= {
    integer: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }),
    oneDecimal: new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }),
    relative: new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' }),
    dayMonth: new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit' }),
    weekday: new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }),
    dayMonthYear: new Intl.DateTimeFormat(LOCALE, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    clock: new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }),
  };
  return built;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Days back that still read as words ("gestern", "vorgestern"); earlier days show their
 *  weekday and date, so a day of last week is found without counting back. */
const RELATIVE_DAYS = 2;

/** `1.234` */
export function formatNumber(value: number): string {
  return formats().integer.format(value);
}

/** `87 %` with a narrow no-break space. */
export function formatPercent(value: number): string {
  return `${formats().integer.format(value)}${NARROW_NBSP}%`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The stamp of a list row, like a mail list: the time today (`14:05`), then `Gestern` and
 * `Vorgestern`, then the weekday with the date (`Mi 23.09.`), with the year when it is not
 * this one (`23.09.2025`).
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
  return text.charAt(0).toLocaleUpperCase(LOCALE) + text.slice(1);
}

/** `24.09.`, with the year when it is not this one (`24.09.2025`): the one date of a
 *  job's facts (the day of its alert mail, a start "ab 01.11."). */
export function formatDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { dayMonth, dayMonthYear } = formats();
  return (date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(date);
}

/** The day of a moment in words while it is near: `gestern`, `vorgestern` and ahead
 *  `morgen`, `übermorgen`, the weekday up to a week away (`Mo`), then the date; null for
 *  today. A time alone always means today. */
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
 * `25.09. 14:05`; ahead the same (`morgen 09:30`, so "ab 09:30" never means
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
 * `25.09. 14:05`: a moment at the start of a line in a list of days, today named too.
 */
export function formatDayTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const { clock, relative } = formats();
  const day = dayOf(date, now) ?? relative.format(0, 'day');
  return capitalised(`${day} ${clock.format(date)}`.replace(/ /g, NBSP));
}

/** `1.200 €` */
export function formatEuro(value: number | string | boolean | null | undefined): string {
  const number = typeof value === 'number' ? value : Number(value);
  const amount = Number.isFinite(number) ? formats().integer.format(number) : String(value ?? '');
  return `${amount}${NARROW_NBSP}€`;
}

/**
 * An amount in its currency: euros as `formatEuro` does, any other currency with its code
 * after the number, joined by the space a line never breaks at (`1.000 CHF`).
 */
export function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency || currency === 'EUR') return formatEuro(value);
  return `${formats().integer.format(value)}${NARROW_NBSP}${currency}`;
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
