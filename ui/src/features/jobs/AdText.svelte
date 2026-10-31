<!--
  The ad as text in its own structure (JobDetail.layout, what the engine reads), ink 14/23
  with its blocks 10 apart, a heading 14 under what ends and 4 above what it leads: the lines that head a section ("Ihre
  Aufgaben", "Ihr Profil", "Wünschenswert", "Rahmen", "Responsibilities") stand in ink and
  bold, the lines a bullet leads are a clean list 18 in (the bullet drawn by the list, not the
  ad's glyph), everything else stays text with its line breaks. The text is cut at the ends of every word of the list's search, each piece a
  text node or a <mark>: a word of the search, as the row's title marks it (lib/marks.ts), stands
  on the search's mark colour (--mark) while the search is on. Nothing else is marked (hovering
  the reader's rows tints nothing here, user decision 2026-09-27). No underline, no tooltip, no HTML from the
  page (text nodes and marks only). Offsets are UTF-16, as the browser counts. The text selects
  and copies like a document (`data-copy`).
-->
<script lang="ts" module>
  import type { TextLayout } from '$lib/ipc/types';

  interface Range {
    start: number;
    end: number;
  }

  type Block =
    | { kind: 'heading'; range: Range }
    | { kind: 'list'; items: Range[] }
    | { kind: 'text'; range: Range };

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
</script>

<script lang="ts">
  import { markedParts, searchWords } from '$lib/marks';

  interface Props {
    text: string;
    /** Its headings and list lines. */
    layout: TextLayout;
    /** The list's search: its words stand marked ('' for none). */
    search?: string;
  }
  let { text, layout, search = '' }: Props = $props();

  const blocks = $derived(blocksOf(text, layout));
  const words = $derived(searchWords(search));
</script>

{#snippet run({
  start,
  end,
}: Range)}{#each markedParts(text.slice(start, end), words) as part, index (index)}{#if part.mark}<mark
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
