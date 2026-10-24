<!--
  The heading of a section that folds at the end of the job list ("Noch nicht bewertet",
  "Ausgeschlossen"; the round 10 draft): a hairline across the rows' width 6 below the last
  row, under it the label 12/540 muted on the rows' inner edge (22 above, 6 below), no count,
  and at its end the chevron 14 in the subtle glyph colour, which turns half a turn while the
  section is open (150 ms, ease-out). Under the pointer the label and the chevron darken to
  ink. A button: the list shows or hides the rows below it (`ontoggle`).
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    /** Whether its rows show. */
    open: boolean;
    ontoggle?: () => void;
    testid?: string | null;
  }

  let { label, open, ontoggle, testid = null }: Props = $props();
</script>

<button
  type="button"
  class="divider"
  aria-expanded={open}
  data-testid={testid ?? undefined}
  onclick={() => ontoggle?.()}
>
  <span class="label">{label}</span>
  <span class="chevron" class:turned={open}><Icon name="expand" size="xs" /></span>
</button>

<style>
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    margin-top: var(--divider-gap);
    padding: var(--divider-pad);
    border-top: var(--border-width) solid var(--border);
    color: var(--text-muted);
    font: var(--type-day);
    text-align: left;
    transition: color var(--dur-base) var(--ease-standard);
  }

  .divider:hover {
    color: var(--label-hover);
    transition-duration: var(--dur-hover);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    display: inline-flex;
    flex: none;
    color: var(--icon-subtle);
    transition:
      transform var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-standard);
  }

  .divider:hover .chevron {
    color: var(--label-hover);
    transition-duration: var(--dur-base), var(--dur-hover);
  }

  .turned {
    transform: rotate(var(--turn-half));
  }
</style>
