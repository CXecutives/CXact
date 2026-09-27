<!--
  Job rows of the Übersicht like the list's (inside a Block with `list="jobs"`): the ring
  (empty without a usable profile), a job still waiting for its score, the inbox's tools
  and the star; a click opens the job in Jobs. What fails is said at the block (`onerror`).
-->
<script lang="ts">
  import JobRow from '$components/JobRow.svelte';
  import { t } from '$lib/i18n/t';
  import type { JobView } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { jobs, keyOf } from '$lib/state/jobs.svelte';
  import { jobMenu } from '../../jobs/actions';
  import { openJob } from '../lead';

  interface Props {
    list: readonly JobView[];
    /** The rows' test ids: `{prefix}-{portal}-{id}`. */
    prefix: string;
    onerror: (error: string | null) => void;
  }

  let { list, prefix, onerror }: Props = $props();

  /** The job's menu (a right click), like the list's; deleting for good is not offered here. */
  function menuOf(job: JobView): { label: string; entries: ReturnType<typeof jobMenu> } {
    return {
      label: t.menu.job,
      entries: jobMenu(job, { open: () => openJob(job), purge: () => undefined, report: onerror }),
    };
  }
</script>

{#each list as job (keyOf(job.key))}
  <JobRow
    {job}
    ring={app.hasProfile}
    pending={jobs.scoring && job.match === null}
    testid="{prefix}-{job.key.portal}-{job.key.id}"
    onselect={openJob}
    menu={() => menuOf(job)}
  />
{/each}
