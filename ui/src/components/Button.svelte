<!--
  The button of the app: primary | secondary | ghost | danger | link | suggest. Native
  in feel, calm on contact: hover-in changes colour in 80 ms and relaxes in 150 ms, every
  icon stays still and behaves alike (no nudges, user 2026-09-25), a press only darkens it
  (no shrink, user 2026-10-03); no stretch, lift, glow or bounce.
  - One height for every button, 28 px (design round 6, core/tests/ui_contract.rs): in rows,
    tools, the top bar, dialogs and empty states alike; the app's text in medium (a primary's
    in semibold), every glyph 15 px. Only a button in a field (`inField`) and a suggestion are
    a notch lower. A text button carries the glyph of its meaning (lib/icons.ts).
  - At most one primary per view (checked by core/tests/ui_contract.rs).
  - iconOnly needs its label: it becomes aria-label and tooltip; a glyph that says it all
    (the x that removes a row) goes without the tooltip (`plain`). A button with its words
    never repeats them in a tooltip (core/tests/ui_contract.rs), it only says why it waits.
  - Disabled buttons stay hoverable (aria-disabled) so the tooltip can say why; they do
    not react otherwise. Tab passes them like native disabled buttons, except one that says
    why (`disabledReason`): it stays a Tab stop, and its tooltip shows on keyboard focus
    (one that is disabled while focused keeps the focus).
  - Loading keeps the width: the content fades out under the spinner.
  - radio: an option of a radiogroup, like a secondary toggle, chosen while `checked`, only
    the group's Tab stop (`stop`) in the Tab order, the arrows move (input.ts). turned: the
    glyph stands half a turn (180 ms).
  - dot: a coral dot at the glyph's corner, something of it is on (the list's funnel while a
    filter narrows it; the chips say what). link: navy text that underlines on hover.
    suggest: a quiet chip under a Profil field ("Häufig verlangt", the quick picks).
  - inText: a link inside a sentence (the missing line's names), in the sentence's type.
  - inField: inside a text field (show password, clear search): no Tab stop, a click keeps
    the caret in the field. isDefault: the one Enter presses in a dialog (it marks it).
  - warns: a quiet (secondary or ghost) button whose action deletes or loses something
    (empty the trash, remove the mailbox, reset everything): its text and glyph are red at
    rest, before the dialog asks; no icon warns by itself.
  - deletes: a quiet icon button that deletes for good (a job's Endgültig löschen, in its row
    and its reader): its glyph red at rest, on a red wash under the pointer.
  - count: a quiet number after the label (a suggestion chip, the hits in another place).
  - hoverIcon: the glyph that says what a click does, in the place of the glyph at rest under
    the pointer and the keyboard focus (the top bar's panels: panel-left, and its -close).
  The icon sits on its own HTML wrapper: transforms on SVG children run on the main thread.
-->
<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'suggest';
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { formatNumber } from '$lib/i18n/format';
  import { fade } from '$lib/motion/transitions';
  import Icon, { type IconName } from './Icon.svelte';
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
    /** An option of a radiogroup: whether it is chosen and whether it is the group's Tab stop. */
    radio?: { checked: boolean; stop: boolean } | null;
    /** The glyph stands half a turn. */
    turned?: boolean;
    /** A small dot at the glyph's corner: something of it is on (an active filter). */
    dot?: boolean;
    /** Fill the width of the container. */
    wide?: boolean;
    /** Sits inside a text field: skipped by Tab, a click keeps the focus in the field. */
    inField?: boolean;
    /** A link inside a sentence: the sentence's type and line. */
    inText?: boolean;
    /** A glyph after the label (the chevron of a menu button). */
    trailing?: IconName | null;
    /** It opens a menu (announced as such). */
    menu?: boolean;
    /** Its menu is open: announced, and the button keeps its hover look meanwhile. */
    expanded?: boolean;
    /** The default of a dialog (Enter presses it); Dialog gives it the focus. */
    isDefault?: boolean;
    /** Deletes, removes or resets something: red text and glyph (secondary and ghost). */
    warns?: boolean;
    /** Deletes for good (a job's tool): red at rest, on a red wash under the pointer (ghost). */
    deletes?: boolean;
    /** An icon-only button whose glyph says it all: no tooltip of its name. */
    plain?: boolean;
    count?: number | null;
    /** The glyph under the pointer and the keyboard focus: what a click does. */
    hoverIcon?: IconName | null;
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
    radio = null,
    turned = false,
    dot = false,
    wide = false,
    inField = false,
    inText = false,
    trailing = null,
    menu = false,
    expanded = false,
    isDefault = false,
    warns = false,
    deletes = false,
    plain = false,
    count = null,
    hoverIcon = null,
    testid = null,
    onclick,
  }: Props = $props();

  const inactive = $derived(disabled || loading);
  const tip = $derived(
    disabled && disabledReason ? disabledReason : iconOnly && !plain ? label : null,
  );

  function handle(event: MouseEvent): void {
    if (inactive) {
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
  class:in-text={inText}
  class:wide={wide && !iconOnly}
  class:loading
  class:turned
  class:default={isDefault}
  class:warns
  class:deletes
  class:swaps={hoverIcon !== null}
  aria-label={iconOnly ? label : undefined}
  aria-disabled={disabled ? 'true' : undefined}
  aria-busy={loading ? 'true' : undefined}
  role={radio ? 'radio' : undefined}
  aria-checked={radio ? radio.checked : undefined}
  aria-pressed={pressed === null || radio ? undefined : pressed}
  aria-haspopup={menu ? 'menu' : undefined}
  aria-expanded={menu ? expanded : undefined}
  tabindex={inField || (disabled && !disabledReason) || (radio && !radio.stop)
    ? -1
    : radio
      ? 0
      : undefined}
  data-keep-focus={inField ? '' : undefined}
  data-testid={testid ?? undefined}
  use:tooltip={tip}
  onclick={handle}
>
  <span class="content">
    {#if icon}
      <span class="glyph" data-icon={icon}>
        <Icon name={icon} size={variant === 'suggest' ? 'xs' : 'sm'} filled={pressed === true} />
        {#if hoverIcon}<span class="swap" data-hover-icon={hoverIcon}
            ><Icon name={hoverIcon} size="sm" /></span
          >{/if}
        {#if dot}<span class="dot" aria-hidden="true" data-testid="button-dot"></span>{/if}
      </span>
    {/if}
    {#if !iconOnly}
      <span class="label">{label}</span>
      {#if count !== null}<span class="count">{formatNumber(count)}</span>{/if}
    {/if}
    {#if trailing}
      <span class="trailing" aria-hidden="true"><Icon name={trailing} size="sm" /></span>
    {/if}
  </span>
  {#if loading}
    <span class="busy" in:fade><Spinner size="sm" label={null} /></span>
  {/if}
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    height: var(--btn-height);
    padding: 0 var(--btn-pad);
    border: var(--border-width) solid var(--btn-border);
    border-radius: var(--radius-control);
    background-color: var(--btn-bg);
    box-shadow: var(--btn-shadow);
    color: var(--btn-fg);
    font: var(--btn-type);
    white-space: nowrap;
    --btn-pad: var(--button-pad);
    --btn-gap: var(--space-6);
    --btn-type: var(--type-label);

    transition:
      background-color var(--dur-base) var(--ease-standard),
      border-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .content {
    display: inline-flex;
    align-items: center;
    gap: var(--btn-gap);
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .trailing {
    display: inline-flex;
    margin-right: calc(-1 * var(--space-4));
  }

  /* Quiet: how many there are. */
  .count {
    color: var(--text-subtle);
    font-variant-numeric: var(--numeric);
  }

  .glyph {
    position: relative;
    display: inline-flex;
    transition: transform var(--dur-base) var(--ease-emphasized);
  }

  /* What a click does stands in for the glyph at rest under the pointer and the keyboard
     focus, at once: both share their frame, so only the arrow comes and goes. */
  .swap {
    position: absolute;
    inset: 0;
    display: inline-flex;
    visibility: hidden;
  }

  .swaps:not([aria-disabled='true'], .loading):is(:hover, :focus-visible) .swap {
    visibility: visible;
  }

  .swaps:not([aria-disabled='true'], .loading):is(:hover, :focus-visible) .glyph > :global(.icon) {
    visibility: hidden;
  }

  /* Something of it is on: a coral dot on the glyph's corner (approved design, 2026-09-26). */
  .dot {
    position: absolute;
    inset: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) auto auto;
    width: var(--dot-unread);
    height: var(--dot-unread);
    border-radius: var(--radius-full);
    background-color: var(--unread);
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

  /* A state, not a nudge: half a turn in 180 ms (the angle stays under reduced motion). */
  .turned .glyph {
    transform: rotate(var(--turn-half));
    transition-duration: var(--dur-slow);
  }

  .btn[aria-disabled='true'] {
    opacity: var(--opacity-disabled);
  }

  .btn[aria-disabled='true'],
  .loading {
    cursor: default;
  }

  /* ------------------------------------------------------------ variants */
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

    font-weight: var(--weight-semibold);
  }

  /* The control kind (tokens.css): a muted fill and a darker edge under the pointer, one
     opaque step darker while pressed. */
  .secondary {
    --btn-bg: var(--surface);
    --btn-bg-hover: var(--control-hover);
    --btn-bg-active: var(--control-press);
    --btn-border: var(--border-strong);
    --btn-border-hover: var(--control-hover-edge);
    --btn-border-active: var(--control-press-edge);
    --btn-fg: var(--text);
    --btn-fg-hover: var(--text);
    --btn-shadow: var(--sh-xs);
  }

  /* A secondary toggle that is on or a chosen option of a radiogroup: the navy trio. */
  .secondary[aria-pressed='true'],
  .secondary[aria-checked='true'] {
    --btn-bg: var(--active-surface);
    --btn-bg-hover: var(--active-surface);
    --btn-bg-active: var(--active-surface);
    --btn-border: var(--active-edge);
    --btn-border-hover: var(--active-edge);
    --btn-border-active: var(--active-edge);
    --btn-fg: var(--active-text);
    --btn-fg-hover: var(--active-text);
  }

  /* The quiet kind (tokens.css): a wash under the pointer, a deeper one pressed. */
  .ghost {
    --btn-bg: transparent;
    --btn-bg-hover: var(--quiet-hover);
    --btn-bg-active: var(--quiet-press);
    --btn-border: transparent;
    --btn-border-hover: transparent;
    --btn-border-active: transparent;
    --btn-fg: var(--text-muted);
    --btn-fg-hover: var(--text);
    --btn-shadow: none;
  }

  /* Deleting or losing something: red at rest, before the dialog asks (its confirm fills). */
  .ghost.warns,
  .secondary.warns {
    --btn-fg: var(--danger-strong);
    --btn-fg-hover: var(--danger-strong);
  }

  /* Deleting (a row's tool): red at rest like every delete, on a red wash under the pointer. */
  .ghost.deletes {
    --btn-fg: var(--danger-strong);
    --btn-fg-hover: var(--danger-strong);
    --btn-bg-hover: var(--danger-soft);
    --btn-bg-active: var(--danger-soft);
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
  }

  /* A suggestion: a quiet chip on the track's fill, small words, ink under the pointer. */
  .suggest {
    --btn-bg: var(--surface-track);
    --btn-bg-hover: var(--btn-bg);
    --btn-bg-active: var(--btn-bg);
    --btn-border: var(--btn-bg);
    --btn-border-hover: var(--btn-bg);
    --btn-border-active: var(--btn-bg);
    --btn-fg: var(--text-muted);
    --btn-fg-hover: var(--text);
    --btn-shadow: none;
    --btn-pad: var(--space-8);
    --btn-gap: var(--space-4);
    --btn-type: var(--type-sm);

    font-weight: var(--weight-medium);
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
  /* One height, one type: 28 px; in a field (and a suggestion) a notch lower. */
  .btn {
    --btn-height: var(--control-field);
  }

  .in-field,
  .link,
  .suggest {
    --btn-height: var(--control-sm);
  }

  /* A link in a sentence takes the sentence's type and line, and no room of its own. */
  .in-text {
    --btn-height: auto;
    --btn-type: inherit;

    border-width: 0;
  }

  .icon-only {
    width: var(--btn-height);
    padding: 0;
  }

  .wide {
    width: 100%;
  }
</style>
