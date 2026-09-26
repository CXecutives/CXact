<!--
  The menu layer: mounted once (App, Gallery), fed by lib/state/menu.svelte.ts. One menu at a
  time, drawn by the app on both OS instead of the OS's own popup (a native popup could hang
  the window). It opens at the pointer (a right click) or below its button, flips at the
  window's edges and never leaves the window: a menu taller than the window scrolls inside
  itself (the wheel over it scrolls only the menu). Rows are 30 px with the text of a field,
  a fixed icon column (the check of a choice sits there too) and the keys right and quiet.
  The keys, a press outside, the window's blur, resizing and scrolling are handled in
  lib/input/input.ts; hover marks a row, a left click chooses it.
-->
<script lang="ts">
  import { px, setVars } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import { chooseEntry, isItem, menuState, type MenuAnchor } from '$lib/state/menu.svelte';
  import { tokenPx } from '$lib/tokens';
  import type { Action } from 'svelte/action';
  import Icon from './Icon.svelte';

  /** The menu opened above its anchor (it drops in upwards then). */
  let up = $state(false);

  /** Whole-pixel position inside the window, flipped where there is no room. */
  const place: Action<HTMLElement, MenuAnchor> = (node, anchor) => {
    const edge = tokenPx('--viewport-gap');
    const gap = tokenPx('--menu-gap');
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    setVars(node, { 'menu-height': px(height - 2 * edge) });
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let x: number;
    let y: number;
    if (anchor.kind === 'point') {
      x = anchor.x + w <= width - edge ? anchor.x : anchor.x - w;
      const below = anchor.y + h <= height - edge;
      up = !below && anchor.y - h >= edge;
      y = below ? anchor.y : up ? anchor.y - h : height - edge - h;
    } else {
      const r = anchor.rect;
      x = anchor.align === 'end' ? r.right - w : r.left;
      const below = r.bottom + gap + h <= height - edge;
      up = !below && r.top - gap - h >= edge;
      y = below ? r.bottom + gap : up ? r.top - gap - h : height - edge - h;
    }
    x = Math.max(edge, Math.min(x, width - edge - w));
    y = Math.max(edge, y);
    setVars(node, { 'menu-x': px(x), 'menu-y': px(y) });
    // The menu takes the keys (the entries are no tab stops; the active one is announced).
    node.querySelector<HTMLElement>('[role="menu"]')?.focus({ preventScroll: true });
  };

  const itemId = (menu: number, index: number): string => `menu-${menu}-${index}`;
</script>

{#if menuState.open}
  {@const open = menuState.open}
  {#key open.id}
    <div class="layer" data-menu-layer use:place={open.anchor}>
      <div
        class="menu"
        role="menu"
        tabindex="-1"
        aria-label={open.label}
        aria-activedescendant={menuState.active >= 0 ? itemId(open.id, menuState.active) : null}
        data-testid="menu"
        in:menuIn={{ up }}
        out:menuOut
        onpointerleave={() => (menuState.active = -1)}
      >
        {#each open.entries as entry, index (index)}
          {#if isItem(entry)}
            {@const choice = entry.checked !== undefined && entry.checked !== null}
            <button
              type="button"
              class="item"
              class:active={menuState.active === index}
              class:danger={entry.danger === true}
              id={itemId(open.id, index)}
              role={choice ? 'menuitemradio' : 'menuitem'}
              aria-checked={choice ? entry.checked === true : undefined}
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
              {#if entry.keys}<span class="keys">{entry.keys}</span>{/if}
            </button>
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
    border-radius: var(--menu-radius);
    background-color: var(--surface);
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

  .item.active:not([aria-disabled='true']) {
    background-color: var(--surface-hover);
    transition-duration: var(--dur-hover);
  }

  .item.danger.active:not([aria-disabled='true']) {
    background-color: var(--danger-soft);
    color: var(--danger-strong);
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

  .item.danger.active .lead {
    color: inherit;
  }

  .label {
    overflow: hidden;
    flex: 1;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keys {
    flex: none;
    padding-inline-start: var(--space-16);
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  .separator {
    flex: none;
    height: var(--border-width);
    margin: var(--space-4) var(--menu-inset);
    background-color: var(--border);
  }
</style>
