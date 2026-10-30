<!--
  The ad as text in its own structure (JobDetail.layout, what the engine reads), ink 14/23
  with its blocks 10 apart, a heading 14 under what ends and 4 above what it leads: the lines that head a section ("Ihre
  Aufgaben", "Ihr Profil", "Wünschenswert", "Rahmen", "Responsibilities") stand in ink and
  bold, the lines a bullet leads are a clean list 18 in (the bullet drawn by the list, not the
  ad's glyph), everything else stays text with its line breaks. The text is cut at the ends of every word of the list's search, each piece a
  text node or a <mark>: a word of the search stands on the search's mark colour
  (--mark) while the search is on. Nothing else is marked (hovering the reader's rows
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
  /* Running text in ink like the facts above it, the page's main reading (owner, 2026-10-30),
     14/23, its blocks 10 apart. */
  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    color: var(--text);
    font: var(--type-body);
    overflow-wrap: anywhere;
  }

  .paragraph {
    white-space: pre-line;
  }

  /* A section's heading: its line in ink and bold, like the ad's own bold words. */
  .heading {
    color: var(--text-heading);
    font-weight: var(--weight-semibold);
  }

  /* A heading leads what follows it: nearer to that than to what ends above it. */
  .paragraph + .heading,
  .list + .heading {
    margin-top: var(--space-4);
  }

  .heading + .paragraph,
  .heading + .list {
    margin-top: calc(-1 * var(--space-6));
  }

  /* The ad's bullets as a list, 18 in; the bullets drawn by the list. */
  .list {
    display: flex;
    flex-direction: column;
    padding-inline-start: var(--ad-indent);
    list-style: disc outside;
  }

  /* A word of the list's search, while the search is on. */
  .hit {
    border-radius: var(--radius-xs);
    background-color: var(--mark);
    color: var(--text);
  }
</style>
