// The Übersicht's data, for its blocks (blocks.ts): what it loads itself (the best unopened
// jobs, the favourites, its numbers from `overview_stats`) and what follows from them and
// from the app's state: the open points in their order, the failure of the last fetch, what
// can be compared. One instance; the page loads it again whenever the counts move. The
// blocks only render what this says; a rule of the Übersicht lives here once.

import type { IconName } from '$components/Icon.svelte';
import { t } from '$lib/i18n/t';
import { errorText, healthAdvice } from '$lib/i18n/texts';
import { formatRelative } from '$lib/i18n/format';
import { invoke } from '$lib/ipc/api';
import type {
  EmptyAlert,
  JobCounts,
  JobQuery,
  JobView,
  OpenTarget,
  OverviewStats,
  Portal,
  PortalState,
} from '$lib/ipc/types';
import { app } from '$lib/state/app.svelte';
import { jobs, sameKey } from '$lib/state/jobs.svelte';
import { navigation } from '$lib/state/navigation.svelte';
import { editor } from '$lib/state/profile.svelte';
import { failureAction, isFetch, run, type FailureAction } from '$lib/state/run.svelte';
import { detailsWanted } from '../jobs/actions';
import { toExcluded } from './lead';

/** How many jobs "Heute ansehen" and "Favoriten" show. */
export const BEST = 5;
export const FAVOURITES = 5;

/** The way on of an open point; resolves with the error to say at the block, or null. */
export interface PointAction {
  label: string;
  icon?: IconName;
  run: () => Promise<string | null>;
}

/** One open point: a row of "Offene Punkte". */
export interface Point {
  id: string;
  /** She has to act (a warning); else a calm note. */
  tone: 'info' | 'warning';
  heading: string | null;
  text: string;
  action: PointAction | null;
}

/** A query of the inbox (the list's `JobQuery`, one place for its fields). */
function inboxQuery(change: Partial<JobQuery>): JobQuery {
  return {
    place: 'inbox',
    unread: false,
    favourites: false,
    sort: 'newest',
    search: null,
    portal: null,
    minBand: null,
    applied: false,
    limit: 0,
    offset: 0,
    ...change,
  };
}

/** Open something outside the app; resolves with the error, or null. */
export function openTarget(target: OpenTarget): Promise<string | null> {
  return invoke('open_target', { target }).then(
    () => null,
    (error: unknown) => errorText(error),
  );
}

/** A job as the list knows it now (read, pinned), else as it came. */
function current(job: JobView): JobView {
  return jobs.rows.find((row) => sameKey(row.key, job.key)) ?? job;
}

class OverviewModel {
  /** The best scored unopened jobs of the inbox. */
  #top = $state.raw<JobView[]>([]);
  /** The favourites of the inbox, newest first (a few more than shown: the best ones go). */
  #saved = $state.raw<JobView[]>([]);
  #topFailed = $state(false);
  #savedFailed = $state(false);
  /** The open musts, the market, the portals' last alert mails, what the inbox leaves open. */
  stats = $state.raw<OverviewStats | null>(null);
  #topRequest = 0;
  #savedRequest = 0;
  #statsRequest = 0;

  /** Everything the page loads itself, again. */
  refresh(): void {
    this.#loadTop();
    this.#loadSaved();
    this.#loadStats();
  }

  /** "Erneut versuchen" after a query of the jobs failed: the counts too. */
  retry(): void {
    void jobs.loadOverview();
    this.refresh();
  }

  #loadTop(): void {
    const request = ++this.#topRequest;
    if (!app.hasProfile) {
      this.#top = [];
      this.#topFailed = false;
      return;
    }
    // Only scored jobs: by match the jobs still without a score come first (store::job_page),
    // and they would take the places of the best.
    invoke('list_jobs', {
      query: inboxQuery({ unread: true, sort: 'match', minBand: 'low', limit: BEST }),
    }).then(
      (page) => {
        if (request !== this.#topRequest) return;
        this.#top = page.jobs;
        this.#topFailed = false;
      },
      () => {
        if (request === this.#topRequest) this.#topFailed = true;
      },
    );
  }

  #loadSaved(): void {
    const request = ++this.#savedRequest;
    invoke('list_jobs', {
      query: inboxQuery({ favourites: true, limit: FAVOURITES + BEST }),
    }).then(
      (page) => {
        if (request !== this.#savedRequest) return;
        this.#saved = page.jobs;
        this.#savedFailed = false;
      },
      () => {
        if (request === this.#savedRequest) this.#savedFailed = true;
      },
    );
  }

  #loadStats(): void {
    const request = ++this.#statsRequest;
    invoke('overview_stats', {}).then(
      (next) => {
        if (request === this.#statsRequest) this.stats = next;
      },
      () => {
        if (request === this.#statsRequest) this.stats = null;
      },
    );
  }

  /** The counts over every job of the inbox (null until they are known). */
  get counts(): JobCounts | null {
    return jobs.overviewCounts;
  }

  /** A query of the jobs failed: "Heute ansehen" says so in its place, with a retry. */
  readonly failed = $derived(
    this.#topFailed || this.#savedFailed || jobs.overviewStatus === 'error',
  );

  /** "Heute ansehen": the best scored unopened jobs, as the list knows them now. */
  readonly best = $derived(
    this.#top.map(current).filter((job) => job.match?.status === 'scored' && job.unread),
  );

  /** "Favoriten": the favourites "Heute ansehen" does not show already (its star says it). */
  readonly favourites = $derived.by((): JobView[] => {
    const best = this.best;
    return this.#saved
      .map(current)
      .filter((job) => job.pinned && !best.some((row) => sameKey(row.key, job.key)))
      .slice(0, FAVOURITES);
  });

  /** Favourites neither block shows: "Alle n Favoriten" leads to them (0: none). */
  readonly moreFavourites = $derived.by((): number => {
    const all = this.counts?.favourites ?? 0;
    const shown = this.favourites.length + this.best.filter((job) => job.pinned).length;
    return all > shown ? all : 0;
  });

  /** The comparison prompt takes the favourites first, then the best scored jobs of the
   *  inbox, read or not: it is there as long as there is something to compare. */
  readonly canCompare = $derived(
    app.hasProfile &&
      this.counts !== null &&
      (this.counts.favourites > 0 || this.counts.inbox > this.counts.excluded),
  );

  /** The last fetch (of this session, else the stored one), or null. */
  get #lastFetch() {
    return run.summary ?? app.state?.lastRun ?? null;
  }

  /** A fetch has read the mailbox once: the files and the quiet portals mean something. */
  get fetchedOnce(): boolean {
    return this.#lastFetch !== null;
  }

  /**
   * What went wrong with the last fetch, under the tiles: a start that failed (Abrufen or
   * "Details holen"), else a last fetch that failed, with its fitting way on. Nothing while
   * a fetch or a details run goes; it goes when a fetch completes.
   */
  readonly failure = $derived.by(
    (): { heading: string | null; text: string; action: FailureAction | null } | null => {
      if (run.fetching) return null;
      const start = run.startError;
      if (start !== null) return { heading: null, text: start, action: null };
      const last = this.#lastFetch;
      if (last === null || !isFetch(last.kind) || last.outcome.kind !== 'failed') return null;
      const error = last.outcome.error;
      return {
        heading: t.overview.lastRun,
        text: t.error.text(error.kind, error.params),
        action: failureAction(last, error, () => void openTarget({ kind: 'logDir' })),
      };
    },
  );

  /** The enabled portals in the app's one order (a portal switched off has no open points). */
  readonly #portals = $derived(
    (app.state?.portals ?? []).filter((p) => p.enabled).map((p) => p.portal),
  );

  /**
   * Each problem of a portal once: alert mails without jobs (the portal's "layout suspect"
   * health and the empty alerts of the last fetch are one thing) with "Alert-Mail öffnen", and
   * a pause, a limit or a sign-in as its own point, in the words of the settings. While a
   * run goes, the run card says them.
   */
  readonly #portalPoints = $derived.by((): Point[] => {
    if (run.fetching) return [];
    const states = app.state?.portals ?? [];
    const alerts = app.state?.lastRun?.emptyAlerts ?? [];
    return this.#portals.flatMap((portal) =>
      portalPoints(
        portal,
        states.find((p) => p.portal === portal && p.health.kind !== 'ok'),
        alerts.filter((a) => a.portal === portal),
      ),
    );
  });

  /**
   * "Offene Punkte", the most important first: a profile the fit needs, what she has to do
   * for a portal, ads "Details holen" can still fetch, excluded jobs not looked at yet, what
   * resolves itself, portals whose alert mails stopped.
   */
  readonly points = $derived.by((): Point[] => {
    const portals = this.#portalPoints;
    return [
      ...this.#profilePoint(),
      ...portals.filter((point) => point.tone === 'warning'),
      ...this.#detailsPoint(),
      ...this.#excludedPoint(),
      ...portals.filter((point) => point.tone === 'info'),
      ...this.#quietPoints(portals),
    ];
  });

  /** No usable profile: without one nothing has a fit. */
  #profilePoint(): Point[] {
    if (app.state === null || app.hasProfile) return [];
    const profile = app.state.profile;
    const toProfile = (): Promise<string | null> => {
      // No profile yet: straight into the empty form, one click.
      if (profile === null) editor.create();
      navigation.go('profile');
      return Promise.resolve(null);
    };
    if (profile === null) {
      return [
        {
          id: 'profile',
          tone: 'info',
          heading: null,
          text: t.list.noProfile,
          action: { label: t.list.createProfile, run: toProfile },
        },
      ];
    }
    return [
      {
        id: 'profile',
        tone: 'info',
        heading: profile.parseError ? t.list.profileUnreadable : t.list.profileEmpty,
        text: t.list.profileBrokenText,
        action: { label: t.list.openProfile, run: toProfile },
      },
    ];
  }

  /** Ads "Details holen" can still fetch (core counts them by the portals' switches). The
   *  demo never fetches, and while a run goes it fetches them anyway. */
  #detailsPoint(): Point[] {
    const wanted = this.stats?.detailsWanted ?? 0;
    if (wanted === 0 || app.state?.demo || run.active) return [];
    return [
      {
        id: 'details',
        tone: 'info',
        heading: null,
        text: t.overview.noDetail(wanted),
        action: { label: t.overview.fetchDetails, icon: 'details', run: fetchDetails },
      },
    ];
  }

  /** Excluded jobs she has not opened: the Eingang with its excluded section open. */
  #excludedPoint(): Point[] {
    const count = this.stats?.excludedNew ?? 0;
    if (count === 0 || !app.hasProfile) return [];
    const look = (): Promise<string | null> => {
      toExcluded();
      return Promise.resolve(null);
    };
    return [
      {
        id: 'excluded',
        tone: 'info',
        heading: null,
        text: t.overview.excludedNew(count),
        action: { label: t.overview.look, icon: 'excluded', run: look },
      },
    ];
  }

  /** Portals whose alert mails stopped for a week (only once a fetch has read the mailbox,
   *  and not twice for a portal that has a point already); one that never sent one leads to
   *  its site, where the alert is made. */
  #quietPoints(portals: Point[]): Point[] {
    if (!this.fetchedOnce) return [];
    return (this.stats?.quietPortals ?? [])
      .filter((p) => p.quiet && !portals.some((point) => point.id.startsWith(`${p.portal}-`)))
      .map((p) => ({
        id: `quiet-${p.portal}`,
        tone: 'info',
        heading: t.portal[p.portal],
        text: p.lastAlert
          ? t.overview.quietSince(formatRelative(p.lastAlert))
          : t.overview.quietNever,
        action: p.lastAlert
          ? null
          : {
              label: t.overview.createAlert,
              icon: 'external',
              run: () => openTarget({ kind: 'portalHome', portal: p.portal }),
            },
      }));
  }

  /** The musts the profile lacks most often (only with a profile to add them to). */
  get openMusts(): OverviewStats['openMusts'] {
    return app.hasProfile ? (this.stats?.openMusts ?? []) : [];
  }

  /** The market has something to say. */
  get showMarket(): boolean {
    const market = this.stats?.market ?? null;
    if (market === null) return false;
    return (
      market.newByPortal.some((p) => p.count > 0 && this.#portals.includes(p.portal)) ||
      market.medianDayRate !== null ||
      market.remoteShare !== null
    );
  }

  /** The enabled portals, for the market's rows. */
  get portals(): readonly Portal[] {
    return this.#portals;
  }
}

/** A portal's points (see `#portalPoints`). */
function portalPoints(
  portal: Portal,
  state: PortalState | undefined,
  alerts: EmptyAlert[],
): Point[] {
  const out: Point[] = [];
  const health = state?.health ?? null;
  const suspect = health?.kind === 'layoutSuspect' ? health : null;
  const mails = Math.max(alerts.length, suspect?.emptyMails ?? 0);
  if (mails > 0) {
    const mail = alerts.find((a) => a.gmailId !== null)?.gmailId ?? null;
    out.push({
      id: `${portal}-mails`,
      tone: 'warning',
      heading: t.portal[portal],
      text: t.overview.emptyAlerts(mails),
      action:
        mail === null
          ? null
          : {
              label: t.reader.mail,
              icon: 'alertMail',
              run: () => openTarget({ kind: 'alertMail', gmailId: mail }),
            },
    });
  } else if (suspect !== null) {
    out.push({
      id: `${portal}-pages`,
      tone: 'info',
      heading: t.portal[portal],
      text: healthAdvice(suspect) ?? '',
      action: null,
    });
  }
  if (health !== null && health.kind !== 'ok' && suspect === null) {
    out.push({
      id: `${portal}-health`,
      tone: state?.actionNeeded ? 'warning' : 'info',
      heading: t.portal[portal],
      text: healthAdvice(health) ?? '',
      action: null,
    });
  }
  return out;
}

/** "Details holen" for every inbox job whose ad can still be fetched (the reader's rule). */
async function fetchDetails(): Promise<string | null> {
  try {
    const page = await invoke('list_jobs', { query: inboxQuery({ limit: 500 }) });
    const keys = page.jobs.filter(detailsWanted).map((job) => job.key);
    // A start that fails is said under the tiles (run.startError).
    if (keys.length > 0) await run.start({ kind: 'details', keys });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

export const overview = new OverviewModel();
