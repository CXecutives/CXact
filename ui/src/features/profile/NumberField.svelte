<!--
  A whole number in a text field (years, euros): digits only, an empty field is no value.
  Money is grouped like everywhere in the app (`1.100`); the grouping comes back when the field is left, so typing never moves the caret.
  A decimal part is cut off, never joined to the digits (`7,5` years count 7), and once the
  field is left a note under it says so; in money a group of three digits after a point or
  comma is a thousands separator (`1.100`, `1,100`), one or two digits are cents (`950,50`).
  It fills the width its place gives it (a field of the form, the years of a competence),
  whose note stands under it on a line of its own; its unit stands quiet at its right end
  inside it (`€ am Tag`, `Jahre`).
-->
<script lang="ts">
  import TextField from '$components/TextField.svelte';
  import { formatNumber } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { describedBy } from '$lib/state/described';

  interface Props {
    value: number | null;
    /** Euros: grouped (`1.100`), cents cut off with a note. */
    money?: boolean;
    /** The unit at the field's right end (`€ am Tag`, `Jahre`). */
    unit?: string | null;
    id?: string | null;
    label?: string | null;
    placeholder?: string | null;
    invalid?: boolean;
    /** Waits for another value (its field's hint says for which). */
    disabled?: boolean;
    describedby?: string | null;
    testid?: string | null;
  }

  let {
    value = $bindable(),
    money = false,
    unit = null,
    id = null,
    label = null,
    placeholder = null,
    invalid = false,
    disabled = false,
    describedby = null,
    testid = null,
  }: Props = $props();

  const noteId = $props.id();
  const described = describedBy();

  /** A typed text as a whole number and whether a decimal part was cut off (`,00` cuts
   *  nothing). */
  function read(text: string): { value: number | null; cut: boolean } {
    const at = money ? (/[.,]\d{0,2}$/.exec(text)?.index ?? -1) : text.search(/[.,]/);
    const whole = at < 0 ? text : text.slice(0, at);
    const digits = whole.replace(/\D/g, '');
    return {
      value: digits === '' ? null : Number(digits.slice(0, 9)),
      cut: at >= 0 && /[1-9]/.test(text.slice(at + 1)),
    };
  }

  /** The text of a value: money grouped. */
  const shown = (number: number | null): string =>
    number === null ? '' : money ? formatNumber(number) : String(number);

  let text = $state(shown(value));
  /** The last input had a decimal part: said once the field is left, until the next input. */
  let cut = false;
  let rounded = $state(false);
  let box = $state<HTMLElement | null>(null);

  /**
   * What was typed without its letters. Svelte writes the field only when `text` is not what it
   * wrote last, and a letter typed after the digits ends where it began, so the field itself
   * is cleaned, the caret left where it was among the digits.
   */
  function withoutLetters(next: string): string {
    const clean = next.replace(/[^\d.,]/g, '');
    const input = box?.querySelector('input');
    if (clean !== next && input) {
      const caret = next.slice(0, input.selectionStart ?? next.length).replace(/[^\d.,]/g, '');
      input.value = clean;
      input.setSelectionRange(caret.length, caret.length);
    }
    return clean;
  }

  // A value set from outside (discard, a new draft) shows in the field.
  $effect(() => {
    if (read(text).value !== value) {
      text = shown(value);
      cut = false;
      rounded = false;
    }
  });
</script>

<span
  class="number"
  role="presentation"
  onfocusout={() => {
    text = shown(value);
    rounded = cut;
  }}
>
  <span class="box" bind:this={box}>
    <TextField
      bind:value={text}
      {id}
      {label}
      {placeholder}
      {invalid}
      {disabled}
      describedby={rounded ? `${noteId}-rounded` : (describedby ?? described())}
      suffix={unit}
      {testid}
      oninput={(next) => {
        const clean = withoutLetters(next);
        if (clean !== next) text = clean;
        const typed = read(clean);
        cut = typed.cut;
        rounded = false;
        value = typed.value;
      }}
    />
  </span>
</span>
{#if rounded}
  <p class="note" id="{noteId}-rounded" data-testid={testid ? `${testid}-rounded` : undefined}>
    {money ? t.profile.field.rounded : t.profile.field.roundedWhole}
  </p>
{/if}

<style>
  .number {
    display: flex;
    min-width: 0;
  }

  .box {
    flex: 1;
    min-width: 0;
  }

  .note {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
