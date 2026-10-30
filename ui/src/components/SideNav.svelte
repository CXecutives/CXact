<!--
  The navigation of the sidebar: glyph and label per view, no counts (the list says how many
  are new) and no spinner (the run line of the list says a search).
  Every entry is 32 high, its 18 px glyph and its label in ink, the label 540 whether idle or
  active (decision 28): the active entry is told apart by its warm grey pill (no shadow, no
  edge), its navy label and its coral glyph. The pill glides to the entry chosen (the one
  glide of lib/motion: 180 ms, ease-out, a transform; it jumps when the nav mounts and under
  reduced motion). An idle entry takes the quiet wash under
  the pointer and keeps its glyph. While the window is in the back the active label and
  glyph turn ink, like Mail and Explorer.
  An entry may hold entries of its own (`children`: the places under Jobs), always shown, like
  a mailbox's folders: as high, no glyph, their words on the words of the entries above. The
  pill stands on the one that is current; the entry above it keeps its plain words and takes
  the coral glyph, so every view's glyph says where the window is.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface SideNavItem<Id extends string = string> {
    id: Id;
    label: string;
    icon: IconName;
    testid?: string;
    /** Its entries, under it (one level). */
    children?: readonly { id: Id; label: string; testid?: string }[];
  }
</script>

<script lang="ts" generics="Id extends string">
  import { glide } from '$lib/motion/glide';
  import Icon from './Icon.svelte';

  interface Props {
    items: readonly SideNavItem<Id>[];
    /** `null`: no entry is current (a page that is none of the views, e.g. the setup). */
    active: Id | null;
    label: string;
    onselect: (id: Id) => void;
  }
  let { items, active, label, onselect }: Props = $props();

  /** The entries by id: the pill stands on the active one. */
  const entries: Partial<Record<Id, HTMLElement>> = $state({});
  const chosen = $derived(active === null ? null : (entries[active] ?? null));
</script>

<nav class="nav" aria-label={label}>
  <span class="pill" aria-hidden="true" use:glide={{ to: chosen }}></span>
  {#each items as item (item.id)}
    <button
      bind:this={entries[item.id]}
      type="button"
      class="item"
      aria-current={item.id === active
        ? 'page'
        : item.children?.some((child) => child.id === active)
          ? 'true'
          : undefined}
      data-testid={item.testid}
      onclick={() => onselect(item.id)}
    >
      <span class="glyph">
        <Icon name={item.icon} size="nav" />
      </span>
      <span class="label">{item.label}</span>
    </button>
    {#each item.children ?? [] as child (child.id)}
      <button
        bind:this={entries[child.id]}
        type="button"
        class="item child"
        aria-current={child.id === active ? 'page' : undefined}
        data-testid={child.testid}
        onclick={() => onselect(child.id)}
      >
        <span class="label">{child.label}</span>
      </button>
    {/each}
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

  /* The one pill behind the active entry, the warm grey of the sidebar's choice, where the
     glide places it. */
  .pill {
    position: absolute;
    z-index: var(--z-below);
    top: 0;
    left: 0;
    width: var(--glide-width);
    height: var(--glide-height);
    border-radius: var(--radius-md);
    background-color: var(--nav-active-bg);
    opacity: var(--glide-opacity, 0);
    transform: translate(var(--glide-x), var(--glide-y));
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--nav-gap);
    height: var(--nav-row);
    padding: 0 var(--nav-pad);
    border-radius: var(--radius-md);
    color: var(--text);
    font: var(--type-label);
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  /* Its words on the words of the entries with a glyph. */
  .child {
    padding-left: calc(var(--nav-pad) + var(--icon-nav) + var(--nav-gap));
  }

  .item:not([aria-current='page']):hover {
    background-color: var(--surface-hover-quiet);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .item:not([aria-current='page']):active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  .item[aria-current='page'] {
    color: var(--nav-active-fg);
  }

  .item[aria-current] {
    --nav-glyph: var(--nav-active-icon);
  }

  /* Like Mail and Explorer: the choice turns ink while the window is in the back. */
  :global(:root[data-window='inactive']) .item[aria-current='page'] {
    color: var(--text);
  }

  :global(:root[data-window='inactive']) .item[aria-current] {
    --nav-glyph: var(--text);
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
