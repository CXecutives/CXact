<!--
  One job in the list, mail-style with fixed gutters: the unread dot (6 px, coral) centred
  in the pane padding on the axis of the ring (so a title never moves when the job is read),
  the ring, then two lines (user decision 2026-09-27: the row says what and where, the
  reader everything else):
  1. the title on one line (every row one height; a cut title shows in full in a tooltip; an
     unread title is drawn heavier without getting wider, so reading a job never moves it),
     right after it the portal's small tile ("in", "fd", "fm"; "+1" when another portal
     announced the job too; its tooltip names the portals), and the relative date at the
     end of the line (in the Papierkorb the day the job went there);
  2. a building and the company, a map pin and the place (without the work mode a portal
     appends to it, lib/place.ts), cut at the line's end.
  No facts, no badges, no tools on hover: the reader has them, and the row's menu (a right
  click, the app's own) and a double click (the ad in the browser) act on the job. The ring
  stays hollow on the open row (its track is never tinted); without a usable profile it is
  empty (a dash). An excluded job shows the ban in the ring's place, and the whole row is
  muted. When a job is read while its row is on screen the dot shrinks away; only the
  inbox has dots, an excluded row none. Relative dates follow the page's clock (they move on
  while the app stays open). Layout stays inside the row (containment); like the row, its
  hover rests while the list scrolls (`data-still`, see ListRow).
-->
<script lang="ts">
  import { contextMenu, doubleClick, type ContextMenu } from '$lib/input/input';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { displayTitle, formatRelative } from '$lib/i18n/format';
  import type { JobView } from '$lib/ipc/types';
  import { dotOut } from '$lib/motion/transitions';
  import { PORTAL_MONOGRAM } from '$lib/ipc/types/portals';
  import { placeOf } from '$lib/place';
  import { clock } from '$lib/state/clock.svelte';
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
    /** Fixed "now" for relative dates (gallery and tests). */
    now?: Date;
    /** A click on the row. */
    onselect?: ((job: JobView) => void) | null;
    /** A double click on the row: the ad opens in the browser. */
    onopen?: ((job: JobView) => void) | null;
    /** The job's menu on a right click (null: none). */
    menu?: (() => ContextMenu | null) | null;
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
  /** The portals that announced this job, its own first. */
  const portals = $derived([job.portal, ...job.alsoOn.filter((portal) => portal !== job.portal)]);
  const portalNames = $derived(portals.map((portal) => t.portal[portal]).join(', '));
  const place = $derived(placeOf(job.location));
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
  data-rests=""
  use:contextMenu={menu}
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
      <span class="title" class:unread={job.unread} use:tooltip={{ text: heading, truncated: true }}
        >{heading}</span
      >
      <span class="portal" role="img" aria-label={portalNames} use:tooltip={portalNames}
        >{PORTAL_MONOGRAM[job.portal]}{#if portals.length > 1}<span class="also"
            >+{portals.length - 1}</span
          >{/if}</span
      >
      <span class="date"><span class="stamp">{formatRelative(when, current, true)}</span></span>
    </span>
    <span class="meta">
      {#if job.company}<span class="part company" data-testid="row-company"
          ><Icon name="company" size="sm" /><span class="text">{job.company}</span></span
        >{/if}
      {#if place}<span class="part place" data-testid="row-place"
          ><Icon name="place" size="sm" /><span class="text">{place}</span></span
        >{/if}
    </span>
  </ListRow>
  {#if job.unread && !excluded && job.place === 'inbox'}<span
      class="dot"
      role="img"
      aria-label={t.job.unread}
      out:dotOut
    ></span>{/if}
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

  /* The title line: the title, the portal's tile right after it, the date at the end. */
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

  /* The portal's small tile right after the title. */
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

  /* The relative date at the end of the title line; it steps up from subtle to muted on
     hover. */
  .date {
    flex: none;
    margin-left: auto;
    padding-left: var(--space-6);
    color: var(--text-subtle);
    white-space: nowrap;
    transition: color var(--dur-base) var(--ease-standard);
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

  .part :global(.icon) {
    color: var(--text-subtle);
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
