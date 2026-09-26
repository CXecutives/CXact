<!--
  One job in the list, mail-style with fixed gutters: the unread dot (6 px, coral) centred
  in the pane padding on the axis of the ring (so a title never moves when the job is
  read), the ring, then three lines that use the full width (the approved row, user
  2026-09-26):
  1. the title on one line (every row one height; a cut title shows in full in a tooltip; an
     unread title is drawn heavier without getting wider, so reading a job never moves it),
     and at its end, together, the star of a favourite, the portal's small tile ("+1" when
     another portal announced the job too, named in its tooltip) and the relative date on the
     title's baseline (in the Papierkorb how long it has left before the trash empties
     itself, "noch 29 Tage", or without that the day the job went there);
  2. company and place as one line read left to right and cut at its end;
  3. the ad's facts from the facts table (lib/facts.ts, its order and its icons): each an icon
     and its value, the pay in ink, as many as fit whole (measured, lib/actions/fit.ts; a fact
     that does not fit steps out, none is ever cut, and the line's tooltip then lists them
     all). An ad that names nothing still shows its contract and work mode where known, and a
     row without any fact keeps its one height. A badge follows the facts only when something
     deviates or the user counted an excluded job anyway ("Einbezogen"); an excluded row says
     why instead, with the ban icon (its ring is grey, without a mark).
  Without a usable profile the ring stays, empty (a dash), and the row keeps its facts.
  Like Mail and Gmail, the row's tools sit over the end of the title line: on hover (or when
  a tool has the keyboard focus) star and date fade out and the tools (archive or bring back,
  delete, the star) fade in (100 ms); the portal's tile stays, just before them, so its tooltip
  (the other portals of a "+1") can be reached; the title line keeps their room free. A pinned job
  shows its star there (not in the Papierkorb, where no job is a favourite). The list is one
  Tab stop (the row the list names with `tabbable`; the arrows move in it): the tools are
  for the pointer and stay out of the Tab order, the reader offers the same actions.
  The tools are siblings of the row button, so they never select the row;
  the row keeps its hover while the pointer is on them. They exist only while the pointer
  is on the row or the focus is in it (and for their fade-out after that): three buttons on
  every row of a long list were half of its elements, most of the work of a new row and of
  every hit test. The tools take no room while hidden: on hover the title line ends before
  them. An excluded row is muted as a whole, its dot and tools too. When a job is read
  while its row is on screen the dot shrinks away; only the inbox has dots, an excluded row
  none. Relative dates follow the page's clock (they move on while the app stays open). A
  right click opens the job's menu (`menu`, the app's own). Over the ring a round checkbox
  shows on hover (and stays, ticked, while the row is among several chosen): a click takes
  the row in or out of the choice like Ctrl+click (`onchoose`), so choosing several jobs is
  found without a key, also in one column. A score from a
  teaser rings like any other (its badge says that only a teaser was read). Layout stays
  inside the row (containment); like the row, its hover rests while the list scrolls
  (`data-still`, see ListRow).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';
  /** How a click on a row selects: alone, toggled into a selection, or as a range. */
  export interface SelectHow {
    toggle: boolean;
    range: boolean;
  }

  /** A tool of the row (the job's actions where it is: archive, delete, restore ...). */
  export interface RowTool {
    id: string;
    icon: IconName;
    label: string;
    /** Locked for now (a run holds the jobs), saying why. */
    disabled?: boolean;
    disabledReason?: string | null;
    onclick: () => void;
  }
</script>

<script lang="ts">
  import { fit } from '$lib/actions/fit';
  import { presence } from '$lib/actions/presence';
  import { contextMenu, type ContextMenu } from '$lib/input/input';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { displayTitle, formatRelative } from '$lib/i18n/format';
  import { rowFacts } from '$lib/facts';
  import { DETAIL_WARNS, noteText, rowReason } from '$lib/i18n/texts';
  import type { JobView } from '$lib/ipc/types';
  import { duration } from '$lib/motion/motion';
  import { dotOut, toolsIn } from '$lib/motion/transitions';
  import { keyConventions } from '$lib/platform';
  import { clock } from '$lib/state/clock.svelte';
  import Badge, { type BadgeTone } from './Badge.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import ListRow from './ListRow.svelte';
  import { PORTAL_MONOGRAM } from './IconTile.svelte';
  import ReasonItem from './ReasonItem.svelte';
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
    /** Fixed "now" for relative dates (gallery and tests). */
    now?: Date;
    /** Days after which the Papierkorb empties itself (0: never): a row there says how long
     *  it has left instead of its date. */
    trashDays?: number;
    /** A click on the row; `how` says whether it toggles the job in a selection
     *  (Ctrl on Windows, Cmd on macOS) or selects the range up to it (Shift). */
    onselect?: ((job: JobView, how: SelectHow) => void) | null;
    /** Pin or unpin from the row; without it a pinned job only shows the star. */
    onpin?: ((job: JobView) => void) | null;
    /** Archive (or bring back an archived job) from the row. */
    onarchive?: ((job: JobView) => void) | null;
    /** The job's actions where it is, in their one order, before the star (in place of
     *  `onarchive`). */
    tools?: readonly RowTool[];
    /** The job's menu on a right click (null: none). */
    menu?: (() => ContextMenu | null) | null;
    /** The row is among several chosen (its checkbox shows, ticked). */
    chosen?: boolean;
    /** The checkbox over the ring takes the row in or out of the choice (null: none). */
    onchoose?: ((job: JobView) => void) | null;
    /** The row's test id (another list of the same jobs needs its own). */
    testid?: string | null;
    /** The list's one Tab stop is this row (the others are reached with the arrows). */
    tabbable?: boolean;
  }

  let {
    job,
    selected = false,
    bar = true,
    pending = false,
    ring = true,
    now,
    trashDays = 0,
    onselect = null,
    onpin = null,
    onarchive = null,
    tools = [],
    menu = null,
    chosen = false,
    onchoose = null,
    testid = null,
    tabbable = true,
  }: Props = $props();

  /** How a click selects, by the modifiers of the OS (like a mail app). */
  function how(event: MouseEvent): SelectHow {
    return { toggle: event[keyConventions().command], range: event.shiftKey };
  }

  const excluded = $derived(job.match?.status === 'excluded');
  /** In the Papierkorb the moment the job went there (the date the trash sorts by). */
  const trashed = $derived(job.place === 'trash' ? job.trashedAt : null);
  const when = $derived(trashed ?? job.mailDate ?? job.firstSeenAt);
  const current = $derived(now ?? clock.now);
  /** In the Papierkorb: how long until it empties itself (counted from the day the job went
   *  there, like the reader's line; null without an emptying or a date). */
  const DAY_MS = 86_400_000;
  const trashLeft = $derived.by((): string | null => {
    if (trashed === null || trashDays <= 0) return null;
    const since = Math.max(0, Math.floor((current.getTime() - Date.parse(trashed)) / DAY_MS));
    const left = trashDays - since;
    return left > 0 ? t.job.trashLeft(left) : t.job.trashSoon;
  });
  const rowId = $derived(testid ?? `job-row-${job.key.portal}-${job.key.id}`);
  /** How many tools the row has on hover (their room stays free on the title line). */
  const toolCount = $derived(tools.length + (onpin ? 1 : 0) + (onarchive ? 1 : 0));

  /** The tools exist while the pointer is on the row or the focus is in it, and for their
   *  fade-out (--dur-fast) after both have left. */
  let tooled = $state(false);
  let drop: ReturnType<typeof setTimeout> | undefined;

  function hold(here: boolean): void {
    clearTimeout(drop);
    drop = undefined;
    if (here) tooled = true;
    else if (tooled) drop = setTimeout(() => (tooled = false), duration('fast'));
  }

  /** A tool is for the pointer: out of the Tab order (the list is one Tab stop). */
  function untabbed(node: HTMLElement): void {
    for (const button of node.querySelectorAll('button')) button.tabIndex = -1;
  }

  // The ad's own facts: also without a profile (they come from the ad, not the match). An
  // excluded row says why instead, in short words.
  const reason = $derived(excluded ? rowReason(job) : null);
  const facts = $derived(reason ? [] : rowFacts(job));
  /** All facts in one line: the tooltip of the line while some stepped out. */
  const allFacts = $derived(facts.map((fact) => fact.text).join(' · '));
  /** How many facts stepped out (they did not fit whole). */
  let hidden = $state(0);
  /** The other portals that announced this job too. */
  const also = $derived(job.alsoOn.filter((portal) => portal !== job.portal));
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);

  /** At most one badge, and only when something is not as usual. */
  const deviation = $derived.by(
    (): { label: string; tone: BadgeTone; hint: string | null } | null => {
      // Excluded rows speak through the ring, the grey and the divider.
      if (excluded) return null;
      if (job.overridden) return { label: t.job.included, tone: 'neutral', hint: null };
      const detail = job.detail.kind;
      // While a run brings the details, "Details folgen" is no deviation.
      if (detail === 'pending' && pending) return null;
      if (detail !== 'ok') {
        const tone: BadgeTone = DETAIL_WARNS[detail] ? 'warning' : 'neutral';
        return { label: t.job.detail[detail], tone, hint: t.job.detailHint[detail] };
      }
      if (job.closed) return { label: t.job.closed, tone: 'neutral', hint: t.job.closedHint };
      if (job.match?.status === 'unscorable') {
        const hint = noteText(job.match.note) ?? t.reader.noReasons;
        return { label: t.score.unscorable, tone: 'neutral', hint };
      }
      return null;
    },
  );
</script>

{#snippet ringCell()}
  <ScoreRing
    ring={ring ? ringState(job.match, pending, job.detail.kind) : { status: 'off' }}
    size="sm"
  />
{/snippet}

<div
  class="job"
  class:tooled={tooled && toolCount > 0}
  class:muted={excluded}
  class:bare={!(facts.length > 0 || reason || deviation)}
  data-rests=""
  use:presence={hold}
  use:contextMenu={menu}
>
  <ListRow
    leading={ring ? ringCell : null}
    {selected}
    {bar}
    muted={excluded}
    {tabbable}
    onclick={onselect ? (event) => onselect?.(job, how(event)) : null}
    testid={rowId}
  >
    <span class="head">
      <span class="title" class:unread={job.unread} use:tooltip={{ text: heading, truncated: true }}
        >{heading}</span
      >
      <span
        class="end"
        class:one={toolCount === 1}
        class:two={toolCount === 2}
        class:three={toolCount >= 3}
      >
        {#if job.pinned && job.place !== 'trash'}<span
            class="mark"
            role="img"
            aria-label={t.job.pinned}><Icon name="star" size="sm" filled /></span
          >{/if}
        <span
          class="portal"
          role="img"
          aria-label={t.portal[job.portal]}
          use:tooltip={also.length > 0
            ? `${t.portal[job.portal]} · ${t.job.alsoOn(also.map((p) => t.portal[p]).join(', '))}`
            : t.portal[job.portal]}
          >{PORTAL_MONOGRAM[job.portal]}{#if also.length > 0}<span class="also">+{also.length}</span
            >{/if}</span
        >
        <span class="date"
          ><span class="stamp" data-testid={trashLeft ? 'trash-left' : undefined}
            >{trashLeft ?? formatRelative(when, current, true)}</span
          ></span
        >
      </span>
    </span>
    <span class="meta">
      <!-- No space between the parts: the middle dot brings its own room on both sides. -->
      <span class="parts"
        >{#if job.company}<span class="text company">{job.company}</span
          >{/if}{#if job.location}<span class="text place">{job.location}</span>{/if}</span
      >
    </span>
    {#if facts.length > 0 || reason || deviation}<span class="foot">
        {#if reason}
          <span class="reason"><ReasonItem kind={reason.kind} label={reason.text} compact /></span>
        {:else if facts.length > 0}
          <span
            class="facts"
            data-testid="row-facts"
            use:fit={{
              key: `${allFacts}|${deviation?.label ?? ''}`,
              onfit: (out) => (hidden = out),
            }}
            use:tooltip={hidden > 0 ? allFacts : null}
            >{#each facts as fact (fact.key)}<span
                class="fact"
                class:ink={fact.ink}
                data-fact={fact.key}><Icon name={fact.icon} size="sm" />{fact.text}</span
              >{/each}</span
          >
        {/if}
        {#if deviation}<Badge
            label={deviation.label}
            tone={deviation.tone}
            hint={deviation.hint}
          />{/if}
      </span>{/if}
  </ListRow>
  {#if onchoose && ring}
    <button
      type="button"
      class="check"
      class:on={chosen}
      role="checkbox"
      aria-checked={chosen}
      aria-label={t.job.choose}
      tabindex="-1"
      data-testid="check-{job.key.portal}-{job.key.id}"
      onclick={() => onchoose?.(job)}
    >
      <span class="box"><Icon name="check" size="xs" /></span>
    </button>
  {/if}
  {#if job.unread && !excluded && job.place === 'inbox'}<span
      class="dot"
      role="img"
      aria-label={t.job.unread}
      out:dotOut
    ></span>{/if}
  {#if tooled && toolCount > 0}
    <span class="tools" in:toolsIn>
      {#each tools as tool (tool.id)}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={tool.icon}
            label={tool.label}
            disabled={tool.disabled ?? false}
            disabledReason={tool.disabledReason ?? null}
            testid="{tool.id}-{job.key.portal}-{job.key.id}"
            onclick={tool.onclick}
          />
        </span>
      {/each}
      {#if onarchive}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={job.place === 'archive' ? 'archive-restore' : 'archive'}
            label={job.place === 'archive' ? t.reader.restore : t.reader.archive}
            testid="archive-{job.key.portal}-{job.key.id}"
            onclick={() => onarchive?.(job)}
          />
        </span>
      {/if}
      {#if onpin}
        <span class="tool" use:untabbed>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="star"
            label={job.pinned ? t.reader.unpin : t.reader.pin}
            pressed={job.pinned}
            testid="pin-{job.key.portal}-{job.key.id}"
            onclick={() => onpin?.(job)}
          />
        </span>
      {/if}
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

  /* The row keeps its hover while the pointer is on its star (a sibling of the row). */
  .job:hover:where(:not([data-still])) :global(.row:not(.selected, :active)) {
    background-color: var(--surface-hover);
  }

  .job:hover:where(:not([data-still])) :global(.row.selected:not(:active)) {
    background-color: var(--surface-selected-hover);
  }

  /* The checkbox over the ring: unseen until the pointer is on it or the row is among several
     chosen; the ring gives it its place meanwhile. */
  .check {
    position: absolute;
    top: var(--space-12);
    left: var(--pane-padding);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ring-sm);
    height: var(--ring-sm);
    border-radius: var(--radius-full);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .check:hover,
  .check.on {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  .job:has(.check:is(:hover, .on)) :global(.leading) {
    opacity: 0;
  }

  .box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--row-check);
    height: var(--row-check);
    border: var(--row-check-border) solid var(--border-strong);
    border-radius: var(--radius-full);
    background-color: var(--surface);
    color: transparent;
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard);
  }

  .check:hover .box {
    border-color: var(--border-input);
  }

  .on .box,
  .on:hover .box {
    border-color: var(--toggle-on);
    background-color: var(--toggle-on);
    color: var(--text-on-accent);
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

  /* The title line: the title, and at the end of its first line the date (with a pinned
     star before it), in a room as wide as the tools that replace it on hover. */
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    min-width: 0;
  }

  /* One line for every title, so every row has one height (user, 2026-09-25): a long title
     ends in an ellipsis and shows in full in a tooltip. */
  .title {
    flex: 1;
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

  /* Company and place: one line, cut at its end like the title. */
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The portal's small tile at the end of the title line, between the star and the date. */
  .portal {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-2);
    height: var(--portal-tile);
    padding: 0 var(--space-4);
    border-radius: var(--radius-xs);
    background-color: var(--surface-track);
    color: var(--text-muted);
    font: var(--type-2xs);
    font-weight: var(--weight-semibold);
  }

  .also {
    color: var(--text-subtle);
  }

  .parts {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Parts joined by a middle dot. */
  .parts > * + *::before {
    padding: 0 var(--space-6);
    color: var(--text-subtle);
    content: '·';
  }

  .end {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-6);
    height: var(--leading-title);
  }

  /* The tools take the place of the star and the date only while they show: the tile stays
     just before them (its tooltip names the other portals) and the title ends before it. */
  .tooled:hover:where(:not([data-still])) .end.one,
  .tooled:has(.tool :global(:focus-visible)) .end.one {
    padding-inline-end: calc(var(--control-sm) + var(--space-6));
  }

  .tooled:hover:where(:not([data-still])) .end.two,
  .tooled:has(.tool :global(:focus-visible)) .end.two {
    padding-inline-end: calc(2 * var(--control-sm) + var(--space-2) + var(--space-6));
  }

  .tooled:hover:where(:not([data-still])) .end.three,
  .tooled:has(.tool :global(:focus-visible)) .end.three {
    padding-inline-end: calc(3 * var(--control-sm) + 2 * var(--space-2) + var(--space-6));
  }

  /* A pinned job: a small star before the portal's tile and the date. */
  .mark {
    display: inline-flex;
    align-items: center;
    color: var(--pressed);
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  /* The relative date at the end of the title line; it steps up from subtle to muted on
     hover. Its line has the title's type, so the small stamp stands on the baseline of the
     title's first line (and an old date's tint is as high as that line). */
  .date {
    color: var(--text-subtle);
    font: var(--type-title);
    white-space: nowrap;
    transition:
      color var(--dur-base) var(--ease-standard),
      opacity var(--dur-fast) var(--ease-standard);
  }

  .stamp {
    font: var(--type-xs);
    font-variant-numeric: var(--numeric);
  }

  .job:hover:where(:not([data-still])) .date {
    color: var(--text-muted);
    transition-duration: var(--dur-hover);
  }

  /* One line of 20 px for every row: the facts or the reason, the badge right after them. */
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    height: var(--leading-title);
  }

  /* The ad's facts in the order of the facts table, each its icon and its value, the pay in
     ink. Only whole facts: the fit action lets a fact that does not fit step out (out of
     the flow, unseen), so no value is ever cut and the badge follows the last fact shown. */
  .facts {
    position: relative;
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-12);
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .fact {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
  }

  .fact :global(.icon) {
    color: var(--text-subtle);
  }

  .fact.ink {
    color: var(--text);
  }

  .facts :global(.fact[data-out]) {
    position: absolute;
    visibility: hidden;
  }

  .reason {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
  }

  /* The tools over the date, centred on the title line: they fade in on hover (100 ms)
     while the date fades out. */
  .tools {
    position: absolute;
    top: calc(var(--space-12) + (var(--leading-title) - var(--control-sm)) / 2);
    right: var(--pane-padding);
    display: flex;
    gap: var(--space-2);
  }

  .tool {
    display: inline-flex;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  /* On the washed row a tool's own hover is one step deeper. */
  .tool :global(.btn.ghost) {
    --btn-bg-hover: var(--surface-press);
  }

  .job:hover:where(:not([data-still])) .tool,
  .job:has(.tool :global(:focus-visible)) .tool {
    opacity: 1;
  }

  .muted:hover:where(:not([data-still])) .tool,
  .muted:has(.tool :global(:focus-visible)) .tool {
    opacity: var(--opacity-muted);
  }

  /* Every row has one height, also one without a third line (no profile, no badge). */
  .bare :global(.row) {
    min-height: var(--row-height);
  }

  /* Star and date leave the line under the tools and fade out there (the tile keeps its
     place before the tools). */
  .tooled:hover:where(:not([data-still])) :is(.mark, .date),
  .tooled:has(.tool :global(:focus-visible)) :is(.mark, .date) {
    position: absolute;
    inset-block: 0;
    right: 0;
    opacity: 0;
    transition-duration: var(--dur-fast);
  }
</style>
