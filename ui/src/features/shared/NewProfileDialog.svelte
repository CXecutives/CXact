<!--
  "Neues Profil" (the menu of the profiles, the Profil view's empty state, the first-run page;
  user decision 2026-10-01): the three ways to a new profile as one choice, the recommended one
  first. "Aus dem Lebenslauf" shows its two steps: "Prompt kopieren" (the button says "Kopiert"
  for a moment, the toasts wait behind the dialog), give it to any AI with the CV, then
  "Antwort einfügen" reads the answer from the clipboard into the form for review. Where the
  platform refuses the clipboard a field takes the pasted answer; an answer that holds no
  profile is said in the dialog, which stays. "Leer anfangen" opens the empty form, "Aus Datei
  laden" the file dialog. The dialog's button names what the chosen way does; nothing is
  stored before "Speichern".
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Field from '$components/Field.svelte';
  import RadioList, { type RadioListOption } from '$components/RadioList.svelte';
  import TextArea from '$components/TextArea.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import type { ProfileDraft } from '$lib/ipc/types';
  import { clipboardText, copyProfilePrompt, readAnswer } from './profileWays';

  type Way = 'cv' | 'empty' | 'file';

  interface Props {
    open: boolean;
    /** "Leer anfangen": the empty form. */
    onempty: () => void;
    /** "Aus Datei laden": the file dialog; resolves once it is closed. */
    onfile: () => Promise<void>;
    /** The answer of an AI as a draft for review. */
    onanswer: (draft: ProfileDraft) => void;
  }

  let { open = $bindable(), onempty, onfile, onanswer }: Props = $props();

  let way = $state<Way>('cv');
  let copied = $state(false);
  let busy = $state(false);
  let error = $state<(() => string) | null>(null);
  /** The platform refused the clipboard: the answer is pasted into this field. */
  let manual = $state(false);
  let pasted = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  // Every opening starts at the recommended way, without what was typed before.
  $effect(() => {
    if (!open) return;
    way = 'cv';
    copied = false;
    error = null;
    manual = false;
    pasted = '';
  });

  const ways = $derived<RadioListOption<Way>[]>([
    { id: 'cv', label: t.profile.way.cv, note: t.profile.wayNote },
    { id: 'empty', label: t.profile.way.empty },
    { id: 'file', label: t.profile.way.file },
  ]);

  const confirmLabel = $derived(
    way === 'cv'
      ? t.profile.pasteAnswer
      : way === 'empty'
        ? t.profile.startEmpty
        : t.profile.pickFile,
  );

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
    const text = manual ? pasted : await clipboardText();
    if (text === null) {
      manual = true;
      return;
    }
    const draft = await readAnswer(text);
    if (draft === null) {
      error = () => t.profile.noAnswer;
      return;
    }
    open = false;
    onanswer(draft);
  }

  async function confirm(): Promise<void> {
    if (busy) return;
    error = null;
    if (way === 'empty') {
      open = false;
      onempty();
      return;
    }
    busy = true;
    try {
      if (way === 'cv') await paste();
      else {
        open = false;
        await onfile();
      }
    } catch (failure) {
      error = () => errorText(failure);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog
  bind:open
  heading={t.profile.newProfile}
  {confirmLabel}
  {busy}
  error={error?.() ?? null}
  testid="dialog-new-profile"
  onconfirm={() => void confirm()}
>
  <div class="ways">
    <RadioList
      options={ways}
      value={way}
      label={t.profile.ways}
      testid="new-profile-ways"
      onchange={(id) => {
        way = id;
        error = null;
      }}
    />
    {#if way === 'cv'}
      <ol class="steps" data-testid="new-profile-steps">
        <li class="step">
          <span class="text">{t.profile.cvPrompt}</span>
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? 'check' : 'copy'}
            label={copied ? t.profile.copied : t.profile.copyPrompt}
            testid="new-profile-copy"
            onclick={() => void copy()}
          />
        </li>
        <li class="step">
          <span class="text">{t.profile.cvAnswer}</span>
        </li>
      </ol>
      {#if manual}
        <Field label={t.profile.answerField} for="new-profile-answer">
          <TextArea
            id="new-profile-answer"
            bind:value={pasted}
            rows={4}
            testid="new-profile-answer"
          />
        </Field>
      {/if}
    {/if}
  </div>
</Dialog>

<style>
  .ways {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* The two steps, numbered like the list they are, under the chosen way. */
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding-left: var(--space-20);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .step {
    padding-left: var(--space-4);
  }

  .text {
    display: block;
    margin-bottom: var(--space-6);
  }

  .step:last-child .text {
    margin-bottom: 0;
  }
</style>
