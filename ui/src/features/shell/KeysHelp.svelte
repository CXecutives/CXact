<!--
  The card of the keys: Ctrl+/ (Cmd+/ on macOS) opens it from anywhere, the same keys, Esc
  or its button close it (a modal dialog, lib/input/input.ts). The two short lists of the
  app's keys (lib/input/keys.ts, the same as in Einstellungen), named as the OS names them.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import { t } from '$lib/i18n/t';
  import { help } from '$lib/state/help.svelte';
  import KeyList from '../shared/KeyList.svelte';
</script>

<Dialog
  bind:open={help.open}
  heading={t.keysHelp.heading}
  confirmLabel={t.keysHelp.close}
  alone
  testid="keys-help"
  onconfirm={() => help.hide()}
>
  <KeyList />
</Dialog>
