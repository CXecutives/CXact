<!--
  The setup, a mode of the shell of its own (App.svelte: no sidebar, no sidebar button, no
  Zurück and Vor in the top bar, no job view button; every switch of the view is refused
  while it stands). One step at a time from the table of steps.ts, every step in the frame of
  the Profil page (Page: the pages' column on the white, the view scrolls under the top bar's
  fade, nothing centred): at the column's top the step's heading flush left (no step
  indicator: every heading says where the user is, user 2026-10-10) (it takes the focus on every step, so a
  screen reader starts there), at most one sentence, its body (the snippet of its id; a form
  in one white group, tiles and the drop zone as white boxes with an edge on the page) and its foot right
  under it: Zurück at the left, the step's buttons at the right, the one primary last. Enter
  is the primary while the step can go on; the mouse's back button is Zurück
  (onboarding.svelte.ts). Usable down to the window's minimum, 480 x 360.

  The steps (docs/PLAN.md, Setup): Willkommen bei CXact with the two ways as tiles ("Aus
  Lebenslauf ausfüllen" with the sentence about the AI, "Selbst ausfüllen": a click goes on);
  Lebenslauf hochladen (the whole drop zone is one button and takes a dropped file,
  Upload.svelte; a failed evaluation comes back here and says why above it, and where no new
  try can work "Selbst ausfüllen" takes its place); Lebenslauf wird ausgewertet (a spinner
  before the heading and "Abbrechen"); Profil prüfen after the CV and Profil ausfüllen by hand
  (the whole Profil form; the foot stays at the window's bottom; "Weiter" is always on, marks
  what is missing and says it beside itself, and goes on once nothing is); Postfach verbinden
  (the mailbox form, "Überspringen" and "Verbinden"; Zurück and Überspringen stop a "Verbinden"
  that goes), once connected Postfach verbunden (the address and the alert portals' rows with
  "Alert anlegen"); Fertig ("Alles eingerichtet", or "Profil eingerichtet" without a mailbox,
  and "Zu den Jobs", no search).
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Button from '$components/Button.svelte';
  import Group from '$components/Group.svelte';
  import Icon from '$components/Icon.svelte';
  import Notice from '$components/Notice.svelte';
  import Page from '$components/Page.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { liftToasts } from '$lib/actions/liftToasts';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { fade } from '$lib/motion/transitions';
  import { inPortalOrder } from '$lib/portals';
  import { app } from '$lib/state/app.svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import MissingLine from '../shared/MissingLine.svelte';
  import ProfileView, { type MissingField } from '../profile/ProfileView.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';
  import NewProfileWays from '../shared/NewProfileWays.svelte';
  import PortalRow from '../shared/PortalRow.svelte';
  import { onboarding } from './onboarding.svelte';
  import { stepOf, type StepId } from './steps';
  import Upload from './Upload.svelte';

  const step = $derived(onboarding.step);
  const spec = $derived(stepOf(step));
  const walk = $derived(onboarding.walk);
  const back = $derived(spec.back(walk));
  const nextWords = $derived(spec.next?.(t, walk) ?? null);
  /** The long steps of the whole profile: their foot stays at the window's bottom. */
  const long = $derived(step === 'review' || step === 'self');
  /** Why the CV filled nothing, said above the drop zone (also before a try while the tries
   *  are used up). */
  const problem = $derived(
    onboarding.failure !== null
      ? t.profile.cvError[onboarding.failure]
      : (onboarding.error ?? (fromCv.limited ? t.profile.cvError.limit : null)),
  );
  /** The step's one primary: its way on, or "Selbst ausfüllen" where no evaluation can run. */
  const primary = $derived(
    step === 'upload' && onboarding.blocked
      ? { label: t.profile.byHand, testid: 'cv-self', onclick: () => onboarding.byHand() }
      : nextWords !== null
        ? { label: nextWords, testid: 'first-next', onclick: () => void next() }
        : null,
  );
  /** The foot holds something: Zurück, or a button of the step. */
  const footed = $derived(back !== null || primary !== null || step === 'reading');

  let busy = $state(false);
  /** The mailbox form signs in and counts (Zurück and Überspringen stop it first). */
  let checking = $state(false);
  let profileView = $state<ProfileView | null>(null);
  /** What the profile still lacks once Weiter asked (said beside it). */
  let flagged = $state<readonly MissingField[] | null>(null);
  let mailboxForm = $state<MailboxForm | null>(null);
  let heading = $state<HTMLElement | null>(null);
  let page = $state<HTMLElement | null>(null);

  /** The portals of alert mails, in the app's order. */
  const alertPortals = $derived(
    inPortalOrder(app.state?.portals ?? []).filter((p) => p.way === 'alert'),
  );

  onMount(() => onboarding.begin());

  // Every step starts at its top (the view scrolls, App.svelte) with the focus on its heading.
  let shown: StepId | null = null;
  $effect(() => {
    const now = step;
    if (now === shown) return;
    shown = now;
    void tick().then(() => {
      page?.parentElement?.scrollTo({ top: 0 });
      heading?.focus({ preventScroll: true });
    });
  });

  /** The step's primary (Enter while it can go on). */
  async function next(): Promise<void> {
    if (busy || nextWords === null) return;
    switch (step) {
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

  /** "Überspringen": a "Verbinden" that goes stops first. */
  function skip(): void {
    mailboxForm?.cancel();
    onboarding.go('done');
  }

  /** The foot of a long step sticks at the window's bottom over the form that scrolls under
   *  it, set apart by a hairline only then (it sticks one hairline below the window's edge,
   *  so the observer sees it cut). */
  let stuck = $state(false);
  function watchStuck(foot: HTMLElement): { destroy: () => void } {
    const observer = new IntersectionObserver(
      ([entry]) => (stuck = (entry?.intersectionRatio ?? 1) < 1),
      { threshold: [1] },
    );
    observer.observe(foot);
    return { destroy: () => observer.disconnect() };
  }
</script>

{#snippet alerts()}
  {#if app.hasMailbox}
    <Group testid="first-alerts">
      {#each alertPortals as portal (portal.portal)}<PortalRow {portal} setup />{/each}
    </Group>
  {:else}
    <Group><MailboxForm bind:this={mailboxForm} bind:busy={checking} /></Group>
  {/if}
{/snippet}

{#snippet body(id: StepId)}
  {#if id === 'way'}
    <NewProfileWays
      oncv={() => onboarding.byCv()}
      onself={() => onboarding.byHand()}
      testid="first-way"
    />
    <p class="text" data-testid="first-overview">{t.firstRun.overview}</p>
  {:else if id === 'upload'}
    {#if problem !== null}
      <Notice tone="danger" variant="inline" text={problem} testid="cv-error" />
    {/if}
    {#if !onboarding.blocked}
      <Upload onfile={(dropped) => void onboarding.read(dropped)} />
    {/if}
  {:else if id === 'review' || id === 'self'}
    <ProfileView bind:this={profileView} setup onflag={(fields) => (flagged = fields)} />
  {:else if id === 'alerts'}
    {@render alerts()}
  {:else if id === 'done'}
    <ul class="summary" data-testid="first-summary">
      <li><Icon name="success" /><span>{t.firstRun.summaryProfile}</span></li>
      <li class:later={!walk.mailbox}>
        <Icon name={walk.mailbox ? 'success' : 'unstated'} />
        <span>{walk.mailbox ? t.firstRun.summaryMailbox : t.firstRun.summaryMailboxLater}</span>
      </li>
    </ul>
  {/if}
{/snippet}

<!-- The step's buttons at the right, the primary last. -->
{#snippet ends()}
  {#if step === 'reading'}
    <Button
      variant="secondary"
      label={t.common.cancel}
      testid="cv-cancel"
      onclick={() => onboarding.cancelReading()}
    />
  {/if}
  {#if step === 'alerts' && !walk.mailbox}
    <Button variant="secondary" label={t.firstRun.skip} testid="first-skip" onclick={skip} />
  {/if}
  {#if primary !== null}
    <Button
      variant="primary"
      label={primary.label}
      loading={(busy && long) || (checking && step === 'alerts')}
      testid={primary.testid}
      onclick={primary.onclick}
    />
  {/if}
{/snippet}

<Page testid="first-run" bind:element={page}>
  {#key step}
    <section
      class="step"
      aria-labelledby="first-step-heading"
      data-testid="first-step"
      data-step={step}
      use:formKeys={{ save: () => void next() }}
      in:fade
    >
      <div class="top">
        <div class="heading">
          {#if step === 'reading'}
            <span class="spinner" data-testid="cv-reading"><Spinner label={null} /></span>
          {/if}
          <h1
            class="title"
            id="first-step-heading"
            tabindex="-1"
            bind:this={heading}
            data-testid="first-heading"
          >
            {spec.heading(t, walk)}
          </h1>
        </div>
        {#if step === 'alerts' && walk.mailbox}
          <p class="address" data-copy data-testid="first-address">{app.state?.mailbox.user}</p>
        {/if}
        {#if spec.text}<p class="text">{spec.text(t, walk)}</p>{/if}
      </div>
      {@render body(step)}
      {#if footed}
        <footer
          class="foot"
          class:sticky={long}
          class:stuck={long && stuck}
          data-testid="first-bar"
          use:watchStuck
          use:liftToasts={long}
        >
          {#if back !== null}
            <span class="back">
              <Button variant="ghost" label={t.common.back} testid="first-back" onclick={goBack} />
            </span>
          {/if}
          {#if long && flagged !== null}
            <span class="flag">
              <MissingLine fields={flagged} onjump={(field) => void profileView?.jump(field)} />
            </span>
          {/if}
          <span class="ends">{@render ends()}</span>
        </footer>
      {/if}
    </section>
  {/key}
</Page>

<style>
  /* The step under the indicator, a little further from it than the column's gap. */
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-20);
    padding-top: var(--space-8);
  }

  .top {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .spinner {
    display: inline-flex;
    flex: none;
    color: var(--icon-accent);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-xl);
    letter-spacing: var(--tracking-tight);
    outline: none;
  }

  .text {
    color: var(--text-muted);
    font: var(--type-md);
  }

  .address {
    color: var(--text);
    font: var(--type-label);
  }

  /* Fertig: what is set up, one line each, a skipped Postfach said as what is left. */
  .summary {
    display: grid;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .summary li {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--text);
    font: var(--type-md);
  }

  .summary li > :global(.icon) {
    color: var(--success);
  }

  .summary li.later {
    color: var(--text-muted);
  }

  .summary li.later > :global(.icon) {
    color: var(--text-subtle);
  }

  /* The foot on the page right under the step: Zurück's words on the column's edge, the
     buttons at the right; what is missing beside Weiter, in a narrow column on a line of its
     own above Zurück and Weiter. */
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-12);
  }

  .back {
    display: flex;
    margin-inline-start: calc(-1 * var(--ghost-inset));
  }

  .flag {
    display: flex;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  .ends {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-8);
    margin-inline-start: auto;
  }

  @container (width < 560px) {
    .flag {
      order: -1;
      flex-basis: 100%;
      justify-content: flex-start;
    }
  }

  /* A long step's foot stays at the window's bottom, on the page's ground over the form. */
  .sticky {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: calc(-1 * var(--border-width));
    padding: var(--space-12) 0 var(--space-16);
    border-top: var(--border-width) solid transparent;
    background-color: var(--layout-page);
    transition: border-color var(--dur-base) var(--ease-out);
  }

  .sticky.stuck {
    border-top-color: var(--border);
  }
</style>
