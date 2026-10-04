<!--
  A choice of several as checkboxes in a row, each with its label (Vertragsart; user decision
  2026-10-04): the chosen box coral with a white check, the others an empty box. The last
  chosen option stays (a click does nothing, its tooltip says why: `keepOne`). Each option is
  a checkbox and its own Tab stop; Space and Enter flip it like any button.
-->
<script lang="ts" module>
  export interface CheckOption<Id extends string = string> {
    id: Id;
    label: string;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { tooltip } from '$lib/actions/tooltip';
  import Icon from './Icon.svelte';

  interface Props {
    options: readonly CheckOption<Id>[];
    values: readonly Id[];
    /** Why the last chosen option cannot go. */
    keepOne?: string | null;
    label: string;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let { options, values, keepOne = null, label, testid = null, onchange }: Props = $props();

  const last = (id: Id): boolean => values.length === 1 && values[0] === id;
</script>

<div class="checks" role="group" aria-label={label} data-testid={testid ?? undefined}>
  {#each options as option (option.id)}
    {@const chosen = values.includes(option.id)}
    <button
      type="button"
      role="checkbox"
      class="option"
      aria-checked={chosen}
      data-chosen={chosen ? '' : undefined}
      data-testid={option.testid ?? undefined}
      use:tooltip={last(option.id) ? keepOne : null}
      onclick={() => {
        if (!last(option.id)) onchange(option.id);
      }}
    >
      <span class="box" aria-hidden="true">
        {#if chosen}<Icon name="check" size="xs" />{/if}
      </span>
      <span class="label">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-20);
    min-width: 0;
  }

  .option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    height: var(--control-field);
    color: var(--text);
    font: var(--type-md);
    white-space: nowrap;
  }

  .box {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    border: var(--border-width) solid var(--border-input);
    border-radius: var(--radius-xs);
    background-color: var(--surface);
    color: var(--text-inverse);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .option:hover .box {
    border-color: var(--border-strong);
  }

  .option[data-chosen] .box {
    border-color: var(--toggle-on);
    background-color: var(--toggle-on);
  }
</style>
