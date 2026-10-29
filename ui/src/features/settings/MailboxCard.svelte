<!--
  The mailbox's row in Einstellungen > Postfach (the round 10 draft): the connected address
  (text to copy) with its state under it, "Ändern" and "Entfernen…" (plain outlined buttons
  of one width; the dialog of Entfernen carries the danger, so its words end in an
  ellipsis), or without a mailbox
  "Kein Postfach verbunden", what one brings, and "Verbinden". Ändern and Verbinden unfold
  the form under the row (no dialog) and hide the row's buttons meanwhile: the provider and
  the address as a pair, the password, then "Abbrechen" and the primary "Verbinden" at the
  right in the order of the OS (decision 19), both as wide as the wider. Enter
  connects, Esc and Abbrechen fold it away and give the focus back to the row's button.
  Unfolded, the form glides into view as far as needed.
  While Verbinden signs in and counts it spins in its own width; Abbrechen and Esc stay live
  and stop the check (`cancel_run`).
  The state is the answer to a saved mailbox ("Verbunden", green; no note, no toast). After a
  red one it says "Passwort abgelehnt" (App-Passwort for Gmail and iCloud) or "Postfach nicht
  erreichbar" for a mail error of a fetch that finished after the mailbox was last accepted
  (`mailbox.checkedAt`): a fetch that failed at the mailbox, or whose mail part failed while
  the search went on ("Postfach prüfen" of its toast leads here). A run and the dry run lock
  the mailbox with their reason. The dialog of Entfernen stays open on a failure and says why
  inside; its button tries again.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { formKeys } from '$lib/input/input';
  import { invoke } from '$lib/ipc/api';
  import type { AppState } from '$lib/ipc/types';
  import { glideIntoView } from '$lib/motion/scroll';
  import { unfold } from '$lib/motion/transitions';
  import { primaryFirst } from '$lib/platform';
  import { app } from '$lib/state/app.svelte';
  import { tick } from 'svelte';
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

  const actionFirst = primaryFirst();
  /** The stored mailbox signs in with an app password (Gmail, iCloud). */
  const appPassword = $derived(
    cfg.mailbox.provider === 'gmail' || cfg.mailbox.provider === 'icloud',
  );
  let editing = $state(false);
  let checking = $state(false);
  let form = $state<MailboxForm | null>(null);
  /** The form, and the place of the row's button that opens it (Ändern, or Verbinden). */
  let editor = $state<HTMLElement | null>(null);
  let opening = $state<HTMLElement | null>(null);
  let confirmRemove = $state(false);
  let removing = $state(false);
  /** Said when it shows. */
  let removeError = $state<(() => string) | null>(null);

  /** The last fetch failed at the mailbox, or its mail part did while the search went on,
   *  after the mailbox was last accepted: a sign-in since then (`checkedAt`) makes the
   *  failure past. */
  const mailFailure = $derived.by(() => {
    const last = cfg.lastRun;
    if (last === null) return null;
    const error = last.outcome.kind === 'failed' ? last.outcome.error : last.mail;
    if (error === null || !MAIL_FAILURES.includes(error.kind)) return null;
    const checked = cfg.mailbox.checkedAt;
    if (checked !== null && Date.parse(last.finishedAt) <= Date.parse(checked)) return null;
    return error;
  });

  /** The form folds away; the focus, if it was in the form, goes back to the row's button. */
  async function close(): Promise<void> {
    const inside = editor?.contains(document.activeElement) ?? false;
    editing = false;
    await tick();
    if (inside) opening?.querySelector('button')?.focus();
  }

  /** Abbrechen and Esc: a check in progress stops, the form folds away. */
  function cancel(): void {
    form?.cancel();
    void close();
  }

  /** Verbinden: the form folds away once the mailbox is saved. */
  async function connect(): Promise<void> {
    if (await form?.save()) await close();
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
</script>

{#snippet opener(testid: string, icon: 'edit' | 'add', label: string)}
  <span class="opener" bind:this={opening}>
    <Button
      variant="secondary"
      {icon}
      {label}
      disabled={locked !== null}
      disabledReason={locked}
      {testid}
      onclick={() => (editing = true)}
    />
  </span>
{/snippet}

{#snippet connectButton()}
  <Button
    variant="primary"
    label={t.settings.connect}
    loading={checking}
    testid="mailbox-save"
    onclick={() => void connect()}
  />
{/snippet}

{#snippet cancelButton()}
  <Button label={t.common.cancel} testid="mailbox-cancel" onclick={cancel} />
{/snippet}

{#if cfg.mailbox.user}
  <SettingRow
    label={cfg.mailbox.user}
    copyLabel
    hint={mailFailure === null
      ? t.settings.connected
      : mailFailure.kind === 'mailAuth'
        ? t.settings.refused(appPassword)
        : t.settings.unreachable}
    status={mailFailure === null ? 'success' : 'danger'}
    pair
    testid="mailbox"
  >
    {#if !editing}
      {@render opener('mailbox-change', 'edit', t.common.change)}
      <Button
        variant="secondary"
        icon="trash"
        label={t.settings.removeOpens}
        disabled={locked !== null}
        disabledReason={locked}
        testid="mailbox-remove"
        onclick={() => {
          removeError = null;
          confirmRemove = true;
        }}
      />
    {/if}
  </SettingRow>
{:else}
  <SettingRow label={t.settings.notConnected} hint={t.settings.notConnectedHint} testid="mailbox">
    {#if !editing}{@render opener('mailbox-connect', 'add', t.settings.connect)}{/if}
  </SettingRow>
{/if}
{#if editing}
  <!-- Unfolded, the form comes into view whole (it may open below the window's edge). -->
  <div class="fold" transition:unfold onintroend={() => editor && glideIntoView(editor)}>
    <div class="edit" bind:this={editor} use:formKeys={{ save: () => void connect(), cancel }}>
      <MailboxForm bind:this={form} bind:busy={checking} autofocus />
      <div class="buttons" data-testid="mailbox-buttons">
        {#if actionFirst}{@render connectButton()}{@render cancelButton()}{:else}{@render cancelButton()}{@render connectButton()}{/if}
      </div>
    </div>
  </div>
{/if}
{#if cfg.mailbox.error}
  <div class="fold" transition:unfold>
    <div class="note">
      <Notice
        tone="danger"
        variant="inline"
        text={t.error.text(cfg.mailbox.error.kind, cfg.mailbox.error.params)}
      />
    </div>
  </div>
{/if}

<Dialog
  bind:open={confirmRemove}
  variant="danger"
  heading={t.settings.removeMailbox}
  text={t.settings.removeMailboxText(appPassword)}
  confirmLabel={t.common.remove}
  busy={removing}
  error={removeError?.() ?? null}
  testid="dialog-remove-mailbox"
  onconfirm={() => void remove()}
/>

<style>
  /* The row's button keeps its place in the row's buttons. */
  .opener {
    display: contents;
  }

  /* Folds open and away with its own padding (a margin would jump at once). */
  .fold {
    display: flex;
    flex-direction: column;
  }

  .edit {
    display: flex;
    flex-direction: column;
    gap: var(--mail-form-gap);
    padding: var(--mail-form-pad);
  }

  /* The pair at the right, in columns of one width (the wider label's). */
  .buttons {
    --btn-min: var(--button-pair-min);

    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    align-self: flex-end;
    gap: var(--space-8);
    width: max-content;
  }

  .note {
    display: flex;
    padding: 0 var(--card-pad-x) var(--space-12) var(--setting-rule-start);
  }
</style>
