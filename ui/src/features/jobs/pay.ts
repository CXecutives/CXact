// The pay of the reader's row (terms.ts) as the ad states it: a day rate or an hourly one, or
// the annual salary of employment; a range as a range, a bonus beside the salary, another
// currency in its own.

import { t } from '$lib/i18n/t';
import type { KeyFacts } from '$lib/ipc/types';

type Params = Record<string, unknown>;

/** The value of the row. */
export interface Pay {
  value: string | null;
}

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The annual salary (`p`: the criterion's and the salary reason's params). */
export function salaryOf(facts: KeyFacts | null, p: Params): Pay {
  const stated = num(facts?.salary);
  const salary = stated ?? num(p.salary);
  if (salary === null) return { value: null };
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
  return { value: bonus ? t.facts.bonus(pay, bonus) : pay };
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
    return { value: agreed ? t.facts.agreed : null };
  }
  const currency = stated ? stated.currency : text(p.currency);
  const from = stated ? (stated.rateFrom ?? null) : num(p.from);
  const per = hourly ? 'hour' : 'day';
  return {
    value:
      from !== null && from < rate
        ? t.facts.payRange(from, rate, per, currency)
        : t.facts.pay(rate, per, currency),
  };
}
