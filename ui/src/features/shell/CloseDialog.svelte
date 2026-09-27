<!--
  Closing the window while a fetch runs asks first (src-tauri/src/main.rs sends
  `close-running`): "Trotzdem schließen?" over "Der Abruf läuft noch." with Schließen and
  Abbrechen.
  Schließen cancels the fetch and closes once it has stopped (the closing note of App.svelte
  says so meanwhile); Abbrechen keeps the window and the fetch. A fetch that ends while the
  question is open ends the question too: the next close goes through without one. Only a
  fetch the page has seen running ends it: a close asked right as a fetch starts (the backend
  knows before the page does) keeps its question.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { invoke, onCloseRunning } from '$lib/ipc/api';
  import { run } from '$lib/state/run.svelte';

  let open = $state(false);
  /** The page has seen the fetch run while the question was open. */
  let seen = false;

  $effect(() =>
    onCloseRunning(() => {
      seen = run.active;
      open = true;
    }),
  );

  // The fetch ended meanwhile: nothing to ask any more.
  $effect(() => {
    if (!open) return;
    if (run.active) seen = true;
    else if (seen) answer(false);
  });

  function answer(close: boolean): void {
    open = false;
    invoke('answer_close', { close }).catch(() => undefined);
  }
</script>

<Dialog
  {open}
  heading={t.shell.closeHeading}
  text={t.shell.closeText}
  confirmLabel={t.shell.closeAction}
  testid="dialog-close-running"
  onconfirm={() => answer(true)}
  oncancel={() => answer(false)}
/>
