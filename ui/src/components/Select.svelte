<!--
  One value on a scale or of a short list, chosen from a list that drops down (round 10: the
  provider of a mailbox, a language's level): a button that shows the chosen option and a
  chevron, the list in the app's one menu layer (components/Menu.svelte, `listbox`), never
  the OS's popup. 30 px high and at least 150 wide (`wide`: the width of its cell), its words
  10 px in, the chevron 16 px in the subtle grey of icons; the `inline` one is 26 px for the
  rows of a list. Its edge is a field's: darker under the pointer, navy while its list is
  open, the chevron then half turned (150 ms). The list opens below it, above where only
  there is room, at least as wide as the button; the chosen option is the track with navy
  words, no tick.
  Keys (lib/input/input.ts): ArrowDown and ArrowUp open the list, Enter and Space press the
  button (they open it too); in the open list the arrows, Home, End and the first letters
  move, Enter or Space chooses, Esc and Tab close it. The focus stays on the button the whole
  time (a combobox that names the active option, aria-activedescendant); the pointer never
  takes it. Disabled it stays hoverable, its tooltip says why (`disabledReason`).
-->
<script lang="ts" module>
  export interface SelectOption<Id extends string = string> {
    id: Id;
    label: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { tooltip } from '$lib/actions/tooltip';
  import { selectKeys } from '$lib/input/input';
  import { describedBy } from '$lib/state/described';
  import { menuId, menuItemId, menuState, openMenu } from '$lib/state/menu.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    options: readonly SelectOption<Id>[];
    value: Id | null;
    /** The name of the choice: the list's, and the button's outside a Field (no `id`). */
    label: string;
    /** id of the button, for the label of a Field. */
    id?: string | null;
    /** Shown while nothing is chosen. */
    placeholder?: string | null;
    /** 26 px, for the rows of a list (a language's level). */
    inline?: boolean;
    /** As wide as its cell. */
    wide?: boolean;
    disabled?: boolean;
    disabledReason?: string | null;
    invalid?: boolean;
    /** Default: the message of its Field, while it shows one. */
    describedby?: string | null;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let {
    options,
    value,
    label,
    id = null,
    placeholder = null,
    inline = false,
    wide = false,
    disabled = false,
    disabledReason = null,
    invalid = false,
    describedby = null,
    testid = null,
    onchange,
  }: Props = $props();

  const described = describedBy();
  let button = $state<HTMLButtonElement | null>(null);
  /** The id of its open list in the menu layer (null: closed). */
  let open = $state<number | null>(null);
  const chosen = $derived(options.find((option) => option.id === value) ?? null);

  /** Opens the list with the chosen option active (from the keyboard the first without one). */
  function show(fromKeyboard: boolean): void {
    if (disabled || open !== null || button === null) return;
    const at = options.findIndex((option) => option.id === value);
    openMenu({
      entries: options.map((option) => ({
        id: option.id,
        label: option.label,
        checked: option.id === value,
        run: () => {
          if (option.id !== value) onchange(option.id);
        },
      })),
      anchor: { kind: 'below', rect: button.getBoundingClientRect(), align: 'start' },
      label,
      listbox: true,
      active: at >= 0 ? at : fromKeyboard ? 0 : -1,
      onclose: () => (open = null),
    });
    open = menuState.open?.id ?? null;
  }
</script>

<button
  bind:this={button}
  type="button"
  class="select"
  class:inline
  class:wide
  class:open={open !== null}
  class:invalid
  id={id ?? undefined}
  role="combobox"
  aria-label={id === null ? label : undefined}
  aria-haspopup="listbox"
  aria-expanded={open !== null}
  aria-controls={open === null ? undefined : menuId(open)}
  aria-activedescendant={open === null || menuState.active < 0
    ? undefined
    : menuItemId(open, menuState.active)}
  aria-disabled={disabled ? 'true' : undefined}
  aria-invalid={invalid ? 'true' : undefined}
  aria-describedby={describedby ?? described() ?? undefined}
  tabindex={disabled && !disabledReason ? -1 : undefined}
  data-testid={testid ?? undefined}
  use:tooltip={disabled ? disabledReason : null}
  use:selectKeys={() => show(true)}
  onclick={() => show(false)}
>
  <span class="value" class:empty={chosen === null}>{chosen?.label ?? placeholder ?? ''}</span>
  <span class="chevron" aria-hidden="true"><Icon name="expand" size="sm" /></span>
</button>

<style>
  .select {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    min-width: var(--select-min);
    max-width: 100%;
    height: var(--control-field);
    padding: 0 var(--select-pad-end) 0 var(--field-inset);
    border: var(--border-width) solid var(--field-edge);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    color: var(--text);
    font: var(--type-md);
    text-align: start;
    white-space: nowrap;
    cursor: default;
    transition: border-color var(--dur-base) var(--ease-standard);
  }

  .inline {
    height: var(--control-inline);
    border-radius: var(--radius-inner);
  }

  /* In a quiet list's row (ItemList) the edge shows only while the row is under the pointer
     or holds the focus, so the values read like text at rest. */
  .inline {
    --field-edge: var(--inline-edge, var(--border-strong));
  }

  .wide {
    width: 100%;
  }

  .invalid {
    --field-edge: var(--danger-strong);
    --field-edge-hover: var(--danger-strong);
  }

  .select:not([aria-disabled='true']):hover {
    border-color: var(--field-edge-hover);
    transition-duration: var(--dur-hover);
  }

  /* Open: the navy edge, whatever it showed, under the pointer too (like a field in focus). */
  .select.open:not([aria-disabled='true']) {
    border-color: var(--border-focus);
  }

  .select[aria-disabled='true'] {
    opacity: var(--opacity-disabled);
  }

  .value {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
  }

  .value.empty {
    color: var(--icon-subtle);
  }

  .chevron {
    display: inline-flex;
    flex: none;
    color: var(--icon-subtle);
    transition: transform var(--dur-slow) var(--ease-out);
  }

  /* A state, not a nudge: the half turn keeps its angle under reduced motion. */
  .open .chevron {
    transform: rotate(var(--turn-half));
  }
</style>
