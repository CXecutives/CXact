<!--
  The three caption buttons of the Windows window, drawn by the app like the ones of Windows 11
  (the top bar is the app's own, features/shell/TitleBar.svelte): Minimieren, Maximieren
  (Verkleinern while the window is maximized, its glyph two squares) and Schließen, each 46 px
  wide over the bar's whole height, not in the tab order, like the native ones. Their glyphs
  (minus, square, two squares, x) are drawn in the app's 24-unit grid with its one stroke
  (--icon-stroke), 14 px, so they weigh like every other glyph. In the design's colours,
  never the system's: the muted ink, under the pointer the design's warm grey wash, pressed a
  deeper one; Schließen turns the app's danger red with a white glyph.
  While the window is in the back the glyphs fade. Each names itself in a tooltip in the
  words of Windows.
  In the app a window of the OS lies over the bar and takes the pointer there
  (src-tauri/src/platform.rs: only an answer of the window procedure opens the snap layouts
  of Windows 11 over Maximieren): it performs the click itself and reports which button the
  pointer is over and which one is pressed (`onCaption`); the buttons show that state as if
  the pointer were over the page, tooltip included. In a browser (the harness)
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
      <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
        {#if id === 'minimize'}
          <path d="M5 12h14" />
        {:else if id === 'close'}
          <path d="M18 6 6 18M6 6l12 12" />
        {:else if maximized}
          <rect x="3" y="7" width="14" height="14" rx="2" />
          <path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
        {:else}
          <rect x="3" y="3" width="18" height="18" rx="2" />
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
    color: var(--text-muted);
    transition:
      background-color var(--dur-base) var(--ease-standard),
      color var(--dur-base) var(--ease-standard);
  }

  .glyph {
    width: var(--caption-glyph);
    height: var(--caption-glyph);
    fill: none;
    stroke: currentcolor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: var(--icon-stroke);
  }

  /* The window in the back (`data-window` on the root, lib/platform.ts): the glyphs fade. */
  :global([data-window='inactive']) .caption {
    color: var(--titlebar-fg-inactive);
  }

  .caption:hover,
  .caption.hover {
    background-color: var(--caption-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .caption:active:hover,
  .caption.pressed {
    background-color: var(--caption-press);
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
