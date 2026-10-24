<!--
  A box of entries that carry a value (Kompetenzen with their years, Sprachen with their
  level; the Profil): its rows ARE the entries, inside a group's box of rows (Group `rows`),
  48 high, 20 at the sides, a hairline between them. A row holds the entry's name (text a user
  would copy), its value (`value`: the control the caller puts there, a years field or a
  level's select, 26 high, read like quiet text: its edge shows only while the row is under
  the pointer or holds the focus) and the remove slot at the end (24, the × with the tooltip
  "Entfernen"), whose × comes in with the pointer or the focus.
  The last row adds an entry: the navy quiet button with its + (`addLabel`). A click puts the
  caller's field (`add`, a tag field or a search list) in its place with the caret; what it
  takes becomes a row and it stays ready for the next. Esc (once the field has no list to
  close and nothing typed: input.ts, the add row's own form keys), or leaving it empty, puts
  the button back. Under it the box's last lines (`foot`: what was wrong, "Häufig verlangt").
  A new row rises in, a removed one folds away while the rows below close the gap; a list
  that comes with its view is simply there.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
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
    /** The item's value: a control of the row (26 high). */
    value?: Snippet<[T, number]> | null;
    /** The words of the button that adds an entry ("Kompetenz hinzufügen"). */
    addLabel: string;
    /** The field that adds an entry, in the button's place once it is pressed. */
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
    addLabel,
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

  let row = $state<HTMLElement | null>(null);
  /** The add row holds the field (else the button). */
  let adding = $state(false);

  /** The button's place: the field, with the caret. */
  async function open(): Promise<void> {
    adding = true;
    await tick();
    row?.querySelector('input')?.focus();
  }

  /** The button again; from the keyboard it takes the focus. */
  async function close(focus: boolean): Promise<void> {
    adding = false;
    if (!focus) return;
    await tick();
    row?.querySelector('button')?.focus();
  }

  /** Leaving the field: once what was typed is taken and the field is empty, the button. */
  async function focusout(event: FocusEvent & { currentTarget: HTMLElement }): Promise<void> {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    await tick();
    // The button that opened the field went (its focus with it); the field has it now.
    if (row?.contains(document.activeElement)) return;
    if (adding && (row?.querySelector('input')?.value ?? '') === '') adding = false;
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
          {#if value}<span class="value">{@render value(item, index)}</span>{/if}
          <button
            type="button"
            class="remove"
            aria-label={t.chips.remove(name(item))}
            data-remove
            data-testid={testid ? `${testid}-remove` : undefined}
            use:tooltip={t.common.remove}
            onclick={(event) => removeBy(event.currentTarget, () => onremove(item, index))}
          >
            <Icon name="close" size="xs" />
          </button>
        </div>
      </div>
    {/each}
  </div>
  <div
    class="add"
    class:adding
    role="presentation"
    bind:this={row}
    data-remove-fallback
    use:formKeys={{ cancel: () => void close(true) }}
    onfocusout={(event) => void focusout(event)}
  >
    {#if adding}
      {@render add()}
    {:else}
      <Button
        variant="add"
        icon="add"
        label={addLabel}
        testid={testid ? `${testid}-add` : null}
        onclick={() => void open()}
      />
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

  /* The row folds away as one: its height lives in its line. */
  .item {
    --inline-edge: transparent;
  }

  .item + .item,
  .add {
    border-top: var(--border-width) solid var(--border);
  }

  .list:not(:has(.item)) + .add {
    border-top: 0;
  }

  .item:hover,
  .item:focus-within {
    --inline-edge: var(--border-strong);
  }

  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto var(--item-remove);
    align-items: center;
    gap: var(--item-row-gap);
    min-height: var(--item-row-min);
    padding: 0 var(--card-pad-x);
  }

  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
    font: var(--type-md);
  }

  .value {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    color: var(--text-muted);
    font: var(--type-md);
  }

  /* The quiet × of a row: it comes in with the pointer or the focus, the subtle glyph, a wash
     and ink under the pointer. */
  .remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--item-remove);
    height: var(--item-remove);
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

  /* The add row: the button 10 in so its + stands on the names' edge, or the field across the
     row. */
  .add {
    display: flex;
    align-items: center;
    min-height: var(--item-row-min);
    padding: var(--item-add-pad-y) var(--card-pad-x);
  }

  .add:not(.adding) {
    padding-left: calc(var(--card-pad-x) - var(--space-10));
  }

  .add > :global(:not(.btn)) {
    flex: 1;
    min-width: 0;
  }
</style>
