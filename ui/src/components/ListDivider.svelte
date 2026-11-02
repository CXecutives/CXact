<!--
  The heading of a section that folds at the end of the job list ("Noch nicht bewertet",
  "Ausgeschlossen"; the round 10 draft): a hairline across the rows' width 6 below the last
  row, under it the label 12/540 muted on the rows' inner edge (22 above, 6 below), no count,
  and at its end the chevron 14 in the subtle glyph colour, the one fold of the app: it points
  aside while the section is folded and down while it is open (a quarter turn, ease-out). Under the pointer the label and the chevron darken to
  ink. A button: the list shows or hides the rows below it (`ontoggle`); without one it is
  locked, a section held open: no answer to the pointer (a press on it is a press on the list),
  no Tab stop, the chevron as it is. A
  section that stands first in the list has nothing to part from: no line, and its label stands
  where a day's heading stands.
-->
<script lang="ts">
  import { secondPress } from '$lib/input/input';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    /** Whether its rows show. */
    open: boolean;
    /** Shows or hides its rows (null: locked). */
    ontoggle?: (() => void) | null;
    testid?: string | null;
  }

  let { label, open, ontoggle = null, testid = null }: Props = $props();
</script>

<button
  type="button"
  class="divider"
  aria-expanded={open}
  disabled={ontoggle === null}
  data-testid={testid ?? undefined}
  onclick={(event) => {
    if (!secondPress(event)) ontoggle?.();
  }}
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

  /* First in the list: no rows of the days above its section. */
  :global(.rows:not(:has([data-key]))) + :global(.section) > .divider {
    margin-top: 0;
    padding: var(--day-head-pad);
    border-top: 0;
  }

  /* Locked: the pointer goes through it to the list (an engine sends no press to a disabled
     button: an open menu would stay). */
  .divider:disabled {
    pointer-events: none;
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
    transform: rotate(var(--turn-fold));
    transition:
      transform var(--dur-slow) var(--ease-out),
      color var(--dur-base) var(--ease-standard);
  }

  .divider:hover .chevron {
    color: var(--label-hover);
    transition-duration: var(--dur-slow), var(--dur-hover);
  }

  .turned {
    transform: none;
  }
</style>
