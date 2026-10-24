<!--
  A list of items that carry a value (Kompetenzen with their years, Sprachen with their
  level): a quiet list like the rows of Einstellungen (owner, 2026-10-24), no box, a hairline
  above, between and below its rows. A row is 40 high: the item's name (text a user would
  copy), its value (`value`: the control the caller puts there, a years field or a level's
  select, 26 high, whose edge shows only while the row is under the pointer or holds the
  focus) and the remove button at the end (24, the × with the tooltip "Entfernen"), which
  comes in with the pointer or the focus. Under the list the field that adds an item (`add`:
  the caller's search list or tag field, a normal field like every other one of the page). A
  new row rises in, a removed one folds away while the rows below close the gap; a list that
  comes with its view is simply there.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { rowCollapse, rowEnter } from '$lib/motion/transitions';
  import { settled } from '$lib/motion/settled.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    items: readonly T[];
    /** A key that names the item for as long as it is in the list. */
    key: (item: T) => string;
    /** The item's name. */
    name: (item: T) => string;
    /** The item's value: a control of the row (26 high). */
    value?: Snippet<[T, number]> | null;
    /** The field that adds an item, in the last row. */
    add?: Snippet | null;
    onremove: (item: T, index: number) => void;
    testid?: string | null;
  }

  let { items, key, name, value = null, add = null, onremove, testid = null }: Props = $props();

  const motion = settled();

  /** A row added while the list is on screen rises in (one that comes with the list is there). */
  const arrive: Action<HTMLElement> = (node) => {
    if (motion.ready) rowEnter(node);
  };
</script>

<div class="list" class:empty={items.length === 0} data-testid={testid ?? undefined}>
  {#each items as item, index (key(item))}
    <div
      class="item"
      data-testid={testid ? `${testid}-item` : undefined}
      use:arrive
      out:rowCollapse={{ on: motion.ready }}
    >
      <span class="name" data-copy>{name(item)}</span>
      {#if value}<span class="value">{@render value(item, index)}</span>{/if}
      <button
        type="button"
        class="remove"
        aria-label={t.chips.remove(name(item))}
        data-testid={testid ? `${testid}-remove` : undefined}
        use:tooltip={t.common.remove}
        onclick={() => onremove(item, index)}
      >
        <Icon name="close" size="xs" />
      </button>
    </div>
  {/each}
</div>
{#if add}<div class="add">{@render add()}</div>{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .list:not(.empty) {
    border-block: var(--border-width) solid var(--item-list-edge);
  }

  .item {
    --inline-edge: transparent;
    display: flex;
    align-items: center;
    gap: var(--item-gap);
    min-height: var(--list-item);
    padding-block: var(--item-pad-y);
  }

  .item + .item {
    border-top: var(--border-width) solid var(--border);
  }

  .item:hover,
  .item:focus-within {
    --inline-edge: var(--border-strong);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font: var(--type-md);
  }

  .value {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-6);
    color: var(--text-muted);
    font: var(--type-md);
  }

  /* The quiet × of a row: it comes in with the pointer or the focus, the subtle glyph, a wash
     and ink under the pointer. */
  .remove {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--item-remove);
    height: var(--item-remove);
    margin-inline-end: calc(-1 * var(--space-4));
    padding: 0;
    border: 0;
    border-radius: var(--radius-inner);
    background-color: transparent;
    color: var(--icon-subtle);
    opacity: 0;
    transition:
      opacity var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .item:hover .remove,
  .item:focus-within .remove {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  .remove:hover {
    background-color: var(--quiet-hover);
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .remove:active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  /* The field that adds an item, under the list like every field of the page. */
  .add {
    display: flex;
    margin-top: var(--space-8);
  }

  .list.empty + .add {
    margin-top: 0;
  }

  .add > :global(*) {
    flex: 1;
    min-width: 0;
  }
</style>
