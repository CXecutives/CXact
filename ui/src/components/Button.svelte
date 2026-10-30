<!--
  The button of the app: primary | secondary | ghost | danger | link (round 10).
  Calm on contact: hover-in changes colour in 80 ms and relaxes in 150 ms, a press only
  darkens it; nothing scales, lifts, glows, bounces or moves, the arrows of Zurück and
  Weiter included (owner, 2026-10-29).
  - One height, 30 px, for every button with words or a box (core/tests/ui_contract.rs);
    the quiet icon-only button (ghost) takes 28 by itself, a button in a field (`inField`)
    24. Words in 500 14 px (a primary stands out by its colour only), every glyph 16 px. A text
    button carries the glyph of its meaning.
  - At most one primary per view (checked by core/tests/ui_contract.rs). The red fill
    (`danger`) only confirms in a dialog.
  - iconOnly needs its label: it becomes aria-label and tooltip; a glyph that says it all
    goes without the tooltip (`plain`). A button with its words never repeats them in a
    tooltip (core/tests/ui_contract.rs), it only says why it waits.
  - Disabled buttons stay hoverable (aria-disabled) so the tooltip can say why; they do
    not react otherwise. Tab passes them like native disabled buttons, except one that says
    why (`disabledReason`): it stays a Tab stop, and its tooltip shows on keyboard focus.
  - One width while it swaps: `loading` keeps it (the content fades out under the spinner,
    white on a filled button),
    and `sizeTo` names the words (and glyphs) that take its place (Jobs suchen and
    Abbrechen, Speichern and its busy state): hidden copies of them share its content's
    grid cell, so it is as wide as the widest, without a number. A container gives a pair
    one least width through `--btn-min` (`var(--button-pair-min)`).
  - link: navy text that underlines on hover.
  - inField: inside a text field (show password, clear search): no Tab stop, a click keeps
    the caret in the field. isDefault: the one Enter presses in a dialog (it marks it).
  - A double click acts once: its second click does nothing (a text button opened its page
    twice, the next step's control under the pointer took it). `repeats` (Zurück and Vor)
    takes both clicks, a step each.
  The icon sits on its own HTML wrapper: transforms on SVG children run on the main thread.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

  /** What may stand in a button's place: other words, with or without a glyph. */
  export type ButtonFace = string | { label: string; icon?: IconName | null };
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { fade } from '$lib/motion/transitions';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    label: string;
    variant?: ButtonVariant;
    icon?: IconName | null;
    iconOnly?: boolean;
    loading?: boolean;
    disabled?: boolean;
    /** Why the button is disabled - shown in the tooltip. */
    disabledReason?: string | null;
    type?: 'button' | 'submit';
    /** Toggle buttons. */
    pressed?: boolean | null;
    /** Fill the width of the container. */
    wide?: boolean;
    /** Sits inside a text field: skipped by Tab, a click keeps the focus in the field. */
    inField?: boolean;
    /** A glyph after the label (the chevron of a menu button). */
    trailing?: IconName | null;
    /** It opens a menu (announced as such). */
    menu?: boolean;
    /** Its menu is open: announced, and the button keeps its hover look meanwhile. */
    expanded?: boolean;
    /** The default of a dialog (Enter presses it); Dialog gives it the focus. */
    isDefault?: boolean;
    /** Each click of a double click acts (Zurück and Vor step twice); else the second does
     *  nothing. */
    repeats?: boolean;
    /** An icon-only button whose glyph says it all: no tooltip of its name. */
    plain?: boolean;
    /** The glyph under the pointer and the keyboard focus: what a click does. */
    /** The faces that take this button's place: it keeps the width of the widest. */
    sizeTo?: readonly ButtonFace[] | null;
    testid?: string | null;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    label,
    variant = 'secondary',
    icon = null,
    iconOnly = false,
    loading = false,
    disabled = false,
    disabledReason = null,
    type = 'button',
    pressed = null,
    wide = false,
    inField = false,
    trailing = null,
    menu = false,
    expanded = false,
    isDefault = false,
    repeats = false,
    plain = false,
    sizeTo = null,
    testid = null,
    onclick,
  }: Props = $props();

  const inactive = $derived(disabled || loading);
  const tip = $derived(
    disabled && disabledReason ? disabledReason : iconOnly && !plain ? label : null,
  );
  /** The hidden faces that reserve the width of the others. */
  const others = $derived(
    iconOnly || sizeTo === null
      ? []
      : sizeTo.map((face) => (typeof face === 'string' ? { label: face, icon } : face)),
  );
  /** A filled button: its spinner takes the colour of its words, not navy on coral. */
  const filled = $derived(variant === 'primary' || variant === 'danger');

  function handle(event: MouseEvent): void {
    // The second click of a double click (the keyboard's click has no count).
    if (inactive || (event.detail > 1 && !repeats)) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

<button
  {type}
  class="btn {variant}"
  class:icon-only={iconOnly}
  class:in-field={inField}
  class:wide={wide && !iconOnly}
  class:loading
  class:default={isDefault}
  aria-label={iconOnly ? label : undefined}
  aria-disabled={disabled ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
  aria-pressed={pressed === null ? undefined : pressed}
  aria-haspopup={menu ? 'menu' : undefined}
  aria-expanded={menu ? expanded : undefined}
  tabindex={inField || (disabled && !disabledReason) ? -1 : undefined}
  data-keep-focus={inField ? '' : undefined}
  data-testid={testid ?? undefined}
  use:tooltip={tip}
  onclick={handle}
>
  <span class="content">
    <span class="face">
      {#if icon}
        <span class="glyph" data-icon={icon}>
          <Icon name={icon} size="sm" filled={pressed === true} />
        </span>
      {/if}
      {#if !iconOnly}<span class="label">{label}</span>{/if}
      {#if trailing}
        <span class="trailing" data-icon={trailing} aria-hidden="true"
          ><Icon name={trailing} size="sm" /></span
        >
      {/if}
    </span>
    {#each others as other, index (index)}
      <span class="face sizer" aria-hidden="true" data-sizer>
        {#if other.icon}<span class="glyph"><Icon name={other.icon} size="sm" /></span>{/if}
        <span class="label">{other.label}</span>
        {#if trailing}<span class="trailing"><Icon name={trailing} size="sm" /></span>{/if}
      </span>
    {/each}
  </span>
  {#if loading}
    <span class="busy" in:fade
      ><Spinner size="sm" tone={filled ? 'current' : 'navy'} label={null} /></span
    >
  {/if}
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    min-width: var(--btn-min, 0);
    height: var(--btn-height);
    padding: 0 var(--btn-pad);
    border: var(--border-width) solid var(--btn-border);
    border-radius: var(--btn-radius);
    background-color: var(--btn-bg);
    box-shadow: var(--btn-shadow);
    color: var(--btn-fg);
    font: var(--btn-type);
    white-space: nowrap;
    --btn-pad: var(--button-pad);
    --btn-gap: var(--space-6);
    --btn-type: var(--type-control);
    --btn-radius: var(--radius-control);

    transition:
      background-color var(--dur-base) var(--ease-standard),
      border-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  /* The faces share one grid cell: the button is as wide as the widest of them. */
  .content {
    display: inline-grid;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .face {
    display: inline-flex;
    grid-area: 1 / 1;
    align-items: center;
    justify-content: center;
    gap: var(--btn-gap);
  }

  .sizer {
    visibility: hidden;
  }

  .trailing {
    display: inline-flex;
    margin-right: calc(-1 * var(--space-4));
  }

  .glyph,
  .trailing {
    position: relative;
    display: inline-flex;
  }

  .busy {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loading .content {
    opacity: 0;
  }

  /* Hover-in in 80 ms; leaving relaxes in the base rule's 150 ms. */
  .btn:not([aria-disabled='true'], .loading):hover {
    border-color: var(--btn-border-hover);
    background-color: var(--btn-bg-hover);
    color: var(--btn-fg-hover);
    transition-duration: var(--dur-hover);
  }

  /* The button of an open menu keeps its hover look while the menu is open. */
  .btn[aria-expanded='true'] {
    border-color: var(--btn-border-hover);
    background-color: var(--btn-bg-hover);
    color: var(--btn-fg-hover);
  }

  /* Pressed: only while the left button is down (input.ts marks a press of the others). */
  :global(:where(:root:not([data-aux-press])))
    .btn:not([aria-disabled='true'], .loading):active:hover {
    border-color: var(--btn-border-active);
    background-color: var(--btn-bg-active);
    transition-duration: var(--dur-instant);
  }

  .btn[aria-disabled='true'] {
    opacity: var(--opacity-disabled);
  }

  .btn[aria-disabled='true'],
  .loading {
    cursor: default;
  }

  /* ------------------------------------------------------------ variants */
  /* Coral with a faint shadow under it; one step deeper under the pointer, one more pressed. */
  .primary {
    --btn-bg: var(--primary);
    --btn-bg-hover: var(--primary-hover);
    --btn-bg-active: var(--primary-active);
    --btn-border: var(--primary);
    --btn-border-hover: var(--primary-hover);
    --btn-border-active: var(--primary-active);
    --btn-fg: var(--text-on-accent);
    --btn-fg-hover: var(--text-on-accent);
    --btn-shadow: var(--sh-primary);
    --icon-stroke-more: var(--icon-stroke-on-fill);
  }

  /* White with its edge, no shadow: the warm wash and a darker edge under the pointer, a
     deeper wash pressed. */
  .secondary {
    --btn-bg: var(--surface);
    --btn-bg-hover: var(--button-hover);
    --btn-bg-active: var(--button-press);
    --btn-border: var(--border-strong);
    --btn-border-hover: var(--control-hover-edge);
    --btn-border-active: var(--control-hover-edge);
    --btn-fg: var(--text);
    --btn-fg-hover: var(--text);
    --btn-shadow: none;
  }

  /* A secondary toggle that is on: the track with navy words, like a chosen option. */
  .secondary[aria-pressed='true'] {
    --btn-bg: var(--chosen-surface);
    --btn-bg-hover: var(--chosen-surface);
    --btn-bg-active: var(--chosen-surface);
    --btn-fg: var(--chosen-text);
    --btn-fg-hover: var(--chosen-text);
  }

  /* The quiet kind: no box, a wash under the pointer, a deeper one pressed. Words in ink; a
     lone glyph in the top bar's grey until pointed at. */
  .ghost {
    --btn-bg: transparent;
    --btn-bg-hover: var(--surface-hover-quiet);
    --btn-bg-active: var(--quiet-press);
    --btn-border: transparent;
    --btn-border-hover: transparent;
    --btn-border-active: transparent;
    --btn-fg: var(--text);
    --btn-fg-hover: var(--text);
    --btn-shadow: none;
  }

  .ghost.icon-only {
    --btn-fg: var(--titlebar-fg);
  }

  .ghost[aria-pressed='true'] {
    --btn-fg: var(--pressed);
    --btn-fg-hover: var(--pressed);
  }

  .danger {
    --btn-bg: var(--danger-fill);
    --btn-bg-hover: var(--danger-fill-hover);
    --btn-bg-active: var(--danger-fill-active);
    --btn-border: var(--danger-fill);
    --btn-border-hover: var(--danger-fill-hover);
    --btn-border-active: var(--danger-fill-active);
    --btn-fg: var(--text-on-danger);
    --btn-fg-hover: var(--text-on-danger);
    --btn-shadow: var(--sh-primary);
    --icon-stroke-more: var(--icon-stroke-on-fill);
  }

  /* Navy text, no box; it underlines on hover and dims while pressed (it is text). */
  .btn.link {
    --btn-bg: transparent;
    --btn-bg-hover: transparent;
    --btn-bg-active: transparent;
    --btn-border: transparent;
    --btn-border-hover: transparent;
    --btn-border-active: transparent;
    --btn-fg: var(--link);
    --btn-fg-hover: var(--link-hover);
    --btn-shadow: none;
    --btn-pad: 0;

    transition:
      color var(--dur-base) var(--ease-standard),
      opacity var(--dur-base) var(--ease-standard);
  }

  .link .label {
    position: relative;
  }

  .link .label::after {
    position: absolute;
    inset: auto 0 0;
    height: var(--border-width);
    background-color: currentcolor;
    content: '';
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-standard);
  }

  .link:not([aria-disabled='true'], .loading):hover .label::after {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press])))
    .link:not([aria-disabled='true'], .loading):active:hover {
    opacity: var(--opacity-press);
    transition-duration: var(--dur-instant);
  }

  /* --------------------------------------------------------------- sizes */
  /* One height, 30 px; the quiet glyph 28, in a field (and a link) 24. */
  .btn {
    --btn-height: var(--control-field);
  }

  .ghost.icon-only {
    --btn-height: var(--control-icon);
  }

  .btn.in-field,
  .btn.link {
    --btn-height: var(--control-sm);
  }

  .icon-only {
    width: var(--btn-height);
    min-width: 0;
    padding: 0;
  }

  .wide {
    width: 100%;
  }
</style>
