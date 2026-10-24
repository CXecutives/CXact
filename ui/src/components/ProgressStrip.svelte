<!--
  The progress of a run under the list's head (the round 10 draft): the cream ground with a
  hairline, 10 round, 10 12 inside. A coral pulse (8, it breathes by its opacity, no glow) and
  the step in navy words (13/540: "Portale werden durchsucht", "Jobs werden neu bewertet",
  "Wartet auf die Anmeldung bei freelance.de"), at the right the count in muted tabular
  figures ("3 von 8"), and under them the meter (white track on the cream, navy fill). A run
  that waits for the user carries its one button at the line's end (`action`: Anmelden).
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
    <span class="pulse" aria-hidden="true"></span>
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
    border: var(--border-width) solid var(--strip-edge);
    border-radius: var(--radius-lg);
    background-color: var(--strip-surface);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }

  .pulse {
    flex: none;
    width: var(--pulse-dot);
    height: var(--pulse-dot);
    border-radius: var(--radius-full);
    background-color: var(--pulse);
    animation: pulse var(--dur-loop) var(--ease-standard) infinite alternate;
    animation-play-state: var(--loop-state);
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

  .action {
    display: flex;
    flex: none;
  }
</style>
