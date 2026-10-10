<!--
  Connect a mailbox: its provider (Gmail, iCloud, GMX, WEB.DE; design round 7), address and
  password, Enter saves, Esc cancels. Gmail and iCloud take an app password (an info symbol
  says what it is, "App-Passwort erstellen" opens the provider's page); GMX and WEB.DE take
  the password, with "IMAP-Abruf erlauben" as the way to their help, and a refused sign-in
  there says to allow it. Errors land at the field they belong to (empty fields are said
  before anything is sent); when the provider refuses the pair, both fields are marked, the
  password comes into view and the one sentence stands under the fields. The password never
  leaves this form except to save_mailbox (it goes straight into the OS keychain). The fields
  stand one under the other across their box. Einstellungen shows it in a dialog and the
  setup in its group: their buttons ("Verbinden") call `save` and `cancel`. A saved mailbox
  needs no note: its state "Verbunden" (Einstellungen) or the setup's "Postfach verbunden" is
  the answer. While Verbinden signs in and counts (it can take a while), cancel and Esc stay
  live: they stop the check (`cancel_run`, the backend holds the app for it); the stop itself
  says nothing.
-->
<script lang="ts">
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, IpcError } from '$lib/ipc/api';
  import type { MailProvider } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { onMount } from 'svelte';

  interface Props {
    /** The caret starts in the first empty field once the form appears: the address, or the
     *  app password next to an address that is there (the dialog of Einstellungen). */
    autofocus?: boolean;
    /** A check is on its way (the button that called `save` turns meanwhile). */
    busy?: boolean;
  }
  let { autofocus = false, busy = $bindable(false) }: Props = $props();

  const id = $props.id();
  let provider = $state<MailProvider>(app.state?.mailbox.provider ?? 'gmail');
  const PROVIDERS = $derived(
    (Object.keys(t.settings.provider) as MailProvider[]).map((id) => ({
      id,
      label: t.settings.provider[id],
    })),
  );
  /** Gmail and iCloud sign in with an app password, GMX and WEB.DE with the password. */
  const appPassword = $derived(provider === 'gmail' || provider === 'icloud');
  let user = $state(app.state?.mailbox.user ?? '');
  let password = $state('');
  /** An error is said when it shows. */
  type Words = () => string;
  let userError = $state<Words | null>(null);
  let passwordError = $state<Words | null>(null);
  /** Gmail refused the pair: both fields are marked, the sentence stands once above. */
  let refused = $state(false);
  let formError = $state<Words | null>(null);
  let passwordField = $state<TextField | null>(null);

  const focus = (field: 'user' | 'password', preventScroll = false): void =>
    document.getElementById(`${id}-${field}`)?.focus({ preventScroll });

  // Once the form is laid out (a field focused before that is scrolled to by WebKit anyway):
  // the dialog has just taken the focus for its own and gives it to the field.
  onMount(() => {
    if (!autofocus) return;
    const frame = requestAnimationFrame(() =>
      focus(user.trim() === '' ? 'user' : 'password', true),
    );
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
      await invoke('save_mailbox', { provider, user: user.trim(), password });
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
        // Gmail refuses address or password: both are marked, the password comes into view.
        refused = true;
        formError = words;
        passwordField?.bringIntoView();
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

  /** The provider's page: its app passwords, or (GMX, WEB.DE) how to allow IMAP. */
  function openPage(): void {
    invoke('open_target', { target: { kind: 'passwordPage', provider } }).catch(
      (error: unknown) => (formError = () => errorText(error)),
    );
  }
</script>

{#snippet body()}
  <div class="fields">
    <Segmented
      options={PROVIDERS}
      value={provider}
      label={t.settings.providerLabel}
      testid="mailbox-provider"
      onchange={(next) => (provider = next)}
    />
    <Field label={t.settings.address} for="{id}-user" error={userError?.() ?? null}>
      <TextField
        id="{id}-user"
        bind:value={user}
        invalid={userError !== null || refused}
        describedby="{id}-user-message"
        testid="mailbox-user"
      />
    </Field>
    <!-- The provider's page of the app passwords, or its help on allowing IMAP. -->
    <Field
      label={appPassword ? t.settings.password : t.settings.plainPassword}
      for="{id}-password"
      info={appPassword ? t.settings.passwordInfo : null}
      action={{
        label: appPassword ? t.settings.createPassword : t.settings.allowImap,
        icon: 'external',
        testid: 'create-password',
        onclick: openPage,
      }}
      error={passwordError?.() ?? null}
    >
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
  {#if formError}
    <Notice tone="danger" variant="inline" text={formError()} testid="mailbox-error" />
  {/if}
{/snippet}

<!-- The keys of the dialog or the setup around it answer Enter and Esc. -->
<div class="form" data-testid="mailbox-form">{@render body()}</div>

<style>
  .form,
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }
</style>
