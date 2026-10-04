<!--
  The setup, a mode of the shell of its own (App.svelte: no sidebar, no sidebar button, no
  Zurück and Vor in the top bar, no job view button, the cream page; every switch of the view
  is refused while it stands). One step at a time from the table of steps.ts: near the top of
  the window, centred, the step indicator ("1 Profil", "2 Alert-Mails"; not on Willkommen) and
  under it one white card (440 px) with the step's heading
  (it takes the focus on every step, so a screen reader starts there), its one sentence, its
  body (the snippet of its id) and at its foot Zurück at the left and the step's one primary
  at the right. Enter is the primary while the step can go on; the mouse's back button is
  Zurück (onboarding.svelte.ts). Usable down to the window's minimum, 480 x 360: the card
  narrows, the page scrolls and the foot of a long card stays at the window's bottom.

  The steps (docs/PLAN.md, Block 4; design round 3): Willkommen; Wie legst du dein Profil an?
  (two tiles side by side, "Aus Lebenslauf" and "Selbst ausfüllen": a click goes on);
  Lebenslauf hochladen (the whole drop zone is one button and takes a dropped file,
  Upload.svelte, and the sentence about the AI in the foot); Auswertung (a spinner and
  "Abbrechen", or what went wrong as the heading with a warning sign and its ways on at the
  right, the primary last, CV_PROBLEMS); Profil prüfen after the CV and Profil ausfüllen by
  hand (design round 4: the whole Profil page on white in the pages' column instead of the
  card, the foot at the window's bottom; "Weiter" is always on, marks what is missing and says
  it beside itself, and goes on once nothing is); Alert-Mails, optional ("Überspringen" at the
  left, "Verbinden" the primary; once connected the portals' rows with "Alert anlegen", the
  same rows as in Einstellungen; Zurück and Überspringen stop a "Verbinden" that goes);
  Fertig ("Alles eingerichtet" under a green tick, "Zu den Jobs", no search).
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Icon from '$components/Icon.svelte';
  import Spinner from '$components/Spinner.svelte';
  import Steps from '$components/Steps.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { fade } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import MissingLine from '../shared/MissingLine.svelte';
  import ProfileView, { type MissingField } from '../profile/ProfileView.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';
  import NewProfileWays from '../shared/NewProfileWays.svelte';
  import PortalRow from '../shared/PortalRow.svelte';
  import { onboarding } from './onboarding.svelte';
  import { CV_PROBLEMS, stepOf, type CvWay, type StepId } from './steps';
  import Upload from './Upload.svelte';

  const step = $derived(onboarding.step);
  const spec = $derived(stepOf(step));
  const walk = $derived(onboarding.walk);
  const back = $derived(spec.back(walk));
  const nextWords = $derived(spec.next?.(t, walk) ?? null);
  const skip = $derived(spec.skip?.(walk) ?? false);
  /** The evaluation failed: its sentence is the heading, its ways stand in the foot. */
  const failed = $derived(
    step === 'reading' && (onboarding.failure !== null || onboarding.error !== null),
  );
  /** The ways on after a failure, the primary last (at the card's right edge). */
  const problemWays = $derived<readonly CvWay[]>(
    [
      ...(onboarding.failure === null ? (['self'] as const) : CV_PROBLEMS[onboarding.failure]),
    ].reverse(),
  );

  let busy = $state(false);
  /** The mailbox form signs in and counts (Zurück and Überspringen stop it first). */
  let checking = $state(false);
  let profileView = $state<ProfileView | null>(null);
  /** What the profile still lacks once Weiter asked (said beside it). */
  let flagged = $state<readonly MissingField[] | null>(null);
  let mailboxForm = $state<MailboxForm | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  /** The portals of alert mails, in the app's order. */
  const alertPortals = $derived(
    inPortalOrder(app.state?.portals ?? []).filter((p) => p.way === 'alert'),
  );
  const cvWords: Record<CvWay, () => string> = {
    retry: () => t.common.retry,
    otherFile: () => t.profile.otherFile,
    self: () => t.profile.byHand,
  };
  const cvDoes: Record<CvWay, () => void> = {
    retry: () => onboarding.retry(),
    otherFile: () => void onboarding.read(false),
    self: () => onboarding.byHand(),
  };

  onMount(() => onboarding.begin());

  // Every step starts at its top with the focus on its heading.
  let shown: StepId | null = null;
  $effect(() => {
    const now = step;
    if (now === shown) return;
    shown = now;
    void tick().then(() => {
      root?.scrollTo({ top: 0 });
      heading?.focus({ preventScroll: true });
    });
  });

  /** The step's primary (Enter while it can go on). */
  async function next(): Promise<void> {
    if (busy || nextWords === null) return;
    switch (step) {
      case 'welcome':
        onboarding.go('way');
        return;
      case 'review':
      case 'self':
        busy = true;
        try {
          if (await profileView?.next()) onboarding.go('alerts');
        } finally {
          busy = false;
        }
        return;
      case 'alerts':
        // Without a mailbox the primary is "Verbinden"; once connected it goes on.
        if (!app.hasMailbox) await mailboxForm?.save();
        else onboarding.go('done');
        return;
      case 'done':
        onboarding.leave();
        return;
      default:
        return;
    }
  }

  function goBack(): void {
    mailboxForm?.cancel();
    onboarding.back();
  }

  /** The foot sticks at the window's bottom over a card that scrolls under it. */
  let stuck = $state(false);
  function watchStuck(foot: HTMLElement): { destroy: () => void } {
    const observer = new IntersectionObserver(
      ([entry]) => (stuck = (entry?.intersectionRatio ?? 1) < 1),
      { threshold: [1] },
    );
    observer.observe(foot);
    return { destroy: () => observer.disconnect() };
  }

  /** "Überspringen": a "Verbinden" that goes stops first. */
  function skipStep(): void {
    mailboxForm?.cancel();
    onboarding.go('done');
  }
</script>

{#snippet alerts()}
  {#if app.hasMailbox}
    <p class="address" data-copy data-testid="first-address">{app.state?.mailbox.user}</p>
    <p class="text">{t.firstRun.alertsDone}</p>
    <Card padding="rows" testid="first-alerts">
      {#each alertPortals as portal (portal.portal)}<PortalRow {portal} />{/each}
    </Card>
  {:else}
    <MailboxForm bind:this={mailboxForm} bind:busy={checking} />
  {/if}
{/snippet}

{#snippet body(id: StepId)}
  {#if id === 'way'}
    <NewProfileWays
      oncv={() => onboarding.byCv()}
      onself={() => onboarding.byHand()}
      testid="first-way"
    />
  {:else if id === 'upload'}
    <Upload onfile={(dropped) => void onboarding.read(dropped)} />
  {:else if id === 'review' || id === 'self'}
    <ProfileView bind:this={profileView} setup onflag={(fields) => (flagged = fields)} />
  {:else if id === 'alerts'}
    {@render alerts()}
  {/if}
{/snippet}

<!-- The heading: a state's mark above it (the spinner, the tick), a failure's sign before it. -->
{#snippet head()}
  {#if step === 'reading' && !failed}
    <span class="mark" data-testid="cv-reading"><Spinner size="lg" label={null} /></span>
  {:else if step === 'done'}
    <span class="mark done"><Icon name="success" size="mark" /></span>
  {/if}
  <div class="heading">
    {#if failed}<span class="sign"><Icon name="warning" size="md" /></span>{/if}
    <h1
      class="title"
      id="first-step-heading"
      tabindex="-1"
      bind:this={heading}
      data-testid={failed ? 'cv-error' : 'first-heading'}
    >
      {#if failed}
        {onboarding.failure === null ? onboarding.error : t.profile.cvError[onboarding.failure]}
      {:else}
        {spec.heading(t)}
      {/if}
    </h1>
    {#if step === 'alerts'}<span class="optional">{t.firstRun.optional}</span>{/if}
  </div>
  {#if step === 'alerts' && !app.hasMailbox}
    <p class="text">{t.firstRun.alertsText(alertPortals.map((p) => p.portal))}</p>
  {:else if spec.text && !failed}
    <p class="text">{spec.text(t)}</p>
  {/if}
{/snippet}

<!-- The foot: Zurück (or Überspringen) at the left, the step's way on at the right. -->
{#snippet foot()}
  <span class="side">
    {#if skip}
      <Button variant="ghost" label={t.firstRun.skip} testid="first-skip" onclick={skipStep} />
    {:else if back !== null || failed}
      <Button variant="ghost" label={t.common.back} testid="first-back" onclick={goBack} />
    {/if}
  </span>
  {#if spec.page && flagged !== null}
    <span class="flag">
      <MissingLine fields={flagged} onjump={(field) => void profileView?.jump(field)} />
    </span>
  {/if}
  <span class="side end">
    {#if step === 'upload'}
      <span class="quiet" data-testid="upload-ai">{t.profile.fromCvHint}</span>
    {:else if failed}
      {#each problemWays as id, index (id)}
        <Button
          variant={index === problemWays.length - 1 ? 'primary' : 'secondary'}
          label={cvWords[id]()}
          testid="cv-{id}"
          onclick={cvDoes[id]}
        />
      {/each}
    {:else if step === 'reading'}
      <Button
        variant="secondary"
        label={t.common.cancel}
        testid="cv-cancel"
        onclick={() => onboarding.cancelReading()}
      />
    {:else if nextWords !== null}
      <Button
        variant="primary"
        label={nextWords}
        loading={(busy && (step === 'review' || step === 'self')) ||
          (checking && step === 'alerts')}
        testid="first-next"
        onclick={() => void next()}
      />
    {/if}
  </span>
{/snippet}

<div
  class="setup"
  class:white={spec.page}
  bind:this={root}
  data-testid="first-run"
  data-step={step}
  use:formKeys={{ save: () => void next() }}
>
  <div class="column" class:page={spec.page}>
    {#if spec.stage !== null}
      <Steps
        steps={t.firstRun.stages}
        current={spec.stage}
        label={t.firstRun.stepsLabel}
        testid="first-steps"
      />
    {/if}
    {#key step}
      <section
        class="card"
        class:page={spec.page}
        class:centred={spec.centred && !failed}
        aria-labelledby="first-step-heading"
        data-testid={failed ? 'cv-problem' : 'first-card'}
        in:fade
      >
        <div class="top">{@render head()}</div>
        {#if step !== 'reading' && step !== 'done' && step !== 'welcome'}{@render body(step)}{/if}
        <footer
          class="foot"
          class:alone={step === 'done'}
          class:stuck
          data-testid="first-bar"
          use:watchStuck
        >
          {@render foot()}
        </footer>
      </section>
    {/key}
  </div>
</div>

<style>
  /* The cream page scrolls; the column sits near the top, centred. */
  .setup {
    height: 100%;
    overflow-y: auto;
    background-color: var(--bg);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    width: 100%;
    max-width: calc(var(--setup-card) + 2 * var(--space-16));
    margin: 0 auto;
    padding: var(--setup-top) var(--space-16) var(--space-32);
  }

  /* The whole profile: the white page in the pages' column, no card. */
  .setup.white {
    background-color: var(--surface);
  }

  .column.page {
    max-width: calc(var(--page-width) + 2 * var(--pane-padding));
    padding-inline: var(--pane-padding);
    padding-bottom: 0;
  }

  .card.page {
    gap: var(--space-20);
    padding: 0;
    border: 0;
    border-radius: 0;
  }

  .card.page {
    container-type: inline-size;
  }

  .card.page .foot {
    flex-wrap: wrap;
    margin: 0 calc(-1 * var(--pane-padding));
    padding: var(--space-12) var(--pane-padding) var(--space-16);
    border-radius: 0;
  }

  /* What is still missing, beside Weiter; in a narrow window on a line of its own above
     Zurück and Weiter. */
  .flag {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  @container (width < 560px) {
    .flag {
      order: -1;
      flex-basis: 100%;
      justify-content: flex-start;
    }
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    padding: var(--space-20) var(--space-20) 0;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-card);
    background-color: var(--surface);
  }

  .top {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .centred .top {
    align-items: center;
    padding-top: var(--space-8);
    text-align: center;
  }

  .mark {
    display: inline-flex;
    margin-bottom: var(--space-12);
    color: var(--icon-accent);
  }

  .mark.done {
    color: var(--success);
  }

  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .sign {
    display: inline-flex;
    flex: none;
    color: var(--warning);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-xl);
    letter-spacing: var(--tracking-tight);
    outline: none;
  }

  .optional {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  .text {
    color: var(--text-muted);
    font: var(--type-md);
  }

  .address {
    color: var(--text);
    font: var(--type-body);
    font-weight: var(--weight-medium);
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The foot of the card: 16 above (the card's gap less its own top), the card's 20 below;
     Zurück's words start on the card's edge. In a low window it stays at the bottom while the
     card scrolls under it, set apart by a hairline only then (`stuck`: it sticks one hairline
     below the window's edge, so the observer sees it cut). */
  .foot {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: calc(-1 * var(--border-width));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    margin: calc(-1 * var(--space-12)) calc(-1 * var(--space-20)) 0;
    padding: var(--space-12) var(--space-20) var(--space-20);
    border-top: var(--border-width) solid transparent;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    background-color: var(--surface);
    transition: border-color var(--dur-base) var(--ease-out);
  }

  .foot.stuck {
    border-top-color: var(--border);
  }

  .foot.alone {
    justify-content: center;
  }

  .side {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    margin-inline-start: calc(-1 * var(--ghost-inset));
  }

  .side.end {
    justify-content: flex-end;
    margin-inline-start: 0;
  }

  .alone .side:not(.end) {
    display: none;
  }
</style>
