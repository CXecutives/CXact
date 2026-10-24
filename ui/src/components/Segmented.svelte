<!--
  The one choice of a few, one look everywhere (round 10): two to four options on the track,
  the chosen one on a white thumb with a soft shadow that glides to the next choice like the
  sidebar's pill (180 ms, ease-out; the first placement, a change of size and reduced motion
  never glide), always exactly the option's box whatever the labels or window width. Every
  small single choice takes it: the places above the list (Aktuell, Archiv, Papierkorb, as
  tabs: `tabs`), Arbeitsmodell, Verfügbar, Auslastung and Mindestlaufzeit.
  The role decides the widths: a choice (a radiogroup) gives every option the room of the
  widest, so the thumb is one size whichever is chosen; the places (tabs) keep each option as
  wide as its label, and so does a choice of many short codes and one long word (`fit`).
  When the track has less room than the options want, the labels shorten with an ellipsis;
  nothing ever overlaps.
  The chosen word is navy (ink while the window is in the back), the others muted; under the
  pointer an unchosen word darkens to ink, nothing else washes.
  Like native radio buttons (and native tabs, `tabs`) the group is one Tab stop and the
  arrows, Home and End choose (lib/input/input.ts). As high as a field (30 px, the options
  26 inside its 2 px rim, 2 px apart), so it lines up with the fields and buttons of its row.
-->
<script lang="ts" module>
  export interface SegmentedOption<Id extends string = string> {
    id: Id;
    label: string;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { tooltip } from '$lib/actions/tooltip';
  import { glide } from '$lib/motion/glide';

  interface Props {
    options: readonly SegmentedOption<Id>[];
    /** The one chosen option (a choice of one). */
    value?: Id | null;
    label: string;
    /** The places of a list: a tablist of tabs instead of a radiogroup. */
    tabs?: boolean;
    /** A choice whose options keep their own widths (short codes beside one long word). */
    fit?: boolean;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let {
    options,
    value = null,
    label,
    tabs = false,
    fit = false,
    testid = null,
    onchange,
  }: Props = $props();

  const isChosen = (id: Id): boolean => id === value;

  /** One Tab stop: the chosen option (the arrows move between them, lib/input/input.ts). */
  const stop = $derived(options.some((option) => option.id === value) ? value : options[0]?.id);

  // The thumb stands on the chosen option and glides to the next one (lib/motion/glide).
  let track: HTMLDivElement | undefined = $state();
  let chosen = $state<HTMLElement | null>(null);
  $effect(() => {
    void value;
    void options;
    chosen = track?.querySelector<HTMLElement>('[data-chosen]') ?? null;
  });
</script>

<div
  class="segmented"
  class:fit
  role={tabs ? 'tablist' : 'radiogroup'}
  aria-label={label}
  data-testid={testid ?? undefined}
  bind:this={track}
>
  <span class="thumb" aria-hidden="true" use:glide={{ to: chosen }}></span>
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
    gap: var(--space-2);
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

  .segmented.fit[role='radiogroup'] {
    grid-auto-columns: auto;
  }

  /* The one white thumb under the chosen option, lifted by its soft shadow; it glides like
     the sidebar's pill (lib/motion/glide places it). */
  .thumb {
    position: absolute;
    z-index: var(--z-below);
    top: 0;
    left: 0;
    width: var(--glide-width);
    height: var(--glide-height);
    border-radius: var(--radius-inner);
    background-color: var(--thumb);
    box-shadow: var(--sh-thumb);
    opacity: var(--glide-opacity, 0);
    transform: translate(var(--glide-x), var(--glide-y));
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
    padding: 0 var(--button-pad);
    border-radius: var(--radius-inner);
    color: var(--text-muted);
    font: var(--type-label);
    white-space: nowrap;
    transition: color var(--dur-base) var(--ease-standard);
  }

  .option:not([data-chosen]):hover {
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  .option[data-chosen] {
    color: var(--chosen-text);
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
