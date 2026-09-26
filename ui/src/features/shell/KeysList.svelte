<!--
  The keys of the app as lib/input/keys.ts has them, in two short lists by where they work
  (Überall, In der Jobliste): what a key does on the left, the key on the right, named as the
  OS names it (keyLabel: "Strg+F", "⌘F"); only keys the app has on this OS (the Menu key is
  Windows'). The card of the keys (KeysHelp) shows it; so may any view that lists the keys.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { SHORTCUTS, type Shortcut, type ShortcutScope } from '$lib/input/keys';
  import { keyConventions, keyLabel } from '$lib/platform';

  interface Row {
    id: string;
    label: string;
    keys: string;
  }

  const os = keyConventions();

  /** How the card writes a row's keys: the first, the first two, or first to last. */
  function written(row: Shortcut): string {
    const keys = row.keys(os).map(keyLabel);
    if (row.shows === 'range') return t.keysHelp.range(keys[0] ?? '', keys.at(-1) ?? '');
    if (row.shows === 'pair') return keys.slice(0, 2).join(' ');
    return keys[0] ?? '';
  }

  const rowsOf = (scope: ShortcutScope): Row[] =>
    SHORTCUTS.filter(
      (row) => row.scope === scope && row.label !== null && row.keys(os).length > 0,
    ).map((row) => ({ id: row.action, label: row.label?.() ?? '', keys: written(row) }));

  const groups = $derived([
    { id: 'everywhere', heading: t.keysHelp.everywhere, rows: rowsOf('everywhere') },
    { id: 'list', heading: t.keysHelp.list, rows: rowsOf('list') },
  ]);
</script>

<div class="card">
  {#each groups as group (group.id)}
    <section class="group" data-testid="keys-{group.id}">
      <h3 class="title">{group.heading}</h3>
      <dl class="rows">
        {#each group.rows as row (row.id)}
          <div class="row" data-testid="key-{row.id}">
            <dt class="what">{row.label}</dt>
            <dd class="keys">{row.keys}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .title {
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-semibold);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-16);
    padding: var(--space-4) 0;
    border-bottom: var(--border-width) solid var(--border);
  }

  .row:last-child {
    border-bottom: 0;
  }

  .what {
    color: var(--text);
    font: var(--type-md);
  }

  .keys {
    flex: none;
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
  }
</style>
