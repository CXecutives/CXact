<!--
  Connect a Gmail mailbox: address and app password, Enter saves, Esc cancels. Errors land
  at the field they belong to (empty fields are said before anything is sent); when Gmail
  refuses the pair, both fields are marked, the password shakes once and the one sentence
  stands above the button. The password never leaves this form except to save_mailbox (it
  goes straight into the OS keychain). Under both fields the two Google pages in the order
  she needs them: the 2-step verification, then the app password. The first run shows the
  form in its step with its one button "Verbinden"; Einstellungen shows it in a dialog
  (`dialog`), whose buttons are the dialog's: it calls `save` and `cancel`. A saved mailbox
  needs no note: its badge "Verbunden" (Einstellungen) or its ticked step (first run) is the
  answer. While Verbinden signs in and counts (it can take a while), cancel and Esc stay
  live: they stop the check (`cancel_run`, the backend holds the app for it); the stop itself
  says nothing.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { formKeys } from '$lib/input/input';
  import { invoke, IpcError } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { onMount } from 'svelte';

  interface Props {
    /**
     * The caret starts in the first empty field once the form appears: the address, or the
     * app password next to an address that is there. On the first run only while the focus
     * has nowhere else to be; in a dialog always.
     */
    autofocus?: boolean;
    /** In a dialog: no buttons of its own, the dialog's call `save` and `cancel`. */
    dialog?: boolean;
    /** A check is on its way (the dialog's button turns meanwhile). */
    busy?: boolean;
  }
  let { autofocus = false, dialog = false, busy = $bindable(false) }: Props = $props();

  const id = $props.id();
  let user = $state(app.state?.mailbox.user ?? '');
  let password = $state('');
  /** An error is said when it shows, so it follows a switch of the language. */
  type Words = () => string;
  let userError = $state<Words | null>(null);
  let passwordError = $state<Words | null>(null);
  /** Gmail refused the pair: both fields are marked, the sentence stands once above. */
  let refused = $state(false);
  let formError = $state<Words | null>(null);
  let passwordField = $state<TextField | null>(null);

  const focus = (field: 'user' | 'password', preventScroll = false): void =>
    document.getElementById(`${id}-${field}`)?.focus({ preventScroll });

  // Once the form is laid out (a field focused before that is scrolled to by WebKit anyway).
  // The first run keeps the page where it is (the reset's report stays in view at a small
  // window); a dialog has just taken the focus for its own and gives it to the field.
  onMount(() => {
    if (!autofocus) return;
    const frame = requestAnimationFrame(() => {
      if (dialog || document.activeElement === document.body) {
        focus(user.trim() === '' ? 'user' : 'password', true);
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  /** Signs in and saves; `true` once the mailbox is saved. */
  export async function save(): Promise<boolean> {
    if (busy) return false;
    userError = passwordError = formError = null;
    refused = false;
    // Empty fields are said at once, both of them, without asking Gmail.
    if (user.trim() === '') userError = () => t.settings.addressMissing;
    if (password.trim() === '') passwordError = () => t.settings.passwordMissing;
    if (userError !== null || passwordError !== null) {
      focus(userError !== null ? 'user' : 'password');
      return false;
    }
    busy = true;
    try {
      await invoke('save_mailbox', { user: user.trim(), password });
      password = '';
      await app.load();
      return true;
    } catch (error) {
      const kind = error instanceof IpcError ? error.kind : null;
      const reason = error instanceof IpcError ? error.params.reason : null;
      const words = (): string => errorText(error);
      if (kind === 'mailCancelled') {
        // Stopped on purpose (cancel, Esc, the window closing): nothing to say.
      } else if (kind === 'mailAuth') {
        // Gmail refuses address or password: both are marked, the password shakes once.
        refused = true;
        formError = words;
        passwordField?.shake();
      } else if (reason === 'mailAddress' || kind === 'mailNotGmail') {
        userError = words;
      } else if (reason === 'appPassword') {
        passwordError = words;
      } else {
        formError = words;
      }
      return false;
    } finally {
      busy = false;
    }
  }

  /** Cancel and Esc of the dialog: a check in progress is stopped (the answer to
   *  save_mailbox is then `mailCancelled`, said by nobody). */
  export function cancel(): void {
    if (busy) {
      invoke('cancel_run').catch((error: unknown) => (formError = () => errorText(error)));
    }
  }

  function openPage(kind: 'appPasswordPage' | 'twoStepPage'): void {
    invoke('open_target', { target: { kind } }).catch(
      (error: unknown) => (formError = () => errorText(error)),
    );
  }
</script>

{#snippet body()}
  <div class="fields">
    <Field label={t.settings.address} for="{id}-user" error={userError?.() ?? null}>
      <TextField
        id="{id}-user"
        bind:value={user}
        invalid={userError !== null || refused}
        describedby="{id}-user-message"
        testid="mailbox-user"
      />
    </Field>
    <Field label={t.settings.password} for="{id}-password" error={passwordError?.() ?? null}>
      <TextField
        bind:this={passwordField}
        id="{id}-password"
        kind="password"
        bind:value={password}
        invalid={passwordError !== null || refused}
        describedby="{id}-password-message"
        testid="mailbox-password"
      />
    </Field>
  </div>
  <!-- The two pages in the order she needs them. -->
  <div class="links">
    <Button
      variant="link"
      size="sm"
      icon="external"
      external
      label={t.settings.twoStepAction}
      testid="two-step"
      onclick={() => openPage('twoStepPage')}
    />
    <Button
      variant="link"
      size="sm"
      icon="external"
      external
      label={t.settings.createPassword}
      testid="create-password"
      onclick={() => openPage('appPasswordPage')}
    />
  </div>
  {#if formError}
    <Notice tone="danger" variant="inline" text={formError()} testid="mailbox-error" />
  {/if}
{/snippet}

{#if dialog}
  <!-- The dialog's own keys answer Enter and Esc. -->
  <div class="form" data-testid="mailbox-form">{@render body()}</div>
{:else}
  <div class="form" data-testid="mailbox-form" use:formKeys={{ save: () => void save() }}>
    {@render body()}
    <div class="actions">
      <Button
        variant="primary"
        size="field"
        icon="signIn"
        label={t.settings.connect}
        loading={busy}
        testid="mailbox-save"
        onclick={() => void save()}
      />
    </div>
  </div>
{/if}

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
    container-type: inline-size;
  }

  /* A form's measure for the fields and their pages. */
  .fields,
  .links {
    max-width: var(--form-width);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-16);
    margin-top: calc(-1 * var(--space-8));
  }

  /* Address and password side by side where there is room (the first run stays short). */
  .fields {
    display: grid;
    grid-template-columns: 1fr;
    align-items: start;
    gap: var(--space-16);
  }

  @container (width >= 520px) {
    .fields {
      grid-template-columns: 1fr 1fr;
    }
  }

  .actions {
    display: flex;
    align-items: center;
  }
</style>
