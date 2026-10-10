<!--
  The profile as one page of fields: the four groups of `sections.ts` in their order
  (Wunschjob, Einsatz, Qualifikation, Ausschlüsse), each a Section with its fields in one white
  box (Group), 16 apart and without lines between them ("Luftige Gruppen", design round 6);
  the same page in the setup. The page's actions (`actions`, "Aus Lebenslauf ausfüllen") end
  the first heading's line. Each field as the table describes it, its label above it (and,
  only where docs/PLAN.md places one, an info symbol beside the label): a list fills the box's
  width, a number (its unit inside) or a day is --number-width, a choice of a few as wide as
  its options. Vertragsart is three checkboxes (Projekt und Interim, Festanstellung,
  Zeitarbeit; one stays). A number is formatted when its field is left.
  A required field that is still empty shows its coral edge only once Speichern or the
  setup's Weiter was pressed (`missing`, ProfileView) and loses it as it is filled: its cell
  carries `data-missing`, and the token block of that name colours every field in it. A
  link of the missing sentence puts the caret into it, in the middle of the view, without a
  flash (`focusField`). A value that is too large, a 0 where at least 1 counts, a day that
  does not read and a value the backend refused are said at their field, stay with their
  error until they change, and hold the save (the field gets the caret when a save is
  tried). A wished rate under the minimum says so quietly under it. Mindestgehalt shows only
  while Festanstellung or Zeitarbeit is chosen. Enter in a field saves (the setup: goes on),
  as in every form (in the row lists it goes to the next row, in a chip field it adds what
  was typed); an untouched new form goes back to the ways in with Esc (not in the setup).
  The setup shows no "Häufig verlangt".
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
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ContractKey } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { fade } from '$lib/motion/transitions';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { tick, type Snippet } from 'svelte';
  import AskedTerms from './AskedTerms.svelte';
  import AvailableField from './AvailableField.svelte';
  import CompetenceList from './CompetenceList.svelte';
  import CountriesField from './CountriesField.svelte';
  import LanguageList from './LanguageList.svelte';
  import NumberField from './NumberField.svelte';
  import { SECTIONS, fieldOf, type ChoiceKey, type Control, type NumberKey } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The required fields still empty that are marked (once a press asked for them). */
    missing: readonly string[];
    /** The setup's page: no "Häufig verlangt", Esc does nothing. */
    setup?: boolean;
    /** The page's actions, at the end of the first group's heading line. */
    actions?: Snippet | null;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { fieldError, missing, setup = false, actions = null, onsave, ondiscard }: Props = $props();

  // Text typed into a chip field of the form counts as a change.
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

  /** A value is marked: Speichern waits until it is put right. */
  export function held(): boolean {
    return invalid.length > 0 || fieldError !== null || (editor.judged && editor.dateInvalid);
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
  const shown = (control: Control): boolean =>
    control.kind !== 'number' || (control.shown?.(form) ?? true);
  /** The wished rate under the minimum: a quiet line under the wish. */
  const below = $derived(
    form.dayRateWish !== null && form.dayRateMin !== null && form.dayRateWish < form.dayRateMin,
  );

  // ------------------------------------------------------------ the choices

  const CHOICES = $derived<Record<ChoiceKey, { id: string; label: string }[]>>({
    workMode: Object.entries(t.profile.workMode).map(([mode, label]) => ({ id: mode, label })),
    workload: Object.entries(t.profile.workload).map(([load, label]) => ({ id: load, label })),
    minMonths: Object.entries(t.profile.minMonths).map(([months, label]) => ({
      id: months,
      label,
    })),
  });
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

  /** A choice's value as the segmented control holds it, and back. */
  const choiceOf = (key: ChoiceKey): string => String(form[key]);
  function choose(key: ChoiceKey, value: string): void {
    if (key === 'minMonths') form.minMonths = Number(value) as ProfileForm['minMonths'];
    else if (key === 'workload') form.workload = value as ProfileForm['workload'];
    else form.workMode = value as ProfileForm['workMode'];
  }

  // ------------------------------------------------------------ names as chips

  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const industryNames = (): string[] => form.industries.map((row) => row.name);
  /** The names as the chip field leaves them, each keeping its star. */
  function setIndustries(names: string[]): void {
    form.industries = names.map(
      (name) => form.industries.find((row) => same(row.name, name)) ?? { name, preferred: false },
    );
  }
  const INDUSTRY_STAR = {
    on: (name: string): boolean =>
      form.industries.some((row) => same(row.name, name) && row.preferred),
    label: (name: string, on: boolean): string => (on ? words.unprefer(name) : words.prefer(name)),
    toggle: (name: string): void => {
      const row = form.industries.find((each) => same(each.name, name));
      if (row) row.preferred = !row.preferred;
    },
  };

  // ------------------------------------------------------------ saving

  let root = $state<HTMLElement | null>(null);

  /** Ready to save: a value that holds the save is said at its field, which gets the caret. */
  export function ready(): boolean {
    editor.judged = true;
    if (editor.dateInvalid) {
      void focusField('available');
      return false;
    }
    const wrong = invalid[0] ?? null;
    if (wrong !== null) void focusField(wrong.field);
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
    <Section
      id="profile-section-{section.id}"
      name={section.id}
      heading={t.profile.section[section.id]}
      actions={index === 0 ? actions : null}
      testid="section-{section.id}"
    >
      <Group>
        <div class="fields">
          {#each section.rows as row, index (index)}{@render cell(row)}{/each}
        </div>
      </Group>
    </Section>
  {/each}
</div>

{#snippet cell(c: Control)}
  {#if shown(c)}
    <div
      class="cell"
      data-field={fieldOf(c)}
      data-missing={isMissing(c) ? '' : undefined}
      transition:fade
    >
      {@render control(c)}
    </div>
  {/if}
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
      <span class="number">
        <NumberField
          id="{id}-{c.key}"
          money={c.unit === 'euro'}
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
      <ChipInput
        id="{id}-{c.key}"
        bind:values={form[c.key]}
        split={c.lines ? 'lines' : 'list'}
        placeholder={words[c.placeholder]}
        more={words[c.more]}
        invalid={error !== null}
        suggestions={c.suggest ? vocabulary[c.suggest] : undefined}
        fold={c.key === 'tools'}
        testid={c.testid}
      />
      {#if c.asked && !setup}<AskedTerms field={c.asked} home={c.testid} />{/if}
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
    <Field label={words[c.label]} info={infoOf(c)} error={errorOf(c.key)}>
      <Segmented
        options={CHOICES[c.key]}
        value={choiceOf(c.key)}
        label={words[c.label]}
        testid={c.testid}
        onchange={(value) => choose(c.key, value)}
      />
    </Field>
  {:else if c.kind === 'countries'}
    {@const error = errorOf('countries')}
    <Field label={words.countries} for="{id}-countries" info={infoOf(c)} {error}>
      <CountriesField id="{id}-countries" bind:values={form.countries} invalid={error !== null} />
    </Field>
  {:else if c.kind === 'available'}
    {@const error = errorOf('available')}
    <Field label={words.available} {error}>
      <AvailableField invalid={error !== null} />
    </Field>
  {:else if c.kind === 'competences'}
    <Field label={words.competences} info={infoOf(c)}>
      <CompetenceList bind:rows={form.competences} error={listError('competences')} />
      {#if !setup}<AskedTerms field="competence" home="competence-add" />{/if}
    </Field>
  {:else if c.kind === 'industries'}
    {@const error = errorOf('industries')}
    <Field label={words.industries} for="{id}-industries" info={infoOf(c)} {error}>
      <ChipInput
        id="{id}-industries"
        bind:values={industryNames, setIndustries}
        placeholder={words.industriesPlaceholder}
        more={words.industriesMore}
        invalid={error !== null}
        suggestions={vocabulary.industries}
        star={INDUSTRY_STAR}
        fold
        testid="profile-industries"
      />
      {#if !setup}<AskedTerms field="industry" home="profile-industries" />{/if}
    </Field>
  {:else if c.kind === 'languages'}
    <Field label={words.languages}>
      <LanguageList bind:rows={form.languages} error={listError('languages')} />
      {#if !setup}<AskedTerms field="language" home="language-add" />{/if}
    </Field>
  {/if}
{/snippet}

<style>
  /* The groups, 32 apart (Section). */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--layout-section-gap);
  }

  /* The fields of a group, 16 apart, no lines between them. */
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--layout-field-gap);
  }

  /* A number (euros, years) is as wide as a day field, its unit inside at its right; the
     note under it keeps its own line. */
  .number {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .number > :global(:first-child) {
    width: var(--number-width);
    max-width: 100%;
  }

  .cell {
    min-width: 0;
  }

  /* Tab and focus scrolling keep a field clear of the top bar's fade and of the floating
     bar at the foot. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: calc(var(--fade-height) + var(--space-8));
    scroll-margin-bottom: calc(
      var(--control-field) + 2 * var(--space-8) + var(--float-gap) + var(--space-16)
    );
  }
</style>
