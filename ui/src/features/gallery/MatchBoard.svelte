<!-- Gallery: reason items and the job list with its entry and FLIP reordering, and a mail
     app's selection (Ctrl/Cmd+click toggles, Shift+click a range, the selection bar). -->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Chip, { CHIP_STATES, type ChipState } from '$components/Chip.svelte';
  import type { IconName } from '$components/Icon.svelte';
  import JobRow from '$components/JobRow.svelte';
  import ListRow from '$components/ListRow.svelte';
  import ReasonItem, { REASON_KINDS, REASON_WEIGHTS } from '$components/ReasonItem.svelte';
  import type { JobView } from '$lib/ipc/types';
  import { flip, rise, rowCollapse } from '$lib/motion/transitions';
  import { toasts } from '$lib/state/toasts.svelte';
  import Section from './Section.svelte';
  import { sampleJobs, text } from './gallery';

  const t = text.match;
  const CHIP_ICON: Record<ChipState, IconName> = {
    met: 'check',
    unknown: 'unclear',
    violated: 'excluded',
    unset: 'unstated',
    plain: 'document',
  };
  const now = new Date();
  let jobs = $state(sampleJobs(now));
  /** The selected job (its id). */
  let chosen = $state('1001');

  function choose(job: JobView): void {
    chosen = job.key.id;
  }
  let active = $state<string | null>(null);
  let run = $state(0);

  function shuffle(): void {
    jobs = [...jobs.slice(1), jobs[0]!];
  }

  /** The row tools of the gallery: pin a sample job. */
  function toggle(job: JobView, field: 'pinned' | 'archived'): void {
    jobs = jobs.map((j) => {
      if (j.key.id !== job.key.id) return j;
      if (field === 'pinned') return { ...j, pinned: !j.pinned };
      return { ...j, place: j.place === 'archive' ? 'inbox' : 'archive' };
    });
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
      <ReasonItem
        {kind}
        label={t.reasonLabels[kind]}
        weight={REASON_WEIGHTS[index % REASON_WEIGHTS.length] ?? null}
        detail={kind === 'met' ? t.evidence : null}
        active={active === kind}
        onhover={(on) => (active = on ? kind : null)}
        onselect={() => undefined}
      />
    {/each}
    {#each REASON_KINDS as kind (kind)}
      <ReasonItem {kind} label={t.reasonLabels[kind]} compact />
    {/each}
  </div>
  <div class="chips">
    {#each CHIP_STATES as state (state)}
      <Chip
        {state}
        label={t.chipLabels[state]}
        icon={CHIP_ICON[state]}
        active={active === state}
        onhover={(on) => (active = on ? state : null)}
        onselect={state === 'plain' ? null : () => undefined}
      />
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
            onpin={(j) => toggle(j, 'pinned')}
            onarchive={archive}
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    margin-top: var(--space-16);
  }

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
