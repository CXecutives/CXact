<!--
  The places of a list as tabs (Eingang, Archiv, Papierkorb), drawn like a segmented control
  (user decision 2026-09-28): the labels on one track, the chosen one on a white thumb that
  slides to the next choice like the sidebar's pill (180 ms, emphasized; the first placement
  and a change of size never slide), no numbers. An unchosen tab darkens on hover. Like
  native tabs the row is one Tab stop and the left and right arrows choose
  (lib/input/input.ts).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface TabOption<Id extends string = string> {
    id: Id;
    label: string;
    icon?: IconName | null;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import Icon from './Icon.svelte';
  import { cssVars, px } from '$lib/actions/cssVars';
  import { settled } from '$lib/motion/settled.svelte';

  interface Props {
    options: readonly TabOption<Id>[];
    value: Id;
    label: string;
    testid?: string | null;
    onchange: (id: Id) => void;
  }

  let { options, value, label, testid = null, onchange }: Props = $props();

  const motion = settled();
  let row: HTMLDivElement | undefined = $state();
  let line = $state<{ x: number; width: number } | null>(null);
  let instant = $state(true);
  let slidingUntil = 0;

  function measure(): void {
    const chosen = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    line = chosen ? { x: chosen.offsetLeft, width: chosen.offsetWidth } : null;
  }

  $effect(() => {
    void value;
    void options;
    instant = !motion.ready;
    slidingUntil = performance.now() + 300;
    measure();
  });

  $effect(() => {
    if (!row) return;
    const observer = new ResizeObserver(() => {
      instant = performance.now() > slidingUntil;
      measure();
    });
    observer.observe(row);
    return () => observer.disconnect();
  });
</script>

<div
  class="tabs"
  role="tablist"
  aria-label={label}
  data-testid={testid ?? undefined}
  bind:this={row}
>
  {#each options as option (option.id)}
    {@const chosen = option.id === value}
    <button
      type="button"
      role="tab"
      class="tab"
      aria-selected={chosen}
      tabindex={chosen ? 0 : -1}
      data-testid={option.testid ?? undefined}
      onclick={() => {
        if (!chosen) onchange(option.id);
      }}
    >
      {#if option.icon}<Icon name={option.icon} size="sm" />{/if}
      <span class="pill" aria-hidden="true"></span>
      {option.label}
    </button>
  {/each}
  {#if line}<span
      class="line"
      class:instant
      aria-hidden="true"
      use:cssVars={{ 'line-x': px(line.x), 'line-width': px(line.width) }}
    ></span>{/if}
</div>

<style>
  /* The track, like the segmented control's. */
  .tabs {
    position: relative;
    display: inline-flex;
    align-items: stretch;
    align-self: center;
    min-width: 0;
    height: var(--control-field);
    padding: var(--space-2);
    border-radius: var(--radius-control);
    background-color: var(--surface-track);
    isolation: isolate;
  }

  .tab {
    position: relative;
    display: inline-flex;
    flex: none;
    gap: var(--space-4);
    align-items: center;
    padding: 0 var(--space-12);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: var(--type-place);
    white-space: nowrap;
    cursor: default;
    transition: color var(--dur-base) var(--ease-standard);
  }

  .tab[aria-selected='false']:hover {
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  /* The hover wash of an unchosen tab, exactly the segmented control's (one control, one
     behaviour): the tab's own box, darker while pressed. */
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

  .tab[aria-selected='false']:hover .pill {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .tab[aria-selected='false']:active:hover .pill {
    background-color: var(--quiet-press);
  }

  .tab[aria-selected='true'] {
    color: var(--text);
  }

  .tab:focus-visible {
    border-radius: var(--radius-xs);
    box-shadow: var(--focus-ring);
    outline: none;
  }

  /* The white thumb under the chosen tab: only the move animates (a width is layout). */
  .line {
    position: absolute;
    z-index: var(--z-below);
    top: var(--space-2);
    bottom: var(--space-2);
    left: 0;
    width: var(--line-width);
    border-radius: var(--radius-sm);
    background-color: var(--surface);
    box-shadow: var(--sh-thumb);
    transform: translateX(var(--line-x));
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .line.instant {
    transition: none;
  }
</style>
