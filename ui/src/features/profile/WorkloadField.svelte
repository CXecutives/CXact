<!--
  Auslastung: the days a week as one field of two days that reads as one line ("von 3 bis 5
  Tage pro Woche"; it wraps only where the column is narrow). Either day may stay empty. One
  message for both days and one "Wert entfernen" for every value of the file behind them;
  each day keeps its own mark and `data-field`, so a refused day gets the caret.
-->
<script lang="ts">
  import Field from '$components/Field.svelte';
  import { t } from '$lib/i18n/t';
  import { NUMBER_CRITERIA } from '$lib/ipc/types/profile';
  import NumberField from './NumberField.svelte';

  interface Props {
    id: string;
    min: number | null;
    max: number | null;
    error: string | null;
    action: { label: string; testid: string; onclick: () => void } | null;
    invalidMin: boolean;
    invalidMax: boolean;
  }

  let {
    id,
    min = $bindable(),
    max = $bindable(),
    error,
    action,
    invalidMin,
    invalidMax,
  }: Props = $props();

  const words = $derived(t.profile.field);
</script>

<div data-field="workload">
  <Field label={words.workload} for={id} hint={words.workloadHint} {error} {action}>
    <div class="range" data-testid="profile-workload">
      <span class="word">{words.workloadFrom}</span>
      <div class="day" data-field="workloadMinDays">
        <NumberField
          {id}
          compact
          label={words.workloadMin}
          bind:value={min}
          invalid={invalidMin}
          testid="profile-workload-min"
        />
      </div>
      <span class="word">{words.workloadTo}</span>
      <div class="day" data-field="workloadMaxDays">
        <NumberField
          compact
          label={words.workloadMax}
          unit={t.profile.unit[NUMBER_CRITERIA.workloadMaxDays.unit]}
          bind:value={max}
          invalid={invalidMax}
          testid="profile-workload-max"
        />
      </div>
    </div>
  </Field>
</div>

<style>
  .range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }

  .word {
    color: var(--text-muted);
    font: var(--type-field);
  }

  .day {
    min-width: 0;
  }
</style>
