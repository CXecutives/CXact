<!--
  The navigation of the sidebar: icon and label per view, no counts (the list says how many
  are new).
  The active entry sits on one white pill that slides to it (180 ms, emphasized; the
  sibling of the segmented thumb), its label ink and its icon in the accent. An idle entry
  takes a much fainter wash on hover and keeps its icon, so the two never look alike. Collapsed (icon rail) the labels move into tooltips
  right of the icons (never over the next entry); with its label in view an entry has no
  tooltip. While the window is inactive the active label turns ink.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface SideNavItem<Id extends string = string> {
    id: Id;
    label: string;
    icon: IconName;
    testid?: string;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { tooltip } from '$lib/actions/tooltip';
  import { cssVars } from '$lib/actions/cssVars';
  import { settled } from '$lib/motion/settled.svelte';
  import { fade } from '$lib/motion/transitions';
  import Icon from './Icon.svelte';

  interface Props {
    items: readonly SideNavItem<Id>[];
    /** `null`: no entry is current (a page that is none of the views, e.g. the setup). */
    active: Id | null;
    label: string;
    collapsed?: boolean;
    onselect: (id: Id) => void;
  }
  let { items, active, label, collapsed = false, onselect }: Props = $props();

  const index = $derived(items.findIndex((item) => item.id === active));
  /** Where the pill stands: the index of the current entry. */
  const pill = $derived({ index: Math.max(0, index) });
  const motion = settled();
</script>

<nav class="nav" class:collapsed class:ready={motion.ready} aria-label={label} use:cssVars={pill}>
  <!-- Re-created when the rail flips, so it is placed without sliding. -->
  {#key collapsed}
    <span class="indicator" class:none={index < 0} aria-hidden="true"></span>
  {/key}
  {#each items as item (item.id)}
    <button
      type="button"
      class="item"
      aria-current={item.id === active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-testid={item.testid}
      use:tooltip={collapsed ? { text: item.label, placement: 'right' } : null}
      onclick={() => onselect(item.id)}
    >
      <span class="glyph">
        <Icon name={item.icon} size="md" />
      </span>
      {#if !collapsed}
        <span class="label" in:fade>{item.label}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  .nav {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    isolation: isolate;
  }

  /* The one pill behind the active entry: a surface without an edge, lifted by the shadow
     of every chosen thumb (the tabs, the segments). */
  .indicator {
    position: absolute;
    z-index: var(--z-below);
    top: 0;
    right: 0;
    left: 0;
    height: var(--control-md);
    border-radius: var(--radius-md);
    background-color: var(--nav-active-bg);
    box-shadow: var(--sh-thumb);
    transform: translateY(calc(var(--index) * var(--nav-step)));
    will-change: transform;
  }

  /* It slides only once the nav has been drawn (never when it mounts). */
  .ready .indicator {
    transition: transform var(--dur-slow) var(--ease-emphasized);
  }

  .indicator.none {
    opacity: 0;
  }

  /* In the rail it steps over the square icons. */
  .collapsed .indicator {
    right: auto;
    width: var(--control-lg);
    height: var(--control-lg);
    transform: translateY(calc(var(--index) * var(--nav-step-rail)));
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    height: var(--control-md);
    padding: 0 var(--space-12);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font: var(--type-tab);
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .item:not([aria-current='page']):hover {
    background-color: var(--nav-hover);
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .item:not([aria-current='page']):active:hover {
    background-color: var(--nav-press);
    transition-duration: var(--dur-instant);
  }

  .item[aria-current='page'] {
    color: var(--nav-active-fg);
    --nav-glyph: var(--nav-active-icon);
  }

  /* Like Mail and Explorer: the selection greys out while the window is in the back. */
  :global(:root[data-window='inactive']) .item[aria-current='page'] {
    color: var(--text);
    --nav-glyph: var(--text);
  }

  .item:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .collapsed .item {
    justify-content: center;
    width: var(--control-lg);
    height: var(--control-lg);
    padding: 0;
  }

  .glyph {
    display: inline-flex;
    color: var(--nav-glyph, currentcolor);
    transition: color var(--dur-base) var(--ease-standard);
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
