// The two menus of the list header (ListHeader.svelte) as the list stands now: the funnel's
// "Sortieren und filtern" and "Abruf einstellen" of the icon button beside the fetch (what it
// reads). Both read the tables (lib/state/filter.ts, FETCH_WAYS) and the catalog; the header
// opens them.

import { t } from '$lib/i18n/t';
import type { Portal } from '$lib/ipc/types';
import { app, FETCH_WAYS } from '$lib/state/app.svelte';
import {
  chooseIn,
  chosenOf,
  FILTER_GROUPS,
  NO_FILTER,
  SORTS,
  sortEntryId,
} from '$lib/state/filter';
import { jobs } from '$lib/state/jobs.svelte';
import type { MenuEntry } from '$lib/state/menu.svelte';

/**
 * The entries of the funnel's menu: "Sortierung" first (without a usable profile only by
 * date, saying why), then the table's groups in their order behind a line, each under its
 * heading where it has one: the chosen entries checked, a second click turns one off (the
 * choices of Quelle and Übereinstimmung are check items, several at once; those of another
 * group radio items; a group of one is a switch, and switches follow each other on one
 * line); a group without entries (no portal) is left out; every choice keeps the menu open. The way back at the end, off while no filter is on (the order does not
 * count). `portals`: the portals the menu offers, in the UI's order.
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
 * "Abruf einstellen": what the fetch reads (user decision 2026-10-01), the search and the
 * alert mails, only the search or only the mailbox, the current one checked. A choice is
 * saved at once (lib/state/app.svelte.ts) and names the button; a save that failed says so
 * under the header. The Zeitraum of the mails is in Einstellungen.
 */
export function wayEntries(): MenuEntry[] {
  const current = app.fetchWay;
  return FETCH_WAYS.map((way): MenuEntry => ({
    id: `way-${way}`,
    label: t.toolbar.wayName[way],
    checked: current === way,
    run: () =>
      void app.setFetchWay(way).then((error) => {
        if (error !== null) jobs.actionError = error;
      }),
  }));
}

/** The fetch's words and glyph as its menu chose (user decision 2026-10-01): "Jobs abrufen"
 *  the search and the alert mails, "Jobs suchen" only the search, "Postfach abrufen" only
 *  the mailbox (the glyph of every fetch, not the mail's). */
export function fetchLook(): { label: string; icon: 'fetch' | 'search' } {
  const way = app.fetchWay;
  if (way === 'search') return { label: t.toolbar.searchNow, icon: 'search' };
  return { label: way === 'mail' ? t.toolbar.fetchMailbox : t.toolbar.fetch, icon: 'fetch' };
}
