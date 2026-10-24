<!--
  The info symbol beside a label, only at the fixed places of docs/PLAN.md: a quiet 14 px
  glyph in the subtle grey of icons (round 10), hit 24 px wide around it, whose accessible
  name says what it explains; its one sentence shows in the one
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
  <Icon name="info" size="xs" />
</button>

<style>
  /* As high as the label's line: it never makes its row taller; its hit area reaches past it
     unseen. */
  .info {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--icon-xs);
    height: var(--icon-xs);
    margin-block: calc((var(--leading-sm) - var(--icon-xs)) / 2);
    color: var(--icon-subtle);
    transition: color var(--dur-base) var(--ease-standard);
  }

  .info::before {
    position: absolute;
    inset: calc((var(--icon-xs) - var(--hit-min)) / 2);
    content: '';
  }

  .info:hover {
    color: var(--text-muted);
    transition-duration: var(--dur-hover);
  }
</style>
