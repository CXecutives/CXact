<!--
  "Papierkorb leeren" in the list header's action cell: outlined in the red of every button
  that deletes and as wide as the fetch as it stands ("Jobs suchen" or "Postfach abrufen";
  an unseen one sets the width; user, 2026-09-29), at the cell's right edge.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import { fetchLook } from '$lib/state/run.svelte';

  interface Props {
    disabled: boolean;
    disabledReason: string | null;
    testid: string | null;
    onclick: () => void;
  }

  let { disabled, disabledReason, testid, onclick }: Props = $props();
</script>

<span class="cell">
  <span class="sizer" aria-hidden="true" inert>
    <Button variant="secondary" {...fetchLook()} />
  </span>
  <span class="own">
    <Button
      variant="secondary"
      icon="trash"
      label={t.actions.emptyTrash}
      {disabled}
      {disabledReason}
      warns
      wide
      {testid}
      {onclick}
    />
  </span>
</span>

<style>
  .cell {
    display: grid;
  }

  .sizer,
  .own {
    display: flex;
    grid-area: 1 / 1;
  }

  /* Holds the width of "Postfach abrufen", unseen. */
  .sizer {
    visibility: hidden;
  }
</style>
