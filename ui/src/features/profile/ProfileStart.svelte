<!--
  No profile yet (or one that no longer reads): one sentence what the profile is for and
  "Neues Profil" (the primary, 32 px like every main action), which opens the dialog of the
  three ways, the same as in the menu of the profiles. A file that no longer reads also
  offers its folder, to fix it by hand. Sits at about 38 % of the height.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    heading: string;
    text: string;
    /** A chosen file is being read (the button waits). */
    picking: boolean;
    /** The stored file no longer reads: its folder is at hand. */
    unreadable?: boolean;
    note: string | null;
    oncreate: () => void;
    onopenfolder?: () => void;
  }

  let {
    heading,
    text,
    picking,
    unreadable = false,
    note,
    oncreate,
    onopenfolder,
  }: Props = $props();
</script>

<div class="start" data-testid="profile-empty">
  <EmptyState icon="document" {heading} {text} />
  <div class="ways">
    <Button
      variant="primary"
      size="field"
      icon="add"
      label={t.profile.newProfile}
      loading={picking}
      testid="profile-create"
      onclick={oncreate}
    />
  </div>
  {#if unreadable && onopenfolder}
    <Button
      variant="link"
      icon="folder"
      label={t.common.openFolder}
      testid="profile-folder"
      onclick={onopenfolder}
    />
  {/if}
  {#if note}
    <Notice tone="danger" variant="inline" text={note} testid="profile-note" />
  {/if}
</div>

<style>
  .start {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-16);
  }

  .ways {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-12);
  }
</style>
