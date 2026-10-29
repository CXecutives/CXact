<!--
  Indeterminate activity (the round 10 draft): a navy arc turning on the ring's track. Sizes 16
  (sm, beside words, in a button or the state box, like every glyph), 24 (lg, the app's start)
  and 48 (xl, the setup reading a CV, as large as every step's mark: its arc round at its
  ends). Inside a filled control the arc takes the colour of its words (`tone="current"`, on
  no track). It stands still under reduced motion.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  interface Props {
    size?: 'sm' | 'lg' | 'xl';
    /** The arc's colour: navy on the track, or the words' own (a filled button). */
    tone?: 'navy' | 'current';
    /** Announced to screen readers; omit when the surrounding control says it already. */
    label?: string | null;
  }

  let { size = 'sm', tone = 'navy', label }: Props = $props();
  // Without a label the spinner says "loading" (null says nothing).
  const spoken = $derived(label === undefined ? t.common.loading : label);
</script>

{#if size === 'xl'}
  <svg
    class="spinner large"
    viewBox="0 0 48 48"
    role={spoken ? 'status' : undefined}
    aria-label={spoken ?? undefined}
    aria-hidden={spoken ? undefined : 'true'}
  >
    <circle class="track" cx="24" cy="24" r="22" stroke-width="4" />
    <circle class="arc" cx="24" cy="24" r="22" stroke-width="4" />
  </svg>
{:else}
  <span
    class="spinner {size} {tone}"
    role={spoken ? 'status' : undefined}
    aria-label={spoken ?? undefined}
    aria-hidden={spoken ? undefined : 'true'}
  ></span>
{/if}

<style>
  .spinner {
    display: inline-block;
    flex: none;
    width: var(--spinner-size);
    height: var(--spinner-size);
    border: var(--spinner-line) solid var(--spinner-track);
    border-top-color: var(--spinner-arc);
    border-radius: var(--radius-full);
    /* Half a loop per turn: a full --dur-loop turn reads as stalled. */
    animation: spin calc(var(--dur-loop) / 2) linear infinite;
    animation-play-state: var(--loop-state);
  }

  /* In a filled control: the arc in the words' colour, no track. */
  .current {
    border-color: transparent;
    border-top-color: currentcolor;
    border-right-color: currentcolor;
  }

  .sm {
    --spinner-size: var(--spinner-sm);
  }

  .lg {
    --spinner-size: var(--spinner-lg);
  }

  /* The setup's: an arc of a third, round at its ends, a little slower. */
  .large {
    --spinner-size: var(--spinner-xl);

    border: 0;
    border-radius: 0;
    animation-duration: calc(var(--dur-loop) * 0.8);
  }

  .track,
  .arc {
    fill: none;
  }

  .track {
    stroke: var(--spinner-track);
  }

  .arc {
    stroke: var(--spinner-arc);
    stroke-dasharray: 46 200;
    stroke-linecap: round;
  }
</style>
