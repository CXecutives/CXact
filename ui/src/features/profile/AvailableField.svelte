<!--
  Verfügbar: one choice of a select ("Sofort", "Ab Datum"). The day of "Ab Datum" exists
  only while it is chosen: it slides in beside the choice (122
  wide, TT.MM.JJJJ, no calendar: typing is the way to write it), and the choice keeps its
  width and place. It is judged when its field is left with text in it or on saving
  (`editor.judged`), never while it is typed, and a day that does not read is said by its
  Field and holds the save.
-->
<script lang="ts">
  import Select from '$components/Select.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { slideIn } from '$lib/motion/transitions';
  import { editor, keptDate } from '$lib/state/profile.svelte';

  interface Props {
    /** The day is said to be wrong (its Field says why). */
    invalid: boolean;
  }

  let { invalid }: Props = $props();

  const words = $derived(t.profile.field);
  const form = $derived(editor.after);

  type Choice = 'now' | 'from';
  const CHOICES = $derived<{ id: Choice; label: string }[]>([
    { id: 'now', label: t.profile.availability.now },
    { id: 'from', label: t.profile.availability.from },
  ]);

  /** "Ab Datum" brings its day, which is judged anew when it is left. */
  function choose(kind: Choice): void {
    form.available = kind === 'from' ? { kind, date: keptDate(editor.dateText) } : { kind };
    editor.judged = false;
  }

  function type(text: string): void {
    editor.dateText = text;
    form.available = { kind: 'from', date: keptDate(text) };
    editor.judged = false;
  }
</script>

<div class="choice">
  <span class="short">
    <Select
      options={CHOICES}
      value={form.available.kind}
      label={words.available}
      wide
      testid="profile-available"
      onchange={choose}
    />
  </span>
  {#if form.available.kind === 'from'}
    <span
      class="date"
      role="presentation"
      in:slideIn
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

  .short {
    display: flex;
    width: var(--profile-control-width);
  }

  /* The choice keeps its width; the day beside it, or under it where the row is
     short. */
  .date {
    display: flex;
    width: var(--profile-date-width);
  }
</style>
