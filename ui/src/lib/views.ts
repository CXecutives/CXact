// The four views of the app, in the sidebar's order: the one table for the sidebar's entries
// (features/shell/Sidebar.svelte), the order of the navigation (VIEW_IDS) and the keys that
// choose them (Ctrl/Cmd+1 to 4, lib/input/keys.ts). Change a view's name, icon or key here.

import type { IconName } from '../components/Icon.svelte';
import type { Catalog } from './i18n/de';

export type ViewId = 'overview' | 'jobs' | 'profile' | 'settings';

export interface ViewEntry {
  id: ViewId;
  /** Its name in the catalog (t.nav). */
  label: keyof Catalog['nav'];
  /** Its icon meaning (lib/icons.ts). */
  icon: IconName;
  /** The key that chooses it from anywhere (a combo of platform.ts keyLabel). */
  keys: string;
}

export const VIEWS: readonly ViewEntry[] = [
  { id: 'overview', label: 'overview', icon: 'overview', keys: 'mod+1' },
  { id: 'jobs', label: 'jobs', icon: 'jobs', keys: 'mod+2' },
  { id: 'profile', label: 'profile', icon: 'profile', keys: 'mod+3' },
  { id: 'settings', label: 'settings', icon: 'settings', keys: 'mod+4' },
];
