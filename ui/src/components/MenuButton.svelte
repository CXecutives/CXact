<!--
  A button that names the current choice, with a chevron, and opens the app's own menu of the
  choices right below it (the current one checked): the order of the list ("Nach
  Übereinstimmung" / "Nach Datum"). Quiet (ghost, small) by default; among fields it is a
  select (`field`): their height, border and regular text, the choice at the left and the
  chevron at the right edge, like the OS's own (a column may make it as wide as itself). Left click only, like every control; disabled it
  stays hoverable so the tooltip can say why. While its menu is open the button looks pressed.
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
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import type { Action } from 'svelte/action';
  import Button from './Button.svelte';
  import type { IconName } from './Icon.svelte';

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
  const current = $derived(options.find((option) => option.id === value) ?? options[0]);

  /** The menu opens right below the button, its left edge on the button's; a second click
   *  on the open button closes it (the press outside does). */
  function open(): void {
    if (anchor === null || menuState.open !== null) return;
    expanded = true;
    openMenu({
      label: menuLabel,
      anchor: { kind: 'below', rect: anchor.getBoundingClientRect(), align: 'start' },
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

<span class="menu-button" class:copy class:field bind:this={anchor} use:copyable={copy}>
  <Button
    variant={field ? 'secondary' : 'ghost'}
    size={field ? 'field' : 'sm'}
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

<style>
  .menu-button {
    display: inline-flex;
    flex: none;
    max-width: 100%;
  }

  /* A select among fields: the choice at the left in the fields' weight, the chevron at the
     right edge, quiet. */
  .field :global(.btn) {
    justify-content: flex-start;
  }

  .field :global(.content) {
    flex: 1;
    min-width: 0;
  }

  .field :global(.label) {
    flex: 1;
    overflow: hidden;
    font-weight: var(--weight-regular);
    text-align: start;
    text-overflow: ellipsis;
  }

  .field :global(.trailing) {
    color: var(--text-subtle);
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
