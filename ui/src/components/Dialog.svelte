<!--
  Modal question with at most two actions: confirm | danger, plus an optional third one
  (`altLabel`, a secondary button, as "Verwerfen" in "Änderungen speichern?"). The round 10
  draft: white, no edge, 14 round, 22 inside, the dialog's deep shadow, at most 400 wide (16
  from the window's sides in a narrow one); its heading 16/650 ink, the sentence 14 muted 6
  under it, the buttons 8 apart 22 under the text, each pair at least --button-pair-min wide
  so a short "Löschen" does not look thin beside "Abbrechen". A warm plain scrim (no blur: a
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
  The buttons follow the OS: the action first on Windows (then the third action, then
  cancel), last (right) on macOS with the third action on the far left. The scrim starts
  below the window's top bar, which keeps moving the window and its buttons keep working (a
  sheet leaves the title bar free).
  A dialog may hold content of its own (`children`: the list of the backups, the mailbox
  form). The sentence under the heading is left out where the heading says it all. An action
  that can be stopped while it runs (the check of "Verbinden") keeps cancel and Esc live
  (`stoppable`). A dialog that only shows something (an alert mail read in the app) has one
  button, its confirm (`single`), and Esc closes it.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { primaryFirst } from '$lib/platform';
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
    /** Cancel and Esc stay live while busy (they stop the action; `oncancel` does). */
    stoppable?: boolean;
    /** Why the action failed (shown inside the dialog, which stays open). */
    error?: string | null;
    testid?: string | null;
    /** A third action next to confirm and cancel (secondary). */
    altLabel?: string | null;
    /** Only the confirm button: the dialog shows something, it asks nothing. */
    single?: boolean;
    onalt?: () => void;
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
    stoppable = false,
    error = null,
    testid = null,
    altLabel = null,
    single = false,
    onalt,
    onconfirm,
    oncancel,
  }: Props = $props();

  const id = $props.id();
  let pressedOnScrim = false;

  function cancel(): void {
    if (busy && !stoppable) return;
    open = false;
    oncancel?.();
  }

  function confirm(): void {
    if (!busy) onconfirm();
  }

  const actionFirst = primaryFirst();

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

  // On close the focus goes back where it was, unless the action moved it on purpose (a
  // failed save puts the caret into the field it names).
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
        <h2 class="heading" id="{id}-heading">{heading}</h2>
        {#if text}<p class="text" id="{id}-text">{text}</p>{/if}
        {#if children}<div class="content">{@render children()}</div>{/if}
        {#if error}
          <div class="error">
            <Notice tone="danger" variant="inline" text={error} testid="dialog-error" />
          </div>
        {/if}
        <div class="actions">
          {#snippet dismiss()}
            <Button
              variant="secondary"
              label={cancelLabel ?? t.common.cancel}
              disabled={busy && !stoppable}
              isDefault={variant === 'danger'}
              testid="dialog-cancel"
              onclick={cancel}
            />
          {/snippet}
          {#snippet alt()}
            {#if altLabel}
              <span class:apart={!actionFirst}>
                <Button
                  variant="secondary"
                  label={altLabel}
                  disabled={busy}
                  testid="dialog-alt"
                  onclick={() => onalt?.()}
                />
              </span>
            {/if}
          {/snippet}
          {#if !actionFirst && !single}{@render alt()}{@render dismiss()}{/if}
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            label={confirmLabel}
            loading={busy}
            isDefault={variant !== 'danger'}
            testid="dialog-confirm"
            onclick={confirm}
          />
          {#if actionFirst && !single}{@render alt()}{@render dismiss()}{/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* The window below its top bar (the bar keeps moving the window). */
  .layer {
    position: fixed;
    z-index: var(--z-overlay);
    inset: var(--titlebar-height) 0 0;
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

  .dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    width: var(--dialog-width);
    max-width: 100%;
    max-height: 100%;
    overflow-y: auto;
    padding: var(--dialog-pad);
    border-radius: var(--radius-card);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-dialog);
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

  /* The buttons of a pair share one least width. */
  .actions {
    --btn-min: var(--button-pair-min);

    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-8);
    margin-top: var(--dialog-actions-gap);
  }

  /* On macOS the third action stands apart on the left. */
  .apart {
    margin-right: auto;
  }
</style>
