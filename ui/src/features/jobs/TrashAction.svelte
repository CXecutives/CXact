<!--
  "Papierkorb leeren" in the list header's action cell: outlined in the red of every button
  that deletes and at least as wide as "Jobs suchen" (an unseen one sets the width; user,
  2026-09-29), at the cell's right edge.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';

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
    <Button variant="secondary" icon="search" label={t.toolbar.searchNow} />
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

  /* Holds the width of "Jobs suchen", unseen. */
  .sizer {
    visibility: hidden;
  }
</style>
