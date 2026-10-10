<!--
  An empty screen or section never looks dead: a centred column with the app mark (or a
  meaningful icon), one quiet sentence and one clear action (plus at most one secondary). No
  heading: every empty state looks alike.
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
  import BrandMark from './BrandMark.svelte';
  import Button from './Button.svelte';
  import IconTile, { type TileTone } from './IconTile.svelte';

  interface Props {
    /** A meaningful icon; without one the app mark is shown. */
    icon?: IconName | null;
    tone?: TileTone;
    /** One sentence. */
    text?: string | null;
    /** The one primary action of the state. */
    action?: EmptyAction | null;
    secondary?: EmptyAction | null;
    /** The action as a secondary button (the window's primary already sits elsewhere). */
    quiet?: boolean;
    testid?: string | null;
  }

  let {
    icon = null,
    tone = 'neutral',
    text = null,
    action = null,
    secondary = null,
    quiet = false,
    testid = null,
  }: Props = $props();
</script>

<div class="empty" data-testid={testid ?? undefined}>
  {#if icon}
    <IconTile {icon} {tone} size="lg" />
  {:else}
    <BrandMark size="lg" />
  {/if}
  {#if text}<p class="text">{text}</p>{/if}
  {#if action || secondary}
    <div class="actions">
      {#if action}
        <Button
          variant={quiet ? 'secondary' : 'primary'}
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
