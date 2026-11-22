<!--
  The job view (the round 10 draft): on the page's warm ground, 8 under the top bar and 28 in
  from the sides, a column of cards at most 760 wide, centred, 12 apart. Its cards and their
  order are data (reader-sections.ts READER_CARDS); each is rendered below by its key, and
  nothing stands in two of them:
  - hero (ReaderHero): the ring, the title and the band, the moves, the state box, the
    buttons that show the job;
  - details (FactsCard): "Jobdetails", the facts of terms.ts; a job whose ad is not loaded
    yet only what its mail or search said (reader-sections.ts PENDING_FACTS); an excluded
    job without verdicts (its state box says why);
  - requirements (a scored job only): "Anforderungen" with "x von N erfüllt" beside the
    title, one flat list in two columns (one in a narrow card), met first, then in part, not
    met and unclear, a must before what is only nice to have; a quiet "optional" after one
    that is no must (nice to have, or one the score does not count) and not met; a missing must that is a term has a small "+" into
    its field of the profile (addToProfile.ts; in the Papierkorb none, Wiederherstellen comes
    first), and once it is there a quiet check stands in place of its cross;
  - ad: the ad's text in its structure, the words of the list's search marked (AdText); only
    once the text is there.
  A new job is there at once, every card in its place (a cascade would leave the pane empty
  for a frame and replay on every job); its ring fills and counts up unless the user browses
  fast (pace.ts). What arrives later on the same job (the ad, its rows) fades in. Hovering or clicking a fact or
  a requirement marks nothing in the ad (user decision 2026-09-27). Its buttons are pressed, not
  focused, like the sidebar's (`data-press-only`, never around what copies): nothing stands armed
  for a key after a click, and Tab still reaches them. Moving the job away by the keyboard from
  one of its buttons hands the focus to the same button of the next job. A job on its way out
  looks as it did until the next one has loaded, and takes no press meanwhile (`leaving`). Every
  result and every failure is a toast.
-->
<script lang="ts" module>
  /** A button of the job view had the focus when its job moved away: the same button of the
   *  next job takes it, so the moves work job after job from the keyboard. */
  let handoff: { testid: string; from: string; until: number } | null = null;
  /** How long the next job may take to open and still take the focus. */
  const HANDOFF_MS = 3000;
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import { ringState } from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import { byKeyboard } from '$lib/input/input';
  import { displayTitle } from '$lib/i18n/format';
  import { criterionOf, errorText, noteText, reasonText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { JobDetail, OpenTarget } from '$lib/ipc/types';
  import { animateOpen } from '$lib/motion/pace';
  import { fade, flip } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { keyOf, sameKey } from '$lib/state/jobRows';
  import { jobs } from '$lib/state/jobs.svelte';
  import type { ProfileTerm } from '$lib/state/terms';
  import { toasts } from '$lib/state/toasts.svelte';
  import AdText from './AdText.svelte';
  import FactsCard from './FactsCard.svelte';
  import ReaderHero from './ReaderHero.svelte';
  import { addTerm, isAdded } from './addToProfile';
  import { copyJobPrompt } from './prompt';
  import {
    include as includeJob,
    mayInclude,
    move,
    openMail,
    purge,
    rowTools,
    seen,
    type MoveId,
    focusPlace,
  } from './actions';
  import type { ShowId } from './shows';
  import {
    PENDING_FACTS,
    READER_CARDS,
    REQUIREMENT_CODES,
    addable,
    byRequirement,
    termOf,
  } from './reader-sections';
  import { rowOf, termRows } from './terms';

  interface Props {
    detail: JobDetail;
  }
  let { detail }: Props = $props();

  // The job view opens anew for each job (JobsView's stage): the open counts for the pace of
  // browsing (its ring, if any, asks in the same frame and gets the same answer).
  void animateOpen();

  const job = $derived(detail.job);
  /** The title without gender tags. */
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  const match = $derived(detail.match);
  const withRing = $derived(app.hasProfile);
  /** The engine excludes the job (its state box says why; no verdicts, no requirements). */
  const excluded = $derived((match?.status ?? job.match?.status) === 'excluded');
  /** A match to judge the facts by (without one, or one that could not score the ad, they
   *  show the ad's side only; an excluded job shows none). */
  const judged = $derived(withRing && match !== null && match.status !== 'unscorable' && !excluded);
  const ring = $derived(
    ringState(job.match, job.match === null && Boolean(app.state?.matchPending), job.detail.kind),
  );
  let article = $state<HTMLElement | null>(null);

  const all = $derived(match?.reasons ?? []);
  const criteria = $derived(match?.criteria ?? []);

  /** Why the engine excludes the job, in one sentence: its first violation, else the note. A
   *  violation a fact judges speaks from the profile's side (its criterion's sentence,
   *  "Zeitarbeit ist in deinem Profil nicht gewählt."). */
  const exclusion = $derived.by((): string => {
    for (const reason of all) {
      if (reason.kind !== 'violation') continue;
      const key = rowOf(reason) === null ? null : criterionOf(reason.params);
      const text = key === null ? reasonText(reason) : t.reader.criterion[key];
      if (text !== '') return text;
    }
    return noteText(job.match?.note ?? match?.summary ?? null) ?? t.reader.excludedBy;
  });

  /** The ad is not loaded yet (no text, no preview): only what the mail or search said. */
  const pending = $derived(
    detail.text === null && job.detail.kind !== 'ok' && job.detail.kind !== 'teaser',
  );
  /** The facts (terms.ts); a "–" only where a verdict judges the row. */
  const rows = $derived(
    termRows({
      job,
      reasons: all,
      criteria,
      withVerdict: judged,
      textLength: detail.text?.length ?? 0,
      now: clock.now,
    }).filter(
      (row) =>
        (!pending || PENDING_FACTS.includes(row.key)) &&
        (!row.missing ||
          (detail.text !== null && job.detail.kind !== 'teaser' && row.verdict !== null)),
    ),
  );

  /** The requirements of the ad in their order: no title, wish or Schwerpunkt, none a fact
   *  judges, and no exclusion. */
  const listed = $derived(
    all
      .filter(
        (reason) =>
          REQUIREMENT_CODES.includes(reason.code) &&
          reason.kind !== 'violation' &&
          rowOf(reason) === null &&
          reasonText(reason) !== '',
      )
      .sort(byRequirement),
  );
  const met = $derived(listed.filter((reason) => reason.kind === 'met').length);
  const withRequirements = $derived(
    match !== null && match.status !== 'unscorable' && withRing && !excluded,
  );

  /** A failure says so in a toast, like every result. */
  function fail(error: string | null): void {
    if (error !== null) toasts.show(error, 'warning');
  }

  function openTarget(target: OpenTarget): void {
    invoke('open_target', { target }).catch((error: unknown) => fail(errorText(error)));
  }

  const showDoes: Record<ShowId, () => void> = {
    'open-ad': () => openTarget({ kind: 'jobUrl', key: job.key }),
    mail: () => void openMail(job).then(fail),
    prompt: () => void copyJobPrompt(job.key).then(fail),
  };

  /** A move of the hero's tools. Pressed from the keyboard, the next job's view gives the focus
   *  back to the button that had it; a click hands nothing on. */
  function act(id: MoveId): void {
    const focused = document.activeElement;
    const testid =
      byKeyboard() && focused instanceof HTMLElement && article?.contains(focused)
        ? (focused.dataset.testid ?? null)
        : null;
    handoff =
      testid === null
        ? null
        : { testid, from: keyOf(job.key), until: performance.now() + HANDOFF_MS };
    void move([job], id).then((error) => {
      if (error !== null) handoff = null;
      // The place's last job: no next one takes the focus, the place does.
      else if (testid !== null && byKeyboard() && jobs.selected === null) focusPlace();
      fail(error);
    });
  }

  // The next job, opened after a move from the keyboard on one of this view's buttons: the same
  // button of this view takes the focus, unless the user put it somewhere else meanwhile.
  $effect(() => {
    if (article === null) return;
    untrack(() => {
      const want = handoff;
      if (want === null || want.from === keyOf(job.key)) return;
      handoff = null;
      if (performance.now() > want.until) return;
      const now = document.activeElement;
      const free =
        now === null ||
        now === document.body ||
        now.closest('[data-testid="reader-pane"]') !== null;
      if (!free) return;
      article
        ?.querySelector<HTMLElement>(`[data-testid="${CSS.escape(want.testid)}"]`)
        ?.focus({ preventScroll: true });
    });
  });

  let confirmPurge = $state(false);
  let purging = $state(false);
  let purgeError = $state<string | null>(null);

  function askPurge(): void {
    purgeError = null;
    confirmPurge = true;
  }

  async function purgeJob(): Promise<void> {
    purging = true;
    purgeError = await purge([job]);
    purging = false;
    if (purgeError === null) confirmPurge = false;
  }

  /** A missing must into its field of the profile; a failure is a toast. */
  async function add(term: ProfileTerm): Promise<void> {
    fail(await addTerm(term));
  }

  /** An excluded job the user has not scored by hand, not in the Papierkorb: its one button is
   *  "Trotzdem bewerten". */
  const includable = $derived(excluded && mayInclude(job));
  /** A job put in the Papierkorb is out of sight: nothing goes from it into the profile,
   *  Wiederherstellen comes first (like `mayInclude`). */
  const mayAdd = $derived(job.place !== 'trash');
  /** "Trotzdem bewerten" was pressed: the state box says the job is being scored. */
  let including = $state(false);

  /** "Trotzdem bewerten": the job counts with its real match and gets the usual buttons; one
   *  pressed from the keyboard hands the focus to the first of them. */
  async function include(event: MouseEvent): Promise<void> {
    const fromKeyboard = event.detail === 0;
    including = true;
    const error = await includeJob(job);
    including = false;
    fail(error);
    if (error !== null || !fromKeyboard) return;
    await tick();
    actions?.querySelector<HTMLElement>('button:not([aria-disabled="true"])')?.focus();
  }

  /** The job is on its way out: it left the list's place, or another job is asked for (the one
   *  after a job deleted for good). Its view stands until the next job has loaded and takes no
   *  press meanwhile: its moves would be another place's, or a job's that is gone. */
  const leaving = $derived(job.place !== jobs.place || !sameKey(job.key, jobs.selected));
  /** The moves of the job's place, from the one table of the job's moves (the row's tools
   *  show the same). A move hands the focus on. */
  const tools = $derived(rowTools(job, { move: act, purge: askPurge, report: fail }));

  /** The row of the buttons that show the job. */
  let actions = $state<HTMLElement | null>(null);
</script>

{#snippet requirements()}
  <Card
    heading={t.reader.why}
    count={listed.length === 0 ? null : t.reader.metOf(met, listed.length)}
    testid="why"
    headingTestid="why-title"
  >
    {#if listed.length === 0}
      <p class="quiet">{t.reader.noReasons}</p>
    {:else}
      <div class="reqs">
        <ul class="reasons" data-testid="reasons">
          {#each listed as reason (reason.id)}
            {@const term = addable(reason) && mayAdd ? termOf(reason) : null}
            {@const added = term !== null && isAdded(term)}
            <li
              class="reason-line"
              data-kind={reason.kind}
              data-weight={reason.weight}
              animate:flip={{ count: listed.length }}
              in:fade
            >
              <!-- No tooltip on its icon (user decision 2026-09-27). A missing must that went
                   into the profile trades its cross for a quiet check until the next score
                   (the toast says so in words). -->
              {#snippet plus()}
                {#if term !== null}
                  <span class="reason-action" data-press-only>
                    <Button
                      variant="ghost"
                      iconOnly
                      icon="add"
                      label={t.reader.addTo[term.field](term.term)}
                      testid="add-to-profile"
                      onclick={() => void add(term)}
                    />
                  </span>
                {/if}
              {/snippet}
              <ReasonItem
                kind={reason.kind}
                optional={reason.weight !== 'must' && reason.kind !== 'met'}
                label={reasonText(reason)}
                settled={added ? t.reader.added : null}
                after={term !== null && !added ? plus : null}
                testid="reason"
              />
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </Card>
{/snippet}

<article
  class="reader"
  data-testid="reader"
  data-locked={leaving ? '' : undefined}
  bind:this={article}
  onpointerdown={(event) => {
    // Only a left press counts as looking at the job (a right or middle press is no reading).
    if (event.button === 0) seen(job.key);
  }}
>
  <div class="column">
    {#each READER_CARDS.filter((card) => card !== 'requirements' || withRequirements) as card (card)}
      {#if card !== 'ad' || detail.text}
        <div class="slot" in:fade>
          {#if card === 'hero'}
            <ReaderHero
              {detail}
              {heading}
              {ring}
              {withRing}
              {excluded}
              exclusion={excluded ? exclusion : null}
              {includable}
              {including}
              oninclude={(event) => void include(event)}
              {tools}
              onshow={(id) => showDoes[id]()}
              bind:actions
            />
          {:else if card === 'details'}
            <FactsCard {rows} onmail={() => openTarget({ kind: 'contactMail', key: job.key })} />
          {:else if card === 'requirements'}
            {@render requirements()}
          {:else if detail.text}
            <Card heading={t.reader.ad} testid="ad">
              <div class="ad">
                <AdText text={detail.text} layout={detail.layout} search={jobs.listedSearch} />
              </div>
            </Card>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
</article>

<Dialog
  bind:open={confirmPurge}
  variant="danger"
  heading={t.reader.purgeHeading}
  text={t.reader.purgeText(heading)}
  confirmLabel={t.reader.purgeConfirm}
  busy={purging}
  error={purgeError}
  testid="dialog-purge"
  onconfirm={() => void purgeJob()}
/>

<style>
  /* The page's warm ground under the whole pane. */
  .reader {
    min-height: 100%;
    background-color: var(--page);
  }

  /* The column of cards, centred, 12 apart; 8 under the top bar and 28 from the sides. */
  .column {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    max-width: calc(var(--reader-max) + var(--reader-pad-x) + var(--reader-pad-right));
    margin: 0 auto;
    padding: var(--head-pad) var(--reader-pad-right) var(--reader-pad-end) var(--reader-pad-x);
  }

  /* A narrow window: the sides of the pages (Page). */
  @media (width < 560px) {
    .column {
      padding-right: var(--page-side-narrow-end);
      padding-left: var(--page-side-narrow);
    }
  }

  .slot {
    min-width: 0;
  }

  /* The requirements in two columns (one in a narrow card), 12 under the title. */
  .reqs {
    container-type: inline-size;
    margin-top: var(--reqs-top);
  }

  .reasons {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-20);
  }

  /* A requirement and, for a missing must, its "+" into the profile right after its last
     word (in the words' line, ReasonItem `after`). */
  .reason-line {
    display: flex;
    min-width: 0;
  }

  /* The "+" keeps its hit area but not its height: the line stays a line of text. */
  .reason-action {
    display: inline-flex;
    margin-block: calc((var(--leading-md) - var(--control-icon)) / 2);
    margin-inline-start: var(--space-4);
    vertical-align: top;
  }

  .quiet {
    margin-top: var(--reqs-top);
    color: var(--text-muted);
    font: var(--type-md);
  }

  .ad {
    margin-top: var(--ad-top);
  }

  @container (width < 560px) {
    .reasons {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
