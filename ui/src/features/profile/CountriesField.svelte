<!--
  Einsatzländer: a chip field that suggests the countries the engine knows (by their German
  and English names and the other names people use), with DACH in one click; the chip holds
  the code. A country of a file the app does not know stays as it is. The DACH button goes
  once the three are in, and the focus it had moves into the field. Narrow, it sits under the
  field, which keeps the full width of its neighbours.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import Field from '$components/Field.svelte';
  import { de } from '$lib/i18n/de';
  import { en } from '$lib/i18n/en';
  import { t } from '$lib/i18n/t';
  import { tick } from 'svelte';

  interface Props {
    id: string;
    values: string[];
    error: string | null;
    action: { label: string; testid: string; onclick: () => void } | null;
  }

  let { id, values = $bindable(), error, action }: Props = $props();

  const words = $derived(t.profile.field);

  /** Other names people type for a country (the engine reads most of them too,
   *  core/src/matching/lexicon/engine.rs). */
  const COUNTRY_TERMS: Readonly<Record<string, readonly string[]>> = {
    CZ: ['Czech Republic', 'Tschechische Republik'],
    GB: ['UK', 'England', 'Great Britain', 'Vereinigtes Königreich'],
    NL: ['Holland'],
    US: ['United States', 'Vereinigte Staaten', 'America', 'Amerika'],
  };
  /** Every country the engine knows, named in the app's language and found by every name. */
  const COUNTRIES = $derived(
    Object.keys(de.profile.country).map((code) => ({
      id: code,
      label: t.profile.country[code] ?? code,
      terms: [
        de.profile.country[code] ?? code,
        en.profile.country[code] ?? code,
        ...(COUNTRY_TERMS[code] ?? []),
      ],
    })),
  );
  /** Deutschland, Österreich and Schweiz in one click. */
  const DACH = ['DE', 'AT', 'CH'];
  const dachMissing = $derived(DACH.some((code) => !values.includes(code)));

  async function addDach(event: MouseEvent): Promise<void> {
    const focused = event.currentTarget === document.activeElement;
    values = [...values, ...DACH.filter((code) => !values.includes(code))];
    if (!focused) return;
    await tick();
    document.getElementById(id)?.focus();
  }
</script>

<div data-field="countries">
  <Field label={words.countries} for={id} {error} {action}>
    <div class="countries">
      <ChipInput
        {id}
        bind:values
        options={COUNTRIES}
        noMatch={words.countryNone}
        placeholder={words.countriesPlaceholder}
        invalid={error !== null}
        testid="profile-countries"
      />
      {#if dachMissing}
        <Button
          variant="secondary"
          size="sm"
          icon="add"
          label={words.dach}
          testid="profile-dach"
          onclick={(event) => void addDach(event)}
        />
      {/if}
    </div>
  </Field>
</div>

<style>
  .countries {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-12);
  }

  @container (width >= 520px) {
    .countries {
      flex-direction: row;
      align-items: center;
    }
  }

  .countries > :global(:first-child) {
    flex: 1;
    align-self: stretch;
    min-width: 0;
  }
</style>
