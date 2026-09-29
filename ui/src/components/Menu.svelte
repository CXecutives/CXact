<!--
  The menu layer: mounted once (App, Gallery), fed by lib/state/menu.svelte.ts. One menu at a
  time, drawn by the app on both OS instead of the OS's own popup (a native popup could hang
  the window). It opens at the pointer (a right click) or below its button, above it where
  only there is room, and never covers its button, the title bar or the window's edge: a
  menu taller than the room takes the roomier side and scrolls inside itself (the wheel over
  it scrolls only the menu). Rows are 30 px with the text of a field
  and a fixed icon column (the check of a choice or a switch sits there too); no entry names
  a key. A group may carry a small muted heading, which the keys pass over.
  A popover whose entries are all lines only tells (the reader's "Warum diese Zahl?"): a
  dialog of lines, each the icon of its verdict and its words (ReasonItem), wrapping where
  they are long; nothing in it is chosen, Esc, Tab and a press outside close it.
  The keys, a press outside, the window's blur, resizing and scrolling are handled in
  lib/input/input.ts; hover marks a row, a left click chooses it.
-->
<script lang="ts">
  import { px, setVars } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import {
    chooseEntry,
    isItem,
    menuState,
    tellsOnly,
    type MenuAnchor,
  } from '$lib/state/menu.svelte';
  import { tokenPx } from '$lib/tokens';
  import type { Action } from 'svelte/action';
  import Icon from './Icon.svelte';
  import ReasonItem from './ReasonItem.svelte';

  /** The menu opened above its anchor (it drops in upwards then). */
  let up = $state(false);

  /**
   * Whole-pixel position inside the window, below its anchor or, where only there is room,
   * above it. It never covers its anchor (a second click on a menu button reaches the
   * button) nor the title bar: a menu taller than both sides takes the roomier one and
   * scrolls inside it.
   */
  const place: Action<HTMLElement, MenuAnchor> = (node, anchor) => {
    const edge = tokenPx('--viewport-gap');
    const gap = tokenPx('--menu-gap');
    const width = document.documentElement.clientWidth;
    const top = tokenPx('--titlebar-height') + edge;
    const bottom = document.documentElement.clientHeight - edge;
    // The anchor's span: a point, or the button with the gap around it.
    const [above, below] =
      anchor.kind === 'point'
        ? [anchor.y, anchor.y]
        : [anchor.rect.top - gap, anchor.rect.bottom + gap];
    setVars(node, { 'menu-height': px(bottom - top) });
    const w = node.offsetWidth;
    let h = node.offsetHeight;
    const roomBelow = bottom - below;
    const roomAbove = above - top;
    up = h > roomBelow && (h <= roomAbove || roomAbove > roomBelow);
    const room = up ? roomAbove : roomBelow;
    if (h > room) {
      setVars(node, { 'menu-height': px(Math.max(0, room)) });
      h = node.offsetHeight;
    }
    let x: number;
    if (anchor.kind === 'point') {
      x = anchor.x + w <= width - edge ? anchor.x : anchor.x - w;
    } else {
      x = anchor.align === 'end' ? anchor.rect.right - w : anchor.rect.left;
    }
    x = Math.max(edge, Math.min(x, width - edge - w));
    const y = up ? above - h : below;
    setVars(node, { 'menu-x': px(x), 'menu-y': px(y) });
    // The menu takes the keys (the entries are no tab stops; the active one is announced).
    node.querySelector<HTMLElement>('.menu')?.focus({ preventScroll: true });
  };

  const itemId = (menu: number, index: number): string => `menu-${menu}-${index}`;
</script>

{#if menuState.open}
  {@const open = menuState.open}
  {@const telling = tellsOnly(open.entries)}
  {#key open.id}
    <div class="layer" data-menu-layer use:place={open.anchor}>
      <div
        class="menu"
        class:telling
        role={telling ? 'dialog' : 'menu'}
        tabindex="-1"
        aria-label={open.label}
        aria-activedescendant={!telling && menuState.active >= 0
          ? itemId(open.id, menuState.active)
          : null}
        data-testid="menu"
        in:menuIn={{ up }}
        out:menuOut
        onpointerleave={() => (menuState.active = -1)}
      >
        {#each open.entries as entry, index (index)}
          {#if isItem(entry)}
            {@const choice = entry.checked !== undefined && entry.checked !== null}
            {@const role = entry.toggle
              ? 'menuitemcheckbox'
              : choice
                ? 'menuitemradio'
                : 'menuitem'}
            <button
              type="button"
              class="item"
              class:active={menuState.active === index}
              class:danger={entry.danger === true}
              id={itemId(open.id, index)}
              {role}
              aria-checked={role === 'menuitem' ? undefined : entry.checked === true}
              aria-disabled={entry.disabled === true ? 'true' : undefined}
              tabindex="-1"
              data-testid="menu-item-{entry.id}"
              use:tooltip={entry.disabled === true && entry.reason ? entry.reason : ''}
              onpointerenter={() => (menuState.active = index)}
              onclick={() => chooseEntry(index)}
            >
              <span class="lead">
                {#if entry.checked === true}
                  <Icon name="check" size="sm" />
                {:else if entry.icon}
                  <Icon name={entry.icon} size="sm" />
                {/if}
              </span>
              <span class="label">{entry.label}</span>
            </button>
          {:else if entry.kind === 'heading'}
            <div class="heading" role="presentation" data-testid="menu-heading">
              {entry.label}
            </div>
          {:else if entry.kind === 'line'}
            <div class="line" data-testid="menu-line-{entry.id}">
              <ReasonItem kind={entry.verdict} label={entry.label} />
            </div>
          {:else}
            <div class="separator" role="separator"></div>
          {/if}
        {/each}
      </div>
    </div>
  {/key}
{/if}

<style>
  .layer {
    position: fixed;
    z-index: var(--z-menu);
    top: 0;
    left: 0;
    transform: translate(var(--menu-x), var(--menu-y));
  }

  .menu {
    display: flex;
    flex-direction: column;
    min-width: var(--menu-min);
    max-width: var(--menu-max);
    max-height: var(--menu-height);
    padding: var(--menu-pad);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: var(--border-width) solid var(--border);
    border-radius: var(--menu-radius);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-menu);
    outline: none;
  }

  .item {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-8);
    height: var(--menu-row);
    padding: 0 var(--menu-inset);
    border: none;
    border-radius: var(--menu-row-radius);
    background-color: transparent;
    color: var(--text);
    font: var(--type-field);
    text-align: start;
    cursor: default;
    transition: background-color var(--dur-base) var(--ease-out);
  }

  /* The quiet kind (tokens.css): a wash on the entry under the pointer or the keys, a
     deeper one while the left button holds it. */
  .item.active:not([aria-disabled='true']) {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .item:not([aria-disabled='true']):active:hover {
    background-color: var(--quiet-press);
    transition-duration: var(--dur-instant);
  }

  /* Deleting (Löschen, Endgültig löschen): red at rest like its button, on a red wash when
     active. */
  .item.danger:not([aria-disabled='true']) {
    color: var(--danger-strong);
  }

  .item.danger.active:not([aria-disabled='true']) {
    background-color: var(--danger-soft);
  }

  .item[aria-disabled='true'] {
    color: var(--text-subtle);
  }

  .lead {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--menu-icon);
    color: var(--text-muted);
  }

  .item.danger:not([aria-disabled='true']) .lead {
    color: inherit;
  }

  .label {
    overflow: hidden;
    flex: 1;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A group's name: small and muted, above its entries. */
  .heading {
    display: flex;
    flex: none;
    align-items: flex-end;
    height: var(--menu-heading);
    padding: 0 var(--menu-inset) var(--space-4);
    color: var(--text-muted);
    font: var(--type-xs);
  }

  /* A line that only tells: the verdict's icon, then its words, which wrap. */
  .line {
    display: flex;
    flex: none;
    padding: var(--space-6) var(--menu-inset);
  }

  .telling {
    padding-block: var(--space-6);
  }

  .separator {
    flex: none;
    height: var(--border-width);
    margin: var(--space-4) var(--menu-inset);
    background-color: var(--border);
  }
</style>
