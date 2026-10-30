<!--
  The entries of a list that carry a value (Kompetenzen with their years, Sprachen with their
  level; the Profil), as rows like every field of a group (owner, 2026-10-29, "A Zeilen"):
  inside a group's box of rows (Group `rows`), at least as high as a field's row, 12 20 inside,
  a hairline between them. A row holds the entry's name in the label's column (14/540, text a
  user would copy), its value in the control's column (`value`: the caller's field, a years
  field or a level's select, as wide as the same kind of field elsewhere) and at the end the
  quiet × ("Entfernen", 28).
  The last row is the button that adds an entry ("+ Kompetenz hinzufügen", owner 2026-10-30,
  no field standing open). Pressed, its row becomes the new entry's: the caller's field for the
  name (`draft`) in the names' column and the × that closes it again. No caret goes there by
  itself (owner, 2026-10-30), a press on the field does it. What the field takes becomes a row
  above it and it stays ready for the next; left empty it turns back into the button. Under it
  the box's last lines (`foot`: what was wrong). A new row rises in, a removed one folds away
  while the rows below close the gap; a list that comes with its view is simply there.
-->
<script lang="ts" generics="T">
  import { tick, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { formKeys, removeBy } from '$lib/input/input';
  import { rowCollapse, rowEnter } from '$lib/motion/transitions';
  import { settled } from '$lib/motion/settled.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    items: readonly T[];
    /** A key that names the item for as long as it is in the list. */
    key: (item: T) => string;
    /** The item's name. */
    name: (item: T) => string;
    /** The item's value: a field of the row. */
    value?: Snippet<[T, number]> | null;
    /** The words of the button that adds an entry. */
    addLabel: string;
    /** The field for a new entry's name. */
    draft: Snippet;
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
    addLabel,
    draft,
    foot = null,
    onremove,
    testid = null,
  }: Props = $props();

  const motion = settled();

  /** A row added while the list is on screen rises in (one that comes with the list is there). */
  const arrive: Action<HTMLElement> = (node) => {
    if (motion.ready) rowEnter(node);
  };

  /** The add row stands as the new entry's row. */
  let adding = $state(false);
  let addRow = $state<HTMLElement | null>(null);

  /** The button goes: its row keeps the keyboard's focus, no caret (Tab goes on to the field). */
  async function add(): Promise<void> {
    adding = true;
    await tick();
    addRow?.focus({ preventScroll: true });
  }

  function close(): void {
    adding = false;
  }

  /** A field left empty turns back into the button (what it took is a row by then). */
  function left(event: FocusEvent): void {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    void tick().then(() => {
      if (field.value.trim() === '') close();
    });
  }
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
  <div
    class="line add"
    tabindex="-1"
    role="group"
    bind:this={addRow}
    data-remove-fallback
    data-testid={testid ? `${testid}-add` : undefined}
    use:formKeys={adding ? { cancel: close } : {}}
    onfocusout={adding ? left : undefined}
  >
    {#if adding}
      <span class="draft">{@render draft()}</span>
      <button
        type="button"
        class="remove"
        aria-label={t.common.remove}
        data-testid={testid ? `${testid}-draft-close` : undefined}
        use:tooltip={t.common.remove}
        onclick={close}
      >
        <Icon name="close" size="sm" />
      </button>
    {:else}
      <span class="plus">
        <Button
          variant="ghost"
          icon="add"
          label={addLabel}
          testid={testid ? `${testid}-add-button` : null}
          onclick={() => void add()}
        />
      </span>
    {/if}
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

  /* The new entry's name field in the names' column, its × at the end. */
  .draft {
    display: block;
    min-width: 0;
  }

  .add .remove {
    grid-column: -2 / -1;
  }

  /* The button's glyph on the names' left edge. */
  .plus {
    display: flex;
    grid-column: 1 / -1;
    margin-left: calc(-1 * var(--ghost-inset));
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

    .value {
      grid-column: 1;
    }
  }
</style>
