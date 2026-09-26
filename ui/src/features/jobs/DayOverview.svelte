<!--
  The Übersicht (a place of its own, where the app starts): what is new since the last fetch
  (three counts that lead into the list, the time, Abrufen), the best new jobs to look at
  today, the favourites, what needs a decision (jobs without their full ad, excluded ones),
  the open points and the files. Each block shows only with content; a click on a job opens
  it in Jobs. Former notes below (the day overview beside the list): It answers "what now" in a short list, no counts (the list header counts): "Neu
  und passend" with the prompt of the best matches for any AI chat at the end of its heading
  (the three best scored new jobs as list rows with the list's tools, a click opens the
  job; only where the list beside does not show them on top already, else one quiet line;
  with no new match the prompt stands on its own line, as long as there is something to
  compare), the open points (one per enabled portal and problem, a failed fetch, each with
  its fitting action like the run card's; a warning only where she has to act, else a calm
  note in the words of Einstellungen) only when there are any, and at the end the overview
  file, the Excel file and the folder, their one place in the Jobs view (a file that is not
  there yet cannot be opened and says why). "Nothing new" is said by the list and the run
  card, not here. The time of the last fetch is said once, in the sidebar. The portals keep
  the one order of the app (the settings').
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import JobRow, { type RowTool } from '$components/JobRow.svelte';
  import Notice from '$components/Notice.svelte';
  import StatTile from '$components/StatTile.svelte';
  import Icon from '$components/Icon.svelte';
  import ListRow from '$components/ListRow.svelte';
  import { displayTitle, formatEuro, formatMoment, formatRelative } from '$lib/i18n/format';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { errorText, healthAdvice } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type {
    EmptyAlert,
    JobView,
    OpenTarget,
    OverviewStats,
    Portal,
    PortalState,
  } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { jobs, keyOf, sameKey } from '$lib/state/jobs.svelte';
  import { failureAction, run } from '$lib/state/run.svelte';
  import { actionsOf, guarded, move, toggleStar } from './actions';
  import { addToProfile, isAdded } from './addToProfile';
  import { copyTopPrompt } from './prompt';

  // The one order of the portals (the backend's, as in the settings); a portal switched off
  // has no open points.
  const portals = $derived(
    (app.state?.portals ?? []).filter((p) => p.enabled).map((p) => p.portal),
  );
  const BEST = 5;
  const FAVOURITES = 5;
  /** The best scored new jobs (one small query; again whenever the counts move). */
  let top = $state.raw<JobView[]>([]);
  let topRequest = 0;
  /** The best matches did not load: a quiet retry in their place. */
  let topError = $state<string | null>(null);

  function loadTop(): void {
    const request = ++topRequest;
    if (!app.hasProfile) {
      top = [];
      topError = null;
      return;
    }
    // Only scored jobs: by match the jobs still without a score come first (store::job_page),
    // and they would take the places of the best.
    invoke('list_jobs', {
      query: {
        place: 'inbox',
        unread: true,
        favourites: false,
        sort: 'match',
        search: null,
        portal: null,
        minBand: 'low',
        applied: false,
        limit: BEST,
        offset: 0,
      },
    })
      .then((page) => {
        if (request !== topRequest) return;
        top = page.jobs;
        topError = null;
      })
      .catch((error: unknown) => {
        if (request === topRequest) topError = errorText(error);
      });
  }

  /** The favourites of the inbox, newest first (one small query, like the best). */
  let saved = $state.raw<JobView[]>([]);
  function loadSaved(): void {
    invoke('list_jobs', {
      query: {
        place: 'inbox',
        unread: false,
        favourites: true,
        sort: 'newest',
        search: null,
        portal: null,
        minBand: null,
        applied: false,
        limit: FAVOURITES,
        offset: 0,
      },
    })
      .then((page) => (saved = page.jobs))
      .catch(() => (saved = []));
  }

  /** The jobs marked "Beworben" in the inbox, newest first. */
  const APPLIED = 5;
  let appliedRows = $state.raw<JobView[]>([]);
  function loadApplied(): void {
    invoke('list_jobs', {
      query: {
        place: 'inbox',
        unread: false,
        favourites: false,
        sort: 'newest',
        search: null,
        portal: null,
        minBand: null,
        applied: true,
        limit: APPLIED,
        offset: 0,
      },
    })
      .then((page) => (appliedRows = page.jobs))
      .catch(() => (appliedRows = []));
  }

  /** The open musts, the market and the portals' last alert mails (one call). */
  let stats = $state.raw<OverviewStats | null>(null);
  function loadStats(): void {
    invoke('overview_stats', {})
      .then((next) => (stats = next))
      .catch(() => (stats = null));
  }

  $effect(() => {
    void jobs.overviewCounts;
    void app.hasProfile;
    void app.state?.profile?.savedAt;
    untrack(loadTop);
    untrack(loadSaved);
    untrack(loadApplied);
    untrack(loadStats);
  });
  /** Whole days since a moment, by the calendar (0 = today). */
  function daysSince(iso: string): number {
    const day = (date: Date): number =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return Math.max(0, Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000));
  }
  /** Company · Beworben vor 3 Tagen. */
  function appliedLine(job: JobView): string {
    const when = job.appliedAt === null ? null : t.overview.appliedWhen(daysSince(job.appliedAt));
    return [job.company, when].filter(Boolean).join(' · ');
  }
  const applied = $derived(
    appliedRows.map((job) => jobs.rows.find((row) => sameKey(row.key, job.key)) ?? job),
  );

  // The market: new jobs per portal this week, the median day rate of fitting jobs beside
  // the profile's minimum, the share of mostly remote jobs.
  const market = $derived(stats?.market ?? null);
  const newThisWeek = $derived(
    (market?.newByPortal ?? []).filter((p) => portals.includes(p.portal)),
  );
  const minRate = $derived(app.state?.profile?.form?.criteria.minDayRate ?? null);
  const rateLine = $derived(
    market?.medianDayRate == null
      ? ''
      : [
          t.overview.marketRateValue(formatEuro(market.medianDayRate), market.rateCount),
          minRate === null ? null : t.overview.marketMin(formatEuro(minRate)),
        ]
          .filter(Boolean)
          .join(' · '),
  );
  const showMarket = $derived(
    market !== null &&
      (newThisWeek.some((p) => p.count > 0) ||
        market.medianDayRate !== null ||
        market.remoteShare !== null),
  );
  const favourites = $derived(
    saved.map((job) => jobs.rows.find((row) => sameKey(row.key, job.key)) ?? job),
  );

  /** Into the list: the view first (an unsaved Profil may ask), then the tab and order. */
  function toList(facet: 'new' | 'all', sort: 'match' | 'newest' | null = null): void {
    navigation.go('jobs', false, () => {
      if (jobs.facet !== facet) jobs.setFacet(facet, true);
      if (sort !== null && app.hasProfile && jobs.sortChoice !== sort) jobs.setSort(sort);
    });
  }

  /** "Details holen" for every inbox job without its full ad: the keys of one page. */
  async function fetchMissing(): Promise<void> {
    try {
      const page = await invoke('list_jobs', {
        query: {
          place: 'inbox',
          unread: false,
          favourites: false,
          sort: 'newest',
          search: null,
          portal: null,
          minBand: null,
          applied: false,
          limit: 500,
          offset: 0,
        },
      });
      const keys = page.jobs.filter((job) => job.detail.kind !== 'ok').map((job) => job.key);
      if (keys.length > 0) await run.start({ kind: 'details', keys });
    } catch (error) {
      actionError = errorText(error);
    }
  }
  const lastFetch = $derived(run.summary?.finishedAt ?? app.state?.lastRun?.finishedAt ?? null);
  // As the list knows them now (read, pinned); only scored ones are a match.
  const best = $derived(
    top
      .map((job) => jobs.rows.find((row) => sameKey(row.key, job.key)) ?? job)
      .filter((job) => job.match?.status === 'scored'),
  );

  // While a run goes, the run card shows pauses and limits; they are not repeated here.
  const troubled = $derived(
    run.fetching
      ? []
      : (app.state?.portals ?? []).filter((p) => p.enabled && p.health.kind !== 'ok'),
  );
  const emptyAlerts = $derived(app.state?.lastRun?.emptyAlerts ?? []);

  interface Issue {
    id: string;
    portal: Portal;
    text: string;
    /** An alert mail to open in Gmail. */
    mail: string | null;
    /** She has to act (a warning); else it resolves itself (a calm note, as in Einstellungen). */
    act: boolean;
  }

  /**
   * Each problem of a portal once: alert mails without jobs (the portal's "layout suspect"
   * health and the empty alerts of the last fetch are one thing) with "Alert-Mail öffnen", and
   * a pause, a limit or a sign-in as its own line, in the words of the settings.
   */
  function issuesOf(portal: Portal, state: PortalState | undefined, alerts: EmptyAlert[]): Issue[] {
    const out: Issue[] = [];
    const health = state?.health ?? null;
    const suspect = health?.kind === 'layoutSuspect' ? health : null;
    const mails = Math.max(alerts.length, suspect?.emptyMails ?? 0);
    if (mails > 0) {
      out.push({
        id: `${portal}-mails`,
        portal,
        text: t.overview.emptyAlerts(mails),
        mail: alerts.find((a) => a.gmailId !== null)?.gmailId ?? null,
        act: true,
      });
    } else if (suspect !== null) {
      out.push({
        id: `${portal}-pages`,
        portal,
        text: healthAdvice(suspect) ?? '',
        mail: null,
        act: false,
      });
    }
    if (health !== null && health.kind !== 'ok' && suspect === null) {
      out.push({
        id: `${portal}-health`,
        portal,
        text: healthAdvice(health) ?? '',
        mail: null,
        act: state?.actionNeeded ?? false,
      });
    }
    return out;
  }

  const portalIssues = $derived(
    portals.flatMap((portal) =>
      issuesOf(
        portal,
        troubled.find((p) => p.portal === portal),
        emptyAlerts.filter((a) => a.portal === portal),
      ),
    ),
  );
  // The last fetch failed; while the run card is up it speaks, not this.
  const lastFailure = $derived.by(() => {
    const previous = app.state?.lastRun ?? null;
    if (run.fetching || run.panel !== 'hidden' || previous?.outcome.kind !== 'failed') {
      return null;
    }
    return previous.outcome.error;
  });
  // Portals whose alert mails stopped for a week (only once a fetch has read the mailbox,
  // and not twice for a portal that has an open point already).
  const quiet = $derived(
    (run.summary ?? app.state?.lastRun ?? null) === null
      ? []
      : (stats?.quietPortals ?? []).filter(
          (p) => p.quiet && !portalIssues.some((issue) => issue.portal === p.portal),
        ),
  );
  const hasIssues = $derived(portalIssues.length > 0 || lastFailure !== null || quiet.length > 0);
  const fetchedOnce = $derived((run.summary ?? app.state?.lastRun ?? null) !== null);
  let actionError = $state<string | null>(null);

  function open(target: OpenTarget): void {
    actionError = null;
    invoke('open_target', { target }).catch((error: unknown) => (actionError = errorText(error)));
  }

  /** The last fetch failed: the fitting way on, as the run card has it. */
  const failureFix = $derived(
    lastFailure === null
      ? null
      : failureAction(app.state?.lastRun ?? null, lastFailure, () => open({ kind: 'logDir' })),
  );

  /** The comparison prompt takes the favourites first, then the best scored jobs of the
   *  inbox, read or not: it is there as long as there is something to compare. */
  const counts = $derived(jobs.overviewCounts);
  const canCompare = $derived(
    app.hasProfile && counts !== null && (counts.favourites > 0 || counts.inbox > counts.excluded),
  );
  /** Jobs without their full ad to decide on: the demo never fetches, so it asks nothing. */
  const noDetail = $derived(app.state?.demo ? 0 : (counts?.noDetail ?? 0));

  /** A best row's tools, like the list's: the inbox's actions, then the star. */
  function toolsOf(job: JobView): RowTool[] {
    return actionsOf('inbox').map((action) => ({
      id: action.id,
      icon: action.icon,
      label: action.label,
      onclick: () => {
        if (action.id === 'archive' || action.id === 'trash') {
          actionError = null;
          void move([job], action.id).then((error) => (actionError = error));
        }
      },
    }));
  }

  function pin(job: JobView): void {
    if (!guarded()) toggleStar([job]);
  }

  // The files: the HTML overview is written with the Excel file by every export, and opening
  // it writes it first, except in the dry run and while a run holds the files.
  const settings = $derived(app.state?.settings ?? null);
  const dryRun = $derived(app.state?.dryRun ?? false);
  const noFiles = $derived(settings !== null && !settings.excelExists);
  const dryRunReason = $derived(t.error.text('dryRun', {}));
</script>

{#snippet comparePrompt()}
  <span class="with-hint" use:tooltip={t.overview.promptTopHint}>
    <Button
      variant="ghost"
      size="sm"
      icon="copy"
      label={t.overview.promptTop}
      testid="prompt-top"
      onclick={() => void copyTopPrompt().then((error) => (actionError = error))}
    />
  </span>
{/snippet}

<div class="overview" data-testid="day-overview" aria-label={t.overview.label}>
  {#if counts !== null}
    <section class="block" data-testid="since">
      <div class="heading-line first" data-first-row>
        <h2 class="heading">{t.overview.since}</h2>
        <span class="heading-action">
          <Button
            variant={app.hasMailbox && app.hasPortal ? 'primary' : 'secondary'}
            size="sm"
            icon="refresh-cw"
            label={t.toolbar.fetch}
            disabled={run.fetchBlocked !== null}
            disabledReason={run.fetchBlocked}
            loading={run.fetching}
            testid="overview-fetch"
            onclick={() => void run.start({ kind: 'fetch' })}
          />
        </span>
      </div>
      <div class="tiles">
        <StatTile
          label={t.overview.tileNew}
          value={counts.unread}
          tone="coral"
          testid="tile-new"
          onclick={() => toList('new')}
        />
        {#if app.hasProfile}
          <StatTile
            label={t.overview.tileHigh}
            value={counts.high}
            tone="success"
            testid="tile-high"
            onclick={() => toList('new', 'match')}
          />
          <StatTile
            label={t.overview.tileExcluded}
            value={counts.excluded}
            testid="tile-excluded"
            onclick={() => toList('all')}
          />
        {/if}
      </div>
      {#if lastFetch}<p class="quiet" data-testid="since-when">
          {t.overview.fetchedAt(formatMoment(lastFetch))}
        </p>{/if}
    </section>
  {/if}
  {#if topError && jobs.status !== 'error'}
    <section class="block" data-testid="best-error">
      <Notice
        tone="warning"
        variant="row"
        text={topError}
        action={{ label: t.common.retry, icon: 'refresh-cw', onclick: loadTop }}
      />
    </section>
  {:else if best.length > 0}
    <section class="block" data-testid="best">
      <div class="heading-line">
        <h2 class="heading">{t.overview.today}</h2>
        {#if canCompare}<span class="heading-action">{@render comparePrompt()}</span>{/if}
      </div>
      <div class="best">
        {#each best as job (keyOf(job.key))}
          <JobRow
            {job}
            testid="best-{job.key.portal}-{job.key.id}"
            onselect={(chosen) =>
              navigation.go('jobs', false, () => void jobs.select(chosen, true))}
            onpin={pin}
            tools={toolsOf(job)}
          />
        {/each}
      </div>
      {#if counts !== null && counts.unread > best.length}
        <span class="more"
          ><Button
            variant="link"
            size="sm"
            label={t.overview.allNew(counts.unread)}
            testid="overview-all-new"
            onclick={() => toList('new', 'match')}
          /></span
        >
      {/if}
    </section>
  {/if}

  {#if favourites.length > 0}
    <section class="block" data-testid="favourites">
      <h2 class="heading">{t.overview.favourites}</h2>
      <div class="best">
        {#each favourites as job (keyOf(job.key))}
          <JobRow
            {job}
            testid="favourite-{job.key.portal}-{job.key.id}"
            onselect={(chosen) =>
              navigation.go('jobs', false, () => void jobs.select(chosen, true))}
            onpin={pin}
            tools={toolsOf(job)}
          />
        {/each}
      </div>
    </section>
  {/if}

  {#if applied.length > 0}
    <section class="block" data-testid="applied">
      <h2 class="heading">{t.overview.applied}</h2>
      <div class="best applied">
        {#each applied as job (keyOf(job.key))}
          <ListRow
            testid="applied-{job.key.portal}-{job.key.id}"
            onclick={() => navigation.go('jobs', false, () => void jobs.select(job, true))}
          >
            {#snippet leading()}<span class="applied-icon"><Icon name="send" size="sm" /></span
              >{/snippet}
            <span class="applied-title">{displayTitle(job.title)}</span>
            <span class="quiet">{appliedLine(job)}</span>
            {#if job.closed}<span class="closed">{t.overview.adClosed}</span>{/if}
            {#if job.note}<span class="note" data-copy>{job.note}</span>{/if}
          </ListRow>
        {/each}
      </div>
    </section>
  {/if}

  {#if app.hasProfile && (stats?.openMusts.length ?? 0) > 0}
    <section class="block" data-testid="open-musts">
      <h2 class="heading">{t.overview.openMusts}</h2>
      <div class="rows">
        {#each stats?.openMusts ?? [] as must (must.label)}
          <div class="must" data-testid="open-must">
            <span class="must-text"
              ><span class="must-label" data-copy>{must.label}</span>
              <span class="quiet">{t.overview.inJobs(must.count)}</span></span
            >
            {#if isAdded(must.label)}
              <span class="quiet" data-testid="added-must">{t.reader.added}</span>
            {:else}
              <Button
                variant="secondary"
                size="sm"
                icon="plus"
                label={t.overview.addToProfile}
                testid="add-must"
                onclick={() => addToProfile(must.label)}
              />
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if counts !== null && (noDetail > 0 || (app.hasProfile && counts.excluded > 0))}
    <section class="block" data-testid="decide">
      <h2 class="heading">{t.overview.decide}</h2>
      <div class="rows">
        {#if noDetail > 0}
          <Notice
            tone="info"
            variant="row"
            text={t.overview.noDetail(noDetail)}
            action={{
              label: t.overview.fetchDetails,
              icon: 'download',
              onclick: () => void fetchMissing(),
            }}
            testid="decide-details"
          />
        {/if}
        {#if app.hasProfile && counts.excluded > 0}
          <Notice
            tone="info"
            variant="row"
            text={t.overview.excludedCheck(counts.excluded)}
            action={{ label: t.overview.look, icon: 'ban', onclick: () => toList('all') }}
            testid="decide-excluded"
          />
        {/if}
      </div>
    </section>
  {/if}

  {#if hasIssues}
    <section class="block" data-testid="issues">
      <h2 class="heading">{t.overview.issues}</h2>
      <div class="rows">
        {#if lastFailure}
          <Notice
            tone="danger"
            variant="row"
            heading={t.overview.lastRun}
            text={t.error.text(lastFailure.kind, lastFailure.params)}
            action={failureFix}
            testid="run-failed"
          />
        {/if}
        {#each portalIssues as issue (issue.id)}
          <Notice
            tone={issue.act ? 'warning' : 'info'}
            variant="row"
            heading={t.portal[issue.portal]}
            text={issue.text}
            action={issue.mail
              ? {
                  label: t.reader.mail,
                  icon: 'mail',
                  onclick: () => open({ kind: 'alertMail', gmailId: issue.mail ?? '' }),
                }
              : null}
            testid="issue-{issue.id}"
          />
        {/each}
        {#each quiet as portal (portal.portal)}
          <Notice
            tone="info"
            variant="row"
            heading={t.portal[portal.portal]}
            text={portal.lastAlert
              ? t.overview.quietSince(formatRelative(portal.lastAlert))
              : t.overview.quietNever}
            testid="quiet-{portal.portal}"
          />
        {/each}
      </div>
    </section>
  {/if}

  <!-- Nothing new to show: the comparison of the best jobs stays within reach. -->
  {#if canCompare && best.length === 0 && !topError}
    <div class="block" data-testid="compare">
      <span class="compare">{@render comparePrompt()}</span>
    </div>
  {/if}

  {#if showMarket && market !== null}
    <section class="block" data-testid="market">
      <h2 class="heading">{t.overview.market}</h2>
      <dl class="terms">
        {#if newThisWeek.some((p) => p.count > 0)}
          <dt>{t.overview.marketNew}</dt>
          <dd data-testid="market-new">
            {newThisWeek.map((p) => `${t.portal[p.portal]} ${p.count}`).join(' · ')}
          </dd>
        {/if}
        {#if market.medianDayRate !== null}
          <dt>{t.overview.marketRate}</dt>
          <dd data-testid="market-rate">
            {rateLine}
          </dd>
        {/if}
        {#if market.remoteShare !== null}
          <dt>{t.overview.marketRemote}</dt>
          <dd data-testid="market-remote">
            {t.overview.marketRemoteValue(market.remoteShare, market.remoteKnown)}
          </dd>
        {/if}
      </dl>
    </section>
  {/if}

  {#if fetchedOnce}
    <section class="block" data-testid="files">
      <h2 class="heading">{t.overview.files}</h2>
      <div class="files" data-testid="overview-files">
        <Button
          variant="ghost"
          size="sm"
          icon="globe"
          label={t.run.openOverview}
          disabled={noFiles && (dryRun || run.active)}
          disabledReason={dryRun ? dryRunReason : run.busyText}
          testid="overview-open"
          onclick={() => open({ kind: 'overview' })}
        />
        <Button
          variant="ghost"
          size="sm"
          icon="file-spreadsheet"
          label={t.overview.excel}
          disabled={noFiles}
          disabledReason={dryRun ? dryRunReason : t.settings.excelMissing}
          testid="overview-excel"
          onclick={() => open({ kind: 'excel' })}
        />
        <Button
          variant="ghost"
          size="sm"
          icon="folder-open"
          label={t.common.openFolder}
          testid="overview-folder"
          onclick={() => open({ kind: 'excelInFolder' })}
        />
      </div>
    </section>
  {/if}
  {#if actionError}
    <Notice tone="danger" variant="inline" text={actionError} />
  {/if}
</div>

<style>
  /* Sections in the rhythm of the reader's: 20 px above a hairline, 16 below a heading. */
  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
    container-type: inline-size;
  }

  /* The rows of "Beste Passung" like the list's: their ring on the edge of the column; the
     last row's own line gives way to the hairline of the next block. */
  .best {
    --row-rule-inset: var(--pane-padding);

    display: flex;
    flex-direction: column;
    margin: 0 calc(-1 * var(--pane-padding));
    clip-path: inset(0 0 var(--border-width) 0);
  }

  /* Sections like the reader's: a hairline above, the heading, the content (the first one
     starts the overview without a line). */
  .overview > .block:first-child {
    padding-top: 0;
    border-top: 0;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    padding-top: var(--space-20);
    border-top: var(--border-width) solid var(--border);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--tile-min), 1fr));
    gap: var(--space-12);
  }

  .more {
    display: flex;
  }

  /* A heading with its one action at the end (the prompt of the best matches); the button
     is centred on the heading's line and adds no height, so the heading starts where the
     reader's title does. */
  .heading-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-12);
    margin-right: calc(-1 * var(--ghost-inset));
  }

  /* The Übersicht's first line: heading and Abrufen centred in the window's first row. */
  .heading-line.first {
    align-items: center;
  }

  .heading-action {
    display: flex;
    margin-block: calc((var(--leading-lg) - var(--control-sm)) / 2);
  }

  .with-hint {
    display: inline-flex;
  }

  /* The comparison on its own, above the files (a block of its own, not an open point);
     its icon on the edge of the column. */
  .compare {
    display: flex;
    margin-left: calc(-1 * var(--ghost-inset));
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* Nothing else to say: a quiet line like a mail app's empty reader, the file actions below. */

  /* Quiet file actions below everything; their icons start on the edge of the column (the
     buttons' padding and border hang out). */
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-left: calc(-1 * var(--ghost-inset));
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  /* Applied rows are as tall as their lines (a note makes three). */
  .applied {
    --row-height: 0;
  }

  .applied-icon {
    display: flex;
    align-items: center;
    height: var(--leading-md);
    color: var(--text-heading);
  }

  .applied-title {
    overflow: hidden;
    font: var(--type-title);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .closed {
    color: var(--danger-fg);
    font: var(--type-sm);
  }

  .note {
    overflow: hidden;
    font: var(--type-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* An open must: its words and how often, the action at the end of the row. */
  .must {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .must-text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
  }

  .must-label {
    font: var(--type-md);
  }

  /* The market like the reader's terms: the name, its value. */
  .terms {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-8) var(--space-16);
    margin: 0;
    font: var(--type-md);
  }

  .terms dt {
    color: var(--text-muted);
  }

  .terms dd {
    margin: 0;
  }

  /* Rows apart by a hairline with room on both sides; the block's own gap and the next
     hairline frame the first and the last. */
  .rows > :global(*) {
    padding: var(--space-12) 0;
  }

  .rows > :global(:first-child) {
    padding-top: 0;
  }

  .rows > :global(:last-child) {
    padding-bottom: 0;
  }

  .rows > :global(* + *) {
    border-top: var(--border-width) solid var(--border);
  }
</style>
