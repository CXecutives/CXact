<!--
  One reason of a match: met | partial | open | violation | check, weighted must | nice |
  hard | info. Its state is an icon, the same four as the reader's verdicts: met a green
  check, partial an amber half circle, open (not met) a red cross, check (unclear) a muted
  question mark; a violation that excludes the job is the ban. Then its words, and a badge for
  an optional one. Compact (a list row): one line, words cut off show in full in a tooltip.
  iconOnly (a verdict of the reader's Jobdetails): the icon alone, named by `label`, with the
  reason that decided it in its tooltip (`hint`).
-->
<script lang="ts" module>
  import type { ReasonKind, ReasonWeight } from '$lib/ipc/types';
  import type { BadgeTone } from './Badge.svelte';
  import type { IconName } from './Icon.svelte';

  export const REASON_KINDS: readonly ReasonKind[] = [
    'met',
    'partial',
    'open',
    'violation',
    'check',
  ];
  export const REASON_WEIGHTS: readonly ReasonWeight[] = ['must', 'nice', 'hard'];

  const ICON: Record<ReasonKind, IconName> = {
    met: 'success',
    partial: 'partial',
    open: 'unmet',
    violation: 'excluded',
    check: 'unclear',
  };

  // Muss and Kann are plain facts, never alarms: both neutral. Only a decided exclusion is red.
  const WEIGHT_TONE: Record<ReasonWeight, BadgeTone> = {
    must: 'neutral',
    nice: 'neutral',
    hard: 'danger',
    info: 'neutral',
  };
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import Badge from './Badge.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    kind: ReasonKind;
    label: string;
    weight?: ReasonWeight | null;
    /** Tooltip: why (the reason that decided a verdict). */
    hint?: string | null;
    /** One line without weight badge (list rows). */
    compact?: boolean;
    /** The icon alone, named by the label. */
    iconOnly?: boolean;
    testid?: string | null;
  }

  let {
    kind,
    label,
    weight = null,
    hint = null,
    compact = false,
    iconOnly = false,
    testid = null,
  }: Props = $props();
</script>

{#if iconOnly}
  <span
    class="reason {kind} icon-only"
    role="img"
    aria-label={label}
    data-kind={kind}
    data-testid={testid ?? undefined}
    use:tooltip={hint}><span class="icon"><Icon name={ICON[kind]} size="sm" /></span></span
  >
{:else}
  <span
    class="reason {kind}"
    class:compact
    data-kind={kind}
    data-testid={testid ?? undefined}
    use:tooltip={hint}
  >
    <span class="icon"><Icon name={ICON[kind]} size="sm" /></span>
    <!-- In a row the words stay on one line: cut off, they show in full in a tooltip (unless
         the reason has a tooltip of its own). The tooltip measures the node it sits on. -->
    <span class="label" use:tooltip={compact && !hint ? { text: label, truncated: true } : null}
      >{label}</span
    >
    {#if weight && !compact}<Badge
        label={t.reason.weight[weight]}
        tone={WEIGHT_TONE[weight]}
      />{/if}
  </span>
{/if}

<style>
  .reason {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    min-width: 0;
    color: var(--text);
    font: var(--type-md);
  }

  .icon {
    display: inline-flex;
    flex: none;
    margin-top: var(--space-2);
    color: var(--reason-color);
  }

  .label {
    flex: 0 1 auto;
    min-width: 0;
    overflow-wrap: break-word;
  }

  .icon-only {
    display: inline-flex;
  }

  .icon-only .icon {
    margin-top: 0;
  }

  .compact {
    align-items: center;
    gap: var(--space-4);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .compact .icon {
    margin-top: 0;
  }

  .compact .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .met {
    --reason-color: var(--success-strong);
  }

  .partial {
    --reason-color: var(--warning-strong);
  }

  .open,
  .violation {
    --reason-color: var(--danger-strong);
  }

  .check {
    --reason-color: var(--text-muted);
  }
</style>
