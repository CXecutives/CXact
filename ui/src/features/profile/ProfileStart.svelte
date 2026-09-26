<!--
  No profile yet (or one that no longer reads): one sentence what the profile is for and
  the three ways in, side by side as siblings (32 px like every main action): "Aus Lebenslauf
  anlegen" (the primary, the recommended way: a prompt for an AI fills the whole form),
  "Profil anlegen" (an empty form) and "Profildatei wählen" (an existing JSON file). A file
  that no longer reads also offers its folder, to fix it by hand. Sits at about 38 % of the
  height.
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
    onfromcv: () => void;
    onpick: () => void;
    onopenfolder?: () => void;
  }

  let {
    heading,
    text,
    picking,
    unreadable = false,
    note,
    oncreate,
    onfromcv,
    onpick,
    onopenfolder,
  }: Props = $props();
</script>

<div class="start" data-testid="profile-empty">
  <EmptyState icon="document" {heading} {text} />
  <div class="ways">
    <Button
      variant="primary"
      size="field"
      icon="paste"
      label={t.profile.fromCv}
      testid="profile-from-cv"
      onclick={onfromcv}
    />
    <Button
      variant="secondary"
      size="field"
      icon="add"
      label={t.profile.create}
      testid="profile-create"
      onclick={oncreate}
    />
    <Button
      variant="secondary"
      size="field"
      icon="pickFile"
      label={t.profile.pick}
      loading={picking}
      testid="profile-pick"
      onclick={onpick}
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
