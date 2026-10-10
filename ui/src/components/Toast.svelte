<!--
  The toast stack, bottom right (mounted once in App), the only place that
  draws a toast: short confirmations that rise in (150 ms) and slide out sideways (100 ms),
  at most three, the stack moving up as one leaves. Each kind's glyph and each toast's time
  come from the tables of lib/state/toasts.svelte.ts (TOAST_KINDS, TOAST_LIFE): a plain
  toast stays 4 s, one with a button 10 s. Its time stops while it is hovered, and every
  toast waits while the window is in the back or a modal dialog is open. The stack lies
  below a dialog's scrim: dimmed, and its undo cannot act behind the dialog.
  Every toast is one width (--toast-width); its sentence wraps to at most two lines and ends
  in an ellipsis beyond them.
  The check of a success draws itself once as the toast appears. Closable; an undo of what
  the user just did sits before the close button; a toast about something that happened in
  another view (a fetch that finished) may carry the way to it instead ("Zeigen"). A merged
  toast (two rows archived one after the other) cross-fades its sentence (100 ms) and starts
  its time again.
  A press on a toast never takes the focus (like a notification of the OS); a toast the
  keyboard reached gives the focus back to where it came from when it goes by its buttons.
  The stack rises above a bar that sticks to the window's bottom edge (the Profil's FloatBar,
  the setup's foot on its long steps: `toasts.lift`, lib/actions/liftToasts.ts).
-->
<script lang="ts">
  import { cssVars, px } from '$lib/actions/cssVars';
  import { t } from '$lib/i18n/t';
  import { onWindowFocus } from '$lib/ipc/api';
  import { fade, flip, toastIn, toastOut } from '$lib/motion/transitions';
  import { TOAST_KINDS, toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

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

<div
  class="stack"
  role="status"
  aria-live="polite"
  data-testid="toasts"
  data-press-only
  use:cssVars={{ 'toast-lift': px(toasts.lift) }}
  bind:this={stack}
  onfocusin={focusIn}
>
  {#each toasts.items as toast (toast.id)}
    {@const look = TOAST_KINDS[toast.kind]}
    <div
      class="toast {toast.kind}"
      class:draws={look.draws}
      role="group"
      data-testid="toast"
      data-kind={toast.kind}
      animate:flip
      in:toastIn
      out:toastOut
    >
      <span class="icon"><Icon name={look.icon} size="sm" /></span>
      {#key toast.text}<span class="text" data-testid="toast-text" in:fade>{toast.text}</span>{/key}
      {#if toast.action}
        {@const action = toast.action}
        <span class="action">
          <Button
            variant="ghost"
            label={action.label}
            testid="toast-action"
            onclick={() => act(() => toasts.act(toast.id))}
          />
        </span>
      {/if}
      <Button
        variant="ghost"
        icon="close"
        iconOnly
        label={t.common.hide}
        onclick={() => act(() => toasts.dismiss(toast.id))}
      />
    </div>
  {/each}
</div>

<style>
  /* Below the scrim of a dialog (--z-toast < --z-overlay): dimmed with the page. Above a bar
     at the window's bottom edge it glides up and back. */
  .stack {
    position: fixed;
    right: var(--space-24);
    bottom: var(--space-24);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-8);
    pointer-events: none;
    transform: translateY(calc(-1 * var(--toast-lift)));
    transition: transform var(--dur-base) var(--ease-out);
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    /* Every toast is as wide as the others (user decision 2026-09-27). */
    width: min(var(--toast-width), calc(100vw - 2 * var(--space-24)));
    overflow: hidden;
    padding: var(--space-6) var(--space-6) var(--space-6) var(--space-16);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--surface-raised);
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

  /* One or two lines with room above and below (10 px to the edge with the padding); a
     longer sentence ends in an ellipsis. */
  .text {
    display: -webkit-box;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    margin-block: var(--space-4);
    text-wrap: pretty;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
</style>
