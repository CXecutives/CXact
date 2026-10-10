<!--
  The state of the open job, right under the job view's head, when it has one (design round
  7): one tinted box (Notice `box`) with its sign, one sentence and the one button that helps,
  on one line.
  - excluded: the red ban, "Ausgeschlossen", why (the profile's side) and "Trotzdem bewerten";
  - an ad still to come: "Anzeige laden" (being loaded: the spinner, no button);
  - only a preview without a sign-in: "Anmelden" (the sign-in right here,
    lib/state/portalSession.ts; then "Anzeige laden");
  - an ad the app cannot reach, gone or closed: the sentence only;
  - a text too short to score: the sentence only.
  A failed sign-in says so in a toast, like every result of the reader.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Notice from '$components/Notice.svelte';
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
    oninclude: (event: MouseEvent) => void;
  }
  let { detail, exclusion, includable, oninclude }: Props = $props();

  const job = $derived(detail.job);
  const detailKind = $derived(job.detail.kind);
  const portalState = $derived(app.state?.portals.find((p) => p.portal === job.portal) ?? null);
  /** "Anzeige laden" was pressed here: this job is in the run. */
  let requested = $state(false);
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
      (adNote === 'missing' || (adNote === 'teaser' && portalState.loginEnabled)),
  );
  /** The portal shows only a preview without a sign-in that is not set up. */
  const signInMissing = $derived(
    adNote === 'teaser' && portalState !== null && !portalState.loginEnabled,
  );

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

{#if exclusion !== null}
  <Notice
    tone="ban"
    variant="box"
    heading={t.score.excluded}
    text={exclusion}
    end={includable ? includeButton : null}
    testid="exclusion-box"
    signTestid="reader-ban"
    headingTestid="band"
    textTestid="exclusion"
  />
{:else if adNote !== null}
  {@const warn = adNote === 'unfetchable' || adNote === 'gone' || adNote === 'closed'}
  <Notice
    tone={warn ? 'warning' : 'info'}
    variant="box"
    busy={adNote === 'loading'}
    text={t.reader.adNote[adNote]}
    end={signInMissing || canLoad ? adButton : null}
    testid="reader-state"
    textTestid="detail-note"
  />
{:else if job.short}
  <Notice
    tone="info"
    variant="box"
    text={t.reader.short}
    testid="reader-state"
    textTestid="short-note"
  />
{/if}
