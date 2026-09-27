<!--
  "Wiederherstellen" of the Sicherung (Einstellungen > Daten, and "Sicherung wiederherstellen"
  of a start whose data could not load, App.svelte): the copies of the database,
  newest first and chosen, each by its moment in the one format of a moment at the start of
  a line (formatDayTime: "Heute 08:05", "Gestern 08:41", "Mo 09:12", then "18.09. 08:41")
  and why a copy from before an update or a restore is there. The one button restores the
  chosen copy (the current state is saved first, the dialog says so); a failure stays in the
  dialog. After the restore the undos of before go (their jobs may be gone), the app state,
  the list and the counts load again, and a toast offers "Rückgängig": the copy of the state
  before.
-->
<script lang="ts" module>
  /** Runs a step as a command of the card the row is on: its button turns meanwhile and a
   *  failure is the card's note. */
  export type Runner = (work: () => Promise<void>) => Promise<void>;
</script>

<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import RadioList from '$components/RadioList.svelte';
  import { formatDayTime } from '$lib/i18n/format';
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
      error = null;
      open = true;
    });
  }

  /** The database changed under the page: the undos of before go, everything loads again. */
  async function reloadAll(): Promise<void> {
    toasts.clear();
    await Promise.all([app.load(), jobs.reload()]);
  }

  async function restore(): Promise<void> {
    if (chosen === null) return;
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
  heading={t.settings.backupHeading}
  text={t.settings.backupText}
  confirmLabel={t.settings.backupAction}
  {busy}
  error={error?.() ?? null}
  testid="dialog-backup"
  onconfirm={() => void restore()}
>
  <RadioList
    options={backups.map((backup) => ({
      id: backup.id,
      label: formatDayTime(backup.at, clock.now),
      note: t.settings.backupKind[backup.kind],
    }))}
    value={chosenId}
    label={t.settings.backupHeading}
    testid="backup-list"
    onchange={(id) => (chosenId = id)}
  />
</Dialog>
