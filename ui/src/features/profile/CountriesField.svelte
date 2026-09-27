<!--
  Einsatzländer: a chip field that suggests the countries the engine knows (by their German
  and English names and the other names people use); the chip holds the code. A country of a
  file the app does not know stays as it is.
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import Field from '$components/Field.svelte';
  import { de } from '$lib/i18n/de';
  import { en } from '$lib/i18n/en';
  import { t } from '$lib/i18n/t';

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
</script>

<div data-field="countries">
  <Field label={words.countries} for={id} {error} {action}>
    <ChipInput
      {id}
      bind:values
      options={COUNTRIES}
      noMatch={words.countryNone}
      placeholder={words.countriesPlaceholder}
      invalid={error !== null}
      testid="profile-countries"
    />
  </Field>
</div>
