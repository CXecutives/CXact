<!--
  The toast stack, bottom right (mounted once in App and the gallery), the only place that
  draws a toast: short confirmations that rise in (150 ms) and slide out sideways (100 ms),
  at most three, the stack moving up as one leaves. Each kind's glyph and each toast's time
  come from the tables of lib/state/toasts.svelte.ts (TOAST_KINDS, TOAST_LIFE): a plain
  toast stays 4 s, one with a button 10 s. A 2 px navy line at the
  bottom drains over that time and stops while the toast is hovered (so does its timer),
  and every toast waits while the window is in the back or a modal dialog is open; under
  reduced motion there is no line. The stack lies below a dialog's scrim: dimmed, and its
  undo cannot act behind the dialog.
  The sentence has room for a job's title (520 px) and wraps to at most two lines: the
  title in the catalog's quotes („…“ or “…”) keeps to one line and ends in an ellipsis
  that the closing quote follows directly (the full title in a tooltip; cut by measuring
  the text, since CSS would leave the rest of the box blank before the quote), the rest
  of the sentence follows it.
  The check of a success draws itself once as the toast appears. Closable; an undo of what
  the user just did sits before the close button, its key (Strg+Z, ⌘Z) in its tooltip; a
  toast about something that happened in another view (a fetch that finished) may carry
  the way to it instead ("Zeigen"). A merged toast ("2 Jobs archiviert.") cross-fades its
  sentence (100 ms) and starts its line again.
  A press on a toast never takes the focus (like a notification of the OS: the list keeps
  its keys); a toast the keyboard reached gives the focus back to where it came from when
  it goes by its buttons. The stack lies above a bar that sticks to the bottom of the view
  (the Profil's save bar): it measures what lies under its column at the window's bottom
  edge whenever a toast comes or the view changes, and rises by it (--toast-bottom).
-->
<script lang="ts" module>
  import type { Action } from 'svelte/action';
  import { tooltip } from '$lib/actions/tooltip';

  /** A sentence around one quoted name: German „…“, English “…”. */
  const QUOTED = /^(.*?)([„“])([^“”]+)([“”])(.*)$/su;

  interface Quoted {
    before: string;
    open: string;
    name: string;
    close: string;
    after: string;
  }

  /** The quoted name of a toast's sentence (a job's title), or null. */
  export function quoted(text: string): Quoted | null {
    const match = QUOTED.exec(text);
    if (match === null) return null;
    const [, before = '', open = '', name = '', close = '', after = ''] = match;
    return { before, open, name, close, after };
  }

  const ELLIPSIS = '…';

  /**
   * The longest start of `name` that fits `room` together with the quotes and an ellipsis
   * (`width` measures a string), or `name` itself when it fits whole.
   */
  export function fitted(
    split: Pick<Quoted, 'open' | 'name' | 'close'>,
    room: number,
    width: (text: string) => number,
  ): string {
    const { open, name, close } = split;
    if (width(`${open}${name}${close}`) <= room) return name;
    const chars = [...name];
    let low = 0;
    let high = chars.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const cut = `${chars.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`;
      if (width(`${open}${cut}${close}`) <= room) low = mid;
      else high = mid - 1;
    }
    return `${chars.slice(0, low).join('').trimEnd()}${ELLIPSIS}`;
  }

  let pen: CanvasRenderingContext2D | null = null;

  /** The width of `text` in the font of `node` (no layout: the canvas measures it). */
  function textWidth(node: Element, text: string): number {
    pen ??= document.createElement('canvas').getContext('2d');
    if (pen === null) return 0;
    const style = getComputedStyle(node);
    pen.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return pen.measureText(text).width;
  }

  /**
   * The quoted title fits the line of the toast (the width of its sentence, watched): cut
   * after the last character that fits with the ellipsis, so the closing quote follows it
   * directly; only a cut title has the full one in a tooltip.
   */
  const fitName: Action<HTMLElement, Quoted> = (node, split) => {
    const tip = tooltip(node, null);
    const line = node.closest('.text');
    const place = (room: number): void => {
      // A pixel of room is kept: the canvas and the layout may round apart.
      const shown = fitted(split, room - 1, (text) => textWidth(node, text));
      node.textContent = shown;
      tip?.update?.(shown === split.name ? null : split.name);
    };
    node.textContent = split.name;
    if (line === null) return { destroy: () => tip?.destroy?.() };
    const watch = new ResizeObserver(([entry]) => {
      if (entry !== undefined) place(entry.contentRect.width);
    });
    watch.observe(line);
    return {
      destroy() {
        watch.disconnect();
        tip?.destroy?.();
      },
    };
  };
</script>

<script lang="ts">
  import { cssVars, px, setVars } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import { onWindowFocus } from '$lib/ipc/api';
  import { fade, flip, toastIn, toastOut } from '$lib/motion/transitions';
  import { navigation } from '$lib/state/navigation.svelte';
  import { actionKind, isUndo, TOAST_KINDS, TOAST_LIFE, toasts } from '$lib/state/toasts.svelte';
  import { tokenPx } from '$lib/tokens';
  import { tick } from 'svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let hovered = $state<number | null>(null);
  let stack = $state<HTMLElement | null>(null);
  /** Where the focus was before the keyboard brought it into the stack. */
  let cameFrom: HTMLElement | null = null;

  function focusIn(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && stack !== null && !stack.contains(from)) cameFrom = from;
  }

  /** Run what a toast's button does; a focus inside the stack goes back where it came from. */
  function act(run: () => void): void {
    const inside = stack?.contains(document.activeElement) ?? false;
    run();
    if (!inside) return;
    const back = cameFrom;
    cameFrom = null;
    void tick().then(() => {
      if (back?.isConnected) back.focus({ preventScroll: true });
    });
  }

  /** How high a bar stuck to the window's bottom edge reaches under the stack's column (the
   *  Profil's save bar): the stack rises above it. Hits in the app's own layers do not
   *  count. */
  function barRoom(node: HTMLElement): number {
    const root = document.documentElement;
    const bottom = root.clientHeight - 1;
    const right = root.clientWidth - tokenPx('--space-24');
    const left = Math.max(0, right - tokenPx('--toast-width'));
    const step = tokenPx('--space-24');
    let room = 0;
    for (let x = left; x <= right; x += step) {
      for (const hit of document.elementsFromPoint(x, bottom)) {
        if (node.contains(hit) || hit.closest('[data-menu-layer], [role="tooltip"]')) continue;
        const bar = stuck(hit, bottom);
        if (bar !== null)
          room = Math.max(room, root.clientHeight - bar.getBoundingClientRect().top);
        break;
      }
    }
    return room;
  }

  /** The sticky or fixed bar at `hit` or around it that touches the bottom edge (a layer
   *  over the whole window, a dialog's scrim, is no bar). */
  function stuck(hit: Element, bottom: number): Element | null {
    for (let at: Element | null = hit; at !== null && at !== document.body; at = at.parentElement) {
      const position = getComputedStyle(at).position;
      if (position !== 'sticky' && position !== 'fixed') continue;
      const box = at.getBoundingClientRect();
      return box.bottom >= bottom && box.height < bottom / 2 ? at : null;
    }
    return null;
  }

  // A toast comes or the view changes: the stack rises above a bar at the bottom.
  $effect(() => {
    void navigation.current;
    const count = toasts.items.length;
    const node = stack;
    if (node === null || count === 0) return;
    void tick().then(() => setVars(node, { 'toast-bottom': px(barRoom(node)) }));
  });

  // The window in the back: every toast waits until it is in front again.
  $effect(() => {
    let release: (() => void) | null = null;
    const stop = onWindowFocus((focused) => {
      if (focused) {
        release?.();
        release = null;
      } else if (release === null) {
        release = toasts.hold();
      }
    });
    return () => {
      stop();
      release?.();
    };
  });
</script>

{#snippet sentence(text: string)}
  {@const split = quoted(text)}
  {#if split}{split.before}<span class="quoted"
      >{split.open}<span class="name" use:fitName={split}></span>{split.close}</span
    >{split.after}{:else}{text}{/if}
{/snippet}

<svelte:window
  onresize={() => {
    if (stack !== null && toasts.items.length > 0) {
      setVars(stack, { 'toast-bottom': px(barRoom(stack)) });
    }
  }}
/>

<div
  class="stack"
  class:held={toasts.held}
  role="status"
  aria-live="polite"
  data-testid="toasts"
  data-press-only
  bind:this={stack}
  onfocusin={focusIn}
>
  {#each toasts.items as toast (toast.id)}
    {@const look = TOAST_KINDS[toast.kind]}
    <div
      class="toast {toast.kind}"
      class:paused={hovered === toast.id}
      class:draws={look.draws}
      role="group"
      data-testid="toast"
      data-kind={toast.kind}
      use:cssVars={{ 'toast-life': `var(${TOAST_LIFE[actionKind(toast.action)]})` }}
      animate:flip
      in:toastIn
      out:toastOut
      onpointerenter={() => {
        hovered = toast.id;
        toasts.pause(toast.id);
      }}
      onpointerleave={() => {
        hovered = null;
        toasts.resume(toast.id);
      }}
    >
      <span class="icon"><Icon name={look.icon} size="sm" /></span>
      {#key toast.text}<span class="text" data-testid="toast-text" in:fade
          >{@render sentence(toast.text)}</span
        >{/key}
      {#if toast.action}
        {@const action = toast.action}
        <span class="action">
          <Button
            variant="ghost"
            size="sm"
            label={action.label}
            keys={isUndo(action) ? 'mod+z' : null}
            testid="toast-action"
            onclick={() => act(() => toasts.act(toast.id))}
          />
        </span>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        icon="close"
        iconOnly
        label={t.common.hide}
        onclick={() => act(() => toasts.dismiss(toast.id))}
      />
      {#key toast.round}<span class="life" aria-hidden="true"></span>{/key}
    </div>
  {/each}
</div>

<style>
  /* Below the scrim of a dialog (--z-toast < --z-overlay): dimmed with the page. */
  .stack {
    position: fixed;
    right: var(--space-24);
    bottom: calc(var(--space-24) + var(--toast-bottom));
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-8);
    pointer-events: none;
  }

  .toast {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: var(--toast-width);
    max-width: calc(100vw - 2 * var(--space-24));
    overflow: hidden;
    padding: var(--space-6) var(--space-6) var(--space-6) var(--space-16);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
    color: var(--text);
    font: var(--type-md);
    pointer-events: auto;
  }

  .icon,
  .action {
    display: inline-flex;
    flex: none;
  }

  /* Each kind in its status colour (the glyph comes from TOAST_KINDS). */
  .success .icon {
    color: var(--success-strong);
  }

  .info .icon {
    color: var(--info);
  }

  .warning .icon {
    color: var(--warning-strong);
  }

  /* The check draws itself once when the toast appears. */
  .draws .icon :global(path) {
    stroke-dasharray: var(--draw-length);
    animation: draw var(--dur-slow) var(--ease-out) var(--dur-instant) both;
  }

  /* One or two lines with room above and below (10 px to the edge with the padding). */
  .text {
    flex: 1;
    min-width: 0;
    padding-block: var(--space-4);
    text-wrap: pretty;
  }

  /* The quoted title keeps to one line, cut to fit by fitName; the rest of the sentence
     follows it. */
  .quoted {
    display: inline-flex;
    max-width: 100%;
    white-space: nowrap;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The lifetime line: it drains from the right over the toast's time, and stops while
     the toast is hovered or every toast waits. */
  .life {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: var(--focus-width);
    background-color: var(--toast-bar);
    transform-origin: left center;
    animation: drain var(--toast-life) linear forwards;
  }

  .paused .life,
  .held .life {
    animation-play-state: paused;
  }

  :global(:root[data-motion='reduce']) .life {
    display: none;
  }
</style>
