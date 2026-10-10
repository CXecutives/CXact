<!--
  The floating bar at the foot of a page (the Profil's unsaved changes): a dark
  rounded bar centred at the bottom of the view, a little above its edge, that stays in view
  while the page scrolls under it. Its sentence at the left (`children`, light on the dark
  surface: tokens.css `[data-surface='inverse']`), its buttons at the right (`actions`: a
  quiet one and the view's primary). It rises in (8 px, 150 ms) and fades out. It ends the
  page: the page is at least as high as the view, so under a short page it still stands at
  the bottom. The toast stack rises above it (Toast measures what sticks to the bottom).
-->
<script lang="ts">
  import { fade, rise } from '$lib/motion/transitions';
  import type { Snippet } from 'svelte';

  interface Props {
    /** The buttons at its end. */
    actions?: Snippet | null;
    testid?: string | null;
    children: Snippet;
  }

  let { actions = null, testid = null, children }: Props = $props();
</script>

<div class="float" data-testid={testid ?? undefined} in:rise={{ distance: 'lg' }} out:fade>
  <div class="bar" data-surface="inverse">
    <div class="message">{@render children()}</div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  /* Sticks to the view's bottom edge with the gap as its own padding (so the toast stack
     sees it touch the edge); as wide as the bar. */
  .float {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: 0;
    align-self: center;
    width: fit-content;
    max-width: min(100%, var(--float-max));
    margin-top: auto;
    padding: var(--space-16) 0 var(--float-gap);
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8) var(--space-16);
    min-height: calc(var(--control-field) + 2 * var(--space-8));
    padding: var(--space-8) var(--space-8) var(--space-8) var(--space-16);
    border-radius: var(--radius-lg);
    background-color: var(--surface-inverse);
    box-shadow: var(--sh-pop);
    color: var(--text);
  }

  .message {
    flex: 1 1 auto;
    min-width: 0;
    font: var(--type-md);
  }

  .actions {
    display: flex;
    flex: none;
    gap: var(--space-8);
  }
</style>
