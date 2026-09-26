<!--
  "Sicherung wiederherstellen" (Einstellungen > Wartung): the copies of the database by day in
  the app's time words, newest first and chosen, the size at the end and why a copy from
  before an update or a restore is there. The one button asks first with the copy's date and
  says the current state is saved first, then restores; a failure stays in the dialog. After
  the restore the undos of before go (their jobs may be gone), the app state, the list and
  the counts load again, and a toast offers "Rückgängig": the copy of the state before.
-->
<script lang="ts" module>
  /** Runs a step as a command of the card the row is on: its button turns meanwhile and a
   *  failure is the card's note. */
  export type Runner = (work: () => Promise<void>) => Promise<void>;
</script>

<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import RadioList from '$components/RadioList.svelte';
  import { formatBytes, formatDate, formatDayTime, formatTime } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import type { Backup } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { clock } from '$lib/state/clock.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { toasts } from '$lib/state/toasts.svelte';

  let open = $state(false);
  let backups = $state.raw<Backup[]>([]);
  let chosenId = $state<string | null>(null);
  /** The question before the restore shows. */
  let asking = $state(false);
  let busy = $state(false);
  let error = $state<(() => string) | null>(null);
  const chosen = $derived(backups.find((backup) => backup.id === chosenId) ?? null);
  /** The card's runner of the last `show` (the toast's undo runs through it too). */
  let run: Runner = (work) => work();

  /** Lists the copies and opens on the newest; `onempty` says in the card there is none. */
  export function show(runner: Runner, onempty: () => void): Promise<void> {
    run = runner;
    return run(async () => {
      const found = await invoke('list_backups');
      if (found.length === 0) {
        onempty();
        return;
      }
      backups = found;
      chosenId = found[0]!.id;
      asking = false;
      error = null;
      open = true;
    });
  }

  /** The database changed under the page: the undos of before go, everything loads again. */
  async function reloadAll(): Promise<void> {
    toasts.clear();
    await Promise.all([app.load(), jobs.reload()]);
  }

  /** The button: first the question with the copy's date, then the restore. */
  async function confirm(): Promise<void> {
    if (chosen === null) return;
    if (!asking) {
      asking = true;
      return;
    }
    busy = true;
    error = null;
    try {
      const before = await invoke('restore_backup', { id: chosen.id });
      open = false;
      await reloadAll();
      toasts.show(t.settings.backupRestored, 'success', {
        label: t.common.undo,
        onclick: () => void undo(before.id),
      });
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = false;
    }
  }

  const undo = (id: string): Promise<void> =>
    run(async () => {
      await invoke('restore_backup', { id });
      await reloadAll();
      toasts.show(t.settings.backupUndone);
    });
</script>

<Dialog
  bind:open
  heading={asking && chosen !== null
    ? t.settings.backupConfirm(formatDate(chosen.at), formatTime(chosen.at))
    : t.settings.backup}
  text={asking ? t.settings.backupConfirmText : null}
  confirmLabel={t.settings.backupAction}
  {busy}
  error={error?.() ?? null}
  testid="dialog-backup"
  onconfirm={() => void confirm()}
>
  {#if !asking}
    <RadioList
      options={backups.map((backup) => ({
        id: backup.id,
        label: formatDayTime(backup.at, clock.now),
        note: t.settings.backupKind[backup.kind],
        detail: formatBytes(backup.bytes),
      }))}
      value={chosenId}
      label={t.settings.backup}
      testid="backup-list"
      onchange={(id) => (chosenId = id)}
    />
  {/if}
</Dialog>
