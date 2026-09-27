// The pay of the reader's row (terms.ts) as the ad states it: a day rate or an hourly one, or
// the annual salary of employment; a range as a range, a bonus beside the salary, another
// currency in its own. And why it meets the profile's minimum (the tooltip of a met row): how
// far above it lies the amount the rule compares (the upper end, an hourly rate per day, a
// salary with its bonus), naming the upper end where the lower one lies below the minimum.

import { t } from '$lib/i18n/t';
import type { KeyFacts } from '$lib/ipc/types';
import { aboveMinimum } from './verdicts';

type Params = Record<string, unknown>;

/** The value of the row and the sentence of a met verdict. */
export interface Pay {
  value: string | null;
  met: string | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
/** A number the engine may send as text (the profile's minimum day rate, `"1100"`). */
const amount = (value: unknown): number | null => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The upper end is what meets the minimum where the lower one lies below it. */
const upperMeets = (from: number | null, min: number | null): boolean =>
  from !== null && min !== null && from < min;

/** The annual salary (`p`: the criterion's and the salary reason's params). */
export function salaryOf(facts: KeyFacts | null, p: Params): Pay {
  const stated = num(facts?.salary);
  const salary = stated ?? num(p.salary);
  if (salary === null) return { value: null, met: null };
  const fromFacts = stated !== null;
  const lower = fromFacts ? facts?.salaryLowerBound === true : p.lowerBound === true;
  // Another currency only reaches the row through the params (the facts hold euros).
  const currency = fromFacts ? null : text(p.currency);
  const from = fromFacts ? (facts?.salaryFrom ?? null) : num(p.from);
  const bonus = fromFacts ? (facts?.salaryBonus ?? null) : num(p.bonus);
  const pay =
    from !== null && from < salary
      ? t.facts.payRange(from, salary, 'year', currency)
      : t.facts.pay(salary, 'year', currency, lower);
  const min = amount(p.min);
  // The rule compares the upper end with its bonus.
  const above = currency === null ? aboveMinimum(num(p.withBonus) ?? salary, min) : null;
  return {
    value: bonus ? t.facts.bonus(pay, bonus) : pay,
    met:
      above === null
        ? null
        : bonus
          ? t.reader.payMet.bonus(above)
          : upperMeets(from, min)
            ? t.reader.payMet.upper(above)
            : t.reader.payMet.salary(above),
  };
}

/** Whether the rate is per hour. */
export function hourlyOf(facts: KeyFacts | null, p: Params): boolean {
  return (typeof facts?.rate === 'number' ? facts.hourly : p.hourly) === true;
}

/** The day rate or the hourly one (`p`: the criterion's params, a linked reason's in them). */
export function rateOf(facts: KeyFacts | null, p: Params): Pay {
  const stated = typeof facts?.rate === 'number' ? facts : null;
  const hourly = hourlyOf(facts, p);
  // A reason of an hourly rate names it `amount` (its `rate` is per day).
  const rate = stated?.rate ?? (hourly ? (num(p.amount) ?? num(p.rate)) : num(p.rate));
  if (rate === null) {
    const agreed = facts?.rateOpen === true || p.rateOpen === true;
    return { value: agreed ? t.facts.agreed : null, met: null };
  }
  const currency = stated ? stated.currency : text(p.currency);
  const from = stated ? (stated.rateFrom ?? null) : num(p.from);
  const per = hourly ? 'hour' : 'day';
  const euros = currency === null || currency === 'EUR';
  // The rule compares a day rate in euros, an hourly one by what it makes a day.
  const perDay = hourly ? num(p.perDay) : rate;
  const min = amount(p.min);
  const above = euros ? aboveMinimum(perDay, min) : null;
  return {
    value:
      from !== null && from < rate
        ? t.facts.payRange(from, rate, per, currency)
        : t.facts.pay(rate, per, currency),
    met:
      above === null || perDay === null
        ? null
        : hourly
          ? t.reader.payMet.hour(rate, perDay, above)
          : upperMeets(from, min)
            ? t.reader.payMet.upper(above)
            : t.reader.payMet.day(above),
  };
}
