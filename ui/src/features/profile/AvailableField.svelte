<!--
  Verfügbar ab: one choice of the segments ("Offen", "Sofort", "Ab Datum"). The day of "Ab
  Datum" exists only while it is chosen and gets the caret when it is (it fades in beside the
  choice); it is judged when its field is left with text in it or on saving
  (`editor.judged`), never while it is typed, and a day that does not read is said once, at
  the field, and holds the save. A value of the file that does not read is said under it
  with "Wert entfernen".
-->
<script lang="ts">
  import Notice from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { fade } from '$lib/motion/transitions';
  import { dayShaped, editor, isoDate } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import ValueNote from './ValueNote.svelte';

  interface Props {
    /** A day the backend refused on the last save, in words. */
    refused: string | null;
    /** Values of the file that do not read. */
    notes: readonly { text: string; onremove: () => void }[];
  }

  let { refused, notes }: Props = $props();

  const id = $props.id();
  const words = $derived(t.profile.field);
  const c = $derived(editor.after.criteria);
  let date = $state<HTMLElement | null>(null);

  type Choice = 'open' | 'now' | 'from';
  const CHOICES = $derived<{ id: Choice; label: string }[]>([
    { id: 'open', label: words.open },
    { id: 'now', label: t.profile.availability.now },
    { id: 'from', label: t.profile.availability.from },
  ]);

  /** "Offen" is no availability. "Ab Datum" puts the caret into its day, which is judged
   *  anew when it is left. */
  async function choose(kind: Choice): Promise<void> {
    c.available =
      kind === 'from'
        ? { kind, date: isoDate(editor.dateText) ?? editor.dateText.trim() }
        : kind === 'now'
          ? { kind }
          : { kind: 'unset' };
    editor.judged = false;
    if (kind !== 'from') return;
    await tick();
    date?.querySelector('input')?.focus();
  }

  function type(text: string): void {
    editor.dateText = text;
    c.available = { kind: 'from', date: isoDate(text) ?? text.trim() };
    editor.judged = false;
  }

  const wrong = $derived(
    editor.judged && editor.dateInvalid
      ? dayShaped(editor.dateText)
        ? words.dateImpossible
        : words.dateInvalid
      : null,
  );
  const said = $derived(wrong ?? refused);
</script>

<div class="block" data-field="available">
  <span class="label">{words.available}</span>
  <div class="choice">
    <Segmented
      options={CHOICES}
      value={c.available.kind === 'unset' ? 'open' : c.available.kind}
      label={words.available}
      testid="profile-available"
      onchange={(kind) => void choose(kind)}
    />
    {#if c.available.kind === 'from'}
      <span
        class="date"
        role="presentation"
        in:fade
        bind:this={date}
        onfocusout={() => (editor.judged = editor.dateText.trim() !== '')}
      >
        <TextField
          value={editor.dateText}
          label={words.date}
          placeholder={words.datePlaceholder}
          invalid={said !== null}
          describedby={said !== null ? `${id}-message` : null}
          testid="profile-date"
          oninput={type}
        />
      </span>
    {/if}
  </div>
  {#if said !== null}
    <div id="{id}-message">
      <Notice
        tone="danger"
        variant="inline"
        text={said}
        testid={wrong !== null ? 'profile-date-error' : null}
      />
    </div>
  {/if}
  {#each notes as note (note.text)}
    <ValueNote text={note.text} testid="available-unread" onremove={note.onremove} />
  {/each}
</div>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* The label of a choice, like every control label of the form (13/500). */
  .label {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-12);
  }

  /* The day is as wide as every number field. */
  .date {
    width: calc(var(--stat-min) - var(--space-48));
  }
</style>
