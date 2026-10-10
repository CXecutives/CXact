<!--
  One job in the list, mail-style with fixed gutters: the unread dot (6 px, coral) centred
  in the pane padding on the axis of the ring (so a title never moves when the job is read),
  the ring, then two lines (user decision 2026-09-27: the row says what, where and for how
  much, the reader everything else):
  1. the title on one line (every row one height; a cut title shows in full in a tooltip; a
     new job's title is drawn heavier without getting wider, so reading a job never moves it;
     while a search is on, its words are marked in the title in a soft yellow, in any case
     and with or without accents, as the search finds them)
     and at the end of the line its stamp like a mail list: when the job came in (the time
     today, "Gestern", "Vorgestern", then "Mi 23.09."; in the Papierkorb the day the job went
     there), never its application deadline (user decision 2026-09-27: the reader's
     Jobdetails name it). An ad that no longer takes applications says "Beendet" there, its
     title muted (the order by match puts it after the open ones).
  2. the job at a glance (JobMeta): the company, the place and the pay the ad states; the
     company and the place are cut at the line's end, the pay never.
  No portal, no facts, no badges: the reader has them. Under the pointer (and while the
  row's menu is open) the row's tools, the moves of its place (actions.ts rowTools:
  Archivieren and Löschen, Zurückholen and Löschen, Wiederherstellen and Endgültig
  löschen), fade in as icons over the date, which fades out: they stand in a fixed slot at
  the end of the title line that is always as wide as they are, so nothing moves and the
  title keeps its room. Each names itself in its tooltip; Endgültig löschen is red.
  They are siblings of the row's button (a click on one never opens the job, a double click
  never its ad: that is the row button's own), out of the Tab
  order (the row's menu is there for the keyboard), and exist only while they show. After a
  tool took its row away, the row that slides under the pointer shows its tools only once
  the pointer moves (input.ts `hover`). The row's menu (a right click, the app's own) and a
  double click (the ad in the browser) act on the job too. The ring
  stays hollow on the open row (its track is never tinted); without a usable profile it is
  empty (a dash). An excluded job shows the red ban on a light red track in the ring's place
  and its title muted. A new job (lib/state/filter.ts `isNew`: not opened yet and not excluded) carries
  the dot and the heavier title in every place, like a mail app's unread mark; when it is
  read while its row is on screen the dot shrinks away. Stamps follow the page's clock (they move on while
  the app stays open). Layout stays inside the row (containment); like the row, its
  hover rests while the list scrolls (`data-still`, see ListRow).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  import { t } from '$lib/i18n/t';
  import type { JobView } from '$lib/ipc/types';

  /** A character as the search compares it: lower case, without its accents. */
  const fold = (char: string): string =>
    char
      .toLocaleLowerCase('de')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');

  /** `text` in parts, those that hold a word of the search marked (every place a word
   *  stands, compared like the search: in any case, with or without accents). */
  function markedParts(text: string, words: readonly string[]): { text: string; mark: boolean }[] {
    const chars = Array.from(text);
    if (words.length === 0 || chars.length === 0) return [{ text, mark: false }];
    // The folded text, and for each of its characters the character of `text` it came from.
    let folded = '';
    const from: number[] = [];
    chars.forEach((char, at) => {
      for (const part of Array.from(fold(char))) {
        folded += part;
        from.push(at);
      }
    });
    const marked = new Array<boolean>(chars.length).fill(false);
    for (const word of words.map((each) => Array.from(each).map(fold).join(''))) {
      if (word === '') continue;
      for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) {
        const end = from[at + word.length - 1] ?? chars.length - 1;
        for (let index = from[at] ?? 0; index <= end; index += 1) marked[index] = true;
      }
    }
    const parts: { text: string; mark: boolean }[] = [];
    chars.forEach((char, at) => {
      const last = parts.at(-1);
      if (last !== undefined && last.mark === marked[at]) last.text += char;
      else parts.push({ text: char, mark: marked[at] ?? false });
    });
    return parts;
  }

  /** A tool of the row under the pointer: a move of the job's place (actions.ts rowTools). */
  export interface RowTool {
    id: string;
    icon: IconName;
    /** Its name: the tooltip and the accessible name of the icon. */
    label: string;
    /** It deletes the job (Löschen, Endgültig löschen): drawn in red. */
    deletes: boolean;
    disabled: boolean;
    /** Why a disabled tool waits (its tooltip). */
    reason: string | null;
    run: () => void;
  }
</script>

<script lang="ts">
  import { contextMenu, holdHover, hover, type ContextMenu } from '$lib/input/input';
  import { tooltip } from '$lib/actions/tooltip';
  import { displayTitle, formatStamp } from '$lib/i18n/format';
  import { dotOut, fade } from '$lib/motion/transitions';
  import { clock } from '$lib/state/clock.svelte';
  import { isNew } from '$lib/state/filter';
  import Button from './Button.svelte';
  import JobMeta from './JobMeta.svelte';
  import ListRow from './ListRow.svelte';
  import ScoreRing, { ringState } from './ScoreRing.svelte';

  interface Props {
    job: JobView;
    selected?: boolean;
    /** Scoring is still running for this job. */
    pending?: boolean;
    /** A usable profile is there (without one the ring is an empty placeholder: no match). */
    ring?: boolean;
    /** Fixed "now" for the stamp (tests). */
    now?: Date;
    /** The words of the search the list shows (marked in the title). */
    marks?: readonly string[];
    /** A click on the row. */
    onselect?: ((job: JobView) => void) | null;
    /** A double click on the row: the ad opens in the browser. */
    onopen?: ((job: JobView) => void) | null;
    /** The job's menu on a right click (null: none). */
    menu?: (() => ContextMenu | null) | null;
    /** The row's tools under the pointer (null: none). */
    tools?: (() => readonly RowTool[]) | null;
    /** The row's test id (another list of the same jobs needs its own). */
    testid?: string | null;
  }

  let {
    job,
    selected = false,
    pending = false,
    ring = true,
    now,
    marks = [],
    onselect = null,
    onopen = null,
    menu = null,
    tools = null,
    testid = null,
  }: Props = $props();

  const excluded = $derived(job.match?.status === 'excluded');
  /** Not opened yet and not excluded: the dot and the heavier title, in every place. */
  const fresh = $derived(isNew(job));
  /** The day the job came into CXact; in the Papierkorb the moment it went there (the date
   *  the trash sorts by). */
  const when = $derived((job.place === 'trash' ? job.trashedAt : null) ?? job.firstSeenAt);
  const current = $derived(now ?? clock.now);
  const rowId = $derived(testid ?? `job-row-${job.key.portal}-${job.key.id}`);
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  /** The title with the words of the search marked. */
  const titleParts = $derived(markedParts(heading, marks));
  /** The end of the title line: "Beendet" for an ad that takes no applications, else when
   *  the job came in. */
  const stamp = $derived(job.closed ? t.job.closed : formatStamp(when, current));

  /** The pointer is on the row (after a tool took a row away: once it moved). */
  let here = $state(false);
  /** The row's menu is open (its tools stay while the pointer is on the menu). */
  let menuOpen = $state(false);
  const tooled = $derived(tools !== null && (here || menuOpen));

  /** The job's menu, which keeps the row's tools while it is open. */
  const offer = $derived.by(() => {
    const own = menu;
    if (own === null) return null;
    return (): ContextMenu | null => {
      const opened = own();
      if (opened === null) return null;
      menuOpen = true;
      return { ...opened, onclose: () => (menuOpen = false) };
    };
  });

  /** A tool is for the pointer: out of the Tab order (the row and its menu are the keys'). */
  function untabbed(node: HTMLElement): void {
    for (const button of node.querySelectorAll('button')) button.tabIndex = -1;
  }

  /** A tool: its row leaves, and the next one waits for the pointer to move. */
  function runTool(tool: RowTool, event: MouseEvent): void {
    holdHover(event);
    tool.run();
  }
</script>

{#snippet leading()}
  {#if excluded}
    <ScoreRing ring={{ status: 'off' }} size="sm" ban testid="row-excluded" />
  {:else}
    <ScoreRing
      ring={ring ? ringState(job.match, pending, job.detail.kind) : { status: 'off' }}
      size="sm"
    />
  {/if}
{/snippet}

<div
  class="job"
  class:tooled
  class:excluded
  data-rests=""
  use:hover={(on) => (here = on)}
  use:contextMenu={offer}
>
  <ListRow
    {leading}
    {selected}
    onclick={onselect ? () => onselect?.(job) : null}
    ondouble={onopen ? () => onopen?.(job) : null}
    testid={rowId}
  >
    <span class="head">
      <span
        class="title"
        class:unread={fresh}
        class:closed={job.closed}
        use:tooltip={{ text: heading, truncated: true }}
        >{#each titleParts as part, index (index)}{#if part.mark}<mark class="hit">{part.text}</mark
            >{:else}{part.text}{/if}{/each}</span
      >
      <span class="date" data-testid="row-date"><span class="stamp">{stamp}</span></span>
    </span>
    <JobMeta {job} prefix="row" />
  </ListRow>
  {#if fresh}<span class="dot" role="img" aria-label={t.job.unread} out:dotOut></span>{/if}
  {#if tooled && tools}
    <span class="tools" data-testid="row-tools" transition:fade>
      {#each tools() as tool (tool.id)}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            iconOnly
            icon={tool.icon}
            label={tool.label}
            deletes={tool.deletes}
            disabled={tool.disabled}
            disabledReason={tool.reason}
            testid="tool-{tool.id}"
            onclick={(event) => runTool(tool, event)}
          />
        </span>
      {/each}
    </span>
  {/if}
</div>

<style>
  .job {
    position: relative;
    /* Layout containment only: paint containment gave every row a clip of its own, and the
       compositor's work each frame grows with such nodes (a long list, long frames). */
    contain: layout;
  }

  /* The unread dot: centred in the pane padding, on the axis of the ring (the row's middle). */
  .dot {
    position: absolute;
    top: calc(50% - var(--dot-unread) / 2);
    left: calc((var(--pane-padding) - var(--dot-unread)) / 2);
    width: var(--dot-unread);
    height: var(--dot-unread);
    border-radius: var(--radius-full);
    background-color: var(--unread);
    pointer-events: none;
  }

  /* The title line: the title, the stamp at the end. */
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    height: var(--leading-title);
  }

  /* One line for every title, so every row has one height (user, 2026-09-25): a long title
     ends in an ellipsis and shows in full in a tooltip. */
  .title {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font: var(--type-title);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Unread: heavier strokes on the same glyph advances (a heavier weight is wider, and a
     title near the end of its line would wrap anew when the job is read). */
  .title.unread {
    -webkit-text-stroke: calc(var(--border-width) * 0.4) currentcolor;
  }

  /* A word of the search: a soft mark under the ink (the title's own colour). */
  .hit {
    border-radius: var(--radius-xs);
    background-color: var(--mark);
    color: inherit;
  }

  /* An ad that takes no applications any more, and an excluded job: its title steps back. */
  .title.closed,
  .excluded .title {
    color: var(--text-muted);
  }

  /* The stamp at the end of the title line, in the tools' slot (as wide as the two tools at
     least, so the title's room never changes); it steps up from subtle to muted on hover and
     fades out while the tools show. */
  .date {
    flex: none;
    min-width: calc(2 * var(--control-field) + var(--space-2) + var(--space-6));
    margin-left: auto;
    padding-left: var(--space-6);
    color: var(--text-subtle);
    text-align: end;
    white-space: nowrap;
    transition:
      color var(--dur-base) var(--ease-standard),
      opacity var(--dur-fast) var(--ease-standard);
  }

  .tooled:where(:not([data-still])) .date {
    opacity: 0;
  }

  .stamp {
    font: var(--type-xs);
    font-variant-numeric: var(--numeric);
  }

  .job:hover:where(:not([data-still])) .date {
    color: var(--text-muted);
    transition-duration: var(--dur-hover);
  }

  /* The row keeps its wash while the pointer is on a tool (a sibling of the row's button);
     a pressed row keeps its own look. */
  .job:hover:where(:not([data-still])) :global(.row:not(.selected, :active)) {
    background-color: var(--quiet-hover);
  }

  .job:hover:where(:not([data-still])) :global(.row.selected:not(:active)) {
    background-color: var(--surface-selected-hover);
  }

  /* The tools over the date, centred on the title line, their right edge on the date's. */
  .tools {
    position: absolute;
    top: calc(var(--list-row-pad) + (var(--leading-title) - var(--control-field)) / 2);
    right: var(--pane-padding);
    display: flex;
    gap: var(--space-2);
  }

  /* Shown while the row is tooled; while the list scrolls the row rests: no tools, the date
     stays. */
  .tool {
    display: inline-flex;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .tooled:where(:not([data-still])) .tool {
    opacity: 1;
  }

  /* On the washed row a tool's own hover is one step deeper (the red of one that deletes
     stays its own). */
  .tool :global(.btn.ghost:not(.deletes)) {
    --btn-bg-hover: var(--quiet-press);
  }
</style>
