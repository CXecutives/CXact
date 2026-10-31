<!--
  The toast stack, bottom right (mounted once in App), the only place that draws a toast
  (the round 10 draft): short confirmations, 18 from the window's corner, that come up 8 px
  as they fade in and go down as they fade out, at most three, the stack moving up as one
  leaves. Each kind's sign and each toast's time come from the tables of
  lib/state/toasts.svelte.ts (TOAST_KINDS, TOAST_LIFE): a plain toast stays 4 s, one with a
  button 10 s. A toast is white with a hairline, 14 round, one height with or without its
  link (46) and as wide as its words between --toast-min and --toast-max: its sign (16 like
  every control's glyph, in the kind's colour; none for a plain one), its sentence (500; two
  lines at most, then an ellipsis) and its one link in navy like the app's other inline
  actions (an undo of what the user just did, or the way to what happened in another view:
  "Zeigen"). No close button (decision 8, 2026-10-24): a toast goes on its own, and its time
  stops while the pointer is on it or the keyboard's focus is in it. Every toast also waits while the window is in the back or a modal dialog is open.
  The stack lies below a dialog's scrim: dimmed, and its undo cannot act behind the dialog.
  The check of a success draws itself once as the toast appears. A merged toast (two rows
  archived one after the other) cross-fades its sentence (100 ms) and starts its time again.
  The sentence of a warning copies (`data-copy`).
  A press on a toast never takes the focus (like a notification of the OS); a toast the
  keyboard reached gives the focus back to where it came from when it goes by its button.
  The stack rises above a bar that sticks to the window's bottom edge (BottomBar, the
  setup's foot on its long steps: `toasts.lift`, lib/actions/liftToasts.ts).
-->
<script lang="ts">
  import { cssVars, px } from '$lib/actions/cssVars';
  import { onWindowFocus } from '$lib/ipc/api';
  import { fade, flip, toastIn, toastOut } from '$lib/motion/transitions';
  import { TOAST_KINDS, toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let stack = $state<HTMLElement | null>(null);
  /** Where the focus was before the keyboard brought it into the stack. */
  let cameFrom: HTMLElement | null = null;
  /** The hold of the pointer on a toast: the time stops while it is there. */
  let pointer: (() => void) | null = null;
  /** The hold of the keyboard's focus in the stack: the time stops while it is there. */
  let focused: (() => void) | null = null;

  function focusIn(event: FocusEvent): void {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && stack !== null && !stack.contains(from)) cameFrom = from;
    focused ??= toasts.hold();
  }

  function focusOut(event: FocusEvent): void {
    const to = event.relatedTarget;
    if (to instanceof Node && stack?.contains(to)) return;
    unfocus();
  }

  function unfocus(): void {
    focused?.();
    focused = null;
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

  function enter(): void {
    pointer ??= toasts.hold();
  }

  function leave(): void {
    pointer?.();
    pointer = null;
  }

  // The last toast under the pointer went: its hold goes with it. A toast that held the focus
  // and went (its link pressed) lets the time of the others run again.
  $effect(() => {
    if (toasts.items.length === 0) leave();
    void toasts.items.length;
    void tick().then(() => {
      if (focused !== null && !(stack?.contains(document.activeElement) ?? false)) unfocus();
    });
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
      leave();
      unfocus();
    };
  });
</script>

<div
  class="stack"
  role="status"
  aria-live="polite"
  data-testid="toasts"
  data-press-only
  use:cssVars={{ 'toast-lift': px(toasts.lift) }}
  bind:this={stack}
  onfocusin={focusIn}
  onfocusout={focusOut}
>
  {#each toasts.items as toast (toast.id)}
    {@const look = TOAST_KINDS[toast.kind]}
    <div
      class="toast {toast.kind}"
      class:draws={look.draws}
      role="group"
      data-testid="toast"
      data-kind={toast.kind}
      onpointerenter={enter}
      onpointerleave={leave}
      animate:flip
      in:toastIn
      out:toastOut
    >
      <div class="plate">
        {#if look.icon !== null}<span class="icon"><Icon name={look.icon} size="sm" /></span>{/if}
        {#key toast.text}<span
            class="text"
            data-copy={toast.kind === 'warning' ? '' : undefined}
            data-testid="toast-text"
            in:fade>{toast.text}</span
          >{/key}
        {#if toast.action}
          <span class="action">
            <Button
              variant="link"
              label={toast.action.label}
              testid="toast-action"
              onclick={() => act(() => toasts.act(toast.id))}
            />
          </span>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  /* Below the scrim of a dialog (--z-toast < --z-overlay): dimmed with the page. Above a bar
     at the window's bottom edge it glides up and back. */
  .stack {
    position: fixed;
    right: var(--toast-inset);
    bottom: var(--toast-inset);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-8);
    pointer-events: none;
    transform: translateY(calc(-1 * var(--toast-lift)));
    transition: transform var(--dur-slow) var(--ease-out);
  }

  /* As wide as its words, between the two widths (and never wider than the window). */
  .toast {
    display: flex;
    width: max-content;
    min-width: min(var(--toast-min), calc(100vw - 2 * var(--toast-inset)));
    max-width: min(var(--toast-max), calc(100vw - 2 * var(--toast-inset)));
    min-height: calc(var(--control-field) + 2 * (var(--toast-pad-y) + var(--border-width)));
    padding: var(--toast-pad-y);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-card);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-pop);
    color: var(--text);
    font: var(--type-control);
    pointer-events: auto;
  }

  /* The sign, the words and the link on a plate of their own, inside the corners (Menu.svelte
     says why), as far in at the end as at the start. */
  .plate {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-10);
    min-width: 0;
    padding-inline: calc(var(--toast-pad-x) - var(--toast-pad-y));
    background-color: var(--surface-raised);
  }

  .icon,
  .action {
    display: inline-flex;
    flex: none;
  }

  /* Each kind in its status colour (the glyph comes from TOAST_KINDS). */
  .success .icon {
    color: var(--success);
  }

  .info .icon {
    color: var(--info);
  }

  .warning .icon {
    color: var(--warning);
  }

  /* The check draws itself once when the toast appears. */
  .draws .icon :global(path) {
    stroke-dasharray: var(--draw-length);
    animation: draw var(--dur-slow) var(--ease-out) var(--dur-instant) both;
  }

  /* One or two lines, at least as high as its button; a longer sentence ends in an
     ellipsis. */
  .text {
    display: -webkit-box;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-wrap: pretty;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
