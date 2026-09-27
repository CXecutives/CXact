// The two menus of the list header (ListHeader.svelte) as the list stands now: the funnel's
// "Sortieren und filtern" and the "Zeitraum" of the chevron beside "Postfach abrufen". Both
// read the tables (lib/state/filter.ts, FETCH_RANGES) and the catalog; the header opens them.

import { t } from '$lib/i18n/t';
import type { Portal } from '$lib/ipc/types';
import { app, FETCH_RANGES } from '$lib/state/app.svelte';
import { FILTER_GROUPS, NO_FILTER, SORTS, sortEntryId } from '$lib/state/filter';
import { jobs } from '$lib/state/jobs.svelte';
import type { MenuEntry } from '$lib/state/menu.svelte';

/**
 * The entries of the funnel's menu: "Sortierung" first (without a usable profile only by
 * date, saying why), then the table's groups in their order, each under its heading, the
 * chosen entry checked (a switch of its own without a heading, and a second choice turns it
 * off); every choice keeps the menu open. The way back at the end, off while no filter is on
 * (the order does not count): the menu keeps one height, so it never grows past the window.
 * `portals`: the portals the menu offers, in the UI's order.
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
  for (const group of FILTER_GROUPS) {
    entries.push({ kind: 'separator' });
    const toggle = group.heading === null;
    if (group.heading !== null) entries.push({ kind: 'heading', label: group.heading(t) });
    const reason = app.hasProfile ? null : (group.needsProfile?.(t) ?? null);
    for (const entry of group.entries(portals)) {
      const on = filter[group.key] === entry.value;
      entries.push({
        id: entry.id,
        label: entry.label(t),
        checked: on,
        toggle,
        disabled: reason !== null,
        reason,
        stays: true,
        run: () => jobs.setFilter({ [group.key]: toggle && on ? null : entry.value }),
      });
    }
  }
  entries.push(
    { kind: 'separator' },
    {
      id: 'filter-reset',
      label: t.toolbar.filterReset,
      disabled: !jobs.filtered,
      run: () => jobs.setFilter(NO_FILTER),
    },
  );
  return entries;
}

/**
 * "Zeitraum": which alert mails "Postfach abrufen" reads, the current one checked. A choice is
 * saved at once (lib/state/app.svelte.ts); a save that failed says so under the header.
 */
export function rangeEntries(): MenuEntry[] {
  const current = app.state?.fetchRange ?? null;
  return [
    { kind: 'heading', label: t.toolbar.range },
    ...FETCH_RANGES.map((range): MenuEntry => ({
      id: `range-${range}`,
      label: t.toolbar.rangeName[range],
      checked: current === range,
      run: () =>
        void app.setFetchRange(range).then((error) => {
          if (error !== null) jobs.actionError = error;
        }),
    })),
  ];
}
