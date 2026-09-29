<!--
  The reader, unboxed on the sheet (max 720 px). Its sections and their order are data
  (reader-sections.ts); each is rendered below by its key, and nothing stands in two of them:
  - head: the title (without gender tags) and the close "×" (the same at every width).
  - match: the ring (56, hollow; opening a job fills its arc once, the number stands at once)
    beside its band; every ring without a score says "Noch nicht bewertet". A ring with a
    number is a button: "Warum diese Zahl?" opens below it as soon as the pointer rests on it
    (user, 2026-09-29; no tooltip before it) or on a click, a popover of what moved the score
    (scoreWhy.ts, in the menu layer: leaving it and the ring, Esc, Tab and a press outside
    close it). An excluded job
    shows the ban at the ring's size instead, "Ausgeschlossen" and one sentence why from the
    profile's side (its first violation; the row it violates says what the ad states).
  - actions: Alert-Mail öffnen, Anzeige öffnen (Offline-Anzeige öffnen for an ad that is gone
    or closed: the portal's page still opens), KI-Prompt kopieren and "…", all alike. The
    "…" menu is the second group of the job's menu (actions.ts jobMenu, the row's right click
    shows it too, its tools the moves): "Wieder ausschließen" for a job scored by hand, then
    the moves of the place (Eingang Archivieren, Löschen; Archiv In den Eingang, Löschen;
    Papierkorb Wiederherstellen, Endgültig löschen). An excluded job has one button,
    "Trotzdem bewerten" (the one thing to do with it), and "…" holds the whole job menu
    without it (Alert-Mail öffnen, Anzeige öffnen, KI-Prompt kopieren, then the moves). A job that just
    moved away offers none while the next one loads. Moving the job away from one of the
    reader's buttons hands the focus to the same button of the next job. Every result and every
    failure is a toast.
  - details: "Jobdetails", the rows of terms.ts in the order and with the icons of the facts
    table (lib/facts.ts): the ad's value ("/" where it says nothing; for an ad the app never
    read in full only what it knows), a quiet note, and the verdict as an icon whose tooltip
    is the reason that decided it (the ban where it excludes the job). The contact's e-mail
    is a link: a new mail to it in the default mail program, the job's title its subject.
  - requirements: "Anforderungen" in the groups of reader-sections.ts, a quiet count after
    each title; a missing must that is a term has a small "+" into its field of the profile
    (addToProfile.ts); once it is there, a quiet check stands in place of its cross.
  - ad: the note on a text that is not all there (a preview, an ad still to come or being
    loaded, one the app cannot reach, gone or closed) with "Anzeige laden" or "Anmeldung
    einrichten" where they help, and the ad's text in its structure: its headings, its lists,
    its paragraphs, the words of the list's search marked (ReaderAd.svelte, AdText.svelte).
  Hovering or clicking a row or a requirement marks nothing in the ad (user decision
  2026-09-27). Rows, requirements and the ad text that arrive later (the ad loaded, a new
  score) fade in; requirements glide in their group.
-->
<script lang="ts" module>
  /** A button of the reader had the focus when its job moved away: the same button of the
   *  next job takes it, so the "…" menu works job after job from the keyboard. */
  let handoff: { testid: string; from: string; until: number } | null = null;
  /** How long the next job may take to open and still take the focus. */
  const HANDOFF_MS = 3000;
  const WEIGHT_ORDER = { must: 0, hard: 1, nice: 2, info: 3 } as const;
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Icon from '$components/Icon.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import ScoreRing, { ringState } from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import { displayTitle } from '$lib/i18n/format';
  import { criterionKey, errorText, noteText, reasonText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { JobDetail, OpenTarget, Reason } from '$lib/ipc/types';
  import { popoverDelay } from '$lib/motion/motion';
  import { fade, flip } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import {
    leaveHover,
    menuState,
    openMenu,
    stayHover,
    type MenuEntry,
  } from '$lib/state/menu.svelte';
  import type { ProfileTerm } from '$lib/state/terms';
  import { toasts } from '$lib/state/toasts.svelte';
  import ReaderAd from './ReaderAd.svelte';
  import { addTerm, isAdded } from './addToProfile';
  import { copyJobPrompt } from './prompt';
  import { guarded, jobMenu, move, override, purge, seen, type MoveId } from './actions';
  import { showActions, type ShowAction } from './shows';
  import {
    READER_SECTIONS,
    REQUIREMENT_CODES,
    REQUIREMENT_GROUPS,
    addable,
    kindOf,
    termOf,
  } from './reader-sections';
  import { whyLines } from './scoreWhy';
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
  /** A match to judge the rows by (without one, or one that could not score the ad, they show
   *  the ad's side only, as the ring says "Noch nicht bewertet"). */
  const judged = $derived(withRing && match !== null && match.status !== 'unscorable');
  const ring = $derived(
    ringState(job.match, job.match === null && Boolean(app.state?.matchPending), job.detail.kind),
  );
  let article = $state<HTMLElement | null>(null);

  const all = $derived(match?.reasons ?? []);
  const criteria = $derived(match?.criteria ?? []);

  const excluded = $derived((match?.status ?? job.match?.status) === 'excluded');
  /** Why the engine excludes the job, in one sentence: its first violation, else the note. A
   *  violation a row of the Jobdetails judges speaks from the profile's side (its criterion's
   *  sentence, "Du schließt Zeitarbeit aus."); the row's tooltip says what the ad states. */
  const exclusion = $derived.by((): string => {
    for (const reason of all) {
      if (reason.kind !== 'violation') continue;
      const key = rowOf(reason) === null ? null : criterionKey(reason.code);
      const text = key === null ? reasonText(reason) : t.reader.criterion[key].exclusion;
      if (text !== '') return text;
    }
    return noteText(job.match?.note ?? match?.summary ?? null) ?? t.reader.note.hardCriterion;
  });
  const band = $derived(
    ring.status === 'scored' || ring.status === 'provisional' ? ring.band : null,
  );
  /** "Warum diese Zahl?": what moved the score (scoreWhy.ts), for a ring with a number. */
  const why = $derived(judged && band !== null ? whyLines(match?.factors ?? []) : []);
  let whyOpen = $state(false);

  /** The ring's popover, right below it: opened by a click (the keys, a touch; a second
   *  click closes it, the press outside does) or by the pointer resting on the ring. */
  function openWhy(anchor: EventTarget | null, hover: boolean): void {
    if (!(anchor instanceof HTMLElement) || menuState.open !== null) return;
    whyOpen = true;
    openMenu({
      label: t.score.why,
      anchor: { kind: 'below', rect: anchor.getBoundingClientRect(), align: 'start' },
      entries: why,
      onclose: () => (whyOpen = false),
      ...(hover ? { hover: anchor } : {}),
    });
  }

  /** The mouse on the ring opens its popover after --delay-popover; leaving closes it. */
  let resting: ReturnType<typeof setTimeout> | undefined;
  function enterRing(event: PointerEvent): void {
    stayHover();
    if (event.pointerType !== 'mouse' || whyOpen) return;
    const anchor = event.currentTarget;
    clearTimeout(resting);
    resting = setTimeout(() => openWhy(anchor, true), popoverDelay());
  }
  /** A click opens it at once (the rest that was waiting is over). */
  function clickRing(event: MouseEvent): void {
    clearTimeout(resting);
    openWhy(event.currentTarget, false);
  }
  function leaveRing(): void {
    clearTimeout(resting);
    leaveHover();
  }
  onDestroy(() => clearTimeout(resting));

  const detailKind = $derived(job.detail.kind);
  /** The ad is gone or takes no applications: "Anzeige öffnen" says so (the portal's page
   *  still opens), and the Jobdetails once, since the day the app read the closed page. */
  const offline = $derived(detailKind === 'gone' || job.closed);
  /** The rows of the Jobdetails (terms.ts); for an ad the app never read in full (none, or a
   *  preview) only what it knows (what the ad says is not known yet, no "/" claims it says
   *  nothing). */
  const rows = $derived(
    termRows({
      job,
      reasons: all,
      criteria,
      withVerdict: judged,
      textLength: detail.text?.length ?? 0,
      now: clock.now,
      offline: offline ? { since: job.closed ? detail.fetchedAt : null } : null,
    }).filter((row) => (detail.text !== null && detailKind !== 'teaser') || !row.missing),
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

  /** A move of the "…" menu. The next job's reader gives the focus back to the button that had
   *  it (the "…" menu hands it back to its button when it closes). */
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
    const error = await override(job, true);
    fail(error);
    if (error !== null || !fromKeyboard) return;
    await tick();
    actions?.querySelector<HTMLElement>('button:not([aria-disabled="true"])')?.focus();
  }

  /** The "…" menu, from the one table of the job's menu (the row's right click shows the
   *  same): what changes the job; for an excluded job everything but "Trotzdem bewerten",
   *  which is its button. A move hands the focus on. */
  function moreEntries(): MenuEntry[] {
    const context = { move: act, purge: askPurge, report: fail };
    if (!includable) return jobMenu(job, { ...context, changesOnly: true });
    return jobMenu(job, context).filter((entry) => !('id' in entry) || entry.id !== 'include');
  }

  /** The action row stays one line: where the labels do not fit, the buttons turn into icons
   *  one after the other, from the last: the longest and least used first (the prompt, then
   *  Anzeige öffnen, then Alert-Mail öffnen; their tooltips name them). Tried again whenever
   *  the row's width changes (before the frame is painted). */
  let actions = $state<HTMLElement | null>(null);
  /** How many of the three buttons show only their icon, from the last. */
  let iconsOnly = $state(0);
  const SHOWS = 3;

  /** The last button starts above the bottom of the first. */
  function oneLine(row: HTMLElement): boolean {
    const first = row.firstElementChild;
    const last = row.lastElementChild;
    return !(first instanceof HTMLElement && last instanceof HTMLElement)
      ? true
      : last.offsetTop < first.offsetTop + first.offsetHeight;
  }

  /** The longest form of the actions that keeps the row on one line (the newest try wins
   *  when the width changes again meanwhile). */
  let fitting = 0;
  async function fit(row: HTMLElement): Promise<void> {
    const attempt = ++fitting;
    for (let icons = 0; icons <= SHOWS; icons += 1) {
      if (attempt !== fitting) return;
      iconsOnly = icons;
      await tick();
      if (attempt !== fitting || oneLine(row)) return;
    }
  }

  $effect(() => {
    const row = actions;
    if (row === null) return;
    let width = -1;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next === width) return;
      width = next;
      // In the next frame, before it is painted: changing the row inside the callback would
      // make the observer report again in the same frame (a loop).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fit(row));
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  /** The "…" button and its menu, right below it (a second click closes it: the press
   *  outside does). */
  let moreAnchor = $state<HTMLElement | null>(null);
  let moreOpen = $state(false);

  /**
   * The job still lies in the list's place. One that just moved away (Löschen from "…", a
   * row's tool or its menu) keeps its reader until the next job has loaded; its place is the
   * new one then, and the "…" would offer that place's moves (Wiederherstellen, Endgültig
   * löschen in the Eingang): it opens nothing until the next job is there.
   */
  const inPlace = $derived(job.place === jobs.place);

  function openMore(event: MouseEvent): void {
    if (moreAnchor === null || menuState.open !== null || !inPlace) return;
    moreOpen = true;
    openMenu({
      label: t.reader.more,
      anchor: { kind: 'below', rect: moreAnchor.getBoundingClientRect(), align: 'end' },
      // Enter or Space on the button: the first entry is active at once, like the OS.
      fromKeyboard: event.detail === 0,
      entries: moreEntries(),
      onclose: () => (moreOpen = false),
    });
  }
</script>

{#snippet head()}
  <header class="head">
    <h1 class="title" data-testid="reader-title" data-copy>{heading}</h1>
    {#if onclose}
      <span class="close">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          label={t.reader.close}
          testid="reader-close"
          onclick={onclose}
        />
      </span>
    {/if}
  </header>
{/snippet}

{#snippet score()}
  {#if withRing}
    <div class="match" data-testid="reader-match">
      {#if excluded}
        <ScoreRing ring={{ status: 'off' }} size="md" ban testid="reader-ban" />
        <div class="lines">
          <p class="band" data-testid="band">{t.score.excluded}</p>
          <p class="why-line" data-testid="exclusion">{exclusion}</p>
        </div>
      {:else}
        <ScoreRing
          {ring}
          size="md"
          animate={keyOf(job.key)}
          onclick={why.length > 0 ? clickRing : null}
          onpointerenter={why.length > 0 ? enterRing : null}
          onpointerleave={why.length > 0 ? leaveRing : null}
          expanded={whyOpen}
          testid="reader-ring"
        />
        <p class="band {band ?? 'none'}" data-testid="band">
          {band ? t.score.band[band] : t.score.none}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet showButtons()}
  <!-- Words, glyphs and what is off come from the one table the row's menu reads too. -->
  {@const shows = showActions(job)}
  {#snippet show(action: ShowAction, testid: string, onclick: () => void, index: number)}
    <Button
      variant="secondary"
      size="field"
      icon={action.icon}
      label={action.label}
      iconOnly={index >= SHOWS - iconsOnly}
      disabled={action.reason !== null}
      disabledReason={action.reason}
      {testid}
      {onclick}
    />
  {/snippet}
  {@render show(shows.mail, 'reader-mail', () => openTarget({ kind: 'gmail', key: job.key }), 0)}
  {@render show(shows['open-ad'], 'open-ad', () => openTarget({ kind: 'jobUrl', key: job.key }), 1)}
  {@render show(shows.prompt, 'reader-prompt', () => void copyJobPrompt(job.key).then(fail), 2)}
{/snippet}

{#snippet actionRow()}
  <div class="actions" bind:this={actions} data-testid="reader-actions">
    {#if includable}
      <Button
        variant="secondary"
        size="field"
        icon="include"
        label={t.actions.include}
        testid="reader-include"
        onclick={(event) => void include(event)}
      />
    {:else}
      {@render showButtons()}
    {/if}
    <span class="more" bind:this={moreAnchor}>
      <Button
        variant="secondary"
        size="field"
        icon="more"
        iconOnly
        label={t.reader.more}
        menu
        expanded={moreOpen}
        testid="reader-more"
        onclick={openMore}
      />
    </span>
  </div>
{/snippet}

{#snippet details()}
  <section class="block" data-testid="terms">
    <h2 class="section">{t.reader.details}</h2>
    <!-- Name, the ad's value and whether it fits as an icon (the reason in its tooltip). -->
    <ul class="terms" class:bare={!withRing} aria-label={t.reader.details} data-testid="criteria">
      {#each rows as row (row.key)}
        <li
          class="term"
          class:tall={row.parts !== null}
          data-row={row.key}
          data-testid="term-{row.key}"
          in:fade
        >
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
                        size="sm"
                        label={part}
                        external
                        testid="contact-mail"
                        onclick={() => openTarget({ kind: 'contactMail', key: job.key })}
                      /></span
                    >{:else}<span class="value" data-copy>{part}</span>{/if}{/each}
              </span>
            {:else}
              <span
                class="value"
                class:missing={row.missing}
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
  {#if match && match.status !== 'unscorable' && withRing}
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
                    optional={reason.weight === 'nice'}
                    label={reasonText(reason)}
                    settled={added ? t.reader.added : null}
                    testid="reason"
                  />
                  <!-- A missing must that is a term: its way into the profile. -->
                  {#if term !== null && !added}
                    <span class="reason-action">
                      <Button
                        variant="ghost"
                        size="sm"
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
    <ReaderAd {detail} />
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
  {#each READER_SECTIONS as section (section)}
    {#if section === 'head'}
      {@render head()}
    {:else if section === 'match'}
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
    gap: var(--space-20);
    container-type: inline-size;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
  }

  .title {
    flex: 1;
    min-width: 0;
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
    text-wrap: balance;
  }

  /* On the axis of the first title line; the glyph ends on the edge of the column. */
  .close {
    display: flex;
    flex: none;
    margin-top: calc((var(--leading-2xl) - var(--control-sm)) / 2);
    margin-right: calc(-1 * var(--space-6));
  }

  /* The ring, or the ban, beside its words; the words centre on it. */
  .match {
    display: flex;
    align-items: center;
    gap: var(--space-16);
  }

  @container (width < 480px) {
    .match {
      gap: var(--space-12);
    }
  }

  .lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .band {
    color: var(--text);
    font: var(--type-md);
    font-weight: var(--weight-medium);
  }

  .band.high {
    color: var(--score-high-text);
  }

  .band.mid {
    color: var(--score-mid-text);
  }

  .band.low {
    color: var(--score-low-text);
  }

  /* Not scored (yet, or at all): muted, not the colour of a low score. */
  .band.none {
    color: var(--text-muted);
  }

  .why-line {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

  .more {
    display: inline-flex;
    flex: none;
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
    font: var(--type-lg);
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

  .terms.bare {
    grid-template-columns: max-content minmax(0, max-content);
    column-gap: var(--space-24);
  }

  .term {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    justify-items: start;
  }

  /* A value of several lines (the contact): the name stands at its first line. */
  .term.tall {
    align-items: start;
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

  .verdict {
    display: inline-flex;
    grid-column: 2;
    min-width: var(--icon-sm);
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
