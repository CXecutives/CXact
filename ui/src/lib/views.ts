// The views of the app, in the sidebar's order: the one table for the sidebar's entries
// (features/shell/Sidebar.svelte) and the order of the navigation (VIEW_IDS). Change a view's
// name or icon here.

import type { IconMeaning } from './icons';
import type { Catalog } from './i18n/de';

export type ViewId = 'overview' | 'jobs' | 'profile' | 'settings';

export interface ViewEntry {
  id: ViewId;
  /** Its name in the catalog (t.nav). */
  label: keyof Catalog['nav'];
  /** Its icon meaning (lib/icons.ts). */
  icon: IconMeaning;
}

export const VIEWS: readonly ViewEntry[] = [
  { id: 'overview', label: 'overview', icon: 'overview' },
  { id: 'jobs', label: 'jobs', icon: 'jobs' },
  { id: 'profile', label: 'profile', icon: 'profile' },
  { id: 'settings', label: 'settings', icon: 'settings' },
];
