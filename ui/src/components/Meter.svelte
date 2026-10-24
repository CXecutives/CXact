<!--
  Progress bar (the round 10 draft): 4 px (sm; md 6 and lg 8 where a larger bar is needed),
  4 round, the track with a navy fill. Determinate (value 0..1) fills by scaleX (180 ms,
  ease-out), never by its width. Indeterminate (value null) sweeps a short bar (linear, so it
  never seems to stall); under reduced motion it rests as a calm full track instead of a
  paused bar outside the track. On the cream (`ground="bg"`: the progress strip) its track is
  white. `neutral` is a quiet grey fill (a quota).
-->
<script lang="ts" module>
  export type MeterTone = 'brand' | 'neutral';
  export type MeterSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
  import { cssVars } from '$lib/actions/cssVars';
  import { settled } from '$lib/motion/settled.svelte';

  interface Props {
    value: number | null;
    tone?: MeterTone;
    size?: MeterSize;
    /** What it stands on: a white surface, or the cream (a white track then). */
    ground?: 'surface' | 'bg';
    label: string;
    testid?: string | null;
  }

  let {
    value,
    tone = 'brand',
    size = 'sm',
    ground = 'surface',
    label,
    testid = null,
  }: Props = $props();

  const motion = settled();
  const clamped = $derived(value === null ? null : Math.max(0, Math.min(1, value)));
</script>

<div
  class="meter {tone} {size}"
  class:on-bg={ground === 'bg'}
  class:indeterminate={clamped === null}
  class:ready={motion.ready}
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
  data-testid={testid ?? undefined}
>
  <span class="fill" use:cssVars={{ progress: clamped ?? 1 }}></span>
</div>

<style>
  .meter {
    position: relative;
    width: 100%;
    height: var(--meter-height);
    overflow: hidden;
    border-radius: var(--radius-xs);
    background-color: var(--meter-track-colour);
  }

  .fill {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    background-color: var(--meter-color);
    transform: scaleX(var(--progress));
    transform-origin: left center;
  }

  /* It fills only once the bar has been drawn (a meter that mounts shows its value). */
  .ready .fill {
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .indeterminate .fill {
    right: auto;
    width: 40%;
    transform: translateX(-100%);
    transition: none;
    animation: sweep var(--dur-loop) linear infinite;
    animation-play-state: var(--loop-state);
  }

  /* Reduced motion: no sweep; a paused one would sit outside the track and vanish. */
  :global(:root[data-motion='reduce']) .indeterminate .fill {
    width: 100%;
    opacity: var(--opacity-muted);
    transform: none;
    animation: none;
  }

  .brand {
    --meter-color: var(--meter-fill);
    --meter-track-colour: var(--meter-track);
  }

  .neutral {
    --meter-color: var(--text-subtle);
    --meter-track-colour: var(--surface-track);
  }

  .meter.on-bg {
    --meter-track-colour: var(--meter-track-on-bg);
  }

  .sm {
    --meter-height: var(--meter-sm);
  }

  .md {
    --meter-height: var(--meter-md);
  }

  .lg {
    --meter-height: var(--meter-lg);
  }
</style>
