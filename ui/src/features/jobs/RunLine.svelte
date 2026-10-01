<!--
  The run under the list header, one slim line in place of the old run card. While a fetch or
  the details of an ad run: a thin progress bar and one line of what happens ("Postfach wird
  gelesen", "Anzeigen 12 von 30", "Jobs werden bewertet"). A count moves on in place (tabular
  numbers); the next step cross-fades with the last in the same cell. "Abbrechen" stands in
  the header. What a fetch brought is a toast at its end ("5 neue Jobs"), and so is what went
  wrong (lib/state/run.svelte.ts); its details are in the log. The line unfolds and folds away
  (lib/motion unfold), so the list below glides; its rows never flicker.
-->
<script lang="ts">
  import Meter from '$components/Meter.svelte';
  import { t } from '$lib/i18n/t';
  import { fade, unfold } from '$lib/motion/transitions';
  import { run } from '$lib/state/run.svelte';

  /** What happens now, in one line. */
  const doing = $derived.by((): string => {
    const progress = run.step === null ? undefined : run.progress[run.step];
    switch (run.step) {
      case 'fetch':
        return progress && progress.total > 0
          ? t.run.line.ads(progress.done, progress.total)
          : t.run.line.adsStart;
      case 'search':
        return run.status?.code === 'searching' && run.status.portal !== null
          ? t.run.line.search(t.portal[run.status.portal])
          : t.run.line.searchStart;
      case 'score':
        return t.run.line.scoring;
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
