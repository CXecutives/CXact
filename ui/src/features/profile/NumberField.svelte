<!--
  A whole number in a text field (years, euros): digits only, an empty field is no value.
  Money is grouped like everywhere in the app (`1.100`); the grouping comes back when the field is left, so typing never moves the caret.
  A decimal part is cut off, never joined to the digits (`7,5` years count 7), and once the
  field is left a note under it says so; in money a group of three digits after a point or
  comma is a thousands separator (`1.100`, `1,100`), one or two digits are cents (`950,50`).
  It fills the width its place gives it (a field of the form, the years of a competence);
  its unit stands quiet at its right end inside it (`€ am Tag`, `Jahre`). In a list's row
  (`inline`) it is 26 high with its digits at the right and says no note (the row has no
  room for one; the whole number is what it holds).
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
    /** A row of a list: 26 high, no note. */
    inline?: boolean;
    /** As wide as its digits (or its placeholder) and its unit, so it reads like text. */
    fit?: boolean;
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
    inline = false,
    fit = false,
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
  /** The characters a fitted field makes room for: its text, or its placeholder while empty. */
  const chars = $derived(Math.max(text.length, text === '' ? (placeholder?.length ?? 0) : 0, 1));
  /** The last input had a decimal part: said once the field is left, until the next input. */
  let cut = false;
  let rounded = $state(false);

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
  <span class="box">
    <TextField
      bind:value={text}
      {id}
      {label}
      {placeholder}
      {invalid}
      {disabled}
      {inline}
      size={fit ? chars : null}
      describedby={rounded ? `${noteId}-rounded` : (describedby ?? described())}
      suffix={unit}
      {testid}
      oninput={(next) => {
        const clean = next.replace(/[^\d.,]/g, '');
        if (clean !== next) text = clean;
        const typed = read(clean);
        cut = typed.cut;
        rounded = false;
        value = typed.value;
      }}
    />
  </span>
</span>
{#if rounded && !inline}
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
