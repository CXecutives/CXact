<!--
  Connect a mailbox: rows like the Profil's (Field `row`), the label beside its control and,
  in a box under 560 wide, above it: its provider (Gmail, iCloud, GMX, WEB.DE; a Select of the
  short controls' width), the address (its example `name@` the provider's domain) and the
  password. In a box of rows (`boxed`, Einstellungen) each row has the Profil's measure and its
  hairline. Gmail and iCloud take an app password: the label says so, an info
  symbol says what it is in the provider's words, the field shows "16 Buchstaben", and
  "App-Passwort erstellen" under the field opens the provider's page; GMX and WEB.DE
  take the password, with "IMAP-Abruf erlauben" as the way to their help, and a refused
  sign-in there says to allow it. Errors land at the field
  they belong to, in the same words for every provider (empty fields are said before
  anything is sent); when the provider refuses the pair, both fields are marked, the
  password comes into view and the one sentence stands under it, where a failure that belongs
  to neither field stands too. The password never leaves this form except to save_mailbox (it
  goes straight into the OS keychain).
  Einstellungen unfolds it under the mailbox's row and the setup shows it in its card: their
  buttons ("Verbinden") call `save` and `cancel`, and their keys answer Enter and Esc. A
  saved mailbox needs no note: its state "Verbunden" or the setup's next step is the answer.
  While Verbinden signs in and counts (it can take a while), cancel and Esc stay live: they
  stop the check (`cancel_run`, the backend holds the app for it), and so does leaving the
  form; the stop itself says nothing.
-->
<script lang="ts" module>
  import type { MailProvider } from '$lib/ipc/types';

  /** What was typed, kept while the form goes (the setup's Zurück); the password never is. */
  export interface MailboxDraft {
    provider: MailProvider | null;
    user: string | null;
  }
</script>

<script lang="ts">
  import Field from '$components/Field.svelte';
  import Select from '$components/Select.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, IpcError } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { onDestroy, untrack } from 'svelte';

  interface Props {
    /** A check is on its way (the button that called `save` turns meanwhile). */
    busy?: boolean;
    /** The form's rows stand in a box of rows (Einstellungen). */
    boxed?: boolean;
    /** Provider and address outlive the form here. */
    kept?: MailboxDraft | null;
  }
  let { busy = $bindable(false), boxed = false, kept = null }: Props = $props();

  const id = $props.id();
  let provider = $state<MailProvider>(
    untrack(() => kept?.provider) ?? app.state?.mailbox.provider ?? 'gmail',
  );
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
  let user = $state(untrack(() => kept?.user) ?? app.state?.mailbox.user ?? '');
  let password = $state('');
  $effect(() => {
    if (kept === null) return;
    kept.provider = provider;
    kept.user = user;
  });
  /** An error is said when it shows. */
  type Words = () => string;
  let userError = $state<Words | null>(null);
  let passwordError = $state<Words | null>(null);
  /** The provider refused the pair: both fields are marked, the sentence stands once. */
  let refused = $state(false);
  let formError = $state<Words | null>(null);
  let passwordField = $state<TextField | null>(null);
  /** The stop of the check under way is asked for: once is enough. */
  let stopping = false;

  /** An error goes with what it spoke of: typing in its field takes its sentence and the
   *  provider's refusal of the pair away (the pair is another one now); another provider
   *  takes them all, none of them was said of it. */
  function changed(field: 'user' | 'password' | 'provider'): void {
    if (field === 'user' || field === 'provider') userError = null;
    if (field === 'password' || field === 'provider') passwordError = null;
    refused = false;
    formError = null;
  }

  /** Signs in and saves; `true` once the mailbox is saved. */
  export async function save(): Promise<boolean> {
    if (busy) return false;
    userError = passwordError = formError = null;
    refused = false;
    // Empty fields are said at once, both of them, without asking the provider.
    if (user.trim() === '') userError = () => t.settings.addressMissing;
    if (password.trim() === '') passwordError = () => t.settings.passwordMissing(appPassword);
    if (userError !== null || passwordError !== null) return false;
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
      stopping = false;
    }
  }

  /** Cancel and Esc around the form, and its going: a check in progress is stopped (the answer
   *  to save_mailbox is then `mailCancelled`, said by nobody). */
  export function cancel(): void {
    if (!busy || stopping) return;
    stopping = true;
    invoke('cancel_run').catch((error: unknown) => {
      stopping = false;
      formError = () => errorText(error);
    });
  }
  onDestroy(cancel);

  /** The provider's page: its app passwords, or (GMX, WEB.DE) how to allow IMAP. */
  function openPage(): void {
    invoke('open_target', { target: { kind: 'passwordPage', provider } }).catch(
      (error: unknown) => (formError = () => errorText(error)),
    );
  }
</script>

<!-- The keys of Einstellungen or the setup around it answer Enter and Esc. -->
<div class="form" class:boxed data-testid="mailbox-form">
  <div class="cell">
    <Field row label={t.settings.providerLabel} for="{id}-provider">
      <span class="short">
        <Select
          id="{id}-provider"
          options={PROVIDERS}
          value={provider}
          label={t.settings.providerLabel}
          wide
          testid="mailbox-provider"
          onchange={(next) => {
            provider = next;
            changed('provider');
          }}
        />
      </span>
    </Field>
  </div>
  <div class="cell">
    <Field row label={t.settings.address} for="{id}-user" error={userError?.() ?? null}>
      <TextField
        id="{id}-user"
        bind:value={user}
        placeholder={t.settings.addressExample(provider)}
        invalid={userError !== null || refused}
        testid="mailbox-user"
        oninput={() => changed('user')}
      />
    </Field>
  </div>
  <!-- The provider's page of the app passwords, or its help on allowing IMAP. -->
  <div class="cell">
    <Field
      row
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
      error={passwordError?.() ?? formError?.() ?? null}
    >
      <TextField
        bind:this={passwordField}
        id="{id}-password"
        kind="password"
        bind:value={password}
        placeholder={appPassword ? t.settings.passwordExample : null}
        invalid={passwordError !== null || refused}
        testid="mailbox-password"
        oninput={() => changed('password')}
      />
    </Field>
  </div>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--mail-form-gap);
    container-type: inline-size;
  }

  .short {
    display: flex;
    width: var(--profile-control-width);
  }

  /* In a box of rows: the Profil's measure, a hairline from the text above each. */
  .boxed {
    gap: 0;
  }

  .boxed .cell {
    position: relative;
    min-height: var(--form-row-min);
    padding: var(--form-row-control-y) var(--form-row-pad-x);
  }

  .boxed .cell::before {
    position: absolute;
    top: 0;
    right: 0;
    left: var(--setting-rule-start);
    height: var(--border-width);
    background-color: var(--border);
    content: '';
  }
</style>
