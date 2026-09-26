<!--
  The app's keys (lib/input/keys.ts) in their groups, what a key does on the left and the key
  on the right as the OS names it: the card of the keys (Ctrl/Cmd+/) and Einstellungen show
  the same list.
-->
<script lang="ts">
  import { keyGroups } from '$lib/input/keys';

  const groups = $derived(keyGroups());
</script>

<div class="groups" data-testid="key-list">
  {#each groups as group (group.id)}
    <section class="group">
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
  .groups {
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
    font-variant-numeric: var(--numeric);
  }
</style>
