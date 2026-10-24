<!--
  An alert mail read in the app (design round 7): a mailbox other than Gmail has no web link
  to the mail, so "Alert-Mail öffnen" shows the mail CXact kept (view::alert_mail): its
  subject as the heading, sender and date in one quiet line, the text to read and copy in the
  look of the ad's text (muted 14/23). One button closes it, Esc too.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { formatMoment } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import type { StoredMail } from '$lib/ipc/types';

  interface Props {
    mail: StoredMail | null;
    onclose: () => void;
  }

  let { mail, onclose }: Props = $props();
</script>

<Dialog
  open={mail !== null}
  single
  heading={mail?.subject || t.actions.mail}
  confirmLabel={t.reader.close}
  testid="dialog-mail"
  onconfirm={onclose}
  oncancel={onclose}
>
  {#if mail}
    <p class="from" data-copy>
      {mail.sender}{#if mail.date}, {formatMoment(mail.date)}{/if}
    </p>
    <div class="text" data-copy data-testid="mail-text">{mail.text}</div>
  {/if}
</Dialog>

<style>
  .from {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .text {
    max-height: var(--mail-view-height);
    overflow: auto;
    color: var(--text-muted);
    font: var(--type-body);
    white-space: pre-wrap;
  }
</style>
