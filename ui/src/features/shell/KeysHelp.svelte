<!--
  The card of the keys: Ctrl+/ (Cmd+/ on macOS) opens it from anywhere, the same keys, Esc
  or its button close it (a modal dialog, lib/input/input.ts). Two short lists, what a key
  does on the left and the key on the right, named as the OS names it (keyLabel: "Strg+F",
  "⌘F"); only keys the app has on this OS (the Menu key is Windows').
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { keyConventions, keyLabel } from '$lib/platform';
  import { help } from '$lib/state/help.svelte';

  interface Row {
    id: string;
    label: string;
    keys: string;
  }

  const os = keyConventions();
  const mac = os.command === 'metaKey';
  const k = $derived(t.keysHelp);
  const everywhere = $derived<Row[]>([
    {
      id: 'views',
      label: k.views,
      keys: k.range(keyLabel('mod+1'), keyLabel('mod+4')),
    },
    { id: 'search', label: k.search, keys: keyLabel('mod+f') },
    { id: 'fetch', label: k.fetch, keys: mac ? keyLabel('mod+r') : 'F5' },
    { id: 'undo', label: k.undo, keys: keyLabel('mod+z') },
    ...(os.contextMenuKey ? [{ id: 'menu', label: k.menu, keys: keyLabel('shift+f10') }] : []),
    { id: 'back', label: k.back, keys: keyLabel(os.back === 'alt' ? 'alt+left' : 'mod+[') },
    { id: 'help', label: k.help, keys: keyLabel('mod+/') },
  ]);
  const list = $derived<Row[]>([
    { id: 'step', label: k.step, keys: `${keyLabel('up')} ${keyLabel('down')}` },
    { id: 'edge', label: k.edge, keys: `${keyLabel('home')} ${keyLabel('end')}` },
    {
      id: 'extend',
      label: k.extend,
      keys: `${keyLabel('shift+up')} ${keyLabel('shift+down')}`,
    },
    { id: 'archive', label: k.archive, keys: 'E' },
    { id: 'trash', label: k.trash, keys: keyLabel('del') },
    { id: 'star', label: k.star, keys: 'S' },
    { id: 'unread', label: k.unread, keys: 'U' },
    { id: 'openAd', label: k.openAd, keys: 'O' },
    { id: 'close', label: k.closeJob, keys: keyLabel('esc') },
  ]);
</script>

{#snippet group(heading: string, rows: Row[])}
  <section class="group">
    <h3 class="title">{heading}</h3>
    <dl class="rows">
      {#each rows as row (row.id)}
        <div class="row" data-testid="key-{row.id}">
          <dt class="what">{row.label}</dt>
          <dd class="keys">{row.keys}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/snippet}

<Dialog
  bind:open={help.open}
  heading={k.heading}
  confirmLabel={k.close}
  alone
  testid="keys-help"
  onconfirm={() => help.hide()}
>
  <div class="card">
    {@render group(k.everywhere, everywhere)}
    {@render group(k.list, list)}
  </div>
</Dialog>

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
