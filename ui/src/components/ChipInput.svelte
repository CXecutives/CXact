<!--
  A list of short values as chips in a field: type and press Enter (or leave the field) to
  add, x removes, Backspace in the empty field removes the last one, Esc drops what was
  typed, a double click on a chip takes it back into the text to edit it. A chip's value is
  copyable text (a drag selects it, Ctrl/Cmd+C copies); its x names what it removes in a
  tooltip, like every icon-only button. A list of terms
  (`split` list) also splits at commas and semicolons, typed or pasted; a list of sentences
  or names that hold commas (`split` lines) only at line breaks. A value that is already
  there (in any case) is not added twice. Without `entry` the field only shows and removes
  (chips chosen elsewhere). Keys and the double click come from input.ts (chipKeys,
  chipEdit).
  With `options` the field takes only those (the countries of the profile): typing shows the
  options whose name or other names start with it (any word of them, in any case, with or
  without accents) in a list under the field, Enter or a click takes the marked one (the
  first), leaving the field takes a single match. The list has one mark, like a native
  menu: the pointer moves it as the arrows do. A chip shows its option's name; a value that
  is no option (from a file) stays and shows as it is. Text that matches no option stays in
  the field and says so (`noMatch`); text that matches only chosen ones says nothing.
  Typed text that is no chip yet is a change of the form around the field (`typedText`), and
  Ctrl/Cmd+S takes it in first, as leaving the field would.
  The field is as tall as a text field (32 px) with one line of chips. With `oneLine` (the
  other terms of a competence) it stays one line while it has no focus: the chips that fit,
  then a quiet "+n" for the rest (their values in its tooltip); with the focus every chip
  shows, so each can be removed or edited.
-->
<script lang="ts" module>
  /** A value a field with options can take: its id, its name, other names to find it by. */
  export interface ChipOption {
    id: string;
    label: string;
    terms?: readonly string[];
  }

  /** Lower case without accents (`Österreich` is found by `oster` and `öster`). */
  export function folded(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').trim();
  }

  /** The options whose names start with `text` (a whole name first, then a word of one),
   *  by name; none for no text. Shared with the suggestions of a TextField. */
  export function suggested(options: readonly ChipOption[], text: string): ChipOption[] {
    const query = folded(text);
    if (query === '') return [];
    const rank = (option: ChipOption): number => {
      const names = [option.label, option.id, ...(option.terms ?? [])].map(folded);
      if (names.some((name) => name.startsWith(query))) return 0;
      if (names.some((name) => name.split(/[\s-]+/).some((word) => word.startsWith(query)))) {
        return 1;
      }
      return 2;
    };
    return options
      .map((option) => ({ option, rank: rank(option) }))
      .filter((entry) => entry.rank < 2)
      .sort((a, b) => a.rank - b.rank || a.option.label.localeCompare(b.option.label))
      .map((entry) => entry.option);
  }
</script>

<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { untrack } from 'svelte';
  import { chipEdit, chipKeys, FIELD_ATTRIBUTES, type ChipKeyHandlers } from '$lib/input/input';
  import { describedBy } from '$lib/state/described';
  import { typedText } from '$lib/state/typed.svelte';
  import Icon from './Icon.svelte';

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
    /** The only values the field takes, suggested while typing. */
    options?: readonly ChipOption[] | null;
    /** Said under the field while the typed text matches no option. */
    noMatch?: string | null;
    /** One line without the focus: the chips that fit and "+n" for the rest. */
    oneLine?: boolean;
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
    oneLine = false,
    testid = null,
    onchange,
  }: Props = $props();

  const SEPARATORS = { list: /[,;\n\r\t]+/, lines: /[\n\r]+/ } as const;
  const separators = $derived(SEPARATORS[split]);
  const own = $props.id();
  const described = describedBy();

  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  // The form around the field counts typed text as a change.
  const typed = typedText();
  $effect(() => {
    const holds = draft.trim() !== '';
    typed?.set(own, holds ? () => (draft = '') : null);
  });
  $effect(() => () => typed?.set(own, null));
  /** The focus is in the field (the list of options shows only then). */
  let focused = $state(false);
  /** The marked option of the list (Enter takes it). */
  let active = $state(0);

  /** The name a chip shows: its option's, else the value itself. */
  const labelOf = (value: string): string =>
    options?.find((option) => option.id === value)?.label ?? value;

  let box = $state<HTMLElement | null>(null);
  /** One line without the focus: how many chips fit before "+n" (null: all of them). */
  let fits = $state<number | null>(null);
  const lined = $derived(oneLine && !focused && values.length > 0);
  const shown = $derived(lined && fits !== null ? fits : values.length);
  const hidden = $derived(values.slice(shown).map(labelOf));

  /** The chips that fit on the line with room for "+n" and a caret; at least the first one,
   *  which shortens with an ellipsis when it is too long alone. Spare chips keep their
   *  width out of the flow, so they are measured like the shown ones. */
  function measure(): void {
    const node = box;
    if (node === null || !lined) {
      fits = null;
      return;
    }
    const style = getComputedStyle(node);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const caret = input === null ? 0 : Number.parseFloat(getComputedStyle(input).minWidth) || 0;
    const room =
      node.clientWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0) -
      caret;
    const chips = [...node.querySelectorAll<HTMLElement>('[data-chip]')];
    const more = (node.querySelector<HTMLElement>('[data-more]')?.offsetWidth ?? 0) + gap;
    let used = 0;
    let count = 0;
    for (const [index, chip] of chips.entries()) {
      // Its whole width, also while it is shortened (the text clips, its scroll width does not).
      const text = chip.querySelector<HTMLElement>('.text');
      const clipped = text === null ? 0 : text.scrollWidth - text.clientWidth;
      const width = chip.offsetWidth + clipped + gap;
      if (used + width + (index < chips.length - 1 ? more : 0) > room) break;
      used += width;
      count += 1;
    }
    fits = count >= chips.length ? null : Math.max(1, count);
  }

  $effect(() => {
    if (!oneLine || box === null) return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(box);
    return () => watch.disconnect();
  });
  // Again after the chips or the focus changed (effects run once the DOM has them).
  $effect(() => {
    void values.length;
    void lined;
    untrack(measure);
  });

  const known = (list: string[], text: string): boolean =>
    list.some((value) => value.toLowerCase() === text.toLowerCase());

  /** Options whose names start with the typed text (a whole name first), chosen or not. */
  const found = $derived(options === null ? [] : suggested(options, draft));
  /** The options found that are not chosen yet: the list under the field. */
  const matches = $derived(found.filter((option) => !values.includes(option.id)));
  const listed = $derived(focused && matches.length > 0);
  /** The typed text names an option that is a chip already: taking it only clears the text. */
  const chosen = $derived(
    options !== null &&
      folded(draft) !== '' &&
      options.some(
        (option) =>
          values.includes(option.id) &&
          [option.label, option.id, ...(option.terms ?? [])].some(
            (name) => folded(name) === folded(draft),
          ),
      ),
  );
  /** The typed text names no option at all (one that is chosen already is no news). */
  const nothing = $derived(options !== null && folded(draft) !== '' && found.length === 0);

  $effect(() => {
    void draft;
    active = 0;
  });

  function update(next: string[]): void {
    values = next;
    onchange?.(next);
  }

  /** Adds every entry of `text` that is not there yet; `true` if there was text. */
  function add(text: string): boolean {
    const parts = text
      .split(separators)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (parts.length === 0) return false;
    const next = [...values];
    for (const part of parts) {
      if (!known(next, part)) next.push(part);
    }
    if (next.length !== values.length) update(next);
    return true;
  }

  /** An option goes in as a chip; the typed text is done. */
  function choose(option: ChipOption): void {
    if (!values.includes(option.id)) update([...values, option.id]);
    draft = '';
  }

  /** Enter: the marked option (with options), else the typed text; `true` if there was text. */
  function commit(): boolean {
    if (options !== null) {
      if (draft.trim() === '') return false;
      const option = matches[active] ?? matches[0];
      if (option) choose(option);
      else if (chosen) draft = '';
      return true;
    }
    const added = add(draft);
    draft = '';
    return added;
  }

  /** The field is left: typed text becomes chips; with options only a single match. */
  function leave(): void {
    focused = false;
    settle();
  }

  /** Typed text becomes chips as when leaving the field; with options only a single match. */
  function settle(): void {
    if (options === null) {
      commit();
      return;
    }
    const exact = matches.filter((option) =>
      [option.label, option.id, ...(option.terms ?? [])].some(
        (name) => folded(name) === folded(draft),
      ),
    );
    const only = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    if (only) choose(only);
    else if (chosen) draft = '';
  }

  function remove(index: number): void {
    update(values.filter((_, at) => at !== index));
    if (entry) input?.focus();
  }

  /** The keys of input.ts; the arrows move the mark in the list of options. */
  const keys: ChipKeyHandlers & { step: (by: -1 | 1) => boolean } = {
    commit,
    settle,
    removeLast: (): boolean => {
      if (draft !== '' || values.length === 0) return false;
      update(values.slice(0, -1));
      return true;
    },
    clear: (): boolean => {
      if (draft === '') return false;
      draft = '';
      return true;
    },
    step: (by: -1 | 1): boolean => {
      if (!listed) return false;
      active = (active + by + matches.length) % matches.length;
      return true;
    },
  };

  /** A pasted list becomes chips at once; a single value is pasted as text. With options
   *  a paste is text to search. */
  function paste(event: ClipboardEvent): void {
    if (options !== null) return;
    const text = event.clipboardData?.getData('text') ?? '';
    if (!separators.test(text.trim())) return;
    event.preventDefault();
    add(`${draft}\n${text}`);
    draft = '';
  }

  /** A double click on a chip: what was typed becomes a chip, the chip's text goes back
   *  into the field with the caret at its end. */
  function edit(index: number): void {
    const value = values[index];
    if (!entry || options !== null || value === undefined) return;
    commit();
    update(values.filter((other) => other !== value));
    draft = value;
    input?.focus();
    queueMicrotask(() => input?.setSelectionRange(value.length, value.length));
  }

  /** A press on the free area of the field (or on "+n") puts the caret into its input. */
  function focusInput(event: PointerEvent): void {
    const more = event.target instanceof Element && event.target.closest('[data-more]') !== null;
    if (!entry || event.button !== 0 || (event.target !== event.currentTarget && !more)) return;
    event.preventDefault();
    input?.focus();
  }
</script>

<div class="chip-input" class:suggests={options !== null}>
  <div
    bind:this={box}
    class="field"
    class:invalid
    class:entry
    class:filled={values.length > 0}
    class:lined
    role="presentation"
    data-testid={testid ?? undefined}
    onpointerdown={focusInput}
    use:chipEdit={entry && options === null ? edit : null}
  >
    {#each values as value, index (value)}
      <span class="chip" class:spare={index >= shown} data-chip={index} data-value={value}>
        <span class="text" data-copy>{labelOf(value)}</span>
        <button
          type="button"
          class="remove"
          tabindex="-1"
          data-keep-focus
          aria-label={t.chips.remove(labelOf(value))}
          use:tooltip={t.chips.remove(labelOf(value))}
          onclick={() => remove(index)}
        >
          <Icon name="close" size="xs" />
        </button>
      </span>
    {/each}
    {#if lined}
      <span
        class="chip more"
        class:spare={hidden.length === 0}
        data-more
        data-testid={testid ? `${testid}-more` : undefined}
        use:tooltip={hidden.length > 0 ? hidden.join(', ') : null}
      >
        {t.chips.more(Math.max(hidden.length, 1))}
      </span>
    {/if}
    {#if entry}
      <input
        bind:this={input}
        bind:value={draft}
        class="input"
        type="text"
        id={id ?? undefined}
        role={options !== null ? 'combobox' : undefined}
        aria-autocomplete={options !== null ? 'list' : undefined}
        aria-expanded={options !== null ? listed : undefined}
        aria-controls={options !== null ? `${own}-options` : undefined}
        aria-activedescendant={listed ? `${own}-option-${active}` : undefined}
        aria-label={label ?? undefined}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={[describedby ?? described(), nothing ? `${own}-none` : null]
          .filter((part) => part !== null)
          .join(' ') || undefined}
        placeholder={values.length === 0 ? (placeholder ?? undefined) : undefined}
        spellcheck={FIELD_ATTRIBUTES.spellcheck}
        autocorrect={FIELD_ATTRIBUTES.autocorrect}
        autocapitalize={FIELD_ATTRIBUTES.autocapitalize}
        autocomplete={FIELD_ATTRIBUTES.autocomplete}
        use:chipKeys={keys}
        onpaste={paste}
        onfocus={() => (focused = true)}
        onblur={leave}
      />
    {/if}
  </div>
  {#if options !== null}
    <div
      class="options"
      id="{own}-options"
      role="listbox"
      aria-label={label ?? placeholder ?? undefined}
      hidden={!listed}
      data-testid={testid ? `${testid}-options` : undefined}
    >
      {#each listed ? matches : [] as option, index (option.id)}
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
          onclick={() => choose(option)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    {#if nothing && noMatch}
      <p class="none" id="{own}-none" data-testid={testid ? `${testid}-none` : undefined}>
        {noMatch}
      </p>
    {/if}
  {/if}
</div>

<style>
  /* One line of chips inside the 32 px of a field: 32 - 2 x 4 padding - 2 x 1 edge. */
  .chip-input {
    --chip-line: calc(var(--control-field) - 2 * var(--space-4) - 2 * var(--border-width));

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

  .entry {
    min-height: var(--control-field);
    padding: var(--space-4);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    cursor: text;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }

  .entry:hover {
    border-color: var(--control-hover-edge);
  }

  .entry:focus-within {
    border-color: var(--focus);
  }

  .invalid,
  .invalid:hover {
    border-color: var(--danger-strong);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    min-height: var(--chip-line);
    padding: 0 var(--space-2) 0 var(--space-8);
    border-radius: var(--radius-full);
    background-color: var(--active-surface);
    color: var(--active-text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
    cursor: default;
  }

  /* A long value wraps at its spaces; a word breaks only when it cannot fit alone. */
  .text {
    min-width: 0;
    overflow-wrap: break-word;
  }

  .remove {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-full);
    color: var(--active-text);
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard);
  }

  .remove:hover {
    background-color: var(--active-hover);
    transition-duration: var(--dur-hover);
  }

  .input {
    flex: 1 1 0;
    min-width: var(--space-48);
    height: var(--chip-line);
    padding: 0 var(--space-8);
    border: 0;
    background-color: transparent;
    color: var(--text);
    font: var(--type-field);
    outline: none;
  }

  /* Next to chips the caret needs little room; while typing the field takes a line of
     its own where the chips leave too little. */
  .filled .input {
    min-width: var(--space-8);
  }

  .filled .input:focus {
    min-width: var(--space-64);
  }

  /* A field that searches its options keeps room to type next to its chips. */
  .suggests .filled .input {
    min-width: var(--space-64);
  }

  .input::placeholder {
    color: var(--text-subtle);
  }

  /* One line without the focus: the first chip shortens with an ellipsis, spare chips keep
     their width out of the flow (measured, never seen). */
  .lined {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .lined .chip {
    flex: 0 1 auto;
    min-width: 0;
  }

  .lined .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip.spare {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
  }

  .more {
    flex: none;
    padding: 0 var(--space-8);
    background-color: var(--surface-muted);
    color: var(--text-muted);
    font-variant-numeric: var(--numeric);
  }

  /* The options drop down under the field, over what follows, like a native menu. */
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

  /* One mark: the pointer moves it (pointermove), never a second wash of its own. */
  .option.active {
    background-color: var(--active-surface);
    color: var(--active-text);
  }

  .none {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
