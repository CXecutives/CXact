<!--
  Feedback where the action happened: info | success | warning | danger | ban, inline (icon
  and sentence, the app's small text), row (a calm line in the list, at its top or its end,
  the text in the body size, with an optional heading) or box (the state of a job under the
  job view's head: a tinted box with its sign, its sentence and its one button on the same
  line, design round 7; `ban` is an excluded job: the red ban and a red heading, the
  sentence ink; `busy` puts the spinner in the sign's place), with at most one action, a
  small secondary button
  with the glyph the same action has everywhere else; inline, the button is centred on the
  sentence's first line. Info, success and warning colour only their sign (the words stay
  ink), danger is red all through. A sentence with links in it (the missing line of the
  profile) comes as `children` instead of `text`. A notice that appears in a view already on
  screen rises 2 px and fades in (150 ms) and fades out (100 ms); one that comes with its
  view is simply there.
-->
<script lang="ts" module>
  export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'ban';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, rise } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    tone?: NoticeTone;
    variant?: 'inline' | 'row' | 'box';
    /** The spinner in the sign's place (a box whose state is changing). */
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
</script>

<div
  class="notice {tone} {variant}"
  class:acts={action !== null || end !== null}
  role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
  data-testid={testid ?? undefined}
  in:rise={{ distance: 'sm' }}
  out:fade
>
  <span class="icon" data-testid={signTestid ?? undefined}
    >{#if busy}<Spinner size="sm" label={null} />{:else}<Icon
        name={ICONS[tone]}
        size="sm"
      />{/if}</span
  >
  <div class="copy">
    {#if heading}<p class="heading" data-testid={headingTestid ?? undefined}>{heading}</p>{/if}
    <p class="text" data-testid={textTestid ?? undefined}>
      {#if children}{@render children()}{:else}{text}{/if}
    </p>
  </div>
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

  /* The state of a job: a tinted box, its sign, sentence and button on one line (the button
     wraps under a narrow sentence), one height with and without its button. */
  .box {
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-12);
    min-height: calc(var(--control-field) + 2 * var(--space-8) + 2 * var(--border-width));
    padding: var(--space-8) var(--space-8) var(--space-8) var(--space-12);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-md);
    background-color: var(--surface-muted);
    font: var(--type-md);
  }

  .box .icon {
    padding-top: 0;
  }

  .box .copy {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0 var(--space-6);
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

  /* An excluded job: the ban and its word in red, the reason ink. */
  .ban {
    --notice-fg: var(--text);
    --notice-sign: var(--ban);
  }

  .ban .heading {
    color: var(--ban);
  }
</style>
