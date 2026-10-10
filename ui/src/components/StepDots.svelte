<!--
  Where the user is in a run of steps (the setup's foot): one dot per step, the current one a
  short coral bar (its colour comes in 180 ms; only transform and opacity ever move). The dots only say the position, never what is
  done; they are no buttons. Its accessible name says it in words ("Schritt 2 von 4").
-->
<script lang="ts">
  interface Props {
    count: number;
    /** The current step, from 0. */
    at: number;
    label: string;
    testid?: string | null;
  }

  let { count, at, label, testid = null }: Props = $props();
</script>

<span class="dots" role="img" aria-label={label} data-testid={testid ?? undefined}>
  {#each { length: count }, index (index)}
    <span class="dot" class:on={index === at} data-on={index === at ? '' : undefined}></span>
  {/each}
</span>

<style>
  .dots {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
  }

  .dot {
    width: var(--step-dot);
    height: var(--step-dot);
    border-radius: var(--radius-full);
    background-color: var(--border-strong);
    transition: background-color var(--dur-slow) var(--ease-out);
  }

  .dot.on {
    width: var(--step-dot-on);
    background-color: var(--step-current);
  }
</style>
