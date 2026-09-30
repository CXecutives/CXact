<!--
  The button of the app: primary | secondary | ghost | danger | link × sm | field. Native
  in feel, calm on contact: hover-in changes colour in 80 ms and relaxes in 150 ms, every
  icon stays still and behaves alike (no nudges, user 2026-09-25), a press lets the button
  give a little (0.98, 60 ms) and settles back in 150 ms; no stretch, lift, glow or bounce.
  - Two heights only (core/tests/ui_contract.rs): sm (28 px) for trailing actions inside a
    row and tools; field (32 px, the default) for everything else: action bars, dialogs,
    empty states, a button in a row of fields. Both use the small type; every glyph is 16 px.
  - At most one primary per view (checked by core/tests/ui_contract.rs).
  - iconOnly needs its label: it becomes aria-label and tooltip; a glyph that says it all
    (the x that removes a row) goes without the tooltip (`plain`). A button with its words
    never repeats them in a tooltip (core/tests/ui_contract.rs), it only says why it waits.
  - Disabled buttons stay hoverable (aria-disabled) so the tooltip can say why; they do
    not react otherwise. Tab passes them like native disabled buttons, except one that says
    why (`disabledReason`): it stays a Tab stop, and its tooltip shows on keyboard focus
    (one that is disabled while focused keeps the focus).
  - Loading keeps the width: the content fades out under the spinner. A ghost toggle (the
    star of a Schwerpunkt) pops once when a click switches it on.
  - radio: an option of a radiogroup (profile/ChoiceButtons), like a secondary toggle, chosen
    while `checked`, only the group's Tab stop (`stop`) in the Tab order, the arrows move
    (input.ts); 14 px text like a field. turned: the glyph stands half a turn (180 ms).
  - dot: a coral dot at the glyph's corner, something of it is on (the list's funnel while a
    filter narrows it; the chips say what). link: navy text that underlines on hover.
  - inField: inside a text field (show password, clear search): no Tab stop, a click keeps
    the caret in the field. isDefault: the one Enter presses in a dialog (it marks it).
  - warns: a quiet (secondary or ghost) button whose action deletes or loses something
    (empty the trash, remove the mailbox, reset the app): its text and glyph are red at
    rest, before the dialog asks; no icon warns by itself.
  - deletes: a quiet icon button that deletes (a job row's Löschen and Endgültig löschen):
    its glyph red at rest like every delete of the app, on a red wash under the pointer.
  - count: a quiet number after the label (how many lie there), like the place tabs.
  The icon sits on its own HTML wrapper: transforms on SVG children run on the main thread.
-->
<script lang="ts" module>
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  export type ButtonSize = 'sm' | 'field';
  export const BUTTON_VARIANTS: readonly ButtonVariant[] = [
    'primary',
    'secondary',
    'ghost',
    'danger',
    'link',
  ];
  export const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'field'];
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { formatNumber } from '$lib/i18n/format';
  import { fade, pulseOnce } from '$lib/motion/transitions';
  import Icon, { type IconName } from './Icon.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    label: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: IconName | null;
    iconOnly?: boolean;
    loading?: boolean;
    disabled?: boolean;
    /** Why the button is disabled - shown in the tooltip. */
    disabledReason?: string | null;
    type?: 'button' | 'submit';
    /** Toggle buttons (the star of a Schwerpunkt). */
    pressed?: boolean | null;
    /** An option of a radiogroup: whether it is chosen and whether it is the group's Tab stop. */
    radio?: { checked: boolean; stop: boolean } | null;
    /** The glyph stands half a turn. */
    turned?: boolean;
    /** A small dot at the glyph's corner: something of it is on (an active filter). */
    dot?: boolean;
    /** Opens something outside the app (a link shows the hand then). */
    external?: boolean;
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
    /** The default of a dialog (Enter presses it); Dialog marks it with the focus ring. */
    isDefault?: boolean;
    /** Deletes, removes or resets something: red text and glyph (secondary and ghost). */
    warns?: boolean;
    /** Deletes (a row's tool): red at rest, on a red wash under the pointer (ghost). */
    deletes?: boolean;
    /** An icon-only button whose glyph says it all: no tooltip of its name. */
    plain?: boolean;
    count?: number | null;
    testid?: string | null;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    label,
    variant = 'secondary',
    size = 'field',
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
    external = false,
    wide = false,
    inField = false,
    trailing = null,
    menu = false,
    expanded = false,
    isDefault = false,
    warns = false,
    deletes = false,
    plain = false,
    count = null,
    testid = null,
    onclick,
  }: Props = $props();

  const inactive = $derived(disabled || loading);
  const tip = $derived(
    disabled && disabledReason ? disabledReason : iconOnly && !plain ? label : null,
  );

  let glyph = $state<HTMLElement | null>(null);

  function handle(event: MouseEvent): void {
    if (inactive) {
      event.preventDefault();
      return;
    }
    // A ghost toggle that a click switches on pops once (the star when pinning).
    const switchesOn = variant === 'ghost' && pressed === false;
    onclick?.(event);
    if (switchesOn && glyph !== null) pulseOnce(glyph);
  }
</script>

<button
  {type}
  class="btn {variant} {size}"
  class:icon-only={iconOnly}
  class:wide={wide && !iconOnly}
  class:loading
  class:turned
  class:external
  class:default={isDefault}
  class:warns
  class:deletes
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
      <span class="glyph" data-icon={icon} bind:this={glyph}>
        <Icon name={icon} size="sm" filled={pressed === true} />
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
    font-weight: var(--weight-medium);
    white-space: nowrap;
    --btn-press: var(--scale-press);
    --btn-pad: var(--space-12);
    --btn-gap: var(--space-6);
    --btn-type: var(--type-sm);

    transition:
      background-color var(--dur-base) var(--ease-standard),
      border-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard),
      transform var(--dur-base) var(--ease-emphasized);
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

  /* Quiet, like the count of a place tab: how many lie there. */
  .count {
    color: var(--text-subtle);
    font-variant-numeric: var(--numeric);
  }

  .glyph {
    position: relative;
    display: inline-flex;
    transition: transform var(--dur-base) var(--ease-emphasized);
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

  /* Hover-in in 80 ms; the release of a press keeps its 150 ms (the last duration). */
  .btn:not([aria-disabled='true'], .loading):hover {
    border-color: var(--btn-border-hover);
    background-color: var(--btn-bg-hover);
    color: var(--btn-fg-hover);
    transition-duration: var(--dur-hover), var(--dur-hover), var(--dur-hover), var(--dur-base);
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
    transform: scale(var(--btn-press));
    transition-duration: var(--dur-instant);
  }

  /* A state, not a nudge: half a turn in 180 ms (the angle stays under reduced motion). */
  .turned .glyph {
    transform: rotate(var(--turn-half));
    transition-duration: var(--dur-slow);
  }

  .btn:focus-visible {
    box-shadow: var(--focus-ring);
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
  }

  /* The control kind (tokens.css): a muted fill and a darker edge under the pointer. */
  .secondary {
    --btn-bg: var(--surface);
    --btn-bg-hover: var(--control-hover);
    --btn-bg-active: var(--control-hover);
    --btn-border: var(--border-strong);
    --btn-border-hover: var(--control-hover-edge);
    --btn-border-active: var(--control-hover-edge);
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
    --btn-height: var(--control-sm);
    --btn-pad: 0;
    --btn-press: 1;

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

  .link.external {
    cursor: pointer;
  }

  /* --------------------------------------------------------------- sizes */
  /* Two heights, one type (on .btn): 28 px in rows and tools, 32 px everywhere else. */
  .sm {
    --btn-height: var(--control-sm);
  }

  .field {
    --btn-height: var(--control-field);
  }

  /* A choice reads like the field beside it: 14 px text. */
  .btn[role='radio'] {
    --btn-type: var(--type-field);
  }

  .icon-only {
    width: var(--btn-height);
    padding: 0;
  }

  .wide {
    width: 100%;
  }
</style>
