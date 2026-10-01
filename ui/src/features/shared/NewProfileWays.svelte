<!--
  "Neues Profil" as a page, not a dialog (user decisions 2026-10-01): the three ways to a new
  profile as the rows of one card, each with its one button: "Leer anfangen" opens the empty
  form, "Aus Datei laden" the file dialog ("Datei hochladen"), "Aus dem Lebenslauf" copies the
  prompt (it says "Kopiert" for a moment) that has any AI turn a CV into the profile file,
  which comes back the same way, with "Datei hochladen". What went wrong is said at the end
  of the card. Nothing is stored before "Speichern". The Profil view shows it without a
  profile and for "Neues Profil" of its menu; "Profil anlegen" of the job list and the
  first-run page lead there.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { copyProfilePrompt } from './profileWays';

  interface Props {
    /** "Leer anfangen": the empty form. */
    onempty: () => void;
    /** "Datei hochladen": the file dialog; resolves once it is closed. */
    onfile: () => Promise<void>;
  }

  let { onempty, onfile }: Props = $props();

  let copied = $state(false);
  let picking = $state(false);
  let error = $state<(() => string) | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    error = null;
    try {
      if (!(await copyProfilePrompt())) {
        error = () => t.profile.promptNotCopied;
        return;
      }
    } catch (failure) {
      error = () => errorText(failure);
      return;
    }
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1600);
  }

  async function file(): Promise<void> {
    if (picking) return;
    error = null;
    picking = true;
    try {
      await onfile();
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      picking = false;
    }
  }
</script>

<Card padding="rows" testid="new-profile-ways">
  <SettingRow label={t.profile.way.empty} hint={t.profile.emptyHint} testid="new-profile-way-empty">
    <Button
      variant="secondary"
      size="sm"
      icon="edit"
      label={t.profile.startEmpty}
      testid="new-profile-empty"
      onclick={onempty}
    />
  </SettingRow>
  <SettingRow label={t.profile.way.file} hint={t.profile.fileHint} testid="new-profile-way-file">
    <Button
      variant="secondary"
      size="sm"
      icon="pickFile"
      label={t.profile.pickFile}
      loading={picking}
      testid="new-profile-file"
      onclick={() => void file()}
    />
  </SettingRow>
  <SettingRow label={t.profile.way.cv} hint={t.profile.cvPrompt} testid="new-profile-way-cv">
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? 'check' : 'copy'}
      label={copied ? t.profile.copied : t.profile.copyPrompt}
      testid="new-profile-copy"
      onclick={() => void copy()}
    />
  </SettingRow>
  {#if error}
    <div class="note">
      <Notice tone="danger" variant="inline" text={error()} testid="new-profile-error" />
    </div>
  {/if}
</Card>

<style>
  /* A note runs on the rows' inset. */
  .note {
    padding: 0 var(--row-inset) var(--space-12);
  }
</style>
