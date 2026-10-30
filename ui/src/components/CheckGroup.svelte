<!--
  A choice of several as checkboxes in a row, each with its label (Vertragsart; user decision
  2026-10-04; round 10): a 16 px box with a 1.5 px edge in the grey of a switch that is off
  (3:1 on white), the chosen one coral like a switch that is on, with a white 13 px tick that
  fades in (140 ms). Under the pointer an empty box's edge darkens a step, pressed one more,
  like a switch's track; a chosen one darkens like a switch (Toggle). The last chosen option stays
  (a click does nothing, its tooltip says why: `keepOne`). Each option is a checkbox and its
  own Tab stop; Space flips it like any button. 24 px high, 22 px between them.
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
      <span class="box" aria-hidden="true"><Icon name="check" size="check" /></span>
      <span class="label">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--check-gap);
    min-width: 0;
  }

  .option {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--hit-min);
    color: var(--text);
    font: var(--type-md);
    white-space: nowrap;
  }

  .box {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--check-box);
    height: var(--check-box);
    border: var(--check-edge) solid var(--toggle-off);
    border-radius: var(--radius-xs);
    background-color: var(--surface);
    color: var(--text-on-accent);
    transition:
      background-color var(--dur-fade) var(--ease-out),
      border-color var(--dur-fade) var(--ease-out);
  }

  /* The tick fades in with the coral and out with it. */
  .box :global(.icon) {
    opacity: 0;
    transition: opacity var(--dur-fade) var(--ease-out);
  }

  .option[data-chosen] .box :global(.icon) {
    opacity: 1;
  }

  .option:hover .box {
    border-color: var(--toggle-off-hover);
    transition-duration: var(--dur-hover);
  }

  .option[data-chosen] .box {
    border-color: var(--toggle-on);
    background-color: var(--toggle-on);
  }

  .option[data-chosen]:hover .box {
    border-color: var(--toggle-on-hover);
    background-color: var(--toggle-on-hover);
  }

  /* Pressed: one more step than on hover, 60 ms, like a switch. */
  :global(:where(:root:not([data-aux-press]))) .option:active:hover .box {
    border-color: var(--toggle-off-press);
    transition-duration: var(--dur-instant);
  }

  :global(:where(:root:not([data-aux-press]))) .option[data-chosen]:active:hover .box {
    border-color: var(--toggle-on-press);
    background-color: var(--toggle-on-press);
  }
</style>
