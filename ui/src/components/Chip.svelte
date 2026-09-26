<!--
  A quiet pill for a fact with a state: an icon for the state, then the words, usually the
  ad's own value ("1.100 €/Tag", "ab sofort"). met: a green icon, unknown: the muted question
  mark of an unclear point (the same colour as its reason), violated: red on the danger wash,
  unset: muted (the ad does not say), plain: a neutral fact. It is text, not a control; its
  tooltip says only what its words leave out.
-->
<script lang="ts" module>
  export type ChipState = 'met' | 'violated' | 'unknown' | 'unset' | 'plain';
  export const CHIP_STATES: readonly ChipState[] = ['met', 'unknown', 'violated', 'unset', 'plain'];
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    label: string;
    state?: ChipState;
    icon?: IconName | null;
    /** Tooltip (only what the words leave out). */
    hint?: string | null;
    testid?: string | null;
  }

  let { label, state = 'plain', icon = null, hint = null, testid = null }: Props = $props();
</script>

<span class="chip {state}" data-state={state} data-testid={testid ?? undefined} use:tooltip={hint}>
  {#if icon}<span class="chip-icon"><Icon name={icon} size="xs" /></span>{/if}
  <span class="chip-label">{label}</span>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--badge-height);
    padding: 0 var(--space-8) 0 var(--space-6);
    border-radius: var(--radius-full);
    background-color: var(--surface-muted);
    color: var(--text-muted);
    font: var(--type-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  .chip-icon {
    display: inline-flex;
    color: var(--chip-icon, var(--text-subtle));
  }

  .met {
    --chip-icon: var(--success-strong);
  }

  /* Unclear is muted everywhere: chip and reason alike. */
  .unknown {
    --chip-icon: var(--text-muted);
  }

  .violated {
    --chip-icon: var(--danger-strong);

    background-color: var(--danger-soft);
    color: var(--danger-strong);
  }

  .unset {
    color: var(--text-subtle);
  }
</style>
