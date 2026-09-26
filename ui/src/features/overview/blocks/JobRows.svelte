<!--
  Job rows of the Übersicht like the list's (inside a Block with `list="jobs"`): the ring
  (empty without a usable profile), a job still waiting for its score, the inbox's tools
  and the star; a click opens the job in Jobs. What fails is said at the block (`onerror`).
-->
<script lang="ts">
  import JobRow, { type RowTool } from '$components/JobRow.svelte';
  import type { JobView } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import { actionsOf, guarded, move } from '../../jobs/actions';
  import { openJob } from '../lead';

  interface Props {
    list: readonly JobView[];
    /** The rows' test ids: `{prefix}-{portal}-{id}`. */
    prefix: string;
    onerror: (error: string | null) => void;
  }

  let { list, prefix, onerror }: Props = $props();

  function toolsOf(job: JobView): RowTool[] {
    return actionsOf('inbox').map((action) => ({
      id: action.id,
      icon: action.icon,
      label: action.label,
      onclick: () => {
        if (action.id !== 'archive' && action.id !== 'trash') return;
        onerror(null);
        void move([job], action.id).then(onerror);
      },
    }));
  }

  function pin(job: JobView): void {
    if (guarded()) return;
    onerror(null);
    void jobs.pin(job.key, !job.pinned).then(onerror);
  }
</script>

{#each list as job (keyOf(job.key))}
  <JobRow
    {job}
    ring={app.hasProfile}
    pending={jobs.scoring && job.match === null}
    testid="{prefix}-{job.key.portal}-{job.key.id}"
    onselect={openJob}
    onpin={pin}
    tools={toolsOf(job)}
  />
{/each}
