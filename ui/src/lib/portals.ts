// The order in which the UI shows the sources (user decision 2026-10-04, by size): the ones
// the app searches first (freelancermap, GULP, Hays, SOLCOM, Michael Page, Amadeus Fire,
// interim-x, FRATCH), then the ones of alert mails only (LinkedIn, freelance.de).
// A table of the UI, not core's `Portal::ALL` (the order the backend works in): Einstellungen
// and the setup list them in this order.

import type { Portal } from './ipc/types';

export const PORTAL_ORDER: readonly Portal[] = [
  'freelancermap',
  'gulp',
  'hays',
  'solcom',
  'michaelpage',
  'amadeusfire',
  'interimx',
  'fratch',
  'linkedin',
  'freelance',
];

/** A portal's mark on its tile: always two capitals, brand-neutral (design round 4). */
export const PORTAL_MARK: Readonly<Record<Portal, string>> = {
  hays: 'HA',
  freelancermap: 'FM',
  michaelpage: 'MP',
  solcom: 'SO',
  gulp: 'GU',
  amadeusfire: 'AF',
  interimx: 'IX',
  fratch: 'FR',
  linkedin: 'LI',
  freelance: 'FD',
};

/** Items of the portals (their states, their counts) in the UI's order. */
export function inPortalOrder<Item extends { portal: Portal }>(items: readonly Item[]): Item[] {
  return [...items].sort((a, b) => PORTAL_ORDER.indexOf(a.portal) - PORTAL_ORDER.indexOf(b.portal));
}
