<!--
  The list under a field that suggests (round 10, the one look of every menu: rows 32 px,
  6 px round in a 10 px round box with 4 px around them, the pop shadow). Eight rows show whole
  and the room on the side it opens is its limit, beyond them it scrolls. It drops in under its
  field (150 ms, menuIn) and opens above it where only there is room. Two uses:
  - the terms of a vocabulary (the engine's words) for a field that takes free text (a
    competence, its synonyms, tools, industries): from the first character typed, the terms
    that start with it, a whole term first, then a word of one, at most eight, the shorter
    first; none once the text is a term already. Its one mark comes only with the arrows or
    the pointer, so Enter without a mark keeps what was typed;
  - the options of a field that takes only those (the countries): the field fills it.
  The mark is the light wash of a menu's marked row. As wide as its field at least, and as
  wide as its longest word up to a menu's most, so no word is cut beside free room. A click or
  Enter on the mark takes it; Esc closes the list. The field owns the keys (input.ts
  chipKeys) and says which row is marked; this list draws them and never takes the focus.
-->
<script lang="ts" module>
  /** A value a field with options can take: its id, its name, other names to find it by. */
  export interface ChipOption {
    id: string;
    label: string;
    terms?: readonly string[];
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

  /** Terms prepared once for quick finding: their folded forms and their words. */
  export interface Vocabulary {
    terms: readonly string[];
    folded: readonly string[];
    words: readonly (readonly string[])[];
  }

  /** At most this many suggestions show, and this many rows of a longer list of options. */
  const MOST = 8;
  /** Suggestions start with the first character typed (round 10). */
  const FROM = 1;

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
  import type { Action } from 'svelte/action';
  import { cssVars, px } from '$lib/actions/cssVars';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import { tokenPx } from '$lib/tokens';

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

  /** The list opened above its field (there was no room below). */
  let up = $state(false);
  /** How high it stands: its rows, at most eight, in the room on its side. */
  let height = $state(0);

  /** Below the field, or above it where only there is room, measured whenever the list, the
   *  field (it unfolds under a press) or the window changes size and when the page moves the
   *  field; the marked row stays in view. */
  const place: Action<HTMLElement, { count: number; active: number }> = (node, param) => {
    // The view's pane: it moves the field, and the room ends with it, above a bar at its foot.
    const pane = node.closest('[data-key-pane]');
    const measure = (count: number): void => {
      const field = node.parentElement?.getBoundingClientRect();
      if (field === undefined) return;
      const gap = tokenPx('--menu-gap');
      const edge = tokenPx('--viewport-gap');
      const end = pane?.getBoundingClientRect().bottom ?? document.documentElement.clientHeight;
      const below = end - edge - field.bottom - gap;
      const above = field.top - gap - tokenPx('--titlebar-height') - edge;
      const rows = Math.min(count, MOST) * tokenPx('--menu-row');
      const wanted = rows + 2 * (tokenPx('--menu-pad') + tokenPx('--border-width'));
      up = wanted > below && above > below;
      height = Math.min(wanted, up ? above : below);
    };
    const reveal = (index: number): void => {
      node.querySelector(`#${CSS.escape(`${id}-${index}`)}`)?.scrollIntoView({ block: 'nearest' });
    };
    measure(param.count);
    const observer = new ResizeObserver(() => measure(param.count));
    if (node.parentElement !== null) observer.observe(node.parentElement);
    observer.observe(document.documentElement);
    const moved = (): void => measure(param.count);
    pane?.addEventListener('scroll', moved, { passive: true });
    return {
      update(next) {
        if (next.count !== param.count) measure(next.count);
        if (next.active !== param.active && next.active >= 0) reveal(next.active);
        param = next;
      },
      destroy() {
        observer.disconnect();
        pane?.removeEventListener('scroll', moved);
      },
    };
  };
</script>

{#if items.length > 0}
  <div
    class="frame"
    class:up
    use:place={{ count: items.length, active }}
    use:cssVars={{ 'list-height': px(height) }}
    in:menuIn={{ up }}
    out:menuOut
  >
    <div
      class="suggestions"
      {id}
      role="listbox"
      aria-label={label ?? undefined}
      data-testid={testid ?? undefined}
    >
      <div class="plate">
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
    </div>
  </div>
{/if}

<style>
  /* Under the field, over what follows, like a menu: the box, 4 around the rows. */
  .frame {
    position: absolute;
    z-index: var(--z-overlay);
    top: calc(100% + var(--menu-gap));
    left: 0;
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 100%;
    max-width: var(--menu-max);
    max-height: var(--list-height);
    padding: var(--menu-pad);
    border: var(--border-width) solid var(--border);
    border-radius: var(--menu-radius);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-pop);
  }

  .frame.up {
    top: auto;
    bottom: calc(100% + var(--menu-gap));
  }

  /* The list that scrolls and the rows on a plate of their own, as in a menu (Menu.svelte says
     why). */
  .suggestions {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .plate {
    display: flex;
    flex-direction: column;
    background-color: var(--surface-raised);
  }

  .suggestion {
    display: block;
    flex: none;
    height: var(--menu-row);
    padding: 0 var(--menu-row-pad);
    overflow: hidden;
    border-radius: var(--menu-row-radius);
    color: var(--text);
    font: var(--type-md);
    line-height: var(--menu-row);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One mark: the pointer moves it as the arrows do, never a second wash of its own. */
  .suggestion.active {
    background-color: var(--quiet-hover);
  }
</style>
