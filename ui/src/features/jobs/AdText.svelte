<!--
  The ad as plain text, its passages ready to be tinted: the text is cut at the ends of every
  passage the reader knows (a row of the Jobdetails, a requirement), each piece a text node or
  a <mark> that names the items it belongs to. Nothing shows until an item is hovered (`lit`:
  its passages take a soft tint) or jumped to (`flash`: they light up once and settle). No
  underline, no tooltip, no HTML from the page (text nodes and marks only). Offsets are UTF-16,
  as the browser counts. The text selects and copies like a document (`data-copy`).
-->
<script lang="ts" module>
  /** A passage of the text and the item (a row, a requirement) it belongs to. */
  export interface Passage {
    item: string;
    start: number;
    end: number;
  }

  interface Piece {
    text: string;
    /** The items whose passages cover it (none: plain text). */
    items: readonly string[];
  }

  /** The text cut at every passage's ends; each piece knows the items that cover it. */
  function pieces(text: string, passages: readonly Passage[]): Piece[] {
    const inside = passages.filter((p) => p.start >= 0 && p.start < p.end && p.end <= text.length);
    const cuts = [...new Set([0, text.length, ...inside.flatMap((p) => [p.start, p.end])])].sort(
      (a, b) => a - b,
    );
    const out: Piece[] = [];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index] ?? 0;
      const to = cuts[index + 1] ?? from;
      const items = [
        ...new Set(inside.filter((p) => p.start <= from && p.end >= to).map((p) => p.item)),
      ];
      out.push({ text: text.slice(from, to), items });
    }
    return out;
  }
</script>

<script lang="ts">
  interface Props {
    text: string;
    passages: readonly Passage[];
    /** The item whose passages are tinted (the hovered row), or null. */
    lit: string | null;
    /** The item whose passages flash once (after a jump to them), or null. */
    flash: string | null;
  }
  let { text, passages, lit, flash }: Props = $props();

  const parts = $derived(pieces(text, passages));
</script>

<div class="text" data-testid="ad-text" data-copy>
  {#each parts as part, index (index)}{#if part.items.length > 0}<mark
        class="passage"
        class:lit={lit !== null && part.items.includes(lit)}
        class:flash={flash !== null && part.items.includes(flash)}
        data-items={part.items.join(' ')}>{part.text}</mark
      >{:else}{part.text}{/if}{/each}
</div>

<style>
  .text {
    color: var(--text);
    font: var(--type-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  /* Untinted, a passage is the text around it. */
  .passage {
    border-radius: var(--radius-xs);
    background-color: transparent;
    color: inherit;
    transition: background-color var(--dur-base) var(--ease-standard);
  }

  .lit {
    background-color: var(--info-soft);
    transition-duration: var(--dur-hover);
  }

  /* After a jump: the passage lights up in navy ("here it is") and settles. */
  .flash {
    background-color: var(--border-navy);
    transition-duration: var(--dur-hover);
  }
</style>
