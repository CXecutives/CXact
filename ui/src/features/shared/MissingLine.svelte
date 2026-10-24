<!--
  The one sentence of what the profile still lacks (design round 4), said only once
  Speichern (the Profil's floating bar) or the setup's Weiter (beside it) was pressed: "Es
  fehlen noch Wunschrollen und Sprachen.", the names in the order of the page joined by
  commas and "und", each a link that puts the caret into its field (`onjump`). No sign: the
  fields themselves carry the coral edge. On the dark bar its words and links are light (the
  surface's tokens).
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';

  interface Props {
    /** The required fields still empty, in the order of the page, with their names. */
    fields: readonly { field: string; name: string }[];
    onjump: (field: string) => void;
  }

  let { fields, onjump }: Props = $props();
</script>

<p class="missing" role="status" data-testid="profile-missing">
  {t.profile.missingLead}{#each fields as { field, name }, index (field)}{t.profile.missingBefore(
      index,
      fields.length,
    )}<Button
      variant="link"
      label={name}
      testid="missing-{field}"
      onclick={() => onjump(field)}
    />{/each}.
</p>

<style>
  .missing {
    min-width: 0;
    color: var(--text);
    font: var(--type-md);
  }
</style>
