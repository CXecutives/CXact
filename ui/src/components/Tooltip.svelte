<!--
  The tooltip layer: mounted once (App), fed by the `tooltip` action. Placed below its anchor
  (above if there is no room), kept inside the window, whole-pixel positions. The deep navy bubble pops toward its anchor (100 ms)
  and leaves with a 60 ms fade; moving on to the next anchor while it shows just moves it
  (no second entrance). An anchor may add a second, smaller line in a quieter white (a key
  or a hint: "Strg+F", "Doppelklick setzt zurück"), like the tooltips of native apps. It
  goes when the window is resized or goes to the back (its anchor may have moved or be
  covered then).
-->
<script lang="ts">
  import { px, setVars } from '$lib/actions/cssVars';
  import { TOOLTIP_HINT } from '$lib/actions/tooltip';
  import { tooltipIn, tooltipOut } from '$lib/motion/transitions';
  import { TOOLTIP_ID, tooltipState } from '$lib/state/tooltip.svelte';
  import { tokenPx } from '$lib/tokens';
  import type { Action } from 'svelte/action';

  interface Placed {
    anchor: HTMLElement;
    text: string;
    hint: string | null;
  }

  const place: Action<HTMLElement, Placed> = (node, params) => {
    const update = ({ anchor }: Placed): void => {
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
    };
    update(params);
    return { update };
  };

  /** The second line the anchor carries (read again whenever the text changes). */
  function hintOf(anchor: HTMLElement, _text: string): string | null {
    return anchor.dataset[TOOLTIP_HINT] ?? null;
  }
</script>

<svelte:window onresize={() => tooltipState.hide()} onblur={() => tooltipState.hide()} />

{#if tooltipState.anchor}
  {@const hint = hintOf(tooltipState.anchor, tooltipState.text)}
  <div
    class="layer"
    role="tooltip"
    id={TOOLTIP_ID}
    use:place={{ anchor: tooltipState.anchor, text: tooltipState.text, hint }}
  >
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

  /* Small and quiet like a native tooltip: 11 px text, 4/8 padding, a faint light edge and a
     light shadow. */
  .bubble {
    padding: var(--space-4) var(--space-8);
    border: var(--border-width) solid var(--tooltip-edge);
    border-radius: var(--radius-xs);
    background-color: var(--surface-inverse);
    box-shadow: var(--sh-tooltip);
    color: var(--text-inverse);
    font: var(--type-xs);
    font-weight: var(--weight-regular);
    letter-spacing: var(--tracking-tooltip);
    overflow-wrap: anywhere;
  }

  /* The second line: a key or a hint, one step smaller and quieter. */
  .hint {
    display: block;
    color: var(--text-inverse-muted);
    font: var(--type-2xs);
    letter-spacing: var(--tracking-tooltip);
  }
</style>
