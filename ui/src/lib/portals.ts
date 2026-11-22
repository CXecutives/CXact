// The order in which the UI shows the sources (user decision 2026-10-04, by size): the ones
// the app searches first (freelancermap, GULP, Hays, SOLCOM, Michael Page, Amadeus Fire,
// interim-x, FRATCH), then the ones of alert mails only (LinkedIn, freelance.de).
// A table of the UI, not core's `Portal::ALL` (the order the backend works in): Einstellungen
// and the setup list them in this order.

import type { Portal } from './ipc/types';

/** Each portal's place in the UI's order (a new portal is a type error until it has one). */
export const PORTAL_ORDER: Record<Portal, number> = {
  freelancermap: 0,
  gulp: 1,
  hays: 2,
  solcom: 3,
  michaelpage: 4,
  amadeusfire: 5,
  interimx: 6,
  fratch: 7,
  linkedin: 8,
  freelance: 9,
};

/** Items of the portals (their states, their counts) in the UI's order. */
export function inPortalOrder<Item extends { portal: Portal }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => PORTAL_ORDER[a.portal] - PORTAL_ORDER[b.portal]);
}
