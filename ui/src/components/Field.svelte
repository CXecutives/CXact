<!--
  Label, control, hint (or the error in its place) and the hint's way on, which stays while
  an error shows: it is what helps most then. The way on is a navy link (it underlines on
  hover; one that leaves the app shows the hand) whose text lines up with the edges of the
  field, and it always ends the helper line: the message beside it shrinks and wraps, so it
  stands in the same place in a half-width field as in a full-width one. The message's id is
  shared with the control inside (its `aria-describedby`) only while a message shows.
  Beside the label an info symbol (`info`, InfoTip: only where docs/PLAN.md places one, and
  never with a hint). Without `for` the field holds a group of controls (rows, choices) that
  its label names. `side`: where its container is wide enough (420 px), the label stands in a
  column of its own at the left (--label-column), centred on the control's first line, and
  the control and its helper line in the column beside it (the rows of the Profil and of the
  setup's short form).
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
    /** The label in a column of its own at the left (where the container is wide enough). */
    side?: boolean;
    /** The label beside its control at every width (a switch's row). */
    inline?: boolean;
    children: Snippet;
  }

  let {
    label,
    for: target = null,
    hint = null,
    info = null,
    action = null,
    error = null,
    side = false,
    inline = false,
    children,
  }: Props = $props();

  const own = $props.id();
  const control = $derived(target ?? own);
  describe(() => (error || hint ? `${control}-message` : null));
</script>

<div
  class="field"
  class:side
  class:inline
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
            external={action.icon === 'external'}
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
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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

  @container (width >= 420px) {
    .side {
      display: grid;
      grid-template-columns: var(--label-column) minmax(0, 1fr);
      align-items: start;
      gap: var(--space-6) var(--space-12);
    }

    .side > .top {
      grid-row: 1;
      grid-column: 1;
      min-height: var(--control-field);
    }

    .side .label {
      align-self: center;
    }

    .side > :not(.top) {
      grid-column: 2;
    }
  }

  /* A switch's row: the label beside it at every width. */
  .inline {
    display: grid;
    grid-template-columns: var(--label-column) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-6) var(--space-12);
  }

  .inline > .top {
    min-height: var(--control-field);
  }

  .inline .label {
    align-self: center;
  }

  /* As wide as its text: a click beside the label is a click beside the field, and that ends
     the field's focus (a click on the words still leads into the field). */
  .label {
    align-self: flex-start;
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
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
