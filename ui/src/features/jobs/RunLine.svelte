<!--
  The run under the list header, one slim line. While a search runs (never for one ad, which
  its ad section shows): a thin progress bar and what happens ("Postfach wird gelesen",
  "Portale werden durchsucht, 3 von 8 fertig", "Anzeigen werden geladen, 12 von 30 fertig",
  "Jobs werden bewertet"), no portal named since the portals run side by side; under it, once
  the portals brought some, "Bisher 12 neue Jobs", on a line kept from the start of the search
  so nothing moves when it comes. The bar follows the portals that are done, then the ads, and never moves back
  (lib/state/run.svelte.ts). A count moves on in place (tabular numbers); the next step
  cross-fades with the last in the same cell. "Abbrechen" stands in the header. What a fetch
  brought is a toast at its end, and so is what went wrong. The line unfolds and folds away
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
        return run.portalsTotal > 0
          ? t.run.line.portals(run.portalsDone, run.portalsTotal)
          : t.run.line.portalsStart;
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

{#if run.searching}
  <div class="unfold" transition:unfold>
    <div class="line" data-testid="run-line">
      <Meter value={run.fraction} size="sm" label={t.toolbar.progress} testid="run-progress" />
      <span class="words">
        {#key run.step}<span class="doing" data-testid="run-text" in:fade out:leave>{doing}</span
          >{/key}
      </span>
      <span class="words">
        {#if run.newSoFar > 0}
          <span class="doing" data-testid="run-new" transition:fade
            >{t.run.line.newSoFar(run.newSoFar)}</span
          >
        {/if}
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

  /* One cell of one line, there from the start: the words of the next step fade in over the
     last ones, and the new jobs so far come into a line kept for them. */
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
