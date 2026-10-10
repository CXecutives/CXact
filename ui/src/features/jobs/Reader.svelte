<!--
  The reader on the sheet: its head (PageHeader) and the rest scroll as one under the top
  bar's fade, in the job view's column (640 px). Its sections and
  their order are data (reader-sections.ts); each is rendered below by its key, and nothing
  stands in two of them:
  - head: the title (without gender tags) and under it the job at a glance (JobMeta: the
    company, the place, the pay), then the moves of the place as quiet icons like the row's
    tools (Aktuell Archivieren, Löschen; Archiv Zurückholen, Löschen; Papierkorb
    Wiederherstellen, Endgültig löschen in red; actions.ts rowTools) and the close "×" (the
    same at every width; user 2026-10-01: no menu, no outline). A job that just moved away
    offers none while the next one loads.
  - match: first the state (ReaderState, design round 7), the one box of a job that has one,
    with its own button: excluded (why, "Trotzdem bewerten"), an ad still to come ("Anzeige
    laden"), a preview without a sign-in ("Anmelden"), an ad gone, closed or out of reach, a
    text too short to score; no info symbol beside it. Then, for a scored job only, the ring
    (44, hollow; opening a job fills its arc once) beside its band, nothing else.
  - actions (a job neither excluded nor without its text): the text buttons with their
    glyphs, Anzeige öffnen, Alert-Mail öffnen (only for a job a mail brought), Prompt für
    KI-Bewertung (only with a score and the ad's text); the row wraps. An excluded job and one
    whose ad is still to come show only the button of their state (user, 2026-10-10).
    Moving the job away from one of the
    reader's buttons hands the focus to the same button of the next job. Every result and
    every failure is a toast.
  - details: "Jobdetails", the rows of terms.ts in the order and with the icons of the facts
    table (lib/facts.ts): the ad's value (a row the ad says nothing about shows "–" only
    where a verdict judges it; for an ad the app never read in full only what it knows), a
    quiet note, and the verdict as an icon whose tooltip is the reason that decided it (none
    for an excluded job: its head says why). "Gefunden" stays quiet and names the portal once.
    Every row stands at its first line. The contact's e-mail is a link: a new mail to it in
    the default mail program, the job's title its subject.
  - requirements (not for an excluded job): "Anforderungen" in the groups of
    reader-sections.ts, a quiet count after
    each title, a quiet "optional" after one that is only nice to have and not met; a missing
    must that is a term has a small "+" into its field of the profile
    (addToProfile.ts); once it is there, a quiet check stands in place of its cross.
  - ad: the ad's text in its structure: its headings, its lists, its paragraphs, the words of
    the list's search marked (AdText.svelte).
  Hovering or clicking a row or a requirement marks nothing in the ad (user decision
  2026-09-27). Rows, requirements and the ad text that arrive later (the ad loaded, a new
  score) fade in; requirements glide in their group.
-->
<script lang="ts" module>
  /** A button of the reader had the focus when its job moved away: the same button of the
   *  next job takes it, so the moves work job after job from the keyboard. */
  let handoff: { testid: string; from: string; until: number } | null = null;
  /** How long the next job may take to open and still take the focus. */
  const HANDOFF_MS = 3000;
  const WEIGHT_ORDER = { must: 0, hard: 1, nice: 2, info: 3 } as const;
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Icon from '$components/Icon.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import ScoreRing, { ringState } from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import { displayTitle } from '$lib/i18n/format';
  import { criterionKey, errorText, noteText, reasonText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { JobDetail, OpenTarget, Reason } from '$lib/ipc/types';
  import { fade, flip } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import type { ProfileTerm } from '$lib/state/terms';
  import { toasts } from '$lib/state/toasts.svelte';
  import JobMeta from '$components/JobMeta.svelte';
  import AdText from './AdText.svelte';
  import ReaderState from './ReaderState.svelte';
  import { addTerm, isAdded } from './addToProfile';
  import { copyJobPrompt } from './prompt';
  import {
    guarded,
    include as includeJob,
    move,
    purge,
    rowTools,
    seen,
    type MoveId,
  } from './actions';
  import { SHOWS, showActions, type ShowId } from './shows';
  import {
    READER_SECTIONS,
    REQUIREMENT_CODES,
    REQUIREMENT_GROUPS,
    addable,
    kindOf,
    termOf,
  } from './reader-sections';
  import { rowOf, termRows } from './terms';

  interface Props {
    detail: JobDetail;
    /** Close the job. */
    onclose?: (() => void) | null;
  }
  let { detail, onclose = null }: Props = $props();

  const job = $derived(detail.job);
  /** The title without gender tags. */
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  const match = $derived(detail.match);
  const withRing = $derived(app.hasProfile);
  /** The engine excludes the job (its head says why; no verdicts, no requirements). */
  const excluded = $derived((match?.status ?? job.match?.status) === 'excluded');
  /** A match to judge the rows by (without one, or one that could not score the ad, they show
   *  the ad's side only, as the ring says "Nicht bewertet"; an excluded job shows none). */
  const judged = $derived(withRing && match !== null && match.status !== 'unscorable' && !excluded);
  const ring = $derived(
    ringState(job.match, job.match === null && Boolean(app.state?.matchPending), job.detail.kind),
  );
  let article = $state<HTMLElement | null>(null);

  const all = $derived(match?.reasons ?? []);
  const criteria = $derived(match?.criteria ?? []);

  /** Why the engine excludes the job, in one sentence: its first violation, else the note. A
   *  violation a row of the Jobdetails judges speaks from the profile's side (its criterion's
   *  sentence, "Zeitarbeit ist in deinem Profil nicht gewählt."); the row's tooltip says what
   *  the ad states. */
  const exclusion = $derived.by((): string => {
    for (const reason of all) {
      if (reason.kind !== 'violation') continue;
      const key = rowOf(reason) === null ? null : criterionKey(reason.code);
      const text = key === null ? reasonText(reason) : t.reader.criterion[key];
      if (text !== '') return text;
    }
    return noteText(job.match?.note ?? match?.summary ?? null) ?? t.reader.note.hardCriterion;
  });
  const band = $derived(ring.status === 'scored' ? ring.band : null);
  /** The ad's text is there (a preview counts): the buttons that show the job make sense. */
  const hasText = $derived(
    detail.text !== null || job.detail.kind === 'ok' || job.detail.kind === 'teaser',
  );
  /** The ring's colour step (ScoreRing's decile), which the band's words take too. */
  const step = $derived(
    band !== null && 'score' in ring
      ? `d${Math.min(9, Math.floor(Math.max(0, ring.score) / 10))}`
      : '',
  );

  const detailKind = $derived(job.detail.kind);
  /** Every name a row of the Jobdetails can have (the names' column is as wide as the
   *  longest). */
  const NAMES = $derived([
    ...new Set([...Object.values(t.reader.term), t.reader.salaryName, t.reader.hourlyName]),
  ]);
  /** The rows of the Jobdetails (terms.ts); for an ad the app never read in full (none, or a
   *  preview) only what it knows (what the ad says is not known yet, no "–" claims it says
   *  nothing), and a "–" only where a verdict judges the row. */
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
        !row.missing || (detail.text !== null && detailKind !== 'teaser' && row.verdict !== null),
    ),
  );

  const byWeight = (a: Reason, b: Reason): number =>
    WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight];
  /** The requirements of the ad: no title, wish or Schwerpunkt, none a row of the Jobdetails
   *  judges, and no exclusion (the head says it). */
  const listed = $derived(
    all.filter(
      (reason) =>
        REQUIREMENT_CODES.includes(reason.code) &&
        reason.kind !== 'violation' &&
        rowOf(reason) === null &&
        reasonText(reason) !== '',
    ),
  );
  const groups = $derived(
    REQUIREMENT_GROUPS.map((group) => ({
      ...group,
      items: listed.filter((reason) => reason.kind === group.kind).sort(byWeight),
    })).filter((group) => group.items.length > 0),
  );

  /** A failure says so in a toast, like every result. */
  function fail(error: string | null): void {
    if (error !== null) toasts.show(error, 'warning');
  }

  function openTarget(target: OpenTarget): void {
    invoke('open_target', { target }).catch((error: unknown) => fail(errorText(error)));
  }

  /** A move of the head's tools. The next job's reader gives the focus back to the button
   *  that had it. */
  function act(id: MoveId): void {
    if (guarded()) return;
    const focused = document.activeElement;
    const testid =
      focused instanceof HTMLElement && article?.contains(focused)
        ? (focused.dataset.testid ?? null)
        : null;
    handoff =
      testid === null
        ? null
        : { testid, from: keyOf(job.key), until: performance.now() + HANDOFF_MS };
    void move([job], id).then((error) => {
      if (error !== null) handoff = null;
      fail(error);
    });
  }

  // The next job, opened after a move from one of this reader's buttons: the same button of
  // this reader takes the focus, unless the user put it somewhere else meanwhile.
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
    if (guarded()) return;
    purgeError = null;
    confirmPurge = true;
  }

  async function purgeJob(): Promise<void> {
    purging = true;
    purgeError = await purge([job]);
    purging = false;
    if (purgeError === null) confirmPurge = false;
  }

  /** A missing must into its field of the profile (its term, without the ad's lead words); a
   *  failure is a toast. */
  async function add(term: ProfileTerm): Promise<void> {
    fail(await addTerm(term));
  }

  /** An excluded job the user has not scored by hand: its one button is "Trotzdem bewerten". */
  const includable = $derived(excluded && !job.overridden);

  /** "Trotzdem bewerten": the job counts with its real match and gets the usual buttons; one
   *  pressed from the keyboard hands the focus to the first of them. */
  async function include(event: MouseEvent): Promise<void> {
    const fromKeyboard = event.detail === 0;
    const error = await includeJob(job);
    fail(error);
    if (error !== null || !fromKeyboard) return;
    await tick();
    actions?.querySelector<HTMLElement>('button:not([aria-disabled="true"])')?.focus();
  }

  /** The job still lies in the list's place: one that just moved away keeps its reader
   *  until the next job has loaded, its moves off meanwhile (they would be the new place's). */
  const inPlace = $derived(job.place === jobs.place);
  /** The moves of the job's place beside the close button, as icons without a frame like it
   *  (user decision 2026-10-01: Archivieren and Löschen in Aktuell, the place's own
   *  elsewhere), from the one table of the job's moves (the row's tools show the same). A
   *  move hands the focus on. */
  const tools = $derived(rowTools(job, { move: act, purge: askPurge, report: fail }));

  /** The action row (it wraps where its buttons do not fit). */
  let actions = $state<HTMLElement | null>(null);
  /** The test id of each button that shows the job, and what it does. */
  const SHOW_TESTIDS: Record<ShowId, string> = {
    'open-ad': 'open-ad',
    mail: 'reader-mail',
    prompt: 'reader-prompt',
  };
  const showDoes: Record<ShowId, () => void> = {
    'open-ad': () => openTarget({ kind: 'jobUrl', key: job.key }),
    mail: () => openTarget({ kind: 'gmail', key: job.key }),
    prompt: () => void copyJobPrompt(job.key).then(fail),
  };
</script>

{#snippet head()}
  <PageHeader {heading} copy headingTestid="reader-title" column="reader" testid="reader-head">
    <JobMeta {job} prefix="reader" wrap />
    {#snippet actions()}
      {#each tools as tool (tool.id)}
        <Button
          variant="ghost"
          iconOnly
          icon={tool.icon}
          label={tool.label}
          deletes={tool.deletes}
          disabled={tool.disabled || !inPlace}
          disabledReason={tool.reason}
          testid="reader-{tool.id}"
          onclick={tool.run}
        />
      {/each}
      {#if onclose}
        <Button
          variant="ghost"
          iconOnly
          icon="close"
          label={t.reader.close}
          testid="reader-close"
          onclick={onclose}
        />
      {/if}
    {/snippet}
  </PageHeader>
{/snippet}

{#snippet score()}
  <ReaderState
    {detail}
    exclusion={excluded ? exclusion : null}
    {includable}
    oninclude={(event) => void include(event)}
  />
  {#if withRing && !excluded && band !== null}
    <div class="match" data-testid="reader-match">
      <ScoreRing {ring} size="md" animate={keyOf(job.key)} testid="reader-ring" />
      <p class="band {band} {step}" data-testid="band">{t.score.band[band]}</p>
    </div>
  {/if}
{/snippet}

{#snippet showButtons()}
  <!-- Words, glyphs, what is off and what is not there come from the one table the row's
       menu reads too. -->
  {@const shows = showActions(job)}
  {@const shown = SHOWS.filter((id) => !shows[id].hidden)}
  {#each shown as id (id)}
    <Button
      variant="secondary"
      icon={shows[id].icon}
      label={shows[id].label}
      disabled={shows[id].reason !== null}
      disabledReason={shows[id].reason}
      testid={SHOW_TESTIDS[id]}
      onclick={() => showDoes[id]()}
    />
  {/each}
{/snippet}

{#snippet actionRow()}
  {#if !excluded && hasText}
    <div class="actions" bind:this={actions} data-testid="reader-actions">
      {@render showButtons()}
    </div>
  {/if}
{/snippet}

{#snippet details()}
  <section class="block" data-testid="terms">
    <h2 class="section">{t.reader.details}</h2>
    <!-- Name, the ad's value and whether it fits as an icon (the reason in its tooltip). -->
    <ul class="terms" class:bare={!withRing} aria-label={t.reader.details} data-testid="criteria">
      <!-- Every name a row can have, unseen and without height: the names' column keeps its
           width whichever rows a job shows, so the values never move between jobs. -->
      <li class="sizer" role="presentation" aria-hidden="true">
        {#each NAMES as name (name)}<span class="sizer-name">{name}</span>{/each}
      </li>
      {#each rows as row (row.key)}
        <li class="term" data-row={row.key} data-testid="term-{row.key}" in:fade>
          <span class="term-name"><Icon name={row.icon} size="sm" />{row.name}</span>
          <!-- The verdict in its own column between the name and the value (the names are the
               same for every job, so it never moves); a row or a job without one leaves it
               empty. -->
          {#if judged && row.verdict}
            <span class="verdict" data-testid="verdict" data-verdict={row.verdict}>
              <ReasonItem
                iconOnly
                kind={row.excludes ? 'violation' : kindOf(row.verdict)}
                label={row.excludes ? t.score.excluded : t.reader.verdict[row.verdict]}
              />
            </span>
          {/if}
          <span class="term-line">
            {#if row.parts}
              <!-- The contact's e-mail writes a new mail to it (the job's title its subject). -->
              <span class="parts">
                {#each row.parts as part, index (index)}{#if part === row.mail}<span class="mail"
                      ><Button
                        variant="link"
                        label={part}
                        testid="contact-mail"
                        onclick={() => openTarget({ kind: 'contactMail', key: job.key })}
                      /></span
                    >{:else}<span class="value" data-copy>{part}</span>{/if}{/each}
              </span>
            {:else}
              <span
                class="value"
                class:missing={row.missing}
                class:quiet={row.key === 'portal'}
                class:urgent={row.urgent}
                data-copy={row.missing ? null : ''}>{row.value}</span
              >
            {/if}
            {#if row.note}<span class="term-note">{row.note}</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#snippet requirements()}
  {#if match && match.status !== 'unscorable' && withRing && !excluded}
    <section class="block why" data-testid="why" in:fade>
      <h2 class="section">{t.reader.why}</h2>
      {#if groups.length === 0}
        <p class="quiet">{t.reader.noReasons}</p>
      {:else}
        {#each groups as group (group.kind)}
          <div class="group" data-testid="group-{group.kind}">
            <h3 class="sub">
              {t.reader.verdict[group.verdict]}
              <span class="count" data-testid="group-count">{group.items.length}</span>
            </h3>
            <ul class="reasons" data-testid="reasons-{group.kind}">
              {#each group.items as reason (reason.id)}
                {@const term = addable(reason) ? termOf(reason) : null}
                {@const added = term !== null && isAdded(term)}
                <li
                  class="reason-line"
                  data-weight={reason.weight}
                  animate:flip={{ count: group.items.length }}
                  in:fade
                >
                  <!-- The group's heading says the verdict; no tooltip on its icon (user decision
                       2026-09-27, the Jobdetails keep theirs). A missing must that went into the
                       profile trades its cross for a quiet check until the next score (the toast
                       says so in words). -->
                  <ReasonItem
                    kind={reason.kind}
                    optional={reason.weight === 'nice' && reason.kind !== 'met'}
                    label={reasonText(reason)}
                    settled={added ? t.reader.added : null}
                    testid="reason"
                  />
                  <!-- A missing must that is a term: its way into the profile. -->
                  {#if term !== null && !added}
                    <span class="reason-action">
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
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
{/snippet}

{#snippet ad()}
  <section class="block ad" data-testid="ad">
    <h2 class="section">{t.reader.ad}</h2>
    {#if detail.text}
      <div in:fade>
        <AdText text={detail.text} layout={detail.layout} search={jobs.search} />
      </div>
    {/if}
  </section>
{/snippet}

<article
  class="reader"
  data-testid="reader"
  bind:this={article}
  onpointerdown={(event) => {
    // Only a left press counts as looking at the job (a right or middle press is no reading).
    if (event.button === 0) seen(job.key);
  }}
>
  {@render head()}
  <div class="body">
    {#each READER_SECTIONS as section (section)}
      {#if section === 'match'}
        {@render score()}
      {:else if section === 'actions'}
        {@render actionRow()}
      {:else if section === 'details'}
        {@render details()}
      {:else if section === 'requirements'}
        {@render requirements()}
      {:else}
        {@render ad()}
      {/if}
    {/each}
  </div>
</article>

<Dialog
  bind:open={confirmPurge}
  variant="danger"
  heading={t.actions.purgeHeading}
  text={t.actions.purgeText}
  confirmLabel={t.actions.purge}
  busy={purging}
  error={purgeError}
  testid="dialog-purge"
  onconfirm={() => void purgeJob()}
/>

<style>
  .reader {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  /* The job view's column under the head (the ring right under the title, as far below it
     as the head's own padding), its sections 20 apart. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
    width: 100%;
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: 0 var(--pane-padding) var(--space-64);
  }

  /* The ring, or the ban, beside its words; the words centre on it. */
  .match {
    display: flex;
    align-items: center;
    gap: var(--space-12);
  }

  .band {
    color: var(--text);
    font: var(--type-label);
  }

  /* The band in exactly the colour of its ring (the decile of the score; user, 2026-09-30:
     not measured against AA, like the ring itself). */
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
  }

  /* A heading 12 px above its content. */
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding-top: var(--space-20);
    border-top: var(--border-width) solid var(--border);
  }

  .section {
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  /* The Jobdetails: name, verdict and value in three columns that line up row by row; the
     verdicts stand in one column after the names, which every job shares, so they never
     move. A job without a score keeps the verdicts' column empty, so the values start at the
     same place for every job (two columns only without a profile, where no job is judged).
     Each row is one box on the columns of the list. The same metrics as the requirements
     below: their text, their icon gap. */
  .terms {
    display: grid;
    grid-template-columns: max-content var(--icon-sm) minmax(0, max-content);
    gap: var(--space-8) var(--space-16);
    font: var(--type-md);
    text-align: start;
  }

  /* In the names' column only, no height, and no gap of its own below it. */
  .sizer {
    display: flex;
    grid-column: 1;
    flex-direction: column;
    height: 0;
    margin-bottom: calc(-1 * var(--space-8));
    overflow: hidden;
    visibility: hidden;
  }

  /* As wide as a row's name with its icon before it. */
  .sizer-name {
    padding-inline-start: calc(var(--icon-sm) + var(--space-8));
    white-space: nowrap;
  }

  .terms.bare {
    grid-template-columns: max-content minmax(0, max-content);
    column-gap: var(--space-24);
  }

  /* Each part stands at the row's first line (a value of several lines, the contact, goes on
     below it). */
  .term {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: start;
    justify-items: start;
  }

  .term-name {
    display: inline-flex;
    grid-column: 1;
    align-items: center;
    gap: var(--space-8);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .term-name :global(.icon) {
    color: var(--text-subtle);
  }

  .term-line {
    display: flex;
    grid-column: 3;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .bare .term-line {
    grid-column: 2;
  }

  .value {
    color: var(--text);
  }

  .value.missing,
  .term-note {
    color: var(--text-subtle);
  }

  /* How and when the job came: quieter than what the ad says. */
  .value.quiet {
    color: var(--text-muted);
  }

  /* A deadline within a week, or past. */
  .value.urgent {
    color: var(--danger-strong);
  }

  /* The parts of the contact, one under the other, each copied on its own. */
  .parts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* The e-mail as a link keeps its hit area but not its height: the line stays a line of
     text, in the type of the name and the phone around it. */
  .mail {
    display: inline-flex;
    margin-block: calc((var(--leading-md) - var(--control-sm)) / 2);
  }

  .mail :global(.btn.link) {
    --btn-type: var(--type-md);
  }

  /* The icon centred on the row's first line. */
  .verdict {
    display: inline-flex;
    grid-column: 2;
    min-width: var(--icon-sm);
    margin-top: calc((var(--leading-md) - var(--icon-sm)) / 2);
  }

  /* The groups of the requirements under their sub-labels. */
  .why {
    gap: var(--space-16);
  }

  .why .section {
    margin-bottom: calc(var(--space-12) - var(--space-16));
  }

  .sub {
    color: var(--text-label);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  /* The quiet count after a group's title. */
  .count {
    color: var(--text-subtle);
    font-weight: var(--weight-regular);
    font-variant-numeric: var(--numeric);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
  }

  .reasons {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* A reason and, for a missing must, its "+" into the profile right after its words. */
  .reason-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }

  /* The "+" keeps its hit area but not its height: the line stays a line of text. */
  .reason-action {
    display: inline-flex;
    flex: none;
    margin-block: calc((var(--leading-md) - var(--control-sm)) / 2);
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-md);
  }
</style>
