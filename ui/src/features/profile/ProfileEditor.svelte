<!--
  The profile as one page of fields (the round 10 draft): the four groups of `sections.ts` in
  their order (Wunschjob, Einsatz, Qualifikation, Ausschlüsse), each a Section with its fields
  in one white box (Group), 18 apart and without lines between them; a pair of short fields
  side by side once the box is 560 wide, else one under the other. The same page in the
  setup. Each field as the table describes it, its label above it (and, only where
  docs/PLAN.md places one, an info symbol beside the label): a tag field or a list fills the
  box's width, a number is as wide as its unit needs (170 for euros, 130 for years), a
  choice of a few as wide as its options, Mindestlaufzeit a select. The groups rise in one
  after the other when the page opens (not in the setup, whose step slides in). Mindestgehalt
  unfolds while Festanstellung or Zeitarbeit is chosen. A number is formatted when its field
  is left.
  A required field that is still empty carries `data-missing` on its cell (`missing`, from
  ProfileView: on the Profil always, in the setup once Weiter asked): its edge and its label
  turn red (tokens.css). A value that is too large, a 0 where at least 1 counts, a day that
  does not read and a value the backend refused are said at their field in their own
  sentence, stay with their error until they change, and only they hold the save (the first
  of them is revealed when a save is tried; `wrongField` names it for Speichern's reason). A
  wished rate under the minimum says so quietly under it. Enter in a field saves (the setup:
  goes on), as in every form (in a tag field or an item list's add row it takes what was
  typed); an untouched new form goes back to the ways in with Esc (not in the setup).
  The setup shows no "Häufig verlangt" (the countries' "Vorschlag" stays).
-->
<script lang="ts" module>
  /** A value the backend refused on the last save: the field (and row) it names, its words. */
  export interface FieldError {
    field: string;
    row: number | null;
    text: () => string;
  }
</script>

<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import CheckGroup from '$components/CheckGroup.svelte';
  import Field from '$components/Field.svelte';
  import Group from '$components/Group.svelte';
  import Section from '$components/Section.svelte';
  import Segmented from '$components/Segmented.svelte';
  import Select from '$components/Select.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ContractKey } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { enterGroups } from '$lib/motion/enter';
  import { unfold } from '$lib/motion/transitions';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import AskedTerms from './AskedTerms.svelte';
  import AvailableField from './AvailableField.svelte';
  import CompetenceList from './CompetenceList.svelte';
  import CountriesField from './CountriesField.svelte';
  import LanguageList from './LanguageList.svelte';
  import NumberField from './NumberField.svelte';
  import {
    LABEL_OF,
    SECTIONS,
    controlsOf,
    fieldOf,
    type ChoiceKey,
    type Control,
    type NumberKey,
    type Row,
  } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The required fields still empty that are marked. */
    missing: readonly string[];
    /** The setup's page: no "Häufig verlangt", no rise of the groups, Esc does nothing. */
    setup?: boolean;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { fieldError, missing, setup = false, onsave, ondiscard }: Props = $props();

  // Text typed into a tag field of the form counts as a change.
  editor.typed.share();

  const words = $derived(t.profile.field);
  const id = $props.id();
  const form = $derived(editor.after);
  vocabulary.load();

  // ------------------------------------------------------------ values that hold the save

  /** Day rates where 0 is nothing a job could meet: a typed 0 is said and holds the save. */
  const AT_LEAST_ONE: readonly NumberKey[] = ['dayRateWish', 'dayRateMin'];

  /** Values the form knows are wrong before anything is sent: too large, or a 0 where at
   *  least 1 counts. Each is said at its field and holds the save. */
  const invalid = $derived.by((): { field: string; row: number | null; text: string }[] => {
    const found: { field: string; row: number | null; text: string }[] = [];
    for (const [key, max] of Object.entries(NUMBER_LIMITS) as [NumberKey, number][]) {
      const value = form[key];
      if (value !== null && value > max) {
        found.push({ field: key, row: null, text: words.atMost(max) });
      } else if (value === 0 && AT_LEAST_ONE.includes(key)) {
        found.push({ field: key, row: null, text: words.atLeast(1) });
      }
    }
    // A competence's years, counted among the rows with a name (as the backend does).
    const named = form.competences.filter((row) => row.name.trim() !== '');
    const row = named.findIndex((each) => each.years !== null && each.years > MAX_YEARS);
    if (row >= 0) found.push({ field: 'competences', row, text: words.atMost(MAX_YEARS) });
    return found;
  });

  /** "Ab Datum" with a day that does not read, once it is judged. */
  const dateWrong = $derived(
    editor.judged && editor.dateInvalid
      ? dayShaped(editor.dateText)
        ? words.dateImpossible
        : words.dateInvalid
      : null,
  );

  /** A field's label as the page shows it. */
  const labelOf = (field: string): string =>
    String((words as Record<string, unknown>)[LABEL_OF[field as keyof ProfileForm] ?? field]);

  /** The label of the first value that holds the save (null: none does). */
  export function wrongField(): string | null {
    const field =
      fieldError?.field ??
      (editor.judged && editor.dateInvalid ? 'available' : (invalid[0]?.field ?? null));
    return field === null ? null : labelOf(field);
  }

  /** The error of a field: a value the backend refused, else one that is wrong as it is. */
  function errorOf(field: string): string | null {
    if (fieldError?.field === field) return fieldError.text();
    if (field === 'available' && dateWrong !== null) return dateWrong;
    return invalid.find((each) => each.field === field)?.text ?? null;
  }

  /** The row of a list that is marked (a refusal first, then a value that is wrong). */
  function listError(field: string): { row: number | null; text: string } | null {
    if (fieldError?.field === field) return { row: fieldError.row, text: fieldError.text() };
    const wrong = invalid.find((each) => each.field === field);
    return wrong ? { row: wrong.row, text: wrong.text } : null;
  }

  const infoOf = (control: Control): string | null =>
    'info' in control && control.info ? t.profile.info[control.info] : null;
  const isMissing = (control: Control): boolean => missing.includes(fieldOf(control));
  /** A row shows while its first field has something to do (Mindestgehalt). */
  const shown = (row: Row): boolean => {
    const first = controlsOf(row)[0];
    return first?.kind !== 'number' || (first.shown?.(form) ?? true);
  };
  /** The wished rate under the minimum: a quiet line under the wish. */
  const below = $derived(
    form.dayRateWish !== null && form.dayRateMin !== null && form.dayRateWish < form.dayRateMin,
  );

  // ------------------------------------------------------------ the choices

  const CHOICES = $derived<Record<ChoiceKey, { id: string; label: string }[]>>({
    workMode: Object.entries(t.profile.workMode).map(([mode, label]) => ({ id: mode, label })),
    workload: Object.entries(t.profile.workload).map(([load, label]) => ({ id: load, label })),
  });
  const MONTHS = $derived(
    Object.entries(t.profile.minMonths).map(([months, label]) => ({ id: months, label })),
  );
  /** Vertragsart: the contract types chosen. */
  const CONTRACT_KEYS: readonly ContractKey[] = ['project', 'permanent', 'temporary'];
  const CONTRACTS = $derived(
    CONTRACT_KEYS.map((key) => ({
      id: key,
      label: t.profile.contract[key],
      testid: `contract-${key}`,
    })),
  );
  const contracts = $derived(CONTRACT_KEYS.filter((key) => form[key]));
  function toggleContract(key: ContractKey): void {
    form[key] = !form[key];
  }

  function choose(key: ChoiceKey, value: string): void {
    if (key === 'workload') form.workload = value as ProfileForm['workload'];
    else form.workMode = value as ProfileForm['workMode'];
  }

  // ------------------------------------------------------------ saving

  let root = $state<HTMLElement | null>(null);

  /** Ready to save: a value that holds the save is said at its field, which comes into view
   *  (a day that does not read gets the caret). */
  export function ready(): boolean {
    editor.judged = true;
    if (editor.dateInvalid) {
      void focusField('available');
      return false;
    }
    const wrong = invalid[0] ?? null;
    if (wrong !== null) void revealField(wrong.field);
    return wrong === null && fieldError === null;
  }

  /** The caret into a field of the form (its marked control first), in the middle of the
   *  view; `false` when the field is not on the page. */
  export async function focusField(field: string): Promise<boolean> {
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field~="${field}"]`);
    const target =
      scope?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      scope?.querySelector<HTMLElement>('input, textarea, button:not([data-testid="info-tip"])');
    target?.focus({ preventScroll: true });
    (target ?? scope)?.scrollIntoView({ block: 'center' });
    return target !== null && target !== undefined;
  }

  /** A field of the form in the middle of the view, without the caret (Speichern and Weiter
   *  only show what is missing or wrong; the user clicks where they want to type). */
  export async function revealField(field: string): Promise<boolean> {
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field~="${field}"]`);
    scope?.scrollIntoView({ block: 'center' });
    return scope !== null && scope !== undefined;
  }

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);
</script>

<div
  class="editor"
  bind:this={root}
  use:formKeys={untouched && !setup ? { save: onsave, cancel: ondiscard } : { save: onsave }}
  data-testid="profile-form"
>
  {#each SECTIONS as section, index (section.id)}
    <div class="group" use:enterGroups={{ index, on: !setup }}>
      <Section
        id="profile-section-{section.id}"
        name={section.id}
        heading={t.profile.section[section.id]}
        testid="section-{section.id}"
      >
        <Group>
          <div class="rows">
            {#each section.rows as row, at (at)}
              {#if shown(row)}
                <div class="row" class:pair={'pair' in row} transition:unfold>
                  {#each controlsOf(row) as c (fieldOf(c))}{@render cell(c)}{/each}
                </div>
              {/if}
            {/each}
          </div>
        </Group>
      </Section>
    </div>
  {/each}
</div>

{#snippet cell(c: Control)}
  <div class="cell" data-field={fieldOf(c)} data-missing={isMissing(c) ? '' : undefined}>
    {@render control(c)}
  </div>
{/snippet}

{#snippet control(c: Control)}
  {#if c.kind === 'number'}
    {@const error = errorOf(c.key)}
    <Field
      label={words[c.label]}
      for="{id}-{c.key}"
      info={infoOf(c)}
      hint={c.key === 'dayRateWish' && below && error === null ? words.belowMinRate : null}
      {error}
    >
      <span class="number {c.unit}">
        <NumberField
          id="{id}-{c.key}"
          money={c.unit !== 'years'}
          unit={t.profile.unit[c.unit]}
          bind:value={form[c.key]}
          invalid={error !== null}
          testid={c.testid}
        />
      </span>
    </Field>
  {:else if c.kind === 'chips'}
    {@const error = errorOf(c.key)}
    <Field label={words[c.label]} for="{id}-{c.key}" info={infoOf(c)} {error}>
      <div class="stack">
        <ChipInput
          id="{id}-{c.key}"
          bind:values={form[c.key]}
          split={c.lines ? 'lines' : 'list'}
          placeholder={words[c.placeholder]}
          invalid={error !== null}
          suggestions={c.suggest ? vocabulary[c.suggest] : undefined}
          fold
          testid={c.testid}
        />
        {#if c.asked && !setup}<AskedTerms field={c.asked} home={c.testid} />{/if}
      </div>
    </Field>
  {:else if c.kind === 'contracts'}
    <Field label={words.contracts} info={infoOf(c)}>
      <CheckGroup
        options={CONTRACTS}
        values={contracts}
        keepOne={words.keepOneContract}
        label={words.contracts}
        testid="profile-contracts"
        onchange={toggleContract}
      />
    </Field>
  {:else if c.kind === 'choice'}
    <Field label={words[c.label]} error={errorOf(c.key)}>
      <Segmented
        options={CHOICES[c.key]}
        value={form[c.key]}
        label={words[c.label]}
        testid={c.testid}
        onchange={(value) => choose(c.key, value)}
      />
    </Field>
  {:else if c.kind === 'months'}
    <Field label={words.minMonths} for="{id}-minMonths" error={errorOf('minMonths')}>
      <div>
        <Select
          id="{id}-minMonths"
          options={MONTHS}
          value={String(form.minMonths)}
          label={words.minMonths}
          testid="profile-min-months"
          onchange={(months) => (form.minMonths = Number(months) as ProfileForm['minMonths'])}
        />
      </div>
    </Field>
  {:else if c.kind === 'countries'}
    {@const error = errorOf('countries')}
    <Field label={words.countries} for="{id}-countries" info={infoOf(c)} {error}>
      <div class="stack">
        <CountriesField id="{id}-countries" bind:values={form.countries} invalid={error !== null} />
      </div>
    </Field>
  {:else if c.kind === 'available'}
    {@const error = errorOf('available')}
    <Field label={words.available} {error}>
      <AvailableField invalid={error !== null} />
    </Field>
  {:else if c.kind === 'competences'}
    <Field label={words.competences} for="{id}-competences">
      <div class="stack">
        <CompetenceList
          id="{id}-competences"
          bind:rows={form.competences}
          error={listError('competences')}
        />
        {#if !setup}<AskedTerms field="competence" home="competence-add" />{/if}
      </div>
    </Field>
  {:else if c.kind === 'industries'}
    {@const error = errorOf('industries')}
    <Field label={words.industries} for="{id}-industries" {error}>
      <div class="stack">
        <ChipInput
          id="{id}-industries"
          bind:values={form.industries}
          placeholder={words.industriesPlaceholder}
          invalid={error !== null}
          suggestions={vocabulary.industries}
          fold
          testid="profile-industries"
        />
        {#if !setup}<AskedTerms field="industry" home="profile-industries" />{/if}
      </div>
    </Field>
  {:else if c.kind === 'languages'}
    <Field label={words.languages} for="{id}-languages">
      <div class="stack">
        <LanguageList
          id="{id}-languages"
          bind:rows={form.languages}
          error={listError('languages')}
        />
        {#if !setup}<AskedTerms field="language" home="language-add" />{/if}
      </div>
    </Field>
  {/if}
{/snippet}

<style>
  /* The groups, 30 apart (Section). */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }

  .group {
    min-width: 0;
  }

  /* The rows of a box, 18 apart: the space is the row's own top, so a row that unfolds
     (Mindestgehalt) brings it along instead of making the rows below jump. */
  .rows {
    display: flex;
    flex-direction: column;
  }

  .row + .row {
    padding-top: var(--group-field-gap);
  }

  /* A pair: one under the other in a narrow box, side by side (20 apart) once the box is
     560 wide; a pair with one field keeps it in its half. */
  .row.pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--group-field-gap) var(--layout-column-gap);
  }

  @container (min-width: 560px) {
    .row.pair {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .cell {
    min-width: 0;
  }

  /* A field and the suggestion row under it, 8 apart. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--suggest-row-gap);
    min-width: 0;
  }

  /* A number is as wide as its unit needs; the note under it keeps its own line. */
  .number {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .number > :global(:first-child) {
    width: var(--profile-money-width);
    max-width: 100%;
  }

  .number.years > :global(:first-child) {
    width: var(--profile-years-width);
  }

  /* Tab and focus scrolling keep a field clear of the top bar's fade and of the bar at the
     foot. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: calc(var(--fade-height) + var(--space-8));
    scroll-margin-bottom: calc(var(--bar-min) + var(--space-16));
  }
</style>
