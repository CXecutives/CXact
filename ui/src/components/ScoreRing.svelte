<!--
  The match of a job as a ring: sm 40 (list rows), md 56 (reader), lg 96. Hollow at every
  size: the solid track, the arc and the number, nothing tinted behind them.
  scored: the ring shows its value (r = 15.9155, circumference 100, no pathLength). It fills
  (360 ms, ease-out) only when that means something: when a score arrives while the ring is
  on screen (live scoring during a run; the number counts along), or the first time a job is
  opened (`animate` names the job; once per job and session; the number stands at once, only
  the arc fills). A view that comes back shows its rings as they are. At most 10 rings fill
  at the same time, the others are placed at once.
  A scored ring takes the colour of its decile (ten steps, red through orange and yellow to
  green; `d0` ... `d9`) with ink digits. provisional (a score from a teaser only) looks exactly
  like a scored ring: the reader says once that the ad is only a preview. excluded: the ring
  and its number in grey (the fit is kept, so a wrong exclusion shows at once).
  Every ring without a score is one state and one look (not scored yet, being scored, not
  scorable, and off without a usable profile): the empty track with a dash. A score of 100 sets
  its digits smaller in the list ring.
  With `onclick` the ring is a button (the reader's: it opens "Warum diese Zahl?", named by
  `why` in its tooltip; `expanded` while that is open): a Tab stop with the focus ring round
  it, the same look otherwise.
-->
<script lang="ts" module>
  import type { Band, DetailState, JobMatch } from '$lib/ipc/types';

  export type RingState =
    | { status: 'scored'; score: number; band: Band }
    | { status: 'provisional'; score: number; band: Band }
    | { status: 'excluded'; score: number }
    | { status: 'unscorable' }
    | { status: 'pending' }
    | { status: 'none' }
    | { status: 'off' };

  /**
   * The ring state of a job's match (null = not scored yet). `detail` is the state of the
   * job's details: a score from a teaser is provisional, and a job whose details are still
   * coming is not "not rateable" yet but simply not scored.
   */
  export function ringState(
    match: JobMatch | null,
    pending = false,
    detail: DetailState['kind'] | null = null,
  ): RingState {
    if (match === null) return pending ? { status: 'pending' } : { status: 'none' };
    if (match.status === 'excluded') return { status: 'excluded', score: match.score };
    // No text, no verdict: an ad still to come (or to fetch again, or on request) is scored
    // once it is there; only an ad that cannot be fetched at all is not scorable.
    if (match.status === 'unscorable') {
      return detail === 'pending' || detail === 'failed' || detail === 'onRequest'
        ? { status: 'none' }
        : { status: 'unscorable' };
    }
    if (detail === 'teaser') {
      return { status: 'provisional', score: match.score, band: match.band };
    }
    return { status: 'scored', score: match.score, band: match.band };
  }

  const MAX_ANIMATING = 10;
  let animating = 0;
  /** Jobs whose ring has filled on opening already (it does not replay; not reactive). */
  const filled: Record<string, true> = {};
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { cssVars } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { formatPercent } from '$lib/i18n/format';
  import { duration, isReducedMotion, play } from '$lib/motion/motion';
  import { countUp } from '$lib/motion/transitions';

  interface Props {
    ring: RingState;
    size?: 'sm' | 'md' | 'lg';
    /** Fill on mount the first time this job is shown (the reader passes the job's key). */
    animate?: string | null;
    /** The ring opens a popover of its own (a button). */
    onclick?: ((event: MouseEvent) => void) | null;
    /** What the button opens (its tooltip). */
    why?: string | null;
    /** Its popover is open. */
    expanded?: boolean;
    /** An excluded job in the list: the empty track with the ban in the middle, no number
     *  (user decision 2026-09-27: as large as every other row's ring). */
    ban?: boolean;
    testid?: string | null;
  }

  let {
    ring,
    size = 'sm',
    animate = null,
    onclick = null,
    why = null,
    expanded = false,
    ban = false,
    testid = null,
  }: Props = $props();

  /** A number on the ring (final or provisional). */
  const valued = $derived(
    ring.status === 'scored' || ring.status === 'provisional' || ring.status === 'excluded',
  );
  const score = $derived(valued && 'score' in ring ? Math.max(0, Math.min(100, ring.score)) : 0);

  const number = countUp(untrack(() => score));
  let shown = $state(untrack(() => score));
  let counting = false;
  let mounted = false;
  let wasScored = false;
  let arc = $state<SVGCircleElement | null>(null);
  /** The colour step: the decile of the score, 100 in the last one. */
  const step = $derived(
    valued && ring.status !== 'excluded' ? `d${Math.min(9, Math.floor(score / 10))}` : '',
  );

  const label = $derived.by(() => {
    if (ban) return t.score.excluded;
    switch (ring.status) {
      case 'scored':
      case 'provisional':
        return t.score.value(t.score.band[ring.band], formatPercent(ring.score));
      case 'excluded':
        return t.score.value(t.score.excluded, formatPercent(ring.score));
      case 'off':
        return t.score.off;
      default:
        return t.score.none;
    }
  });

  function place(value: number): void {
    void number.set(value, { duration: 0 });
    shown = value;
  }

  /** The job the ring showed last (`animate`): another one is an opening. */
  let opened: string | null = null;

  $effect(() => {
    const scored = valued;
    const value = score;
    const job = animate;
    untrack(() => {
      // Opening a job (the reader passes it as `animate`) for the first time this session.
      const first = job !== null && job !== opened && !(job in filled);
      opened = job;
      if (first && scored) filled[job] = true;
      // A score that arrives while the ring is on screen (the same job, scored live).
      const live = mounted && !wasScored && !first;
      const grow = scored && (first || live);
      mounted = true;
      wasScored = scored;
      if (!scored || counting) return;
      if (!grow || isReducedMotion() || animating >= MAX_ANIMATING) {
        place(value);
        return;
      }
      animating += 1;
      counting = true;
      // The arc holds its final value in CSS; the fill is one Web Animation from empty, so
      // it cannot depend on when the engine first computes the style of a new circle.
      shown = value;
      // Opening a job: the number stands at once, only the arc fills. A live score counts
      // along with its arc.
      void number.set(live ? 0 : value, { duration: 0 });
      number.target = value;
      let fill: Animation | null = null;
      // After the flush: a circle that was just created is bound by then.
      void tick().then(() => {
        if (arc === null) return;
        fill = play(arc, [{ strokeDashoffset: 100 }, { strokeDashoffset: 100 - value }], {
          duration: 'reveal',
          easing: 'out',
        });
      });
      setTimeout(() => {
        // The animation fills both ways: drop it, or a later score would stay masked.
        fill?.cancel();
        animating -= 1;
        counting = false;
        place(score);
      }, duration('reveal'));
    });
  });
</script>

{#if onclick}
  <button
    type="button"
    class="ring button {size} {ring.status} {step}"
    class:full={valued && score === 100}
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={expanded}
    data-testid={testid ?? undefined}
    use:tooltip={why}
    {onclick}
  >
    {@render face()}
  </button>
{:else}
  <span
    class="ring {size} {ring.status} {step}"
    class:full={valued && score === 100}
    role="img"
    aria-label={label}
    data-testid={testid ?? undefined}
  >
    {@render face()}
  </span>
{/if}

{#snippet face()}
  <svg class="svg" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="track" cx="18" cy="18" r="15.9155" />
    {#if valued && !ban}
      <circle
        bind:this={arc}
        class="value"
        cx="18"
        cy="18"
        r="15.9155"
        use:cssVars={{ value: shown }}
      />
    {/if}
  </svg>
  <span class="center">
    {#if ban}
      <span class="ban"><Icon name="excluded" size={size === 'md' ? 'md' : 'sm'} /></span>
    {:else if valued}
      {Math.round(number.current)}
    {:else}
      –
    {/if}
  </span>
{/snippet}

<style>
  /* The ring as a button: nothing but the ring, the focus ring round it. */
  .button {
    padding: 0;
    border-radius: var(--radius-full);
    cursor: default;
  }

  .button:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .ring {
    position: relative;
    display: inline-flex;
    flex: none;
    width: var(--ring-size);
    height: var(--ring-size);
    color: var(--ring-text);
    --ring-color: var(--score-track);
    --ring-text: var(--text-subtle);
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

  .excluded .track {
    stroke: var(--score-excluded-track);
  }

  .excluded .value {
    stroke: var(--score-excluded);
  }

  .value {
    stroke: var(--ring-color);
    stroke-dasharray: 100 100;
    stroke-dashoffset: calc(100 - var(--value));
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: center;
  }

  /* The ban of an excluded row: quiet, in the track's middle. */
  .ban {
    display: inline-flex;
    color: var(--text-subtle);
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--ring-type);
    font-variant-numeric: var(--numeric);
    letter-spacing: var(--tracking-tight);
  }

  /* The digits of a score are ink. */
  .scored,
  .provisional {
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

  .excluded {
    --ring-text: var(--score-excluded);
  }

  .sm {
    --ring-size: var(--ring-sm);
    --ring-stroke: var(--ring-sm-stroke);
    --ring-scale: var(--ring-sm-scale);
    --ring-type: var(--weight-semibold) var(--font-sm) / var(--leading-sm) var(--font-sans);
  }

  .md {
    --ring-size: var(--ring-md);
    --ring-stroke: var(--ring-md-stroke);
    --ring-scale: var(--ring-md-scale);
    --ring-type: var(--weight-semibold) var(--font-lg) / var(--leading-lg) var(--font-sans);
  }

  .lg {
    --ring-size: var(--ring-lg);
    --ring-stroke: var(--ring-lg-stroke);
    --ring-scale: var(--ring-lg-scale);
    --ring-type: var(--type-2xl);
  }

  /* Three digits would touch the 4 px stroke of the 40 px ring. */
  .sm.full {
    --ring-type: var(--weight-semibold) var(--font-xs) / var(--leading-xs) var(--font-sans);
  }
</style>
