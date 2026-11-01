<!--
  A list of short values as chips in a field (round 10): type and press Enter (or leave the
  field) to add, the x ("Entfernen") removes, Backspace in the empty field removes the last
  one with the caret staying there (a held one stops there), Esc closes the list under the field
  and then drops what was typed. An x puts no caret anywhere, from the keyboard the next x takes
  the focus (input.ts removeBy). A chip's value is copyable text (a drag selects it, Ctrl/Cmd+C
  copies; a double click selects a word, it never edits the chip); while the caret stands in the
  field a press on it leaves the caret there and what was typed typed (input.ts leaveField). A
  list of terms (`split` list) also splits at commas and semicolons, typed or pasted; a list of
  sentences or names that hold commas (`split` lines) only at line breaks. A value that is already
  there (in any case) is not added twice.
  Without `entry` the field only shows and removes (chips chosen elsewhere). Its keys come
  from input.ts (chipKeys, withList).
  With `options` the field takes only those (the countries, a closed list): like every tag
  field it opens no list on focus (owner, 2026-10-28); typing lists the options not chosen
  yet whose name or other names (the English one of a country) start with the text (any word of them, in any
  case, with or without accents), with the first marked; Enter or a click takes the marked
  one, leaving the field takes a single match, a chosen option leaves the list. Text that
  matches no option stays in the field and says so (`noMatch`, the look of a refused value), as
  does text the field was left with; text that matches only chosen ones says nothing. A chip
  shows its option's name; a value that is no option (from a file) stays and shows as it is.
  What stands in the list the field adds to (`taken`, the rows of Sprachen and Kompetenzen)
  counts as chosen. A pasted list goes in as far as its entries name an option.
  With `suggestions` (the engine's words) a field without options suggests terms from the
  first character (Suggestions.svelte): nothing is marked until the arrows or the pointer
  mark one, Enter or a click takes the marked term as a chip; Enter without a mark and
  leaving the field take the typed text as always. A row marked with the arrows also goes in
  when the field is left (a pointer's mark does not).
  Typed text that is no chip yet is a change of the form around the field (`typedText`).
  30 px high with one line of chips, each 24 px on the track in 13 px words; a chip rises in
  only when it is added, never when the field is drawn again or folds open. Its edge is the
  text field's (`--field-edge`, red in a required cell that is still empty, red while
  `invalid`); focus turns it navy only.
  With `fold` a long list shows two lines of chips and "+ n weitere" while the field has no
  focus; a click on it, or the focus, shows them all, and the caret a press put at their end
  stays in view (the keyboard's way keeps it there by itself, input.ts). The button is no Tab
  stop: it would go as its own focus opens the fold, and the focus with it; Tab reaches the input.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import {
    afterPress,
    byKeyboard,
    chipKeys,
    FIELD_ATTRIBUTES,
    removeBy,
    withList,
  } from '$lib/input/input';
  import { chipIn } from '$lib/motion/transitions';
  import { describedBy } from '$lib/state/described';
  import { typedText } from '$lib/state/typed.svelte';
  import { ChipFold } from '$lib/state/chipFold.svelte';
  import Button from './Button.svelte';
  import Chip from './Chip.svelte';
  import Notice from './Notice.svelte';
  import Suggestions, {
    folded,
    suggest,
    suggested,
    type ChipOption,
    type Vocabulary,
  } from './Suggestions.svelte';

  interface Props {
    values: string[];
    /** Accessible name when the field is not wrapped in a Field with a label. */
    label?: string | null;
    placeholder?: string | null;
    /** id of the text input, for the label of a Field. */
    id?: string | null;
    /** Default: the message of its Field, while it shows one. */
    describedby?: string | null;
    invalid?: boolean;
    /** The field takes typed values (off: it only shows and removes). */
    entry?: boolean;
    /** Where text splits into chips: at commas, semicolons and line breaks (terms), or only
     *  at line breaks (sentences, degrees, certificate names). */
    split?: 'list' | 'lines';
    /** The only values the field takes, listed on focus and narrowed while typing. */
    options?: readonly ChipOption[] | null;
    /** Said under the field while the typed text matches no option. */
    noMatch?: string | null;
    /** Terms to suggest while typing, free text stays (null: not loaded yet). */
    suggestions?: Vocabulary | null | undefined;
    /** Names that are there already beside `values` (the rows of the list the field adds to):
     *  they count as chips, not offered and no news. */
    taken?: readonly string[];
    /** Two lines of chips and "+ n weitere" while the field has no focus. */
    fold?: boolean;

    testid?: string | null;
    onchange?: (values: string[]) => void;
  }

  let {
    values = $bindable(),
    label = null,
    placeholder = null,
    id = null,
    describedby = null,
    invalid = false,
    entry = true,
    split = 'list',
    options = null,
    noMatch = null,
    suggestions = undefined,
    taken = [],
    fold = false,
    testid = null,
    onchange,
  }: Props = $props();

  const SEPARATORS = { list: /[,;\n\r\t]+/, lines: /[\n\r]+/ } as const;
  const separators = $derived(SEPARATORS[split]);
  const own = $props.id();
  const described = describedBy();

  let draft = $state('');

  // The form around the field counts typed text as a change.
  const typed = typedText();
  $effect(() => {
    const holds = draft.trim() !== '';
    typed?.set(own, holds ? () => (draft = '') : null);
  });
  $effect(() => () => typed?.set(own, null));
  /** The focus is in the field (its list shows only then). */
  let focused = $state(false);

  /** The name a chip shows: its option's, else the value itself. */
  const labelOf = (value: string): string =>
    options?.find((option) => option.id === value)?.label ?? value;
  const names = (option: ChipOption): string[] => [
    option.label,
    option.id,
    ...(option.terms ?? []),
  ];

  let box = $state<HTMLElement | null>(null);

  /** A long list folded to two lines while the field has no focus (`fold`). */
  const folder = new ChipFold(() => fold && !focused);
  const visible = $derived(folder.visible(values));
  $effect(() => {
    void values.length;
    void focused;
    void folder.measure(box);
  });
  $effect(() => (fold && box !== null ? folder.observe(box) : undefined));
  const known = (list: string[], text: string): boolean =>
    list.some((value) => value.toLowerCase() === text.toLowerCase());

  // ------------------------------------------------------------ the chip that came in
  /** The values added since the last change: only their chips rise in (never one drawn
   *  again, unfolded or there from the start). */
  let added: string[] = [];
  let seen: readonly string[] | null = null;
  $effect.pre(() => {
    const before = seen;
    if (before !== null) added = [...added, ...values.filter((value) => !before.includes(value))];
    seen = [...values];
    void tick().then(() => requestAnimationFrame(() => (added = [])));
  });
  /** Rises in once, for a value just added (its first drawing). */
  function riseIn(node: Element, value: string): ReturnType<typeof chipIn> {
    const on = added.includes(value);
    if (on) added = added.filter((each) => each !== value);
    return chipIn(node, { on });
  }

  // ------------------------------------------------------------ the list under the field
  /** Options whose names start with the typed text (a whole name first), chosen or not;
   *  every option, in its order, while nothing is typed. */
  const found = $derived(
    options === null ? [] : folded(draft) === '' ? options : suggested(options, draft),
  );
  /** What is there already, chips and rows. */
  const there = $derived(new Set([...values, ...taken].map(folded)));
  const isThere = (option: ChipOption): boolean => there.has(folded(option.id));
  /** The options found that are not chosen yet: the list under the field. */
  const matches = $derived(found.filter((option) => !isThere(option)));
  /** Esc closed the list until the next character. */
  let closed = $state(false);
  const hints = $derived(
    suggestions && focused && !closed ? suggest(suggestions, draft, [...values, ...taken]) : [],
  );
  /** The rows under the field: the options not chosen yet, or the suggested terms. */
  const rows = $derived(
    !focused || closed
      ? []
      : options !== null
        ? folded(draft) === ''
          ? []
          : matches.map((option) => option.label)
        : hints,
  );
  /** The marked row (-1: none; typing marks the first option, never a term). */
  let mark = $state(-1);
  /** The mark came with the arrows: its row goes in when the field is left, as with Enter. */
  let arrowed = false;
  /** `text` is a whole name of `option`. */
  const nameOf = (option: ChipOption, text: string): boolean =>
    names(option).some((name) => folded(name) === folded(text));
  /** `text` names an option that is a chip already: taking it only clears the text. */
  const isChosen = (text: string): boolean =>
    folded(text) !== '' &&
    (options ?? []).some((option) => isThere(option) && nameOf(option, text));
  const chosen = $derived(isChosen(draft));
  /** The typed text names no option at all (one that is chosen already is no news), or the
   *  field was left with text it did not take. */
  const nothing = $derived(
    options !== null && folded(draft) !== '' && (found.length === 0 || !focused),
  );
  const suggesting = $derived(options !== null || suggestions !== undefined);

  $effect(() => {
    const text = draft.trim() !== '';
    mark = options !== null && text ? 0 : -1;
    closed = false;
    arrowed = false;
  });

  function update(next: string[]): void {
    values = next;
    onchange?.(next);
  }

  /** The entries of `text`. */
  const partsOf = (text: string): string[] =>
    text
      .split(separators)
      .map((part) => part.trim())
      .filter((part) => part !== '');

  /** Adds every entry of `text` that is not there yet; `true` if there was text. */
  function add(text: string): boolean {
    const parts = partsOf(text);
    if (parts.length === 0) return false;
    const next = [...values];
    for (const part of parts) {
      if (!known(next, part)) next.push(part);
    }
    if (next.length !== values.length) update(next);
    return true;
  }

  /** A row of the list goes in as a chip; the typed text is done. */
  function take(index: number): void {
    if (options !== null) {
      const option = matches[index];
      if (option && !values.includes(option.id)) update([...values, option.id]);
    } else {
      const term = hints[index];
      if (term !== undefined && !known(values, term)) update([...values, term]);
    }
    draft = '';
  }

  /** Enter without a marked row: the typed text (with options it only clears a name that is
   *  chosen already); `true` if there was text. */
  function commit(): boolean {
    if (options === null) {
      const done = add(draft);
      draft = '';
      return done;
    }
    if (draft.trim() === '') return false;
    if (chosen) draft = '';
    return true;
  }

  /** The keys of input.ts: the list's first, then the field's own. */
  const keys = withList(
    {
      get count() {
        return rows.length;
      },
      get mark() {
        return mark;
      },
      get none() {
        return options === null;
      },
      setMark: (index) => {
        mark = index;
        arrowed = true;
      },
      take,
      close: () => (closed = true),
    },
    {
      commit,
      removeLast: () => {
        if (draft !== '' || values.length === 0) return false;
        // The caret stays in the field, as in any field: what comes next is typed on.
        update(values.slice(0, -1));
        return true;
      },
      clear: () => {
        if (draft === '') return false;
        draft = '';
        return true;
      },
    },
  );

  /** The focus came to the field: what was folded opens, and a press's caret stays in view. */
  function enter(event: FocusEvent): void {
    const opens = visible.length < values.length;
    focused = true;
    const input = event.target;
    if (opens && !byKeyboard() && input instanceof HTMLInputElement) {
      void tick().then(() => input.scrollIntoView({ block: 'nearest' }));
    }
  }

  /** The focus left the field and its chips (not for one of its x). */
  function leave(event: FocusEvent & { currentTarget: HTMLElement }): void {
    const root = event.currentTarget;
    const next = event.relatedTarget;
    if (next instanceof Node && root.contains(next)) return;
    afterPress(event.target, () => (focused = root.contains(document.activeElement)));
  }

  /** The one option not there yet that `text` means: a whole name, else the only one it starts. */
  function meant(text: string): ChipOption | undefined {
    const open = suggested(options ?? [], text).filter((option) => !isThere(option));
    const exact = open.filter((option) => nameOf(option, text));
    return exact.length === 1 ? exact[0] : open.length === 1 ? open[0] : undefined;
  }

  /** Leaving the field: the row the arrows marked goes in, else typed text becomes chips, with
   *  options only a single match. */
  function settle(): void {
    if (arrowed && rows[mark] !== undefined) {
      take(mark);
      return;
    }
    if (options === null) {
      commit();
      return;
    }
    if (draft.trim() === '') return;
    const only = meant(draft);
    if (only) take(matches.indexOf(only));
    else if (chosen) draft = '';
  }

  function remove(index: number): void {
    const button = box?.querySelectorAll('[data-remove]').item(index) ?? null;
    removeBy(button, () => update(values.filter((_, at) => at !== index)));
  }

  /** The entries that name an option become chips, what names none stays as text. */
  function takeNamed(parts: string[]): void {
    const next = [...values];
    const rest: string[] = [];
    for (const part of parts) {
      const option = meant(part);
      if (option === undefined) {
        if (!isChosen(part)) rest.push(part);
      } else if (!next.includes(option.id)) {
        next.push(option.id);
      }
    }
    if (next.length !== values.length) update(next);
    draft = rest.join(', ');
  }

  /** A pasted list becomes chips at once; a single value is pasted as text. */
  function paste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!separators.test(text.trim())) return;
    event.preventDefault();
    if (options !== null) {
      takeNamed(partsOf(`${draft}\n${text}`));
      return;
    }
    add(`${draft}\n${text}`);
    draft = '';
  }
</script>

<div class="chip-input" class:suggests={suggesting} onfocusin={enter} onfocusout={leave}>
  <div
    bind:this={box}
    class="field"
    class:invalid
    class:entry
    class:filled={values.length > 0}
    data-field-box={entry ? '' : undefined}
    data-testid={testid ?? undefined}
    data-removes
  >
    {#each visible as value, index (value)}
      <span class="slot" data-chip={index} data-value={value} in:riseIn={value}>
        <Chip label={labelOf(value)} copy inField onremove={() => remove(index)} />
      </span>
    {/each}
    {#if visible.length < values.length}
      <Button
        variant="link"
        inField
        label={t.profile.field.moreChips(values.length - visible.length)}
        testid={testid ? `${testid}-more` : null}
        onclick={() => (folder.opened = true)}
      />
    {/if}
    {#if entry}
      <!-- As wide as its placeholder at least (sizer): it stays beside the chips while its
           words fit there. -->
      <span
        class="sizer"
        class:folded={visible.length < values.length}
        data-placeholder={placeholder ?? ''}
        ><input
          bind:value={draft}
          class="input"
          type="text"
          id={id ?? undefined}
          role={suggesting ? 'combobox' : undefined}
          aria-autocomplete={suggesting ? 'list' : undefined}
          aria-expanded={suggesting ? rows.length > 0 : undefined}
          aria-controls={rows.length > 0 ? `${own}-list` : undefined}
          aria-activedescendant={rows.length > 0 && mark >= 0 ? `${own}-list-${mark}` : undefined}
          aria-label={label ?? undefined}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={[describedby ?? described(), nothing ? `${own}-none` : null]
            .filter((part) => part !== null)
            .join(' ') || undefined}
          placeholder={placeholder ?? undefined}
          spellcheck={FIELD_ATTRIBUTES.spellcheck}
          autocorrect={FIELD_ATTRIBUTES.autocorrect}
          autocapitalize={FIELD_ATTRIBUTES.autocapitalize}
          autocomplete={FIELD_ATTRIBUTES.autocomplete}
          use:chipKeys={keys}
          onpaste={paste}
          onblur={(event) => afterPress(event.currentTarget, settle)}
        /></span
      >
    {/if}
  </div>
  {#if suggesting}
    <Suggestions
      id="{own}-list"
      items={rows}
      active={mark}
      label={label ?? placeholder}
      testid={testid ? `${testid}-${options !== null ? 'options' : 'suggestions'}` : null}
      onpick={(name) => take(rows.indexOf(name))}
      onmark={(index) => {
        mark = index;
        arrowed = false;
      }}
    />
  {/if}
  {#if nothing && noMatch}
    <div class="none" id="{own}-none">
      <Notice tone="danger" text={noMatch} textTestid={testid ? `${testid}-none` : null} />
    </div>
  {/if}
</div>

<style>
  .chip-input {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
    min-width: 0;
  }

  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    min-width: 0;
  }

  /* 30 px with one line of chips: 2 px around the 24 px chips inside the 1 px edge. */
  .entry {
    min-height: var(--control-field);
    padding: var(--space-2);
    border: var(--border-width) solid var(--field-edge);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    cursor: text;
    transition: border-color var(--dur-base) var(--ease-standard);
  }

  /* Like every field: hover-in 80 ms, hover-out 150 ms, focus 100 ms (TextField). */
  .entry:hover {
    border-color: var(--field-edge-hover);
    transition-duration: var(--dur-hover);
  }

  .invalid {
    --field-edge: var(--danger-strong);
    --field-edge-hover: var(--danger-strong);
  }

  /* Focus last: only the navy edge, whatever the field showed (hover never takes it back). */
  .entry:focus-within {
    border-color: var(--border-focus);
    transition-duration: var(--dur-fast);
  }

  .slot {
    display: inline-flex;
    max-width: 100%;
  }

  /* The input after the chips takes the rest of the line, and at least its placeholder's
     width (its hidden copy, whose own width counts only when it is not auto) or the least room
     to type: else a line of its own. */
  .sizer {
    display: inline-grid;
    flex: 1 1 0;
  }

  .sizer::after {
    grid-area: 1 / 1;
    width: max-content;
    min-width: var(--chip-entry-min);
    height: 0;
    padding: 0 var(--space-8);
    font: var(--type-md);
    white-space: pre;
    visibility: hidden;
    content: attr(data-placeholder);
  }

  .input {
    grid-area: 1 / 1;
    width: 100%;
    min-width: 0;
    height: calc(var(--chip-height) - 2 * var(--border-width));
    padding: 0 var(--space-8);
    border: 0;
    background-color: transparent;
    color: var(--text);
    font: var(--type-md);
    outline: none;
  }

  .input::placeholder {
    color: var(--field-placeholder);
  }

  /* One line whatever the field's width: a list's name field is narrower than its words. */
  .none {
    width: max-content;
    max-width: 100cqw;
  }

  /* Folded: the input keeps its place in the Tab order without taking a line. */
  .sizer.folded {
    flex: 0 0 0;
    min-width: 0;
  }

  .sizer.folded::after {
    content: none;
  }

  .folded .input {
    padding: 0;
  }
</style>
