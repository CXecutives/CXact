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
  name (`draft`) in the names' column and the × that closes it again and takes back what was
  typed, like Esc. No caret goes there by itself (owner, 2026-10-30), a press on the field does
  it. What the field takes becomes a row above it and it stays ready for the next; left empty
  it turns back into the button. What is wrong with a row (`failure`) stands under its value,
  without a row under the add row, in the look of every refused value. A control stands 16
  under the line, so a message only grows its row downward. A new row rises in, a removed one
  folds away while the rows below close the gap; a list that comes with its view is simply
  there.
-->
<script lang="ts" generics="T">
  import { tick, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { afterPress, formKeys, removeBy } from '$lib/input/input';
  import { rowCollapse, rowEnter } from '$lib/motion/transitions';
  import { settled } from '$lib/motion/settled.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Notice from './Notice.svelte';

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
    /** What is wrong: under this item's value, or under the add row (`item` null). */
    failure?: { item: T | null; text: string } | null;
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
    failure = null,
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

  /** The row closes; a focus inside it goes to the button that takes its place, no further. */
  function close(): void {
    const inside = addRow?.contains(document.activeElement) ?? false;
    adding = false;
    if (inside) {
      void tick().then(() => addRow?.querySelector('button')?.focus({ preventScroll: true }));
    }
  }

  /** The ×: the row closes and what was typed goes with it. The press left the field its caret
   *  (`data-keep-focus`), and it is emptied first: a field takes its text when it is left, also
   *  by going away (Chromium blurs it on its way out). */
  function takeBack(): void {
    const field = addRow?.querySelector('input');
    if (field) {
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    close();
  }

  /** The focus left the row with its field empty: it turns back into the button (what the field
   *  took is a row by then). Tab goes on from the field to the ×, a window in front changes nothing. */
  function left(event: FocusEvent): void {
    const from = event.target;
    const next = event.relatedTarget;
    // The button that opened the row goes with the opening: that is no leaving.
    if (from instanceof HTMLButtonElement && from.dataset.keepFocus === undefined) return;
    if (next instanceof Node && addRow?.contains(next)) return;
    afterPress(from, () => {
      void tick().then(() => {
        const field = addRow?.querySelector('input');
        if (field && field.value.trim() === '') close();
      });
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
          <span class="value">
            {#if value}{@render value(item, index)}{/if}
            {#if failure !== null && failure.item === item}
              <Notice
                tone="danger"
                text={failure.text}
                testid={testid ? `${testid}-error` : null}
              />
            {/if}
          </span>
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
        data-keep-focus
        data-testid={testid ? `${testid}-draft-close` : undefined}
        use:tooltip={t.common.remove}
        onclick={takeBack}
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
  {#if failure !== null && failure.item === null}
    <div class="foot">
      <Notice tone="danger" text={failure.text} testid={testid ? `${testid}-error` : null} />
    </div>
  {/if}
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

  /* A hairline from the text between the rows, like the rows of Einstellungen. */
  .item,
  .add {
    position: relative;
  }

  .item + .item::before,
  .add::before {
    position: absolute;
    top: 0;
    right: 0;
    left: var(--setting-rule-start);
    height: var(--border-width);
    background-color: var(--border);
    content: '';
  }

  .list:not(:has(.item)) + .add::before {
    content: none;
  }

  /* A field's row: the name in the label's column, the value, the × at the end, all on the
     height of a field, so a message under the value moves nothing beside it. */
  .line {
    display: grid;
    grid-template-columns: var(--profile-label-width) minmax(0, 1fr) var(--control-icon);
    align-items: start;
    gap: var(--space-8) var(--profile-label-gap);
    min-height: var(--form-row-min);
    padding: var(--form-row-control-y) var(--form-row-pad-x);
  }

  /* Its first line on the field's line, like a field's label; a long name grows downward. */
  .name {
    min-width: 0;
    padding-top: calc((var(--control-field) - var(--leading-md)) / 2);
    overflow-wrap: anywhere;
    font: var(--type-label);
  }

  .value {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--label-gap);
    min-width: 0;
    min-height: var(--control-field);
  }

  /* Under the add row, on the rows' sides. */
  .foot {
    padding: 0 var(--form-row-pad-x) var(--form-row-pad-y);
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
     under the pointer. Centred on the field's height, its glyph ends on the content's edge. */
  .remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    justify-self: end;
    width: var(--control-icon);
    height: var(--control-icon);
    margin-block: calc((var(--control-field) - var(--control-icon)) / 2);
    margin-inline-end: calc(-1 * var(--tool-hang));
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

    .name {
      padding-top: 0;
    }

    .value {
      grid-column: 1;
    }
  }
</style>
