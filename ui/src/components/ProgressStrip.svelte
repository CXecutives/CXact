<!--
  The progress of a run under the list's head (the round 10 draft, calmer since 2026-10-28):
  the cream ground without an edge, 10 round, 10 12 inside. The step in navy words (13/540:
  "Portale werden durchsucht", "Jobs werden neu bewertet", "Wartet auf freelance.de"), no
  pulse, at the right the count in muted tabular figures ("3 von 8"), and under them the meter
  (white track on the cream, navy fill). A run that waits for the user carries its one link at
  the line's end (`action`: Anmelden) in the step's size (13/540, its glyph 14), which keeps
  the line's height.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Meter from './Meter.svelte';

  interface Props {
    /** What the run does now. */
    step: string;
    /** How far it is ("3 von 8"). */
    count?: string | null;
    /** The meter's value 0..1, null while it cannot say. */
    value: number | null;
    /** The meter's name for screen readers. */
    label: string;
    /** A button at the line's end (a run that waits for a sign-in). */
    action?: Snippet | null;
    testid?: string | null;
  }

  let { step, count = null, value, label, action = null, testid = null }: Props = $props();
</script>

<div class="strip" data-testid={testid ?? undefined}>
  <div class="line">
    <span class="step" data-testid={testid ? `${testid}-step` : undefined}>{step}</span>
    {#if count !== null}<span class="count">{count}</span>{/if}
    {#if action}<span class="action">{@render action()}</span>{/if}
  </div>
  <Meter {value} size="sm" ground="bg" {label} testid={testid ? `${testid}-meter` : null} />
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--strip-pad-y) var(--strip-pad-x);
    border-radius: var(--radius-lg);
    background-color: var(--strip-surface);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }

  .step {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--strip-text);
    font: var(--type-field-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  /* The link keeps its hit area but not its height: the strip keeps its height while it
     waits. Its words in the step's size, its glyph 14. */
  .action {
    display: flex;
    flex: none;
    margin-block: calc((var(--leading-sm) - var(--control-sm)) / 2);
  }

  .action :global(.btn.link) {
    --btn-type: var(--type-field-label);
    --btn-gap: var(--space-4);
  }

  .action :global(.btn.link .icon) {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-stroke-xs);
  }
</style>
