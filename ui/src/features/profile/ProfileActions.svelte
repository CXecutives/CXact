<!--
  The actions in the Profil's head: while the form holds a change "Verwerfen" (quiet) and
  "Speichern" (the view's one primary; it waits while a value is marked), in the order of the
  OS; and always "Aus Lebenslauf ausfüllen", which opens a small popover under it with the
  drop zone of the CV (a click opens the file dialog) and one line of what the import does.
  It waits while the form holds changes and says ahead of the click when no evaluation is
  left today (fromCv.svelte.ts).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Popover from '$components/Popover.svelte';
  import Tile from '$components/Tile.svelte';
  import { t } from '$lib/i18n/t';
  import { primaryFirst } from '$lib/platform';
  import { fromCv } from '../shared/fromCv.svelte';

  interface Props {
    /** The form holds a change: Verwerfen and Speichern show, the CV waits. */
    dirty: boolean;
    /** A save goes. */
    busy: boolean;
    /** A value is marked: Speichern waits. */
    held: boolean;
    ondiscard: () => void;
    onsave: () => void;
    /** The file dialog of the CV. */
    oncv: () => void;
  }

  let { dirty, busy, held, ondiscard, onsave, oncv }: Props = $props();

  const actionFirst = primaryFirst();
</script>

{#snippet discardButton()}
  <Button
    variant="ghost"
    label={t.profile.discard}
    disabled={busy}
    testid="profile-discard"
    onclick={ondiscard}
  />
{/snippet}

{#if dirty}
  {#if !actionFirst}{@render discardButton()}{/if}
  <Button
    variant="primary"
    label={t.profile.save}
    disabled={held}
    disabledReason={t.profile.fixFirst}
    loading={busy}
    testid="profile-save"
    onclick={onsave}
  />
  {#if actionFirst}{@render discardButton()}{/if}
{/if}
<Popover align="end" testid="cv-popover">
  {#snippet trigger({ toggle, open })}
    <Button
      variant="secondary"
      icon="pickFile"
      label={t.profile.fromCv}
      loading={fromCv.busy}
      disabled={dirty || fromCv.limited}
      disabledReason={fromCv.limited ? t.profile.cvError.limit : t.profile.saveFirst}
      expanded={open}
      testid="profile-from-cv"
      onclick={toggle}
    />
  {/snippet}
  {#snippet children({ close })}
    <Tile
      drop
      icon="pickFile"
      label={t.profile.cvDrop}
      note={t.profile.cvFormats}
      testid="cv-drop"
      onclick={() => {
        close();
        oncv();
      }}
    />
    <p class="note">{t.profile.cvNote}</p>
  {/snippet}
</Popover>

<style>
  .note {
    padding: 0 var(--space-4) var(--space-2);
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
