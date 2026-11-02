<!--
  The menu layer: mounted once (App), fed by lib/state/menu.svelte.ts. One menu at a
  time, drawn by the app on both OS instead of the OS's own popup (a native popup could hang
  the window). It opens at the pointer (a right click) or below its button, above it where
  only there is room, and never covers its button, the title bar or the window's edge: a
  menu taller than the room takes the roomier side and scrolls inside itself (the wheel over
  it scrolls only the menu). The one look of every menu, a select's list and a field's
  suggestions (round 10): rows 32 px with their words 12 px in, 6 px round in a 10 px round
  box with 4 px around them, the pop shadow; it drops in by 4 px (menuIn). A menu has one
  sign for what is chosen, the tick, for a choice, a switch and a select's option alike (the
  owner, 2026-10-30). An icon column stands before the words only where an
  entry has an icon or can carry a tick. No entry names a key. A group may carry a small
  muted heading (12/540 like the list's day and section headings), which the keys pass over.
  A select's list (`listbox`) is a listbox at least as wide as its button and at most seven
  rows high; the focus stays on the button, and a press on an option never takes it.
  The keys, a press outside, the window's blur, resizing and scrolling are handled in
  lib/input/input.ts; hover marks a row at once (the highlight follows the pointer without a
  fade, like the OS's menus), a left click chooses it. An entry that is off is faded as a
  whole, like every control that is off.
-->
<script lang="ts">
  import { px, setVars } from '$lib/actions/cssVars';
  import { tooltip } from '$lib/actions/tooltip';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import {
    chooseEntry,
    isItem,
    menuId,
    menuItemId,
    menuState,
    type MenuSpec,
  } from '$lib/state/menu.svelte';
  import { tokenPx } from '$lib/tokens';
  import type { Action } from 'svelte/action';
  import Icon from './Icon.svelte';

  /** The menu opened above its anchor (it drops in upwards then). */
  let up = $state(false);

  /** The focus goes to the menu and a selection of text stays where it is: WebKit drops it when
   *  the focus moves to anything else, and the menu's Copy needs it. */
  function takeFocus(menu: HTMLElement | null): void {
    const text = getSelection();
    const kept =
      text?.anchorNode && text.focusNode && !text.isCollapsed
        ? ([text.anchorNode, text.anchorOffset, text.focusNode, text.focusOffset] as const)
        : null;
    menu?.focus({ preventScroll: true });
    if (kept !== null && text?.isCollapsed) text.setBaseAndExtent(...kept);
  }

  /**
   * Whole-pixel position inside the window, below its anchor or, where only there is room,
   * above it. It never covers its anchor (a second click on a menu button reaches the
   * button) nor the title bar: a menu taller than both sides takes the roomier one and
   * scrolls inside it.
   */
  const place: Action<HTMLElement, MenuSpec> = (node, { anchor, listbox = false }) => {
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
    setVars(node, {
      'menu-height': px(bottom - top),
      'menu-least': anchor.kind === 'below' && listbox ? px(anchor.rect.width) : 'auto',
    });
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
    // An anchor out of view (the Menu key on a row scrolled away) leaves it inside the window.
    const y = Math.max(top, Math.min(up ? above - h : below, bottom - h));
    setVars(node, { 'menu-x': px(x), 'menu-y': px(y) });
    // The menu takes the keys (the entries are no tab stops; the active one is announced). A
    // select's button keeps the focus: it announces the active option itself.
    if (!listbox) takeFocus(node.querySelector<HTMLElement>('.menu'));
    node.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  };

  /** The icon column stands only where an entry has an icon or can carry a tick. */
  const leads = (spec: MenuSpec): boolean =>
    spec.entries.some(
      (entry) =>
        isItem(entry) &&
        (Boolean(entry.icon) || (entry.checked !== undefined && entry.checked !== null)),
    );
</script>

{#if menuState.open}
  {@const open = menuState.open}
  {#key open.id}
    {@const listbox = open.listbox === true}
    {@const lead = leads(open)}
    <div class="layer" data-menu-layer use:place={open}>
      <div
        class="frame"
        class:listbox
        role="presentation"
        in:menuIn|global={{ up }}
        out:menuOut
        onpointerleave={() => (menuState.active = -1)}
      >
        <div
          class="menu"
          id={menuId(open.id)}
          role={listbox ? 'listbox' : 'menu'}
          tabindex="-1"
          aria-label={open.label}
          aria-activedescendant={!listbox && menuState.active >= 0
            ? menuItemId(open.id, menuState.active)
            : null}
          data-testid="menu"
        >
          <div class="plate">
            {#each open.entries as entry, index (index)}
              {#if isItem(entry)}
                {@const choice = entry.checked !== undefined && entry.checked !== null}
                {@const role = listbox
                  ? 'option'
                  : entry.toggle
                    ? 'menuitemcheckbox'
                    : choice
                      ? 'menuitemradio'
                      : 'menuitem'}
                <button
                  type="button"
                  class="item"
                  class:active={menuState.active === index}
                  class:danger={entry.danger === true}
                  id={menuItemId(open.id, index)}
                  {role}
                  aria-checked={role === 'menuitem' || listbox ? undefined : entry.checked === true}
                  aria-selected={listbox ? entry.checked === true : undefined}
                  aria-disabled={entry.disabled === true ? 'true' : undefined}
                  tabindex="-1"
                  data-active={menuState.active === index ? '' : undefined}
                  data-keep-focus={listbox ? '' : undefined}
                  data-testid="menu-item-{entry.id}"
                  use:tooltip={entry.disabled === true && entry.reason ? entry.reason : ''}
                  onpointerenter={() => (menuState.active = index)}
                  onclick={() => chooseEntry(index)}
                >
                  {#if lead}
                    <span class="lead">
                      {#if entry.checked === true}
                        <span class="tick"><Icon name="check" size="sm" /></span>
                      {:else if entry.icon}
                        <Icon name={entry.icon} size="sm" />
                      {/if}
                    </span>
                  {/if}
                  <span class="label">{entry.label}</span>
                </button>
              {:else if entry.kind === 'heading'}
                <div class="heading" role="presentation" data-testid="menu-heading">
                  {entry.label}
                </div>
              {:else}
                <div class="separator" role="separator"></div>
              {/if}
            {/each}
          </div>
        </div>
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

  /* The box: its corners, edge and shadow, 4 around the rows. */
  .frame {
    display: flex;
    flex-direction: column;
    min-width: var(--menu-min);
    max-width: var(--menu-max);
    max-height: var(--menu-height);
    padding: var(--menu-pad);
    border: var(--border-width) solid var(--border);
    border-radius: var(--menu-radius);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-pop);
  }

  /* The list that scrolls; on Windows its track lies in the frame's right padding (base.css). */
  .menu {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  /* The rows on a plate of their own, inside the corners: only so the words on a rounded box
     draw as crisply as the page's (LCD antialiasing needs an opaque ground). Not the list's own
     background: that lies under the track and over the corners, and rounded it loses the words'
     crispness. */
  .plate {
    display: flex;
    flex-direction: column;
    background-color: var(--surface-raised);
  }

  /* A select's list: at least as wide as its button, at most seven rows high. */
  .frame.listbox {
    min-width: var(--menu-least);
    max-height: min(var(--menu-height), var(--menu-max-height));
  }

  .item {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-8);
    height: var(--menu-row);
    padding: 0 var(--menu-row-pad);
    border: none;
    border-radius: var(--menu-row-radius);
    background-color: transparent;
    color: var(--text);
    font: var(--type-md);
    text-align: start;
    cursor: default;
  }

  /* The quiet kind (tokens.css): a wash on the entry under the pointer or the keys, a
     deeper one while the left button holds it. */
  .item.active:not([aria-disabled='true']) {
    background-color: var(--quiet-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .item:not([aria-disabled='true']):active:hover {
    background-color: var(--quiet-press);
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
    opacity: var(--opacity-disabled);
  }

  .lead {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--menu-icon);
  }

  .tick {
    display: inline-flex;
    color: var(--chosen-text);
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

  /* A group's name: small and muted, above its entries, in the weight of the list's day
     headings. */
  .heading {
    display: flex;
    flex: none;
    align-items: flex-end;
    height: var(--menu-heading);
    padding: 0 var(--menu-row-pad) var(--space-4);
    color: var(--text-muted);
    font: var(--type-day);
  }

  .separator {
    flex: none;
    margin: var(--space-4) var(--menu-row-pad);
    border-top: var(--border-width) solid var(--border);
  }
</style>
