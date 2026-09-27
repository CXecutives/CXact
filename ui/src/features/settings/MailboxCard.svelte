<!--
  The Postfach card of Einstellungen: the connected address with its badge, "Ändern" and
  "Entfernen" (the same kind of button; Entfernen is red at rest and asks first), without a
  mailbox the row "Kein Postfach" with "Verbinden". Ändern and Verbinden open the form in a
  dialog named after the button ("Postfach ändern", "Postfach verbinden") whose button is
  "Verbinden". The card's note follows (`children`).
  The badge is the answer to a saved mailbox ("Verbunden", no note, no toast). It says "Nicht
  erreichbar" or "Abgelehnt" only for a mail error of a fetch that finished after Gmail last
  accepted the mailbox (`mailbox.checkedAt`), with a sentence at the end of the card where it
  adds the next step; a sentence unfolds, so the cards below glide. A run, the dry run and
  the demo lock the mailbox with their reason. The demo has no mailbox (its sample address
  only keeps the app from asking for one): the row says "Kein Postfach", like its note. A
  dialog whose action fails stays open and says why inside; its button tries again.
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
  import { unfold } from '$lib/motion/transitions';
  import { app } from '$lib/state/app.svelte';
  import type { Snippet } from 'svelte';
  import MailboxForm from '../shared/MailboxForm.svelte';

  interface Props {
    cfg: AppState;
    /** Why the mailbox cannot change now (the demo, the dry run, a run), or null. */
    locked: string | null;
    /** The card's note (a failure of a command of the card). */
    children: Snippet;
  }
  let { cfg, locked, children }: Props = $props();

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
  /** Said when it shows, so in the language of the moment. */
  let removeError = $state<(() => string) | null>(null);

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
  /** The sentence of the card: what to do when Gmail refused the password, else the cause
   *  where it says more than the badge ("Gmail ist nicht erreichbar" is the badge itself). */
  const mailFailureText = $derived(
    mailFailure === null || mailFailure.kind === 'mailConnect'
      ? null
      : mailFailure.kind === 'mailAuth'
        ? t.settings.mailRefused
        : t.error.text(mailFailure.kind, mailFailure.params),
  );

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

<Card padding="rows">
  {#if cfg.mailbox.user && !cfg.demo}
    <SettingRow label={cfg.mailbox.user} copyLabel testid="mailbox">
      {#snippet badges()}
        {#if mailFailure}
          <Badge
            label={mailFailure.kind === 'mailAuth' ? t.settings.refused : t.settings.unreachable}
            tone="danger"
            icon="warning"
          />
        {:else}
          <Badge label={t.settings.connected} tone="success" icon="check" />
        {/if}
      {/snippet}
      <div class="buttons">
        <Button
          variant="secondary"
          size="sm"
          icon="edit"
          label={t.common.change}
          disabled={locked !== null}
          disabledReason={locked}
          testid="mailbox-change"
          onclick={openForm}
        />
        <Button
          variant="secondary"
          size="sm"
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
      </div>
    </SettingRow>
  {:else}
    <SettingRow label={t.settings.notConnected} testid="mailbox">
      <Button
        variant="secondary"
        size="sm"
        icon="signIn"
        label={t.settings.connect}
        disabled={locked !== null}
        disabledReason={locked}
        testid="mailbox-connect"
        onclick={openForm}
      />
    </SettingRow>
  {/if}
  {@render children()}
  {#if mailFailureText}
    <div class="slot">
      <div class="fold" transition:unfold>
        <div class="note">
          <Notice tone="danger" variant="inline" text={mailFailureText} testid="mailbox-failure" />
        </div>
      </div>
    </div>
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
</Card>

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
  <MailboxForm bind:this={form} bind:busy={checking} dialog autofocus />
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
  /* The buttons of a row end on its trailing edge, 12 apart, one size (28). */
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-12);
  }

  /* A sentence of the card unfolds with the card's inset of what is not a row as its own
     padding (a margin would jump at once; `.slot` has no box, so Card's margin passes it). */
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
