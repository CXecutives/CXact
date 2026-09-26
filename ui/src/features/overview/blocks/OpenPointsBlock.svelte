<!--
  "Offene Punkte": one row each, the most important first (the order is the model's
  `points`); a warning only where she has to act, else a calm note. A way on that fails
  says so at the end of the block.
-->
<script lang="ts">
  import type { IconName } from '$components/Icon.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import { overview, type Point } from '../model.svelte';
  import Block from './Block.svelte';

  let error = $state<string | null>(null);

  function actionOf(
    point: Point,
  ): { label: string; icon: IconName | null; onclick: () => void } | null {
    const action = point.action;
    if (action === null) return null;
    return {
      label: action.label,
      icon: action.icon ?? null,
      onclick: () => {
        error = null;
        void action.run().then((next) => (error = next));
      },
    };
  }
</script>

<Block testid="issues" heading={t.overview.issues} list="rows" {error}>
  {#each overview.points as point (point.id)}
    <Notice
      tone={point.tone}
      variant="row"
      heading={point.heading}
      text={point.text}
      action={actionOf(point)}
      testid="issue-{point.id}"
    />
  {/each}
</Block>
