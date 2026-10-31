<!--
  Kompetenzen, all counting the same: rows like every field (ItemList; owner, 2026-10-29), one
  each with the competence's name as its label (plain text to copy, decision 14: never edited
  in place), its years in the field of Berufserfahrung ("12 Jahre") and the × that removes it.
  The last row is the button "Kompetenz hinzufügen", which brings a name field that suggests
  the engine's words from the first character (vocabulary.svelte.ts); Enter takes what was
  typed as a new row (a pasted list splits at commas) and the field stays ready for the next,
  a name that is there already is not added twice. A new row rises in, a removed one folds
  away. A value that is too large (the years) or that the backend refused marks its row's
  field and is said under it.
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
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), error = null }: Props = $props();

  const words = $derived(t.profile.field);
  vocabulary.load();

  const listed = $derived(named(rows, (row) => row.name));
  /** The row the backend refused: counted among the rows with a name, as the backend does. */
  const refused = $derived(
    error === null || error.row === null ? null : (listed[error.row] ?? null),
  );

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
  <NumberField
    bind:value={row.years}
    label={words.yearsOf(row.name)}
    unit={t.profile.unitOf('years', row.years)}
    invalid={row === refused}
    testid="competence-years"
  />
{/snippet}

{#snippet draft()}
  <ChipInput
    label={words.competence}
    bind:values={typed}
    placeholder={words.competence}
    suggestions={vocabulary.skills}
    testid="competence-add"
    onchange={take}
  />
{/snippet}

<ItemList
  items={listed}
  key={(row) => keyOf(row.name)}
  name={(row) => row.name}
  value={years}
  addLabel={words.competenceAdd}
  {draft}
  failure={error === null ? null : { item: refused, text: error.text }}
  testid="competences"
  onremove={(row) => (rows = rows.filter((other) => other !== row))}
/>
