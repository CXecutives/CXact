<!--
  The body of Willkommen (the harmony audit, 2026-10-28): one job as CXact shows it, calm and
  centred in the card. Its ring (the app's ScoreRing, 87, filling once as the step appears),
  its title 14/540 and under it the band 13/540 in the word colour of its ring, in a quiet box
  on the page's ground; under the box one sentence what the number means. A picture of a job,
  not a control: nothing in it reacts but the ring's tooltip.
-->
<script lang="ts">
  import ScoreRing from '$components/ScoreRing.svelte';
  import { t } from '$lib/i18n/t';

  /** The example's match: high, in the ring's step of 80 to 89. */
  const SCORE = 87;
</script>

<div class="welcome" data-testid="first-intro">
  <div class="job" data-testid="first-example">
    <ScoreRing ring={{ status: 'scored', score: SCORE, band: 'high' }} reveal />
    <span class="words">
      <span class="title">{t.firstRun.example}</span>
      <span class="band">{t.score.band.high}</span>
    </span>
  </div>
  <p class="text">{t.firstRun.exampleText}</p>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--setup-example-gap);
  }

  .job {
    display: flex;
    align-items: center;
    gap: var(--list-row-gap);
    max-width: 100%;
    padding: var(--setup-example-pad);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--page);
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    color: var(--text);
    font: var(--type-label);
  }

  /* The word colour of the ring's step (80 to 89). */
  .band {
    color: var(--score-text-8);
    font: var(--type-field-label);
  }

  .text {
    color: var(--text-muted);
    font: var(--type-sm);
    text-align: center;
    text-wrap: pretty;
  }
</style>
