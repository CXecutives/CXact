<!--
  The bar at the foot of a view (the Profil's unsaved changes, the setup's "Dein Profil"; the
  round 10 draft): solid white with a hairline on top (no blur), docked at the view's bottom
  edge and as wide as the view; its content in the page's column (--page-max, 10 32 inside,
  16 at the sides in a narrow page), at least 50 high. At its left what it says or the way
  back (`children`: the muted sentence, or "Zurück"), at its right its buttons (`actions`, 8
  apart, the view's primary last on macOS and first on Windows as the caller orders them,
  each pair at least --button-pair-min wide). It slides up 8 px as it comes (150 ms) and
  fades as it goes. It ends the page (Page `foot`): the page is at least as high as the
  view, so under a short page it still stands at the bottom. The toast stack rises above it
  (`use:liftToasts`).
-->
<script lang="ts">
  import { liftToasts } from '$lib/actions/liftToasts';
  import { fade, rise } from '$lib/motion/transitions';
  import type { Snippet } from 'svelte';

  interface Props {
    /** The buttons at its end. */
    actions?: Snippet | null;
    testid?: string | null;
    /** What stands at its start (a sentence or the way back). */
    children?: Snippet;
  }

  let { actions = null, testid = null, children }: Props = $props();
</script>

<div
  class="bar"
  data-testid={testid ?? undefined}
  in:rise={{ distance: 'lg' }}
  out:fade
  use:liftToasts
>
  <div class="inner">
    <div class="start">{@render children?.()}</div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  /* Sticks to the view's bottom edge; the page above it scrolls under nothing. */
  .bar {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: 0;
    flex: none;
    margin-top: auto;
    border-top: var(--border-width) solid var(--border);
    background-color: var(--bar-surface);
  }

  .inner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8) var(--space-12);
    max-width: var(--page-max);
    min-height: var(--bar-min);
    margin: 0 auto;
    padding: var(--bar-pad-y) var(--page-side);
  }

  .start {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .actions {
    --btn-min: var(--button-pair-min);

    display: flex;
    flex: none;
    gap: var(--space-8);
    margin-left: auto;
  }

  @container page (width < 560px) {
    .inner {
      padding-inline: var(--page-side-narrow);
    }
  }
</style>
