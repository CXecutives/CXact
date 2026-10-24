<!--
  Connect a mailbox (the round 10 draft): its provider (Gmail, iCloud, GMX, WEB.DE; a Select
  that fills its cell) beside the address (its example `name@` the provider's domain), under
  them the password. Gmail and iCloud take an app password: the label says so, an info
  symbol says what it is in the provider's words, the field shows "16 Buchstaben", and
  "App-Passwort erstellen" at the label's right opens the provider's page; GMX and WEB.DE
  take the password, with "IMAP-Abruf erlauben" as the way to their help, and a refused
  sign-in there says to allow it. The pair stands side by side once the form is 400 wide
  (Einstellungen, the setup's card), one under the other below. Errors land at the field
  they belong to, in the same words for every provider (empty fields are said before
  anything is sent); when the provider refuses the pair, both fields are marked, the
  password comes into view and the one sentence stands under the fields. The password never
  leaves this form except to save_mailbox (it goes straight into the OS keychain).
  Einstellungen unfolds it under the mailbox's row and the setup shows it in its card: their
  buttons ("Verbinden") call `save` and `cancel`, and their keys answer Enter and Esc. A
  saved mailbox needs no note: its state "Verbunden" or the setup's next step is the answer.
  While Verbinden signs in and counts (it can take a while), cancel and Esc stay live: they
  stop the check (`cancel_run`, the backend holds the app for it); the stop itself says
  nothing.
-->
<script lang="ts">
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import Select from '$components/Select.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, IpcError } from '$lib/ipc/api';
  import type { MailProvider } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { onMount } from 'svelte';

  interface Props {
    /** The caret starts in the first empty field once the form appears: the address, or the
     *  password next to an address that is there (Ändern in Einstellungen). */
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
  const passwordInfo = $derived(
    provider === 'gmail' || provider === 'icloud' ? t.settings.passwordInfo[provider] : null,
  );
  let user = $state(app.state?.mailbox.user ?? '');
  let password = $state('');
  /** An error is said when it shows. */
  type Words = () => string;
  let userError = $state<Words | null>(null);
  let passwordError = $state<Words | null>(null);
  /** The provider refused the pair: both fields are marked, the sentence stands once below. */
  let refused = $state(false);
  let formError = $state<Words | null>(null);
  let passwordField = $state<TextField | null>(null);

  const focus = (field: 'user' | 'password', preventScroll = false): void =>
    document.getElementById(`${id}-${field}`)?.focus({ preventScroll });

  // Once the form is laid out (a field focused before that is scrolled to by WebKit anyway).
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
    // Empty fields are said at once, both of them, without asking the provider.
    if (user.trim() === '') userError = () => t.settings.addressMissing;
    if (password.trim() === '') passwordError = () => t.settings.passwordMissing(appPassword);
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
        // The provider refuses address or password: both are marked, the password comes
        // into view.
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

  /** Cancel and Esc around the form: a check in progress is stopped (the answer to
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

<!-- The keys of Einstellungen or the setup around it answer Enter and Esc. -->
<div class="form" data-testid="mailbox-form">
  <div class="pair">
    <Field label={t.settings.providerLabel} for="{id}-provider">
      <Select
        id="{id}-provider"
        options={PROVIDERS}
        value={provider}
        label={t.settings.providerLabel}
        wide
        testid="mailbox-provider"
        onchange={(next) => (provider = next)}
      />
    </Field>
    <Field label={t.settings.address} for="{id}-user" error={userError?.() ?? null}>
      <TextField
        id="{id}-user"
        bind:value={user}
        placeholder={t.settings.addressExample(provider)}
        invalid={userError !== null || refused}
        describedby="{id}-user-message"
        testid="mailbox-user"
      />
    </Field>
  </div>
  <!-- The provider's page of the app passwords, or its help on allowing IMAP. -->
  <Field
    label={appPassword ? t.settings.password : t.settings.plainPassword}
    for="{id}-password"
    info={passwordInfo}
    links={[
      {
        label: appPassword ? t.settings.createPassword : t.settings.allowImap,
        icon: 'external',
        testid: 'create-password',
        onclick: openPage,
      },
    ]}
    error={passwordError?.() ?? null}
  >
    <TextField
      bind:this={passwordField}
      id="{id}-password"
      kind="password"
      bind:value={password}
      placeholder={appPassword ? t.settings.passwordExample : null}
      invalid={passwordError !== null || refused}
      describedby="{id}-password-message"
      testid="mailbox-password"
    />
  </Field>
  {#if formError}
    <Notice tone="danger" variant="inline" text={formError()} testid="mailbox-error" />
  {/if}
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--mail-form-gap);
    container-type: inline-size;
  }

  .pair {
    display: grid;
    gap: var(--mail-form-gap) var(--space-20);
  }

  /* Side by side once each half has room for the provider's list (Einstellungen, the setup's
     card); one under the other in a narrow window. */
  @container (width >= 400px) {
    .pair {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
