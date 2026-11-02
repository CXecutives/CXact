<!--
  Single-line field: text | password (with show/hide) | search (with clear). Spellcheck,
  autocorrect and autocapitalize are off. Use inside Field for label, hint and error.
  Like the native ones: the show and clear buttons are not in the Tab order and leave the
  caret in the field; a search clears on Esc, and a click on its magnifier lands in it.
  30 px high, its text 10 px in (round 10). The edge is `--field-edge` (`--field-edge-hover`
  under the pointer): a required field that is still empty takes the orange of its cell
  (`[data-missing]`, tokens.css). Focus turns the edge navy (100 ms) whatever it was, one calm
  edge and no ring around it; the magnifier stays quiet. The placeholder and the glyphs are
  the subtle grey of icons (the placeholder --field-placeholder). The clear button pops in with the first character and leaves at once. A wrong
  value (a password Gmail refused) shows as the red edge (`invalid`) and the one sentence of
  its Field; nothing shakes.
  With `options` (the languages of the profile) it suggests while typing, like the countries
  field: the options whose names start with the text drop down under it (Suggestions.svelte,
  the one look of a menu), the arrows move the one mark, Enter or a click takes the marked
  one, Esc closes the list; any other text stays as typed (the field takes free text). With
  `suggestions` (the engine's words, a competence) it suggests terms the same way, but
  nothing is marked until the arrows or the pointer mark one: Enter without a mark goes on to
  the form.
  `trailing` puts a small control inside the field at its right end, like the picker button
  of a native date field (a button `inField`). `suffix` is a quiet unit at the field's right
  end (`€ am Tag`, `Jahre`), read with the value; like the magnifier it lies over the input, so
  a press on it is a press on the field, and so is a press on the field's own box.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import { cssVars, px } from '$lib/actions/cssVars';
  import {
    chipKeys,
    FIELD_ATTRIBUTES,
    formKeys,
    withList,
    type ChipKeyHandlers,
  } from '$lib/input/input';
  import { t } from '$lib/i18n/t';
  import { describedBy } from '$lib/state/described';
  import { pop } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Suggestions, {
    folded,
    suggest,
    suggested,
    type ChipOption,
    type Vocabulary,
  } from './Suggestions.svelte';

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
    /** A small control inside the field at its right end. */
    trailing?: Snippet | null;
    /** A unit at the right end inside the field (`€`), quiet; its id joins the description. */
    suffix?: string | null;
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
    trailing = null,
    suffix = null,
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
  const found = $derived(options === null ? [] : suggested(options, value));
  /** The text is an option's name as it would be taken: nothing to suggest. */
  const taken = $derived(found.some((option) => folded(option.label) === folded(value)));
  const listed = $derived(focused && !closed && !taken && found.length > 0);
  /** The suggested terms (none while the list is closed). */
  const hints = $derived(suggestions && focused && !closed ? suggest(suggestions, value) : []);
  const suggesting = $derived(options !== null || suggestions !== undefined);
  /** The rows under the field: its options (the first marked) or its terms (none marked). */
  const rows = $derived(
    hints.length > 0 ? hints : listed ? found.map((option) => option.label) : [],
  );
  let mark = $state(-1);
  const listId = $derived(hints.length > 0 ? `${own}-hints` : `${own}-options`);

  /** A row goes in as the text; the list closes until the next character. */
  function take(index: number): void {
    const text = rows[index];
    if (text === undefined) return;
    update(text);
    closed = true;
  }

  /** Enter takes the marked row, Esc closes the list, the arrows move the mark; with no list
   *  every key goes on to the field and the form. */
  const suggestKeys: ChipKeyHandlers = withList(
    {
      get count() {
        return rows.length;
      },
      get mark() {
        return mark;
      },
      get none() {
        return hints.length > 0;
      },
      setMark: (index) => (mark = index),
      take,
      close: () => (closed = true),
    },
    { commit: () => false, removeLast: () => false, clear: () => false },
  );
  /** The keys of the list only for a field that suggests. */
  const listKeys: Action<HTMLElement, ChipKeyHandlers> = (node, handlers) =>
    suggesting ? chipKeys(node, handlers) : undefined;

  function clear(): void {
    update('');
  }

  /** Show or hide the password; a caret and selection in the field stay where they were. */
  async function reveal(): Promise<void> {
    const held = input !== null && document.activeElement === input;
    const start = input?.selectionStart ?? null;
    const end = input?.selectionEnd ?? null;
    revealed = !revealed;
    await tick();
    if (input === null || !held) return;
    // Chromium rebuilds the editor of an input whose type changed at the next style
    // update and puts the caret at the start; update now, then restore.
    void input.offsetWidth;
    if (start !== null) input.setSelectionRange(start, end ?? start);
  }

  /** Esc clears a search that has text; otherwise it goes on to the form around. */
  const keys = $derived(kind === 'search' && value !== '' ? { cancel: clear } : {});

  /** How wide the unit stands over the input, which keeps that room for its text. */
  let unitWidth = $state(0);
</script>

<div
  class="field {kind}"
  class:invalid
  class:disabled
  class:trailed={trailing !== null}
  class:suffixed={suffix !== null}
  data-field-box
  use:formKeys={keys}
  use:cssVars={suffix !== null ? { 'unit-width': px(unitWidth) } : {}}
>
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
    aria-describedby={[describedby ?? described(), suffix !== null ? `${own}-suffix` : null]
      .filter((part) => part !== null)
      .join(' ') || undefined}
    placeholder={placeholder ?? undefined}
    {disabled}
    data-testid={testid ?? undefined}
    role={suggesting ? 'combobox' : undefined}
    aria-autocomplete={suggesting ? 'list' : undefined}
    aria-expanded={suggesting ? rows.length > 0 : undefined}
    aria-controls={rows.length > 0 ? listId : undefined}
    aria-activedescendant={rows.length > 0 && mark >= 0 ? `${listId}-${mark}` : undefined}
    spellcheck={FIELD_ATTRIBUTES.spellcheck}
    autocorrect={FIELD_ATTRIBUTES.autocorrect}
    autocapitalize={FIELD_ATTRIBUTES.autocapitalize}
    autocomplete={FIELD_ATTRIBUTES.autocomplete}
    use:listKeys={suggestKeys}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    oninput={(event) => {
      closed = false;
      update(event.currentTarget.value);
      mark = hints.length > 0 || !listed ? -1 : 0;
    }}
  />
  {#if suggesting}
    <Suggestions
      id={listId}
      items={rows}
      active={mark}
      label={label ?? placeholder}
      testid={testid ? `${testid}-${hints.length > 0 ? 'suggestions' : 'options'}` : null}
      onpick={(text) => take(rows.indexOf(text))}
      onmark={(index) => (mark = index)}
    />
  {/if}
  {#if kind === 'password'}
    <span class="trail" data-field-box>
      <Button
        variant="ghost"
        iconOnly
        icon={revealed ? 'conceal' : 'reveal'}
        label={revealed ? t.field.conceal : t.field.reveal}
        inField
        onclick={() => void reveal()}
      />
    </span>
  {:else if kind === 'search' && value !== ''}
    <span class="trail" data-field-box in:pop>
      <Button variant="ghost" iconOnly icon="close" label={t.field.clear} inField onclick={clear} />
    </span>
  {:else if trailing}
    <span class="trail" data-field-box>{@render trailing()}</span>
  {:else if suffix !== null}
    <span class="suffix" id="{own}-suffix" bind:offsetWidth={unitWidth}>{suffix}</span>
  {/if}
</div>

<style>
  .field {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    height: var(--control-field);
    border: var(--border-width) solid var(--field-edge);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    transition: border-color var(--dur-base) var(--ease-standard);
  }

  .field:hover {
    border-color: var(--field-edge-hover);
    transition-duration: var(--dur-hover);
  }

  .invalid {
    --field-edge: var(--danger-strong);
    --field-edge-hover: var(--danger-strong);
  }

  /* Focus last: only the navy edge, whatever the field showed (hover never takes it back). */
  .field:focus-within {
    border-color: var(--border-focus);
    transition-duration: var(--dur-fast);
  }

  .disabled {
    opacity: var(--opacity-disabled);
  }

  .input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--field-inset);
    border: 0;
    background-color: transparent;
    color: var(--text);
    font: var(--type-md);
    text-overflow: ellipsis;
    outline: none;
  }

  /* A control at the end takes the room of the text's right padding. */
  .trailed .input {
    padding-right: var(--space-4);
  }

  .input::placeholder {
    color: var(--field-placeholder);
  }

  /* The magnifier lies over the input, so a click on it lands in the field. */
  .search .input {
    padding-left: calc(var(--field-inset) + var(--icon-sm) + var(--field-glyph-gap));
  }

  .lead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--field-inset);
    display: inline-flex;
    align-items: center;
    color: var(--icon-subtle);
    pointer-events: none;
  }

  .trail {
    display: inline-flex;
    padding-right: var(--space-2);
  }

  /* The unit lies over the input too, whose text ends where the unit begins. */
  .suffixed .input {
    padding-right: calc(var(--field-inset) + var(--unit-width));
  }

  /* It reads with the value, quieter, the field's right padding after it. */
  .suffix {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: inline-flex;
    align-items: center;
    padding-right: var(--field-inset);
    color: var(--icon-subtle);
    font: var(--type-md);
    pointer-events: none;
  }
</style>
