<!--
  The comparison of the best jobs as one prompt for any AI chat: one place, right after the
  job blocks, while there is something to compare. A clipboard that refuses says so here.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { copyTopPrompt } from '../../jobs/prompt';
  import Block from './Block.svelte';

  let error = $state<string | null>(null);

  function copy(): void {
    error = null;
    void copyTopPrompt().then((next) => (error = next));
  }
</script>

<Block testid="compare" {error}>
  <span class="compare" use:tooltip={t.overview.promptTopHint}>
    <Button
      variant="ghost"
      size="sm"
      icon="prompt"
      label={t.overview.promptTop}
      testid="prompt-top"
      onclick={copy}
    />
  </span>
</Block>

<style>
  /* Its icon on the edge of the column (the button's padding hangs out). */
  .compare {
    display: flex;
    align-self: flex-start;
    margin-left: calc(-1 * var(--ghost-inset));
  }
</style>
