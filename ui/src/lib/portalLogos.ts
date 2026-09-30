// The portals' own marks (user, 2026-09-30), taken from their sites' icons and set as full
// squares of one size: the settings' portal rows show them in place of a monogram.

import freelance from '../assets/portals/freelance.png';
import freelancermap from '../assets/portals/freelancermap.png';
import linkedin from '../assets/portals/linkedin.png';
import type { Portal } from './ipc/types';

export const PORTAL_LOGO: Readonly<Record<Portal, string>> = {
  linkedin,
  freelancermap,
  freelance,
};
