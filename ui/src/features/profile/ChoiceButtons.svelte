<!--
  A small fixed choice as a row of toggle buttons (the design system's pressed secondary
  button, as the filter chips): one (`multiple` off) or several. For the language level, the
  remote share and the availability of the profile: no dropdowns. The buttons are as tall as
  the fields beside them (32 px) with the 14 px text of a field. An option may explain
  itself in a tooltip (what a language level means).
  One choice is a radiogroup like the segments: one Tab stop (the chosen option, else the
  first) and the arrows, Home and End choose (input.ts). With `none` it can be left open by a
  visible option of its own ("Offen", chosen while nothing is); without it, pressing the
  chosen option again clears it (Space too), as for a language level.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { tooltip } from '$lib/actions/tooltip';

  interface Props {
    options: readonly { id: string; label: string; hint?: string | null }[];
    selected: readonly string[];
    label: string;
    multiple?: boolean;
    /** The label of the option that leaves a single choice open ("Offen"). */
    none?: string | null;
    testid?: string | null;
    onchange: (selected: string[]) => void;
  }

  let {
    options,
    selected,
    label,
    multiple = false,
    none = null,
    testid = null,
    onchange,
  }: Props = $props();

  /** The id of "Offen" (no option of a profile has an empty id). */
  const OPEN = '';
  const open = $derived(none !== null && !multiple);
  const shown = $derived(open ? [{ id: OPEN, label: none ?? '' }, ...options] : options);
  const chosen = (id: string): boolean =>
    id === OPEN ? selected.length === 0 : selected.includes(id);

  /** One Tab stop for one choice: the chosen option, else the first. */
  const stop = $derived(shown.find((option) => chosen(option.id))?.id ?? shown[0]?.id ?? null);

  function toggle(id: string): void {
    const on = chosen(id);
    if (multiple) {
      onchange(on ? selected.filter((s) => s !== id) : [...selected, id]);
    } else if (open) {
      if (!on) onchange(id === OPEN ? [] : [id]);
    } else {
      onchange(on ? [] : [id]);
    }
  }
</script>

<div
  class="choices"
  role={multiple ? 'group' : 'radiogroup'}
  aria-label={label}
  data-testid={testid ?? undefined}
>
  {#each shown as option (option.id)}
    <span
      class="choice"
      use:tooltip={'hint' in option && option.hint && option.hint !== option.label
        ? option.hint
        : null}
    >
      <Button
        variant="secondary"
        size="field"
        label={option.label}
        pressed={multiple ? selected.includes(option.id) : null}
        radio={multiple ? null : { checked: chosen(option.id), stop: option.id === stop }}
        onclick={() => toggle(option.id)}
      />
    </span>
  {/each}
</div>

<style>
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    min-width: 0;
  }

  .choice {
    display: inline-flex;
  }

  /* A choice beside fields reads like one: the 14 px text of a field (the button's field
     size keeps the small type of a chip elsewhere). */
  .choices :global(.btn.field) {
    --btn-type: var(--type-field);
  }
</style>
