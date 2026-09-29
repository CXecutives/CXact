<!--
  The run under the list header, one slim line in place of the old run card. While a fetch or
  the details of an ad run: a thin progress bar and one line of what happens ("Postfach wird
  gelesen", "Anzeigen 12 von 30", "Jobs werden bewertet"). A count moves on in place (tabular
  numbers); the next step cross-fades with the last in the same cell. "Abbrechen" stands in
  the header. What a fetch brought is a toast at its end ("5 neue Jobs",
  lib/state/run.svelte.ts); its details are in the log. A run that failed, a start that was
  refused or files that could not be written leave one note instead, drawn like every other
  note of the list column (Notice, a row in the warning tone): what went wrong, the failure's
  own way on (lib/state/run.svelte.ts failureAction: where the fix is, the log, or "Erneut
  versuchen" with its glyph where nothing else starts the run again; none beside a working
  "Postfach abrufen") and a × that hides it until the next run. A fetch that went well but paused a portal on its way (or found it at its limit)
  says so once in the same place, quietly ("freelancermap pausiert bis 14:00", with its ×).
  The line unfolds and folds away (lib/motion unfold), so the list below glides; its rows
  never flicker. The notes are hidden for now (`NOTES`, user 2026-09-29).
-->
<script lang="ts">
  import Meter from '$components/Meter.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { fade, unfold } from '$lib/motion/transitions';
  import {
    exportError,
    exportText,
    failureAction,
    LINE_NOTES,
    pausedText,
    run,
    type FailureAction,
  } from '$lib/state/run.svelte';

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

  /** The words of the step that goes fade out under the next one: out of the page's reach
   *  (no test id, nothing announced twice). */
  function leave(node: HTMLElement): ReturnType<typeof fade> {
    node.removeAttribute('data-testid');
    node.setAttribute('aria-hidden', 'true');
    return fade(node);
  }

  /** The log could not be opened (said in the line). */
  let openError = $state<string | null>(null);

  /** What went wrong in the last run, with the way on; null when all went well. */
  const problem = $derived.by((): { text: string; action: FailureAction | null } | null => {
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
      // Only the failure's own fix, as on the first-run page: never a second "fetch again"
      // beside "Postfach abrufen".
      return { text: t.error.text(error.kind, error.params), action: fix };
    }
    const files = exportText(exportError(summary));
    if (files !== null) {
      return {
        text: files,
        action: { label: t.common.retry, icon: 'retry', onclick: () => run.rewriteFiles() },
      };
    }
    return null;
  });

  /** The portals the last fetch of this session paused, when nothing went wrong. */
  const paused = $derived(run.result === null ? null : pausedText(run.result));

  /** What went wrong is a toast for now (LINE_NOTES, user 2026-09-29); the notes are kept
   *  should they come back. */
  const NOTES = LINE_NOTES;
</script>

{#if run.fetching}
  <div class="unfold" transition:unfold>
    <div class="line" data-testid="run-line">
      <Meter value={run.fraction} size="sm" label={t.toolbar.progress} testid="run-progress" />
      <span class="words">
        {#key run.step}<span class="doing" data-testid="run-text" in:fade out:leave>{doing}</span
          >{/key}
      </span>
    </div>
  </div>
{:else if NOTES && problem !== null && run.panel === 'open'}
  <div class="unfold" transition:unfold>
    <div class="line">
      <Notice
        tone="warning"
        variant="row"
        text={openError ?? problem.text}
        action={problem.action && !run.active
          ? {
              label: problem.action.label,
              icon: problem.action.icon ?? null,
              testid: 'run-retry',
              onclick: problem.action.onclick,
            }
          : null}
        dismiss={{ label: t.common.hide, testid: 'run-close', onclick: () => run.hide() }}
        testid="run-problem"
      />
    </div>
  </div>
{:else if NOTES && paused !== null && run.panel === 'open'}
  <div class="unfold" transition:unfold>
    <div class="line">
      <Notice
        tone="info"
        variant="row"
        text={paused}
        dismiss={{ label: t.common.hide, testid: 'run-close', onclick: () => run.hide() }}
        testid="run-paused"
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
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-top: var(--space-12);
  }

  /* One cell: the words of the next step fade in over the last ones. */
  .words {
    display: grid;
    min-height: var(--leading-sm);
  }

  .doing {
    grid-area: 1 / 1;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
