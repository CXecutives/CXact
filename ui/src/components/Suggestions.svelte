<!--
  Suggestions under a field that takes free text (a competence, its synonyms, tools, search
  terms, industries): the terms of a vocabulary (the engine's words) that start with what
  was typed, a whole term first, then a word of one, at most eight, the shorter first; none
  once the text is a term already (the list would only cover what follows). The
  list drops down under the field like a native menu; its one mark comes only with the
  arrows or the pointer, so Enter without a mark keeps what was typed and nothing is ever
  replaced by itself. A click or Enter on the mark takes the term; Esc closes the list. The
  field owns the keys (input.ts chipKeys) and says which term is marked; this list draws
  them.
-->
<script lang="ts" module>
  /** Terms prepared once for quick finding: their folded forms and their words. */
  export interface Vocabulary {
    terms: readonly string[];
    folded: readonly string[];
    words: readonly (readonly string[])[];
  }

  /** At most this many suggestions show. */
  const MOST = 8;
  /** Suggestions start with the second character typed. */
  const FROM = 2;

  /** Lower case without accents (`Österreich` is found by `oster` and `öster`). */
  export function folded(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss').trim();
  }

  export function vocabularyOf(terms: readonly string[]): Vocabulary {
    const all = terms.map(folded);
    return { terms, folded: all, words: all.map((term) => term.split(/[\s\-/]+/)) };
  }

  /** The terms that start with `text` (a whole term first, then a word of one), the shorter
   *  first; none that is typed already or `taken` (in any case), none once `text` is a term. */
  export function suggest(
    vocabulary: Vocabulary,
    text: string,
    taken: readonly string[] = [],
  ): string[] {
    const query = folded(text);
    if (query.length < FROM || vocabulary.folded.includes(query)) return [];
    const skip = new Set([query, ...taken.map(folded)]);
    const found: { term: string; rank: number }[] = [];
    vocabulary.folded.forEach((term, at) => {
      if (skip.has(term)) return;
      const rank = term.startsWith(query)
        ? 0
        : vocabulary.words[at]!.some((word) => word.startsWith(query))
          ? 1
          : 2;
      if (rank < 2) found.push({ term: vocabulary.terms[at]!, rank });
    });
    return found
      .sort((a, b) => a.rank - b.rank || a.term.length - b.term.length)
      .slice(0, MOST)
      .map((entry) => entry.term);
  }
</script>

<script lang="ts">
  interface Props {
    /** The listbox's id (the field's aria-controls). */
    id: string;
    items: readonly string[];
    /** The marked one, -1 for none. */
    active: number;
    label?: string | null;
    testid?: string | null;
    onpick: (term: string) => void;
    onmark: (index: number) => void;
  }

  let { id, items, active, label = null, testid = null, onpick, onmark }: Props = $props();
</script>

<div
  class="suggestions"
  {id}
  role="listbox"
  aria-label={label ?? undefined}
  hidden={items.length === 0}
  data-testid={testid ?? undefined}
>
  {#each items as item, index (item)}
    <button
      type="button"
      class="suggestion"
      class:active={index === active}
      id="{id}-{index}"
      role="option"
      aria-selected={index === active}
      tabindex="-1"
      data-keep-focus
      onpointermove={() => onmark(index)}
      onclick={() => onpick(item)}
    >
      {item}
    </button>
  {/each}
</div>

<style>
  /* Under the field, over what follows, like a native menu. */
  .suggestions {
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

  .suggestions[hidden] {
    display: none;
  }

  .suggestion {
    display: block;
    flex: none;
    height: var(--control-sm);
    padding: 0 var(--space-8);
    overflow: hidden;
    border-radius: var(--radius-xs);
    color: var(--text);
    font: var(--type-field);
    line-height: var(--control-sm);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One mark: the pointer moves it as the arrows do, never a second wash of its own. */
  .suggestion.active {
    background-color: var(--active-surface);
    color: var(--active-text);
  }
</style>
