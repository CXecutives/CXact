<!--
  Verfügbar ab: one choice of the segments ("Offen", "Sofort", "Datum"; after the label they
  read "ab sofort", "ab Datum"). The day of "Datum" exists only while it is chosen and gets
  the caret when it is (it slides in beside the choice, as high as the choice and as wide as
  every number field); it is judged when its field is left with text in it or on saving
  (`editor.judged`), never while it is typed, and a day that does not read is said once, at
  the field, in the error line of every field (Field), and holds the save. A value of the
  file that does not read is said under it with "Wert entfernen". Inside the day's field at
  its right end a calendar offers one (Calendar), like a native date picker; typing stays
  the way to write it, and a chosen day is written into the field in its form.
-->
<script lang="ts">
  import Calendar from '$components/Calendar.svelte';
  import Icon from '$components/Icon.svelte';
  import Segmented from '$components/Segmented.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { slideIn } from '$lib/motion/transitions';
  import { dayShaped, editor, isoDate, shownDate } from '$lib/state/profile.svelte';
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

  /** "Offen" is no availability. "Datum" puts the caret into its day, which is judged
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
        in:slideIn
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
        >
          {#snippet trailing()}
            <Calendar
              value={isoDate(editor.dateText)}
              testid="profile-date-calendar"
              onpick={(day) => type(shownDate(day))}
            />
          {/snippet}
        </TextField>
      </span>
    {/if}
  </div>
  {#if said !== null}
    <div class="help">
      <p
        class="error"
        id="{id}-message"
        role="alert"
        data-testid={wrong !== null ? 'profile-date-error' : undefined}
      >
        <Icon name="warning" size="sm" />
        <span>{said}</span>
      </p>
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

  /* The day is as wide as every number field (NumberField), its calendar inside it. */
  .date {
    display: flex;
    width: calc(var(--stat-min) - var(--space-48));
  }

  /* The error line of every field (Field): as high as a link, the glyph on its first line, 6
     from the words. */
  .help {
    display: flex;
    align-items: center;
    min-height: var(--control-sm);
  }

  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    color: var(--danger-strong);
    font: var(--type-sm);
  }

  .error > :global(:first-child) {
    flex: none;
    margin-top: calc((var(--leading-sm) - var(--icon-sm)) / 2);
  }
</style>
