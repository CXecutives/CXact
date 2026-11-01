<!--
  Feedback where the action happened: a sign and a sentence in the app's small text, with at
  most one small secondary button centred on its first line (a field's or a list's failure):
  info and warning colour only their sign (the words stay ink), danger is the one red of what is
  wrong all through. The sentence of a failure or a warning copies (`data-copy`), to search for
  it or to say it to someone. A notice that appears in a view already on screen rises 4 px and
  fades in (150 ms); one that comes with its view is simply there. It goes at once, so that what
  takes its place (a field's hint) never stands beside it.
-->
<script lang="ts" module>
  export type NoticeTone = 'info' | 'warning' | 'danger';
</script>

<script lang="ts">
  import { rise } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    tone: NoticeTone;
    text: string;
    action?: {
      label: string;
      icon?: IconName | null;
      testid?: string | null;
      onclick: () => void;
    } | null;
    testid?: string | null;
    /** The test id of its sentence. */
    textTestid?: string | null;
  }

  let { tone, text, action = null, testid = null, textTestid = null }: Props = $props();

  const ICONS: Record<NoticeTone, IconName> = {
    info: 'info',
    warning: 'warning',
    danger: 'warning',
  };

  const alert = $derived(tone === 'danger' || tone === 'warning');
</script>

<div
  class="notice {tone}"
  class:acts={action !== null}
  role={alert ? 'alert' : 'status'}
  data-testid={testid ?? undefined}
  in:rise={{ distance: 'sm' }}
>
  <!-- 14 beside the 13 px sentence, the inline size (centred on its 18 px line). -->
  <span class="icon"><Icon name={ICONS[tone]} size="xs" /></span>
  <p class="text" data-copy={alert ? '' : undefined} data-testid={textTestid ?? undefined}>
    {text}
  </p>
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

  .icon {
    display: inline-flex;
    flex: none;
    padding-top: var(--space-2);
    color: var(--notice-sign, var(--notice-fg));
  }

  /* With a button, the sentence's first line is centred on it (as a field's message on its
     way on): the icon and the sentence come down by half the difference. */
  .acts > .icon,
  .acts > .text {
    margin-top: calc((var(--control-field) - var(--leading-sm)) / 2);
  }

  .text {
    flex: 1;
    min-width: 0;
  }

  .action {
    display: flex;
    flex: none;
    align-items: center;
  }

  /* Info and a warning: the sign in its colour, the words ink. */
  .info {
    --notice-fg: var(--text);
    --notice-sign: var(--info);
  }

  .warning {
    --notice-fg: var(--text);
    --notice-sign: var(--warning);
  }

  .danger {
    --notice-fg: var(--error-text);
  }
</style>
