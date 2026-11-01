<!--
  The bar at the foot of a view (the setup's "Dein Profil"; the round 10 draft): solid white
  with a hairline on top (no blur), under what scrolls and not in it (`shell.foot`, App), so
  it reaches the window's edges past the view's scrollbar and nothing ever lies under it; its
  content in the page's column (--page-max, 10 32 inside, 16 at the sides in a narrow page), at
  least 50 high. At its left what it says or the way back (`children`: the muted sentence, or
  "Zurück"), at its right its buttons (`actions`, 8 apart, the view's primary last on macOS and
  first on Windows as the caller orders them, each pair at least --button-pair-min wide). It
  comes and goes with its page, without a motion of its own. The toast stack rises above it
  (`use:liftToasts`).
-->
<script lang="ts">
  import { liftToasts } from '$lib/actions/liftToasts';
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

<div class="bar" data-testid={testid ?? undefined} use:liftToasts>
  <div class="inner">
    <div class="start">{@render children?.()}</div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  /* Its column stands on the page's: like the view above it, it keeps the room of the view's
     scrollbar beside it, empty (a scroller that never scrolls), and as much at its left, and its
     white goes on under that room to the window's edges. It asks its own width, as the page's
     parts ask the page's. */
  .bar {
    container: page / inline-size;
    padding-left: var(--scrollbar-room);
    overflow-x: hidden;
    overflow-y: scroll;
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
