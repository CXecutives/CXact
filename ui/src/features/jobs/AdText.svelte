<!--
  The ad as text in its own structure (JobDetail.layout, what the engine reads): the lines
  that head a section ("Ihre Aufgaben", "Ihr Profil", "Wünschenswert", "Rahmen",
  "Responsibilities") are small bold headings, the lines a bullet leads are a clean indented
  list (the bullet drawn by the list, not the ad's glyph), everything else stays text with its
  line breaks. The text is cut at the ends of every word of the list's search, each piece a
  text node or a <mark>: a word of the search stands on the search's mark colour
  (--mark-search) while the search is on. Nothing else is marked (hovering the reader's rows
  tints nothing here, user decision 2026-09-27). No underline, no tooltip, no HTML from the
  page (text nodes and marks only). Offsets are UTF-16, as the browser counts. The text selects
  and copies like a document (`data-copy`).
-->
<script lang="ts" module>
  import type { TextLayout } from '$lib/ipc/types';

  interface Range {
    start: number;
    end: number;
  }

  interface Piece {
    text: string;
    /** A word of the search covers it. */
    hit: boolean;
  }

  type Block =
    | { kind: 'heading'; range: Range }
    | { kind: 'list'; items: Range[] }
    | { kind: 'text'; range: Range };

  /** Words a search takes at most (the list's search reads as many). */
  const SEARCH_WORDS = 8;

  /** Where the words of the search stand in the text, case aside (like the list's search). */
  function hitsOf(text: string, search: string): Range[] {
    const words = search.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS);
    if (words.length === 0) return [];
    const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escaped.join('|'), 'giu');
    return [...text.matchAll(pattern)].map((hit) => ({
      start: hit.index,
      end: hit.index + hit[0].length,
    }));
  }

  /** The text's blocks, line by line: a heading line, a run of list lines, a paragraph (its
   *  lines up to a blank one). */
  function blocksOf(text: string, layout: TextLayout): Block[] {
    const blocks: Block[] = [];
    let paragraph: Range | null = null;
    let list: Range[] | null = null;
    const end = (): void => {
      if (paragraph !== null) blocks.push({ kind: 'text', range: paragraph });
      if (list !== null) blocks.push({ kind: 'list', items: list });
      paragraph = null;
      list = null;
    };
    const within = (line: Range) => (range: Range) =>
      range.start >= line.start && range.start < Math.max(line.end, line.start + 1);
    let start = 0;
    for (const words of text.split('\n')) {
      const line = { start, end: start + words.length };
      start = line.end + 1;
      const heading = layout.headings.find(within(line));
      const bullet = layout.bullets.find(within(line));
      if (heading !== undefined) {
        end();
        blocks.push({ kind: 'heading', range: { start: heading.start, end: heading.end } });
      } else if (bullet !== undefined) {
        if (paragraph !== null) end();
        list ??= [];
        list.push({ start: bullet.end, end: line.end });
      } else if (words.trim() === '') {
        end();
      } else {
        if (list !== null) end();
        paragraph = paragraph === null ? line : { start: paragraph.start, end: line.end };
      }
    }
    end();
    return blocks;
  }

  /** The part of the text from `start` to `end`, cut at every hit's ends; each piece knows
   *  whether a hit covers it. */
  function pieces(text: string, { start, end }: Range, hits: readonly Range[]): Piece[] {
    const words = hits.filter((p) => p.start < p.end && p.start < end && p.end > start);
    const clip = (at: number): number => Math.min(end, Math.max(start, at));
    const cuts = [
      ...new Set([start, end, ...words.flatMap((p) => [clip(p.start), clip(p.end)])]),
    ].sort((a, b) => a - b);
    const out: Piece[] = [];
    for (let index = 0; index + 1 < cuts.length; index += 1) {
      const from = cuts[index] ?? start;
      const to = cuts[index + 1] ?? from;
      const covers = (p: Range): boolean => p.start <= from && p.end >= to;
      out.push({ text: text.slice(from, to), hit: words.some(covers) });
    }
    return out;
  }
</script>

<script lang="ts">
  interface Props {
    text: string;
    /** Its headings and list lines. */
    layout: TextLayout;
    /** The list's search: its words stand marked ('' for none). */
    search?: string;
  }
  let { text, layout, search = '' }: Props = $props();

  const blocks = $derived(blocksOf(text, layout));
  const hits = $derived(hitsOf(text, search));
  const parts = (range: Range): Piece[] => pieces(text, range, hits);
</script>

{#snippet run(range: Range)}{#each parts(range) as part, index (index)}{#if part.hit}<mark
        class="hit">{part.text}</mark
      >{:else}{part.text}{/if}{/each}{/snippet}

<div class="text" data-testid="ad-text" data-copy>
  {#each blocks as block, index (index)}
    {#if block.kind === 'heading'}
      <h3 class="heading" data-testid="ad-heading">{@render run(block.range)}</h3>
    {:else if block.kind === 'list'}
      <ul class="list">
        {#each block.items as item, at (at)}
          <li class="item" data-testid="ad-item">{@render run(item)}</li>
        {/each}
      </ul>
    {:else}
      <p class="paragraph">{@render run(block.range)}</p>
    {/if}
  {/each}
</div>

<style>
  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    color: var(--text);
    font: var(--type-body);
    overflow-wrap: anywhere;
  }

  .paragraph {
    white-space: pre-line;
  }

  /* A section's heading: small and bold, close above what it heads. */
  .heading {
    margin-bottom: calc(var(--space-4) - var(--space-12));
    color: var(--text-heading);
    font-weight: var(--weight-semibold);
  }

  /* The ad's bullets as a list: indented, the bullets quiet. */
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-inline-start: var(--space-20);
    list-style: disc outside;
  }

  .item::marker {
    color: var(--text-subtle);
  }

  /* Untinted, a passage is the text around it. */
  /* A word of the list's search, while the search is on. */
  .hit {
    border-radius: var(--radius-xs);
    background-color: var(--mark-search);
    color: inherit;
  }
</style>
