<!-- A short status word in a pill (12/500). Static: a badge never reacts to the pointer
     (a hint shows as a tooltip). A neutral pill takes the fill its surroundings give it
     (--badge-neutral-bg: white on the warm wash of a selected row), else the muted grey; a
     success or a warning has its words in ink and its sign in the rings' colour. -->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';
  export const BADGE_TONES: readonly BadgeTone[] = ['neutral', 'success', 'warning', 'danger'];
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    tone?: BadgeTone;
    icon?: IconName | null;
    hint?: string | null;
  }

  let { label, tone = 'neutral', icon = null, hint = null }: Props = $props();
</script>

<span class="badge {tone}" use:tooltip={hint}>
  {#if icon}<span class="sign"><Icon name={icon} size="xs" /></span>{/if}
  <span class="label">{label}</span>
</span>

<style>
  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    height: var(--badge-height);
    padding: 0 var(--space-8);
    border-radius: var(--radius-full);
    background-color: var(--badge-bg);
    color: var(--badge-fg);
    font: var(--type-xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
  }

  .sign {
    display: inline-flex;
    color: var(--badge-sign, var(--badge-fg));
  }

  .neutral {
    --badge-bg: var(--badge-neutral-bg, var(--surface-muted));
    --badge-fg: var(--text-muted);
  }

  .success {
    --badge-bg: var(--success-soft);
    --badge-fg: var(--text);
    --badge-sign: var(--success);
  }

  .warning {
    --badge-bg: var(--warning-soft);
    --badge-fg: var(--text);
    --badge-sign: var(--warning);
  }

  .danger {
    --badge-bg: var(--danger-soft);
    --badge-fg: var(--danger-strong);
  }
</style>
