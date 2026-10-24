<!--
  The core competences, all counting the same: an item list (ItemList; the round 10 draft),
  one row each with the competence's name (plain text to copy, decision 14: never edited in
  place), its years in a small field (44, 26 high) with "Jahre" after it, and the × that
  removes it. The last row adds one: a field without an edge that suggests the engine's words
  from the first character (vocabulary.svelte.ts); Enter or leaving the field takes what was
  typed (a pasted list splits at commas), a name that is there already is not added twice.
  A new row rises in, a removed one folds away. A value that is too large (the years) or
  that the backend refused marks its row's field and is said under the list.
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import ItemList from '$components/ItemList.svelte';
  import { t } from '$lib/i18n/t';
  import { type Competence } from '$lib/state/profile.svelte';
  import NumberField from './NumberField.svelte';
  import { keyOf, named } from './rows';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    rows: Competence[];
    /** The id of the add row's field, for the label of its Field. */
    id: string;
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), id, error = null }: Props = $props();

  const words = $derived(t.profile.field);
  vocabulary.load();

  /** The row the backend refused: counted among the rows with a name, as the backend does. */
  const refused = $derived.by((): Competence | null => {
    if (error === null || error.row === null) return null;
    return rows.filter((row) => row.name.trim() !== '')[error.row] ?? null;
  });

  const same = (a: string, b: string): boolean => keyOf(a) === keyOf(b);


  /** What the add row took: each name not there yet becomes a row. */
  let typed = $state<string[]>([]);
  function take(names: string[]): void {
    const fresh = names.filter((name) => !rows.some((row) => same(row.name, name)));
    if (fresh.length > 0) rows = [...rows, ...fresh.map((name) => ({ name, years: null }))];
    typed = [];
  }
</script>

{#snippet years(row: Competence)}
  <span class="years">
    <NumberField
      bind:value={row.years}
      label={words.yearsOf(row.name)}
      inline
      invalid={row === refused}
      testid="competence-years"
    />
  </span>
  {words.years}
{/snippet}

{#snippet add()}
  <ChipInput
    {id}
    bind:values={typed}
    placeholder={words.competencePlaceholder}
    suggestions={vocabulary.skills}
    bare
    testid="competence-add"
    onchange={take}
  />
{/snippet}

<ItemList
  items={named(rows, (row) => row.name)}
  key={(row) => keyOf(row.name)}
  name={(row) => row.name}
  value={years}
  {add}
  testid="competences"
  onremove={(row) => (rows = rows.filter((other) => other !== row))}
/>
{#if error}
  <p class="error" role="alert" data-testid="competence-error">{error.text}</p>
{/if}

<style>
  .years {
    display: flex;
    width: var(--profile-row-years);
  }

  .error {
    color: var(--error-text);
    font: var(--type-sm);
  }
</style>
