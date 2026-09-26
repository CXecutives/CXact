<!--
  The heading of a section of a list: a navy sub-label, its count in brackets where it is
  known ("Ausgeschlossen (2)"), then a hairline to the end. `thin` is the quiet variant for
  sections the list only groups (a small grey label, little room above it, as over the jobs
  of the last fetch). A section that folds (`open` set) is a button: its
  chevron at the end turns half a turn when open (180 ms, emphasized), the label darkens
  on hover; the list shows or hides the rows below it (`ontoggle`).
-->
<script lang="ts">
  import { formatNumber } from '$lib/i18n/format';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    /** How many rows the section holds, where it is known (null: not said). */
    count?: number | null;
    /** The quiet variant of a section the list only groups. */
    thin?: boolean;
    /** The section folds: whether its rows show (null: it does not fold). */
    open?: boolean | null;
    ontoggle?: () => void;
    testid?: string | null;
  }

  let { label, count = null, thin = false, open = null, ontoggle, testid = null }: Props = $props();

  const text = $derived(count === null ? label : `${label} (${formatNumber(count)})`);
</script>

{#snippet content()}
  <span class="label">{text}</span>
  <span class="rule" aria-hidden="true"></span>
  {#if open !== null}
    <span class="chevron" class:turned={open}><Icon name="expand" size="sm" /></span>
  {/if}
{/snippet}

{#if open !== null}
  <button
    type="button"
    class="divider toggle"
    class:thin
    aria-expanded={open}
    data-testid={testid ?? undefined}
    onclick={() => ontoggle?.()}
  >
    {@render content()}
  </button>
{:else}
  <div class="divider" class:thin data-testid={testid ?? undefined}>
    {@render content()}
  </div>
{/if}

<style>
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    padding: var(--space-24) var(--pane-padding) var(--space-8);
    color: var(--text-label);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
    text-align: left;
  }

  .thin {
    padding: var(--space-12) var(--pane-padding) var(--space-4);
    color: var(--text-subtle);
    font: var(--type-xs);
    font-weight: var(--weight-medium);
  }

  .label {
    flex: none;
    font-variant-numeric: var(--numeric);
    white-space: nowrap;
  }

  .rule {
    flex: 1;
    height: var(--border-width);
    margin-left: var(--space-4);
    background-color: var(--border);
  }

  .toggle {
    transition: color var(--dur-base) var(--ease-standard);
  }

  .toggle:hover {
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  .toggle:focus-visible {
    box-shadow: var(--focus-ring-inset);
  }

  .chevron {
    display: inline-flex;
    flex: none;
    color: var(--text-muted);
    transition:
      transform var(--dur-slow) var(--ease-emphasized),
      color var(--dur-base) var(--ease-standard);
  }

  .toggle:hover .chevron {
    color: var(--icon-accent);
  }

  .turned {
    transform: rotate(var(--turn-half));
  }
</style>
