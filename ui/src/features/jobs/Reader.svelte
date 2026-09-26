<!--
  The reader, unboxed on the sheet (max 720 px), in this order:
  - Head: the title (without gender tags) and a quiet close back to the day overview (below
    900 px the view's back button does); company · place (copyable); a small grey line with
    the portal, the time (the exact moment in its tooltip) and "auch auf …" as a link that
    opens the ad; where the job lies (archive, trash with the days left) and an ad that is
    offline.
  - Match: the ring (56; opening a job fills its arc once, the number stands at once) beside
    the band line with "4 von 4 Pflicht erfüllt", aligned to the top; under it one quiet line
    (why it cannot be scored, or a score from a preview with the way to the sign-in). An
    excluded job gets a calm box: the reason, "In der Anzeige zeigen" and "Trotzdem
    einbeziehen"; included by hand it says so with "Rückgängig". The focus moves to the
    replacing button after each.
  - Actions: "Anzeige öffnen" (the strongest; "Abrufen" is the view's primary), "Favorit"
    and the move of the place as labelled buttons (icons where the row gets narrow: it never
    wraps), and "…" with the app's menu (Alert-Mail öffnen, KI-Prompt kopieren, Als
    ungelesen markieren, In den Papierkorb). Moving the job away from one of its buttons
    hands the focus to the same button of the next job; after Archivieren the next job of the
    list opens, and the toast can take it back.
  - Anforderungen: the must line and how many optional ones are missing; each missing must
    with "Zum Profil hinzufügen" (addToProfile.ts).
  - Konditionen: fixed rows in a fixed order (terms.ts) with the ad's value, the profile's
    side under it and the verdict as a word (no verdict column without a profile). A value
    with a passage has a dotted underline, lights the passage on hover and jumps to it.
  - Anforderungen im Detail: met, met in part, not in the profile (a missing must stands
    out, only "Optional" is tagged), to check, excluding; neutral counts. Hovering a reason
    lights its passage, a click scrolls to it and the passage flashes once it has arrived.
  - Anzeige: the notes on a missing text (with "Jetzt holen" or "Details holen"), and the
    ad text. Each passage names its state under the pointer, lights its reason and a click
    scrolls to the reason (the link goes both ways).
  Once the action row has scrolled away, a compact bar sticks to the top (ring, title, open,
  the place's tools, pin): it fades in sliding down 4 px and leaves faster, and it cannot be
  clicked while hidden. Like a row's tools it is for the pointer (out of the Tab order: the
  head's tools are the keyboard's); its title, cut off, shows in full in a tooltip.
-->
<script lang="ts" module>
  /** A button of the reader had the focus when its job moved away: the same button of the
   *  next job takes it, so archive, archive, archive works from the keyboard. */
  let handoff: { testid: string; from: string; until: number } | null = null;
  /** How long the next job may take to open and still take the focus. */
  const HANDOFF_MS = 3000;
  /** The user's own mark on a job included by hand: no words of its own in the lists. */
  const OVERRIDE = 'userOverride';
  /** A row of the terms as a thing to light and jump to (reasons go by their id). */
  const TERM = 'term:';
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Button from '$components/Button.svelte';
  import Chip from '$components/Chip.svelte';
  import Count from '$components/Count.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice from '$components/Notice.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import ScoreRing, { ringState } from '$components/ScoreRing.svelte';
  import { inView, scrollArea } from '$lib/actions/inView';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { displayTitle, formatDate, formatRelative, formatTime } from '$lib/i18n/format';
  import { contentMoving } from '$lib/input/input';
  import { keyLabel } from '$lib/platform';
  import { clock } from '$lib/state/clock.svelte';
  import {
    DETAIL_WARNS,
    errorText,
    noteText,
    reasonEvidence,
    reasonHint,
    reasonText,
  } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { Highlight, JobDetail, OpenTarget, Reason } from '$lib/ipc/types';
  import { duration, isReducedMotion } from '$lib/motion/motion';
  import { app } from '$lib/state/app.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import AdText from './AdText.svelte';
  import { addToProfile, isAdded } from './addToProfile';
  import { copyText } from './prompt';
  import {
    actionsOf,
    guarded,
    hasStar,
    move,
    purge,
    seen,
    toggleStar,
    type ActionId,
  } from './actions';
  import { rowOf, termRows, type TermRow } from './terms';

  interface Props {
    detail: JobDetail;
    /** Close the job (back to the day overview). */
    onclose?: (() => void) | null;
  }
  let { detail, onclose = null }: Props = $props();

  const job = $derived(detail.job);
  /** The title without gender tags (the head and the compact bar, which cuts it off). */
  const heading = $derived(job.title ? displayTitle(job.title) : t.job.untitled);
  const match = $derived(detail.match);
  const withRing = $derived(app.hasProfile);
  // What is lit and where a jump went: a reason by its id, a row of the terms as `term:key`.
  // The passage under the pointer wins; a clicked one stays lit after the scroll moved the
  // list away from under the pointer.
  let hovered = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  const activeItem = $derived(hovered ?? pinned);
  // Another job starts without a lit passage.
  const shownKey = $derived(keyOf(job.key));
  $effect(() => {
    void shownKey;
    pinned = null;
    hovered = null;
  });
  let textElement = $state<HTMLElement | null>(null);
  let article = $state<HTMLElement | null>(null);
  let actionError = $state<string | null>(null);
  /** The action row has scrolled away: the compact bar is up. */
  let compact = $state(false);
  /** The item whose passages flash once after a jump to them. */
  let flash = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  /** Between two facts; an expression, so its spaces stay (a copy reads "Hamburg · Remote"). */
  const SEPARATOR = ' · ';

  const WEIGHT_ORDER = { must: 0, hard: 1, nice: 2, info: 3 } as const;
  const byWeight = (a: Reason, b: Reason): number =>
    WEIGHT_ORDER[a.weight] - WEIGHT_ORDER[b.weight];

  const all = $derived(match?.reasons ?? []);
  const criteria = $derived(match?.criteria ?? []);
  const profileForm = $derived(app.state?.profile?.form ?? null);

  /** The terms of the ad, row by row (terms.ts). */
  const rows = $derived(
    termRows({
      job,
      reasons: all,
      criteria,
      profile: profileForm,
      withVerdict: withRing,
      textLength: detail.text?.length ?? 0,
    }),
  );
  const rowItem = (row: TermRow): string => `${TERM}${row.key}`;

  /** The item a passage's reason belongs to: the row of the terms that stands for it, else
   *  the reason itself. */
  function itemOf(reason: string): string {
    const row = rows.find((each) => each.ids.includes(reason));
    return row ? rowItem(row) : reason;
  }

  /** The reasons whose passages an item lights. */
  function idsOf(item: string | null): string[] {
    if (item === null) return [];
    if (!item.startsWith(TERM)) return [item];
    return rows.find((row) => rowItem(row) === item)?.ids ?? [];
  }
  const activeIds = $derived(new Set(idsOf(activeItem)));
  const flashIds = $derived(new Set(idsOf(flash)));

  // The lists show the requirements and points of the ad; what a row of the terms stands for
  // is said there, and the user's own mark has no words.
  const listed = $derived(
    all.filter((r) => r.code !== OVERRIDE && rowOf(r) === null && reasonText(r) !== ''),
  );
  const met = $derived(listed.filter((r) => r.kind === 'met').sort(byWeight));
  // Met only in part is not met: its own group, never under "Erfüllt".
  const partial = $derived(listed.filter((r) => r.kind === 'partial').sort(byWeight));
  const open = $derived(listed.filter((r) => r.kind === 'open').sort(byWeight));
  const checks = $derived(listed.filter((r) => r.kind === 'check'));
  const partialMust = $derived(
    all.filter((r) => r.kind === 'partial' && r.weight === 'must').length,
  );
  /** Must requirements the profile lacks (each can go into the profile). */
  const missingMusts = $derived(listed.filter((r) => r.kind === 'open' && r.weight === 'must'));
  const missingNice = $derived(
    listed.filter((r) => r.kind === 'open' && r.weight === 'nice').length,
  );

  const detailKind = $derived(job.detail.kind);
  const headline = $derived.by((): { word: string; tone: string } | null => {
    if (!withRing) return null;
    // Its ad is still to come: it is scored once it is there.
    if (detailKind === 'pending' && (match === null || match.status === 'unscorable')) {
      return { word: t.reader.scoredLater, tone: 'none' };
    }
    if (match === null) {
      return { word: app.state?.matchPending ? t.score.pending : t.score.none, tone: 'none' };
    }
    if (match.status === 'excluded') return { word: t.score.excluded, tone: 'excluded' };
    if (match.status === 'unscorable') return { word: t.score.unscorable, tone: 'none' };
    return { word: t.score.band[match.band], tone: match.band };
  });
  const mustLine = $derived(
    job.match && job.match.mustTotal > 0
      ? t.reader.mustMet(job.match.mustMet, job.match.mustTotal, partialMust)
      : t.reader.noMust,
  );
  const firstViolation = $derived(all.find((r) => r.kind === 'violation') ?? null);
  const exclusion = $derived(
    match?.status === 'excluded'
      ? (noteText(job.match?.note ?? match.summary) ??
          (firstViolation ? reasonText(firstViolation) : t.reader.note.hardCriterion))
      : null,
  );
  /** The passage that excludes the job (a violation of the engine that has one). */
  const excludedBy = $derived.by((): string | null => {
    const hit = [...all, ...criteria].find((r) => r.kind === 'violation' && r.ranges.length > 0);
    return hit ? itemOf(hit.id) : null;
  });
  // Why a job cannot be scored (too little text, an engine failure); without a note the ad
  // simply names no clear requirements.
  const unscorable = $derived(
    match?.status === 'unscorable' && detailKind !== 'pending'
      ? (noteText(job.match?.note ?? match.summary) ?? t.reader.noReasons)
      : null,
  );
  // A violation the box above says in the same words is not repeated.
  const violations = $derived(
    listed.filter((r) => r.kind === 'violation' && reasonText(r) !== exclusion),
  );

  const portalState = $derived(app.state?.portals.find((p) => p.portal === job.portal) ?? null);
  /** The note on a missing text warns like the row's badge (texts.ts DETAIL_WARNS). */
  const detailWarns = $derived(detailKind !== 'ok' && DETAIL_WARNS[detailKind]);
  const canFetch = $derived(
    (detailKind === 'pending' ||
      detailKind === 'onRequest' ||
      detailKind === 'failed' ||
      detailKind === 'teaser') &&
      portalState?.enabled === true &&
      portalState.fetchDetails &&
      (detailKind !== 'teaser' || portalState.loginEnabled),
  );
  /** A score from a preview only is a first guess. */
  const preliminary = $derived(match?.status === 'scored' && detailKind === 'teaser');
  /** The portal shows only a preview without a sign-in that is not set up. */
  const signInMissing = $derived(
    detailKind === 'teaser' && portalState !== null && !portalState.loginEnabled,
  );
  /** The way to the sign-in stands in the line under the band (else with the ad's note). */
  const signInInHead = $derived(signInMissing && preliminary && headline !== null);

  /** Company and place, copyable. */
  const facts = $derived([job.company, job.location].filter((fact) => fact !== ''));
  const when = $derived(job.mailDate ?? job.firstSeenAt);

  /** The actions row stays one line: where the labels do not fit, Favorit and the move of the
   *  place are icon buttons (their tooltips name them). Tried again whenever the row's width
   *  changes (before the frame is painted). */
  let actions = $state<HTMLElement | null>(null);
  let iconsOnly = $state(false);

  function oneLine(row: HTMLElement): boolean {
    const first = row.firstElementChild;
    const last = row.lastElementChild;
    return !(first instanceof HTMLElement && last instanceof HTMLElement)
      ? true
      : first.offsetTop === last.offsetTop;
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
      // In the next frame, before it is painted: changing the row inside the callback
      // would make the observer report again in the same frame (a loop).
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void fit(row);
      });
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  /** Why the prompt cannot work yet (no profile to assess against, no text of the ad). */
  const promptOff = $derived(
    !app.hasProfile ? t.reader.promptNoProfile : detail.text ? null : t.reader.promptNoText,
  );

  async function copyPrompt(): Promise<void> {
    actionError = null;
    let prompt: string;
    try {
      prompt = await jobs.aiPrompt(job.key);
    } catch (error) {
      actionError = errorText(error);
      return;
    }
    if (await copyText(prompt)) toasts.show(t.toast.prompt);
    else actionError = t.reader.promptNotCopied;
  }

  /** The job's actions where it is (the same as on its row), for the compact bar. */
  const tools = $derived(actionsOf(job.place));
  /** The labelled moves of the head: all but the trash, which the "…" menu holds. */
  const moves = $derived(tools.filter((tool) => tool.id !== 'trash'));
  let confirmPurge = $state(false);
  let purging = $state(false);
  let purgeError = $state<string | null>(null);

  function act(id: ActionId): void {
    if (guarded()) return;
    if (id === 'purge') {
      purgeError = null;
      confirmPurge = true;
      return;
    }
    actionError = null;
    const focused = document.activeElement;
    const testid =
      focused instanceof HTMLElement && article?.contains(focused)
        ? (focused.dataset.testid ?? null)
        : null;
    // The compact bar starts hidden in the next job: its twin in the head takes the focus.
    handoff =
      testid === null
        ? null
        : {
            testid: testid.replace(/^compact-/, 'reader-'),
            from: keyOf(job.key),
            until: performance.now() + HANDOFF_MS,
          };
    void move([job], id).then((error) => {
      actionError = error;
      if (error !== null) handoff = null;
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

  async function purgeJob(): Promise<void> {
    purging = true;
    purgeError = await purge([job]);
    purging = false;
    if (purgeError === null) confirmPurge = false;
  }

  function star(): void {
    if (!guarded()) toggleStar([job]);
  }

  /** The "…" button and its menu, right below it (a second click closes it: the press
   *  outside does). */
  let moreAnchor = $state<HTMLElement | null>(null);
  let moreOpen = $state(false);

  function moreEntries(): MenuEntry[] {
    const entries: MenuEntry[] = [
      {
        id: 'mail',
        label: t.reader.mail,
        icon: 'mail-open',
        disabled: !detail.mail.gmailUrl,
        reason: t.reader.noMail,
        run: () => openTarget({ kind: 'gmail', key: job.key }),
      },
      {
        id: 'prompt',
        label: t.reader.prompt,
        icon: 'copy',
        disabled: promptOff !== null,
        reason: promptOff,
        run: () => void copyPrompt(),
      },
    ];
    if (tools.some((tool) => tool.id === 'trash')) {
      entries.push(
        { kind: 'separator' },
        {
          id: 'trash',
          label: t.actions.trash,
          icon: 'trash-2',
          keys: keyLabel('del'),
          run: () => act('trash'),
        },
      );
    }
    return entries;
  }

  function openMore(event: MouseEvent): void {
    if (moreAnchor === null || menuState.open !== null) return;
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

  const DAY_MS = 86_400_000;
  /** Not in the inbox: where it lies, quietly under the facts. The trash says in how many
   *  days it goes for good (counted from the day the job went there, following the clock;
   *  past that, soon: the next run or start empties it), like the trash's own sentence. */
  const placeLine = $derived.by((): string | null => {
    if (job.place === 'archive') return t.place.inArchive;
    if (job.place !== 'trash') return null;
    const days = app.state?.autoEmptyTrashDays ?? 0;
    if (days === 0) return t.place.inTrash;
    const since =
      job.trashedAt === null
        ? 0
        : Math.max(0, Math.floor((clock.now.getTime() - Date.parse(job.trashedAt)) / DAY_MS));
    const left = days - since;
    return left > 0 ? t.place.inTrashLeft(left) : t.place.inTrashSoon;
  });
  /** A closed or vanished ad: since when the app saw it so (its last fetch), if it knows. */
  const offline = $derived(
    job.closed || detailKind === 'gone'
      ? detail.fetchedAt
        ? t.reader.offlineSince(formatDate(detail.fetchedAt))
        : t.reader.offline
      : null,
  );

  /** "Trotzdem einbeziehen": an excluded job counts with its fit score, and back. The focus
   *  goes to the button that takes the other's place (never to the page). */
  async function override(): Promise<void> {
    const include = !job.overridden;
    const error = await jobs.setOverride(job.key, include);
    actionError = error;
    if (error !== null) return;
    await tick();
    article
      ?.querySelector<HTMLElement>(`[data-testid="${include ? 'override-undo' : 'override'}"]`)
      ?.focus({ preventScroll: true });
  }

  function openTarget(target: OpenTarget): void {
    actionError = null;
    invoke('open_target', { target }).catch((error: unknown) => (actionError = errorText(error)));
  }

  /** "Anmeldung einrichten": Einstellungen at the card of this portal. */
  function setUpSignIn(): void {
    navigation.focusPortal = job.portal;
    navigation.go('settings');
  }

  function flashPassage(item: string): void {
    if (flashTimer !== null) clearTimeout(flashTimer);
    flash = null;
    requestAnimationFrame(() => {
      flash = item;
      flashTimer = setTimeout(() => (flash = null), duration('base'));
    });
  }

  /** Once the scroll area has come to rest (at the latest after the time a scroll takes). */
  function afterScroll(area: Element | null, then: () => void): void {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      area?.removeEventListener('scrollend', finish);
      then();
    };
    area?.addEventListener('scrollend', finish);
    setTimeout(finish, 2 * duration('reveal'));
  }

  /** Whether the node can be seen whole in its scroll area. */
  function inside(node: Element): boolean {
    const area = scrollArea(node);
    const box = node.getBoundingClientRect();
    const view = area?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    return box.top >= view.top && box.bottom <= view.bottom;
  }

  /** A reason or a row to its passage in the ad: it stays lit, and flashes once it is there. */
  function jumpTo(item: string): void {
    pinned = item;
    const ids = idsOf(item);
    const mark = [...(textElement?.querySelectorAll<HTMLElement>('mark[data-reason]') ?? [])].find(
      (node) => ids.includes(node.dataset.reason ?? ''),
    );
    if (!mark) return;
    if (isReducedMotion()) {
      if (!inside(mark)) mark.scrollIntoView({ block: 'center' });
      return;
    }
    if (inside(mark)) {
      flashPassage(item);
      return;
    }
    afterScroll(scrollArea(mark), () => flashPassage(item));
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** A passage to its reason (or row of the terms): it stays lit and comes into view. */
  function pickPassage(reason: string): void {
    const item = itemOf(reason);
    pinned = item;
    const target = article?.querySelector(`[data-item="${CSS.escape(item)}"]`);
    if (!target || inside(target)) return;
    target.scrollIntoView({ block: 'center', behavior: isReducedMotion() ? 'auto' : 'smooth' });
  }

  function hoverItem(item: string, on: boolean): void {
    // An item the content scrolls under a still pointer takes no light (a jump keeps its
    // own); only a pointer that moves onto it does.
    if (on) {
      if (!contentMoving()) hovered = item;
    } else if (hovered === item) hovered = null;
  }

  /** What a passage is, under the pointer: a requirement's state and weight ("Erfüllt ·
   *  Pflicht"), a row of the terms with its verdict, else the state of the reason. */
  function markHint(reason: Reason): string {
    const row = rows.find((each) => each.ids.includes(reason.id));
    if (row) {
      return row.verdict === null
        ? row.name
        : t.reader.markHint(row.name, t.reader.verdict[row.verdict]);
    }
    if (reason.weight === 'must' || reason.weight === 'nice') {
      return t.reader.markHint(t.reason.kind[reason.kind], t.reason.weight[reason.weight]);
    }
    return t.reason.kind[reason.kind];
  }
  const hints: ReadonlyMap<string, string> = $derived(
    new Map([...all, ...criteria].map((reason) => [reason.id, markHint(reason)])),
  );

  /** The marked passages: the reasons' highlights and the criteria's own ranges. */
  const passages = $derived([
    ...(match?.highlights ?? []),
    ...criteria.flatMap((reason) =>
      reason.ranges.map((range, index): Highlight => ({
        id: `${reason.id}:${index}`,
        start: range.start,
        end: range.end,
        kind: reason.kind,
        reason: reason.id,
      })),
    ),
  ]);

  /** The compact bar is for the pointer, like a row's tools: its buttons stay out of the Tab
   *  order (the head's twins are the keyboard's), also the ones another place brings. */
  function pointerOnly(node: HTMLElement): { destroy: () => void } {
    const untab = (): void => {
      for (const button of node.querySelectorAll('button')) button.tabIndex = -1;
    };
    untab();
    const observer = new MutationObserver(untab);
    observer.observe(node, { childList: true, subtree: true });
    return { destroy: () => observer.disconnect() };
  }
</script>

<!-- Values joined by middle dots that copy with them ("Hamburg · Remote"); a line breaks
     only between two values. The first value's dot is an empty box: it is clipped anyway, and
     a copy of the line starts with the value. -->
{#snippet dotted(items: string[])}
  {#each items as item, index (index)}<wbr /><span class="fact"
      ><span class="sep" aria-hidden="true">{index === 0 ? '' : SEPARATOR}</span><span>{item}</span
      ></span
    >{/each}
{/snippet}

{#snippet sub(label: string, count: number)}
  <h3 class="sub">{label}<Count value={count} tone="plain" /></h3>
{/snippet}

{#snippet reasonList(items: Reason[], testid: string)}
  <ul class="reasons" data-testid={testid}>
    {#each items as reason (reason.id)}
      {@const evidence = reasonEvidence(reason)}
      <li data-weight={reason.weight} data-item={reason.id}>
        <ReasonItem
          kind={reason.kind}
          weight={reason.weight === 'nice' ? 'nice' : null}
          emphasis={reason.kind !== 'open'
            ? null
            : reason.weight === 'must'
              ? 'strong'
              : reason.weight === 'nice'
                ? 'quiet'
                : null}
          label={reasonText(reason)}
          hint={evidence ? null : reasonHint(reason)}
          detail={evidence}
          active={activeItem === reason.id}
          onhover={(on) => hoverItem(reason.id, on)}
          onselect={reason.ranges.length > 0 ? () => jumpTo(reason.id) : null}
        />
      </li>
    {/each}
  </ul>
{/snippet}

<!-- The compact bar's tools: the place's moves, the star and close. Deleting for good waits
     for a run, like on the row (the backend refuses meanwhile). -->
{#snippet placeTools(prefix: string)}
  {#each tools as tool (tool.id)}
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={tool.icon}
      label={tool.label}
      disabled={tool.id === 'purge' && run.active}
      disabledReason={run.busyText}
      testid="{prefix}{tool.id}"
      onclick={() => act(tool.id)}
    />
  {/each}
  {#if hasStar(job.place)}
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon="star"
      label={job.pinned ? t.reader.unpin : t.reader.pin}
      pressed={job.pinned}
      testid="{prefix}pin"
      onclick={star}
    />
  {/if}
  {@render closeButton(prefix)}
{/snippet}

{#snippet closeButton(prefix: string)}
  {#if onclose}
    <span class="close">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon="x"
        label={t.reader.close}
        testid="{prefix}close"
        onclick={onclose}
      />
    </span>
  {/if}
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
  <!-- Sticks to the top of the stage; up only while the action row is scrolled away. -->
  <div class="compact-anchor">
    <div
      class="compact"
      class:shown={compact}
      aria-hidden={!compact}
      inert={!compact}
      data-testid="reader-compact"
    >
      {#if withRing}
        <ScoreRing
          ring={ringState(
            job.match,
            job.match === null && Boolean(app.state?.matchPending),
            job.detail.kind,
          )}
          size="sm"
        />
      {/if}
      <span class="compact-title" use:tooltip={{ text: heading, truncated: true }}>{heading}</span>
      <span class="compact-tools" use:pointerOnly>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="external-link"
          label={t.reader.open}
          testid="compact-open"
          onclick={() => openTarget({ kind: 'jobUrl', key: job.key })}
        />
        {@render placeTools('compact-')}
      </span>
    </div>
  </div>

  <header class="head">
    <div class="title-line">
      <h1 class="title" data-testid="reader-title" data-copy>
        {heading}
      </h1>
      <span class="title-tools">
        {@render closeButton('reader-')}
      </span>
    </div>
    {#if facts.length > 0}
      <p class="facts" data-copy data-testid="reader-facts">
        <span class="facts-line">{@render dotted(facts)}</span>
      </p>
    {/if}
    <!-- The portal, the time (the exact moment in its tooltip) and the other portals that
         announced the job: a link opens the ad (that portal's own once the backend knows
         its link; until then the job's ad). -->
    <p class="source" data-testid="reader-source">
      <span class="facts-line"
        ><span class="fact"><span class="sep" aria-hidden="true"></span>{t.portal[job.portal]}</span
        ><wbr /><span class="fact"
          ><span class="sep" aria-hidden="true">{SEPARATOR}</span><span
            data-testid="reader-when"
            use:tooltip={t.reader.mailAt(formatDate(when), formatTime(when))}
            >{formatRelative(when, clock.now)}</span
          ></span
        >{#each job.alsoOn as portal (portal)}<wbr /><span class="fact"
            ><span class="sep" aria-hidden="true">{SEPARATOR}</span><span class="inline-action"
              ><Button
                variant="link"
                size="sm"
                label={t.job.alsoOn(t.portal[portal])}
                testid="also-{portal}"
                onclick={() => openTarget({ kind: 'jobUrl', key: job.key })}
              /></span
            ></span
          >{/each}</span
      >
    </p>
    {#if placeLine}<p class="place-line" data-testid="place-line">{placeLine}</p>{/if}
    {#if offline}<p class="place-line" data-testid="offline-line">{offline}</p>{/if}
  </header>

  {#if headline}
    <div class="match">
      <ScoreRing
        ring={ringState(
          job.match,
          job.match === null && Boolean(app.state?.matchPending),
          job.detail.kind,
        )}
        size="md"
        animate={keyOf(job.key)}
        testid="reader-ring"
      />
      <div class="lines">
        <p class="line">
          <span class="line-inner">
            <span class="band {headline.tone}" data-testid="band">{headline.word}</span>
            {#if match && match.status === 'scored'}
              <span class="must" data-testid="must">{mustLine}</span>
            {/if}
          </span>
        </p>
        {#if unscorable}
          <p class="because" data-testid="unscorable">{unscorable}</p>
        {:else if preliminary}
          <p class="because" data-testid="preliminary">
            {t.reader.preliminary}{#if signInInHead}<span class="sep-inline" aria-hidden="true"
                >{SEPARATOR}</span
              ><span class="inline-action"
                ><Button
                  variant="link"
                  size="sm"
                  label={t.reader.setUpSignIn}
                  testid="set-up-sign-in"
                  onclick={setUpSignIn}
                /></span
              >{/if}
          </p>
        {/if}
      </div>
    </div>
  {/if}

  {#if exclusion !== null || job.overridden}
    <!-- Calm, not an alarm: why the engine excludes the job, where the ad says so, and the
         user's word against it (and back). -->
    <div class="exclusion" data-testid="exclusion-box">
      {#if exclusion !== null}
        <p class="exclusion-text" data-testid="exclusion">{exclusion}</p>
        <div class="exclusion-actions">
          {#if excludedBy !== null}
            {@const target = excludedBy}
            <Button
              variant="link"
              size="sm"
              label={t.reader.showInAd}
              testid="show-in-ad"
              onclick={() => jumpTo(target)}
            />
          {/if}
          <Button
            variant="secondary"
            size="sm"
            label={t.reader.override}
            testid="override"
            onclick={() => void override()}
          />
        </div>
      {:else}
        <p class="exclusion-text" data-testid="overridden">{t.reader.overridden}</p>
        <div class="exclusion-actions">
          <Button
            variant="secondary"
            size="sm"
            label={t.reader.overrideUndo}
            testid="override-undo"
            onclick={() => void override()}
          />
        </div>
      {/if}
    </div>
  {/if}

  <div class="actions" bind:this={actions} data-testid="reader-actions">
    <Button
      variant="secondary"
      icon="external-link"
      label={t.reader.open}
      testid="open-ad"
      onclick={() => openTarget({ kind: 'jobUrl', key: job.key })}
    />
    {#if hasStar(job.place)}
      <Button
        variant="ghost"
        icon="star"
        iconOnly={iconsOnly}
        label={t.reader.favourite}
        pressed={job.pinned}
        testid="reader-pin"
        onclick={star}
      />
    {/if}
    <!-- Deleting for good waits for a run, like on the row (the backend refuses meanwhile). -->
    {#each moves as tool (tool.id)}
      <Button
        variant="ghost"
        icon={tool.icon}
        iconOnly={iconsOnly}
        label={tool.label}
        warns={tool.id === 'purge'}
        disabled={tool.id === 'purge' && run.active}
        disabledReason={run.busyText}
        testid="reader-{tool.id}"
        onclick={() => act(tool.id)}
      />
    {/each}
    <!-- The place of "Beworben" (a labelled button like Favorit), added with its data. -->
    <span class="more" bind:this={moreAnchor}>
      <Button
        variant="ghost"
        icon="ellipsis"
        iconOnly
        label={t.reader.more}
        menu
        expanded={moreOpen}
        testid="reader-more"
        onclick={openMore}
      />
    </span>
  </div>
  <span class="past-actions" use:inView={(place) => (compact = place === 'above')}></span>
  {#if actionError}
    <Notice tone="danger" variant="inline" text={actionError} />
  {/if}

  {#if match && match.status !== 'unscorable' && withRing}
    <section class="block" data-testid="requirements">
      <h2 class="section">{t.reader.requirements}</h2>
      <p class="summary" data-testid="requirements-line">
        {t.reader.requirementsLine(mustLine, missingNice)}
      </p>
      {#if missingMusts.length > 0}
        <ul class="missing-musts" data-testid="missing-musts">
          {#each missingMusts as reason (reason.id)}
            {@const term = reasonText(reason)}
            <li class="missing-must">
              <span class="missing-term" data-copy>{term}</span>
              {#if isAdded(term)}
                <span class="added" data-testid="added">{t.reader.added}</span>
              {:else}
                <span class="inline-action">
                  <Button
                    variant="link"
                    size="sm"
                    label={t.reader.addToProfile}
                    testid="add-to-profile"
                    onclick={() => addToProfile(term)}
                  />
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="block" data-testid="terms">
    <h2 class="section">{t.reader.frame}</h2>
    <!-- The ad's terms as a table: what, the ad's value (the profile's side under it) and
         whether it fits in a word. A value with a passage lights it on hover and jumps to it
         on a click. -->
    <ul class="terms" class:judged={withRing} aria-label={t.reader.frame} data-testid="criteria">
      {#each rows as row (row.key)}
        {@const item = rowItem(row)}
        <li class="term" data-row={row.key} data-testid="term-{row.key}">
          <span class="term-name" data-item={item}>{row.name}</span>
          <span class="term-value" data-copy>
            <span class="term-line">
              {#if row.passage}
                <Chip
                  label={row.value}
                  text
                  active={activeItem === item}
                  onhover={(on) => hoverItem(item, on)}
                  onselect={() => jumpTo(item)}
                />
              {:else}
                <span class="plain" class:open={row.open}>{row.value}</span>
              {/if}
              {#if row.note}<span class="term-note">{row.note}</span>{/if}
            </span>
            {#if row.profile}<span class="term-profile">{row.profile}</span>{/if}
          </span>
          {#if withRing}
            <span class="verdict {row.verdict ?? ''}" data-testid="verdict"
              >{row.verdict === null ? '' : t.reader.verdict[row.verdict]}</span
            >
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  {#if match && match.status !== 'unscorable' && withRing}
    <section class="block why" data-testid="why">
      <h2 class="section">{t.reader.why}</h2>
      {#if met.length + partial.length + open.length === 0}
        <p class="quiet">{t.reader.noReasons}</p>
      {:else}
        <div class="columns">
          {#if met.length + partial.length > 0}
            <div class="stack">
              {#if met.length > 0}
                <div class="group">
                  {@render sub(t.reader.met, met.length)}
                  {@render reasonList(met, 'reasons-met')}
                </div>
              {/if}
              {#if partial.length > 0}
                <div class="group">
                  {@render sub(t.reader.partial, partial.length)}
                  {@render reasonList(partial, 'reasons-partial')}
                </div>
              {/if}
            </div>
          {/if}
          {#if open.length > 0}
            <div class="group">
              {@render sub(t.reader.missing, open.length)}
              {@render reasonList(open, 'reasons-open')}
            </div>
          {/if}
        </div>
      {/if}
      {#if checks.length > 0}
        <div class="group">
          {@render sub(t.reader.check, checks.length)}
          {@render reasonList(checks, 'reasons-check')}
        </div>
      {/if}
      {#if violations.length > 0}
        <div class="group">
          {@render sub(t.reader.violations, violations.length)}
          {@render reasonList(violations, 'reasons-violation')}
        </div>
      {/if}
    </section>
  {/if}

  <section class="block ad">
    <h2 class="section">{t.reader.ad}</h2>
    {#if detailKind !== 'ok' && detailKind !== 'gone'}
      <div class="missing">
        <Notice
          tone={detailWarns ? 'warning' : 'info'}
          variant="inline"
          text={portalState &&
          (!portalState.enabled || !portalState.fetchDetails) &&
          (detailKind === 'pending' || detailKind === 'onRequest')
            ? t.reader.detailsOff
            : detailKind === 'teaser'
              ? t.reader.teaserOf(t.portal[job.portal])
              : t.reader.detail[detailKind]}
          testid="detail-note"
        />
        {#if signInMissing && !signInInHead}
          <Button
            variant="secondary"
            size="sm"
            icon="log-in"
            label={t.reader.setUpSignIn}
            testid="set-up-sign-in"
            onclick={setUpSignIn}
          />
        {/if}
        {#if canFetch}
          <Button
            variant="secondary"
            size="sm"
            icon="download"
            label={detailKind === 'pending' ? t.reader.fetchNow : t.reader.fetchDetails}
            disabled={run.active}
            disabledReason={run.busyText}
            testid="fetch-details"
            onclick={() => void run.start({ kind: 'details', keys: [job.key] })}
          />
        {/if}
      </div>
    {:else if job.short && unscorable === null}
      <Notice tone="info" variant="inline" text={t.reader.short} />
    {/if}
    {#if detail.text}
      <AdText
        text={detail.text}
        highlights={passages}
        active={activeIds}
        flash={flashIds}
        {hints}
        onhover={(reason, on) => hoverItem(itemOf(reason), on)}
        onpick={pickPassage}
        bind:element={textElement}
      />
    {/if}
  </section>
</article>

<Dialog
  bind:open={confirmPurge}
  variant="danger"
  heading={t.actions.purgeHeading(1)}
  text={t.actions.purgeText}
  confirmLabel={t.actions.purgeConfirm}
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
    gap: var(--space-6);
  }

  /* No room of its own: it sticks to the top of the stage (under the macOS toolbar row)
     and cancels the gap it would add. */
  .compact-anchor {
    position: sticky;
    top: var(--window-top);
    z-index: var(--z-sticky);
    height: 0;
    margin-bottom: calc(-1 * var(--space-20));
  }

  /* The compact bar over the whole column: ring, title, open, pin. Enters in 150 ms with
     ease-out sliding down 4 px, leaves in 100 ms with ease-in. */
  .compact {
    position: absolute;
    top: 0;
    right: calc(-1 * var(--reader-padding));
    left: calc(-1 * var(--reader-padding));
    display: flex;
    align-items: center;
    gap: var(--space-12);
    height: var(--compact-header);
    padding: 0 var(--reader-padding);
    background-color: var(--surface);
    /* The hairline lies below the bar, so its content centres on a whole pixel. */
    box-shadow: 0 var(--border-width) 0 var(--border);
    opacity: 0;
    pointer-events: none;
    transform: translateY(calc(-1 * var(--move-md)));
    transition:
      opacity var(--dur-fast) var(--ease-in),
      transform var(--dur-fast) var(--ease-in);
    will-change: transform;
  }

  .compact.shown {
    opacity: 1;
    pointer-events: auto;
    transform: none;
    transition-duration: var(--dur-base);
    transition-timing-function: var(--ease-out);
  }

  .compact-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-heading);
    font: var(--type-title);
    font-weight: var(--weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .compact-tools {
    display: flex;
    flex: none;
    gap: var(--space-2);
    margin-right: calc(-1 * var(--space-6));
  }

  /* Watched: once it has scrolled away, the compact bar comes up. No room of its own. */
  .past-actions {
    height: 0;
    margin-top: calc(-1 * var(--space-20));
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

  /* On the axis of the first title line; the last glyph ends on the edge of the column. */
  .title-tools {
    display: flex;
    flex: none;
    gap: var(--space-2);
    margin-top: calc((var(--leading-2xl) - var(--control-sm)) / 2);
    margin-right: calc(-1 * var(--space-6));
  }

  .close {
    display: flex;
  }

  @media (width < 900px) {
    .close {
      display: none;
    }
  }

  /* Facts joined by middle dots; a dot that would start a wrapped line is clipped (every
     fact carries its dot in front, the line is shifted left by one dot). The dots are text,
     so a copy keeps them; a fact never breaks inside. */
  .facts,
  .source {
    overflow: hidden;
  }

  .facts {
    color: var(--text);
    font: var(--type-md);
  }

  /* The portal, the time and the other portals: small and grey. */
  .source {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .facts-line {
    display: block;
    margin-left: calc(-1 * var(--space-20));
  }

  /* One box per value: a line never breaks inside one (WebKit breaks a nowrap span that
     holds an inline block). */
  .fact {
    display: inline-block;
    white-space: nowrap;
  }

  .sep,
  .sep-inline {
    display: inline-block;
    width: var(--space-20);
    color: var(--text-subtle);
    text-align: center;
    white-space: pre;
  }

  /* The ring beside the band line, aligned to the top; the lines centre on the ring while
     they are shorter than it. */
  .match {
    display: flex;
    align-items: flex-start;
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
    justify-content: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: var(--ring-md);
  }

  /* The band word and the must count; like the facts, a dot that would start a wrapped line
     is clipped. */
  .line {
    overflow: hidden;
    font: var(--type-md);
  }

  .line-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    margin-left: calc(-1 * var(--space-20));
  }

  .band {
    font-weight: var(--weight-medium);
  }

  .must {
    color: var(--text-muted);
  }

  .band::before,
  .must::before {
    display: inline-block;
    width: var(--space-20);
    color: var(--text-subtle);
    font-weight: var(--weight-regular);
    text-align: center;
    content: '·';
  }

  .because {
    color: var(--text-muted);
    font: var(--type-sm);
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

  .band.excluded {
    color: var(--danger-strong);
  }

  /* The exclusion: a calm box, the reason and the ways on under it. */
  .exclusion {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-12) var(--space-16);
    border-radius: var(--radius-md);
    background-color: var(--surface-muted);
  }

  .exclusion-text {
    color: var(--text);
    font: var(--type-md);
  }

  .exclusion-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
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

  /* The link keeps its hit area but not its height: the line stays a line of text. */
  .inline-action {
    display: inline-flex;
    margin-block: calc((var(--leading-sm) - var(--control-sm)) / 2);
    vertical-align: baseline;
  }

  /* Where a job lies when it is not in the inbox, and an ad that is offline: quiet. */
  .place-line {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  /* The note on the missing text, and the way to fetch it. */
  .missing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding-top: var(--space-20);
    border-top: var(--border-width) solid var(--border);
  }

  .why,
  .ad {
    gap: var(--space-16);
  }

  .section {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .summary {
    color: var(--text);
    font: var(--type-md);
  }

  /* The must requirements the profile lacks, each with its way into the profile. */
  .missing-musts {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .missing-must {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4) var(--space-12);
    font: var(--type-md);
  }

  .missing-term {
    color: var(--text-heading);
    font-weight: var(--weight-medium);
  }

  .added {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  /* The ad's terms: name, value and verdict in three columns that line up row by row (two
     without a profile: nothing to judge); the verdicts stand right after the widest value,
     not at the far edge. */
  .terms {
    display: grid;
    grid-template-columns: max-content minmax(0, max-content);
    gap: var(--space-8) var(--space-24);
    align-items: baseline;
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
    color: var(--text-muted);
  }

  .term-value {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .term-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-6);
  }

  .plain {
    color: var(--text);
  }

  .plain.open,
  .term-note,
  .term-profile {
    color: var(--text-subtle);
  }

  .verdict {
    font-weight: var(--weight-medium);
  }

  .verdict.met {
    color: var(--success-strong);
  }

  .verdict.violated {
    color: var(--danger-strong);
  }

  /* To check is info everywhere: navy, never amber. */
  .verdict.unknown {
    color: var(--info);
  }

  .verdict.unset {
    color: var(--text-subtle);
  }

  /* The groups of the requirements: navy sub-labels with a plain count (like the list's
     divider). */
  .sub {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--text-label);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .columns {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-16);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    min-width: 0;
  }

  /* The hover wash of a reason hangs out on both sides alike. */
  .reasons {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-inline: calc(-1 * var(--space-8));
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-md);
  }
</style>
