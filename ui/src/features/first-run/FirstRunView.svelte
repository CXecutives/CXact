<!--
  The setup, a mode of the shell of its own (App.svelte: no sidebar, no sidebar button, no
  Zurück and Vor in the top bar, no job view button; every switch of the view is refused while
  it stands). One step at a time from the table of steps.ts, in one centred column (a form's
  measure; the profile's step takes the Profil's): the step's heading (it takes the focus on
  every step, so a screen reader starts there), its one sentence, its body (the snippet of its
  id) and at the bottom of the window Zurück and the step's one primary. Enter is the primary
  while the step can go on; the mouse's back button is Zurück (onboarding.svelte.ts). Usable
  down to the window's minimum, 480 x 360: the column scrolls, the buttons stay at the bottom.

  The steps (docs/PLAN.md, Block 4): Willkommen; Weg wählen (the CV, recommended, or by hand);
  Upload (shared drop zone, Upload.svelte); Auswertung (a spinner and "Abbrechen", or what went
  wrong in one sentence with its ways on, CV_PROBLEMS); Prüfen und ergänzen (the Profil view in
  its setup mode: its "Weiter" saves); Alert-Mails, optional ("Überspringen"; the mailbox form,
  then the portals' rows with "Alert anlegen", the same rows as in Einstellungen; Zurück and
  Überspringen stop a "Verbinden" that goes); Fertig ("Alles eingerichtet", "Zu den Jobs", no
  search). After "Zurücksetzen" what could not be deleted stands as a warning on Willkommen
  with the way to the log; a clean reset says so once in a toast.
-->
<script lang="ts" module>
  /** The toast of a clean reset shows once per start of the app. */
  let told = false;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import BrandMark from '$components/BrandMark.svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import IconTile from '$components/IconTile.svelte';
  import Notice from '$components/Notice.svelte';
  import RadioList, { type RadioListOption } from '$components/RadioList.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { formKeys } from '$lib/input/input';
  import { invoke } from '$lib/ipc/api';
  import { fade } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import ProfileView from '../profile/ProfileView.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';
  import PortalRow from '../shared/PortalRow.svelte';
  import { onboarding } from './onboarding.svelte';
  import { CV_PROBLEMS, stepOf, type CvWay, type StepId, type Way } from './steps';
  import Upload from './Upload.svelte';

  const step = $derived(onboarding.step);
  const spec = $derived(stepOf(step));
  const walk = $derived(onboarding.walk);
  const back = $derived(spec.back(walk));
  const nextWords = $derived(spec.next?.(t, walk) ?? null);
  /** Without a mailbox the form's "Verbinden" is the step's primary, "Überspringen" beside. */
  const nextVariant = $derived(step === 'alerts' && !app.hasMailbox ? 'secondary' : 'primary');

  let busy = $state(false);
  /** The mailbox form signs in and counts (Zurück and Überspringen stop it first). */
  let checking = $state(false);
  let profileView = $state<ProfileView | null>(null);
  let mailboxForm = $state<MailboxForm | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  const WAYS = $derived<RadioListOption<Way>[]>([
    { id: 'cv', label: t.profile.fromCv, note: t.profile.fromCvHint },
    { id: 'self', label: t.profile.byHand },
  ]);
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
    otherFile: () => void onboarding.read(null),
    self: () => onboarding.byHand(),
  };

  onMount(() => {
    onboarding.begin();
    const reset = app.state?.resetReport ?? null;
    if (reset !== null && reset.failed === 0 && !told) {
      told = true;
      toasts.show(t.settings.resetDone);
    }
  });

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
      case 'way':
        onboarding.go(onboarding.way === 'cv' ? 'upload' : 'review');
        return;
      case 'review':
        busy = true;
        try {
          if (await profileView?.next()) onboarding.go('alerts');
        } finally {
          busy = false;
        }
        return;
      case 'alerts':
        // A "Verbinden" that goes stops first.
        mailboxForm?.cancel();
        onboarding.go('done');
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

  /** What could not be deleted by the reset: its way to the log. */
  const resetLeft = $derived(app.state?.resetReport?.failed ?? 0);
  let logError = $state<string | null>(null);
  function openLog(): void {
    logError = null;
    invoke('open_target', { target: { kind: 'logDir' } }).catch(
      (error: unknown) => (logError = errorText(error)),
    );
  }
</script>

{#snippet welcome()}
  {#if resetLeft > 0}
    <Notice
      tone="warning"
      text={t.settings.resetPartly(resetLeft)}
      action={{ label: t.common.openLog, icon: 'folder', onclick: openLog }}
      testid="first-reset-report"
    />
    {#if logError}<Notice tone="danger" variant="inline" text={logError} />{/if}
  {/if}
{/snippet}

{#snippet way()}
  <RadioList
    options={WAYS}
    value={onboarding.way}
    label={t.firstRun.way}
    testid="first-way"
    onchange={(id) => (onboarding.way = id)}
  />
{/snippet}

{#snippet reading()}
  {#if onboarding.failure !== null || onboarding.error !== null}
    {@const ways =
      onboarding.failure === null ? (['self'] as const) : CV_PROBLEMS[onboarding.failure]}
    <div class="problem" data-testid="cv-problem">
      <IconTile icon="warning" tone="danger" size="lg" />
      <p class="sentence" data-testid="cv-error">
        {onboarding.failure === null ? onboarding.error : t.profile.cvError[onboarding.failure]}
      </p>
      <div class="ways">
        {#each ways as id, index (id)}
          <Button
            variant={index === 0 ? 'primary' : 'secondary'}
            label={cvWords[id]()}
            testid="cv-{id}"
            onclick={cvDoes[id]}
          />
        {/each}
      </div>
    </div>
  {:else}
    <div class="reading" data-testid="cv-reading">
      <Spinner size="lg" label={null} />
      <p class="quiet">{t.profile.fromCvHint}</p>
      <Button
        variant="secondary"
        label={t.common.cancel}
        testid="cv-cancel"
        onclick={() => onboarding.cancelReading()}
      />
    </div>
  {/if}
{/snippet}

{#snippet alerts()}
  {#if app.hasMailbox}
    <p class="address" data-copy data-testid="first-address">{app.state?.mailbox.user}</p>
    <p class="text">{t.firstRun.alertsDone}</p>
    <Card padding="rows" testid="first-alerts">
      {#each alertPortals as portal (portal.portal)}<PortalRow {portal} />{/each}
    </Card>
  {:else}
    <p class="text">{t.firstRun.alertsText(alertPortals.map((p) => p.portal))}</p>
    <MailboxForm bind:this={mailboxForm} bind:busy={checking} />
  {/if}
{/snippet}

{#snippet body(id: StepId)}
  {#if id === 'welcome'}
    {@render welcome()}
  {:else if id === 'way'}
    {@render way()}
  {:else if id === 'upload'}
    <Upload onfile={(path) => void onboarding.read(path)} />
  {:else if id === 'reading'}
    {@render reading()}
  {:else if id === 'review'}
    <ProfileView bind:this={profileView} onboarding />
  {:else if id === 'alerts'}
    {@render alerts()}
  {/if}
{/snippet}

{#snippet primary()}
  {#if nextWords !== null}
    <Button
      variant={nextVariant}
      label={nextWords}
      loading={busy && step === 'review'}
      testid="first-next"
      onclick={() => void next()}
    />
  {/if}
{/snippet}

<div
  class="setup"
  bind:this={root}
  data-testid="first-run"
  data-step={step}
  use:formKeys={{ save: () => void next() }}
>
  <div class="column" class:wide={spec.wide}>
    {#key step}
      <section class="step" aria-labelledby="first-step-heading" in:fade>
        {#if step === 'welcome'}<BrandMark size="lg" />{/if}
        <h1
          class="title"
          id="first-step-heading"
          tabindex="-1"
          bind:this={heading}
          data-testid="first-heading"
        >
          {spec.heading(t)}
        </h1>
        {#if spec.text}<p class="text">{spec.text(t)}</p>{/if}
        {@render body(step)}
      </section>
    {/key}
  </div>
  {#if back !== null || nextWords !== null}
    <footer class="bar" class:wide={spec.wide} data-testid="first-bar">
      <span class="back">
        {#if back !== null}
          <Button variant="ghost" label={t.common.back} testid="first-back" onclick={goBack} />
        {/if}
      </span>
      <span class="next">{@render primary()}</span>
    </footer>
  {/if}
</div>

<style>
  /* The column scrolls; the buttons stay at the bottom of the window. */
  .setup {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
  }

  .column {
    flex: 1 0 auto;
    width: 100%;
    max-width: calc(var(--form-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--space-32) var(--pane-padding) var(--space-24);
  }

  .column.wide {
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-2xl);
    letter-spacing: var(--tracking-tight);
    outline: none;
  }

  .text,
  .address {
    color: var(--text-muted);
    font: var(--type-body);
  }

  .address {
    color: var(--text);
    font-weight: var(--weight-medium);
  }

  .quiet {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .reading,
  .problem {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-16);
    padding-block: var(--space-24);
    text-align: center;
  }

  .sentence {
    color: var(--text);
    font: var(--type-body);
  }

  .ways {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-12);
  }

  /* Zurück at the left, the primary at the right, on the column's edges; sticky at the
     bottom of the window over the content that scrolls under it. */
  .bar {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: 0;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    width: 100%;
    max-width: calc(var(--form-width) + 2 * var(--pane-padding));
    margin: 0 auto;
    padding: var(--space-12) var(--pane-padding);
    background-color: var(--surface);
  }

  .bar.wide {
    max-width: calc(var(--reader-width) + 2 * var(--pane-padding));
  }

  .back,
  .next {
    display: flex;
  }
</style>
