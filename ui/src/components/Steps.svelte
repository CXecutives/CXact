<!--
  A step indicator (the setup's "Profil" and "Postfach"): one thin bar per step, side by side
  in equal columns, each with its name under it. The bar of a done or the current step is
  navy, a later one's the meter's track; the current name is navy, a done one ink, a later
  one muted. No digits, ticks or green. It only shows where the user is: nothing in it is
  clickable.
-->
<script lang="ts" module>
  export type StepState = 'done' | 'current' | 'later';
</script>

<script lang="ts">
  interface Props {
    steps: readonly { name: string; state: StepState }[];
    label: string;
    testid?: string | null;
  }

  let { steps, label, testid = null }: Props = $props();
</script>

<ol class="steps" aria-label={label} data-testid={testid ?? undefined}>
  {#each steps as { name, state } (name)}
    <li
      class="step {state}"
      aria-current={state === 'current' ? 'step' : undefined}
      data-state={state}
    >
      <span class="bar" aria-hidden="true"></span>
      <span class="name">{name}</span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
  }

  .bar {
    height: var(--meter-sm);
    border-radius: var(--radius-full);
    background-color: var(--meter-track);
    transition: background-color var(--dur-base) var(--ease-out);
  }

  .name {
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-label);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .done .bar,
  .current .bar {
    background-color: var(--meter-fill);
  }

  .done .name {
    color: var(--text);
  }

  .current .name {
    color: var(--text-heading);
  }
</style>
