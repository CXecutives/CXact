<!--
  "Heute ansehen": the best scored jobs she has not opened yet, as list rows (a click opens
  the job in Jobs). When a query of the jobs failed, one danger note stands in its place with
  a retry, never an empty Übersicht that looks like "nothing new".
-->
<script lang="ts">
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import { overview } from '../model.svelte';
  import Block from './Block.svelte';
  import JobRows from './JobRows.svelte';

  let error = $state<string | null>(null);
</script>

{#if overview.failed}
  <Block testid="best-error">
    <Notice
      tone="danger"
      variant="row"
      text={t.list.loadFailed}
      action={{ label: t.common.retry, icon: 'retry', onclick: () => overview.retry() }}
      testid="overview-load-failed"
    />
  </Block>
{:else}
  <Block testid="best" heading={t.overview.today} list="jobs" {error}>
    <JobRows list={overview.best} prefix="best" onerror={(next) => (error = next)} />
  </Block>
{/if}
