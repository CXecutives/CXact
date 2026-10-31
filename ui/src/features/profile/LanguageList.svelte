<!--
  Sprachen: rows like every field (ItemList; owner, 2026-10-29), one each with the language's
  name as its label, its level in a select like Arbeitsmodell's (A1 to C2 and Muttersprache,
  as ads and CVs name them; stored as shown) and the × that removes it. The last row is the
  button "Sprache hinzufügen", which brings a name field (ChipInput with options): it opens
  nothing on focus, typing lists the languages the app knows and not chosen yet, and it takes
  nothing else ("Keine Sprache mit diesem Namen."); a new language starts at B2, the level the
  engine assumes. A language the backend refused marks its row's select and is said under it,
  a refusal of the whole list under the add row.
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import ItemList from '$components/ItemList.svelte';
  import Select from '$components/Select.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';
  import type { Language, LanguageLevel } from '$lib/state/profile.svelte';
  import { keyOf, named } from './rows';

  interface Props {
    rows: Language[];
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), error = null }: Props = $props();

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

  const listed = $derived(named(rows, (row) => row.language));
  /** The row the backend refused: counted among the rows with a name, as the backend does. */
  const refused = $derived(
    error === null || error.row === null ? null : (listed[error.row] ?? null),
  );

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
  <span class="level">
    <Select
      options={LEVELS}
      value={row.level}
      label={words.levelOf(row.language)}
      wide
      invalid={row === refused}
      testid="language-level"
      onchange={(next) => (row.level = next)}
    />
  </span>
{/snippet}

{#snippet draft()}
  <ChipInput
    label={words.language}
    bind:values={typed}
    options={OPTIONS.filter((option) => !chosen(option.id))}
    noMatch={words.languageNone}
    placeholder={words.language}
    testid="language-add"
    onchange={take}
  />
{/snippet}

<ItemList
  items={listed}
  key={(row) => keyOf(row.language)}
  name={(row) => row.language}
  value={level}
  addLabel={words.languageAdd}
  {draft}
  failure={error === null ? null : { item: refused, text: error.text }}
  testid="languages"
  onremove={(row) => (rows = rows.filter((other) => other !== row))}
/>

<style>
  .level {
    display: flex;
    width: var(--profile-control-width);
  }
</style>
