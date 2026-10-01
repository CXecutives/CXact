// The order in which the UI shows the sources (user decision 2026-10-01): the ones the app
// searches first (Hays, freelancermap), then the ones of alert mails (LinkedIn, freelance.de).
// A table of the UI, not core's `Portal::ALL` (the order the backend works in): Einstellungen
// and the first-run page list them in this order.

import type { Portal } from './ipc/types';

export const PORTAL_ORDER: readonly Portal[] = ['hays', 'freelancermap', 'linkedin', 'freelance'];

/** Items of the portals (their states, their counts) in the UI's order. */
export function inPortalOrder<Item extends { portal: Portal }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => PORTAL_ORDER.indexOf(a.portal) - PORTAL_ORDER.indexOf(b.portal));
}
