// The usage rules of the CV worker, without I/O: which counters a request reserves and up to
// what, when a full counter frees again, and whether a failed AI call gives its tries back.
// index.ts runs them against D1 and OpenRouter.

/** Tries per install a day and a month, and per address a day. */
export const LIMIT_ID_DAY = 2;
export const LIMIT_ID_MONTH = 5;
export const LIMIT_IP_DAY = 10;

/** The days in UTC: today and this month as counter keys, and the first day of the next day
 * and month as the `until` of a full counter. */
export interface Days {
  today: string;
  month: string;
  tomorrow: string;
  nextMonth: string;
}

/** One counter a request reserves a try in. `name` is for the log only (never the key: it
 * holds the install id or the address's hash). */
export interface Slot {
  name: 'month' | 'day' | 'ip';
  key: string;
  day: string;
  limit: number;
  /** The day a full counter frees again: the app's `until`. */
  until: string;
}

/** What became of the call to OpenRouter: `status` the HTTP status of its answer (`null` when
 * none came: a network error, or the time limit before the answer), `costUsd` the cost the
 * answer names (`null` when it names none). */
export interface Call {
  status: number | null;
  costUsd: number | null;
}

export function calendar(now: Date): Days {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const today = iso(now);
  return {
    today,
    month: today.slice(0, 7),
    tomorrow: iso(new Date(Date.UTC(y, m, d + 1))),
    nextMonth: iso(new Date(Date.UTC(y, m + 1, 1))),
  };
}

/** The counters a request reserves, in this order: the install's month first (when it is
 * full, the next day would not help), its day, and the address's day. */
export function slots(installId: string, ipKey: string, days: Days): Slot[] {
  const id = `id:${installId}`;
  return [
    { name: 'month', key: id, day: days.month, limit: LIMIT_ID_MONTH, until: days.nextMonth },
    { name: 'day', key: id, day: days.today, limit: LIMIT_ID_DAY, until: days.tomorrow },
    { name: 'ip', key: ipKey, day: days.today, limit: LIMIT_IP_DAY, until: days.tomorrow },
  ];
}

/** Whether a failed AI call cost nothing, so its tries go back. It is free only when no answer
 * came, or an error status that names no cost. A 2xx answer means the model ran and OpenRouter
 * charged for it, whatever followed: cut off, refused, not of the schema, or a body that is an
 * error or unreadable. Those tries count. */
export function isFree(call: Call): boolean {
  if (call.status === null) {
    return true;
  }
  if (call.status >= 200 && call.status < 300) {
    return false;
  }
  return call.costUsd === null || call.costUsd <= 0;
}

/** The tries an install has left today after a try that counted, and from when on it works
 * again when none are left. */
export function remaining(
  month: number,
  today: number,
  days: Days,
): { remainingToday: number; until: string | null } {
  const remainingToday = Math.max(0, Math.min(LIMIT_ID_DAY - today, LIMIT_ID_MONTH - month));
  if (remainingToday > 0) {
    return { remainingToday, until: null };
  }
  return { remainingToday, until: month >= LIMIT_ID_MONTH ? days.nextMonth : days.tomorrow };
}
