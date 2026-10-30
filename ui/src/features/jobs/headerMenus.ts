// The funnel's menu of the list header (ListHeader.svelte), "Sortieren und filtern", as the
// list stands now. It reads the table (lib/state/filter.ts) and the catalog; the header opens
// it.

import { t } from '$lib/i18n/t';
import type { Portal } from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { chooseIn, chosenOf, FILTER_GROUPS, SORTS, sortEntryId } from '$lib/state/filter';
import { jobs } from '$lib/state/jobs.svelte';
import type { MenuEntry } from '$lib/state/menu.svelte';

/**
 * The entries of the funnel's menu: "Sortierung" first (without a usable profile only by
 * date, saying why), then the table's groups in their order behind a line, each under its
 * heading where it has one: the chosen entries checked, a second click turns one off (the
 * choices of Portal and Übereinstimmung are check items, several at once; those of another
 * group radio items; a group of one is a switch, and switches follow each other on one
 * line); a group without entries (no portal) is left out; every choice keeps the menu open, and
 * its height stays (a filter goes with its chip's ×). `portals`: the portals the menu offers, in
 * the UI's order.
 */
export function funnelEntries(portals: readonly Portal[]): MenuEntry[] {
  const filter = jobs.filter;
  const noProfile = app.hasProfile ? null : t.toolbar.sortNoProfile;
  const entries: MenuEntry[] = [{ kind: 'heading', label: t.toolbar.sortHeading }];
  for (const sort of SORTS) {
    entries.push({
      id: sortEntryId(sort),
      label: t.toolbar.sortLabel[sort],
      checked: jobs.sort === sort,
      disabled: noProfile !== null,
      reason: noProfile,
      stays: true,
      run: () => jobs.setSort(sort),
    });
  }
  let switched = false;
  for (const group of FILTER_GROUPS) {
    const offered = group.entries(portals);
    if (offered.length === 0) continue;
    const toggle = group.multi || (offered.length === 1 && group.heading === null);
    const chosen = chosenOf(filter, group);
    const single = offered.length === 1 && group.heading === null;
    if (!(single && switched)) entries.push({ kind: 'separator' });
    switched = single;
    if (group.heading !== null) entries.push({ kind: 'heading', label: group.heading(t) });
    const reason = app.hasProfile ? null : (group.needsProfile?.(t) ?? null);
    for (const entry of offered) {
      const on = chosen.includes(entry.value);
      entries.push({
        id: entry.id,
        label: entry.label(t),
        checked: on,
        toggle,
        disabled: reason !== null,
        reason,
        stays: true,
        run: () => jobs.setFilter(chooseIn(jobs.filterChoice, group, entry.value)),
      });
    }
  }
  return entries;
}
