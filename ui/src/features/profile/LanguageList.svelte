<!--
  The languages: over the rows the heads of their columns (Sprache, Niveau, like the
  competences), one row each with the language and its level (a menu of A1 to C2 and
  Muttersprache: a select in a row of fields, the level in a field as high as the others and
  the chevron's button beside it, in a column as wide as its longest level, so every row
  lines up), then "Sprache hinzufügen". A
  row without a level shows B2, the level the engine assumes then (matching's fit), and a
  new row starts at B2. The x of a row needs no tooltip. The language field suggests common languages like the countries field (found by their German and
  English names, taken in the app's language); any other language can be typed. A common
  language shows in the app's language (Englisch, English) and the profile keeps it under its
  German name, as the engine reads it (core matching::lexicon LANGUAGES); while the field has
  the focus it shows what was typed. Enter moves
  through the rows like in the competences (rows.ts) unless it takes a suggestion; it never
  saves. Removing a row puts no caret anywhere (input.ts removeBy): after a click the focus is
  dropped, from the keyboard it goes to the next row's x (the previous one after the last,
  "Sprache hinzufügen" once none is left). A value the backend refused marks its row.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import { folded } from '$components/Suggestions.svelte';
  import TextField from '$components/TextField.svelte';
  import { de } from '$lib/i18n/de';
  import { en } from '$lib/i18n/en';
  import { t } from '$lib/i18n/t';
  import { formKeys, removeBy } from '$lib/input/input';
  import type { LanguageLevel, ProfileLanguage } from '$lib/ipc/types';
  import { tick } from 'svelte';
  import { enterRow, focusRow } from './rows';

  interface Props {
    rows: ProfileLanguage[];
    /** A row the backend refused (its place among the rows with a language) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), error = null }: Props = $props();

  const words = $derived(t.profile.field);
  const id = $props.id();
  /** The level the engine assumes for a language without one (core matching's fit): a row
   *  without a level shows it, and a new row starts at it. */
  const ASSUMED: LanguageLevel = 'b2';
  const LEVELS = $derived(
    (Object.keys(t.profile.level) as LanguageLevel[]).map((level) => ({
      id: level,
      label: t.profile.level[level],
    })),
  );
  let list = $state<HTMLElement | null>(null);

  type LanguageCode = keyof typeof de.profile.languageName;
  const CODES = Object.keys(de.profile.languageName) as LanguageCode[];
  /** Common languages, named in the app's language and found by both names. */
  const LANGUAGES = $derived(
    CODES.map((code) => ({
      id: code,
      label: t.profile.languageName[code],
      terms: [de.profile.languageName[code], en.profile.languageName[code]],
    })),
  );

  /** The common language a name stands for (German or English, any case, with or without
   *  accents), else null. */
  function codeOf(name: string): LanguageCode | null {
    const key = folded(name);
    if (key === '') return null;
    return (
      CODES.find(
        (code) =>
          folded(de.profile.languageName[code]) === key ||
          folded(en.profile.languageName[code]) === key,
      ) ?? null
    );
  }

  /** A row's language as the field shows it: a common one in the app's language. */
  function shown(language: string): string {
    const code = codeOf(language);
    return code === null ? language : t.profile.languageName[code];
  }

  /** A typed language as the profile keeps it: a common one by its German name. */
  function kept(typed: string): string {
    const code = codeOf(typed);
    return code === null ? typed : de.profile.languageName[code];
  }

  /** What was typed into the focused language field (it shows as typed until it is left). */
  let typing = $state.raw<{ row: ProfileLanguage; text: string } | null>(null);

  function type(row: ProfileLanguage, text: string): void {
    typing = { row, text };
    row.language = kept(text);
  }

  const refused = $derived.by((): ProfileLanguage | null => {
    if (error === null || error.row === null) return null;
    return rows.filter((row) => row.language.trim() !== '')[error.row] ?? null;
  });

  const append = (): void => {
    rows = [...rows, { language: '', level: ASSUMED, origin: null }];
  };
  const remove = (row: ProfileLanguage): void => {
    rows = rows.filter((other) => other !== row);
  };

  async function add(): Promise<void> {
    append();
    await tick();
    focusRow(list, rows.length - 1);
  }

  const enter = (row: ProfileLanguage): void =>
    void enterRow({
      list,
      rows,
      row,
      blank: (r) => r.language.trim() === '',
      add: append,
      remove,
    });
</script>

<div class="list" bind:this={list} data-testid="languages" data-field="languages" data-removes>
  {#if rows.length > 0}
    <div class="head" aria-hidden="true">
      <span>{words.language}</span>
      <span>{words.level}</span>
      <span></span>
    </div>
  {/if}
  {#each rows as row (row)}
    <div class="row" data-row data-testid="language-row" use:formKeys={{ save: () => enter(row) }}>
      <span class="name" onfocusout={() => (typing = null)}>
        <TextField
          value={typing?.row === row ? typing.text : shown(row.language)}
          label={words.language}
          options={LANGUAGES}
          placeholder={rows.length === 1 ? words.languagePlaceholder : null}
          invalid={row === refused}
          describedby={row === refused ? `${id}-error` : null}
          testid="language-name"
          oninput={(text) => type(row, text)}
        />
      </span>
      <span class="level">
        <MenuButton
          options={LEVELS}
          value={row.level ?? ASSUMED}
          menuLabel={words.level}
          field
          testid="language-level"
          onchange={(next) => (row.level = next)}
        />
      </span>
      <span class="remove" data-remove>
        <Button
          variant="ghost"
          iconOnly
          icon="close"
          plain
          label={words.removeLanguage(shown(row.language).trim())}
          testid="language-remove"
          onclick={(event) => removeBy(event.currentTarget, () => remove(row))}
        />
      </span>
    </div>
  {/each}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="language-error">{error.text}</p>
  {/if}
  <span data-remove-fallback>
    <Button
      variant="secondary"
      icon="add"
      label={words.addLanguage}
      testid="language-add"
      onclick={() => void add()}
    />
  </span>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-8);
    container-type: inline-size;
  }

  /* language | level | remove: the level in one width in every row (its longest word fits),
     the button filling it; the language takes the rest. The heads stand over their columns
     like the competences' (13/500). */
  .head,
  .row {
    display: grid;
    grid-template-columns: minmax(var(--space-64), 1fr) var(--level-width) var(--control-field);
    align-items: center;
    gap: var(--space-6) var(--space-12);
    width: 100%;
  }

  .head {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  /* The level fills its column: the select's field, its chevron's button beside it. */
  .level,
  .level > :global(.select) {
    display: flex;
    width: 100%;
  }

  .remove {
    display: flex;
    align-items: center;
    height: var(--control-field);
  }

  .error {
    color: var(--danger-strong);
    font: var(--type-sm);
  }
</style>
