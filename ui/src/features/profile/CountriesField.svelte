<!--
  Länder: a chip field of the countries the engine knows. With the focus it lists them,
  Deutschland, Österreich and Schweiz first, then the others by name; typing finds a country by
  its German and English names and the other names people use. The chip holds the code; a
  country of a file the app does not know stays as it is.
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';

  interface Props {
    id: string;
    values: string[];
    /** Required and still empty: the amber edge, "Pflicht" in the placeholder. */
    missing: boolean;
    invalid: boolean;
  }

  let { id, values = $bindable(), missing, invalid }: Props = $props();

  const words = $derived(t.profile.field);

  /** The countries listed first (DACH). */
  const FIRST = ['DE', 'AT', 'CH'];
  /** Other names people type for a country (the engine reads most of them too,
   *  core/src/matching/lexicon/engine.rs). */
  const COUNTRY_TERMS: Readonly<Record<string, readonly string[]>> = {
    CZ: ['Czech Republic', 'Tschechische Republik'],
    GB: ['UK', 'England', 'Great Britain', 'Vereinigtes Königreich'],
    NL: ['Holland'],
    US: ['United States', 'Vereinigte Staaten', 'America', 'Amerika'],
  };
  const nameOf = (code: string): string => de.profile.country[code] ?? code;
  /** Every country the engine knows, named in German and found by every name. */
  const COUNTRIES = Object.keys(de.profile.country)
    .sort((a, b) => {
      const rank = (code: string): number => (FIRST.includes(code) ? FIRST.indexOf(code) : 9);
      return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b));
    })
    .map((code) => ({
      id: code,
      label: nameOf(code),
      terms: [
        nameOf(code),
        de.profile.countryEnglish[code] ?? code,
        ...(COUNTRY_TERMS[code] ?? []),
      ],
    }));
</script>

<ChipInput
  {id}
  bind:values
  options={COUNTRIES}
  noMatch={words.countryNone}
  placeholder={missing
    ? t.profile.required(words.countriesPlaceholder)
    : words.countriesPlaceholder}
  more={words.countriesMore}
  {missing}
  {invalid}
  testid="profile-countries"
/>
