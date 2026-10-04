<!--
  The languages: one row each with the language and its level, both selects in a row of
  fields (the common languages by their German names, as the engine reads them; the levels in
  plain words with their CEFR level), then "Sprache hinzufügen", whose menu lists the common
  languages not chosen yet; a new row starts at B2, the level the engine assumes. Without a
  language a blank row stands instead (its select says "Sprache wählen", with the amber
  edge while it is marked as missing): choosing a language makes it the first row. A language
  of the profile that is no common one (from the CV) stays as it is. The x of a row needs no
  tooltip; removing a row puts no caret anywhere (input.ts removeBy). A value the backend
  refused is said under the rows.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';
  import { removeBy } from '$lib/input/input';
  import { menuState, openMenu } from '$lib/state/menu.svelte';
  import type { Language, LanguageLevel } from '$lib/state/profile.svelte';

  interface Props {
    rows: Language[];
    /** Marked as missing: the blank row's select shows the amber edge. */
    missing?: boolean;
    /** A value the backend refused and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), missing = false, error = null }: Props = $props();

  const words = $derived(t.profile.field);
  const id = $props.id();
  /** The level a new language starts at (the one the engine assumes without one). */
  const ASSUMED: LanguageLevel = 'B2';
  const LEVELS = $derived(
    (Object.keys(t.profile.level) as LanguageLevel[]).map((level) => ({
      id: level,
      label: t.profile.level[level],
    })),
  );
  /** The common languages by their German names. */
  const COMMON: readonly string[] = Object.values(de.profile.languageName);

  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const chosen = (name: string): boolean => rows.some((row) => same(row.language, name));

  /** The choices of a row: its own language first if it is no common one. */
  const optionsOf = (row: Language): { id: string; label: string }[] => [
    ...(COMMON.some((name) => same(name, row.language))
      ? []
      : [{ id: row.language, label: row.language }]),
    ...COMMON.filter((name) => same(name, row.language) || !chosen(name)).map((name) => ({
      id: name,
      label: name,
    })),
  ];

  const remove = (row: Language): void => {
    rows = rows.filter((other) => other !== row);
  };

  let adder = $state<HTMLElement | null>(null);
  /** The level of the blank row, until its language makes it a row. */
  let blankLevel = $state<LanguageLevel>(ASSUMED);
  const BLANK = $derived(COMMON.map((name) => ({ id: name, label: name })));

  /** "Sprache hinzufügen": the common languages not chosen yet, a new row at B2. */
  function openAdd(event: MouseEvent): void {
    if (adder === null || menuState.open !== null) return;
    openMenu({
      label: words.addLanguage,
      anchor: { kind: 'below', rect: adder.getBoundingClientRect(), align: 'start' },
      fromKeyboard: event.detail === 0,
      entries: COMMON.filter((name) => !chosen(name)).map((name) => ({
        id: `language-${name}`,
        label: name,
        run: () => (rows = [...rows, { language: name, level: ASSUMED }]),
      })),
    });
  }
</script>

<div class="list" class:empty={rows.length === 0} data-testid="languages" data-removes>
  {#if rows.length === 0}
    <div class="row blank" data-testid="language-blank">
      <span class="select">
        <MenuButton
          options={BLANK}
          value=""
          placeholder={words.languagePlaceholder}
          {missing}
          menuLabel={words.language}
          field
          testid="language-name"
          onchange={(name) => (rows = [{ language: name, level: blankLevel }])}
        />
      </span>
      <span class="select">
        <MenuButton
          options={LEVELS}
          value={blankLevel}
          menuLabel={words.level}
          field
          testid="language-level"
          onchange={(next) => (blankLevel = next)}
        />
      </span>
    </div>
  {/if}
  {#each rows as row (row)}
    <div class="row" data-row data-testid="language-row">
      <span class="select">
        <MenuButton
          options={optionsOf(row)}
          value={row.language}
          menuLabel={words.language}
          field
          testid="language-name"
          onchange={(next) => (row.language = next)}
        />
      </span>
      <span class="select">
        <MenuButton
          options={LEVELS}
          value={row.level}
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
          label={words.removeLanguage(row.language)}
          testid="language-remove"
          onclick={(event) => removeBy(event.currentTarget, () => remove(row))}
        />
      </span>
    </div>
  {/each}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="language-error">{error.text}</p>
  {/if}
  {#if rows.length > 0}
    <span class="add" bind:this={adder} data-remove-fallback>
      <Button
        variant="ghost"
        icon="add"
        label={words.addLanguage}
        menu
        testid="language-add"
        onclick={openAdd}
      />
    </span>
  {/if}
</div>

<style>
  /* The quiet add row: its glyph on the fields' text. */
  .add {
    display: flex;
    margin-left: calc(-1 * var(--space-2));
  }

  /* language | level | remove in one grid for every row: the levels as wide as the widest
     of them, the languages take the rest; the blank row has nothing to remove. */
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content var(--control-field);
    align-items: center;
    gap: var(--space-6);
  }

  .list.empty {
    grid-template-columns: minmax(0, 1fr) max-content;
  }

  .row {
    display: contents;
  }

  .add,
  .error {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .select,
  .select > :global(.select) {
    display: flex;
    width: 100%;
    min-width: 0;
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
