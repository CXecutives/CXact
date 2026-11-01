<!--
  One job in the list, one line (the round 10 draft, user decision 2026-10-24): the ring (30)
  and the title (14/540). Nothing else: no company, place, rate, date or dot (the reader and
  the day's heading have them). The title stays on one line (every row one height; a cut
  title, and one that fits but ends under the row's tools, shows in full in a tooltip; while
  a search is on, its words are marked in a soft yellow, in any case and with or without
  accents, as the search finds them, lib/marks.ts). A new job
  (lib/state/filter.ts `isNew`: not opened yet and not excluded) has its title in 650 and a
  hidden "Neu" for screen readers. A job in the Papierkorb and an ad that takes no
  applications any more step back: the title muted in 450 (an excluded job is not muted, the
  red ban in the ring's place marks it).
  Under the pointer (and while the row's menu is open, which also keeps its wash, like the item a
  right click marks in Explorer and Finder) the row's tools fade in at its end:
  the moves of its place (actions.ts rowTools: Archivieren and In den Papierkorb legen, Nach
  Aktuell verschieben and In den Papierkorb legen, Wiederherstellen and Endgültig löschen),
  quiet icon buttons that name themselves in their tooltips. No room is kept for them (owner,
  2026-10-28): the title uses the whole row, and while they show they lie over its end on the
  row's own ground, the title fading out under them over a short stretch; the title never
  moves. They are siblings of the row's button (a click on one never opens
  the job, a double click never its ad), out of the Tab order (the row's menu is there for
  the keyboard), and exist only while they show. After a tool took its row away, the row that
  slides under the pointer shows its tools only once the pointer moves (input.ts `hover`).
  The row's menu (a right click, the app's own) and a double click (the ad in the browser)
  act on the job too. Without a usable profile the ring is empty (a dash). `reveal`: the ring
  fills and counts up as the row mounts (a list that opens). Layout stays inside the row
  (containment); like the row, its hover rests while the list scrolls (`data-still`).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  import { t } from '$lib/i18n/t';
  import type { JobView } from '$lib/ipc/types';

  /** A tool of the row under the pointer: a move of the job's place (actions.ts rowTools). */
  export interface RowTool {
    id: string;
    icon: IconName;
    /** Its name: the tooltip and the accessible name of the icon. */
    label: string;
    disabled: boolean;
    /** Why a disabled tool waits (its tooltip). */
    reason: string | null;
    run: () => void;
  }
</script>

<script lang="ts">
  import { holdHover } from '$lib/input/hold';
  import { contextMenu, hover, type ContextMenu } from '$lib/input/input';
  import { tooltip } from '$lib/actions/tooltip';
  import { displayTitle } from '$lib/i18n/format';
  import { markedParts } from '$lib/marks';
  import { fade } from '$lib/motion/transitions';
  import { isNew } from '$lib/state/filter';
  import { tokenPx } from '$lib/tokens';
  import Button from './Button.svelte';
  import ListRow from './ListRow.svelte';
  import ScoreRing, { ringState } from './ScoreRing.svelte';

  interface Props {
    job: JobView;
    selected?: boolean;
    /** Scoring is still running for this job. */
    pending?: boolean;
    /** A usable profile is there (without one the ring is an empty placeholder: no match). */
    ring?: boolean;
    /** The ring fills and counts up as the row mounts (a list that opens). */
    reveal?: boolean;
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
    reveal = false,
    marks = [],
    onselect = null,
    onopen = null,
    menu = null,
    tools = null,
    testid = null,
  }: Props = $props();

  const excluded = $derived(job.match?.status === 'excluded');
  /** Not opened yet and not excluded: the title in 650 and the hidden "Neu". */
  const fresh = $derived(isNew(job));
  /** In the Papierkorb or closed: the title steps back. */
  const muted = $derived(job.place === 'trash' || job.closed);
  const rowId = $derived(testid ?? `job-row-${job.key.portal}-${job.key.id}`);
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  /** The title with the words of the search marked. */
  const titleParts = $derived(markedParts(heading, marks));

  /** The title, and the row's tools while they show (what the title's end lies under). */
  let titleBox = $state<HTMLElement | null>(null);
  let toolsBox = $state<HTMLElement | null>(null);

  /** The tools lie over the end of the line and the title fades out under them, over the
   *  stretch before them: a title that reaches into it is cut as far as the eye goes, however
   *  well it fits (its tooltip says it whole). */
  function covered(): boolean {
    if (titleBox === null || toolsBox === null) return false;
    const text = document.createRange();
    text.selectNodeContents(titleBox);
    return (
      text.getBoundingClientRect().right >
      toolsBox.getBoundingClientRect().left - tokenPx('--list-tools-fade')
    );
  }

  /** The pointer is on the row (after a tool took a row away: once it moved). */
  let here = $state(false);
  /** The row's menu is open (its tools and its wash stay while the pointer is on the menu). */
  let menuOpen = $state(false);
  const tooled = $derived(tools !== null && (here || menuOpen));

  /** The job's menu, which keeps the row's tools and its wash while it is open. */
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
      {reveal}
    />
  {/if}
{/snippet}

<div
  class="job"
  class:tooled
  class:menued={menuOpen}
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
    <span class="line">
      <span
        class="title"
        class:unread={fresh}
        class:muted
        bind:this={titleBox}
        use:tooltip={{ text: heading, truncated: true, covered }}
        >{#each titleParts as part, index (index)}{#if part.mark}<mark class="hit">{part.text}</mark
            >{:else}{part.text}{/if}{/each}</span
      >{#if fresh}<span class="unseen">{t.job.unread}</span>{/if}
    </span>
  </ListRow>
  {#if tooled && tools}
    <span class="tools" data-testid="row-tools" bind:this={toolsBox} transition:fade>
      {#each tools() as tool (tool.id)}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            iconOnly
            icon={tool.icon}
            label={tool.label}
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

  /* The row's whole line: the title takes all of it. */
  .line {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  /* While the tools show, the line fades out under them (their ground is the row's own:
     its wash, its highlight); while the list scrolls the row rests, the title whole. */
  .tooled:where(:not([data-still])) .line {
    mask-image: var(--list-tools-mask);
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

  .title.unread {
    font-weight: var(--weight-semibold);
  }

  /* In the Papierkorb and closed: muted in the text's weight, whether new or not. */
  .title.muted {
    color: var(--text-muted);
    font-weight: var(--weight-regular);
  }

  /* "Neu", for screen readers only (clipped away, nothing overflows to scroll). */
  .unseen {
    position: absolute;
    width: var(--border-width);
    height: var(--border-width);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* A word of the search: a soft mark under the ink (the title's own colour). */
  .hit {
    border-radius: var(--radius-xs);
    background-color: var(--mark);
    color: inherit;
  }

  /* The tools over the end of the line, centred on the row, their glyph ending on the hairline's
     end. */
  .tools {
    position: absolute;
    top: calc(50% - var(--control-icon) / 2);
    right: var(--list-tools-end);
    display: flex;
    gap: var(--space-2);
  }

  /* Shown while the row is tooled (their group fades in and out, one fade); while the list
     scrolls the row rests: no tools. */
  .tool {
    display: inline-flex;
    opacity: 0;
  }

  .tooled:where(:not([data-still])) .tool {
    opacity: 1;
  }

  /* The row keeps its wash while the pointer is on a tool (a sibling of the row's button), and
     while its menu is open, so the job the menu acts on stays marked. */
  .job:hover:where(:not([data-still])) :global(.row:not(.selected, :active)),
  .menued :global(.row:not(.selected, :active)) {
    background-color: var(--quiet-hover);
  }
</style>
