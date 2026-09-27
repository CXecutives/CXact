<!--
  The run under the list header, one slim line in place of the old run card. While a fetch or
  the details of an ad run: a thin progress bar and one line of what happens ("Postfach wird
  gelesen", "Anzeigen 12 von 30", "Jobs werden bewertet"), which cross-fades when it changes;
  "Abbrechen" stands in the header. What a fetch brought is a toast at its end ("5 neue
  Jobs", lib/state/run.svelte.ts); its details are in the log. A run that failed, a start
  that was refused or files that could not be written leave one quiet line instead: what
  went wrong, the way on ("Erneut versuchen", or where the fix is) and a × that hides it
  until the next run. The line unfolds and folds away (lib/motion unfold), so the list below
  glides; its rows never flicker.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Icon from '$components/Icon.svelte';
  import Meter from '$components/Meter.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { fade, unfold } from '$lib/motion/transitions';
  import { exportError, exportText, failureAction, run } from '$lib/state/run.svelte';

  /** What happens now, in one line. */
  const doing = $derived.by((): string => {
    const progress = run.step === null ? undefined : run.progress[run.step];
    switch (run.step) {
      case 'fetch':
        return progress && progress.total > 0
          ? t.run.line.ads(progress.done, progress.total)
          : t.run.line.adsStart;
      case 'score':
        return t.run.line.scoring;
      case 'export':
        return t.run.line.files;
      default:
        return t.run.line.mailbox;
    }
  });

  /** The log could not be opened (said in the line). */
  let openError = $state<string | null>(null);

  /** What went wrong in the last run, with the way on; null when all went well. */
  const problem = $derived.by(
    (): { text: string; action: { label: string; onclick: () => void } | null } | null => {
      if (run.startError !== null) return { text: run.startError, action: null };
      // The run this session followed, else the last fetch (the sidebar's status opens it).
      const summary = run.result ?? app.state?.lastRun ?? null;
      if (summary === null) return null;
      if (summary.outcome.kind === 'failed') {
        const error = summary.outcome.error;
        const fix = failureAction(summary, error, () => {
          openError = null;
          invoke('open_target', { target: { kind: 'logDir' } }).catch(
            (failure: unknown) => (openError = errorText(failure)),
          );
        });
        return {
          text: t.error.text(error.kind, error.params),
          action: fix ?? { label: t.common.retry, onclick: () => run.retry(summary) },
        };
      }
      const files = exportText(exportError(summary));
      if (files !== null) {
        return {
          text: files,
          action: { label: t.common.retry, onclick: () => run.rewriteFiles() },
        };
      }
      return null;
    },
  );
</script>

{#if run.fetching}
  <div class="unfold" transition:unfold>
    <div class="line" data-testid="run-line">
      <Meter value={run.fraction} size="sm" label={t.toolbar.progress} testid="run-progress" />
      <span class="words">
        {#key doing}<span class="doing" data-testid="run-text" in:fade>{doing}</span>{/key}
      </span>
    </div>
  </div>
{:else if problem !== null && run.panel === 'open'}
  <div class="unfold" transition:unfold>
    <div class="line problem" data-testid="run-problem" role="status">
      <span class="lead">
        <Icon name="warning" size="sm" />
        <span class="text" data-testid="run-problem-text">{openError ?? problem.text}</span>
      </span>
      <span class="ways">
        {#if problem.action && !run.active}
          <Button
            variant="link"
            size="sm"
            label={problem.action.label}
            testid="run-retry"
            onclick={problem.action.onclick}
          />
        {/if}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          label={t.common.hide}
          testid="run-close"
          onclick={() => run.hide()}
        />
      </span>
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
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-top: var(--space-12);
  }

  .words {
    display: grid;
    min-height: var(--leading-sm);
  }

  /* The old words fade out under the new ones in the same cell. */
  .doing {
    grid-area: 1 / 1;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .problem {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  .lead {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    color: var(--warning-strong);
  }

  .text {
    min-width: 0;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .ways {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    margin-right: calc(-1 * var(--ghost-inset));
  }
</style>
