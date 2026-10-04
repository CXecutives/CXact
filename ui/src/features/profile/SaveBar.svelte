<!--
  The Profil's floating bar (FloatBar, design B): what a failed save says, else what is still
  missing after a press of Speichern (its names lead to their fields), else "Ungespeicherte
  Änderungen"; while the form holds a change Verwerfen (quiet) and Speichern (the view's one
  primary; it waits while a value is marked), in the order of the OS.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import FloatBar from '$components/FloatBar.svelte';
  import { t } from '$lib/i18n/t';
  import { primaryFirst } from '$lib/platform';
  import MissingLine from '../shared/MissingLine.svelte';

  interface Props {
    /** The form holds a change: the buttons show. */
    dirty: boolean;
    busy: boolean;
    /** A value is marked: Speichern waits. */
    held: boolean;
    /** Why the last save failed. */
    failure: string | null;
    /** The required fields still empty once Speichern asked, with their names. */
    missing: readonly { field: string; name: string }[];
    onjump: (field: string) => void;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { dirty, busy, held, failure, missing, onjump, onsave, ondiscard }: Props = $props();

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

<FloatBar testid="profile-save-bar">
  {#if failure}
    <p role="alert" data-testid="profile-save-error">{failure}</p>
  {:else if missing.length > 0}
    <MissingLine fields={missing} {onjump} />
  {:else}
    <p data-testid="profile-unsaved">{t.profile.unsaved}</p>
  {/if}
  {#snippet actions()}
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
  {/snippet}
</FloatBar>
