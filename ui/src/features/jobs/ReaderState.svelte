<!--
  The state of the open job in its hero, under the title, when it has one (the round 10
  draft): one StateBox, its title, one quiet sentence under it and the one button that helps;
  no sign (the ring is the job's mark), a spinner only while something is being done.
  - being scored after "Trotzdem bewerten": the spinner, "Der Job wird bewertet.";
  - excluded (the soft red): why (the profile's side), "Darum wurde der Job nicht bewertet.",
    "Trotzdem bewerten";
  - an ad still to come: "Die Anzeige ist noch nicht geladen.", "Anzeige laden" (being
    loaded: the spinner, "Die Anzeige wird geladen.", no button);
  - only a preview: its sign-in right here when none is set up (lib/state/portalSession.ts;
    then "Anzeige laden"), else "Anzeige laden" where the portal can load it;
  - an ad gone, out of reach or closed ("Beendet"), a text too short to score: the two lines
    only.
  A failed sign-in says so in a toast, like every result of the job view.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import StateBox from '$components/StateBox.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import type { JobDetail } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { portalSession, signInLocked } from '$lib/state/portalSession';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';

  interface Props {
    detail: JobDetail;
    /** Why the engine excludes the job (null: it does not). */
    exclusion: string | null;
    /** "Trotzdem bewerten" is there (an excluded job not scored by hand). */
    includable: boolean;
    /** "Trotzdem bewerten" was pressed and the job is being scored. */
    including: boolean;
    oninclude: (event: MouseEvent) => void;
  }
  let { detail, exclusion, includable, including, oninclude }: Props = $props();

  const job = $derived(detail.job);
  const detailKind = $derived(job.detail.kind);
  const portalState = $derived(app.state?.portals.find((p) => p.portal === job.portal) ?? null);
  /** "Anzeige laden" was pressed here: this job is in the run. */
  let requested = $state(false);
  type AdState = 'missing' | 'loading' | 'teaser' | 'gone' | 'unfetchable' | 'closed';
  /** Why the ad's text is not all there, if it is not. */
  const adState = $derived.by((): AdState | null => {
    switch (detailKind) {
      case 'ok':
        return job.closed ? 'closed' : null;
      case 'teaser':
      case 'gone':
      case 'unfetchable':
        return detailKind;
      default:
        // The text came before the job's state: it is there.
        if (detail.text !== null) return job.closed ? 'closed' : null;
        // Still to come, failed or on request: loaded while this job is in a run of its
        // portal (the one asked for here, or a fetch that loads what is still to come).
        return run.fetching &&
          portalState?.enabled === true &&
          (requested || detailKind === 'pending')
          ? 'loading'
          : 'missing';
    }
  });
  $effect(() => {
    if (!run.fetching) requested = false;
  });
  /** A preview or a missing ad the portal can load now (a preview only with its sign-in). */
  const canLoad = $derived(
    portalState?.enabled === true &&
      (adState === 'missing' || (adState === 'teaser' && portalState.loginEnabled)),
  );
  /** The portal shows only a preview without a sign-in that is not set up. */
  const signInMissing = $derived(
    adState === 'teaser' && portalState !== null && !portalState.loginEnabled,
  );

  /** The two lines of the ad's state. */
  const words = $derived.by((): { heading: string; text: string | null } | null => {
    switch (adState) {
      case null:
        return null;
      case 'loading':
        return { heading: t.reader.state.loading, text: null };
      case 'gone':
        return {
          heading: t.reader.state.gone.heading,
          text: detail.text === null ? t.reader.state.goneEarly : t.reader.state.gone.text,
        };
      default:
        return t.reader.state[adState];
    }
  });

  /** "Anzeige laden": this job's ad, in a run of its own. */
  function load(): void {
    requested = true;
    void run.start({ kind: 'details', keys: [job.key] });
  }

  /** "Anmelden": the portal's sign-in, right here. */
  let signingIn = $state(false);
  const signInLock = $derived(signInLocked());
  async function signIn(): Promise<void> {
    if (portalState === null) return;
    signingIn = true;
    try {
      await portalSession(portalState, true);
    } catch (error) {
      toasts.show(errorText(error), 'warning');
    } finally {
      signingIn = false;
    }
  }
</script>

{#snippet adButton()}
  {#if signInMissing}
    <Button
      variant="secondary"
      icon="signIn"
      label={t.settings.signIn}
      loading={signingIn}
      disabled={signInLock !== null}
      disabledReason={signInLock}
      testid="reader-sign-in"
      onclick={() => void signIn()}
    />
  {:else if canLoad}
    <Button
      variant="secondary"
      icon="details"
      label={t.reader.fetchDetails}
      disabled={run.detailsBlocked !== null}
      disabledReason={run.detailsBlocked}
      testid="load-ad"
      onclick={load}
    />
  {/if}
{/snippet}

{#snippet includeButton()}
  <Button
    variant="secondary"
    icon="add"
    label={t.actions.include}
    testid="reader-include"
    onclick={oninclude}
  />
{/snippet}

{#if including}
  <StateBox
    busy
    heading={t.reader.state.scoring}
    testid="reader-state"
    headingTestid="detail-note"
  />
{:else if exclusion !== null}
  <StateBox
    tone="ban"
    heading={exclusion}
    text={t.reader.state.excluded}
    end={includable ? includeButton : null}
    testid="exclusion-box"
    headingTestid="exclusion"
  />
{:else if words !== null}
  <StateBox
    busy={adState === 'loading'}
    heading={words.heading}
    text={words.text}
    end={signInMissing || canLoad ? adButton : null}
    testid="reader-state"
    headingTestid="detail-note"
    textTestid="detail-text"
  />
{:else if job.short}
  <StateBox
    heading={t.reader.state.short.heading}
    text={t.reader.state.short.text}
    testid="reader-state"
    headingTestid="short-note"
  />
{/if}
