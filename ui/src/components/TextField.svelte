<!--
  Single-line field: text | password (with show/hide) | search (with clear). Spellcheck,
  autocorrect and autocapitalize are off. Use inside Field for label, hint and error.
  Like the native ones: the show and clear buttons are not in the Tab order and leave the
  caret in the field; a search clears on Esc, and a click on its magnifier lands in it.
  Focus turns the edge navy (100 ms), one calm edge and no ring around it; the magnifier
  turns navy. The clear button pops in with the first character and leaves at
  once. A wrong value (a password Gmail refused) shows as the red edge (`invalid`) and the
  one sentence of its Field; nothing shakes (`shake()` stays for its callers and only
  keeps the field in view).
  With `options` (the languages of the profile) it suggests while typing, like the countries
  field: the options whose names start with the text drop down under it, the arrows move the
  one mark, Enter or a click takes the marked one, Esc closes the list; any other text stays
  as typed (the field takes free text). With `suggestions` (the engine's words, a
  competence) it suggests terms the same way (Suggestions.svelte), but nothing is marked
  until the arrows or the pointer mark one: Enter without a mark goes on to the form.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import type { Action } from 'svelte/action';
  import { chipKeys, FIELD_ATTRIBUTES, formKeys, type ChipKeyHandlers } from '$lib/input/input';
  import { t } from '$lib/i18n/t';
  import { describedBy } from '$lib/state/described';
  import { pop } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import { suggested, type ChipOption } from './ChipInput.svelte';
  import Icon from './Icon.svelte';
  import Suggestions, { folded, suggest, type Vocabulary } from './Suggestions.svelte';

  interface Props {
    value: string;
    kind?: 'text' | 'password' | 'search';
    /** Accessible name when the field is not wrapped in a Field with a label. */
    label?: string | null;
    placeholder?: string | null;
    id?: string | null;
    invalid?: boolean;
    disabled?: boolean;
    /** The ids of the texts that describe the field (default: the message of its Field,
     *  while it shows one). */
    describedby?: string | null;
    /** Names to suggest while typing (free text stays possible). */
    options?: readonly ChipOption[] | null;
    /** Terms to suggest while typing, none marked at first (null: not loaded yet). */
    suggestions?: Vocabulary | null | undefined;
    testid?: string | null;
    oninput?: (value: string) => void;
  }

  let {
    value = $bindable(),
    kind = 'text',
    label = null,
    placeholder = null,
    id = null,
    invalid = false,
    disabled = false,
    describedby = null,
    options = null,
    suggestions = undefined,
    testid = null,
    oninput,
  }: Props = $props();

  const described = describedBy();
  let revealed = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const type = $derived(kind === 'password' && !revealed ? 'password' : 'text');

  function update(next: string): void {
    value = next;
    oninput?.(next);
  }

  // ------------------------------------------------------------ suggestions
  const own = $props.id();
  let focused = $state(false);
  /** Esc or a choice closed the list: it stays closed until the next character. */
  let closed = $state(false);
  let active = $state(0);
  const found = $derived(options === null ? [] : suggested(options, value));
  /** The text is an option's name as it would be taken: nothing to suggest. */
  const taken = $derived(found.some((option) => folded(option.label) === folded(value)));
  const listed = $derived(focused && !closed && !taken && found.length > 0);

  function take(option: ChipOption): void {
    update(option.label);
    closed = true;
  }

  /** The suggested terms (none while the list is closed) and the marked one (-1: none). */
  let hint = $state(-1);
  const hints = $derived(suggestions && focused && !closed ? suggest(suggestions, value) : []);
  const suggesting = $derived(suggestions !== undefined);

  function takeHint(term: string): void {
    update(term);
    closed = true;
    hint = -1;
  }

  /** Enter takes the marked option, Esc closes the list, the arrows move the mark; with
   *  no list every key goes on to the field and the form. */
  const suggestKeys: ChipKeyHandlers = {
    commit: () => {
      const term = hints[hint];
      if (term !== undefined) {
        takeHint(term);
        return true;
      }
      const option = listed ? (found[active] ?? found[0]) : undefined;
      if (option === undefined) return false;
      take(option);
      return true;
    },
    removeLast: () => false,
    clear: () => {
      if (!listed && hints.length === 0) return false;
      closed = true;
      return true;
    },
    step: (by) => {
      if (hints.length > 0) {
        // Through the terms and back to none (the typed text).
        hint = hint + by < -1 ? hints.length - 1 : hint + by >= hints.length ? -1 : hint + by;
        return true;
      }
      if (!listed) return false;
      active = (active + by + found.length) % found.length;
      return true;
    },
  };
  /** The keys of the list only for a field that suggests. */
  const listKeys: Action<HTMLElement, ChipKeyHandlers> = (node, handlers) =>
    options === null && suggestions === undefined ? undefined : chipKeys(node, handlers);

  function clear(): void {
    update('');
    input?.focus();
  }

  /** Show or hide the password; the caret and selection stay where they were. */
  async function reveal(): Promise<void> {
    const start = input?.selectionStart ?? null;
    const end = input?.selectionEnd ?? null;
    revealed = !revealed;
    await tick();
    if (input === null) return;
    input.focus();
    // Chromium rebuilds the editor of an input whose type changed at the next style
    // update and puts the caret at the start; update now, then restore.
    void input.offsetWidth;
    if (start !== null) input.setSelectionRange(start, end ?? start);
  }

  /** Esc clears a search that has text; otherwise it goes on to the form around. */
  const keys = $derived(kind === 'search' && value !== '' ? { cancel: clear } : {});

  let box = $state<HTMLElement | null>(null);

  /** The answer to a wrong value where it was typed: the red edge and the sentence say it,
   *  nothing moves (a shake read as a toy); the field is brought into view. */
  export function shake(): void {
    box?.scrollIntoView({ block: 'nearest' });
  }
</script>

<div bind:this={box} class="field {kind}" class:invalid class:disabled use:formKeys={keys}>
  {#if kind === 'search'}
    <span class="lead"><Icon name="search" size="sm" /></span>
  {/if}
  <input
    bind:this={input}
    class="input"
    {type}
    {value}
    id={id ?? undefined}
    aria-label={label ?? undefined}
    aria-invalid={invalid ? 'true' : undefined}
    aria-describedby={describedby ?? described() ?? undefined}
    placeholder={placeholder ?? undefined}
    {disabled}
    data-testid={testid ?? undefined}
    role={options !== null || suggesting ? 'combobox' : undefined}
    aria-autocomplete={options !== null || suggesting ? 'list' : undefined}
    aria-expanded={options !== null ? listed : suggesting ? hints.length > 0 : undefined}
    aria-controls={options !== null ? `${own}-options` : suggesting ? `${own}-hints` : undefined}
    aria-activedescendant={listed
      ? `${own}-option-${active}`
      : hints[hint] !== undefined
        ? `${own}-hints-${hint}`
        : undefined}
    spellcheck={FIELD_ATTRIBUTES.spellcheck}
    autocorrect={FIELD_ATTRIBUTES.autocorrect}
    autocapitalize={FIELD_ATTRIBUTES.autocapitalize}
    autocomplete={FIELD_ATTRIBUTES.autocomplete}
    use:listKeys={suggestKeys}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    oninput={(event) => {
      closed = false;
      active = 0;
      hint = -1;
      update(event.currentTarget.value);
    }}
  />
  {#if options !== null}
    <div
      class="options"
      id="{own}-options"
      role="listbox"
      aria-label={label ?? placeholder ?? undefined}
      hidden={!listed}
      data-testid={testid ? `${testid}-options` : undefined}
    >
      {#each listed ? found : [] as option, index (option.id)}
        <button
          type="button"
          class="option"
          class:active={index === active}
          id="{own}-option-{index}"
          role="option"
          aria-selected={index === active}
          tabindex="-1"
          data-keep-focus
          onpointermove={() => (active = index)}
          onclick={() => take(option)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  {/if}
  {#if suggesting}
    <Suggestions
      id="{own}-hints"
      items={hints}
      active={hint}
      label={label ?? placeholder}
      testid={testid ? `${testid}-suggestions` : null}
      onpick={takeHint}
      onmark={(index) => (hint = index)}
    />
  {/if}
  {#if kind === 'password'}
    <span class="trail">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={revealed ? 'conceal' : 'reveal'}
        label={revealed ? t.field.conceal : t.field.reveal}
        inField
        onclick={() => void reveal()}
      />
    </span>
  {:else if kind === 'search' && value !== ''}
    <span class="trail" in:pop>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="close"
        label={t.field.clear}
        inField
        onclick={clear}
      />
    </span>
  {/if}
</div>

<style>
  .field {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--control-field);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    transition: border-color var(--dur-base) var(--ease-standard);
  }

  .field:hover {
    border-color: var(--control-hover-edge);
    transition-duration: var(--dur-hover);
  }

  .field:focus-within {
    border-color: var(--border-focus);
    transition-duration: var(--dur-fast);
  }

  .invalid,
  .invalid:hover,
  .invalid:focus-within {
    border-color: var(--danger-strong);
  }

  .disabled {
    opacity: var(--opacity-disabled);
  }

  .input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-12);
    border: 0;
    background-color: transparent;
    color: var(--text);
    font: var(--type-field);
    outline: none;
  }

  .input::placeholder {
    color: var(--text-subtle);
  }

  /* The magnifier lies over the input, so a click on it lands in the field. */
  .search .input {
    padding-left: calc(var(--space-12) + var(--icon-sm) + var(--space-8));
  }

  .lead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--space-12);
    display: inline-flex;
    align-items: center;
    color: var(--text-subtle);
    pointer-events: none;
    transition: color var(--dur-fast) var(--ease-standard);
  }

  .field:focus-within .lead {
    color: var(--icon-accent);
  }

  .trail {
    display: inline-flex;
    padding-right: var(--space-4);
  }

  /* The suggestions drop down under the field, over what follows, like the countries'. */
  .options {
    position: absolute;
    z-index: var(--z-overlay);
    top: calc(100% + var(--menu-gap));
    right: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    max-height: calc(6 * var(--control-sm) + 2 * var(--space-4));
    padding: var(--space-4);
    overflow-y: auto;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
  }

  .options[hidden] {
    display: none;
  }

  .option {
    display: flex;
    flex: none;
    align-items: center;
    height: var(--control-sm);
    padding: 0 var(--space-8);
    border-radius: var(--radius-xs);
    color: var(--text);
    font: var(--type-field);
    text-align: left;
    white-space: nowrap;
  }

  .option.active {
    background-color: var(--active-surface);
    color: var(--active-text);
  }
</style>
