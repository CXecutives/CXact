<!--
  An empty screen or section never looks dead (the round 10 draft): the setup's tile of 48
  (one look for a tile above a title; a failure's in the soft red), 14 under it the title (16/650) and one quiet sentence (13 muted, at
  most 300 wide), centred; at most one clear action under it (plus at most one secondary).
  Every empty state looks alike. In a list (`placement="list"`) it stands at the top of the
  full width, 56 from the top; in the job view and an empty list without its head (`center`)
  in the middle of its view (its parent centres it). The words of a failure (`tone="danger"`)
  copy.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface EmptyAction {
    label: string;
    icon?: IconName;
    onclick: (event: MouseEvent) => void;
    /** Why it cannot be done now (its tooltip; null or absent: it can). */
    reason?: string | null;
    testid?: string | null;
  }
</script>

<script lang="ts">
  import Button from './Button.svelte';
  import IconTile from './IconTile.svelte';

  interface Props {
    icon: IconName;
    /** A failure (the load of the list or a job): the tile in the soft red. */
    tone?: 'neutral' | 'danger';
    /** The title. */
    heading?: string | null;
    /** One sentence. */
    text?: string | null;
    /** Where it stands: at the top of a list, or in the middle of its view. */
    placement?: 'list' | 'center';
    /** The one primary action of the state. */
    action?: EmptyAction | null;
    secondary?: EmptyAction | null;
    testid?: string | null;
  }

  let {
    icon,
    tone = 'neutral',
    heading = null,
    text = null,
    placement = 'center',
    action = null,
    secondary = null,
    testid = null,
  }: Props = $props();
</script>

<div class="empty {placement}" data-testid={testid ?? undefined}>
  <IconTile {icon} tone={tone === 'danger' ? 'danger' : 'accent'} />
  {#if heading}<h3 class="title" data-copy={tone === 'danger' ? '' : undefined}>{heading}</h3>{/if}
  {#if text}<p class="text" data-copy={tone === 'danger' ? '' : undefined}>{text}</p>{/if}
  {#if action || secondary}
    <div class="actions">
      {#if action}
        <Button
          variant="primary"
          label={action.label}
          icon={action.icon ?? null}
          disabled={(action.reason ?? null) !== null}
          disabledReason={action.reason ?? null}
          testid={action.testid ?? null}
          onclick={action.onclick}
        />
      {/if}
      {#if secondary}
        <Button
          variant="secondary"
          label={secondary.label}
          icon={secondary.icon ?? null}
          disabled={(secondary.reason ?? null) !== null}
          disabledReason={secondary.reason ?? null}
          testid={secondary.testid ?? null}
          onclick={secondary.onclick}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  /* At the top of a list, across its full width. */
  .list {
    width: 100%;
    padding: var(--empty-top) var(--empty-side) 0;
  }

  .center {
    max-width: var(--form-width);
  }

  .title {
    margin-top: var(--empty-tile-gap);
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
    overflow-wrap: anywhere;
  }

  /* A centred sentence breaks into lines of a like length. */
  .text {
    max-width: var(--empty-text-max);
    margin-top: var(--empty-text-gap);
    color: var(--text-muted);
    font: var(--type-sm);
    text-wrap: balance;
  }

  /* A pair is one width, whatever its words. */
  .actions {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: var(--space-8);
    margin-top: var(--empty-actions-gap);
  }
</style>
