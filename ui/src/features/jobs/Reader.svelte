<!--
  The reader, unboxed on the sheet (max 720 px). Its sections and their order are data
  (reader-sections.ts); each is rendered below by its key, and nothing stands in two of them:
  - head: the title (without gender tags) and the close "×" (the same at every width); the
    company and the place, each after its icon (copyable); the portal's tile with its name and
    the day of the alert mail, the other portals that announced the job as further tiles.
  - match: the ring (56, hollow; opening a job fills its arc once, the number stands at once)
    beside its band; every ring without a score says "Noch nicht bewertet". An excluded job
    shows the ban instead, "Ausgeschlossen" and one sentence why (its first violation).
  - actions: Alert-Mail öffnen, Anzeige öffnen, KI-Prompt kopieren and "…", all alike. The
    "…" menu is the second group of the job's menu (actions.ts jobMenu, the row's right click
    shows it too, its tools the moves): for an excluded job "Trotzdem bewerten" or "Wieder
    ausschließen", then the moves of the place (Eingang Archivieren, Löschen; Archiv
    Dearchivieren, Löschen; Papierkorb Wiederherstellen, Endgültig löschen). A job that just
    moved away offers none while the next one loads. Moving the job away from one of the
    reader's buttons hands the focus to the same button of the next job. Every result and every
    failure is a toast.
  - details: "Jobdetails", the rows of terms.ts in the order and with the icons of the facts
    table (lib/facts.ts): the ad's value ("/" where it says nothing; for an ad the app never
    read only what it knows) and the verdict as an icon whose tooltip is the reason that
    decided it.
  - requirements: "Anforderungen" in the groups of reader-sections.ts, a quiet count after
    each title; a missing must that is a term has a small "+" into the profile
    (addToProfile.ts).
  - ad: the note on a text that is not all there (a preview, an ad still to come or being
    loaded, one the app cannot reach, gone or closed) with "Anzeige laden" or "Anmeldung
    einrichten" where they help, and the ad as plain text.
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
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Icon from '$components/Icon.svelte';
  import Notice from '$components/Notice.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import ScoreRing, { ringState } from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';
  import { displayTitle, formatDay } from '$lib/i18n/format';
  import { errorText, noteText, reasonText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { JobDetail, OpenTarget, Reason } from '$lib/ipc/types';
  import { PORTAL_MONOGRAM } from '$lib/ipc/types/portals';
  import { placeOf } from '$lib/place';
  import { app } from '$lib/state/app.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { addTerm, isAdded } from './addToProfile';
  import { copyJobPrompt } from './prompt';
  import { guarded, jobMenu, move, purge, seen, type MoveId } from './actions';
  import {
    READER_SECTIONS,
    REQUIREMENT_CODES,
    REQUIREMENT_GROUPS,
    addable,
    kindOf,
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
  /** A match to judge the rows by (without one they show the ad's side only). */
  const judged = $derived(withRing && match !== null);
  const ring = $derived(
    ringState(job.match, job.match === null && Boolean(app.state?.matchPending), job.detail.kind),
  );
  let article = $state<HTMLElement | null>(null);

  const all = $derived(match?.reasons ?? []);
  const criteria = $derived(match?.criteria ?? []);

  /** The head: company and place (without the work mode a portal appends), the portals. */
  const company = $derived(job.company.trim());
  const place = $derived(placeOf(job.location));
  const day = $derived(formatDay(job.mailDate ?? job.firstSeenAt));
  const portals = $derived([job.portal, ...job.alsoOn.filter((other) => other !== job.portal)]);

  const excluded = $derived((match?.status ?? job.match?.status) === 'excluded');
  /** Why the engine excludes the job, in one sentence: its first violation, else the note. */
  const exclusion = $derived.by((): string => {
    for (const reason of all) {
      const text = reason.kind === 'violation' ? reasonText(reason) : '';
      if (text !== '') return text;
    }
    return noteText(job.match?.note ?? match?.summary ?? null) ?? t.reader.note.hardCriterion;
  });
  const band = $derived(
    ring.status === 'scored' || ring.status === 'provisional' ? ring.band : null,
  );

  /** The rows of the Jobdetails (terms.ts); for an ad the app never read only what it knows
   *  (what the ad says is not known yet, no "/" claims it says nothing). */
  const rows = $derived(
    termRows({
      job,
      reasons: all,
      criteria,
      withVerdict: judged,
      textLength: detail.text?.length ?? 0,
    }).filter((row) => detail.text !== null || !row.missing),
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

  const detailKind = $derived(job.detail.kind);
  const portalState = $derived(app.state?.portals.find((p) => p.portal === job.portal) ?? null);
  type AdNote = keyof typeof t.reader.adNote;
  /** Why the ad's text is not all there, if it is not. */
  const adNote = $derived.by((): AdNote | null => {
    switch (detailKind) {
      case 'ok':
        return job.closed ? 'closed' : null;
      case 'teaser':
      case 'gone':
      case 'unfetchable':
        return detailKind;
      default:
        // Still to come, failed or on request: being loaded while a fetch runs.
        return run.fetching ? 'loading' : 'missing';
    }
  });
  /** A preview or a missing ad the portal can load now (a preview only with its sign-in). */
  const canLoad = $derived(
    portalState?.enabled === true &&
      (adNote === 'missing' || (adNote === 'teaser' && portalState.loginEnabled)),
  );
  /** The portal shows only a preview without a sign-in that is not set up. */
  const signInMissing = $derived(
    adNote === 'teaser' && portalState !== null && !portalState.loginEnabled,
  );

  /** Why the prompt cannot work yet (no profile to assess against, no text of the ad). */
  const promptOff = $derived(
    !app.hasProfile ? t.reader.promptNoProfile : detail.text ? null : t.reader.promptNoText,
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

  /** A missing must into the profile; a failure is a toast. */
  async function add(term: string): Promise<void> {
    fail(await addTerm(term));
  }

  /** The "…" menu: what changes the job, from the one table of the job's menu (the row's
   *  right click shows the same); a move hands the focus on. */
  function moreEntries(): MenuEntry[] {
    return jobMenu(job, { changesOnly: true, move: act, purge: askPurge, report: fail });
  }

  /** The action row stays one line: where the labels do not fit, the three buttons are icons
   *  (their tooltips name them). Tried again whenever the row's width changes (before the
   *  frame is painted). */
  let actions = $state<HTMLElement | null>(null);
  let iconsOnly = $state(false);

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
    for (const icons of [false, true]) {
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

  /** "Anmeldung einrichten": Einstellungen at the card of this portal. */
  function setUpSignIn(): void {
    navigation.focusPortal = job.portal;
    navigation.go('settings');
  }
</script>

{#snippet head()}
  <header class="head">
    <div class="title-line">
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
    </div>
    {#if company !== '' || place !== ''}
      <p class="where" data-testid="reader-where">
        {#if company !== ''}
          <span class="fact" data-testid="reader-company"
            ><Icon name="company" size="sm" /><span data-copy>{company}</span></span
          >
        {/if}
        {#if place !== ''}
          <span class="fact" data-testid="reader-place"
            ><Icon name="place" size="sm" /><span data-copy>{place}</span></span
          >
        {/if}
      </p>
    {/if}
    <p class="source" data-testid="reader-source">
      {#each portals as portal, index (portal)}
        <span class="fact" data-testid="reader-portal-{portal}"
          ><span class="tile" aria-hidden="true">{PORTAL_MONOGRAM[portal]}</span><span
            >{t.portal[portal]}{#if index === 0 && day !== ''}, {day}{/if}</span
          ></span
        >
      {/each}
    </p>
  </header>
{/snippet}

{#snippet score()}
  {#if withRing}
    <div class="match" data-testid="reader-match">
      {#if excluded}
        <span class="ban" data-testid="reader-ban"><Icon name="excluded" size="lg" /></span>
        <div class="lines">
          <p class="band" data-testid="band">{t.score.excluded}</p>
          <p class="why-line" data-testid="exclusion">{exclusion}</p>
        </div>
      {:else}
        <ScoreRing {ring} size="md" animate={keyOf(job.key)} testid="reader-ring" />
        <p class="band {band ?? 'none'}" data-testid="band">
          {band ? t.score.band[band] : t.score.none}
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet actionRow()}
  <div class="actions" bind:this={actions} data-testid="reader-actions">
    <Button
      variant="secondary"
      size="field"
      icon="alertMail"
      label={t.reader.mail}
      iconOnly={iconsOnly}
      disabled={detail.mail.gmailUrl === null}
      disabledReason={t.reader.noMail}
      testid="reader-mail"
      onclick={() => openTarget({ kind: 'gmail', key: job.key })}
    />
    <Button
      variant="secondary"
      size="field"
      icon="external"
      label={t.reader.open}
      iconOnly={iconsOnly}
      testid="open-ad"
      onclick={() => openTarget({ kind: 'jobUrl', key: job.key })}
    />
    <Button
      variant="secondary"
      size="field"
      icon="prompt"
      label={t.reader.prompt}
      iconOnly={iconsOnly}
      disabled={promptOff !== null}
      disabledReason={promptOff}
      testid="reader-prompt"
      onclick={() => void copyJobPrompt(job.key).then(fail)}
    />
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
    <ul class="terms" class:judged aria-label={t.reader.details} data-testid="criteria">
      {#each rows as row (row.key)}
        <li class="term" data-row={row.key} data-testid="term-{row.key}">
          <span class="term-name"><Icon name={row.icon} size="sm" />{row.name}</span>
          <span class="term-line">
            <span class="value" class:missing={row.missing} data-copy={row.missing ? null : ''}
              >{row.value}</span
            >
            {#if row.note}<span class="term-note">{row.note}</span>{/if}
          </span>
          {#if judged}
            <span class="verdict" data-testid="verdict" data-verdict={row.verdict ?? ''}>
              {#if row.verdict}
                <ReasonItem
                  iconOnly
                  kind={kindOf(row.verdict)}
                  label={t.reader.verdict[row.verdict]}
                  hint={row.why}
                />
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#snippet requirements()}
  {#if match && match.status !== 'unscorable' && withRing}
    <section class="block why" data-testid="why">
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
                {@const words = reasonText(reason)}
                <li class="reason-line" data-weight={reason.weight}>
                  <ReasonItem
                    kind={reason.kind}
                    weight={reason.weight === 'nice' ? 'nice' : null}
                    label={words}
                  />
                  <!-- A missing must that is a term: its way into the profile, then that it
                       is there. -->
                  {#if addable(reason)}
                    <span class="reason-action">
                      {#if isAdded(words)}
                        <span class="added" data-testid="added">{t.reader.added}</span>
                      {:else}
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          icon="add"
                          label={t.reader.addToProfile}
                          testid="add-to-profile"
                          onclick={() => void add(words)}
                        />
                      {/if}
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
    {#if adNote !== null}
      <div class="missing">
        <Notice
          tone={adNote === 'unfetchable' || adNote === 'gone' ? 'warning' : 'info'}
          variant="inline"
          text={t.reader.adNote[adNote]}
          testid="detail-note"
        />
        {#if signInMissing}
          <Button
            variant="secondary"
            size="sm"
            icon="signIn"
            label={t.reader.setUpSignIn}
            testid="set-up-sign-in"
            onclick={setUpSignIn}
          />
        {:else if canLoad}
          <Button
            variant="secondary"
            size="sm"
            icon="details"
            label={t.reader.fetchDetails}
            disabled={run.detailsBlocked !== null}
            disabledReason={run.detailsBlocked}
            testid="load-ad"
            onclick={() => void run.start({ kind: 'details', keys: [job.key] })}
          />
        {/if}
      </div>
    {:else if job.short}
      <Notice tone="info" variant="inline" text={t.reader.short} testid="short-note" />
    {/if}
    {#if detail.text}
      <div class="text" data-testid="ad-text" data-copy>{detail.text}</div>
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
  heading={t.actions.purgeHeading(1)}
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
    flex-direction: column;
    gap: var(--space-8);
  }

  .title-line {
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

  /* Company and place, the portals: each fact after its icon, a line breaks between facts. */
  .where,
  .source {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-16);
  }

  .where {
    color: var(--text);
    font: var(--type-md);
  }

  .source {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .fact {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  .where :global(.icon) {
    color: var(--text-subtle);
  }

  /* The portal's small tile, as in the list row. */
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: var(--portal-tile);
    padding: 0 var(--space-4);
    border-radius: var(--radius-xs);
    background-color: var(--surface-track);
    color: var(--text-muted);
    font: var(--type-2xs);
    font-weight: var(--weight-semibold);
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

  .ban {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--ring-md);
    height: var(--ring-md);
    color: var(--score-excluded);
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

  /* The note on a text that is not all there, and the way to it. */
  .missing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
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

  /* The Jobdetails: name, value and verdict in three columns that line up row by row (two
     without a match: nothing to judge); the verdicts stand right after the widest value. */
  .terms {
    display: grid;
    grid-template-columns: max-content minmax(0, max-content);
    gap: var(--space-8) var(--space-24);
    align-items: center;
    justify-content: start;
    justify-items: start;
    font: var(--type-sm);
    text-align: start;
  }

  .terms.judged {
    grid-template-columns: max-content minmax(0, max-content) max-content;
  }

  .term {
    display: contents;
  }

  .term-name {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .term-name :global(.icon) {
    color: var(--text-subtle);
  }

  .term-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .value {
    color: var(--text);
  }

  .value.missing,
  .term-note {
    color: var(--text-subtle);
  }

  .verdict {
    display: inline-flex;
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

  .added {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-md);
  }

  /* The ad as it reads (no HTML from the page ever reaches the DOM). */
  .text {
    color: var(--text);
    font: var(--type-body);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
</style>
