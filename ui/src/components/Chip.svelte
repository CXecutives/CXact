<!--
  A chip (the round 10 draft): a short value on the track, 24 high, its words 13 px in the
  values' weight, and its × ("Entfernen"), a 12 px glyph on a 16 px wash that hits 24 px wide.
  One look for the entries of a tag field (ChipInput) and the filters above the list
  (ListHeader). Only the × removes; a chip's words stay still under the pointer. In a field
  (`inField`) the × is no Tab stop and keeps the focus in the field, its words are text to copy
  (`copy`). A long value wraps at its spaces; a word breaks only when it cannot fit alone.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    /** Its words are a value a user would copy. */
    copy?: boolean;
    /** It stands in a field: the focus stays in the field. */
    inField?: boolean;
    testid?: string | null;
    onremove: (event: MouseEvent) => void;
  }

  let { label, copy = false, inField = false, testid = null, onremove }: Props = $props();
</script>

<span class="chip" data-testid={testid ?? undefined}>
  <span class="text" data-copy={copy ? '' : undefined}>{label}</span>
  <button
    type="button"
    class="remove"
    tabindex={inField ? -1 : undefined}
    data-keep-focus={inField ? '' : undefined}
    data-remove
    aria-label={t.chips.remove(label)}
    data-testid={testid ? `${testid}-remove` : undefined}
    use:tooltip={t.common.remove}
    onclick={onremove}
  >
    <Icon name="close" size="xxs" />
  </button>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    min-height: var(--chip-height);
    padding: 0 var(--chip-pad-end) 0 var(--space-8);
    border-radius: var(--radius-inner);
    background-color: var(--chip-surface);
    color: var(--chip-text);
    font: var(--type-chip);
    cursor: default;
  }

  .text {
    min-width: 0;
    overflow-wrap: break-word;
  }

  /* The x: a 12 px glyph on a 16 px wash, hit 24 px wide (the room around it is its own). */
  .remove {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--chip-x);
    height: var(--chip-x);
    border-radius: var(--radius-xs);
    color: var(--icon-subtle);
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard);
  }

  .remove::before {
    position: absolute;
    inset: calc((var(--chip-x) - var(--hit-min)) / 2);
    content: '';
  }

  .remove:hover {
    background-color: var(--chip-remove-hover);
    color: var(--chip-text);
    transition-duration: var(--dur-hover);
  }

  /* Pressed: only while the left button is down (input.ts marks a press of the others). */
  :global(:where(:root:not([data-aux-press]))) .remove:active:hover {
    background-color: var(--chip-remove-press);
    transition-duration: var(--dur-instant);
  }
</style>
