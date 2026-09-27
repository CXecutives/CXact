<!--
  One job in the list, mail-style with fixed gutters: the unread dot (6 px, coral) centred
  in the pane padding on the axis of the ring (so a title never moves when the job is read),
  the ring, then two lines (user decision 2026-09-27: the row says what, where and for how
  much, the reader everything else):
  1. the title on one line (every row one height; a cut title shows in full in a tooltip; an
     unread title is drawn heavier without getting wider, so reading a job never moves it)
     and at the end of the line its stamp like a mail list (the time today, "Gestern",
     "Vorgestern", then "Mi 23.09."; in the Papierkorb the day the job went there). An ad
     that no longer takes applications says "Beendet" there, its title muted (the order by
     match puts it after the open ones).
  2. a building and the company, a map pin and the place (without the work mode a portal
     appends to it, lib/place.ts), and when the ad states it the euro and the day rate or
     the salary in the reader's money form ("1.250 €/Tag", "95.000 €/Jahr"); the company and
     the place are cut at the line's end, the pay never.
  No portal, no facts, no badges: the reader has them. Under the pointer (and while the
  row's menu is open) the row's tools, the moves of its place (actions.ts rowTools:
  Archivieren and Löschen, Dearchivieren and Löschen, Wiederherstellen and Endgültig
  löschen), fade in as icons over the date, which fades out: they stand in a fixed slot at
  the end of the title line that is always as wide as they are, so nothing moves and the
  title keeps its room. Each names itself in its tooltip; the ones that delete are red.
  They are siblings of the row's button (a click on one never opens the job), out of the Tab
  order (the row's menu is there for the keyboard), and exist only while they show. After a
  tool took its row away, the row that slides under the pointer shows its tools only once
  the pointer moves (input.ts `hover`). The row's menu (a right click, the app's own) and a
  double click (the ad in the browser) act on the job too. The ring
  stays hollow on the open row (its track is never tinted); without a usable profile it is
  empty (a dash). An excluded job shows the ban in the ring's place, and the whole row is
  muted. When a job is read while its row is on screen the dot shrinks away; only the
  inbox has dots, an excluded row none. Stamps follow the page's clock (they move on while
  the app stays open). Layout stays inside the row (containment); like the row, its
  hover rests while the list scrolls (`data-still`, see ListRow).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  import { termIcon } from '$lib/facts';
  import { t } from '$lib/i18n/t';
  import type { JobView } from '$lib/ipc/types';

  /** The pay the ad states, in the reader's money form ("1.250 €/Tag", "95.000 €/Jahr"):
   *  employment (a permanent job, temporary agency work) its salary, any other job its day
   *  or hour rate; null when the ad names none. */
  function payOf(job: JobView): string | null {
    const facts = job.match?.facts ?? null;
    if (facts === null) return null;
    if (facts.contract === 'permanent' || facts.contract === 'anue') {
      return facts.salary === undefined
        ? null
        : t.facts.pay(facts.salary, 'year', null, facts.salaryLowerBound === true);
    }
    if (facts.rate === null) return null;
    return t.facts.pay(facts.rate, facts.hourly === true ? 'hour' : 'day', facts.currency);
  }

  /** The icon of the pay: the euro, pay in another currency its banknote (lib/facts.ts). */
  const payIcon = (job: JobView): IconName => termIcon('rate', job);

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
  import { contextMenu, doubleClick, holdHover, hover, type ContextMenu } from '$lib/input/input';
  import { tooltip } from '$lib/actions/tooltip';
  import { displayTitle, formatStamp } from '$lib/i18n/format';
  import { dotOut, fade } from '$lib/motion/transitions';
  import { placeOf } from '$lib/place';
  import { clock } from '$lib/state/clock.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import ListRow from './ListRow.svelte';
  import ScoreRing, { ringState } from './ScoreRing.svelte';

  interface Props {
    job: JobView;
    selected?: boolean;
    /** A selected row draws its own bar (false: the list's one sliding bar marks it). */
    bar?: boolean;
    /** Scoring is still running for this job. */
    pending?: boolean;
    /** A usable profile is there (without one the ring is an empty placeholder: no match). */
    ring?: boolean;
    /** Fixed "now" for the stamp (gallery and tests). */
    now?: Date;
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
    bar = true,
    pending = false,
    ring = true,
    now,
    onselect = null,
    onopen = null,
    menu = null,
    tools = null,
    testid = null,
  }: Props = $props();

  const excluded = $derived(job.match?.status === 'excluded');
  /** In the Papierkorb the moment the job went there (the date the trash sorts by). */
  const when = $derived(
    (job.place === 'trash' ? job.trashedAt : null) ?? job.mailDate ?? job.firstSeenAt,
  );
  const current = $derived(now ?? clock.now);
  const rowId = $derived(testid ?? `job-row-${job.key.portal}-${job.key.id}`);
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  const place = $derived(placeOf(job.location));
  const pay = $derived(payOf(job));
  /** The end of the title line: "Beendet" for an ad that takes no applications, else the
   *  stamp. */
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
    <span class="ban" role="img" aria-label={t.score.excluded} data-testid="row-excluded"
      ><Icon name="excluded" size="md" /></span
    >
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
  use:doubleClick={onopen ? () => onopen?.(job) : null}
>
  <ListRow
    {leading}
    {selected}
    {bar}
    muted={excluded}
    onclick={onselect ? () => onselect?.(job) : null}
    testid={rowId}
  >
    <span class="head">
      <span
        class="title"
        class:unread={job.unread}
        class:closed={job.closed}
        use:tooltip={{ text: heading, truncated: true }}>{heading}</span
      >
      <span class="date" data-testid="row-date"><span class="stamp">{stamp}</span></span>
    </span>
    <span class="meta">
      {#if job.company}<span class="part company" data-testid="row-company"
          ><Icon name="company" size="sm" /><span class="text">{job.company}</span></span
        >{/if}
      {#if place}<span class="part place" data-testid="row-place"
          ><Icon name="place" size="sm" /><span class="text">{place}</span></span
        >{/if}
      {#if pay}<span class="part pay" data-testid="row-pay"
          ><Icon name={payIcon(job)} size="sm" /><span class="text">{pay}</span></span
        >{/if}
    </span>
  </ListRow>
  {#if job.unread && !excluded && job.place === 'inbox'}<span
      class="dot"
      role="img"
      aria-label={t.job.unread}
      out:dotOut
    ></span>{/if}
  {#if tooled && tools}
    <span class="tools" data-testid="row-tools" transition:fade>
      {#each tools() as tool (tool.id)}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            size="sm"
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

  /* The unread dot: centred in the pane padding, on the axis of the ring. */
  .dot {
    position: absolute;
    top: calc(var(--space-12) + (var(--ring-sm) - var(--dot-unread)) / 2);
    left: calc((var(--pane-padding) - var(--dot-unread)) / 2);
    width: var(--dot-unread);
    height: var(--dot-unread);
    border-radius: var(--radius-full);
    background-color: var(--unread);
    pointer-events: none;
  }

  /* The ban of an excluded job takes the ring's place, as large and as quiet as its track. */
  .ban {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ring-sm);
    height: var(--ring-sm);
    color: var(--text-subtle);
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

  /* An ad that takes no applications any more: its title steps back. */
  .title.closed {
    color: var(--text-muted);
  }

  /* The stamp at the end of the title line, in the tools' slot (as wide as the two tools at
     least, so the title's room never changes); it steps up from subtle to muted on hover and
     fades out while the tools show. */
  .date {
    flex: none;
    min-width: calc(2 * var(--control-sm) + var(--space-2) + var(--space-6));
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

  /* Company and place: one line, each with its icon, cut at the line's end. */
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-width: 0;
    height: var(--leading-sm);
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .part {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .part.company {
    flex-shrink: 2;
  }

  /* The pay is short and never cut. */
  .part.pay {
    flex: none;
  }

  .part :global(.icon) {
    color: var(--text-subtle);
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
    top: calc(var(--space-12) + (var(--leading-title) - var(--control-sm)) / 2);
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

  /* An excluded row is muted as a whole, its tools too (as bright as the row under the
     pointer). */
  .excluded.tooled:where(:not([data-still])) .tool {
    opacity: var(--opacity-muted-hover);
  }

  /* On the washed row a tool's own hover is one step deeper (the red of one that deletes
     stays its own). */
  .tool :global(.btn.ghost:not(.deletes)) {
    --btn-bg-hover: var(--quiet-press);
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
