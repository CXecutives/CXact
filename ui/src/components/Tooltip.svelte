<!--
  The tooltip layer: mounted once (App), fed by the `tooltip` action. Placed below its anchor
  (above it at the bottom edge of the window), kept inside the window, whole-pixel positions.
  The deep navy bubble (round 10: 6 px round, 12 px words in 500, no edge, at most 260 wide)
  fades in (100 ms) after --delay-tooltip and leaves with a 60 ms fade; moving on to the next
  anchor while it shows just moves it
  (no second entrance). An anchor may add a second, smaller line in a quieter white (a key
  or a hint: "Strg+F", "Doppelklick setzt zurück"), like the tooltips of native apps. It
  goes when the window is resized or goes to the back (its anchor may have moved or be
  covered then), on a scroll of any pane (its anchor moved on), on a press anywhere and on Esc
  (the last two also drop the tooltips still waiting for their delay; a press on the anchor
  itself is its own handler's, an info symbol toggles on it): input.ts `onDismiss`. A bubble the
  user asked for takes its Esc alone (`tooltipState.held`).
-->
<script lang="ts">
  import { px, setVars } from '$lib/actions/cssVars';
  import { TOOLTIP_HINT } from '$lib/actions/tooltip';
  import { onDismiss } from '$lib/input/input';
  import { tooltipIn, tooltipOut } from '$lib/motion/transitions';
  import { TOOLTIP_ID, tooltipState } from '$lib/state/tooltip.svelte';
  import { tokenPx } from '$lib/tokens';
  import type { Action } from 'svelte/action';

  /** Below the anchor (above if there is no room), inside the window, from the bubble's
   *  size as it is now. */
  function position(node: HTMLElement, anchor: HTMLElement): void {
    const gap = tokenPx('--tooltip-gap');
    const edge = tokenPx('--viewport-gap');
    const a = anchor.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const maxX = document.documentElement.clientWidth - width - edge;
    const maxY = document.documentElement.clientHeight - height - edge;
    const x = Math.max(edge, Math.min(a.left + a.width / 2 - width / 2, maxX));
    const below = a.bottom + gap;
    const top = below <= maxY ? below : a.top - gap - height;
    setVars(node, { 'tooltip-x': px(x), 'tooltip-y': px(top) });
  }

  /** Places the layer whenever the anchor or the text changes, in an effect: it runs after
   *  the new text and hint are in the DOM, so the bubble is measured at its new size (an
   *  action's update ran before the text changed and placed the next anchor's tooltip from
   *  the previous one's size). Still before the frame is painted: no jump. */
  const place: Action<HTMLElement> = (node) => {
    $effect(() => {
      const anchor = tooltipState.anchor;
      void tooltipState.text;
      if (anchor !== null) position(node, anchor);
    });
  };

  /** The second line the anchor carries (read again whenever the text changes). */
  function hintOf(anchor: HTMLElement, _text: string): string | null {
    return anchor.dataset[TOOLTIP_HINT] ?? null;
  }

  // A scroll takes the bubble away (its anchor moved on); a press or Esc also the tooltips
  // that still wait. A press on the anchor is its own (an info symbol toggles on it); a bubble the
  // user asked for takes its Esc alone.
  $effect(() =>
    onDismiss((cause, target) => {
      const anchor = tooltipState.anchor;
      const alone = cause === 'escape' && tooltipState.held;
      if (cause === 'scroll') tooltipState.hide();
      else if (cause === 'escape') tooltipState.dismiss();
      else if (!(anchor !== null && target instanceof Node && anchor.contains(target))) {
        tooltipState.dismiss();
      }
      return alone;
    }),
  );
</script>

<svelte:window onresize={() => tooltipState.hide()} onblur={() => tooltipState.hide()} />

{#if tooltipState.anchor}
  {@const hint = hintOf(tooltipState.anchor, tooltipState.text)}
  <div class="layer" role="tooltip" id={TOOLTIP_ID} use:place>
    <div class="bubble" in:tooltipIn out:tooltipOut>
      {tooltipState.text}{#if hint}<span class="hint">{hint}</span>{/if}
    </div>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    z-index: var(--z-tooltip);
    top: 0;
    left: 0;
    max-width: var(--tooltip-max);
    pointer-events: none;
    transform: translate(var(--tooltip-x), var(--tooltip-y));
  }

  /* Small and quiet like a native tooltip: 12 px words in 500, 5/8 padding, no edge, a soft
     shadow. */
  .bubble {
    padding: var(--tooltip-pad);
    border-radius: var(--tooltip-radius);
    background-color: var(--surface-inverse);
    box-shadow: var(--sh-tooltip);
    color: var(--text-inverse);
    font: var(--type-tooltip);
    overflow-wrap: anywhere;
  }

  /* The second line: a key or a hint, one step smaller and quieter. */
  .hint {
    display: block;
    color: var(--text-inverse-muted);
    font: var(--type-2xs);
  }
</style>
