<!--
  The profile as one form on one page (user decision 2026-10-03, variant 3): the three
  sections of `sections.ts` in their order (Was du suchst, Was du mitbringst, Was nicht passt),
  each under its heading in a card, each field as the table describes it. Every field has its
  label (13/500) and, only where docs/PLAN.md places one, an info symbol beside it (never with
  a hint); a field the CV filled carries a small navy dot until the next save. Every control
  is 32 px high, every number field one width with its unit beside it; a number is formatted
  when its field is left. A value that is too large, a 0 where at least 1 counts, a day that
  does not read and a value the backend refused are said at their field, stay with their
  error until they change, and hold the save (the field gets the caret when a save is tried).
  A wished rate under the minimum says so quietly in the hint's place. Mindestjahresgehalt
  shows only while Festanstellung or Zeitarbeit is ticked.
  The save bar rises in at the bottom of the view only while the form holds a change:
  "Speichern" (the one primary) and "Verwerfen"; it leaves once saved (the view says so in a
  toast) or discarded. While it shows, the toasts rise above it (the toast stack measures
  it). An untouched new form goes back to the ways in with Esc. Enter in a field saves, as in
  every form (in the row lists it goes to the next row, in a chip field it adds what was
  typed). In the setup (`onboarding`) there is no save bar and no "Häufig verlangt"; Enter is
  the setup's "Weiter" (`onsave`, also without a change) and Esc does nothing.
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
  import Button from '$components/Button.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import Field from '$components/Field.svelte';
  import MenuButton from '$components/MenuButton.svelte';
  import Notice from '$components/Notice.svelte';
  import Segmented from '$components/Segmented.svelte';
  import { t } from '$lib/i18n/t';
  import { formKeys } from '$lib/input/input';
  import type { ProfileForm } from '$lib/ipc/types';
  import { MAX_YEARS, NUMBER_LIMITS } from '$lib/ipc/types/profile';
  import { fade, rise } from '$lib/motion/transitions';
  import { primaryFirst } from '$lib/platform';
  import { dayShaped, editor } from '$lib/state/profile.svelte';
  import { tick } from 'svelte';
  import AskedTerms from './AskedTerms.svelte';
  import AvailableField from './AvailableField.svelte';
  import CompetenceList from './CompetenceList.svelte';
  import CountriesField from './CountriesField.svelte';
  import LanguageList from './LanguageList.svelte';
  import NumberField from './NumberField.svelte';
  import ProfileSection from './ProfileSection.svelte';
  import { SECTIONS, fieldsOf, type Control, type Line, type NumberKey } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    /** A value the backend refused on the last save. */
    fieldError: FieldError | null;
    /** The fields the CV filled (a dot at each until the next save). */
    aiFilled: readonly string[];
    busy: boolean;
    /** A failure of the last save, in words. */
    note: string | null;
    onsave: () => void;
    ondiscard: () => void;
    /** The save bar has left (after a save: the view's toast comes now). */
    onbargone?: () => void;
    /** The setup: no save bar, no "Häufig verlangt", Enter goes on. */
    onboarding?: boolean;
  }

  let {
    fieldError,
    aiFilled,
    busy,
    note,
    onsave,
    ondiscard,
    onbargone,
    onboarding = false,
  }: Props = $props();

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
  const held = $derived(
    invalid.length > 0 || fieldError !== null || (editor.judged && editor.dateInvalid),
  );

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

  /** The dot of a field the CV filled. */
  const markOf = (control: Control): string | null =>
    fieldsOf(control).some((field) => aiFilled.includes(field)) ? t.profile.aiFilled : null;
  const infoOf = (control: Control): string | null =>
    'info' in control && control.info ? t.profile.info[control.info] : null;

  // ------------------------------------------------------------ the choices

  const WORK_MODES = $derived(
    (Object.keys(t.profile.workMode) as ProfileForm['workMode'][]).map((mode) => ({
      id: mode,
      label: t.profile.workMode[mode],
    })),
  );
  const WORKLOADS = $derived(
    (Object.keys(t.profile.workload) as ProfileForm['workload'][]).map((load) => ({
      id: load,
      label: t.profile.workload[load],
    })),
  );
  const MONTHS = [0, 3, 6, 12] as const satisfies readonly ProfileForm['minMonths'][];
  const DURATIONS = $derived(
    MONTHS.map((months) => ({ id: String(months), label: t.profile.minMonths[months] })),
  );
  const monthsOf = (value: string): ProfileForm['minMonths'] =>
    MONTHS.find((months) => String(months) === value) ?? 0;

  /** The contract types beside the project one, which is always ticked. */
  const CONTRACTS = ['permanent', 'temporary'] as const;

  // ------------------------------------------------------------ the industries

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

  const actionFirst = primaryFirst();
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
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
    return target !== null && target !== undefined;
  }

  let bar = $state<HTMLElement | null>(null);

  /** A focused control that ends under the sticky save bar moves up (WebKit does not
   *  apply scroll-margin when it scrolls a focused field into view). */
  function keepClear(event: FocusEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const top = bar?.getBoundingClientRect().top ?? Infinity;
      if (target.isConnected && target.getBoundingClientRect().bottom > top) {
        target.scrollIntoView({ block: 'center' });
      }
    });
  }

  function save(): void {
    if (!editor.dirty || busy) return;
    if (ready()) onsave();
  }

  /** A new form nothing was typed into: Esc goes back to the ways in. */
  const untouched = $derived(editor.origin === 'new' && !editor.dirty);
</script>

<div
  class="editor"
  bind:this={root}
  use:formKeys={onboarding
    ? { save: () => !busy && onsave() }
    : untouched
      ? { save, cancel: ondiscard }
      : { save }}
  onfocusin={keepClear}
  data-testid="profile-form"
>
  {#each SECTIONS as section (section.id)}
    <ProfileSection id={section.id} heading={t.profile.section[section.id]}>
      {#each section.lines as line, index (index)}
        {@render lineOf(line)}
      {/each}
    </ProfileSection>
  {/each}
</div>

{#snippet lineOf(line: Line)}
  {#if line.kind === 'pair'}
    <div class="pair">
      {#each line.fields as field, index (index)}{@render control(field)}{/each}
    </div>
  {:else}
    {@render control(line)}
  {/if}
{/snippet}

{#snippet control(c: Control)}
  {@const fields = fieldsOf(c).join(' ')}
  {#if c.kind === 'number'}
    {#if c.shown?.(form) ?? true}
      {@const error = errorOf(c.key)}
      {@const advice = c.advice?.(form) ?? null}
      <div data-field={fields} transition:fade>
        <Field
          label={words[c.label]}
          for="{id}-{c.key}"
          hint={advice === null ? null : words[advice]}
          info={infoOf(c)}
          mark={markOf(c)}
          {error}
        >
          <NumberField
            id="{id}-{c.key}"
            money={c.unit === 'euro'}
            unit={t.profile.unit[c.unit]}
            bind:value={form[c.key]}
            invalid={error !== null}
            testid={c.testid}
          />
        </Field>
      </div>
    {/if}
  {:else if c.kind === 'chips'}
    {@const error = errorOf(c.key)}
    <div data-field={fields}>
      <Field label={words[c.label]} for="{id}-{c.key}" info={infoOf(c)} mark={markOf(c)} {error}>
        <ChipInput
          id="{id}-{c.key}"
          bind:values={form[c.key]}
          split={c.lines ? 'lines' : 'list'}
          placeholder={words[c.placeholder]}
          invalid={error !== null}
          suggestions={c.suggest ? vocabulary[c.suggest] : undefined}
          testid={c.testid}
        />
      </Field>
      {#if c.asked && !onboarding}<AskedTerms field={c.asked} home={c.testid} />{/if}
    </div>
  {:else if c.kind === 'segments'}
    <div data-field={fields}>
      <Field label={words[c.label]} info={infoOf(c)} mark={markOf(c)} error={errorOf(c.key)}>
        <Segmented
          options={WORK_MODES}
          value={form.workMode}
          label={words[c.label]}
          testid={c.testid}
          onchange={(mode) => (form.workMode = mode)}
        />
      </Field>
    </div>
  {:else if c.kind === 'select'}
    <div class="choose" data-field={fields}>
      <Field label={words[c.label]} mark={markOf(c)} error={errorOf(c.key)}>
        {#if c.key === 'workload'}
          <MenuButton
            options={WORKLOADS}
            value={form.workload}
            menuLabel={words[c.label]}
            field
            testid={c.testid}
            onchange={(load) => (form.workload = load)}
          />
        {:else}
          <MenuButton
            options={DURATIONS}
            value={String(form.minMonths)}
            menuLabel={words[c.label]}
            field
            testid={c.testid}
            onchange={(months) => (form.minMonths = monthsOf(months))}
          />
        {/if}
      </Field>
    </div>
  {:else if c.kind === 'contracts'}
    <div data-field={fields}>
      <Field label={words.contracts} info={infoOf(c)} mark={markOf(c)}>
        <div class="checks" data-testid="profile-contracts">
          <Button
            variant="secondary"
            icon="check"
            label={t.profile.contract.project}
            pressed
            disabled
            disabledReason={t.profile.contractFixed}
            testid="profile-contract-project"
          />
          {#each CONTRACTS as contract (contract)}
            <Button
              variant="secondary"
              icon={form[contract] ? 'check' : 'add'}
              label={t.profile.contract[contract]}
              pressed={form[contract]}
              testid="profile-contract-{contract}"
              onclick={() => (form[contract] = !form[contract])}
            />
          {/each}
        </div>
      </Field>
    </div>
  {:else if c.kind === 'countries'}
    {@const error = errorOf('countries')}
    <div data-field={fields}>
      <Field label={words.countries} for="{id}-countries" info={infoOf(c)} mark={markOf(c)} {error}>
        <CountriesField id="{id}-countries" bind:values={form.countries} invalid={error !== null} />
      </Field>
    </div>
  {:else if c.kind === 'available'}
    {@const error = errorOf('available')}
    <div data-field={fields}>
      <Field label={words.available} mark={markOf(c)} {error}>
        <AvailableField invalid={error !== null} />
      </Field>
    </div>
  {:else if c.kind === 'competences'}
    <div data-field={fields}>
      <Field label={words.competences} info={infoOf(c)} mark={markOf(c)}>
        <CompetenceList bind:rows={form.competences} error={listError('competences')} />
      </Field>
      {#if !onboarding}<AskedTerms field="competence" home="competence-add" />{/if}
    </div>
  {:else if c.kind === 'industries'}
    {@const error = errorOf('industries')}
    <div data-field={fields}>
      <Field
        label={words.industries}
        for="{id}-industries"
        info={infoOf(c)}
        mark={markOf(c)}
        {error}
      >
        <ChipInput
          id="{id}-industries"
          bind:values={industryNames, setIndustries}
          placeholder={words.industriesPlaceholder}
          invalid={error !== null}
          suggestions={vocabulary.industries}
          star={INDUSTRY_STAR}
          testid="profile-industries"
        />
      </Field>
      {#if !onboarding}<AskedTerms field="industry" home="profile-industries" />{/if}
    </div>
  {:else if c.kind === 'languages'}
    <div data-field={fields}>
      <Field label={words.languages} mark={markOf(c)}>
        <LanguageList bind:rows={form.languages} error={listError('languages')} />
      </Field>
      {#if !onboarding}<AskedTerms field="language" home="language-add" />{/if}
    </div>
  {/if}
{/snippet}

{#if editor.dirty && !onboarding}
  <div
    class="bar"
    bind:this={bar}
    data-save-bar
    data-testid="profile-save-bar"
    in:rise={{ distance: 'lg' }}
    out:fade
    onoutroend={() => onbargone?.()}
  >
    <div class="status">
      {#if note}
        <Notice tone="danger" variant="inline" text={note} testid="profile-save-error" />
      {/if}
    </div>
    <div class="buttons">
      {#snippet discard()}
        <Button
          variant="secondary"
          label={t.profile.discard}
          disabled={busy}
          testid="profile-discard"
          onclick={ondiscard}
        />
      {/snippet}
      {#if !actionFirst}{@render discard()}{/if}
      <Button
        variant="primary"
        label={t.profile.save}
        disabled={held}
        disabledReason={t.profile.fixFirst}
        loading={busy}
        testid="profile-save"
        onclick={save}
      />
      {#if actionFirst}{@render discard()}{/if}
    </div>
  </div>
{/if}

<style>
  /* The sections 32 apart. */
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-32);
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: var(--space-16);
  }

  @container (width >= 520px) {
    .pair {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  /* A select is as wide as a number field, or its column where that is narrower. */
  .choose :global(.select) {
    width: min(100%, calc(var(--stat-min) - var(--space-48) + var(--control-field)));
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
  }

  /* The save bar stays in view at the bottom of the scrolling view while there is a
     change; under a short page it still stands at the bottom (the page is at least as high
     as the view), so a note that appears above never moves it under the pointer. */
  .bar {
    position: sticky;
    z-index: var(--z-sticky);
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    margin-top: auto;
    padding: var(--space-12) 0;
    border-top: var(--border-width) solid var(--border);
    background-color: var(--surface);
  }

  .status {
    flex: 1;
    min-width: 0;
  }

  /* Tab and focus scrolling keep a field clear of the sticky save bar and the jump links. */
  .editor :global(:is(input, textarea, button, [role='switch'])) {
    scroll-margin-top: calc(var(--pane-padding) + var(--control-field));
    scroll-margin-bottom: calc(var(--control-field) + 2 * var(--space-12) + var(--space-8));
  }

  .buttons {
    display: flex;
    gap: var(--space-12);
  }
</style>
