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
  `trailing` puts a small control inside the field at its right end, like the picker button
  of a native date field (a button `inField`). `suffix` is a quiet unit at the field's right
  end (`€ am Tag`, `Jahre`), read with the value; like the magnifier it lies over the input, so
  a press on it is a press on the field, and so is a press on the field's own box.
-->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { cssVars, px } from '$lib/actions/cssVars';
  import { FIELD_ATTRIBUTES, formKeys } from '$lib/input/input';
  import { t } from '$lib/i18n/t';
  import { describedBy } from '$lib/state/described';
  import { pop } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

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
    testid = null,
    trailing = null,
    suffix = null,
    oninput,
  }: Props = $props();

  const own = $props.id();
  const described = describedBy();
  let revealed = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const type = $derived(kind === 'password' && !revealed ? 'password' : 'text');

  function update(next: string): void {
    value = next;
    oninput?.(next);
  }

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
    spellcheck={FIELD_ATTRIBUTES.spellcheck}
    autocorrect={FIELD_ATTRIBUTES.autocorrect}
    autocapitalize={FIELD_ATTRIBUTES.autocapitalize}
    autocomplete={FIELD_ATTRIBUTES.autocomplete}
    oninput={(event) => update(event.currentTarget.value)}
  />
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
