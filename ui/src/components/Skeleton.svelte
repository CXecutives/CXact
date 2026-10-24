<!--
  Loading placeholder (the round 10 draft): a flat line or circle in the track's colour, no
  shimmer. It fades in (--dur-fast) as it is placed: the state that places it has waited
  --delay-placeholder already (a list or a job that takes that long to load), so a quicker
  load never shows one, and one that shows is visible at once. `late` waits that long itself,
  for a placeholder that is placed at once (the end of a list that can load more).
-->
<script lang="ts">
  import { cssVars } from '$lib/actions/cssVars';

  interface Props {
    shape?: 'line' | 'circle';
    /** Width in percent of the container (lines). */
    width?: number;
    /** Circle diameter. */
    size?: 'sm' | 'md';
    /** Placed at once: stays invisible for --delay-placeholder before it fades in. */
    late?: boolean;
  }

  let { shape = 'line', width = 100, size = 'sm', late = false }: Props = $props();
</script>

<span
  class="skeleton {shape} {size}"
  class:late
  aria-hidden="true"
  use:cssVars={{ 'skeleton-width': `${Math.max(0, Math.min(100, width))}%` }}
></span>

<style>
  /* The fade-in and its delay are timing, not movement: they stay under reduced motion. */
  .skeleton {
    display: block;
    background-color: var(--skeleton);
    animation: appear var(--dur-fast) var(--ease-standard) both;
  }

  .late {
    animation-delay: var(--delay-placeholder);
  }

  .line {
    width: var(--skeleton-width);
    height: var(--skeleton-line);
    border-radius: var(--radius-full);
  }

  .circle {
    width: var(--circle);
    height: var(--circle);
    border-radius: var(--radius-full);
  }

  .circle.sm {
    --circle: var(--ring-sm);
  }

  .circle.md {
    --circle: var(--ring-md);
  }
</style>
