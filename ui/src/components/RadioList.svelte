<!--
  A short list to choose one entry from, a row each (the backups of "Sicherung
  wiederherstellen"): its label, a quiet note after it and a detail at its end (a size), the
  numbers tabular. Like native radio buttons the list is one Tab stop, the arrows, Home and
  End choose (lib/input/input.ts) and a click chooses; Enter goes on to the dialog around it.
  The chosen row carries a check (coral stays with its roles); every row washes quietly on
  hover and darkens while pressed, like a menu's; nothing moves or scales.
-->
<script lang="ts" module>
  export interface RadioListOption<Id extends string = string> {
    id: Id;
    label: string;
    /** A quiet word after the label (why the entry is there), or null. */
    note?: string | null;
    /** At the row's end (a size), or null. */
    detail?: string | null;
  }
</script>

<script lang="ts" generics="Id extends string">
  import Icon from './Icon.svelte';

  interface Props {
    options: readonly RadioListOption<Id>[];
    value: Id | null;
    label: string;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let { options, value, label, testid = null, onchange }: Props = $props();

  /** One Tab stop: the chosen row, else the first. */
  const stop = $derived(
    options.some((option) => option.id === value) ? value : (options[0]?.id ?? null),
  );
</script>

<div class="list" role="radiogroup" aria-label={label} data-testid={testid ?? undefined}>
  {#each options as option (option.id)}
    {@const chosen = option.id === value}
    <button
      type="button"
      role="radio"
      class="row"
      aria-checked={chosen}
      tabindex={option.id === stop ? 0 : -1}
      data-id={option.id}
      onclick={() => onchange(option.id)}
    >
      <span class="mark" aria-hidden="true">
        {#if chosen}<Icon name="check" size="sm" />{/if}
      </span>
      <span class="label">{option.label}</span>
      {#if option.note}<span class="note">{option.note}</span>{/if}
      {#if option.detail}<span class="detail">{option.detail}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    height: var(--menu-row);
    padding: 0 var(--menu-inset);
    border: none;
    border-radius: var(--menu-row-radius);
    background-color: transparent;
    color: var(--text);
    font: var(--type-field);
    font-variant-numeric: var(--numeric);
    text-align: start;
    cursor: default;
    transition: background-color var(--dur-base) var(--ease-out);
  }

  .row:hover {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .row:active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  .row:focus-visible {
    box-shadow: var(--focus-ring-inset);
  }

  .mark {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--menu-icon);
    color: var(--text);
  }

  .label {
    flex: none;
    white-space: nowrap;
  }

  .note {
    overflow: hidden;
    flex: 0 1 auto;
    min-width: 0;
    color: var(--text-muted);
    font: var(--type-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    flex: none;
    margin-inline-start: auto;
    padding-inline-start: var(--space-16);
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }
</style>
