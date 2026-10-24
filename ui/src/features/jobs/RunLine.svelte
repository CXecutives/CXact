<!--
  The run under the list header (ProgressStrip, the round 10 draft), in every place while a
  search or a rescore goes (never for one ad, which the job view's state box shows; decision
  22): the step in words without a count ("Postfach wird gelesen", "Portale werden
  durchsucht", "Anzeigen werden geladen", "Jobs werden bewertet"; a rescore after a save "Jobs
  werden neu bewertet"), at the right how far it is ("3 von 8": the portals that are done,
  the ads loaded, the jobs scored), and the meter, which never moves back
  (lib/state/run.svelte.ts). A run that waits for a sign-in says so ("Wartet auf die
  Anmeldung bei freelance.de") with "Anmelden", a link at the line's end (the strip keeps its
  height). What a search brought is the toast at its end,
  and so is what went wrong. "Abbrechen" stands in the header. The strip unfolds and folds
  away (lib/motion unfold), 10 under the search; its rows never flicker.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import ProgressStrip from '$components/ProgressStrip.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import type { Portal } from '$lib/ipc/types';
  import { unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import { portalSession } from '$lib/state/portalSession';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';

  /** A search or a rescore goes (loading one ad has its own state box). */
  const shown = $derived(run.searching || (run.active && run.kind === 'rescore'));

  /** How far a counted step is ("3 von 8"), null before it knows. */
  function counted(done: number, total: number): string | null {
    return total > 0 ? t.run.line.count(Math.min(done, total), total) : null;
  }

  /** What happens now, and how far it is. */
  const line = $derived.by((): { step: string; count: string | null } => {
    const waiting = run.loginNeeded;
    if (waiting !== null) return { step: t.run.line.waiting(t.portal[waiting]), count: null };
    const progress = run.step === null ? undefined : run.progress[run.step];
    const of = progress ? counted(progress.done, progress.total) : null;
    if (run.kind === 'rescore') return { step: t.run.line.rescore, count: of };
    switch (run.step) {
      case 'search':
        return { step: t.run.line.portals, count: counted(run.portalsDone, run.portalsTotal) };
      case 'fetch':
        return { step: t.run.line.ads, count: of };
      case 'score':
        return { step: t.run.line.scoring, count: of };
      default:
        return { step: t.run.line.mailbox, count: null };
    }
  });

  /** "Anmelden" of a run that waits: the portal's sign-in (lib/state/portalSession). */
  async function signIn(portal: Portal): Promise<void> {
    const state = app.state?.portals.find((each) => each.portal === portal);
    if (state === undefined) return;
    try {
      await portalSession(state, true);
    } catch (failure) {
      toasts.show(errorText(failure), 'warning');
    }
  }
</script>

{#snippet waiting()}
  {#if run.loginNeeded !== null}
    {@const portal = run.loginNeeded}
    <Button
      variant="link"
      label={t.run.line.signIn}
      icon="signIn"
      testid="run-sign-in"
      onclick={() => void signIn(portal)}
    />
  {/if}
{/snippet}

{#if shown}
  <div class="unfold" transition:unfold>
    <div class="line" data-testid="run-line">
      <ProgressStrip
        step={line.step}
        count={line.count}
        value={run.fraction}
        label={t.toolbar.progress}
        action={run.loginNeeded !== null ? waiting : null}
        testid="run"
      />
    </div>
  </div>
{/if}

<style>
  .unfold {
    display: flex;
    flex-direction: column;
  }

  /* Its room at its top: inside what unfolds, so nothing jumps when it comes or goes. */
  .line {
    padding-top: var(--list-strip-gap);
  }
</style>
