<!--
  The core competences: one row each with the marker of a Schwerpunkt (the star, outlined,
  filled while marked), the competence, its years and its synonyms (one line with "+n" for
  those that do not fit), then "Kompetenz hinzufügen". The marker says what a click does
  (mark, or remove the Schwerpunkt); the count stands over the markers ("2/5") and a line
  under the rows says what they do. At most five: a sixth marker is disabled and its tooltip
  says why, as does the marker of a row without a competence. The x of a row needs no
  tooltip, and no field repeats its column's name as a placeholder. Renaming or removing a
  marked competence takes its Schwerpunkt along. A file with more Schwerpunkte says under the
  rows that the first five were taken; one that does not count (no competence of that name)
  or a value that does not read is said there with "Wert entfernen". A value that is too large
  (the years) or that the backend refused marks its row. Enter goes to the
  next row, adds one after the last and ends the list on an empty last row (rows.ts); it
  never saves the profile. A row's focused x hands the focus to the next row (rows.ts). The
  competence and its synonyms suggest the engine's words while typing (vocabulary.svelte.ts).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import TextField from '$components/TextField.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ProfileCompetence } from '$lib/ipc/types';
  import { MAX_FOCUS, type FieldProblem } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import NumberField from './NumberField.svelte';
  import { enterRow, focusAfterRemove, focusRow } from './rows';
  import ValueNote from './ValueNote.svelte';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    rows: ProfileCompetence[];
    focus: string[];
    /** Schwerpunkte of the file that do not count, or a value that does not read. */
    problems?: readonly FieldProblem[];
    /** How many Schwerpunkte the file named when more than five were taken over. */
    trimmed?: number | null;
    /** "Wert entfernen" of a value of `schwerpunkte` that does not read. */
    onclear?: () => void;
    /** A row the backend refused (its place among the rows with a name) and why. */
    error?: { row: number | null; text: string } | null;
  }

  let {
    rows = $bindable(),
    focus = $bindable(),
    problems = [],
    trimmed = null,
    onclear,
    error = null,
  }: Props = $props();

  const words = $derived(t.profile.field);
  vocabulary.load();
  const id = $props.id();
  let list = $state<HTMLElement | null>(null);

  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const starred = (name: string): boolean =>
    name.trim() !== '' && focus.some((entry) => same(entry, name));

  /** The row the backend refused: counted among the rows with a name, as the backend does. */
  const refused = $derived.by((): ProfileCompetence | null => {
    if (error === null || error.row === null) return null;
    return rows.filter((row) => row.name.trim() !== '')[error.row] ?? null;
  });

  function star(row: ProfileCompetence): void {
    const name = row.name.trim();
    if (name === '') return;
    if (starred(name)) {
      focus = focus.filter((entry) => !same(entry, name));
    } else if (focus.length < MAX_FOCUS) {
      focus = [...focus, name];
    }
  }

  function rename(row: ProfileCompetence, next: string): void {
    const old = row.name;
    row.name = next;
    if (!starred(old)) return;
    focus = focus
      .map((entry) => (same(entry, old) ? next.trim() : entry))
      .filter((entry) => entry !== '');
  }

  function remove(row: ProfileCompetence): void {
    const name = row.name;
    rows = rows.filter((other) => other !== row);
    if (starred(name)) focus = focus.filter((entry) => !same(entry, name));
  }

  /** The x of a row: the focus it had goes to the next row. */
  function removeByButton(row: ProfileCompetence, event: MouseEvent): void {
    const focused = event.currentTarget === document.activeElement;
    const index = rows.indexOf(row);
    remove(row);
    if (focused) void focusAfterRemove(list, index, 'competence-add');
  }

  const append = (): void => {
    rows = [...rows, { name: '', years: null, aliases: [], origin: null }];
  };

  async function add(): Promise<void> {
    append();
    await tick();
    focusRow(list, rows.length - 1);
  }

  const blank = (row: ProfileCompetence): boolean =>
    row.name.trim() === '' && row.years === null && row.aliases.length === 0;
  const enter = (row: ProfileCompetence): void =>
    void enterRow({ list, rows, row, blank, add: append, remove });

  /** "Wert entfernen" of one Schwerpunkt: it goes from the list at once. */
  function drop(problem: FieldProblem): void {
    if (problem.entry) focus = focus.filter((entry) => !same(entry, problem.value));
    else onclear?.();
  }
</script>

<div class="list" bind:this={list} data-testid="competences" data-field="competences">
  {#if rows.length > 0}
    <div class="head" aria-hidden="true">
      <span class="count" data-testid="focus-count">
        {words.focusCount(focus.length, MAX_FOCUS)}
      </span>
      <span>{words.competence}</span>
      <span>{words.years}</span>
      <span class="aliases-head">{words.aliases}</span>
      <span></span>
    </div>
  {/if}
  {#each rows as row, index (row)}
    {@const wrong = row === refused}
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
          size="sm"
          iconOnly
          icon="star"
          label={starred(row.name) ? words.unstar : words.star}
          pressed={starred(row.name)}
          disabled={row.name.trim() === '' || (!starred(row.name) && focus.length >= MAX_FOCUS)}
          disabledReason={row.name.trim() === '' ? words.starEmpty : words.focusFull}
          testid="competence-star"
          onclick={() => star(row)}
        />
      </span>
      <span class="name">
        <TextField
          value={row.name}
          id="{id}-name-{index}"
          label={words.competence}
          placeholder={rows.length === 1 ? words.competencePlaceholder : null}
          invalid={wrong}
          describedby={wrong ? `${id}-error` : null}
          suggestions={vocabulary.skills}
          testid="competence-name"
          oninput={(next) => rename(row, next)}
        />
      </span>
      <span class="years">
        <NumberField
          bind:value={row.years}
          label={words.years}
          invalid={wrong}
          testid="competence-years"
        />
      </span>
      <span class="aliases">
        <ChipInput
          bind:values={row.aliases}
          label={words.aliases}
          oneLine
          suggestions={vocabulary.skills}
          testid="competence-aliases"
        />
      </span>
      <span class="remove">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon="close"
          plain
          label={words.removeCompetence(row.name.trim())}
          testid="competence-remove"
          onclick={(event) => removeByButton(row, event)}
        />
      </span>
    </div>
  {/each}
  {#if error}
    <p class="error" id="{id}-error" role="alert" data-testid="competence-error">{error.text}</p>
  {/if}
  <span class="add" class:indent={rows.length > 0}>
    <Button
      variant="secondary"
      size="sm"
      icon="add"
      label={words.addCompetence}
      testid="competence-add"
      onclick={() => void add()}
    />
  </span>
  {#if rows.length > 0}
    <p class="focus-hint under" data-testid="focus-hint">{words.focusHint}</p>
  {/if}
  <!-- What the file said about the Schwerpunkte that the targets cannot show. -->
  {#if problems.length > 0 || trimmed !== null}
    <div class="focus" data-testid="focus" data-field="focus">
      {#each problems as problem (problem.value)}
        <ValueNote
          text={problem.entry
            ? words.unreadableFocus(problem.value)
            : words.unreadableValue(problem.value)}
          testid="focus-unread"
          onremove={() => drop(problem)}
        />
      {/each}
      {#if trimmed !== null}
        <p class="focus-hint" data-testid="focus-trimmed">{words.focusTrimmed(trimmed)}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    container-type: inline-size;
  }

  /* target | competence | years | synonyms | remove: the synonyms take more room than the
     name, which is one short term. */
  .head,
  .row {
    display: grid;
    grid-template-columns:
      var(--control-sm) minmax(0, 4fr) calc(var(--space-64) + var(--space-8))
      minmax(0, 5fr) var(--control-sm);
    align-items: start;
    gap: var(--space-8);
  }

  .head {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  /* The count of Schwerpunkte over their targets, centred on them. */
  .count {
    color: var(--text-muted);
    font-variant-numeric: var(--numeric);
    text-align: center;
    white-space: nowrap;
  }

  .star,
  .remove {
    display: flex;
    align-items: center;
    height: var(--control-field);
  }

  /* Under the rows the button lines up with the competence column; alone it starts at the
     card's edge. */
  .add.indent,
  .under,
  .error {
    margin-left: calc(var(--control-sm) + var(--space-8));
  }

  .error {
    color: var(--danger-strong);
    font: var(--type-sm);
  }

  .focus {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .focus-hint {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* Narrow: the synonyms go under the competence. */
  @container (width < 520px) {
    .head .aliases-head {
      display: none;
    }

    .row {
      grid-template-columns:
        var(--control-sm) minmax(0, 1fr) calc(var(--space-64) + var(--space-8))
        var(--control-sm);
    }

    .aliases {
      grid-column: 2 / 4;
      grid-row: 2;
    }
  }
</style>
