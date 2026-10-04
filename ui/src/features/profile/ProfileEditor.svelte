<!--
  The profile as rows (design round 3): on the page the three sections of `sections.ts` in
  their order (Was du suchst, Was du mitbringst, Was nicht passt), each under its heading in a
  card; in the setup one of its short forms (`form`), the rows on the setup's card. Each row
  is a field as the table describes it, its label (and, only where docs/PLAN.md places one,
  its info symbol) in a column of its own at the left (Field `side`, 128 px; 118 in the
  setup), its control in the column beside it, a hairline between the rows. Every control is
  24 px high, every number field one width with its unit beside it; a number is formatted
  when its field is left. A required field that is still empty (`missing`) has an amber edge
  with a soft halo and says "Pflicht" in its placeholder; a link of the missing line puts the
  caret into it and lets its row flash (`focusField`). A value that is too large, a 0 where
  at least 1 counts, a day that does not read and a value the backend refused are said at
  their field, stay with their error until they change, and hold the save (the field gets
  the caret when a save is tried). A wished rate under the minimum says so quietly under the
  rate. Mindestgehalt shows only while Festanstellungen or Zeitarbeit is on.
  Enter in a field saves (the setup: goes on), as in every form (in the row lists it goes to
  the next row, in a chip field it adds what was typed); an untouched new form goes back to
  the ways in with Esc (not in the setup).
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
  import Field from '$components/Field.svelte';
  import Segmented from '$components/Segmented.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { fade } from '$lib/motion/transitions';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import AskedTerms from './AskedTerms.svelte';
  import AvailableField from './AvailableField.svelte';
  import CompetenceList from './CompetenceList.svelte';
  import CountriesField from './CountriesField.svelte';
  import LanguageList from './LanguageList.svelte';
  import NumberField from './NumberField.svelte';
  import ProfileSection from './ProfileSection.svelte';
  import {
    SECTIONS,
    fieldsOf,
    type ChoiceKey,
    type Control,
    type NumberKey,
    type Word,
  } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The required fields still empty (an amber edge each). */
    missing: readonly string[];
    /** The setup's short form, its rows (null: the page with its sections). */
    rows?: readonly Control[] | null;
    onsave: () => void;
    ondiscard: () => void;
  }

  let { fieldError, missing, rows = null, onsave, ondiscard }: Props = $props();

  const setup = $derived(rows !== null);

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
  const isMissing = (control: Control): boolean =>
    fieldsOf(control).some((field) => missing.includes(field));
  /** The placeholder of a field, with "Pflicht" while it is required and empty. */
  const placeholderOf = (word: Word, open: boolean): string =>
    open ? t.profile.required(words[word]) : words[word];

  // ------------------------------------------------------------ the choices

  const CHOICES = $derived<Record<ChoiceKey, { id: string; label: string }[]>>({
    workMode: Object.entries(t.profile.workMode).map(([mode, label]) => ({ id: mode, label })),
    workload: Object.entries(t.profile.workload).map(([load, label]) => ({ id: load, label })),
    minMonths: Object.entries(t.profile.minMonths).map(([months, label]) => ({
      id: months,
      label,
    })),
  });
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
  /** The setup's competences as names, each keeping its years and star. */
  const competenceNames = (): string[] =>
    form.competences.map((row) => row.name).filter((name) => name.trim() !== '');
  function setCompetences(names: string[]): void {
    form.competences = names.map(
      (name) =>
        form.competences.find((row) => same(row.name, name)) ?? {
          name,
          years: null,
          focus: false,
        },
    );
  }

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
   *  view, and with `flash` its row lights up once; `false` when the field is not on the
   *  page. */
  export async function focusField(field: string, flash = false): Promise<boolean> {
    await tick();
    const scope = root?.querySelector<HTMLElement>(`[data-field~="${field}"]`);
    const target =
      scope?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      scope?.querySelector<HTMLElement>('input, textarea, button:not([data-testid="info-tip"])');
    target?.focus({ preventScroll: true });
    (target ?? scope)?.scrollIntoView({ block: 'center' });
    if (flash && scope) {
      delete scope.dataset.flash;
      void scope.offsetWidth;
      scope.dataset.flash = '';
    }
    return target !== null && target !== undefined;
  }

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);
</script>

<div
  class="editor"
  class:setup
  bind:this={root}
  use:formKeys={untouched && !setup ? { save: onsave, cancel: ondiscard } : { save: onsave }}
  data-testid="profile-form"
>
  {#if rows !== null}
    <div class="rows">
      {#each rows as control, index (index)}{@render row(control)}{/each}
    </div>
  {:else}
    {#each SECTIONS as section (section.id)}
      <ProfileSection id={section.id} heading={t.profile.section[section.id]}>
        {#each section.rows as control, index (index)}{@render row(control)}{/each}
      </ProfileSection>
    {/each}
  {/if}
</div>

{#snippet row(c: Control)}
  {#if c.kind !== 'number' || (c.shown?.(form) ?? true)}
    <div
      class="row"
      data-field={fieldsOf(c).join(' ')}
      data-missing={isMissing(c) ? '' : undefined}
      onanimationend={(event) => {
        if (event.target === event.currentTarget) delete event.currentTarget.dataset.flash;
      }}
      transition:fade
    >
      {@render control(c, isMissing(c))}
    </div>
  {/if}
{/snippet}

{#snippet control(c: Control, open: boolean)}
  {#if c.kind === 'number'}
    {@const error = errorOf(c.key)}
    <Field side label={words[c.label]} for="{id}-{c.key}" info={infoOf(c)} {error}>
      <NumberField
        id="{id}-{c.key}"
        money={c.unit === 'euro'}
        unit={t.profile.unit[c.unit]}
        bind:value={form[c.key]}
        invalid={error !== null}
        testid={c.testid}
      />
    </Field>
  {:else if c.kind === 'chips'}
    {@const error = errorOf(c.key)}
    <Field side label={words[c.label]} for="{id}-{c.key}" info={infoOf(c)} {error}>
      <ChipInput
        id="{id}-{c.key}"
        bind:values={form[c.key]}
        split={c.lines ? 'lines' : 'list'}
        placeholder={placeholderOf(c.placeholder, open)}
        more={words[c.more]}
        missing={open}
        invalid={error !== null}
        suggestions={c.suggest ? vocabulary[c.suggest] : undefined}
        testid={c.testid}
      />
      {#if c.asked && !setup}<AskedTerms field={c.asked} home={c.testid} />{/if}
    </Field>
  {:else if c.kind === 'switch'}
    <Field side inline label={words[c.label]} info={infoOf(c)}>
      <div class="switch">
        {#if c.text}<span class="text" id="{id}-{c.key}-text">{words[c.text]}</span>{/if}
        <Toggle
          checked={form[c.key]}
          label={words[c.label]}
          describedby={c.text ? `${id}-${c.key}-text` : null}
          testid="profile-{c.key}"
          onchange={(on) => (form[c.key] = on)}
        />
      </div>
    </Field>
  {:else if c.kind === 'rate'}
    {@const error = errorOf('dayRateWish') ?? errorOf('dayRateMin')}
    {@const below =
      form.dayRateWish !== null && form.dayRateMin !== null && form.dayRateWish < form.dayRateMin}
    <Field
      side
      label={words.dayRate}
      info={infoOf(c)}
      hint={below && error === null ? words.belowMinRate : null}
      {error}
    >
      <div class="rate">
        <span class="pair">
          <label class="part" for="{id}-wish">{words.dayRateWish}</label>
          <NumberField
            id="{id}-wish"
            money
            bind:value={form.dayRateWish}
            invalid={errorOf('dayRateWish') !== null}
            testid="profile-wish-rate"
          />
        </span>
        <span class="pair">
          <label class="part" for="{id}-min">{words.dayRateMin}</label>
          <NumberField
            id="{id}-min"
            money
            unit={t.profile.unit.euro}
            bind:value={form.dayRateMin}
            invalid={errorOf('dayRateMin') !== null}
            testid="profile-min-rate"
          />
        </span>
      </div>
    </Field>
  {:else if c.kind === 'choice'}
    <Field side label={words[c.label]} info={infoOf(c)} error={errorOf(c.key)}>
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
    <Field side label={words.countries} for="{id}-countries" info={infoOf(c)} {error}>
      <CountriesField
        id="{id}-countries"
        bind:values={form.countries}
        missing={open}
        invalid={error !== null}
      />
    </Field>
  {:else if c.kind === 'available'}
    {@const error = errorOf('available')}
    <Field side label={words.available} {error}>
      <AvailableField invalid={error !== null} />
    </Field>
  {:else if c.kind === 'competences'}
    <Field side label={words.competences} info={infoOf(c)}>
      <CompetenceList
        bind:rows={form.competences}
        missing={open}
        error={listError('competences')}
      />
      {#if !setup}<AskedTerms field="competence" home="competence-add" />{/if}
    </Field>
  {:else if c.kind === 'competenceNames'}
    <Field side label={words.competences} for="{id}-competences" info={infoOf(c)}>
      <ChipInput
        id="{id}-competences"
        bind:values={competenceNames, setCompetences}
        placeholder={placeholderOf('competencePlaceholder', open)}
        more={words.competencesMore}
        missing={open}
        suggestions={vocabulary.skills}
        testid="profile-competence-names"
      />
    </Field>
  {:else if c.kind === 'industries'}
    {@const error = errorOf('industries')}
    <Field side label={words.industries} for="{id}-industries" info={infoOf(c)} {error}>
      <ChipInput
        id="{id}-industries"
        bind:values={industryNames, setIndustries}
        placeholder={words.industriesPlaceholder}
        more={words.industriesMore}
        invalid={error !== null}
        suggestions={vocabulary.industries}
        star={INDUSTRY_STAR}
        testid="profile-industries"
      />
      {#if !setup}<AskedTerms field="industry" home="profile-industries" />{/if}
    </Field>
  {:else if c.kind === 'languages'}
    <Field side label={words.languages}>
      <LanguageList bind:rows={form.languages} missing={open} error={listError('languages')} />
      {#if !setup}<AskedTerms field="language" home="language-add" />{/if}
    </Field>
  {/if}
{/snippet}

<style>
  /* The sections 24 apart. */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }

  /* The setup's rows on its card: as wide as the card's content, the field's own query. */
  .rows {
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }

  .setup {
    --label-column: var(--label-column-setup);
  }

  /* A row of the form: edge to edge in its card (the card's inset as its own padding), a
     hairline under it but the last. It flashes once when a link of the missing line led to
     it (a wash in the halo's amber over the row). */
  .row {
    position: relative;
    margin-inline: calc(-1 * var(--row-inset));
    padding: var(--row-pad) var(--row-inset);
    border-bottom: var(--border-width) solid var(--border);
    scroll-margin-block: calc(2 * var(--head-pad) + var(--first-row) + var(--space-16));
  }

  .row:last-child {
    border-bottom: 0;
  }

  .row::after {
    position: absolute;
    inset: 0;
    background-color: var(--missing-flash);
    content: '';
    opacity: 0;
    pointer-events: none;
  }

  .row:global([data-flash]::after) {
    animation: pulse var(--dur-flash) var(--ease-out);
  }

  /* A switch's sentence at the left of its column, the switch at its end. */
  .switch {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-height: var(--control-field);
  }

  .text {
    flex: 1;
    min-width: 0;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .switch > :global(:last-child) {
    margin-left: auto;
  }

  /* Wunsch and Minimum, each named before its field, the euro after the last. */
  .rate {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-16);
  }

  .pair {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .part {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* Tab and focus scrolling keep a field clear of the sticky head. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-block: calc(2 * var(--head-pad) + var(--first-row) + var(--space-24));
  }
</style>
