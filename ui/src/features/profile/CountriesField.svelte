<!--
  Länder: a search list of the countries the engine knows (ChipInput with options): the focus
  lists every country not chosen yet, typing narrows it by the German and English names and
  the other names people use, text that names no country stays and says so ("Kein Land mit
  diesem Namen."). Under it Deutschland, Österreich and Schweiz while they are not chosen
  ("Vorschlag", SuggestRow; in the setup too). The chip holds the code; a country of a file
  the app does not know stays as it is.
-->
<script lang="ts">
  import ChipInput from '$components/ChipInput.svelte';
  import { de } from '$lib/i18n/de';
  import { t } from '$lib/i18n/t';
  import SuggestRow from './SuggestRow.svelte';

  interface Props {
    id: string;
    values: string[];
    invalid: boolean;
  }

  let { id, values = $bindable(), invalid }: Props = $props();

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
  placeholder={words.countriesPlaceholder}
  {invalid}
  fold
  testid="profile-countries"
/>
<SuggestRow
  label={t.profile.suggested}
  picks={FIRST.filter((code) => !values.includes(code)).map((code) => ({
    id: code,
    label: nameOf(code),
  }))}
  home="profile-countries"
  testid="country-pick"
  onpick={(code) => (values = [...values, code])}
/>
