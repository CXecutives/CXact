<!--
  The places of a list as tabs (Eingang, Archiv, Papierkorb): an icon and a quiet label of
  15 px in a row 44 px high (user decision 2026-09-27, no numbers). The chosen one in ink, its
  icon and the line under it in the accent like the sidebar's chosen entry; the line slides
  to the next choice like the sidebar's pill and the segments' thumb (180 ms, emphasized; the
  first placement and a change of size never slide). An unchosen tab darkens on hover. Like
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
  /* Only the tabs take the pointer: between them the row around does. */
  .tabs {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: var(--space-12);
    min-width: 0;
    height: var(--tabs-height);
    pointer-events: none;
  }

  .tab {
    pointer-events: auto;
    display: inline-flex;
    flex: none;
    gap: var(--space-6);
    align-items: center;
    padding: 0;
    border: none;
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

  .tab[aria-selected='true'] {
    color: var(--nav-active-fg);
  }

  .tab[aria-selected='true'] > :global(.icon) {
    color: var(--nav-active-icon);
  }

  .tab:focus-visible {
    border-radius: var(--radius-xs);
    box-shadow: var(--focus-ring);
    outline: none;
  }

  /* The line under the chosen tab: only the move animates (a width is layout). */
  .line {
    position: absolute;
    bottom: 0;
    left: 0;
    width: var(--line-width);
    height: var(--tabs-line);
    border-radius: var(--radius-full);
    background-color: var(--nav-active-icon);
    transform: translateX(var(--line-x));
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .line.instant {
    transition: none;
  }
</style>
