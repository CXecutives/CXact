<!--
  The job view while a job's details load (JobsView shows it once loading takes 300 ms): the
  job view's shape in flat placeholders, so the pane never stands blank and nothing jumps when
  the job comes. The hero (the 56 ring, a line for the title and one for the band, the pills
  of the buttons), the Jobdetails in their two columns and lines of the ad's text, in the
  cards and the spacing of the job view (Reader.svelte), in the column of JobsView's stage.
-->
<script lang="ts" module>
  /** The widths (percent of their cell) of the facts' values, two columns a row. */
  const FACTS = [70, 55, 45, 60, 50, 40, 65, 35] as const;
  const LINES = [96, 88, 92, 60, 84, 72] as const;
  /** The pills of the hero's buttons. */
  const ACTIONS = [1, 2, 3] as const;
</script>

<script lang="ts">
  import Card from '$components/Card.svelte';
  import Skeleton from '$components/Skeleton.svelte';
</script>

<div class="cards" data-testid="reader-skeleton">
  <Card hero>
    <div class="top">
      <Skeleton shape="circle" size="md" />
      <div class="heads">
        <span class="title" data-testid="skeleton-title"><Skeleton width={70} /></span>
        <span class="band"><Skeleton width={30} /></span>
      </div>
    </div>
    <div class="actions">
      {#each ACTIONS as action (action)}<span class="action"><Skeleton /></span>{/each}
    </div>
  </Card>
  <Card>
    <span class="heading"><Skeleton width={100} /></span>
    <div class="facts">
      {#each FACTS as width, index (index)}
        <div class="fact" data-testid="skeleton-row">
          <Skeleton width={70} /><Skeleton {width} />
        </div>
      {/each}
    </div>
  </Card>
  <Card>
    <span class="heading"><Skeleton width={100} /></span>
    <div class="text">
      {#each LINES as width, index (index)}
        <span class="line" data-testid="skeleton-line"><Skeleton {width} /></span>
      {/each}
    </div>
  </Card>
</div>

<style>
  /* The cards 12 apart, in the job view's column (JobsView's stage sets it). */
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
  }

  /* The ring beside the title's line and the band's, the room of the hero's tools kept
     (ReaderHero). */
  .top {
    display: flex;
    align-items: center;
    gap: var(--hero-gap);
    padding-right: var(--hero-tools-room);
  }

  .heads {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--hero-band-gap);
  }

  .title {
    display: flex;
    align-items: center;
    height: var(--leading-xl);
  }

  .band {
    display: flex;
    align-items: center;
    height: var(--leading-sm);
  }

  .actions {
    display: flex;
    gap: var(--space-8);
    margin-top: var(--hero-gap);
    padding-top: var(--hero-gap);
    border-top: var(--border-width) solid var(--border);
  }

  .action {
    display: flex;
    align-items: center;
    width: calc(var(--control-field) * 4);
    height: var(--control-field);
  }

  .heading {
    display: flex;
    align-items: center;
    width: calc(var(--control-field) * 3);
    height: var(--leading-heading);
  }

  /* The facts' two columns: a label and its value. */
  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--space-20);
    margin-top: var(--facts-top);
  }

  .fact {
    display: grid;
    grid-template-columns: var(--facts-label) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6);
    height: calc(var(--leading-md) + 2 * var(--space-8));
  }

  .text {
    display: flex;
    flex-direction: column;
    margin-top: var(--ad-top);
  }

  .line {
    display: flex;
    align-items: center;
    height: var(--leading-body);
  }
</style>
