<!--
  Kompetenzen, all counting the same: a box of entries (ItemList; the owner's redesign of
  2026-10-24), one row each with the competence's name (plain text to copy, decision 14:
  never edited in place), its years as quiet text at the right ("12 Jahre", a field 74 wide
  whose edge shows under the pointer or with the focus) and the × that removes it. The last
  row is "+ Kompetenz hinzufügen": a click turns it into a tag field that suggests the
  engine's words from the first character (vocabulary.svelte.ts); Enter takes what was typed
  as a new row (a pasted list splits at commas) and the field stays ready for the next, a
  name that is there already is not added twice. A new row rises in, a removed one folds
  away. A value that is too large (the years) or that the backend refused marks its row's
  field and is said under the add row; "Häufig verlangt" is the box's last line (not in the
  setup).
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import ItemList from '$components/ItemList.svelte';
  import { t } from '$lib/i18n/t';
  import { type Competence } from '$lib/state/profile.svelte';
  import AskedTerms from './AskedTerms.svelte';
  import NumberField from './NumberField.svelte';
  import { keyOf, named } from './rows';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    rows: Competence[];
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
    /** "Häufig verlangt" under the add row (not in the setup). */
    asked?: boolean;
  }

  let { rows = $bindable(), error = null, asked = false }: Props = $props();

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
      unit={words.years}
      inline
      invalid={row === refused}
      testid="competence-years"
    />
  </span>
{/snippet}

{#snippet add()}
  <ChipInput
    label={words.competencePlaceholder}
    bind:values={typed}
    placeholder={words.competencePlaceholder}
    suggestions={vocabulary.skills}
    testid="competence-add"
    onchange={take}
  />
{/snippet}

{#snippet foot()}
  {#if error}
    <p class="error" role="alert" data-testid="competence-error">{error.text}</p>
  {/if}
  {#if asked}<AskedTerms field="competence" home="competences-add" line />{/if}
{/snippet}

<ItemList
  items={named(rows, (row) => row.name)}
  key={(row) => keyOf(row.name)}
  name={(row) => row.name}
  value={years}
  addLabel={words.competencePlaceholder}
  {add}
  {foot}
  testid="competences"
  onremove={(row) => (rows = rows.filter((other) => other !== row))}
/>

<style>
  .years {
    display: flex;
    width: var(--profile-row-years);
  }

  /* Under the add row, on the rows' sides. */
  .error {
    padding: 0 var(--card-pad-x) var(--suggest-line-pad-y);
    color: var(--error-text);
    font: var(--type-sm);
  }
</style>
