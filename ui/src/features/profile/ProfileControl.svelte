<!--
  One field of the Profil (ProfileEditor), a row of its box (Field `row`: the label beside the
  control, only where docs/PLAN.md places one an info symbol after it). A tag field fills the
  control's column, every short control has one width (a number, a select), Vertragsart is a
  choice of several, Arbeitsmodell, Auslastung and Mindestlaufzeit are selects, Länder and
  Verfügbar their own fields. A wished rate under the minimum says so quietly under it; an
  error is said by its Field.
-->
<script lang="ts">
  import CheckGroup from '$components/CheckGroup.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import Field from '$components/Field.svelte';
  import Select from '$components/Select.svelte';
  import { t } from '$lib/i18n/t';
  import type { ContractKey } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { editor } from '$lib/state/profile.svelte';
  import AvailableField from './AvailableField.svelte';
  import CountriesField from './CountriesField.svelte';
  import NumberField from './NumberField.svelte';
  import type { ChoiceKey, Control } from './sections';
  import { vocabulary } from './vocabulary.svelte';

  interface Props {
    c: Control;
    /** The page's id for the fields' ids. */
    id: string;
    /** The error said at a field (a value the backend refused or one that is wrong). */
    errorOf: (field: string) => string | null;
  }

  let { c, id, errorOf }: Props = $props();

  const words = $derived(t.profile.field);
  const form = $derived(editor.after);

  const info = $derived('info' in c && c.info ? t.profile.info[c.info] : null);
  /** The wished rate under the minimum: a quiet line under the wish. */
  const below = $derived(
    form.dayRateWish !== null && form.dayRateMin !== null && form.dayRateWish < form.dayRateMin,
  );

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
</script>

{#if c.kind === 'number'}
  {@const error = errorOf(c.key)}
  <Field
    label={words[c.label]}
    for="{id}-{c.key}"
    {info}
    hint={c.key === 'dayRateWish' && below && error === null ? words.belowMinRate : null}
    {error}
    row
  >
    <span class="number">
      <NumberField
        id="{id}-{c.key}"
        money={c.unit !== 'years'}
        unit={t.profile.unit[c.unit]}
        placeholder={c.placeholder ? words[c.placeholder] : null}
        bind:value={form[c.key]}
        invalid={error !== null}
        testid={c.testid}
      />
    </span>
  </Field>
{:else if c.kind === 'chips'}
  {@const error = errorOf(c.key)}
  <Field label={words[c.label]} for="{id}-{c.key}" {info} {error} row>
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
  </Field>
{:else if c.kind === 'contracts'}
  <Field label={words.contracts} {info} row>
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
  <Field label={words[c.label]} for="{id}-{c.key}" error={errorOf(c.key)} row>
    <div class="short">
      <Select
        id="{id}-{c.key}"
        options={CHOICES[c.key]}
        value={form[c.key]}
        label={words[c.label]}
        wide
        testid={c.testid}
        onchange={(value) => choose(c.key, value)}
      />
    </div>
  </Field>
{:else if c.kind === 'months'}
  <Field label={words.minMonths} for="{id}-minMonths" error={errorOf('minMonths')} row>
    <div class="short">
      <Select
        id="{id}-minMonths"
        options={MONTHS}
        value={String(form.minMonths)}
        label={words.minMonths}
        wide
        testid="profile-min-months"
        onchange={(months) => (form.minMonths = Number(months) as ProfileForm['minMonths'])}
      />
    </div>
  </Field>
{:else if c.kind === 'countries'}
  {@const error = errorOf('countries')}
  <Field label={words.countries} for="{id}-countries" {info} {error} row>
    <div class="stack">
      <CountriesField id="{id}-countries" bind:values={form.countries} invalid={error !== null} />
    </div>
  </Field>
{:else if c.kind === 'available'}
  {@const error = errorOf('available')}
  <Field label={words.available} {error} row>
    <AvailableField invalid={error !== null} />
  </Field>
{/if}

<style>
  /* A field and the suggestion row under it, 8 apart. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--suggest-row-gap);
    min-width: 0;
  }

  /* Every short control one width; a number's note under it keeps its own line. */
  .number {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .number > :global(:first-child),
  .short {
    width: var(--profile-control-width);
    max-width: 100%;
  }
</style>
