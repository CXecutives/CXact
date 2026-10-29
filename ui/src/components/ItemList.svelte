<!--
  The entries of a list that carry a value (Kompetenzen with their years, Sprachen with their
  level; the Profil), as rows like every field of a group (owner, 2026-10-29, "A Zeilen"):
  inside a group's box of rows (Group `rows`), at least as high as a field's row, 12 20 inside,
  a hairline between them. A row holds the entry's name in the label's column (14/540, text a
  user would copy), its value in the control's column (`value`: the caller's field, a years
  field or a level's select, as wide as the same kind of field elsewhere) and at the end the
  quiet × ("Entfernen", 28).
  The last row adds an entry: the caller's field (`add`, a tag field or a closed list that
  opens nothing on focus) in the control's column, always there like every tag field; what it
  takes becomes a row and it stays ready for the next. Under it the box's last lines (`foot`:
  what was wrong). A new row rises in, a removed one folds away while the rows below close
  the gap; a list that comes with its view is simply there.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { removeBy } from '$lib/input/input';
  import { rowCollapse, rowEnter } from '$lib/motion/transitions';
  import { settled } from '$lib/motion/settled.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    items: readonly T[];
    /** A key that names the item for as long as it is in the list. */
    key: (item: T) => string;
    /** The item's name. */
    name: (item: T) => string;
    /** The item's value: a field of the row. */
    value?: Snippet<[T, number]> | null;
    /** The field that adds an entry, in the last row. */
    add: Snippet;
    /** The box's last lines, under the add row. */
    foot?: Snippet | null;
    onremove: (item: T, index: number) => void;
    testid?: string | null;
  }

  let {
    items,
    key,
    name,
    value = null,
    add,
    foot = null,
    onremove,
    testid = null,
  }: Props = $props();

  const motion = settled();

  /** A row added while the list is on screen rises in (one that comes with the list is there). */
  const arrive: Action<HTMLElement> = (node) => {
    if (motion.ready) rowEnter(node);
  };
</script>

<div class="items" data-removes>
  <div class="list" data-testid={testid ?? undefined}>
    {#each items as item, index (key(item))}
      <div
        class="item"
        data-testid={testid ? `${testid}-item` : undefined}
        use:arrive
        out:rowCollapse={{ on: motion.ready }}
      >
        <div class="line">
          <span class="name" data-copy>{name(item)}</span>
          <span class="value"
            >{#if value}{@render value(item, index)}{/if}</span
          >
          <button
            type="button"
            class="remove"
            aria-label={t.chips.remove(name(item))}
            data-remove
            data-testid={testid ? `${testid}-remove` : undefined}
            use:tooltip={t.common.remove}
            onclick={(event) => removeBy(event.currentTarget, () => onremove(item, index))}
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
      </div>
    {/each}
  </div>
  <div class="line add" data-remove-fallback data-testid={testid ? `${testid}-add` : undefined}>
    <span></span>
    <span class="field">{@render add()}</span>
    <span></span>
  </div>
  {#if foot}{@render foot()}{/if}
</div>

<style>
  .items {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .item + .item,
  .add {
    border-top: var(--border-width) solid var(--border);
  }

  .list:not(:has(.item)) + .add {
    border-top: 0;
  }

  /* A field's row: the name in the label's column, the value, the × at the end. */
  .line {
    display: grid;
    grid-template-columns: var(--profile-label-width) minmax(0, 1fr) var(--control-icon);
    align-items: center;
    gap: var(--space-8) var(--profile-label-gap);
    min-height: var(--form-row-min);
    padding: var(--form-row-pad-y) var(--form-row-pad-x);
  }

  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    font: var(--type-label);
  }

  .value {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  /* The add field fills the control's column like every tag field. */
  .field {
    display: block;
    min-width: 0;
  }

  /* The quiet × of a row, like every quiet icon button: the subtle glyph, a wash and ink
     under the pointer. */
  .remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-icon);
    height: var(--control-icon);
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
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

  /* A narrow box: the name above its value, like a field's label. */
  @container (width < 560px) {
    .line {
      grid-template-columns: minmax(0, 1fr) var(--control-icon);
    }

    .value,
    .field {
      grid-column: 1;
    }

    .add > :first-child,
    .add > :last-child {
      display: none;
    }
  }
</style>
