<!--
  A state box under the Profil's head, or above the setup's form (ProfileView): it unfolds and
  folds away, so the rows below glide. The page's gap under it lies inside what unfolds, so
  nothing jumps by that gap when the fold starts or ends.
-->
<script lang="ts">
  import { unfold } from '$lib/motion/transitions';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="fold" transition:unfold>
  <div class="gap">{@render children()}</div>
</div>

<style>
  .fold {
    margin-bottom: calc(-1 * var(--group-section-gap));
  }

  .gap {
    padding-bottom: var(--group-section-gap);
  }
</style>
