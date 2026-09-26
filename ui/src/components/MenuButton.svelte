<!--
  A quiet button that names the current choice, with a chevron, and opens the app's own menu
  of the choices right below it (the current one checked): the sort control of the list
  ("Nach Passung" / "Nach Datum"). Left click only, like every control; disabled it stays
  hoverable so the tooltip can say why. While its menu is open the button looks pressed.
-->
<script lang="ts" module>
  export interface MenuOption<Id extends string = string> {
    id: Id;
    label: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { menuState, openMenu } from '$lib/state/menu.svelte';
  import Button from './Button.svelte';
  import type { IconName } from './Icon.svelte';

  interface Props {
    options: readonly MenuOption<Id>[];
    value: Id;
    /** A glyph before the label (optional). */
    icon?: IconName | null;
    disabled?: boolean;
    disabledReason?: string | null;
    testid?: string | null;
    /** The accessible name of the menu ("Sortierung"). */
    menuLabel: string;
    onchange: (id: Id) => void;
  }

  let {
    options,
    value,
    icon = null,
    disabled = false,
    disabledReason = null,
    testid = null,
    menuLabel,
    onchange,
  }: Props = $props();

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
      entries: options.map((option) => ({
        id: option.id,
        label: option.label,
        checked: option.id === value,
        run: () => {
          if (option.id !== value) onchange(option.id);
        },
      })),
      onclose: () => (expanded = false),
    });
  }
</script>

<span class="menu-button" bind:this={anchor}>
  <Button
    variant="ghost"
    size="sm"
    label={current?.label ?? ''}
    {icon}
    trailing="expand"
    menu
    {expanded}
    {disabled}
    {disabledReason}
    {testid}
    onclick={open}
  />
</span>

<style>
  .menu-button {
    display: inline-flex;
    flex: none;
  }
</style>
