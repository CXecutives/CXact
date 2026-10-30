<!--
  The setup, a mode of the shell of its own (App.svelte: no sidebar, the top bar holds only
  the window buttons; every switch of the view is refused while it stands). One step at a
  time from the table of steps.ts (the round 10 draft): a card centred on the window's cream
  (SetupCard), its head (the app's mark, a tile, the spinner or the full ring; the heading
  and the lead), the step's body and its foot (Zurück at the left, the step's buttons at the
  right); the profile is a whole page with its bar at the foot instead (ProfileStep). A step
  comes in sliding 8 px from the side it was reached from. Every step starts at its top with
  the focus on its heading. Enter is the primary while the step can go on; the mouse's back
  button is Zurück (onboarding.svelte.ts). Usable down to the window's minimum, 480 x 360.

  The steps (docs/PLAN.md, Setup): Willkommen (what CXact does, one job with its ring,
  Loslegen);
  Profil anlegen (the two ways as tiles, a click goes on); Lebenslauf hochladen (the whole
  drop zone is one button and takes a dropped file, Upload.svelte; a failed evaluation comes
  back here and says why); Lebenslauf wird ausgewertet (the spinner and Abbrechen, which stops
  it); Dein Profil (the whole Profil form, Weiter); Postfach verbinden, optional (the mailbox
  form, Überspringen and Verbinden in the OS order; Zurück and Überspringen stop a Verbinden
  that goes); Fertig (the full ring, "Alles eingerichtet", or "Profil eingerichtet" without a
  mailbox, and "Zu den Jobs", no search).
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AppMark from '$components/AppMark.svelte';
  import Button from '$components/Button.svelte';
  import IconTile from '$components/IconTile.svelte';
  import ScoreRing from '$components/ScoreRing.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { enterStep } from '$lib/motion/enter';
  import { primaryFirst } from '$lib/platform';
  import { fromCv } from '../shared/fromCv.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';
  import NewProfileWays from '../shared/NewProfileWays.svelte';
  import { onboarding } from './onboarding.svelte';
  import ProfileStep from './ProfileStep.svelte';
  import SetupCard from './SetupCard.svelte';
  import { STEPS, stepOf, type StepId } from './steps';
  import Upload from './Upload.svelte';
  import Welcome from './Welcome.svelte';

  const step = $derived(onboarding.step);
  const spec = $derived(stepOf(step));
  const walk = $derived(onboarding.walk);
  const back = $derived(spec.back(walk));
  const nextWords = $derived(spec.next?.(t) ?? null);
  /** The pair's order: the primary first on Windows, last on macOS. */
  const actionFirst = primaryFirst();

  /** The direction the step was reached from: forward slides in from the right (null: no
   *  step change yet, the first step is simply there). Before the DOM updates, so the new
   *  step comes in from the side it was reached from, not from the last one's. */
  let forward = $state<boolean | null>(null);
  let lastIndex: number | null = null;
  $effect.pre(() => {
    const index = STEPS.findIndex((each) => each.id === step);
    if (lastIndex !== null && index !== lastIndex) forward = index > lastIndex;
    lastIndex = index;
  });

  /** Why the CV filled nothing, said above the drop zone (also before a try while the tries
   *  are used up). */
  const problem = $derived(
    onboarding.failure !== null
      ? t.profile.cvError[onboarding.failure]
      : (onboarding.error ?? (fromCv.limited ? t.profile.cvError.limit : null)),
  );

  /** The mailbox form signs in and counts (Zurück and Überspringen stop it first). */
  let checking = $state(false);
  let mailboxForm = $state<MailboxForm | null>(null);
  let profileStep = $state<ProfileStep | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);

  onMount(() => onboarding.begin());

  // Every step starts at its top (the view scrolls, App.svelte) with the focus on its heading.
  let shown: StepId | null = null;
  $effect(() => {
    const now = step;
    if (now === shown) return;
    shown = now;
    void tick().then(() => {
      root?.parentElement?.scrollTo({ top: 0 });
      heading?.focus({ preventScroll: true });
    });
  });

  /** The step's primary (Enter while it can go on). */
  async function next(): Promise<void> {
    switch (step) {
      case 'welcome':
        onboarding.go('way');
        return;
      case 'profile':
        await profileStep?.next();
        return;
      case 'alerts':
        if (await mailboxForm?.save()) onboarding.go('done');
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

  /** "Überspringen": a "Verbinden" that goes stops first. */
  function skip(): void {
    mailboxForm?.cancel();
    onboarding.go('done');
  }
</script>

<!-- What stands at the top of the card. -->
{#snippet top()}
  {@const head = spec.top}
  {#if head?.kind === 'mark'}
    <AppMark />
  {:else if head?.kind === 'tile'}
    <IconTile tone="accent" icon={head.icon} />
  {:else if head?.kind === 'spinner'}
    <span class="mark" data-testid="cv-reading"><Spinner size="xl" label={null} /></span>
  {:else if head?.kind === 'success'}
    <span class="mark" data-testid="first-success">
      <ScoreRing ring={{ status: 'scored', score: 100, band: 'high' }} size="setup" reveal done />
    </span>
  {/if}
{/snippet}

{#snippet body()}
  {#if step === 'welcome'}
    <Welcome />
  {:else if step === 'way'}
    <NewProfileWays
      oncv={() => onboarding.byCv()}
      onself={() => onboarding.byHand()}
      testid="first-way"
    />
  {:else if step === 'upload'}
    <Upload
      {problem}
      failed={onboarding.failure !== null}
      blocked={onboarding.blocked}
      onfile={(dropped) => void onboarding.read(dropped)}
      onself={() => onboarding.byHand()}
    />
  {:else if step === 'alerts'}
    <MailboxForm bind:this={mailboxForm} bind:busy={checking} />
  {/if}
{/snippet}

{#snippet skipButton()}
  <Button variant="ghost" label={t.firstRun.skip} testid="first-skip" onclick={skip} />
{/snippet}

<!-- The step's buttons at the right; a pair in the OS order. -->
{#snippet actions()}
  {#if step === 'reading'}
    <Button
      variant="secondary"
      icon="cancel"
      label={t.common.cancel}
      testid="cv-cancel"
      onclick={() => onboarding.cancelReading()}
    />
  {/if}
  {#if step === 'alerts' && !actionFirst}{@render skipButton()}{/if}
  {#if nextWords !== null}
    <Button
      variant="primary"
      label={nextWords}
      trailing={spec.onward ? 'next' : null}
      loading={checking && step === 'alerts'}
      testid="first-next"
      onclick={() => void next()}
    />
  {/if}
  {#if step === 'alerts' && actionFirst}{@render skipButton()}{/if}
{/snippet}

<div class="setup" data-testid="first-run" bind:this={root}>
  {#key step}
    <section
      class="step"
      aria-labelledby="first-step-heading"
      data-testid="first-step"
      data-step={step}
      use:formKeys={step === 'alerts'
        ? { save: () => void next(), cancel: () => mailboxForm?.cancel() }
        : { save: () => void next() }}
      use:enterStep={{ forward: step === 'profile' ? forward : null }}
    >
      {#if step === 'profile'}
        <ProfileStep
          bind:this={profileStep}
          bind:headingElement={heading}
          heading={spec.heading(t, walk)}
          lead={spec.lead(t, walk)}
          onback={goBack}
          ondone={() => onboarding.go('alerts')}
        />
      {:else}
        <SetupCard
          bind:headingElement={heading}
          heading={spec.heading(t, walk)}
          lead={spec.lead(t, walk)}
          onback={back !== null ? goBack : null}
          centred={step === 'reading'}
          {top}
          body={step === 'reading' || step === 'done' ? null : body}
          {actions}
          {forward}
        />
      {/if}
    </section>
  {/key}
</div>

<style>
  /* At least as high as the view; the step fills it (its card centred, its page's bar at
     the bottom). */
  .setup {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .step {
    display: grid;
    flex: 1;
  }

  .mark {
    display: inline-flex;
  }
</style>
