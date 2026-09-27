// The two menus of the list header (ListHeader.svelte) as the list stands now: the funnel's
// "Sortieren und filtern" and the "Zeitraum" of the chevron beside "Postfach abrufen". Both
// read the tables (lib/state/filter.ts, FETCH_RANGES) and the catalog; the header opens them.

import { t } from '$lib/i18n/t';
import type { Portal } from '$lib/ipc/types';
import { app, FETCH_RANGES } from '$lib/state/app.svelte';
import { FILTER_GROUPS, NO_FILTER, offeredEntries, SORTS, sortEntryId } from '$lib/state/filter';
import { jobs } from '$lib/state/jobs.svelte';
import type { MenuEntry } from '$lib/state/menu.svelte';

/**
 * The entries of the funnel's menu: "Sortierung" first (without a usable profile only by
 * date, saying why), then the table's groups in their order behind a line, each under its
 * heading where it has one: the chosen entry checked, a second choice turns it off (the
 * choices of a group are radio items, a group of one is a switch, and switches follow each
 * other on one line); a group the menu offers nothing of (no pay floor in the profile) is
 * left out; every choice keeps the menu open. The way back at the end, off while no filter
 * is on (the order does not count). `portals`: the portals the menu offers, in the UI's
 * order.
 */
export function funnelEntries(portals: readonly Portal[]): MenuEntry[] {
  const filter = jobs.filter;
  const context = jobs.context;
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
    const offered = offeredEntries(group, portals, context);
    if (offered.length === 0) continue;
    const toggle = offered.length === 1 && group.heading === null;
    if (!(toggle && switched)) entries.push({ kind: 'separator' });
    switched = toggle;
    if (group.heading !== null) entries.push({ kind: 'heading', label: group.heading(t) });
    const reason = app.hasProfile ? null : (group.needsProfile?.(t) ?? null);
    for (const entry of offered) {
      const on = filter[group.key] === entry.value;
      entries.push({
        id: entry.id,
        label: entry.label(t),
        checked: on,
        toggle,
        disabled: reason !== null,
        reason,
        stays: true,
        run: () => jobs.setFilter({ [group.key]: on ? null : entry.value }),
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
