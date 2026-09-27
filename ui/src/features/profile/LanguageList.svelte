<!--
  The languages: one row each with the language and its level (a menu of A1 to C2 and
  Muttersprache, "Offen" while none is chosen; the app then assumes B2: a button in a row of
  fields, so as high as the field and like a select, in a column as wide as its longest
  level, so every row lines up), then "Sprache hinzufügen". The x of a row needs no tooltip.
  The language
  field suggests common languages like the countries field (found by their German and
  English names, taken in the app's language); any other language can be typed. Enter moves
  through the rows like in the competences (rows.ts) unless it takes a suggestion; it never
  saves. A value the backend refused marks its row.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import TextField from '$components/TextField.svelte';
  import { de } from '$lib/i18n/de';
  import { en } from '$lib/i18n/en';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { LanguageLevel, ProfileLanguage } from '$lib/ipc/types';
  import { tick } from 'svelte';
  import { enterRow, focusAfterRemove, focusRow } from './rows';

  interface Props {
    rows: ProfileLanguage[];
    /** A row the backend refused (its place among the rows with a language) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), error = null }: Props = $props();

  const words = $derived(t.profile.field);
  const id = $props.id();
  /** The id of the level of a row without one. */
  const NONE = 'none';
  const LEVELS = $derived([
    { id: NONE, label: words.open },
    ...(Object.keys(t.profile.level) as LanguageLevel[]).map((level) => ({
      id: level,
      label: t.profile.level[level],
    })),
  ]);
  let list = $state<HTMLElement | null>(null);

  type LanguageCode = keyof typeof de.profile.languageName;
  /** Common languages, named in the app's language and found by both names. */
  const LANGUAGES = $derived(
    (Object.keys(de.profile.languageName) as LanguageCode[]).map((code) => ({
      id: code,
      label: t.profile.languageName[code],
      terms: [de.profile.languageName[code], en.profile.languageName[code]],
    })),
  );

  const refused = $derived.by((): ProfileLanguage | null => {
    if (error === null || error.row === null) return null;
    return rows.filter((row) => row.language.trim() !== '')[error.row] ?? null;
  });

  const append = (): void => {
    rows = [...rows, { language: '', level: null, origin: null }];
  };
  const remove = (row: ProfileLanguage): void => {
    rows = rows.filter((other) => other !== row);
  };

  /** The x of a row: the focus it had goes to the next row (rows.ts). */
  function removeByButton(row: ProfileLanguage, event: MouseEvent): void {
    const focused = event.currentTarget === document.activeElement;
    const index = rows.indexOf(row);
    remove(row);
    if (focused) void focusAfterRemove(list, index, 'language-add');
  }

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
      blank: (r) => r.language.trim() === '' && r.level === null,
      add: append,
      remove,
    });
</script>

<div class="list" bind:this={list} data-testid="languages" data-field="languages">
  {#each rows as row (row)}
    <div class="row" data-row data-testid="language-row" use:formKeys={{ save: () => enter(row) }}>
      <span class="name">
        <TextField
          bind:value={row.language}
          label={words.language}
          options={LANGUAGES}
          placeholder={rows.length === 1 ? words.languagePlaceholder : null}
          invalid={row === refused}
          describedby={row === refused ? `${id}-error` : null}
          testid="language-name"
        />
      </span>
      <span class="level">
        <MenuButton
          options={LEVELS}
          value={row.level ?? NONE}
          menuLabel={words.level}
          field
          testid="language-level"
          onchange={(next) => (row.level = next === NONE ? null : (next as LanguageLevel))}
        />
      </span>
      <span class="remove">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          plain
          label={words.removeLanguage(row.language.trim())}
          testid="language-remove"
          onclick={(event) => removeByButton(row, event)}
        />
      </span>
    </div>
  {/each}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="language-error">{error.text}</p>
  {/if}
  <Button
    variant="secondary"
    size="sm"
    icon="add"
    label={words.addLanguage}
    testid="language-add"
    onclick={() => void add()}
  />
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
     the button filling it; the language takes the rest. */
  .row {
    display: grid;
    grid-template-columns: minmax(var(--space-64), 1fr) var(--level-width) var(--control-sm);
    align-items: center;
    gap: var(--space-6) var(--space-12);
    width: 100%;
  }

  .level,
  .level > :global(.menu-button),
  .level :global(.btn) {
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
