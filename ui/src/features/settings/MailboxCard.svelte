<!--
  The Postfach card of Einstellungen: the connected address with its badge, "Ändern"
  (secondary: it changes the row's own value) and "Entfernen" (quiet, asks first), then "Alle
  Alert-Mails abrufen"; without a mailbox, or while changing it, the form. The badge is the
  answer to a saved mailbox ("Verbunden", no note). It says "Nicht erreichbar" or "Abgelehnt"
  only for a mail error of a fetch that finished after Gmail last accepted the mailbox
  (`mailbox.checkedAt`), with a sentence under the row where it adds the next step. A run, the
  dry run and the demo lock the mailbox with their reason. A dialog whose action fails stays
  open and says why inside; its button tries again.
-->
<script lang="ts">
  import Badge from '$components/Badge.svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { AppState } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { run } from '$lib/state/run.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { tick } from 'svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';

  interface Props {
    cfg: AppState;
    /** Why the mailbox cannot change now (the demo, the dry run, a run), or null. */
    locked: string | null;
  }
  let { cfg, locked }: Props = $props();

  /** Fetch failures that are about the mailbox itself (not a cancel, not a missing one). */
  const MAIL_FAILURES: readonly string[] = [
    'mailConnect',
    'mailAuth',
    'mailTimeout',
    'mailLost',
    'mailNotGmail',
    'mailServer',
  ];

  let editing = $state(false);
  let confirmRemove = $state(false);
  let confirmFull = $state(false);
  let removing = $state(false);
  /** Said when it shows, so in the language of the moment. */
  let removeError = $state<(() => string) | null>(null);
  let fullError = $state<(() => string) | null>(null);

  /** The last fetch failed at the mailbox after Gmail last accepted it: a sign-in since then
   *  (`checkedAt`) makes the failure past. */
  const mailFailure = $derived.by(() => {
    const last = cfg.lastRun;
    const outcome = last?.outcome;
    if (last === null || outcome?.kind !== 'failed') return null;
    if (!MAIL_FAILURES.includes(outcome.error.kind)) return null;
    const checked = cfg.mailbox.checkedAt;
    if (checked !== null && Date.parse(last.finishedAt) <= Date.parse(checked)) return null;
    return outcome.error;
  });
  /** The sentence under the row: what to do when Gmail refused the password, else the cause
   *  where it says more than the badge ("Gmail ist nicht erreichbar" is the badge itself). */
  const mailFailureText = $derived(
    mailFailure === null || mailFailure.kind === 'mailConnect'
      ? null
      : mailFailure.kind === 'mailAuth'
        ? t.settings.mailRefused
        : t.error.text(mailFailure.kind, mailFailure.params),
  );

  /** Ändern and Entfernen of the connected mailbox. */
  let buttons = $state<HTMLElement | null>(null);

  /** The change form closes: the focus it held goes back to "Ändern", as a dialog's goes back
   *  to its opener (only when it fell to the page, never taken from elsewhere). */
  async function closeForm(): Promise<void> {
    editing = false;
    await tick();
    if (document.activeElement === document.body) {
      buttons?.querySelector<HTMLElement>('button')?.focus();
    }
  }

  /** The dialog closes only once the mailbox is gone; a failure stays inside it. */
  async function remove(): Promise<void> {
    removing = true;
    removeError = null;
    try {
      await invoke('remove_mailbox');
      await app.load();
      confirmRemove = false;
    } catch (error) {
      removeError = () => errorText(error);
    } finally {
      removing = false;
    }
  }

  /** Every alert mail again, not only the new ones: a run, shown in the Jobs view. */
  async function readAll(): Promise<void> {
    fullError = null;
    if (await run.start({ kind: 'fullMailbox' })) {
      confirmFull = false;
      navigation.go('jobs');
    } else {
      fullError = () => run.startError ?? t.run.failed;
    }
  }
</script>

<Card padding={cfg.mailbox.user && !editing ? 'rows' : 'md'}>
  {#if cfg.mailbox.user && !editing}
    <SettingRow
      label={cfg.mailbox.user}
      copyLabel
      hint={t.settings.vault[cfg.mailbox.vault]}
      testid="mailbox"
    >
      {#snippet badges()}
        {#if mailFailure}
          <Badge
            label={mailFailure.kind === 'mailAuth' ? t.settings.refused : t.settings.unreachable}
            tone="danger"
            icon="triangle-alert"
          />
        {:else}
          <Badge label={t.settings.connected} tone="success" icon="check" />
        {/if}
      {/snippet}
      <div class="buttons" bind:this={buttons}>
        <Button
          variant="secondary"
          size="sm"
          icon="pencil"
          label={t.common.change}
          disabled={locked !== null}
          disabledReason={locked}
          testid="mailbox-change"
          onclick={() => (editing = true)}
        />
        <Button
          variant="ghost"
          size="sm"
          icon="circle-x"
          label={t.common.remove}
          disabled={locked !== null}
          disabledReason={locked}
          warns
          testid="mailbox-remove"
          onclick={() => {
            removeError = null;
            confirmRemove = true;
          }}
        />
      </div>
    </SettingRow>
    <SettingRow label={t.settings.fullMailbox} hint={t.settings.fullMailboxHint}>
      <Button
        variant="secondary"
        size="sm"
        icon="refresh-cw"
        label={t.settings.fullMailboxAction}
        disabled={run.fetchBlocked !== null}
        disabledReason={run.fetchBlocked}
        testid="full-mailbox"
        onclick={() => {
          fullError = null;
          confirmFull = true;
        }}
      />
    </SettingRow>
  {:else}
    {#if !cfg.mailbox.user}
      <p class="lead">{t.settings.notConnected}</p>
    {/if}
    <!-- "Ändern" gives way to the form, which takes the caret; closing it gives it back. The
         badge "Verbunden" answers a saved change. -->
    <MailboxForm
      saveLabel={cfg.mailbox.user ? t.common.save : t.settings.connect}
      autofocus={editing}
      compact
      oncancel={cfg.mailbox.user ? () => void closeForm() : null}
      onsaved={(saved) => {
        // Signed in, but the alert mails were not counted in time: the next fetch reads them.
        if (saved.check === null) toasts.show(t.settings.mailboxNotCounted, 'info');
        void closeForm();
      }}
    />
  {/if}
  {#if mailFailureText && !editing}
    <Notice tone="danger" variant="inline" text={mailFailureText} testid="mailbox-failure" />
  {/if}
  {#if cfg.mailbox.error}
    <Notice
      tone="danger"
      variant="inline"
      text={t.error.text(cfg.mailbox.error.kind, cfg.mailbox.error.params)}
    />
  {/if}
</Card>

<Dialog
  bind:open={confirmRemove}
  variant="danger"
  heading={t.settings.removeMailbox}
  text={t.settings.removeMailboxText}
  confirmLabel={t.common.remove}
  busy={removing}
  error={removeError?.() ?? null}
  testid="dialog-remove-mailbox"
  onconfirm={() => void remove()}
/>
<Dialog
  bind:open={confirmFull}
  heading={t.settings.fullMailboxHeading}
  text={t.settings.fullMailboxText}
  confirmLabel={t.settings.fullMailboxConfirm}
  error={fullError?.() ?? null}
  testid="dialog-full-mailbox"
  onconfirm={() => void readAll()}
/>

<style>
  .lead {
    margin-bottom: var(--space-16);
    color: var(--text-muted);
    font: var(--type-md);
  }

  /* The buttons of a row end on its trailing edge, 12 apart, one size (28). */
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-12);
  }
</style>
