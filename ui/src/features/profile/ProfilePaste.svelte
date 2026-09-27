<!--
  A profile from a CV with an AI (a new one, or an update of the stored one), in a dialog over
  the view: one sentence on where the CV goes, then three numbered steps. 1: "Prompt
  kopieren" copies the prompt (the button says "Kopiert" for a moment; when copying fails a
  line says so) and "Prompt ansehen" shows it before it goes out. 2: what to do in the AI
  chat. 3: the field for the AI's answer with "Aus Zwischenablage einfügen" (the backend reads
  the clipboard; where the platform refuses, pasting into the field works as ever). As soon
  as the answer reads (also inside a code block, with the checks of a file) the dialog says
  what it brings into the form (an update only fills gaps and adds); an answer that does not
  read says why in one line under the field. "Übernehmen" fills the form for review, nothing
  is saved yet; "Abbrechen" and Esc close the steps and keep the answer (the caller's, bound).
  The caret starts on the copy button, or in the field while it holds an answer.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Dialog from '$components/Dialog.svelte';
  import Disclosure from '$components/Disclosure.svelte';
  import Field from '$components/Field.svelte';
  import Notice from '$components/Notice.svelte';
  import TextArea from '$components/TextArea.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { clipboardText, invoke } from '$lib/ipc/api';
  import type { ProfileDraft, ProfileForm } from '$lib/ipc/types';
  import { emptyForm, updated } from '$lib/state/profile.svelte';
  import { untrack } from 'svelte';
  import { answerAdds } from './answer';

  interface Props {
    open: boolean;
    heading: string;
    /** The answer updates the stored profile (`stored`), else it makes a new one. */
    update: boolean;
    stored: ProfileForm | null;
    /** The prompt as it goes to the AI (`null` while it loads). */
    prompt: string | null;
    /** The AI's answer as pasted. */
    answer: string;
    ontake: (draft: ProfileDraft) => void;
    oncancel: () => void;
  }

  let {
    open,
    heading,
    update,
    stored,
    prompt,
    answer = $bindable(),
    ontake,
    oncancel,
  }: Props = $props();

  const words = $derived(t.profile.paste);
  const id = $props.id();
  /** How long "Kopiert" stands on the button. */
  const COPIED_MS = 2000;
  /** A pause in typing before the answer is read. */
  const READ_AFTER_MS = 250;

  let copied = $state(false);
  let copyFailed = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  /** The answer as read, and why it does not read (said when it shows). */
  let draft = $state.raw<ProfileDraft | null>(null);
  let error = $state<(() => string) | null>(null);
  let taking = $state(false);
  /** Only the newest reading counts. */
  let reading = 0;

  async function copy(): Promise<void> {
    clearTimeout(copiedTimer);
    try {
      const text = prompt ?? (await invoke('profile_prompt', { update }));
      await navigator.clipboard.writeText(text);
      copyFailed = false;
      copied = true;
      copiedTimer = setTimeout(() => (copied = false), COPIED_MS);
    } catch {
      copied = false;
      copyFailed = true;
    }
  }

  /** Reads the answer; `null` when it does not read (the line under the field says why). */
  async function read(text: string): Promise<ProfileDraft | null> {
    const turn = ++reading;
    try {
      const found = await invoke('parse_profile', { text, update });
      if (turn === reading) {
        draft = found;
        error = null;
      }
      return found;
    } catch (failure) {
      if (turn === reading) {
        draft = null;
        error = () => errorText(failure);
      }
      return null;
    }
  }

  // The answer is read a moment after it changes (a paste, typing), while the steps are open.
  $effect(() => {
    const text = answer.trim();
    if (!open) return;
    untrack(() => {
      reading += 1;
      draft = null;
      error = null;
    });
    if (text === '') return;
    const timer = setTimeout(() => void read(answer), READ_AFTER_MS);
    return () => clearTimeout(timer);
  });

  /** What the answer brings into the form. */
  const summary = $derived.by(() => {
    if (draft === null) return null;
    const own = update && stored !== null ? $state.snapshot(stored) : null;
    const base = own ?? emptyForm();
    const after = own !== null ? updated(own, draft.form) : draft.form;
    return words.summary(answerAdds(base, after), own !== null);
  });

  async function pasteClipboard(): Promise<void> {
    const text = await clipboardText();
    if (text !== null && text.trim() !== '') answer = text;
    else document.getElementById(`${id}-answer`)?.focus();
  }

  /** "Übernehmen": the answer as read (read now if it has not been yet). */
  async function take(): Promise<void> {
    if (answer.trim() === '') {
      error = () => words.takeEmpty;
      return;
    }
    taking = true;
    try {
      const found = draft ?? (await read(answer));
      if (found !== null) ontake(found);
    } finally {
      taking = false;
    }
  }

  // The dialog has just taken the focus for its own button: the caret goes to the first
  // step, or to the answer held from before.
  $effect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const target = untrack(() => answer.trim()) === '' ? 'paste-copy' : 'paste-answer';
      document.querySelector<HTMLElement>(`[data-testid="${target}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<Dialog
  {open}
  {heading}
  text={words.privacy}
  confirmLabel={words.take}
  busy={taking}
  testid="profile-paste"
  onconfirm={() => void take()}
  {oncancel}
>
  <ol class="steps">
    <li class="step">
      <span class="mark">1</span>
      <div class="body">
        <div class="line">
          <Button
            variant="secondary"
            size="field"
            icon={copied ? 'check' : 'prompt'}
            label={copied ? words.copied : words.copy}
            testid="paste-copy"
            onclick={() => void copy()}
          />
        </div>
        {#if copyFailed}
          <Notice
            tone="danger"
            variant="inline"
            text={words.copyFailed}
            testid="paste-copy-failed"
          />
        {/if}
        {#if prompt}
          <Disclosure label={words.preview} testid="paste-preview">
            <pre class="prompt" data-copy data-testid="paste-prompt">{prompt}</pre>
          </Disclosure>
        {/if}
      </div>
    </li>
    <li class="step">
      <span class="mark">2</span>
      <p class="text" data-testid="paste-step">{words.step}</p>
    </li>
    <li class="step">
      <span class="mark">3</span>
      <div class="body">
        <Field label={words.answer} for="{id}-answer" error={error?.() ?? null}>
          <TextArea
            id="{id}-answer"
            bind:value={answer}
            rows={6}
            invalid={error !== null}
            testid="paste-answer"
          />
        </Field>
        <div class="line quiet">
          <Button
            variant="ghost"
            size="sm"
            icon="paste"
            label={words.fromClipboard}
            testid="paste-clipboard"
            onclick={() => void pasteClipboard()}
          />
        </div>
        {#if summary !== null}
          <p class="summary" data-testid="paste-summary">{summary}</p>
        {/if}
      </div>
    </li>
  </ol>
</Dialog>

<style>
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: var(--space-12);
    color: var(--text);
    font: var(--type-md);
  }

  /* The step marks of the first run: 28 px, 13 px digits. */
  .mark {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--control-sm);
    height: var(--control-sm);
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-semibold);
    font-variant-numeric: var(--numeric);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
  }

  .line {
    display: flex;
  }

  /* The quiet button's glyph starts on the field's edge. */
  .quiet {
    margin-left: calc(-1 * var(--ghost-inset));
  }

  /* The sentence stands on the middle of its mark. */
  .text {
    padding-top: calc((var(--control-sm) - var(--leading-md)) / 2);
  }

  /* The prompt as it goes out: its own lines, scrolled inside when long. */
  .prompt {
    max-height: calc(var(--control-md) * 6);
    overflow: auto;
    padding: var(--space-12);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background-color: var(--surface-muted);
    color: var(--text);
    font: var(--type-sm);
    white-space: pre-wrap;
  }

  .summary {
    color: var(--text-muted);
    font: var(--type-sm);
  }
</style>
