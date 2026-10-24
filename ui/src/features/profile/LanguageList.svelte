<!--
  Sprachen: a box of entries (ItemList; the owner's redesign of 2026-10-24), one row each with
  the language's name, its level as a quiet select at the right (Select `inline`: A1 to C2
  and Muttersprache, as ads and CVs name them; stored as shown) and the × that removes it.
  The last row is "+ Sprache hinzufügen": a click turns it into a search list (ChipInput with
  options) that lists every language the app knows and is not chosen yet, narrows while
  typing and takes nothing else ("Keine Sprache mit diesem Namen."); a new language starts at
  B2, the level the engine assumes. A value the backend refused is said under the add row;
  "Häufig verlangt" is the box's last line (not in the setup).
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import ItemList from '$components/ItemList.svelte';
  import Select from '$components/Select.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';
  import type { Language, LanguageLevel } from '$lib/state/profile.svelte';
  import AskedTerms from './AskedTerms.svelte';
  import { keyOf, named } from './rows';

  interface Props {
    rows: Language[];
    /** A value the backend refused and why. */
    error?: { row: number | null; text: string } | null;
    /** "Häufig verlangt" under the add row (not in the setup). */
    asked?: boolean;
  }

  let { rows = $bindable(), error = null, asked = false }: Props = $props();

  const words = $derived(t.profile.field);
  /** The level a new language starts at (the one the engine assumes without one). */
  const ASSUMED: LanguageLevel = 'B2';
  const LEVELS = $derived(
    (Object.keys(t.profile.level) as LanguageLevel[]).map((level) => ({
      id: level,
      label: t.profile.level[level],
    })),
  );
  /** Every language the app knows by its German name. */
  const OPTIONS = Object.values(de.profile.languageName)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ id: name, label: name }));

  const same = (a: string, b: string): boolean => keyOf(a) === keyOf(b);
  const chosen = (name: string): boolean => rows.some((row) => same(row.language, name));

  /** What the add row took: each language not there yet becomes a row at B2. */
  let typed = $state<string[]>([]);
  function take(names: string[]): void {
    const fresh = names.filter((name) => !chosen(name));
    if (fresh.length > 0) {
      rows = [...rows, ...fresh.map((language) => ({ language, level: ASSUMED }))];
    }
    typed = [];
  }
</script>

{#snippet level(row: Language)}
  <Select
    options={LEVELS}
    value={row.level}
    label={words.levelOf(row.language)}
    inline
    testid="language-level"
    onchange={(next) => (row.level = next)}
  />
{/snippet}

{#snippet add()}
  <ChipInput
    label={words.languagePlaceholder}
    bind:values={typed}
    options={OPTIONS.filter((option) => !chosen(option.id))}
    noMatch={words.languageNone}
    placeholder={words.languagePlaceholder}
    testid="language-add"
    onchange={take}
  />
{/snippet}

{#snippet foot()}
  {#if error}
    <p class="error" role="alert" data-testid="language-error">{error.text}</p>
  {/if}
  {#if asked}<AskedTerms field="language" home="languages-add" line />{/if}
{/snippet}

<ItemList
  items={named(rows, (row) => row.language)}
  key={(row) => keyOf(row.language)}
  name={(row) => row.language}
  value={level}
  addLabel={words.languagePlaceholder}
  {add}
  {foot}
  testid="languages"
  onremove={(row) => (rows = rows.filter((other) => other !== row))}
/>

<style>
  /* Under the add row, on the rows' sides. */
  .error {
    padding: 0 var(--card-pad-x) var(--suggest-line-pad-y);
    color: var(--error-text);
    font: var(--type-sm);
  }
</style>
