<!--
  An empty screen or section never looks dead: a centred column with a meaningful icon, one
  quiet sentence and one clear action (plus at most one secondary). No heading: every empty
  state looks alike.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface EmptyAction {
    label: string;
    icon?: IconName;
    onclick: () => void;
  }
</script>

<script lang="ts">
  import Button from './Button.svelte';
  import IconTile, { type TileTone } from './IconTile.svelte';

  interface Props {
    icon: IconName;
    tone?: TileTone;
    /** One sentence. */
    text?: string | null;
    /** The one primary action of the state. */
    action?: EmptyAction | null;
    secondary?: EmptyAction | null;
    testid?: string | null;
  }

  let {
    icon,
    tone = 'neutral',
    text = null,
    action = null,
    secondary = null,
    testid = null,
  }: Props = $props();
</script>

<div class="empty" data-testid={testid ?? undefined}>
  <IconTile {icon} {tone} size="lg" />
  {#if text}<p class="text">{text}</p>{/if}
  {#if action || secondary}
    <div class="actions">
      {#if action}
        <Button
          variant="primary"
          label={action.label}
          icon={action.icon ?? null}
          onclick={action.onclick}
        />
      {/if}
      {#if secondary}
        <Button
          variant="secondary"
          label={secondary.label}
          icon={secondary.icon ?? null}
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
    gap: var(--space-16);
    max-width: var(--form-width);
    text-align: center;
  }

  /* A centred sentence breaks into lines of a like length. */
  .text {
    color: var(--text-muted);
    font: var(--type-body);
    text-wrap: balance;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-12);
  }
</style>
