<!-- Gallery: reason items and the job list with its entry and FLIP reordering; a click
     selects one job, its menu (a right click) archives it. -->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import JobRow from '$components/JobRow.svelte';
  import ListRow from '$components/ListRow.svelte';
  import ReasonItem, { REASON_KINDS } from '$components/ReasonItem.svelte';
  import type { JobView } from '$lib/ipc/types';
  import { flip, rise, rowCollapse } from '$lib/motion/transitions';
  import { toasts } from '$lib/state/toasts.svelte';
  import Section from './Section.svelte';
  import { sampleJobs, text } from './gallery';

  const t = text.match;
  const now = new Date();
  let jobs = $state(sampleJobs(now));
  /** The selected job (its id). */
  let chosen = $state('1001');

  function choose(job: JobView): void {
    chosen = job.key.id;
  }
  let run = $state(0);

  function shuffle(): void {
    jobs = [...jobs.slice(1), jobs[0]!];
  }

  /** Jobs the user moves out of the list: their rows fold away (a filter's would not). */
  let leaving = $state<string[]>([]);

  /** Archive: the row folds away, one toast that merges, one undo for all. */
  function archive(job: JobView): void {
    const index = jobs.findIndex((j) => j.key.id === job.key.id);
    leaving = [...leaving, job.key.id];
    jobs = jobs.filter((j) => j.key.id !== job.key.id);
    toasts.undoable(
      'gallery-archived',
      (n) => (n === 1 ? t.archived(job.title ?? '') : t.archivedMany(n)),
      t.undo,
      () => {
        leaving = leaving.filter((id) => id !== job.key.id);
        jobs = [...jobs.slice(0, index), job, ...jobs.slice(index)];
      },
    );
  }
</script>

<Section heading={t.reasons} id="reasons">
  <div class="reasons">
    {#each REASON_KINDS as kind, index (kind)}
      <ReasonItem {kind} label={t.reasonLabels[kind]} optional={index % 2 === 1} />
      <ReasonItem {kind} label={t.reasonLabels[kind]} hint={t.evidence} iconOnly />
    {/each}
  </div>
</Section>

<Section heading={t.rows} id="rows">
  <div class="actions">
    <Button label={t.shuffle} icon="retry" onclick={shuffle} testid="rows-shuffle" />
    <Button label={t.replay} variant="ghost" onclick={() => (run += 1)} />
  </div>
  {#key run}
    <div class="list" data-testid="job-list">
      {#each jobs as job (job.key.id)}
        <div
          animate:flip={{ count: jobs.length }}
          in:rise|global={{ distance: 'md', duration: 'base' }}
          out:rowCollapse={{ on: leaving.includes(job.key.id) }}
        >
          <JobRow
            {job}
            {now}
            selected={chosen === job.key.id}
            onselect={choose}
            menu={() => ({
              label: t.rows,
              entries: [
                { id: 'archive', label: t.archive, icon: 'archive', run: () => archive(job) },
              ],
            })}
          />
        </div>
      {/each}
      <ListRow>
        <span class="plain">{t.rows}</span>
      </ListRow>
    </div>
  {/key}
</Section>

<style>
  /* One column in the reader's width, like the reader lists them. */
  .reasons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(calc(var(--reader-width) / 2), 1fr));
    gap: var(--space-4) var(--space-24);
    max-width: var(--reader-width);
  }

  .actions {
    display: flex;
    gap: var(--space-12);
  }

  .list {
    max-width: var(--list-first-max);
    overflow: hidden;
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-card);
    background-color: var(--surface);
  }

  .plain {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
