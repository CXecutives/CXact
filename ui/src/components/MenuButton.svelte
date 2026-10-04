<!--
  A button that names the current choice, with a chevron, and opens the app's own menu of the
  choices right below it (the current one checked): the order of the list ("Nach
  Übereinstimmung" / "Nach Datum"). Quiet (ghost, small) by default; among fields it is a
  select (`field`): one button in the frame of the text fields beside it (their height and
  regular text) that shows the choice and ends in the chevron, like the native select of
  both OS (design round 3); a column may make it as wide as itself. Without a choice it shows
  its placeholder (quiet), and while it is required it has the amber edge of an empty field.
  Left click only, like every control; disabled it stays hoverable so the tooltip can say
  why. While its menu is open the button looks pressed.
  Below the choices, after a line, the menu may hold what can be done with them (`actions`:
  the profile switcher's Neues Profil, Umbenennen ...); a label a user would copy (a
  profile's name) selects like text and ends in an ellipsis where the row ends (`copy`).
-->
<script lang="ts" module>
  export interface MenuOption<Id extends string = string> {
    id: Id;
    label: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { tooltip } from '$lib/actions/tooltip';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import type { Action } from 'svelte/action';
  import Button from './Button.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    options: readonly MenuOption<Id>[];
    value: Id;
    /** A glyph before the label (optional). */
    icon?: IconName | null;
    disabled?: boolean;
    disabledReason?: string | null;
    /** In a toolbar of fields: secondary, as high as a field. */
    field?: boolean;
    testid?: string | null;
    /** The accessible name of the menu ("Sortierung"). */
    menuLabel: string;
    /** Entries after the choices, below a line. */
    actions?: readonly MenuEntry[];
    /** The label is text a user would copy. */
    copy?: boolean;
    /** Something runs for it (a switch): the spinner over the label. */
    loading?: boolean;
    /** A select whose value is none of the options shows this instead (quiet). */
    placeholder?: string | null;
    /** A select that is required and still empty: an amber edge with a soft halo. */
    missing?: boolean;
    onchange: (id: Id) => void;
  }

  let {
    options,
    value,
    icon = null,
    disabled = false,
    disabledReason = null,
    field = false,
    testid = null,
    menuLabel,
    actions = [],
    copy = false,
    loading = false,
    placeholder = null,
    missing = false,
    onchange,
  }: Props = $props();

  /** Text a user would copy: the label Button draws is marked (`data-copy`). */
  const copyable: Action<HTMLElement, boolean> = (node, on) => {
    const mark = (value: boolean): void => {
      node.querySelector('.label')?.toggleAttribute('data-copy', value);
    };
    mark(on);
    return { update: mark };
  };

  let anchor = $state<HTMLElement | null>(null);
  let expanded = $state(false);
  const chosen = $derived(options.find((option) => option.id === value) ?? null);
  const current = $derived(chosen ?? (placeholder === null ? options[0] : undefined));
  /** The chevron of a select names the menu and the choice it shows. */
  const openLabel = $derived([menuLabel, current?.label ?? ''].filter(Boolean).join(', '));

  /** The menu opens right below the button, its left edge on the button's; a second click
   *  on the open button closes it (the press outside does). Opened from the keyboard, its
   *  first entry is active at once (like the OS). */
  function open(event?: MouseEvent): void {
    if (anchor === null || menuState.open !== null || disabled) return;
    expanded = true;
    openMenu({
      label: menuLabel,
      anchor: { kind: 'below', rect: anchor.getBoundingClientRect(), align: 'start' },
      fromKeyboard: event?.detail === 0,
      entries: [
        ...options.map((option) => ({
          id: option.id,
          label: option.label,
          checked: option.id === value,
          run: () => {
            if (option.id !== value) onchange(option.id);
          },
        })),
        ...(actions.length > 0 ? [{ kind: 'separator' as const }, ...actions] : []),
      ],
      onclose: () => (expanded = false),
    });
  }
</script>

{#if field}
  <button
    type="button"
    class="select"
    class:open={expanded}
    class:missing
    aria-haspopup="menu"
    aria-expanded={expanded}
    aria-label={openLabel}
    aria-disabled={disabled ? 'true' : undefined}
    tabindex={disabled && !disabledReason ? -1 : undefined}
    data-testid={testid ?? undefined}
    use:tooltip={disabled ? disabledReason : null}
    bind:this={anchor}
    onclick={(event) => open(event)}
  >
    <span class="value" class:empty={current === undefined}
      >{current?.label ?? placeholder ?? ''}</span
    >
    <span class="chevron" aria-hidden="true"><Icon name="expand" size="xs" /></span>
  </button>
{:else}
  <span class="menu-button" class:copy bind:this={anchor} use:copyable={copy}>
    <Button
      variant="ghost"
      label={current?.label ?? ''}
      {icon}
      trailing="expand"
      menu
      {expanded}
      {disabled}
      {disabledReason}
      {loading}
      {testid}
      onclick={open}
    />
  </span>
{/if}

<style>
  .menu-button {
    display: inline-flex;
    flex: none;
    max-width: 100%;
  }

  /* A select among fields: the choice and the chevron in the frame of a text field, the
     control kind's answer to the pointer (a darker edge; tokens.css). */
  .select {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    max-width: 100%;
    height: var(--control-field);
    padding: 0 var(--space-4) 0 var(--space-8);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    color: var(--text);
    font: var(--type-field);
    text-align: start;
    transition:
      border-color var(--dur-base) var(--ease-standard),
      background-color var(--dur-base) var(--ease-standard);
  }

  .select:not([aria-disabled='true']):hover,
  .select.open {
    border-color: var(--control-hover-edge);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .select:not([aria-disabled='true']):active:hover {
    background-color: var(--control-hover);
    transition-duration: var(--dur-instant);
  }

  .select:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .select[aria-disabled='true'] {
    opacity: var(--opacity-disabled);
  }

  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.empty {
    color: var(--text-subtle);
  }

  .chevron {
    display: inline-flex;
    flex: none;
    color: var(--text-subtle);
  }

  .missing,
  .missing:not([aria-disabled='true']):hover {
    border-color: var(--missing-edge);
    box-shadow: var(--missing-ring);
  }

  /* A name a user gave (a profile's) may be long: it ends in an ellipsis. */
  .copy :global(.btn) {
    max-width: 100%;
  }

  .copy :global(.content) {
    min-width: 0;
  }

  .copy :global(.label) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
