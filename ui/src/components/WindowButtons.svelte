<!--
  The three caption buttons of the Windows window, drawn by the app like the ones of Windows 11
  (the top bar is the app's own, features/shell/TitleBar.svelte): Minimieren, Maximieren
  (Verkleinern while the window is maximized, its glyph two squares) and Schließen, each 46 px
  wide over the bar's whole height with a 10 px glyph of thin lines, not in the tab order,
  like the native ones. In the design's colours, never the system's: under the pointer its
  quiet wash, pressed a deeper one; Schließen turns the app's danger red with a white glyph.
  While the window is in the back the glyphs fade. Each names itself in a tooltip in the
  words of Windows.
  In the app a window of the OS lies over the bar and takes the pointer there
  (src-tauri/src/platform.rs: only an answer of the window procedure opens the snap layouts
  of Windows 11 over Maximieren): it performs the click itself and reports which button the
  pointer is over and which one is pressed (`onCaption`); the buttons show that state as if
  the pointer were over the page, tooltip included. In a browser (the harness, the gallery)
  they answer the pointer themselves and click through `window_button`.
-->
<script lang="ts">
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';
  import { t } from '$lib/i18n/t';
  import { invoke, onCaption, onWindowState, reportUiError, type WindowButton } from '$lib/ipc/api';

  interface Props {
    testid?: string;
  }

  let { testid = 'window-buttons' }: Props = $props();

  /** From the left, like Windows. */
  const BUTTONS: readonly WindowButton[] = ['minimize', 'maximize', 'close'];

  let maximized = $state(false);
  /** The button under the pointer and the one pressed, as the window over the bar reports
   *  them (in a browser the buttons' own :hover and :active say it). */
  let hover = $state<WindowButton | null>(null);
  let pressed = $state<WindowButton | null>(null);

  /** The buttons by name (not state): the report stands in for the pointer on them. */
  const nodes: Partial<Record<WindowButton, HTMLElement>> = {};
  const known: Action<HTMLElement, WindowButton> = (node, id) => {
    nodes[id] = node;
    return { destroy: () => delete nodes[id] };
  };

  function label(id: WindowButton): string {
    if (id === 'maximize') return maximized ? t.window.restore : t.window.maximize;
    return t.window[id];
  }

  /** The tooltip follows the pointer's events: the reported pointer sends them. */
  function follow(next: { hover: WindowButton | null; pressed: WindowButton | null }): void {
    if (next.hover !== hover) {
      if (hover !== null) nodes[hover]?.dispatchEvent(new PointerEvent('pointerleave'));
      if (next.hover !== null) nodes[next.hover]?.dispatchEvent(new PointerEvent('pointerenter'));
    }
    if (next.pressed !== null && next.pressed !== pressed) {
      nodes[next.pressed]?.dispatchEvent(new PointerEvent('pointerdown'));
    }
    hover = next.hover;
    pressed = next.pressed;
  }

  $effect(() => {
    invoke('window_maximized').then(
      (value) => (maximized = value),
      () => undefined,
    );
    const stopState = onWindowState((value) => (maximized = value));
    const stopCaption = onCaption(follow);
    return () => {
      stopState();
      stopCaption();
    };
  });

  /** A click in a browser (in the app the window over the bar performs it). */
  function press(id: WindowButton): void {
    invoke('window_button', { button: id }).catch((error: unknown) => {
      reportUiError(`window ${id}: ${String(error)}`, null, null);
    });
  }
</script>

<div class="buttons" data-testid={testid}>
  {#each BUTTONS as id (id)}
    <button
      type="button"
      class="caption {id}"
      class:hover={hover === id}
      class:pressed={pressed === id && hover === id}
      tabindex="-1"
      aria-label={label(id)}
      data-testid="window-{id}"
      use:known={id}
      use:tooltip={label(id)}
      onclick={() => press(id)}
    >
      <svg class="glyph" viewBox="0 0 10 10" aria-hidden="true">
        {#if id === 'minimize'}
          <path d="M0 5.5H10" />
        {:else if id === 'close'}
          <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
        {:else if maximized}
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
          <path
            d="M2.5 2.5V1.5A1 1 0 0 1 3.5 0.5H8.5A1 1 0 0 1 9.5 1.5V6.5A1 1 0 0 1 8.5 7.5H7.5"
          />
        {:else}
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
        {/if}
      </svg>
    </button>
  {/each}
</div>

<style>
  .buttons {
    display: flex;
    flex: none;
    align-self: stretch;
  }

  .caption {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--titlebar-button-width);
    height: 100%;
    color: var(--titlebar-fg);
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .glyph {
    width: var(--titlebar-glyph);
    height: var(--titlebar-glyph);
    fill: none;
    stroke: currentcolor;
    stroke-width: var(--titlebar-glyph-stroke);
  }

  /* The window in the back (`data-window` on the root, lib/platform.ts): the glyphs fade. */
  :global([data-window='inactive']) .caption {
    color: var(--titlebar-fg-inactive);
  }

  .caption:hover,
  .caption.hover {
    background-color: var(--titlebar-button-hover);
    color: var(--titlebar-fg);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .caption:active:hover,
  .caption.pressed {
    background-color: var(--titlebar-button-press);
  }

  .close:hover,
  .close.hover {
    background-color: var(--titlebar-close-hover);
    color: var(--titlebar-close-fg);
  }

  :global(:where(:root:not([data-aux-press]))) .close:active:hover,
  .close.pressed {
    background-color: var(--titlebar-close-press);
    color: var(--titlebar-close-fg);
  }
</style>
