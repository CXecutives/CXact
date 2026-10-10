<!--
  Feedback where the action happened: info | success | warning | danger, inline (icon and
  sentence, the app's small text) or row (a calm line at the top of the list, the text in the
  body size, with an optional heading), with at most one action, a small secondary button
  with the glyph the same action has everywhere else; inline, the button is centred on the
  sentence's first line. Info, success and warning colour only their sign (the words stay
  ink), danger is red all through. A sentence with links in it (the missing line of the
  profile) comes as `children` instead of `text`. A notice that appears in a view already on
  screen rises 2 px and fades in (150 ms) and fades out (100 ms); one that comes with its
  view is simply there.
-->
<script lang="ts" module>
  export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, rise } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    tone?: NoticeTone;
    variant?: 'inline' | 'row';
    heading?: string | null;
    text?: string;
    action?: {
      label: string;
      icon?: IconName | null;
      testid?: string | null;
      onclick: () => void;
    } | null;
    testid?: string | null;
    /** The sentence when it holds more than words (links). */
    children?: Snippet;
  }

  let {
    tone = 'info',
    variant = 'inline',
    heading = null,
    text = '',
    action = null,
    testid = null,
    children,
  }: Props = $props();

  const ICONS: Record<NoticeTone, IconName> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'warning',
  };
</script>

<div
  class="notice {tone} {variant}"
  class:acts={action !== null}
  role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
  data-testid={testid ?? undefined}
  in:rise={{ distance: 'sm' }}
  out:fade
>
  <span class="icon"><Icon name={ICONS[tone]} size="sm" /></span>
  <div class="copy">
    {#if heading}<p class="heading">{heading}</p>{/if}
    <p class="text">
      {#if children}{@render children()}{:else}{text}{/if}
    </p>
  </div>
  {#if action}
    <span class="action">
      <Button
        variant="secondary"
        label={action.label}
        icon={action.icon ?? null}
        testid={action.testid ?? null}
        onclick={action.onclick}
      />
    </span>
  {/if}
</div>

<style>
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    color: var(--notice-fg);
    font: var(--type-sm);
  }

  .row {
    align-items: center;
    gap: var(--space-8);
    color: var(--text);
    font: var(--type-md);
  }

  .icon {
    display: inline-flex;
    flex: none;
    padding-top: var(--space-2);
    color: var(--notice-sign, var(--notice-fg));
  }

  .row .icon {
    padding-top: 0;
  }

  /* Inline with a button, the sentence's first line is centred on it (as a field's message
     on its way on): the icon and the sentence come down by half the difference. */
  .inline.acts > .icon,
  .inline.acts > .copy {
    margin-top: calc((var(--control-field) - var(--leading-sm)) / 2);
  }

  .copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .heading {
    font-weight: var(--weight-medium);
  }

  .action {
    display: flex;
    flex: none;
    align-items: center;
  }

  /* Info, a success and a warning: the sign in its colour, the words ink. */
  .info {
    --notice-fg: var(--text);
    --notice-sign: var(--info);
  }

  .success {
    --notice-fg: var(--text);
    --notice-sign: var(--success);
  }

  .warning {
    --notice-fg: var(--text);
    --notice-sign: var(--warning);
  }

  .danger {
    --notice-fg: var(--danger-strong);
  }
</style>
