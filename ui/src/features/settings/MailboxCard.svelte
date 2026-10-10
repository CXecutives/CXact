<!--
  The mailbox's row in Einstellungen > Postfach: the mail on a neutral tile, the connected
  address with its state under it, "Ändern" and "Entfernen" (the same kind of button;
  Entfernen is red at rest and asks first), without a mailbox the row "Nicht verbunden" with
  what that means and "Verbinden" (the portals of alert mails say they need one). Ändern
  and Verbinden open the form in a dialog named after the button ("Postfach ändern",
  "Postfach verbinden") whose button is "Verbinden".
  The state is the answer to a saved mailbox ("Verbunden" after a green dot, no note, no
  toast). After a red one it says "App-Passwort abgelehnt" or "Gmail nicht erreichbar" for a
  mail error of a fetch that finished after Gmail last accepted the mailbox
  (`mailbox.checkedAt`): a fetch that failed at the mailbox, or whose mail part failed while
  the search went on ("Postfach prüfen" of its toast leads here). A run and the dry run lock
  the mailbox with their reason. A dialog whose action fails stays open and says why inside;
  its button tries again.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import IconTile from '$components/IconTile.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { AppState } from '$lib/ipc/types';
  import { unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';

  interface Props {
    cfg: AppState;
    /** Why the mailbox cannot change now (the dry run, a run), or null. */
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

  let connecting = $state(false);
  /** Opens the form's dialog from its button, which holds the focus meanwhile (WebKit does
   *  not focus a clicked button), so the dialog gives the focus back to it when it closes. */
  function openForm(event: MouseEvent): void {
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
    connecting = true;
  }
  let checking = $state(false);
  let form = $state<MailboxForm | null>(null);
  let confirmRemove = $state(false);
  let removing = $state(false);
  /** Said when it shows. */
  let removeError = $state<(() => string) | null>(null);

  /** The last fetch failed at the mailbox, or its mail part did while the search went on,
   *  after Gmail last accepted it: a sign-in since then (`checkedAt`) makes the failure past. */
  const mailFailure = $derived.by(() => {
    const last = cfg.lastRun;
    if (last === null) return null;
    const error = last.outcome.kind === 'failed' ? last.outcome.error : last.mail;
    if (error === null || !MAIL_FAILURES.includes(error.kind)) return null;
    const checked = cfg.mailbox.checkedAt;
    if (checked !== null && Date.parse(last.finishedAt) <= Date.parse(checked)) return null;
    return error;
  });

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

  /** "Verbinden" in the dialog: it closes once the mailbox is saved. */
  async function connect(): Promise<void> {
    if (await form?.save()) connecting = false;
  }
</script>

{#snippet tile()}<IconTile icon="alertMail" size="sm" />{/snippet}

{#if cfg.mailbox.user}
  <SettingRow
    label={cfg.mailbox.user}
    copyLabel
    lead={tile}
    hint={mailFailure === null
      ? t.settings.connected
      : mailFailure.kind === 'mailAuth'
        ? t.settings.refused
        : t.settings.unreachable}
    dot={mailFailure === null ? 'success' : 'danger'}
    testid="mailbox"
  >
    <Button
      variant="secondary"
      icon="edit"
      label={t.common.change}
      disabled={locked !== null}
      disabledReason={locked}
      testid="mailbox-change"
      onclick={openForm}
    />
    <Button
      variant="secondary"
      icon="trash"
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
  </SettingRow>
{:else}
  <SettingRow
    label={t.settings.notConnected}
    hint={t.settings.notConnectedHint}
    lead={tile}
    testid="mailbox"
  >
    <Button
      variant="secondary"
      icon="signIn"
      label={t.settings.connect}
      disabled={locked !== null}
      disabledReason={locked}
      testid="mailbox-connect"
      onclick={openForm}
    />
  </SettingRow>
{/if}
{#if cfg.mailbox.error}
  <div class="slot">
    <div class="fold" transition:unfold>
      <div class="note">
        <Notice
          tone="danger"
          variant="inline"
          text={t.error.text(cfg.mailbox.error.kind, cfg.mailbox.error.params)}
        />
      </div>
    </div>
  </div>
{/if}

<Dialog
  bind:open={connecting}
  heading={cfg.mailbox.user ? t.settings.changeHeading : t.settings.connectHeading}
  confirmLabel={t.settings.connect}
  busy={checking}
  stoppable
  testid="dialog-mailbox"
  onconfirm={() => void connect()}
  oncancel={() => form?.cancel()}
>
  <MailboxForm bind:this={form} bind:busy={checking} autofocus />
</Dialog>
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

<style>
  /* A sentence of the box unfolds with its own padding (a margin would jump at once; `.slot`
     has no box). */
  .slot {
    display: contents;
  }

  .fold {
    display: flex;
    flex-direction: column;
  }

  .note {
    display: flex;
    padding-block: var(--space-12);
  }
</style>
