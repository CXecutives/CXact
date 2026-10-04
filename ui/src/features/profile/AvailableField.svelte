<!--
  Verfügbar ab: one choice of the segments ("Sofort", "Datum"; after the label they read "ab
  sofort", "ab Datum"). The day of "Datum" exists only while it is chosen and gets the caret
  when it is (it slides in beside the choice, as high as the choice and as wide as every
  number field); it is judged when its field is left with text in it or on saving
  (`editor.judged`), never while it is typed, and a day that does not read is said by its
  Field and holds the save. Beside the day's field a calendar offers one (Calendar); typing
  stays the way to write it, and a chosen day is written into the field in its form.
-->
<script lang="ts">
  import Calendar from '$components/Calendar.svelte';
  import Segmented from '$components/Segmented.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { slideIn } from '$lib/motion/transitions';
  import { editor, isoDate, keptDate, shownDate } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';

  interface Props {
    /** The day is said to be wrong (its Field says why). */
    invalid: boolean;
  }

  let { invalid }: Props = $props();

  const words = $derived(t.profile.field);
  const form = $derived(editor.after);
  let date = $state<HTMLElement | null>(null);

  type Choice = 'now' | 'from';
  const CHOICES = $derived<{ id: Choice; label: string }[]>([
    { id: 'now', label: t.profile.availability.now },
    { id: 'from', label: t.profile.availability.from },
  ]);

  /** "Datum" puts the caret into its day, which is judged anew when it is left. */
  async function choose(kind: Choice): Promise<void> {
    form.available = kind === 'from' ? { kind, date: keptDate(editor.dateText) } : { kind };
    editor.judged = false;
    if (kind !== 'from') return;
    await tick();
    date?.querySelector('input')?.focus();
  }

  function type(text: string): void {
    editor.dateText = text;
    form.available = { kind: 'from', date: keptDate(text) };
    editor.judged = false;
  }
</script>

<div class="choice">
  <Segmented
    options={CHOICES}
    value={form.available.kind}
    label={words.available}
    testid="profile-available"
    onchange={(kind) => void choose(kind)}
  />
  {#if form.available.kind === 'from'}
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
        {invalid}
        testid="profile-date"
        oninput={type}
      />
      <Calendar
        value={isoDate(editor.dateText)}
        testid="profile-date-calendar"
        onpick={(day) => type(shownDate(day))}
      />
    </span>
  {/if}
</div>

<style>
  .choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

  /* The day is as wide as every number field (NumberField), its calendar beside it. */
  .date {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .date > :global(:first-child) {
    width: var(--number-width);
  }
</style>
