<!--
  The places of a list as tabs (Eingang, Archiv, Papierkorb), drawn like the sidebar's entries:
  an icon and a quiet label of 15 px; the chosen one sits on the sidebar's white pill (hairline,
  a faint shadow, its icon in the accent) that slides to the next choice (180 ms, emphasized;
  the first placement and a change of size never slide). An unchosen tab takes the quiet wash
  on hover. A tab may carry how many jobs lie there as a round count after its label (none at
  0), warm on the chosen tab, plain on the others, like the segments. Like native tabs the row
  is one Tab stop and the left and right arrows choose (lib/input/input.ts).
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface TabOption<Id extends string = string> {
    id: Id;
    label: string;
    icon?: IconName | null;
    /** A quiet number after the label (how many lie there); null, absent or 0: none. */
    count?: number | null;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import Count from './Count.svelte';
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
  let pill = $state<{ x: number; width: number } | null>(null);
  let instant = $state(true);
  let slidingUntil = 0;

  function measure(): void {
    const chosen = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    pill = chosen ? { x: chosen.offsetLeft, width: chosen.offsetWidth } : null;
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
      <span>{option.label}</span>
      {#if option.count}<Count
          value={option.count}
          tone={chosen ? 'soft' : 'plain'}
          testid={option.testid ? `${option.testid}-count` : null}
        />{/if}
    </button>
  {/each}
  {#if pill}<span
      class="pill"
      class:instant
      aria-hidden="true"
      use:cssVars={{ 'pill-x': px(pill.x), 'pill-width': px(pill.width) }}
    ></span>{/if}
</div>

<style>
  /* Only the tabs take the pointer: between them the row around does. */
  .tabs {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    height: var(--tabs-height);
    isolation: isolate;
    pointer-events: none;
  }

  .tab {
    pointer-events: auto;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-8);
    height: var(--control-md);
    padding: 0 var(--space-12);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text-muted);
    font: var(--type-place);
    white-space: nowrap;
    cursor: default;
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .tab[aria-selected='false']:hover {
    background-color: var(--quiet-hover);
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .tab[aria-selected='false']:active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  .tab[aria-selected='true'] {
    color: var(--nav-active-fg);
  }

  .tab[aria-selected='true'] > :global(.icon) {
    color: var(--nav-active-icon);
  }

  .tab:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }

  /* The sidebar's white pill under the chosen tab: only the move animates (a width is
     layout). */
  .pill {
    position: absolute;
    z-index: var(--z-below);
    top: calc((var(--tabs-height) - var(--control-md)) / 2);
    left: 0;
    box-sizing: border-box;
    width: var(--pill-width);
    height: var(--control-md);
    border: var(--border-width) solid var(--nav-active-border);
    border-radius: var(--radius-md);
    background-color: var(--nav-active-bg);
    box-shadow: var(--sh-xs);
    transform: translateX(var(--pill-x));
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .pill.instant {
    transition: none;
  }

  /* Like the sidebar: the choice greys out while the window is in the back. */
  :global(:root[data-window='inactive']) .tab[aria-selected='true'],
  :global(:root[data-window='inactive']) .tab[aria-selected='true'] > :global(.icon) {
    color: var(--text);
  }
</style>
