<!--
  One field, one layout (the round 10 draft): the label (13/540 ink, --field-label: red while
  the field is required and still empty, `[data-missing]` in tokens.css) 6 above the control,
  then the hint (13 muted) or the error in its place (Notice: the sign and the red of what
  is wrong, the one look of every refused value) under the control on the same left edge. The message's id is shared with the control inside (its
  `aria-describedby`) only while a message shows.
  The label's row holds what belongs to the field: the info symbol beside the label (`info`,
  InfoTip: only where docs/PLAN.md places one, and never with a hint) and at its right end
  the field's links (`links`, Button `link` in the label's size: 13/500 navy with the external
  glyph, 14 apart: "App-Passwort erstellen"). Without `for` the field holds a group of controls
  (rows, choices) that its label names. The control keeps its own width: a list fills the field,
  a number or a day is as wide as its token, a choice of a few as wide as its options.
  As a row (`row`, the Profil: a row of its group's box, like a row of Einstellungen) the
  label (14/540) stands in a column of 188 beside the control, 24 before it, on the height of
  a field (30): a single-line control is centred on it, a tag field or a list starts there,
  so the label stays on its first line; the message stands right under the control, the links
  under the message. In a box under 560 wide the label stands 8 above its control instead.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  /** A link of a field at the right end of its label's row (it opens a page). */
  export interface FieldLink {
    label: string;
    icon?: IconName;
    testid?: string;
    onclick: () => void;
  }
</script>

<script lang="ts">
  import { describe } from '$lib/state/described';
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import InfoTip from './InfoTip.svelte';
  import Notice from './Notice.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    label: string;
    /** id of the control inside, for the label; none: a group of controls. */
    for?: string | null;
    hint?: string | null;
    /** The one sentence of the info symbol beside the label (never with a hint). */
    info?: string | null;
    /** The field's links at the right end of the label's row. */
    links?: readonly FieldLink[];
    error?: string | null;
    /** A row of a box: the label in its column beside the control. */
    row?: boolean;
    children: Snippet;
  }

  let {
    label,
    for: target = null,
    hint = null,
    info = null,
    links = [],
    error = null,
    row = false,
    children,
  }: Props = $props();

  const own = $props.id();
  const control = $derived(target ?? own);
  describe(() => (error || hint ? `${control}-message` : null));
</script>

{#snippet wayLinks()}
  <span class="links">
    {#each links as link (link.label)}
      <Button
        variant="link"
        icon={link.icon ?? 'external'}
        label={link.label}
        testid={link.testid ?? null}
        onclick={() => link.onclick()}
      />
    {/each}
  </span>
{/snippet}

<div
  class="field"
  class:row
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
    {#if links.length > 0 && !row}{@render wayLinks()}{/if}
  </div>
  <div class="body">
    <div class="control">{@render children()}</div>
    {#if error}
      <div id="{control}-message"><Notice tone="danger" text={error} /></div>
    {:else if hint}
      <p class="hint" id="{control}-message">{hint}</p>
    {/if}
    {#if links.length > 0 && row}{@render wayLinks()}{/if}
  </div>
</div>

<style>
  /* The label, the control and the message one under the other on one left edge. */
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--label-gap);
    min-width: 0;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  /* Above its control the message follows the control on the field's own gap. */
  .body {
    display: contents;
  }

  /* The control and what belongs under it, one under the other. */
  .control {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* As wide as its text: a click beside the label is a click beside the field, and that ends
     the field's focus (a click on the words still leads into the field). */
  .label {
    color: var(--field-label);
    font: var(--type-field-label);
    cursor: default;
  }

  /* A link keeps its hit area but takes only the height of the label's line. */
  .links {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2) var(--field-link-gap);
    margin-block: calc((var(--leading-sm) - var(--control-sm)) / 2);
    margin-left: auto;
  }

  /* In the label's size: its words 13, its glyph 14. */
  .links :global(.btn.link) {
    --btn-type: var(--field-link);
    --btn-gap: var(--space-4);
  }

  .links :global(.btn.link .icon) {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-stroke-xs);
  }

  .hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* A row: the label's column beside the control and its message, the label on the height of
     a field so it stands on the control's first line. */
  .row {
    display: grid;
    grid-template-columns: var(--profile-label-width) minmax(0, 1fr);
    align-items: start;
    gap: var(--profile-label-gap-narrow) var(--profile-label-gap);
  }

  .row .top {
    min-height: var(--control-field);
  }

  /* Under the control, on its left edge. */
  .row .links {
    justify-content: flex-start;
    margin-left: 0;
  }

  .row .label {
    font: var(--type-label);
  }

  .row .body {
    display: flex;
    flex-direction: column;
    gap: var(--label-gap);
    min-width: 0;
  }

  /* A control lower than a field (the checkboxes) is centred on its height. */
  .row .control {
    justify-content: center;
    min-height: var(--control-field);
  }

  @container (width < 560px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }

    .row .top {
      min-height: 0;
    }

    .row .control {
      min-height: 0;
    }
  }
</style>
