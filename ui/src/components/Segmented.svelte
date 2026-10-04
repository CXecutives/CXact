<!--
  The one choice of a few, one look everywhere (design round 3): two to four options on a light
  track, the chosen one on a white thumb with a hairline ring that slides to the next choice
  like the sidebar's pill (180 ms, emphasized; the first placement, a change of size and
  reduced motion never slide), always exactly the option's box whatever the labels, counts or
  window width. Every small single choice takes it: the places above the list (Aktuell,
  Archiv, Papierkorb, as tabs: `tabs`), Arbeitsmodell, Verfügbar ab, Auslastung and
  Mindestlaufzeit.
  Each option is as wide as its label and count; when the track has less room than the
  options want, the labels shorten with an ellipsis (the counts stay); nothing ever overlaps.
  The chosen label is navy (ink while the window is in the back) and its count a soft warm
  pill, the others stay muted with a plain count (same box, so nothing moves); an option may
  keep one tone whatever is chosen. A count that goes (`null`: none now, 0 is not shown) keeps
  its room, unseen, as wide as it was last, so the options keep their widths and nothing
  jumps. An unchosen option washes on hover and darkens while pressed. Counts roll when they
  change.
  Like native radio buttons (and native tabs, `tabs`) the group is one Tab stop and the
  arrows, Home and End choose (lib/input/input.ts). As high as a field (24 px), so it lines up
  with the fields and buttons of its row, with the 12 px medium text of a tab.
-->
<script lang="ts" module>
  export interface SegmentedOption<Id extends string = string> {
    id: Id;
    label: string;
    /** The count; `null` hides it but keeps its room (undefined: the option has none). */
    count?: number | null;
    /** The count's tone whatever is chosen (default: soft when chosen, plain otherwise). */
    tone?: 'soft' | 'plain' | null;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { untrack } from 'svelte';
  import { cssVars, px } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { settled } from '$lib/motion/settled.svelte';
  import Count from './Count.svelte';

  interface Props {
    options: readonly SegmentedOption<Id>[];
    value: Id;
    label: string;
    /** The places of a list: a tablist of tabs instead of a radiogroup. */
    tabs?: boolean;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let { options, value, label, tabs = false, testid = null, onchange }: Props = $props();

  /** The count each option showed last: a count that goes keeps its room with it. */
  const kept = $state<Record<string, number>>({});
  $effect.pre(() => {
    const shown = options.map((option) => [option.id, option.count] as const);
    untrack(() => {
      for (const [id, count] of shown) if (count !== undefined && count !== null) kept[id] = count;
    });
  });

  /** One Tab stop: the chosen option (the arrows move between them, lib/input/input.ts). */
  const stop = $derived(options.some((option) => option.id === value) ? value : options[0]?.id);

  // The thumb's box: the chosen option's, measured in the track. A choice slides it; a
  // resize or a count that changes a width moves it at once (`instant`).
  const motion = settled();
  let track: HTMLDivElement | undefined = $state();
  let thumb = $state<{ x: number; width: number } | null>(null);
  let instant = $state(true);
  /** Until when a choice slides: a size change meanwhile follows without cutting it short. */
  let slidingUntil = 0;

  function measure(): void {
    const chosen = track?.querySelector<HTMLElement>('[data-chosen]');
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
    {@const chosen = option.id === value}
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
      {#if option.count !== undefined && option.count !== null}
        <Count value={option.count} tone={option.tone ?? (chosen ? 'soft' : 'plain')} />
      {:else if option.count === null}
        <span class="spare" aria-hidden="true"
          ><Count value={kept[option.id] ?? 0} tone="plain" /></span
        >
      {/if}
    </button>
  {/each}
</div>

<style>
  /* It may shrink inside a flex row too (its options then shorten their labels). */
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

  /* As wide as its content; it gives way (the label shortens) when the track is short. */
  .option {
    position: relative;
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    min-width: 0;
    padding: 0 var(--space-10);
    border-radius: var(--radius-inner);
    color: var(--text-muted);
    font: var(--type-tab);
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

  /* The room of a count that went: unseen, as wide as the count was. */
  .spare {
    display: inline-flex;
    visibility: hidden;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .option:focus-visible {
    box-shadow: var(--focus-ring-inset);
  }
</style>
