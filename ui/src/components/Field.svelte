<!--
  One field, one layout (design round 6): the label (the app's text in medium, ink) above the
  control, 6 apart (--label-gap), then the hint (or the error in its place) and the hint's
  way on under the control on the same left edge; the way on stays while an error shows: it
  is what helps most then. The way on is a navy link (it underlines on hover) whose text
  lines up with the edges of the field, and it always ends the helper line: the message
  beside it shrinks and wraps. The message's id is shared with the control inside (its
  `aria-describedby`) only while a message shows.
  Beside the label an info symbol (`info`, InfoTip: only where docs/PLAN.md places one, and
  never with a hint). Without `for` the field holds a group of controls (rows, choices) that
  its label names. The control keeps its own width: a list fills the field, a number or a
  day is --number-width, a choice of a few as wide as its options.
-->
<script lang="ts">
  import { describe } from '$lib/state/described';
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import InfoTip from './InfoTip.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    label: string;
    /** id of the control inside, for the label; none: a group of controls. */
    for?: string | null;
    hint?: string | null;
    /** The one sentence of the info symbol beside the label (never with a hint). */
    info?: string | null;
    /** A way on that belongs to the hint (opens a page), at the end of the helper line. */
    action?: { label: string; icon?: IconName; testid?: string; onclick: () => void } | null;
    error?: string | null;
    children: Snippet;
  }

  let {
    label,
    for: target = null,
    hint = null,
    info = null,
    action = null,
    error = null,
    children,
  }: Props = $props();

  const own = $props.id();
  const control = $derived(target ?? own);
  describe(() => (error || hint ? `${control}-message` : null));
</script>

<div
  class="field"
  role={target === null ? 'group' : undefined}
  aria-labelledby={target === null ? `${own}-label` : undefined}
>
  <div class="top">
    {#if target === null}
      <span class="label" id="{own}-label">{label}</span>
    {:else}
      <label class="label" for={target}>{label}</label>
    {/if}
    {#if info && !hint}<InfoTip text={info} label={t.common.infoAbout(label)} />{/if}
  </div>
  <div class="control">{@render children()}</div>
  {#if error || hint || action}
    <div class="help" class:acts={action !== null}>
      {#if error}
        <p class="error" id="{control}-message" role="alert">
          <Icon name="warning" size="sm" />
          <span>{error}</span>
        </p>
      {:else if hint}
        <p class="hint" id="{control}-message">{hint}</p>
      {/if}
      {#if action}
        <span class="action">
          <Button
            variant="link"
            icon={action.icon ?? null}
            label={action.label}
            testid={action.testid ?? null}
            onclick={action.onclick}
          />
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The label, the control and the help one under the other on one left edge. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--label-gap);
    min-width: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  /* The control and what belongs under it ("Häufig verlangt"), one under the other. */
  .control {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* As wide as its text: a click beside the label is a click beside the field, and that ends
     the field's focus (a click on the words still leads into the field). */
  .label {
    align-self: flex-start;
    color: var(--text);
    font: var(--type-label);
    cursor: default;
  }

  .hint,
  .error {
    font: var(--type-sm);
  }

  .hint {
    color: var(--text-muted);
  }

  .help {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-12);
    min-height: var(--control-sm);
  }

  /* With a way on, the message shrinks and the way on ends its first line. */
  .acts {
    flex-wrap: nowrap;
    align-items: flex-start;
  }

  .acts > .hint,
  .acts > .error {
    flex: 1 1 auto;
    min-width: 0;
    padding-block: calc((var(--control-sm) - var(--leading-sm)) / 2);
  }

  .action {
    display: inline-flex;
    flex: none;
    margin-left: auto;
  }

  /* The icon sits on the first line when a message wraps. */
  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    color: var(--danger-strong);
  }

  .error > :global(:first-child) {
    flex: none;
    margin-top: calc((var(--leading-sm) - var(--icon-sm)) / 2);
  }
</style>
