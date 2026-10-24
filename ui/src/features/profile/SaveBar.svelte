<!--
  The Profil's bar at the foot (BottomBar, the round 10 draft) while the form holds a change
  or the last save failed: at its left "Ungespeicherte Änderungen" (13 muted) or why the save
  failed (the deep red of words); at its right Verwerfen (quiet) and Speichern (the view's
  one primary; it waits while a value is wrong, its tooltip naming that field), in the order
  of the OS, each at least the pair's width. Speichern keeps its width while it saves.
-->
<script lang="ts">
  import BottomBar from '$components/BottomBar.svelte';
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import { primaryFirst } from '$lib/platform';

  interface Props {
    /** The form holds a change: the buttons show. */
    dirty: boolean;
    busy: boolean;
    /** The label of a value that is wrong: Speichern waits for it. */
    wrong: string | null;
    /** Why the last save failed. */
    failure: string | null;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { dirty, busy, wrong, failure, onsave, ondiscard }: Props = $props();

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

{#snippet actions()}
  {#if dirty}
    {#if !actionFirst}{@render discardButton()}{/if}
    <Button
      variant="primary"
      label={t.profile.save}
      disabled={wrong !== null}
      disabledReason={wrong === null ? null : t.profile.fixFirst(wrong)}
      loading={busy}
      testid="profile-save"
      onclick={onsave}
    />
    {#if actionFirst}{@render discardButton()}{/if}
  {/if}
{/snippet}

<BottomBar {actions} testid="profile-save-bar">
  {#if failure}
    <p class="failure" role="alert" data-testid="profile-save-error">{failure}</p>
  {:else}
    <p data-testid="profile-unsaved">{t.profile.unsaved}</p>
  {/if}
</BottomBar>

<style>
  .failure {
    color: var(--error-text);
  }
</style>
