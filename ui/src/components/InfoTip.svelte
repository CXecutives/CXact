<!--
  The info symbol beside a label, only at the fixed places of docs/PLAN.md: a quiet ghost
  glyph whose accessible name says what it explains; its one sentence shows in the one
  tooltip layer on hover, on keyboard focus and on a click (a second click hides it). A field
  has either a visible hint or an info symbol, never both (Field).
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import Icon from './Icon.svelte';

  interface Props {
    /** The one sentence of the bubble. */
    text: string;
    /** Its accessible name ("Mehr zu Vertragsart"). */
    label: string;
    testid?: string | null;
  }

  let { text, label, testid = null }: Props = $props();
</script>

<button
  type="button"
  class="info"
  aria-label={label}
  data-testid={testid ?? 'info-tip'}
  use:tooltip={{ text, toggle: true }}
>
  <Icon name="info" size="sm" />
</button>

<style>
  /* As high as the label's line: it never makes its row taller. */
  .info {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--control-sm);
    height: var(--control-sm);
    margin-block: calc((var(--leading-sm) - var(--control-sm)) / 2);
    border-radius: var(--radius-full);
    color: var(--text-subtle);
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard);
  }

  .info:hover {
    background-color: var(--quiet-hover);
    color: var(--text-muted);
    transition-duration: var(--dur-hover);
  }

  .info:focus-visible {
    box-shadow: var(--focus-ring);
  }
</style>
