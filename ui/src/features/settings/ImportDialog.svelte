<!--
  "Importieren" of "Daten importieren" (Einstellungen > Daten): asks first what a data file
  replaces (the jobs, the profile, the settings) and that the current state is backed up
  first (a copy in the Sicherung list), then the OS's dialog chooses the file. A file that is
  no data export of the app, a damaged one or one of a newer version is refused inside the
  dialog, which stays open; a closed file dialog closes it too. After the import the undos of
  before go, the app state, the list and the counts load again (the colours and the language
  follow), and a toast says it.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { jobs } from '$lib/state/jobs.svelte';
  import { toasts } from '$lib/state/toasts.svelte';

  let open = $state(false);
  let busy = $state(false);
  let error = $state<(() => string) | null>(null);

  export function show(): void {
    error = null;
    open = true;
  }

  async function importFile(): Promise<void> {
    busy = true;
    error = null;
    try {
      const imported = await invoke('import_data');
      open = false;
      if (!imported) return;
      toasts.clear();
      await Promise.all([app.load(), jobs.reload()]);
      toasts.show(t.settings.imported, 'success');
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  bind:open
  heading={t.settings.importHeading}
  text={t.settings.importText}
  items={t.settings.importItems}
  confirmLabel={t.settings.importAction}
  {busy}
  error={error?.() ?? null}
  testid="dialog-import"
  onconfirm={() => void importFile()}
/>
