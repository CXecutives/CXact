<!--
  The core competences: one row each with the star of a Schwerpunkt (outlined, filled while
  marked), the competence and its years at the right ("Jahre" as their placeholder), then
  the quiet row "Kompetenz hinzufügen". The star says what a click does (mark, or remove the Schwerpunkt).
  At most five: a sixth star is disabled and its tooltip says why, as does the star of a row
  without a competence. The x of a row needs no tooltip. Without a competence a blank field
  stands instead (coral while its cell is marked as missing, like every field in it): what
  is typed there becomes the first row. A value that is too large (the years) or that the backend refused
  marks its row. Enter goes to the next row, adds one after the last and ends the list on an
  empty last row (rows.ts); it never saves the profile. Removing a row puts no caret anywhere
  (input.ts removeBy): after a click the focus is dropped, from the keyboard it goes to the
  next row's x (the previous one after the last, "Kompetenz hinzufügen" once none is left).
  The competence suggests the engine's words while typing (vocabulary.svelte.ts). A long
  list shows its first eight rows and "Alle anzeigen (n)" beside the add row ("Weniger
  anzeigen" folds it again); adding a row or a refused row further down shows them all.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys, removeBy } from '$lib/input/input';
  import { MAX_FOCUS, type Competence } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import NumberField from './NumberField.svelte';
  import { enterRow, focusRow } from './rows';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    rows: Competence[];
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let { rows = $bindable(), error = null }: Props = $props();

  const words = $derived(t.profile.field);
  vocabulary.load();
  const id = $props.id();
  let list = $state<HTMLElement | null>(null);

  const stars = $derived(rows.filter((row) => row.focus && row.name.trim() !== '').length);

  /** The row the backend refused: counted among the rows with a name, as the backend does. */
  const refused = $derived.by((): Competence | null => {
    if (error === null || error.row === null) return null;
    return rows.filter((row) => row.name.trim() !== '')[error.row] ?? null;
  });

  function remove(row: Competence): void {
    rows = rows.filter((other) => other !== row);
  }

  /** Rows shown before "Alle anzeigen". */
  const FOLDED = 8;
  let unfolded = $state(false);
  const all = $derived(
    unfolded || rows.length <= FOLDED || (refused !== null && rows.indexOf(refused) >= FOLDED),
  );
  const shown = $derived(all ? rows : rows.slice(0, FOLDED));

  const append = (): void => {
    unfolded = true;
    rows = [...rows, { name: '', years: null, focus: false }];
  };

  async function add(): Promise<void> {
    append();
    await tick();
    focusRow(list, rows.length - 1);
  }

  /** The first letters typed into the blank field: they become the first row, which keeps
   *  the caret. */
  async function begin(text: string): Promise<void> {
    if (text === '') return;
    rows = [{ name: text, years: null, focus: false }];
    await tick();
    const input = list?.querySelector<HTMLInputElement>('[data-row] input');
    input?.focus();
    input?.setSelectionRange(text.length, text.length);
  }

  const blank = (row: Competence): boolean => row.name.trim() === '' && row.years === null;
  const enter = (row: Competence): void =>
    void enterRow({ list, rows, row, blank, add: append, remove });
</script>

<div class="list" bind:this={list} data-testid="competences" data-removes>
  {#if rows.length === 0}
    <span class="blank">
      <TextField
        value=""
        id="{id}-name-0"
        label={words.competence}
        placeholder={words.competencePlaceholder}
        testid="competence-blank"
        oninput={(text) => void begin(text)}
      />
    </span>
  {/if}
  {#each shown as row, index (row)}
    {@const wrong = row === refused}
    {@const named = row.name.trim() !== ''}
    <div
      class="row"
      data-row
      data-testid="competence-row"
      use:formKeys={{ save: () => enter(row) }}
    >
      <!-- Its words follow its state. -->
      <span class="star">
        <Button
          variant="ghost"
          iconOnly
          icon="star"
          label={row.focus && named ? words.unstar : words.star}
          pressed={row.focus && named}
          disabled={!named || (!row.focus && stars >= MAX_FOCUS)}
          disabledReason={!named ? words.starEmpty : words.focusFull}
          testid="competence-star"
          onclick={() => (row.focus = !row.focus)}
        />
      </span>
      <span class="name">
        <TextField
          bind:value={row.name}
          id="{id}-name-{index}"
          label={words.competence}
          placeholder={rows.length === 1 ? words.competencePlaceholder : null}
          invalid={wrong}
          describedby={wrong ? `${id}-error` : null}
          suggestions={vocabulary.skills}
          testid="competence-name"
        />
      </span>
      <span class="years">
        <NumberField
          bind:value={row.years}
          label={words.years}
          placeholder={words.years}
          invalid={wrong}
          testid="competence-years"
        />
      </span>
      <span class="remove" data-remove>
        <Button
          variant="ghost"
          iconOnly
          icon="close"
          plain
          label={words.removeCompetence(row.name.trim())}
          testid="competence-remove"
          onclick={(event) => removeBy(event.currentTarget, () => remove(row))}
        />
      </span>
    </div>
  {/each}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="competence-error">{error.text}</p>
  {/if}
  {#if rows.length > 0}
    <span class="add indent" data-remove-fallback>
      <Button
        variant="ghost"
        icon="add"
        label={words.addCompetence}
        testid="competence-add"
        onclick={() => void add()}
      />
      {#if rows.length > FOLDED}
        <Button
          variant="ghost"
          label={all ? words.showLess : words.showAll(rows.length)}
          testid="competence-fold"
          onclick={() => (unfolded = !all)}
        />
      {/if}
    </span>
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* star | competence | years | remove */
  .row {
    display: grid;
    grid-template-columns: var(--control-field) minmax(0, 1fr) var(--years-width) var(
        --control-field
      );
    align-items: start;
    gap: var(--space-6);
  }

  .blank {
    display: flex;
  }

  .star,
  .remove {
    display: flex;
    align-items: center;
    height: var(--control-field);
  }

  /* Under the rows the quiet add row and an error line up with the competence column (the
     add's glyph on the names' text). */
  .add.indent {
    display: flex;
    justify-content: space-between;
    margin-left: calc(var(--control-field) + var(--space-6) - var(--space-2));
  }

  .error {
    margin-left: calc(var(--control-field) + var(--space-6));
  }

  .error {
    color: var(--danger-strong);
    font: var(--type-sm);
  }
</style>
