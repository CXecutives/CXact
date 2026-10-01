<!--
  "Neues Profil" as a page, not a dialog (user decision 2026-10-01): the three ways to a new
  profile as the rows of one card, the recommended one first, each with its own button.
  "Aus dem Lebenslauf": "Prompt kopieren" (it says "Kopiert" for a moment), give it to any AI
  with the CV, then "Antwort einfügen" reads the AI's answer from the clipboard into the form
  for review; where the platform refuses the clipboard a field under the row takes the pasted
  answer. "Leer anfangen" opens the empty form, "Aus Datei laden" the file dialog. What went
  wrong is said at the end of the card. Nothing is stored before "Speichern". The Profil view
  shows it without a profile and for "Neues Profil" of its menu; "Profil anlegen" of the job
  list and the first-run page lead there.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import TextArea from '$components/TextArea.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import type { ProfileDraft } from '$lib/ipc/types';
  import { clipboardText, copyProfilePrompt, readAnswer } from './profileWays';

  interface Props {
    /** "Leer anfangen": the empty form. */
    onempty: () => void;
    /** "Aus Datei laden": the file dialog; resolves once it is closed. */
    onfile: () => Promise<void>;
    /** The answer of an AI as a draft for review. */
    onanswer: (draft: ProfileDraft) => void;
  }

  let { onempty, onfile, onanswer }: Props = $props();

  let copied = $state(false);
  let busy = $state<'paste' | 'file' | null>(null);
  let error = $state<(() => string) | null>(null);
  /** The platform refused the clipboard: the answer is pasted into this field. */
  let manual = $state(false);
  let pasted = $state('');
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

  /** The answer from the clipboard (or the field once the clipboard was refused). */
  async function paste(): Promise<void> {
    if (busy !== null) return;
    error = null;
    busy = 'paste';
    try {
      const text = manual ? pasted : await clipboardText();
      if (text === null || text.trim() === '') {
        manual = true;
        return;
      }
      const draft = await readAnswer(text);
      if (draft === null) {
        error = () => t.profile.noAnswer;
        return;
      }
      onanswer(draft);
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = null;
    }
  }

  async function file(): Promise<void> {
    if (busy !== null) return;
    error = null;
    busy = 'file';
    try {
      await onfile();
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = null;
    }
  }
</script>

<Card padding="rows" testid="new-profile-ways">
  <SettingRow label={t.profile.way.cv} hint={t.profile.cvPrompt} testid="new-profile-way-cv">
    <div class="buttons">
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? 'check' : 'copy'}
        label={copied ? t.profile.copied : t.profile.copyPrompt}
        testid="new-profile-copy"
        onclick={() => void copy()}
      />
      <Button
        variant="secondary"
        size="sm"
        icon="paste"
        label={t.profile.pasteAnswer}
        loading={busy === 'paste'}
        testid="new-profile-paste"
        onclick={() => void paste()}
      />
    </div>
  </SettingRow>
  {#if manual}
    <div class="answer">
      <Field label={t.profile.answerField} for="new-profile-answer">
        <TextArea
          id="new-profile-answer"
          bind:value={pasted}
          rows={4}
          testid="new-profile-answer"
        />
      </Field>
    </div>
  {/if}
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
      loading={busy === 'file'}
      testid="new-profile-file"
      onclick={() => void file()}
    />
  </SettingRow>
  {#if error}
    <div class="note">
      <Notice tone="danger" variant="inline" text={error()} testid="new-profile-error" />
    </div>
  {/if}
</Card>

<style>
  /* The buttons of a row end on its trailing edge, 12 apart. */
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-12);
  }

  /* The pasted answer and a note run on the rows' inset. */
  .answer,
  .note {
    padding: 0 var(--row-inset) var(--space-12);
  }
</style>
