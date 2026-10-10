<!--
  The one choice of a few, one look everywhere (design round 3): two to four options on a light
  track, the chosen one on a white thumb with a hairline ring that slides to the next choice
  like the sidebar's pill (180 ms, emphasized; the first placement, a change of size and
  reduced motion never slide), always exactly the option's box whatever the labels or window
  width. Every small single choice takes it: the places above the list (Aktuell,
  Archiv, Papierkorb, as tabs: `tabs`), Arbeitsmodell, Verfügbar, Auslastung and
  Mindestlaufzeit.
  The role decides the widths: a choice (a radiogroup) gives every option the room of the
  widest, so the thumb is one size whichever is chosen; the places (tabs) keep each option as
  wide as its label. When the track has less room than the options want, the labels shorten
  with an ellipsis; nothing ever overlaps.
  The chosen label is navy (ink while the window is in the back), the others stay muted. An
  unchosen option washes on hover and darkens while pressed.
  Like native radio buttons (and native tabs, `tabs`) the group is one Tab stop and the
  arrows, Home and End choose (lib/input/input.ts). As high as a field (28 px, the thumb 2 px
  inside it), so it lines up with the fields and buttons of its row, in the app's text in
  medium.
-->
<script lang="ts" module>
  export interface SegmentedOption<Id extends string = string> {
    id: Id;
    label: string;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { cssVars, px } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { settled } from '$lib/motion/settled.svelte';

  interface Props {
    options: readonly SegmentedOption<Id>[];
    /** The one chosen option (a choice of one). */
    value?: Id | null;
    label: string;
    /** The places of a list: a tablist of tabs instead of a radiogroup. */
    tabs?: boolean;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let { options, value = null, label, tabs = false, testid = null, onchange }: Props = $props();

  const isChosen = (id: Id): boolean => id === value;

  /** One Tab stop: the chosen option (the arrows move between them, lib/input/input.ts). */
  const stop = $derived(options.some((option) => option.id === value) ? value : options[0]?.id);

  // The thumb's box: the chosen option's, measured in the track. A choice slides it; a
  // resize moves it at once (`instant`).
  const motion = settled();
  let track: HTMLDivElement | undefined = $state();
  let thumb = $state<{ x: number; width: number } | null>(null);
  let instant = $state(true);
  /** Until when a choice slides: a size change meanwhile follows without cutting it short. */
  let slidingUntil = 0;

  function measure(): void {
    const chosen = track?.querySelector<HTMLElement>('[data-chosen]') ?? null;
    thumb = chosen ? { x: chosen.offsetLeft, width: chosen.offsetWidth } : null;
  }

  $effect(() => {
    void value;
    void options;
    instant = !motion.ready;
    slidingUntil = performance.now() + 300;
    measure();
  });

  $effect(() => {
    if (!track) return;
    const observer = new ResizeObserver(() => {
      instant = performance.now() > slidingUntil;
      measure();
    });
    observer.observe(track);
    for (const option of track.children) observer.observe(option);
    return () => observer.disconnect();
  });
</script>

<div
  class="segmented"
  role={tabs ? 'tablist' : 'radiogroup'}
  aria-label={label}
  data-testid={testid ?? undefined}
  bind:this={track}
>
  {#if thumb}<span
      class="thumb"
      class:instant
      aria-hidden="true"
      use:cssVars={{ 'thumb-x': px(thumb.x), 'thumb-width': px(thumb.width) }}
    ></span>{/if}
  {#each options as option (option.id)}
    {@const chosen = isChosen(option.id)}
    <button
      type="button"
      role={tabs ? 'tab' : 'radio'}
      class="option"
      aria-checked={tabs ? undefined : chosen}
      aria-selected={tabs ? chosen : undefined}
      data-chosen={chosen ? '' : undefined}
      tabindex={option.id === stop ? 0 : -1}
      data-testid={option.testid ?? undefined}
      onclick={() => {
        if (!chosen || !tabs) onchange(option.id);
      }}
    >
      <span class="pill" aria-hidden="true"></span>
      <span class="label" use:tooltip={{ text: option.label, truncated: true }}>{option.label}</span
      >
    </button>
  {/each}
</div>

<style>
  /* It may shrink inside a flex row too (its options then shorten their labels). The tabs
     keep the widths of their options. */
  .segmented {
    position: relative;
    display: inline-flex;
    flex: none;
    align-self: flex-start;
    justify-self: start;
    min-width: 0;
    max-width: 100%;
    height: var(--control-field);
    padding: var(--space-2);
    border-radius: var(--radius-control);
    background-color: var(--surface-track);
    isolation: isolate;
  }

  /* A choice: every option as wide as the widest, the track as wide as they want (at most its
     place's width, where they shrink alike). */
  .segmented[role='radiogroup'] {
    display: inline-grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    width: max-content;
  }

  /* The one white thumb under the chosen option, a hairline ring around it; it slides like
     the sidebar's pill. */
  .thumb {
    position: absolute;
    z-index: var(--z-below);
    top: var(--space-2);
    bottom: var(--space-2);
    left: 0;
    width: var(--thumb-width);
    border-radius: var(--radius-inner);
    background-color: var(--thumb);
    box-shadow: 0 0 0 var(--border-width) var(--thumb-edge);
    transform: translateX(var(--thumb-x));
    /* Only the move animates (a width is layout); the width takes the option's at once. */
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .thumb.instant {
    transition: none;
  }

  /* As wide as its content (or its column); it gives way (the label shortens) when the
     track is short. */
  .option {
    position: relative;
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0 var(--space-12);
    border-radius: var(--radius-inner);
    color: var(--text-muted);
    font: var(--type-label);
    white-space: nowrap;
    transition: color var(--dur-base) var(--ease-standard);
  }

  /* The hover wash of an unchosen option: exactly the option's own box (the chosen one
     lies on the thumb). */
  .pill {
    position: absolute;
    z-index: var(--z-below);
    inset: 0;
    border-radius: inherit;
    background-color: var(--quiet-hover);
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-standard),
      background-color var(--dur-fast) var(--ease-standard);
  }

  .option:not([data-chosen]):hover {
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  .option:not([data-chosen]):hover .pill {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .option:not([data-chosen]):active:hover .pill {
    background-color: var(--quiet-press);
  }

  .option[data-chosen] {
    color: var(--nav-active-fg);
  }

  :global(:root[data-window='inactive']) .option[data-chosen] {
    color: var(--text);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
