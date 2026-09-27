<!--
  A profile from a CV with an AI (a new one, or an update of the stored one), laid out like a
  section of the form: the heading on the first row of the window (`data-first-row`), 4 px
  under it one sentence on where the CV goes, the card 12 px below. In the card: the prompt
  is on the clipboard (or can be copied again; when copying
  failed the step says so in the danger tone and the button copies) and can be read before it
  is sent, one line on what to do in the AI, then the field for its answer. "Übernehmen"
  (waiting, and saying so, until there is an answer) reads the answer (also inside a code
  block) with the same checks as a file and fills the form for review; nothing is saved yet.
  The answer is the caller's (bound): "Abbrechen" closes the steps and keeps it.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Disclosure from '$components/Disclosure.svelte';
  import Field from '$components/Field.svelte';
  import Icon from '$components/Icon.svelte';
  import TextArea from '$components/TextArea.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import { primaryFirst } from '$lib/platform';

  interface Props {
    heading: string;
    /** The prompt as it goes to the AI (`null` while it loads). */
    prompt: string | null;
    /** The request is on the clipboard (false: copying failed). */
    copied: boolean;
    busy: boolean;
    error: string | null;
    /** The AI's answer as pasted. */
    answer: string;
    oncopy: () => void;
    ontake: (answer: string) => void;
    oncancel: () => void;
  }

  let {
    heading,
    prompt,
    copied,
    busy,
    error,
    answer = $bindable(),
    oncopy,
    ontake,
    oncancel,
  }: Props = $props();

  const words = $derived(t.profile.paste);
  const id = $props.id();
  const actionFirst = primaryFirst();

  function take(): void {
    if (answer.trim() !== '' && !busy) ontake(answer);
  }
</script>

<section class="section" aria-labelledby="{id}-heading" data-testid="profile-paste">
  <div class="head" data-first-row>
    <h2 class="heading" id="{id}-heading">{heading}</h2>
  </div>
  <p class="privacy" data-testid="paste-privacy">{words.privacy}</p>
  <Card padding="md">
    <div class="paste" use:formKeys={{ cancel: oncancel }}>
      <ol class="steps">
        <li class="step" data-testid="paste-copied">
          <span class="mark" class:done={copied} class:failed={!copied}>
            {#if copied}<Icon name="check" size="sm" />{:else}1{/if}
          </span>
          <span class="text">{copied ? words.copied : words.copyFailed}</span>
          <Button
            variant="ghost"
            size="sm"
            icon="prompt"
            label={copied ? words.copyAgain : words.copy}
            testid="paste-copy"
            onclick={oncopy}
          />
        </li>
        <li class="step">
          <span class="mark">2</span>
          <span class="text">{words.step}</span>
        </li>
      </ol>
      {#if prompt}
        <Disclosure label={words.preview} testid="paste-preview">
          <pre class="prompt" data-copy data-testid="paste-prompt">{prompt}</pre>
        </Disclosure>
      {/if}
      <Field label={words.answer} for="{id}-answer" {error}>
        <TextArea
          id="{id}-answer"
          bind:value={answer}
          rows={10}
          invalid={error !== null}
          testid="paste-answer"
        />
      </Field>
      <div class="actions">
        {#snippet cancel()}
          <Button
            variant="secondary"
            size="field"
            label={t.common.cancel}
            testid="paste-cancel"
            onclick={oncancel}
          />
        {/snippet}
        {#if !actionFirst}{@render cancel()}{/if}
        <Button
          variant="primary"
          size="field"
          label={words.take}
          loading={busy}
          disabled={answer.trim() === ''}
          disabledReason={words.takeEmpty}
          testid="paste-take"
          onclick={take}
        />
        {#if actionFirst}{@render cancel()}{/if}
      </div>
    </div>
  </Card>
</section>

<style>
  /* Like a section of the form (ProfileSection): heading, its sentence, the card 12 below. */
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* Centred on the first row of the window; what that row adds under the heading's line is
     taken back, so the sentence stands 4 px under it as under every heading of the form. */
  .head[data-first-row] {
    margin-bottom: calc((var(--leading-lg) - var(--first-row)) / 2);
  }

  .heading {
    color: var(--text-heading);
    font: var(--type-lg);
  }

  .privacy {
    margin-top: calc(-1 * var(--space-8));
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .paste {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .step {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-height: var(--control-sm);
    color: var(--text);
    font: var(--type-md);
  }

  /* The step marks of the first run: 28 px, 13 px digits, done with a green edge. */
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

  .mark.done {
    border-color: var(--success);
    background-color: var(--success-soft);
    color: var(--success-strong);
  }

  .mark.failed {
    border-color: var(--danger-strong);
    background-color: var(--danger-soft);
    color: var(--danger-strong);
  }

  /* The prompt as it goes out: its own lines, scrolled inside when long. */
  .prompt {
    max-height: calc(var(--control-md) * 8);
    overflow: auto;
    padding: var(--space-12);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background-color: var(--surface-muted);
    color: var(--text);
    font: var(--type-sm);
    white-space: pre-wrap;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-12);
  }
</style>
