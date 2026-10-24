<!--
  Feedback where the action happened. `inline`: a sign and a sentence in the app's small
  text, with at most one small secondary button centred on its first line (a field's or a
  row's failure, a portal's problem): info, success and warning colour only their sign (the
  words stay ink), danger is the deep red all through. `box` and `row` are the state box
  (StateBox, the round 10 draft: no sign, a spinner while `busy`, the title, the sentence and
  the button at the right; `ban` the soft red); Notice hands them on until their callers use
  StateBox themselves. A box with only a sentence shows it as its title; an excluded job's box
  keeps its ban before the words until the job view's ring shows it. A sentence with links in
  it comes as `children` instead of `text`. A notice that appears in a view already on screen
  rises 2 px and fades in (150 ms) and fades out (100 ms); one that comes with its view is
  simply there.
-->
<script lang="ts" module>
  export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'ban';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, rise } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import StateBox from './StateBox.svelte';

  interface Props {
    tone?: NoticeTone;
    variant?: 'inline' | 'row' | 'box';
    /** The spinner before the words (a box whose state is changing). */
    busy?: boolean;
    heading?: string | null;
    text?: string;
    action?: {
      label: string;
      icon?: IconName | null;
      testid?: string | null;
      onclick: () => void;
    } | null;
    testid?: string | null;
    /** Test ids of its sign, its heading and its sentence (a box the specs read part by part). */
    signTestid?: string | null;
    headingTestid?: string | null;
    textTestid?: string | null;
    /** The sentence when it holds more than words (links). */
    children?: Snippet;
    /** A button of its own in the action's place (one that waits or loads). */
    end?: Snippet | null;
  }

  let {
    tone = 'info',
    variant = 'inline',
    busy = false,
    heading = null,
    text = '',
    action = null,
    testid = null,
    signTestid = null,
    headingTestid = null,
    textTestid = null,
    children,
    end = null,
  }: Props = $props();

  const ICONS: Record<NoticeTone, IconName> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'warning',
    ban: 'excluded',
  };

  const alert = $derived(tone === 'danger' || tone === 'warning');
</script>

{#snippet ban()}
  <span class="banned" data-testid={signTestid ?? undefined}
    ><Icon name="excluded" size="sm" /></span
  >
{/snippet}

{#if variant === 'inline'}
  <div
    class="notice {tone}"
    class:acts={action !== null || end !== null}
    role={alert ? 'alert' : 'status'}
    data-testid={testid ?? undefined}
    in:rise={{ distance: 'sm' }}
    out:fade
  >
    <!-- 14 beside the 13 px sentence, the inline size (centred on its 18 px line). -->
    <span class="icon" data-testid={signTestid ?? undefined}
      ><Icon name={ICONS[tone]} size="xs" /></span
    >
    <p class="text" data-testid={textTestid ?? undefined}>
      {#if children}{@render children()}{:else}{text}{/if}
    </p>
    {#if end}
      <span class="action">{@render end()}</span>
    {:else if action}
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
{:else if heading !== null}
  <StateBox
    tone={tone === 'ban' ? 'ban' : 'neutral'}
    {busy}
    {heading}
    text={children ? null : text}
    {children}
    {action}
    {end}
    {alert}
    mark={tone === 'ban' ? ban : null}
    {testid}
    {headingTestid}
    {textTestid}
  />
{:else}
  <StateBox
    tone={tone === 'ban' ? 'ban' : 'neutral'}
    {busy}
    heading={children ? null : text}
    {children}
    {action}
    {end}
    {alert}
    mark={tone === 'ban' ? ban : null}
    {testid}
    headingTestid={textTestid}
    {textTestid}
  />
{/if}

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

  .banned {
    display: inline-flex;
    color: var(--ban);
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
    --notice-fg: var(--error-text);
  }
</style>
