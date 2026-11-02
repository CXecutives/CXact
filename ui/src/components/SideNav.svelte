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
  An entry may hold entries of its own (`children`: the places under Jobs, owner 2026-11-01,
  one level). The chevron at its end folds them by hand, a quarter turn, and they keep what the
  user chose. They stand 28 high in the words of a second line, on the words of the entries
  above, a hairline from under the glyph beside them; the pill stands on the one that is
  current, narrower than the others. Folded, the pill stands on the entry that holds them, and
  while they show that entry keeps its plain words and takes the coral glyph, so every view's
  glyph says where the window is.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  export interface SideNavChildren<Id extends string = string> {
    items: readonly { id: Id; label: string; testid?: string }[];
    /** Whether they show. */
    open: boolean;
    /** The chevron's name: what a press does. */
    toggleLabel: string;
    ontoggle: () => void;
    testid?: string;
  }

  export interface SideNavItem<Id extends string = string> {
    id: Id;
    label: string;
    icon: IconName;
    testid?: string;
    /** Its entries, under it (one level). */
    children?: SideNavChildren<Id>;
  }
</script>

<script lang="ts" generics="Id extends string">
  import { secondPress } from '$lib/input/input';
  import { glide } from '$lib/motion/glide';
  import { unfold } from '$lib/motion/transitions';
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

  /** Whether the active entry is one of this entry's. */
  const holdsActive = (item: SideNavItem<Id>): boolean =>
    item.children?.items.some((child) => child.id === active) ?? false;
  const holder = $derived(items.find(holdsActive));

  /** The entry the pill stands on: the active one, or the one that holds it while folded. */
  const shown = $derived.by(() => {
    if (active === null) return null;
    return holder !== undefined && !holder.children?.open ? holder.id : active;
  });
  /** An entry that unfolds has no element yet: until it has, the pill stays on the one that holds
   *  it, and glides down from there as it glides up when they fold. */
  const chosen = $derived(
    shown === null ? null : (entries[shown] ?? (holder && entries[holder.id]) ?? null),
  );
</script>

<nav class="nav" aria-label={label}>
  <span class="pill" aria-hidden="true" use:glide={{ to: chosen }}></span>
  {#each items as item (item.id)}
    <div class="entry">
      <button
        bind:this={entries[item.id]}
        type="button"
        class="item"
        class:folds={item.children !== undefined}
        aria-current={item.id === shown ? 'page' : holdsActive(item) ? 'true' : undefined}
        data-testid={item.testid}
        onclick={() => onselect(item.id)}
      >
        <span class="glyph">
          <Icon name={item.icon} size="nav" />
        </span>
        <span class="label">{item.label}</span>
      </button>
      {#if item.children}
        {@const children = item.children}
        <button
          type="button"
          class="fold"
          aria-expanded={children.open}
          aria-label={children.toggleLabel}
          data-testid={children.testid}
          onclick={(event) => {
            if (!secondPress(event)) children.ontoggle();
          }}
        >
          <span class="chevron" class:turned={children.open}><Icon name="expand" size="xs" /></span>
        </button>
        {#if children.open}
          <div class="children" transition:unfold>
            {#each children.items as child (child.id)}
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
          </div>
        {/if}
      {/if}
    </div>
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

  .entry {
    position: relative;
    display: flex;
    flex-direction: column;
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

  /* Its words end before the chevron. */
  .folds {
    padding-right: calc(var(--nav-pad) + var(--hit-min));
  }

  /* The chevron stands as far in from the end as a glyph from the start; a line of its own. */
  .fold {
    position: absolute;
    top: calc((var(--nav-row) - var(--hit-min)) / 2);
    right: calc(var(--nav-pad) - (var(--hit-min) - var(--icon-xs)) / 2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--hit-min);
    height: var(--hit-min);
    border-radius: var(--radius-inner);
    color: var(--icon-subtle);
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .fold:hover {
    background-color: var(--quiet-hover);
    color: var(--text);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .fold:active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant), var(--dur-hover);
  }

  /* Only the glyph turns (ListDivider's fold): the button and its wash stay still. */
  .chevron {
    display: inline-flex;
    transform: rotate(var(--turn-fold));
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .turned {
    transform: none;
  }

  /* The places: a hairline under the glyph of the entry above. Everything inside what folds, so
     nothing is left to jump when it goes. */
  .children {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .children::before {
    position: absolute;
    top: var(--space-2);
    bottom: 0;
    left: calc(var(--nav-pad) + var(--icon-nav) / 2);
    width: var(--border-width);
    background-color: var(--border-strong);
    content: '';
  }

  /* Its words on the words of the entries with a glyph, the pill right of the hairline. */
  .child {
    flex: none;
    height: var(--nav-child-row);
    margin-left: calc(var(--nav-pad) + var(--icon-nav) + var(--nav-gap) - var(--nav-child-pad));
    padding-left: var(--nav-child-pad);
    font: var(--type-sm);
  }

  .child:first-child {
    margin-top: var(--space-2);
  }

  .child[aria-current='page'] {
    font: var(--type-field-label);
  }

  /* The row keeps its wash under its chevron, as a list's row under its tools. */
  .item:not([aria-current='page']):hover,
  .entry:has(> .fold:hover) > .item:not([aria-current='page']) {
    background-color: var(--quiet-hover);
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
