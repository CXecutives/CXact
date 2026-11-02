<!--
  Modal question with at most two actions: confirm | danger. The round 10
  draft: white, no edge, 14 round, 22 inside, the dialog's deep shadow, at most 400 wide (16
  from the window's sides in a narrow one); its heading 16/650 ink, the sentence 14 muted 6
  under it, the buttons 8 apart 22 under the text, in columns of one width (the widest
  label's, at least --button-pair-min) so a short "Löschen" does not look thin beside
  "Abbrechen". A warm plain scrim (no blur: a
  blurred backdrop over the whole window drops frames in the web view); the dialog rises in
  180 ms (ease-out, nothing scales) and leaves in 100 ms. It holds the focus like a native
  one (input.ts): Tab and Shift+Tab cycle through its buttons, Esc cancels wherever the focus
  is, Enter presses the focused button or, on the dialog itself, its default button (cancel
  for danger, confirm otherwise). The focus starts on that default button (no focus ring,
  user decision 2026-10-04). The heading stays ink also in a danger dialog (its red button
  says it). A click on its text
  keeps the focus inside; on close the focus goes back to where it was. A failure of the
  action shows inside the dialog (`error`), never behind the scrim. The toasts lie below the
  scrim and wait while it is open.
  Pressing inside and releasing on the scrim keeps it open; only the left button counts.
  The buttons follow the OS: the action first on Windows, last (right) on macOS. The scrim covers
  the whole window, the page-drawn title bar included (owner, 2026-10-28: it is part of the
  app). The window still moves by the bar and that cancels nothing: on Windows its caption
  window (platform.rs) answers over the page, on macOS the bar's drag region rises over the
  scrim (TitleBar), and the dialog stays clear of the bar's height.
  A dialog may hold content of its own (`children`: the list of the backups, the mailbox
  form). The sentence under the heading is left out where the heading says it all. A dialog that only shows something (an alert mail read in the app) has one
  button, its confirm (`single`), and Esc closes it.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { primaryFirst, scrimNeedsDragRegion } from '$lib/platform';
  import { dialogIn, dialogOut, scrim } from '$lib/motion/transitions';
  import { toasts } from '$lib/state/toasts.svelte';
  import { untrack, type Snippet } from 'svelte';
  import type { Action } from 'svelte/action';
  import Button from './Button.svelte';
  import Notice from './Notice.svelte';

  interface Props {
    open: boolean;
    variant?: 'confirm' | 'danger';
    heading: string;
    /** One or two sentences under the heading (null: the content says it). */
    text?: string | null;
    /** Content of its own under the text (the backups, the mailbox form). */
    children?: Snippet;
    /** The verb of the button that opened it ("Entfernen" opens "Postfach entfernen?", its
     *  button says Entfernen; "Zurücksetzen" opens "Alles zurücksetzen?"), in every dialog. */
    confirmLabel: string;
    cancelLabel?: string;
    busy?: boolean;
    /** Why the action failed (shown inside the dialog, which stays open). */
    error?: string | null;
    testid?: string | null;
    /** Only the confirm button: the dialog shows something, it asks nothing. */
    single?: boolean;
    onconfirm: () => void;
    oncancel?: () => void;
  }

  let {
    open = $bindable(),
    variant = 'confirm',
    heading,
    text = null,
    children,
    confirmLabel,
    cancelLabel,
    busy = false,
    error = null,
    testid = null,
    single = false,
    onconfirm,
    oncancel,
  }: Props = $props();

  const id = $props.id();
  let pressedOnScrim = false;

  function cancel(): void {
    if (busy) return;
    open = false;
    oncancel?.();
  }

  function confirm(): void {
    if (!busy) onconfirm();
  }

  const actionFirst = primaryFirst();
  const clearsBar = scrimNeedsDragRegion();

  /** Where the focus was before the dialog opened; it goes back there on close. */
  let opener: HTMLElement | null = null;

  /** Danger dialogs start on "cancel", confirm dialogs on the confirm button. */
  const focusFirst: Action<HTMLElement, 'confirm' | 'danger'> = (node, kind) => {
    const before = document.activeElement;
    opener = before instanceof HTMLElement && before !== document.body ? before : null;
    const role = kind === 'danger' ? 'dialog-cancel' : 'dialog-confirm';
    const target = node.querySelector<HTMLButtonElement>(`[data-testid="${role}"]`);
    queueMicrotask(() => target?.focus());
  };

  // While the dialog is open the toasts behind its scrim wait (an undo keeps its time).
  $effect(() => (open ? untrack(() => toasts.hold()) : undefined));

  // On close the focus goes back where it was, unless the action moved it on purpose.
  $effect(() => {
    if (open || opener === null) return;
    const back = opener;
    opener = null;
    const now = document.activeElement;
    const moved =
      now instanceof HTMLElement &&
      now !== document.body &&
      now.closest('[role="alertdialog"]') === null;
    if (back.isConnected && !moved) back.focus();
  });
</script>

{#if open}
  <div class="layer" in:scrim out:scrim>
    <div
      class="scrim"
      class:clears-bar={clearsBar}
      onpointerdown={(event) =>
        (pressedOnScrim = event.button === 0 && event.target === event.currentTarget)}
      onclick={(event) => {
        if (pressedOnScrim && event.target === event.currentTarget) cancel();
        pressedOnScrim = false;
      }}
      role="presentation"
      data-testid="dialog-scrim"
    >
      <div
        class="dialog {variant}"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="{id}-heading"
        aria-describedby={text ? `${id}-text` : undefined}
        tabindex="-1"
        data-testid={testid ?? undefined}
        in:dialogIn
        out:dialogOut
        use:formKeys={{ cancel, save: variant === 'danger' ? cancel : confirm }}
        use:focusFirst={variant}
      >
        <div class="plate">
          <h2 class="heading" id="{id}-heading">{heading}</h2>
          {#if text}<p class="text" id="{id}-text">{text}</p>{/if}
          {#if children}<div class="content">{@render children()}</div>{/if}
          {#if error}
            <div class="error">
              <Notice tone="danger" text={error} testid="dialog-error" />
            </div>
          {/if}
          <div class="actions">
            {#snippet dismiss()}
              <Button
                variant="secondary"
                label={cancelLabel ?? t.common.cancel}
                disabled={busy}
                isDefault={variant === 'danger'}
                testid="dialog-cancel"
                onclick={cancel}
              />
            {/snippet}
            {#snippet act()}
              <Button
                variant={variant === 'danger' ? 'danger' : 'primary'}
                label={confirmLabel}
                loading={busy}
                isDefault={variant !== 'danger'}
                testid="dialog-confirm"
                onclick={confirm}
              />
            {/snippet}
            <div class="pair">
              {#if actionFirst}
                {@render act()}
                {#if !single}{@render dismiss()}{/if}
              {:else}
                {#if !single}{@render dismiss()}{/if}
                {@render act()}
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* The whole window, its top bar included. */
  .layer {
    position: fixed;
    z-index: var(--z-overlay);
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .scrim {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: var(--space-16);
    background-color: var(--scrim);
  }

  /* macOS: a tall dialog ends below the bar's height, where the bar's drag region and the
     traffic lights lie over it; as much below it, so every dialog stays centred. */
  .clears-bar {
    padding-block: var(--titlebar-height);
  }

  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    width: var(--dialog-width);
    max-width: 100%;
    max-height: 100%;
    padding: var(--space-8);
    border-radius: var(--radius-card);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-dialog);
  }

  /* The words on a plate of their own, inside the corners (Menu.svelte says why), 22 from the
     dialog's edge with the room around it. */
  .plate {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    padding: calc(var(--dialog-pad) - var(--space-8));
    background-color: var(--surface-raised);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  .text {
    margin-top: var(--dialog-text-gap);
    color: var(--text-muted);
    font: var(--type-md);
    text-wrap: pretty;
  }

  .content {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-16);
  }

  .error {
    margin-top: var(--space-12);
  }

  .actions {
    --btn-min: var(--button-pair-min);

    display: flex;
    justify-content: flex-end;
    margin-top: var(--dialog-actions-gap);
  }

  /* The buttons in columns of one width, each as wide as the widest. */
  .pair {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: var(--space-8);
  }
</style>
