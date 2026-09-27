<!--
  What the reader's section "Anzeige" holds under its heading (Reader.svelte): the note on a
  text that is not all there (a preview, an ad still to come or being loaded, one the app
  cannot reach, gone or closed) with "Anzeige laden" or "Anmeldung einrichten" where they
  help, the quiet note on a very short text, and the ad's text in its structure with the words
  of the list's search marked (AdText.svelte).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Icon from '$components/Icon.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import type { JobDetail } from '$lib/ipc/types';
  import { fade } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import AdText from './AdText.svelte';

  interface Props {
    detail: JobDetail;
  }
  let { detail }: Props = $props();

  const job = $derived(detail.job);
  const detailKind = $derived(job.detail.kind);
  const portalState = $derived(app.state?.portals.find((p) => p.portal === job.portal) ?? null);
  /** "Anzeige laden" was pressed in this reader: this job is in the run. */
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

  /** "Anmeldung einrichten": Einstellungen at the card of this portal. */
  function setUpSignIn(): void {
    navigation.focusPortal = job.portal;
    navigation.go('settings');
  }
</script>

{#if adNote !== null}
  {@const warn = adNote === 'unfetchable' || adNote === 'gone' || adNote === 'closed'}
  <!-- One line that stays while its words change (being loaded: the spinner in the place
       of its icon), with the way to the ad where it helps. -->
  <div class="ad-note">
    <p class="note" class:warning={warn} role={warn ? 'alert' : 'status'} data-testid="detail-note">
      {#if adNote === 'loading'}<Spinner size="sm" label={null} />{:else}<Icon
          name={warn ? 'warning' : 'info'}
          size="sm"
        />{/if}{t.reader.adNote[adNote]}
    </p>
    {#if signInMissing}
      <Button
        variant="secondary"
        size="field"
        icon="signIn"
        label={t.reader.setUpSignIn}
        testid="set-up-sign-in"
        onclick={setUpSignIn}
      />
    {:else if canLoad}
      <Button
        variant="secondary"
        size="field"
        icon="details"
        label={t.reader.fetchDetails}
        disabled={run.detailsBlocked !== null}
        disabledReason={run.detailsBlocked}
        testid="load-ad"
        onclick={load}
      />
    {/if}
  </div>
{:else if job.short}
  <Notice tone="info" variant="inline" text={t.reader.short} testid="short-note" />
{/if}
{#if detail.text}
  <div in:fade>
    <AdText text={detail.text} layout={detail.layout} search={jobs.search} />
  </div>
{/if}

<style>
  /* The note on a text that is not all there, and the way to it: one height with and without
     its button, so nothing below jumps when the button goes. */
  .ad-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
    min-height: var(--control-field);
  }

  /* The note, like an inline notice: its icon (or the spinner) and its words in its tone. */
  .note {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--info-strong);
    font: var(--type-sm);
  }

  .note.warning {
    color: var(--warning-strong);
  }
</style>
