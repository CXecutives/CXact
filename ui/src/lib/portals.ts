// The order in which the UI shows the portals (user decision 2026-09-27): freelance.de,
// LinkedIn, freelancermap. A table of the UI, not core's `Portal::ALL` (the order the backend
// works in): Einstellungen and the first-run page list them in this order.

import type { Portal } from './ipc/types';

export const PORTAL_ORDER: readonly Portal[] = ['freelance', 'linkedin', 'freelancermap'];

/** Items of the portals (their states, their counts) in the UI's order. */
export function inPortalOrder<Item extends { portal: Portal }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => PORTAL_ORDER.indexOf(a.portal) - PORTAL_ORDER.indexOf(b.portal));
}
