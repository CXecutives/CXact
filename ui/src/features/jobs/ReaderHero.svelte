<!--
  The head of the job view, its hero card (the round 10 draft): the ring (60) and beside it
  the title (20/650, copyable) with the band under it in the word colour of its ring; at the
  end of the title's first line, centred on it, the quiet tools, the moves of the job's place
  (actions.ts rowTools: the same as its row's), 14 in from the card's edge; no "×" (the top
  bar's job view button closes the job); under the top the job's state box (ReaderState), and
  the buttons that show the job in a row of their own under a hairline (shows.ts).
  - The ring: scored, it fills and counts up each time a job opens (not while the user browses
    fast, ScoreRing and lib/motion/pace.ts); not scored yet a dash with "Noch nicht bewertet";
    not scorable "Nicht bewertbar"; without a profile "Nicht bewertet"; an excluded job the
    red ban on the light red track with "Ausgeschlossen" in the ban red.
  - The buttons, the same commands as the row's menu (shows.ts showActions): Anzeige öffnen,
    Alert-Mail öffnen (only for a job a mail brought), Prompt für KI-Bewertung (only with a
    score and the ad's text); the row wraps. An excluded job and one whose ad is still to come
    show them too, under the button of their state box.
  A job that just moved away keeps its tools off while the next one loads (`inPlace`).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import ScoreRing, { type RingState } from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import type { JobDetail } from '$lib/ipc/types';
  import { keyOf } from '$lib/state/jobRows';
  import type { rowTools } from './actions';
  import ReaderState from './ReaderState.svelte';
  import { SHOWS, showActions, type ShowId } from './shows';

  interface Props {
    detail: JobDetail;
    /** The title without gender tags. */
    heading: string;
    ring: RingState;
    /** A usable profile: without one no job is scored. */
    withRing: boolean;
    excluded: boolean;
    /** Why the engine excludes the job (null: it does not). */
    exclusion: string | null;
    includable: boolean;
    including: boolean;
    oninclude: (event: MouseEvent) => void;
    /** The moves of the job's place. */
    tools: ReturnType<typeof rowTools>;
    /** The job still lies in the list's place (its moves are its place's). */
    inPlace: boolean;
    /** What each button that shows the job does. */
    onshow: (id: ShowId) => void;
    /** The row of those buttons (the focus goes to its first one after "Trotzdem bewerten"). */
    actions?: HTMLElement | null;
  }

  let {
    detail,
    heading,
    ring,
    withRing,
    excluded,
    exclusion,
    includable,
    including,
    oninclude,
    tools,
    inPlace,
    onshow,
    actions = $bindable(null),
  }: Props = $props();

  const job = $derived(detail.job);
  /** The ring the hero shows: without a profile the dash of a ring that is off. */
  const shown = $derived<RingState>(withRing ? ring : { status: 'off' });
  /** The band under the title and its colour. */
  const band = $derived.by((): { words: string; tone: string } => {
    if (excluded) return { words: t.score.excluded, tone: 'ban' };
    switch (shown.status) {
      case 'scored':
        return {
          words: t.score.band[shown.band],
          tone: `d${Math.min(9, Math.floor(Math.max(0, shown.score) / 10))}`,
        };
      case 'unscorable':
        return { words: t.reader.unscorable, tone: 'quiet' };
      case 'off':
        return { words: t.score.none, tone: 'quiet' };
      default:
        return { words: t.reader.unscored, tone: 'quiet' };
    }
  });
  /** The buttons that show the job, in their one order: what its menu offers. */
  const offered = $derived.by(() => {
    const shows = showActions(job);
    return SHOWS.map((id) => shows[id]).filter((show) => !show.hidden);
  });
  /** The test id of each button that shows the job. */
  const SHOW_TESTIDS: Record<ShowId, string> = {
    'open-ad': 'open-ad',
    mail: 'reader-mail',
    prompt: 'reader-prompt',
  };
</script>

<Card hero testid="reader-head">
  <div class="body">
    <div class="top" data-testid="reader-match">
      {#if excluded}
        <ScoreRing ring={shown} size="md" ban testid="reader-ban" />
      {:else}
        <ScoreRing ring={shown} size="md" animate={keyOf(job.key)} testid="reader-ring" />
      {/if}
      <div class="heads">
        <div class="line">
          <span class="tools" data-press-only data-testid="reader-tools">
            {#each tools as tool (tool.id)}
              <Button
                variant="ghost"
                iconOnly
                icon={tool.icon}
                label={tool.label}
                disabled={tool.disabled || !inPlace}
                disabledReason={tool.reason}
                testid="reader-{tool.id}"
                onclick={tool.run}
              />
            {/each}
          </span>
          <h1 class="title" data-copy data-testid="reader-title">{heading}</h1>
        </div>
        <p class="band {band.tone}" data-testid="band">{band.words}</p>
      </div>
    </div>
    <ReaderState {detail} {exclusion} {includable} {including} {oninclude} />
    <!-- Words, glyphs, what is off and what is not there come from the one table the row's
         menu reads too. -->
    {#if offered.length > 0}
      <div class="actions" data-press-only bind:this={actions} data-testid="reader-actions">
        {#each offered as show (show.id)}
          <Button
            variant="secondary"
            icon={show.icon}
            label={show.label}
            disabled={show.reason !== null}
            disabledReason={show.reason}
            testid={SHOW_TESTIDS[show.id]}
            onclick={() => onshow(show.id)}
          />
        {/each}
      </div>
    {/if}
  </div>
</Card>

<style>
  /* The top, the state box and the button row, 14 apart. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--hero-gap);
  }

  /* The ring beside the title and its band. */
  .top {
    display: flex;
    align-items: center;
    gap: var(--hero-gap);
  }

  .heads {
    flex: 1;
    min-width: 0;
  }

  /* The title and, at the end of its first line, the tools: they float, so they shorten only
     that line and the lines below keep the whole width. */
  .line {
    display: block;
  }

  /* Centred on the title's first line without making it taller, on a whole pixel; their glyphs
     end on the content's edge (the buttons 14 in from the card's). */
  .tools {
    display: flex;
    float: right;
    gap: var(--space-2);
    margin-block: round(
      down,
      calc((var(--leading-xl) - var(--control-icon)) / 2),
      var(--border-width)
    );
    margin-inline-end: calc(var(--card-tools-inset) - var(--card-pad-x));
    margin-inline-start: var(--space-8);
  }

  /* A drag along the title goes on over them to the line's end: like their buttons (base.css)
     their box gives the pointer through to the title under it. */
  :global(:root[data-text-drag]) .tools {
    pointer-events: none;
  }

  .title {
    color: var(--text-heading);
    font: var(--type-xl);
    letter-spacing: var(--tracking-tight);
    overflow-wrap: break-word;
  }

  .band {
    margin-top: var(--hero-band-gap);
    font: var(--type-field-label);
  }

  .band.quiet {
    color: var(--text-subtle);
  }

  .band.ban {
    color: var(--ban);
  }

  /* The band in the word colour of its ring's step (a step darker than the ring for the
     yellows and greens, decision 4). */
  .band.d0 {
    color: var(--score-text-0);
  }

  .band.d1 {
    color: var(--score-text-1);
  }

  .band.d2 {
    color: var(--score-text-2);
  }

  .band.d3 {
    color: var(--score-text-3);
  }

  .band.d4 {
    color: var(--score-text-4);
  }

  .band.d5 {
    color: var(--score-text-5);
  }

  .band.d6 {
    color: var(--score-text-6);
  }

  .band.d7 {
    color: var(--score-text-7);
  }

  .band.d8 {
    color: var(--score-text-8);
  }

  .band.d9 {
    color: var(--score-text-9);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    padding-top: var(--hero-gap);
    border-top: var(--border-width) solid var(--border);
  }
</style>
