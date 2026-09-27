<!--
  No profile yet (or one that no longer reads): one sentence what the profile is for and
  the three ways in, side by side as siblings (32 px like every main action), the same words
  as in the menu of the profiles: "Neues Profil" (the primary, an empty form), "Aus Datei
  laden" (an existing JSON file, also the one an AI wrote) and "KI-Prompt für
  Profilanfertigung kopieren" (the prompt that has any AI write that file from a CV; a toast
  says it is copied). A file that no longer reads also offers its folder, to fix it by hand.
  Sits at about 38 % of the height.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    heading: string;
    text: string;
    picking: boolean;
    /** The stored file no longer reads: its folder is at hand. */
    unreadable?: boolean;
    note: string | null;
    oncreate: () => void;
    onpick: () => void;
    onprompt: () => void;
    onopenfolder?: () => void;
  }

  let {
    heading,
    text,
    picking,
    unreadable = false,
    note,
    oncreate,
    onpick,
    onprompt,
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
      testid="profile-create"
      onclick={oncreate}
    />
    <Button
      variant="secondary"
      size="field"
      icon="pickFile"
      label={t.profile.load}
      loading={picking}
      testid="profile-pick"
      onclick={onpick}
    />
    <Button
      variant="secondary"
      size="field"
      icon="prompt"
      label={t.profile.prompt}
      testid="profile-prompt"
      onclick={onprompt}
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
