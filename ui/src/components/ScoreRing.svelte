<!--
  The match of a job as a ring (the round 10 draft): sm 34 with a 3 px stroke and 12
  digits (list rows), md 60 with a 5 px stroke and 20 digits (the job view), setup 48 with a
  4 px stroke (the setup's Fertig, as large as every step's mark). Hollow at every size: the solid track (--score-track), the arc and the number, nothing tinted behind them.
  scored: the ring shows its value (r = 15.9155, circumference 100, no pathLength). It fills
  and its number counts up along with the arc (400 ms, ease-out; lib/motion's Count) only
  when that means something: each time a job is opened in the job view (`animate` names the
  job; decision 6, 2026-10-24), but not while the user browses fast (pace.ts: the arrow keys
  held or opens close together, each job then simply shows its ring); when a score arrives
  while the ring is on screen (live scoring during a run); and when a list opens (`reveal`,
  the list passes it for the rows it lets count). A view that comes back shows its rings as
  they are. At most 10 rings count at the same time, the others stand at their value.
  A scored ring takes the colour of its decile (ten steps, red through orange and yellow to
  green; `d0` ... `d9`) with ink digits; a score from a teaser only looks the same (the reader
  says once that the ad is only a preview). An excluded job shows the red ban on the light
  red track instead (`ban`: 14 in the list's ring, 22 in the job view's), never a ring of
  its kept fit.
  The tooltip names the band and the percentage; a ring with a number adds under it the one
  sentence of what the match means (`score.info`, as the info symbol of the reader says it).
  Every ring without a score is one state and one look (not scored yet, being scored, not
  scorable, and off without a usable profile): the empty track with a subtle dash. Three
  digits fit the list's ring at its size.
  `done` is the setup's Fertig: the whole ring (a score of 100) filling as it mounts, a check
  of 22 in its colour drawing itself in the middle instead of the digits; it says nothing to a
  screen reader and has no tooltip (the heading beside it says it).
-->
<script lang="ts" module>
  import type { Band, DetailState, JobMatch } from '$lib/ipc/types';

  export type RingState =
    | { status: 'scored'; score: number; band: Band }
    | { status: 'unscorable' }
    | { status: 'pending' }
    | { status: 'none' }
    | { status: 'off' };

  /**
   * The ring state of a job's match (null = not scored yet). `detail` is the state of the
   * job's details: a job whose details are still coming is not "not rateable" yet but simply
   * not scored.
   */
  export function ringState(
    match: JobMatch | null,
    pending = false,
    detail: DetailState['kind'] | null = null,
  ): RingState {
    if (match === null) return pending ? { status: 'pending' } : { status: 'none' };
    // No text, no verdict: an ad still to come (or to fetch again, or on request) is scored
    // once it is there; only an ad that cannot be fetched at all is not scorable.
    if (match.status === 'unscorable') {
      return detail === 'pending' || detail === 'failed' || detail === 'onRequest'
        ? { status: 'none' }
        : { status: 'unscorable' };
    }
    return { status: 'scored', score: match.score, band: match.band };
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { formatPercent } from '$lib/i18n/format';
  import { Count } from '$lib/motion/count.svelte';
  import { animateOpen } from '$lib/motion/pace';

  interface Props {
    ring: RingState;
    size?: 'sm' | 'md' | 'setup';
    /** The job it shows in the job view (its key): another one is an open, which fills. */
    animate?: string | null;
    /** Fill and count up as it mounts (a list that opens, for the rows it lets count). */
    reveal?: boolean;
    /** An excluded job in the list: a light red track with the red ban in the middle, no
     *  number, as large as every other row's ring (design round 3). */
    ban?: boolean;
    /** The setup's Fertig: a check instead of the digits, silent, no tooltip. */
    done?: boolean;
    testid?: string | null;
  }

  let {
    ring,
    size = 'sm',
    animate = null,
    reveal = false,
    ban = false,
    done = false,
    testid = null,
  }: Props = $props();

  /** A number on the ring. */
  const valued = $derived(ring.status === 'scored');
  const score = $derived(ring.status === 'scored' ? Math.max(0, Math.min(100, ring.score)) : 0);

  const count = new Count(untrack(() => score));
  let mounted = false;
  let wasScored = false;
  /** The colour step: the decile of the score, 100 in the last one. */
  const step = $derived(valued ? `d${Math.min(9, Math.floor(score / 10))}` : '');

  const label = $derived.by(() => {
    if (ban) return t.score.excluded;
    switch (ring.status) {
      case 'scored':
        return t.score.value(t.score.band[ring.band], formatPercent(ring.score));
      case 'off':
        return t.score.off;
      default:
        return t.score.none;
    }
  });

  /** What the match means, under the label of a ring with a number. */
  const hint = $derived(valued && !ban ? t.score.info : null);

  /** The job the ring showed last (`animate`): another one is an open. */
  let opened: string | null = null;

  $effect(() => {
    const scored = valued;
    const value = score;
    const job = animate;
    untrack(() => {
      const first = !mounted;
      const open = job !== null && job !== opened;
      opened = job;
      // A score that arrives while the ring is on screen (the same job, scored live).
      const live = !first && !open && !wasScored;
      mounted = true;
      wasScored = scored;
      if (!scored) {
        count.place(0);
        return;
      }
      if ((open && animateOpen()) || live || (first && reveal)) count.run(value);
      else count.place(value);
    });
  });

  $effect(() => () => count.stop());
</script>

<span
  class="ring {size} {ring.status} {step}"
  class:ban
  role={done ? undefined : 'img'}
  aria-label={done ? undefined : label}
  aria-hidden={done ? 'true' : undefined}
  data-testid={testid ?? undefined}
  use:tooltip={done ? null : { text: label, hint }}
>
  {@render face()}
</span>

{#snippet face()}
  <svg class="svg" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="track" cx="18" cy="18" r="15.9155" />
    {#if valued && !ban}
      <circle
        class="value"
        cx="18"
        cy="18"
        r="15.9155"
        use:cssVars={{ value: score, fill: count.progress }}
      />
    {/if}
  </svg>
  <span class="center">
    {#if ban}
      <span class="ban"><Icon name="excluded" size={size === 'md' ? 'lg' : 'xs'} /></span>
    {:else if done}
      <span class="check"><Icon name="check" size="lg" /></span>
    {:else if valued}
      {count.value}
    {:else}
      –
    {/if}
  </span>
{/snippet}

<style>
  .ring {
    position: relative;
    display: inline-flex;
    flex: none;
    width: var(--ring-size);
    height: var(--ring-size);
    color: var(--ring-text);
    --ring-color: var(--score-track);
    --ring-text: var(--text-muted);
  }

  .svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .track,
  .value {
    fill: none;
    stroke-width: calc(var(--ring-stroke) * var(--ring-scale));
  }

  .track {
    stroke: var(--score-track);
  }

  .ring.ban .track {
    stroke: var(--ban-track);
  }

  .value {
    stroke: var(--ring-color);
    stroke-dasharray: 100 100;
    stroke-dashoffset: calc(100 - var(--value) * var(--fill));
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: center;
  }

  /* Fertig's check in the ring's colour, drawing itself once. */
  .check {
    display: inline-flex;
    color: var(--ring-color);
  }

  .check :global(.icon svg) {
    stroke-width: var(--ring-setup-check);
  }

  .check :global(path) {
    stroke-dasharray: var(--draw-length);
    animation: draw var(--dur-slow) var(--ease-out) var(--dur-instant) both;
  }

  /* The ban of an excluded row: red, in the light red track's middle. */
  .center .ban {
    display: inline-flex;
    color: var(--ban);
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--ring-type);
    font-variant-numeric: var(--numeric);
  }

  /* The digits of a score are ink. */
  .scored {
    --ring-text: var(--score-digits);
  }

  /* The ring colour: the decile of the score. */
  .d0 {
    --ring-color: var(--score-ring-0);
  }

  .d1 {
    --ring-color: var(--score-ring-1);
  }

  .d2 {
    --ring-color: var(--score-ring-2);
  }

  .d3 {
    --ring-color: var(--score-ring-3);
  }

  .d4 {
    --ring-color: var(--score-ring-4);
  }

  .d5 {
    --ring-color: var(--score-ring-5);
  }

  .d6 {
    --ring-color: var(--score-ring-6);
  }

  .d7 {
    --ring-color: var(--score-ring-7);
  }

  .d8 {
    --ring-color: var(--score-ring-8);
  }

  .d9 {
    --ring-color: var(--score-ring-9);
  }

  .sm {
    --ring-size: var(--ring-sm);
    --ring-stroke: var(--ring-sm-stroke);
    --ring-scale: var(--ring-sm-scale);
    --ring-type: var(--ring-sm-type);
  }

  .md {
    --ring-size: var(--ring-md);
    --ring-stroke: var(--ring-md-stroke);
    --ring-scale: var(--ring-md-scale);
    --ring-type: var(--ring-md-type);
  }

  .setup {
    --ring-size: var(--ring-setup);
    --ring-stroke: var(--ring-setup-stroke);
    --ring-scale: var(--ring-setup-scale);
  }
</style>
