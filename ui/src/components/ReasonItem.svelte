<!--
  One reason of a match: met | partial | open | violation | check. Its state is an icon, the
  same as the reader's verdicts, in the colours of the rings (--verdict-*): met a green check,
  partial an amber minus in a circle, open (not met) a red cross, check (unclear) a muted
  question mark; a violation that excludes the job is the ban, red like a cross. Then its
  words, and the badge "Optional" for an optional one.
  iconOnly (a verdict of the reader's Jobdetails): the icon alone, named by `label`, with the
  reason that decided it in its tooltip (`hint`).
-->
<script lang="ts" module>
  import type { ReasonKind } from '$lib/ipc/types';
  import type { IconName } from './Icon.svelte';

  export const REASON_KINDS: readonly ReasonKind[] = [
    'met',
    'partial',
    'open',
    'violation',
    'check',
  ];

  const ICON: Record<ReasonKind, IconName> = {
    met: 'success',
    partial: 'partial',
    open: 'unmet',
    violation: 'excluded',
    check: 'unclear',
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
    /** An optional requirement: the quiet badge "Optional" after its words. */
    optional?: boolean;
    /** Tooltip: why (the reason that decided a verdict). */
    hint?: string | null;
    /** The icon alone, named by the label. */
    iconOnly?: boolean;
    testid?: string | null;
  }

  let {
    kind,
    label,
    optional = false,
    hint = null,
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
  <span class="reason {kind}" data-kind={kind} data-testid={testid ?? undefined} use:tooltip={hint}>
    <span class="icon"><Icon name={ICON[kind]} size="sm" /></span>
    <span class="label">{label}</span>
    {#if optional}<Badge label={t.reason.weight.nice} tone="neutral" />{/if}
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

  .met {
    --reason-color: var(--verdict-met);
  }

  .partial {
    --reason-color: var(--verdict-partial);
  }

  .open,
  .violation {
    --reason-color: var(--verdict-unmet);
  }

  .check {
    --reason-color: var(--text-muted);
  }
</style>
