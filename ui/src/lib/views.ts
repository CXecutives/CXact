// The three views of the app, in the sidebar's order: the one table for the sidebar's entries
// (features/shell/Sidebar.svelte), the order of the navigation (VIEW_IDS) and the keys that
// choose them (lib/input/keys.ts). Change a view's name, icon or key here.

import type { IconMeaning } from './icons';
import type { Catalog } from './i18n/de';

export type ViewId = 'jobs' | 'profile' | 'settings';

export interface ViewEntry {
  id: ViewId;
  /** Its name in the catalog (t.nav). */
  label: keyof Catalog['nav'];
  /** Its icon meaning (lib/icons.ts). */
  icon: IconMeaning;
  /** The key that chooses it from anywhere (a combo of platform.ts keyLabel). */
  keys: string;
}

export const VIEWS: readonly ViewEntry[] = [
  { id: 'jobs', label: 'jobs', icon: 'jobs', keys: 'mod+1' },
  { id: 'profile', label: 'profile', icon: 'profile', keys: 'mod+2' },
  { id: 'settings', label: 'settings', icon: 'settings', keys: 'mod+3' },
];
