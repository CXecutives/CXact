<!--
  A list of items that carry a value (Kompetenzen with their years, Sprachen with their
  level; the round 10 draft): one bordered box, 10 round (its edge red in a required cell that
  is still empty, `[data-missing]`), a hairline between its rows. A row
  is 38 high: the item's name (text a user would copy), its value (`value`: the control the
  caller puts there, a years field or a level's select, 26 high) and the remove button at
  the end (24, the × with the tooltip "Entfernen"). The last row adds an item: a 16 px plus
  and the caller's quiet field (`add`: a search list or a tag field without its edge). A new
  row rises in, a removed one folds away while the rows below close the gap; a list that
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

<div class="list" data-testid={testid ?? undefined}>
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
  {#if add}
    <div class="add">
      <span class="plus"><Icon name="add" size="sm" /></span>
      <span class="field">{@render add()}</span>
    </div>
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: var(--border-width) solid var(--item-list-edge);
    border-radius: var(--radius-lg);
    background-color: var(--surface);
  }

  .item,
  .add {
    display: flex;
    align-items: center;
    gap: var(--item-gap);
    min-height: var(--list-item);
  }

  .item {
    padding: var(--item-pad-y) var(--item-pad-end) var(--item-pad-y) var(--item-pad-start);
  }

  .item + .item,
  .item + .add {
    border-top: var(--border-width) solid var(--border);
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

  /* The quiet × of a row: the subtle glyph, a wash and ink under the pointer. */
  .remove {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--item-remove);
    height: var(--item-remove);
    padding: 0;
    border: 0;
    border-radius: var(--radius-inner);
    background-color: transparent;
    color: var(--icon-subtle);
    transition:
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
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

  /* The add row: the plus where the names start, the caller's field beside it. */
  .add {
    gap: var(--space-8);
    padding-inline: var(--item-pad-start) var(--item-pad-end);
  }

  .plus {
    display: inline-flex;
    flex: none;
    color: var(--icon-subtle);
  }

  .field {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
  }
</style>
