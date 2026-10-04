<!--
  A step indicator: numbered dots with their names, joined by a line (the setup's "1 Profil",
  "2 Alert-Mails"). The current step has a navy edge and number, a done one a green dot with
  a tick, a later one a grey edge. `current` past the last step marks every step done. It
  only shows where the user is: nothing in it is clickable.
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    steps: readonly string[];
    /** The index of the current step (steps before it are done). */
    current: number;
    label: string;
    testid?: string | null;
  }

  let { steps, current, label, testid = null }: Props = $props();
</script>

<ol class="steps" aria-label={label} data-testid={testid ?? undefined}>
  {#each steps as name, index (name)}
    {@const done = index < current}
    <li
      class="step"
      class:done
      class:current={index === current}
      aria-current={index === current ? 'step' : undefined}
      data-state={done ? 'done' : index === current ? 'current' : 'later'}
    >
      {#if index > 0}<span class="line" aria-hidden="true"></span>{/if}
      <span class="dot" aria-hidden="true">
        {#if done}<Icon name="check" size="xs" />{:else}{index + 1}{/if}
      </span>
      <span class="name">{name}</span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .step {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .line {
    width: var(--step-line);
    height: var(--border-width);
    margin-inline: var(--space-12);
    background-color: var(--border-strong);
  }

  .dot {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--step-dot);
    height: var(--step-dot);
    border: var(--step-edge) solid var(--border-strong);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font: var(--type-xs);
    font-weight: var(--weight-semibold);
    font-variant-numeric: var(--numeric);
    transition:
      background-color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }

  .name {
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  .current .dot {
    border-color: var(--active-edge);
    color: var(--text-heading);
  }

  .current .name {
    color: var(--text-heading);
  }

  .done .dot {
    border-color: var(--success);
    background-color: var(--success);
    color: var(--text-inverse);
  }

  .done .name {
    color: var(--text);
  }
</style>
